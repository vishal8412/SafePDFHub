#!/usr/bin/env python3
"""SafePDFHub Compress PDF C6.2 real-browser + real-PDF validation.

Prerequisites on the validation machine:
  pip install playwright pypdf
  python -m playwright install chromium   # only if a system Chromium/Chrome is unavailable

Run from the SafePDFHub project root:
  python scripts/c62-real-browser-validation.py --start-server

The script drives the real /tools/compress-pdf route, uploads real PDF fixtures,
executes compression, captures the browser download, and validates the resulting
PDF's page count, MediaBox/CropBox dimensions, rotation and file-size behavior.
It also exercises normal Worker usage and a forced Worker-constructor failure to
verify the main-thread JPEG fallback.
"""
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from pypdf import PdfReader
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "fixtures"
DEFAULT_URL = "http://127.0.0.1:4200/tools/compress-pdf"
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 4200
SERVER_TIMEOUT = 90
ACTION_TIMEOUT = 90_000


def log(message: str) -> None:
    print(f"[C6.2] {message}", flush=True)


def fail(message: str) -> None:
    raise RuntimeError(message)


def wait_for_server(url: str, process: subprocess.Popen[Any]) -> None:
    deadline = time.monotonic() + SERVER_TIMEOUT
    while time.monotonic() < deadline:
        if process.poll() is not None:
            fail(f"Angular dev server exited early with code {process.returncode}.")
        try:
            with urllib.request.urlopen(url, timeout=2) as response:
                if 200 <= response.status < 500:
                    return
        except (urllib.error.URLError, TimeoutError, OSError):
            pass
        time.sleep(0.5)
    fail(f"Angular dev server did not become reachable within {SERVER_TIMEOUT}s: {url}")


def start_server(host: str, port: int) -> subprocess.Popen[Any]:
    npm = "npm.cmd" if os.name == "nt" else "npm"
    command = [npm, "start", "--", "--host", host, "--port", str(port)]
    log("Starting Angular dev server: " + " ".join(command))
    return subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def browser_executable(explicit: str | None) -> str | None:
    if explicit:
        return explicit
    for name in ("msedge", "google-chrome", "chrome", "chromium", "chromium-browser"):
        found = shutil.which(name)
        if found:
            return found
    return None


def inspect_pdf(path: Path) -> list[tuple[float, float, int, float, float, float, float]]:
    reader = PdfReader(str(path))
    if not reader.pages:
        fail(f"Output PDF has no pages: {path.name}")
    result = []
    for page in reader.pages:
        media = page.mediabox
        crop = page.cropbox
        result.append((
            round(float(media.width), 3),
            round(float(media.height), 3),
            int(page.rotation or 0),
            round(float(crop.width), 3),
            round(float(crop.height), 3),
            round(float(media.left), 3),
            round(float(media.bottom), 3),
        ))
    return result


def validate_pdf(output: Path, source: Path, require_smaller: bool) -> None:
    source_meta = inspect_pdf(source)
    output_meta = inspect_pdf(output)
    if len(output_meta) != len(source_meta):
        fail(f"{output.name}: page count changed {len(source_meta)} -> {len(output_meta)}")
    for index, (src, dst) in enumerate(zip(source_meta, output_meta), 1):
        if src != dst:
            fail(f"{output.name}: page {index} geometry/rotation changed: source={src}, output={dst}")
    if require_smaller and output.stat().st_size >= source.stat().st_size:
        fail(f"{output.name}: expected smaller output, source={source.stat().st_size}, output={output.stat().st_size}")
    log(f"PASS PDF integrity: {output.name} pages={len(output_meta)} size={output.stat().st_size/1024:.1f}KB")


def wait_for_workspace(page) -> None:
    # The file input is the reliable pre-upload readiness signal.
    # The compression action button becomes usable only after a PDF
    # has been loaded and the initial analysis/workspace state is ready.
    page.locator("input.global-tool-file-input").wait_for(
        state="attached",
        timeout=ACTION_TIMEOUT,
    )


def run_case(page, fixture: Path, level_text: str, require_smaller: bool, expect_worker: bool | None = None) -> Path:
    log(f"CASE {fixture.name} / {level_text}")
    page.goto(DEFAULT_URL, wait_until="domcontentloaded", timeout=ACTION_TIMEOUT)
    wait_for_workspace(page)

    file_input = page.locator("input.global-tool-file-input")
    file_input.set_input_files(str(fixture))

    page.locator("button.compress-v2-btn").wait_for(state="visible", timeout=ACTION_TIMEOUT)
    # Wait until the file name is rendered and the initial analysis has settled.
    page.get_by_text(fixture.name, exact=True).wait_for(state="visible", timeout=ACTION_TIMEOUT)

    if level_text:
        page.get_by_role("button", name=level_text, exact=False).click(timeout=ACTION_TIMEOUT)
        page.wait_for_timeout(500)

    with page.expect_download(timeout=ACTION_TIMEOUT) as download_info:
        page.locator("button.compress-v2-btn").click(timeout=ACTION_TIMEOUT)
    download = download_info.value
    target = Path(download.path())
    if not target.exists():
        fail(f"Browser download did not produce a local file for {fixture.name}")

    saved = FIXTURES / "c62-output" / f"{fixture.stem}-{level_text.lower().replace(' ', '-')}.pdf"
    saved.parent.mkdir(exist_ok=True)
    download.save_as(str(saved))
    validate_pdf(saved, fixture, require_smaller)
    return saved


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--start-server", action="store_true")
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--browser", default=None)
    parser.add_argument("--url", default=None)
    args = parser.parse_args()

    global DEFAULT_URL
    DEFAULT_URL = args.url or f"http://{args.host}:{args.port}/tools/compress-pdf"

    required = [
        FIXTURES / "c62-text-a4-rotations.pdf",
        FIXTURES / "c62-scanned-a4-rotations.pdf",
        FIXTURES / "c62-mixed-letter-custom-rotations.pdf",
        FIXTURES / "c62-geometry-matrix.pdf",
    ]
    for path in required:
        if not path.exists():
            fail(f"Missing C6.2 fixture: {path}")

    server = None
    try:
        if args.start_server:
            server = start_server(args.host, args.port)
            wait_for_server(DEFAULT_URL, server)
        else:
            try:
                with urllib.request.urlopen(DEFAULT_URL, timeout=2):
                    pass
            except Exception as exc:
                fail(f"Target URL is not reachable: {DEFAULT_URL}. Start `npm start` or use --start-server. ({exc})")

        executable = browser_executable(args.browser)
        with sync_playwright() as pw:
            launch_kwargs = {"headless": True}
            if executable:
                launch_kwargs["executable_path"] = executable
            browser = pw.chromium.launch(**launch_kwargs)

            # Normal Worker run. Count every Worker constructor created by the page.
            context = browser.new_context(accept_downloads=True, viewport={"width": 1440, "height": 1000})
            context.add_init_script("""
                (() => {
                  const NativeWorker = window.Worker;
                  window.__c62WorkerUrls = [];
                  window.Worker = new Proxy(NativeWorker, {
                    construct(target, args, newTarget) {
                      try { window.__c62WorkerUrls.push(String(args?.[0] ?? '')); } catch {}
                      return Reflect.construct(target, args, newTarget);
                    }
                  });
                })();
            """)
            page = context.new_page()
            run_case(page, required[1], "Maximum Reduction", True)
            worker_urls = page.evaluate("window.__c62WorkerUrls || []")
            if not worker_urls:
                fail("Worker validation failed: no Worker constructor was observed during scanned-PDF compression.")
            log(f"PASS Worker execution observed: {worker_urls}")
            page.close(); context.close()

            # Forced Worker failure. The production worker service should return null and
            # the engine should encode the page again on the main thread.
            fallback_context = browser.new_context(accept_downloads=True, viewport={"width": 1440, "height": 1000})
            fallback_context.add_init_script(r"""
                (() => {
                  const NativeWorker = window.Worker;
                  window.Worker = new Proxy(NativeWorker, {
                    construct(target, args, newTarget) {
                      const url = String(args?.[0] ?? '');
                      if (/pdf-compression|compression\.worker|pdf.*worker/i.test(url)) {
                        throw new Error('C6.2 forced compression-worker failure');
                      }
                      return Reflect.construct(target, args, newTarget);
                    }
                  });
                })();
            """)
            fallback_page = fallback_context.new_page()
            run_case(fallback_page, required[2], "Smart Compression", True)
            log("PASS Worker failure -> main-thread JPEG fallback")
            fallback_page.close(); fallback_context.close()

            # Text-only path: safe/native processing. It is allowed to return the original
            # file when repacking does not reduce size, but geometry/rotation must remain exact.
            text_context = browser.new_context(accept_downloads=True, viewport={"width": 1440, "height": 1000})
            text_page = text_context.new_page()
            run_case(text_page, required[0], "High Quality", False)
            log("PASS text-only native/safe path")
            text_page.close(); text_context.close()

            # Responsive smoke checks on the real route. We don't assert exact pixels here;
            # we verify that the primary workspace remains visible without horizontal overflow.
            for width, height, label in [(1024, 900, "tablet"), (390, 844, "mobile")]:
                responsive = browser.new_page(viewport={"width": width, "height": height})
                responsive.goto(DEFAULT_URL, wait_until="domcontentloaded", timeout=ACTION_TIMEOUT)
                wait_for_workspace(responsive)
                overflow = responsive.evaluate("document.documentElement.scrollWidth > window.innerWidth + 1")
                if overflow:
                    fail(f"Responsive {label} route has horizontal overflow at {width}px.")
                log(f"PASS responsive {label} smoke at {width}x{height}")
                responsive.close()

            browser.close()

        log("C6.2 REAL BROWSER + REAL PDF VALIDATION: PASS")
        return 0
    except PlaywrightTimeoutError as exc:
        print(f"ERROR: Browser action timed out: {exc}", file=sys.stderr)
        return 1
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    finally:
        if server is not None and server.poll() is None:
            log("Stopping Angular dev server.")
            server.terminate()
            try:
                server.wait(timeout=10)
            except subprocess.TimeoutExpired:
                server.kill()
                server.wait(timeout=5)


if __name__ == "__main__":
    raise SystemExit(main())
