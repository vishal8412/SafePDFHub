#!/usr/bin/env python3
"""Real-browser compression memory/cancellation stress harness.

The harness intentionally tests cancellation rather than assuming completion:
- uploads the supplied PDF to /tools/compress-pdf
- starts compression
- samples browser JS heap via Chromium CDP
- cancels after a configurable delay
- verifies the loader cancellation UI disappears
- repeats the operation to detect worker/resource leaks

This script requires the project dependencies to be installed and a Chromium
binary available to Playwright. It does not modify the supplied PDF.
"""

from __future__ import annotations

import argparse
import json
import os
import signal
import subprocess
import sys
import shutil
import urllib.request
import time
from pathlib import Path

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf", type=Path)
    parser.add_argument("--start-server", action="store_true")
    parser.add_argument("--url", default="http://127.0.0.1:4200/tools/compress-pdf")
    parser.add_argument("--port", type=int, default=4200)
    parser.add_argument("--browser", default=None)
    parser.add_argument("--max-cancel-latency-ms", type=int, default=2000)
    parser.add_argument("--runs", type=int, default=5)
    parser.add_argument("--cancel-after-ms", type=int, default=1500)
    parser.add_argument("--sample-ms", type=int, default=250)
    parser.add_argument("--output", type=Path, default=Path("compression-v2-memory-cancellation-stress.json"))
    return parser.parse_args()


def wait_for_server(page, url: str, timeout_ms: int = 120_000) -> None:
    deadline = time.monotonic() + timeout_ms / 1000
    while True:
        try:
            with urllib.request.urlopen(url, timeout=2):
                break
        except OSError:
            if time.monotonic() >= deadline:
                raise RuntimeError(f"Server did not become ready: {url}")
            time.sleep(0.25)
    page.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)
    page.locator("input.global-tool-file-input").wait_for(state="attached", timeout=timeout_ms)


def cdp_memory_metrics(session):
    metrics = session.send("Performance.getMetrics").get("metrics", [])
    values = {item["name"]: item["value"] for item in metrics}
    return {
        "jsHeapUsedMb": round(values.get("JSHeapUsedSize", 0) / (1024 * 1024), 2),
        "jsHeapTotalMb": round(values.get("JSHeapTotalSize", 0) / (1024 * 1024), 2),
    }


def main() -> int:
    args = parse_args()
    pdf = args.pdf.resolve()
    if not pdf.is_file():
        raise SystemExit(f"PDF not found: {pdf}")

    server = None
    server_log = None
    if args.start_server:
        env = os.environ.copy()
        args.output.parent.mkdir(parents=True, exist_ok=True)
        server_log = args.output.with_suffix(".server.log").open("w", encoding="utf-8")
        server = subprocess.Popen(
            [shutil.which("npm.cmd" if os.name == "nt" else "npm") or "npm", "start", "--", "--port", str(args.port), "--host", "127.0.0.1"],
            stdout=server_log,
            stderr=subprocess.STDOUT,
            text=True,
            env=env,
        )

    results = {
        "pdf": str(pdf),
        "pdfBytes": pdf.stat().st_size,
        "runs": [],
        "passed": False,
    }

    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True, executable_path=args.browser, args=["--enable-precise-memory-info"])
            context = browser.new_context()
            page = context.new_page()
            wait_for_server(page, args.url)
            cdp = context.new_cdp_session(page)
            cdp.send("Performance.enable")

            for run_index in range(1, args.runs + 1):
                page.goto(args.url, wait_until="domcontentloaded", timeout=120_000)
                file_input = page.locator("input.global-tool-file-input")
                file_input.set_input_files(str(pdf))

                compress_button = page.locator("button.compress-v2-btn")
                compress_button.wait_for(state="visible", timeout=60_000)
                compress_button.click()

                samples = []
                post_cancel_samples = []
                started = time.monotonic()
                cancelled_at = None
                cancel_button = page.locator("button.loader-cancel-button")

                while (time.monotonic() - started) * 1000 < args.cancel_after_ms:
                    memory = cdp_memory_metrics(cdp)
                    samples.append({
                        "tMs": round((time.monotonic() - started) * 1000),
                        **memory,
                    })
                    time.sleep(args.sample_ms / 1000)

                # Include click scheduling/event-loop stalls. Stop the clock at
                # loader dismissal, before the separate memory settling window.
                cancel_stage = page.evaluate("""() => {
                    const element = document.querySelector('app-tool');
                    const component = element && window.ng?.getComponent(element);
                    const state = component?.compressionState;
                    return state ? {stage: state.stage, progress: state.progress} : null;
                }""")
                cancelled_at = time.monotonic()
                cancel_requested = False
                cancel_timed_out = False
                try:
                    cancel_button.click(timeout=args.max_cancel_latency_ms)
                    cancel_requested = True
                    elapsed = (time.monotonic() - cancelled_at) * 1000
                    page.locator(".app-loader").wait_for(
                        state="hidden", timeout=max(1, args.max_cancel_latency_ms - elapsed))
                except PlaywrightTimeoutError:
                    cancel_timed_out = True
                elapsed_cancel_ms = (time.monotonic() - cancelled_at) * 1000

                post_start = time.monotonic()
                while (time.monotonic() - post_start) * 1000 < 3000:
                    memory = cdp_memory_metrics(cdp)
                    post_cancel_samples.append({
                        "tMs": round((time.monotonic() - cancelled_at) * 1000),
                        **memory,
                    })
                    time.sleep(args.sample_ms / 1000)

                still_loading = page.locator(".app-loader").is_visible()
                pre_heap = samples[-1]["jsHeapUsedMb"] if samples else None
                post_heap = post_cancel_samples[-1]["jsHeapUsedMb"] if post_cancel_samples else None
                result = {
                    "run": run_index,
                    "cancelStage": cancel_stage,
                    "cancelRequested": cancel_requested,
                    "cancelTimedOut": cancel_timed_out,
                    "maxCancelLatencyMs": args.max_cancel_latency_ms,
                    "cancelLatencyMs": round(elapsed_cancel_ms, 1),
                    "loaderStillVisible": still_loading,
                    "preCancelPeakJsHeapMb": max((sample["jsHeapUsedMb"] for sample in samples), default=None),
                    "postCancelJsHeapMb": post_heap,
                    "postCancelJsHeapDeltaMb": round(post_heap - pre_heap, 2) if pre_heap is not None and post_heap is not None else None,
                    "samples": samples,
                    "postCancelSamples": post_cancel_samples,
                    "passed": cancel_requested and not cancel_timed_out and not still_loading and elapsed_cancel_ms <= args.max_cancel_latency_ms,
                }
                results["runs"].append(result)

                if not result["passed"]:
                    break

                # Give worker/WASM teardown a short idle window before the next run.
                time.sleep(1)

            results["passed"] = len(results["runs"]) == args.runs and all(run["passed"] for run in results["runs"])
            browser.close()
    finally:
        if server is not None:
            try:
                server.send_signal(signal.SIGTERM)
                server.wait(timeout=10)
            except Exception:
                server.kill()

        if server_log is not None:
            server_log.close()

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(results, indent=2), encoding="utf-8")
    print(json.dumps({"passed": results["passed"], "runs": len(results["runs"]), "output": str(args.output)}, indent=2))
    return 0 if results["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
