#!/usr/bin/env python3
"""SafePDFHub Compression V2 real-browser benchmark and acceptance harness.

This is the production acceptance stage for the browser compression pipeline.
It runs the real Angular application for Light/Recommended/Strong, downloads
actual outputs, and verifies structural, semantic, metadata, visual, runtime,
memory, and candidate-telemetry evidence.

It never assumes that compression must reduce size: an original PDF is an
accepted outcome when the application returns the original after certification.
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

try:
    import pymupdf as fitz
    from PIL import Image
    from pypdf import PdfReader
    from playwright.sync_api import sync_playwright
except ModuleNotFoundError as exc:
    missing = exc.name or "unknown"
    package = {
        "fitz": "PyMuPDF",
        "PIL": "Pillow",
        "pypdf": "pypdf",
        "playwright": "playwright",
    }.get(missing, missing)
    print(
        f"Missing Python benchmark dependency: {missing}. Install the benchmark dependencies with:\n"
        f"  npm run compress:v2:browser:setup\n"
        f"or: py -m pip install -r scripts/requirements-compression-v2-browser.txt\n"
        f"Required package: {package}",
        file=sys.stderr,
    )
    raise SystemExit(2)

ROOT = Path(__file__).resolve().parents[1]
HOST = "127.0.0.1"
PORT = 4200
URL = f"http://{HOST}:{PORT}/tools/compress-pdf"
SERVER_TIMEOUT = 300
ACTION_TIMEOUT = 300_000
LEVELS = {
    "light": ("High Quality", 0.012, 0.08),
    "recommended": ("Recommended", 0.025, 0.15),
    "strong": ("Maximum Reduction", 0.050, 0.25),
}
SAMPLE_PAGES = 6
RENDER_DPI = 96


def log(message: str) -> None:
    print(f"[V2-BENCHMARK] {message}", flush=True)


def fail(message: str) -> None:
    raise RuntimeError(message)


def resolve_npm() -> str:
    names = ["npm.cmd", "npm.exe", "npm"] if os.name == "nt" else ["npm"]
    for name in names:
        found = shutil.which(name)
        if found:
            return found
    fail("npm executable not found on PATH")


def start_server() -> subprocess.Popen[Any]:
    npm = resolve_npm()
    log_path = ROOT / "benchmark-results" / "compression-v2-server.log"
    log_path.parent.mkdir(parents=True, exist_ok=True)
    log_handle = log_path.open("w", encoding="utf-8", errors="replace")
    process = subprocess.Popen(
        [npm, "start", "--", "--host", HOST, "--port", str(PORT)],
        stdout=log_handle,
        stderr=subprocess.STDOUT,
        cwd=str(ROOT),
        env=os.environ.copy(),
    )
    process._benchmark_log_handle = log_handle  # type: ignore[attr-defined]
    return process


def wait_for_server(process: subprocess.Popen[Any] | None) -> None:
    deadline = time.monotonic() + SERVER_TIMEOUT
    while time.monotonic() < deadline:
        if process is not None and process.poll() is not None:
            log_path = ROOT / "benchmark-results" / "compression-v2-server.log"
            fail(f"Angular server exited with {process.returncode}. See {log_path}")
        try:
            with urllib.request.urlopen(URL, timeout=2) as response:
                if 200 <= response.status < 500:
                    return
        except (urllib.error.URLError, TimeoutError, OSError):
            pass
        time.sleep(0.5)
    log_path = ROOT / "benchmark-results" / "compression-v2-server.log"
    tail = "<server log unavailable>"
    try:
        lines = log_path.read_text(encoding="utf-8", errors="replace").splitlines()
        tail = "\n".join(lines[-80:]) if lines else "<server log is empty>"
    except OSError as exc:
        tail = f"<could not read server log: {exc}>"
    fail(
        f"Angular server did not become reachable within {SERVER_TIMEOUT}s: {URL}\n"
        f"Server log: {log_path}\n"
        f"--- last server log lines ---\n{tail}\n"
        f"--- end server log ---"
    )


def normalize_text(text: str) -> str:
    return " ".join(text.split())


def metadata(reader: PdfReader) -> dict[str, Any]:
    info = reader.metadata or {}
    keys = ["/Title", "/Author", "/Subject", "/Creator", "/Producer", "/Keywords", "/CreationDate", "/ModDate"]
    return {k: str(info.get(k, "")) if info.get(k) is not None else "" for k in keys}


def page_geometry(reader: PdfReader) -> list[dict[str, Any]]:
    result = []
    for page in reader.pages:
        media = page.mediabox
        crop = page.cropbox
        result.append({
            "media": [round(float(media.left), 3), round(float(media.bottom), 3), round(float(media.width), 3), round(float(media.height), 3)],
            "crop": [round(float(crop.left), 3), round(float(crop.bottom), 3), round(float(crop.width), 3), round(float(crop.height), 3)],
            "rotation": int(page.rotation or 0),
        })
    return result


def text_hash(reader: PdfReader) -> tuple[str, int, int]:
    h = hashlib.sha256()
    pages = 0
    chars = 0
    for page in reader.pages:
        text = normalize_text(page.extract_text() or "")
        h.update(text.encode("utf-8"))
        h.update(b"\n")
        if text:
            pages += 1
            chars += len(text)
    return h.hexdigest(), pages, chars


def annotations_signature(reader: PdfReader) -> dict[str, Any]:
    total = 0
    links = 0
    widgets = 0
    types: dict[str, int] = {}
    for page in reader.pages:
        annots = page.get("/Annots")
        if not annots:
            continue
        for ref in annots:
            total += 1
            try:
                obj = ref.get_object()
                subtype = str(obj.get("/Subtype", ""))
                types[subtype] = types.get(subtype, 0) + 1
                if subtype == "/Link":
                    links += 1
                if subtype == "/Widget":
                    widgets += 1
            except Exception:
                types["/Unreadable"] = types.get("/Unreadable", 0) + 1
    fields = 0
    try:
        fields = len((reader.get_fields() or {}))
    except Exception:
        fields = 0
    return {"annotations": total, "links": links, "widgets": widgets, "fields": fields, "types": types}


def pdf_fingerprint(path: Path) -> dict[str, Any]:
    reader = PdfReader(str(path))
    text, text_pages, text_chars = text_hash(reader)
    return {
        "bytes": path.stat().st_size,
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "pages": len(reader.pages),
        "geometry": page_geometry(reader),
        "metadata": metadata(reader),
        "textSha256": text,
        "textPages": text_pages,
        "textCharacters": text_chars,
        "annotations": annotations_signature(reader),
    }


def sample_indices(page_count: int) -> list[int]:
    if page_count <= SAMPLE_PAGES:
        return list(range(page_count))
    indices = {0, page_count // 2, page_count - 1}
    step = max(1, page_count // (SAMPLE_PAGES - 1))
    for i in range(0, page_count, step):
        indices.add(i)
        if len(indices) >= SAMPLE_PAGES:
            break
    return sorted(indices)[:SAMPLE_PAGES]


def visual_fidelity(source: Path, output: Path, mae_limit: float, changed_limit: float) -> dict[str, Any]:
    src = fitz.open(source)
    dst = fitz.open(output)
    indices = sample_indices(len(src))
    if len(dst) != len(src):
        return {"passed": False, "reason": "page-count-mismatch", "samples": []}
    samples = []
    worst_mae = 0.0
    worst_changed = 0.0
    for index in indices:
        a = src[index].get_pixmap(dpi=RENDER_DPI, colorspace=fitz.csRGB, alpha=False)
        b = dst[index].get_pixmap(dpi=RENDER_DPI, colorspace=fitz.csRGB, alpha=False)
        aw = Image.frombytes("RGB", [a.width, a.height], a.samples)
        bw = Image.frombytes("RGB", [b.width, b.height], b.samples)
        if aw.size != bw.size:
            return {"passed": False, "reason": f"render-size-mismatch-page-{index + 1}", "samples": samples}
        pa = list(aw.getdata())
        pb = list(bw.getdata())
        total = len(pa) * 3
        diff_sum = 0
        changed = 0
        for x, y in zip(pa, pb):
            d = abs(x[0] - y[0]) + abs(x[1] - y[1]) + abs(x[2] - y[2])
            diff_sum += d
            if d > 12:
                changed += 1
        mae = diff_sum / total / 255.0
        changed_ratio = changed / len(pa) if pa else 0.0
        worst_mae = max(worst_mae, mae)
        worst_changed = max(worst_changed, changed_ratio)
        samples.append({"page": index + 1, "mae": round(mae, 6), "changedPixelRatio": round(changed_ratio, 6)})
    src.close()
    dst.close()
    return {
        "passed": worst_mae <= mae_limit and worst_changed <= changed_limit,
        "maeLimit": mae_limit,
        "changedPixelRatioLimit": changed_limit,
        "worstMae": round(worst_mae, 6),
        "worstChangedPixelRatio": round(worst_changed, 6),
        "samples": samples,
    }


def heap_snapshot(page) -> int | None:
    try:
        value = page.evaluate("performance.memory ? performance.memory.usedJSHeapSize : null")
        return int(value) if value is not None else None
    except Exception:
        return None


def run_level(page, context, source: Path, level: str, out_dir: Path, source_meta: dict[str, Any]) -> dict[str, Any]:
    label, mae_limit, changed_limit = LEVELS[level]
    console_telemetry: list[dict[str, Any]] = []

    def on_console(message) -> None:
        if message.type != "info":
            return
        text = message.text
        if text.startswith("[SafePDFHub Compression Benchmark]"):
            try:
                payload = message.args[1].json_value() if len(message.args) > 1 else None
                if isinstance(payload, dict):
                    console_telemetry.append(payload)
            except Exception:
                pass

    page.on("console", on_console)
    page.goto(URL, wait_until="domcontentloaded", timeout=ACTION_TIMEOUT)
    page.locator("input.global-tool-file-input").wait_for(state="attached", timeout=ACTION_TIMEOUT)
    page.locator("input.global-tool-file-input").set_input_files(str(source))
    page.get_by_text(source.name, exact=True).wait_for(state="visible", timeout=ACTION_TIMEOUT)
    page.get_by_role("button", name=label, exact=False).click(timeout=ACTION_TIMEOUT)
    page.wait_for_timeout(250)

    heap_before = heap_snapshot(page)
    started = time.perf_counter()

    # Compression itself does not download the PDF. SafePDFHub intentionally
    # keeps the result in memory and exposes an explicit Download action on
    # the result card. Therefore wait for the real compression result first,
    # then capture the browser download from that user-visible action.
    page.locator("button.compress-v2-btn").click(timeout=ACTION_TIMEOUT)
    page.locator("app-operation-result").wait_for(state="visible", timeout=ACTION_TIMEOUT)
    page.get_by_role("button", name="Download compressed PDF", exact=False).wait_for(
        state="visible", timeout=ACTION_TIMEOUT
    )

    with page.expect_download(timeout=ACTION_TIMEOUT) as download_info:
        page.get_by_role("button", name="Download compressed PDF", exact=False).click(
            timeout=ACTION_TIMEOUT
        )
    download = download_info.value
    elapsed_ms = (time.perf_counter() - started) * 1000
    heap_after = heap_snapshot(page)

    output = out_dir / f"compression-v2-{level}.pdf"
    download.save_as(str(output))
    output_meta = pdf_fingerprint(output)
    visual = visual_fidelity(source, output, mae_limit, changed_limit)

    structural = {
        "pageCount": output_meta["pages"] == source_meta["pages"],
        "geometry": output_meta["geometry"] == source_meta["geometry"],
        "metadata": output_meta["metadata"] == source_meta["metadata"],
    }
    semantic = {
        "textHash": output_meta["textSha256"] == source_meta["textSha256"],
        "annotations": output_meta["annotations"] == source_meta["annotations"],
    }
    size_delta = source_meta["bytes"] - output_meta["bytes"]
    reduction = size_delta / source_meta["bytes"] * 100 if source_meta["bytes"] else 0.0
    telemetry = console_telemetry[-1] if console_telemetry else None
    returned_original = output_meta["sha256"] == source_meta["sha256"]
    acceptance = all(structural.values()) and all(semantic.values()) and visual["passed"] and (output_meta["bytes"] <= source_meta["bytes"])
    if telemetry is not None:
        acceptance = acceptance and telemetry.get("finalBytes") == output_meta["bytes"]

    result = {
        "level": level,
        "label": label,
        "durationMs": round(elapsed_ms, 2),
        "inputBytes": source_meta["bytes"],
        "outputBytes": output_meta["bytes"],
        "reductionBytes": size_delta,
        "reductionPercent": round(reduction, 4),
        "smaller": output_meta["bytes"] < source_meta["bytes"],
        "returnedOriginal": returned_original,
        "heapBeforeBytes": heap_before,
        "heapAfterBytes": heap_after,
        "heapDeltaBytes": (heap_after - heap_before) if heap_before is not None and heap_after is not None else None,
        "structural": structural,
        "semantic": semantic,
        "visual": visual,
        "telemetry": telemetry,
        "acceptancePassed": acceptance,
        "outputPath": str(output),
    }
    log(json.dumps({k: v for k, v in result.items() if k != "outputPath"}, indent=2))
    page.remove_listener("console", on_console)
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True)
    parser.add_argument("--levels", nargs="+", choices=list(LEVELS), default=list(LEVELS))
    parser.add_argument("--start-server", action="store_true")
    parser.add_argument("--output-dir", default=None)
    parser.add_argument("--browser", default=None)
    args = parser.parse_args()

    source = Path(args.input).expanduser().resolve()
    if not source.is_file():
        fail(f"Input PDF not found: {source}")
    out_dir = Path(args.output_dir).expanduser().resolve() if args.output_dir else ROOT / "benchmark-results" / "compression-v2-acceptance"
    out_dir.mkdir(parents=True, exist_ok=True)
    source_meta = pdf_fingerprint(source)
    log(f"Input: {source} | {source_meta['bytes']} bytes | {source_meta['pages']} pages")

    server = None
    try:
        if args.start_server:
            server = start_server()
        wait_for_server(server)

        executable = args.browser or None
        if executable is None:
            for candidate in ("msedge", "google-chrome", "chrome", "chromium", "chromium-browser"):
                executable = shutil.which(candidate)
                if executable:
                    break

        with sync_playwright() as pw:
            launch: dict[str, Any] = {"headless": True}
            if executable:
                launch["executable_path"] = executable
            browser = pw.chromium.launch(**launch)
            context = browser.new_context(accept_downloads=True, viewport={"width": 1440, "height": 1000})
            page = context.new_page()
            results = [run_level(page, context, source, level, out_dir, source_meta) for level in args.levels]
            context.close()
            browser.close()

        report = {
            "version": 2,
            "benchmark": "SafePDFHub Compression V2 Real-Browser Acceptance",
            "timestampUtc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "input": source_meta,
            "levels": results,
            "overallPassed": all(item["acceptancePassed"] for item in results),
            "criteria": {
                "actualBrowserDownload": True,
                "pageCountAndGeometryEveryPage": True,
                "metadataExact": True,
                "fullTextSha256": True,
                "annotationsLinksFormsSignature": True,
                "visualSample": f"up to {SAMPLE_PAGES} pages at {RENDER_DPI} DPI",
                "candidateTelemetry": "development browser console when available",
                "noReductionRequirement": "original/equal-size output is accepted only when certification returns the original or an equal-size artifact",
            },
        }
        json_path = out_dir / "compression-v2-browser-acceptance.json"
        json_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
        md = [
            "# SafePDFHub Compression V2 — Real-Browser Benchmark & Acceptance",
            "",
            f"Input: `{source}`  ",
            f"Input bytes: `{source_meta['bytes']}`  ",
            f"Pages: `{source_meta['pages']}`",
            "",
            "| Level | Output bytes | Reduction | Runtime ms | Structural | Semantic | Visual | Acceptance |",
            "|---|---:|---:|---:|---|---|---|---|",
        ]
        for r in results:
            md.append(f"| {r['level']} | {r['outputBytes']} | {r['reductionPercent']:.4f}% | {r['durationMs']:.2f} | {'PASS' if all(r['structural'].values()) else 'FAIL'} | {'PASS' if all(r['semantic'].values()) else 'FAIL'} | {'PASS' if r['visual']['passed'] else 'FAIL'} | {'PASS' if r['acceptancePassed'] else 'FAIL'} |")
        md.append("")
        md.append(f"Overall: **{'PASS' if report['overallPassed'] else 'FAIL'}**")
        md_path = out_dir / "compression-v2-browser-acceptance.md"
        md_path.write_text("\n".join(md) + "\n", encoding="utf-8")
        log(f"JSON report: {json_path}")
        log(f"Markdown report: {md_path}")
        return 0 if report["overallPassed"] else 2
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    finally:
        if server is not None and server.poll() is None:
            server.terminate()
            try:
                server.wait(timeout=10)
            except subprocess.TimeoutExpired:
                server.kill()
        handle = getattr(server, "_benchmark_log_handle", None) if server is not None else None
        if handle:
            handle.close()


if __name__ == "__main__":
    raise SystemExit(main())
