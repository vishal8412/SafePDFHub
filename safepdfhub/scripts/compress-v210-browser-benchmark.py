#!/usr/bin/env python3
"""SafePDFHub Compression V2.10 real-browser benchmark.

Runs the production compression route against a caller-supplied PDF and records
actual browser execution time, output size, PDF geometry, and page-text hashes.
This is a benchmark harness only; it never changes the application code.

Prerequisites:
  pip install playwright pypdf
  python -m playwright install chromium   # if no Chromium-family browser exists

Examples:
  python scripts/compress-v210-browser-benchmark.py --input "15-MB(7).pdf" --start-server
  python scripts/compress-v210-browser-benchmark.py --input input.pdf --levels recommended strong

The benchmark deliberately does not require a particular output reduction. A
candidate is reported as smaller/equal/larger so that real behavior is measured
rather than assumed.
"""
from __future__ import annotations

import argparse
import hashlib
import json
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
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 4200
DEFAULT_URL = "http://127.0.0.1:4200/tools/compress-pdf"
SERVER_TIMEOUT = 90
ACTION_TIMEOUT = 180_000

LEVEL_LABELS = {
    "light": "High Quality",
    "recommended": "Recommended",
    "strong": "Maximum Reduction",
}


def log(message: str) -> None:
    print(f"[V2.10] {message}", flush=True)


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


def normalize_text(text: str) -> str:
    return " ".join(text.split())


def pdf_fingerprint(path: Path) -> dict[str, Any]:
    reader = PdfReader(str(path))
    if not reader.pages:
        fail(f"PDF has no pages: {path}")

    geometry: list[dict[str, Any]] = []
    text_hash = hashlib.sha256()
    text_pages = 0
    text_chars = 0

    for page in reader.pages:
        media = page.mediabox
        crop = page.cropbox
        geometry.append({
            "media": [round(float(media.left), 3), round(float(media.bottom), 3), round(float(media.width), 3), round(float(media.height), 3)],
            "crop": [round(float(crop.left), 3), round(float(crop.bottom), 3), round(float(crop.width), 3), round(float(crop.height), 3)],
            "rotation": int(page.rotation or 0),
        })
        try:
            text = normalize_text(page.extract_text() or "")
        except Exception:
            text = ""
        text_hash.update(text.encode("utf-8"))
        text_hash.update(b"\n")
        if text:
            text_pages += 1
            text_chars += len(text)

    return {
        "pages": len(reader.pages),
        "bytes": path.stat().st_size,
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "textSha256": text_hash.hexdigest(),
        "textPages": text_pages,
        "textCharacters": text_chars,
        "geometry": geometry,
    }


def run_level(page, input_path: Path, level: str, output_dir: Path) -> dict[str, Any]:
    label = LEVEL_LABELS[level]
    log(f"CASE level={level} label={label}")
    page.goto(DEFAULT_URL, wait_until="domcontentloaded", timeout=ACTION_TIMEOUT)
    page.locator("input.global-tool-file-input").wait_for(state="attached", timeout=ACTION_TIMEOUT)
    page.locator("input.global-tool-file-input").set_input_files(str(input_path))
    page.get_by_text(input_path.name, exact=True).wait_for(state="visible", timeout=ACTION_TIMEOUT)

    page.get_by_role("button", name=label, exact=False).click(timeout=ACTION_TIMEOUT)
    page.wait_for_timeout(300)

    started = time.perf_counter()
    with page.expect_download(timeout=ACTION_TIMEOUT) as download_info:
        page.locator("button.compress-v2-btn").click(timeout=ACTION_TIMEOUT)
    download = download_info.value
    elapsed_ms = (time.perf_counter() - started) * 1000

    output_path = output_dir / f"{input_path.stem}-v210-{level}.pdf"
    download.save_as(str(output_path))
    output_meta = pdf_fingerprint(output_path)

    input_meta = pdf_fingerprint(input_path)
    if output_meta["pages"] != input_meta["pages"]:
        fail(f"{level}: page count changed {input_meta['pages']} -> {output_meta['pages']}")
    if output_meta["geometry"] != input_meta["geometry"]:
        fail(f"{level}: page geometry/rotation changed")

    size_delta = input_meta["bytes"] - output_meta["bytes"]
    reduction_percent = (size_delta / input_meta["bytes"] * 100) if input_meta["bytes"] else 0.0
    text_match = output_meta["textSha256"] == input_meta["textSha256"]

    result = {
        "level": level,
        "label": label,
        "durationMs": round(elapsed_ms, 2),
        "input": {k: v for k, v in input_meta.items() if k != "geometry"},
        "output": {k: v for k, v in output_meta.items() if k != "geometry"},
        "sizeDeltaBytes": size_delta,
        "reductionPercent": round(reduction_percent, 4),
        "smaller": output_meta["bytes"] < input_meta["bytes"],
        "textHashMatch": text_match,
        "geometryMatch": True,
        "outputPath": str(output_path),
    }
    log(json.dumps({k: v for k, v in result.items() if k != "outputPath"}, indent=2))
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, help="Input PDF path")
    parser.add_argument("--levels", nargs="+", choices=list(LEVEL_LABELS), default=list(LEVEL_LABELS), help="Compression levels to benchmark")
    parser.add_argument("--start-server", action="store_true")
    parser.add_argument("--browser", default=None)
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--url", default=None)
    parser.add_argument("--output-dir", default=None)
    args = parser.parse_args()

    input_path = Path(args.input).expanduser().resolve()
    if not input_path.is_file():
        fail(f"Input PDF not found: {input_path}")
    if input_path.suffix.lower() != ".pdf":
        fail("--input must point to a PDF file")

    global DEFAULT_URL
    DEFAULT_URL = args.url or f"http://{args.host}:{args.port}/tools/compress-pdf"
    output_dir = Path(args.output_dir).expanduser().resolve() if args.output_dir else ROOT / "benchmark-results" / "compression-v210"
    output_dir.mkdir(parents=True, exist_ok=True)

    server = None
    try:
        if args.start_server:
            server = start_server(args.host, args.port)
            wait_for_server(DEFAULT_URL, server)
        else:
            with urllib.request.urlopen(DEFAULT_URL, timeout=2):
                pass

        executable = browser_executable(args.browser)
        source_meta = pdf_fingerprint(input_path)
        results: list[dict[str, Any]] = []

        with sync_playwright() as pw:
            launch_kwargs: dict[str, Any] = {"headless": True}
            if executable:
                launch_kwargs["executable_path"] = executable
            browser = pw.chromium.launch(**launch_kwargs)
            context = browser.new_context(accept_downloads=True, viewport={"width": 1440, "height": 1000})
            page = context.new_page()
            for level in args.levels:
                results.append(run_level(page, input_path, level, output_dir))
            context.close()
            browser.close()

        report = {
            "version": 1,
            "benchmark": "SafePDFHub Compression V2.10",
            "timestampUtc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "input": source_meta,
            "levels": results,
            "notes": [
                "Size reduction is measured from actual downloaded bytes.",
                "Geometry/rotation equality is checked for every page.",
                "Text hash is a regression signal, not a proof of full semantic equivalence.",
                "No reduction is assumed or required by the harness.",
            ],
        }
        json_path = output_dir / "v210-compression-benchmark.json"
        json_path.write_text(json.dumps(report, indent=2), encoding="utf-8")

        markdown = [
            "# SafePDFHub Compression V2.10 Benchmark",
            "",
            f"- Input: `{input_path}`",
            f"- Input size: `{source_meta['bytes']}` bytes",
            f"- Pages: `{source_meta['pages']}`",
            "",
            "| Level | Output bytes | Reduction | Duration ms | Text hash | Geometry |",
            "|---|---:|---:|---:|---|---|",
        ]
        for item in results:
            markdown.append(
                f"| {item['level']} | {item['output']['bytes']} | {item['reductionPercent']:.4f}% | "
                f"{item['durationMs']:.2f} | {'PASS' if item['textHashMatch'] else 'FAIL'} | PASS |"
            )
        markdown.extend([
            "",
            "> This harness records actual browser results. It does not declare a compression strategy successful merely because it was expected to reduce size.",
        ])
        md_path = output_dir / "v210-compression-benchmark.md"
        md_path.write_text("\n".join(markdown) + "\n", encoding="utf-8")

        log(f"Benchmark report: {json_path}")
        log(f"Benchmark markdown: {md_path}")
        log("V2.10 real-browser benchmark: PASS")
        return 0
    except Exception as exc:  # noqa: BLE001 - CLI boundary
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    finally:
        if server is not None and server.poll() is None:
            server.terminate()
            try:
                server.wait(timeout=10)
            except subprocess.TimeoutExpired:
                server.kill()
                server.wait(timeout=5)


if __name__ == "__main__":
    raise SystemExit(main())
