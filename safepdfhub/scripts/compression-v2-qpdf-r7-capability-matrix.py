#!/usr/bin/env python3
"""SafePDFHub Compression V2 — QPDF-R7 real-world capability matrix.

Runs the real Angular compression UI against a representative PDF corpus and
records qpdf eligibility, runtime outcomes, candidate sizes, certification,
and document-integrity evidence. R7 is evidence collection only: it does not
change production thresholds automatically.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

try:
    import fontTools  # noqa: F401  # benchmark dependency; prevents pypdf CFF font fallback warnings
    import pymupdf as fitz
    from PIL import Image
    from pypdf import PdfReader
    from playwright.sync_api import sync_playwright
except ModuleNotFoundError as exc:
    missing = exc.name or "unknown"
    package = {
        "fontTools": "fonttools",
        "fitz": "PyMuPDF",
        "PIL": "Pillow",
        "pypdf": "pypdf",
        "playwright": "playwright",
    }.get(missing, missing)
    print(
        "Missing R7 benchmark dependency: " + missing + ". Install with:\n"
        "  npm run compress:v2:browser:setup\n"
        "or: py -m pip install -r scripts/requirements-compression-v2-browser.txt\n"
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
    print(f"[QPDF-R7] {message}", flush=True)


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
    log_path = ROOT / "benchmark-results" / "qpdf-r7-server.log"
    log_path.parent.mkdir(parents=True, exist_ok=True)
    handle = log_path.open("w", encoding="utf-8", errors="replace")
    process = subprocess.Popen(
        [npm, "start", "--", "--host", HOST, "--port", str(PORT)],
        stdout=handle,
        stderr=subprocess.STDOUT,
        cwd=str(ROOT),
        env=os.environ.copy(),
    )
    process._r7_log_handle = handle  # type: ignore[attr-defined]
    return process


def wait_for_server(process: subprocess.Popen[Any] | None) -> None:
    deadline = time.monotonic() + SERVER_TIMEOUT
    while time.monotonic() < deadline:
        if process is not None and process.poll() is not None:
            fail(f"Angular server exited with {process.returncode}")
        try:
            with urllib.request.urlopen(URL, timeout=2) as response:
                if 200 <= response.status < 500:
                    return
        except (urllib.error.URLError, TimeoutError, OSError):
            pass
        time.sleep(0.5)
    fail(f"Angular server did not become reachable within {SERVER_TIMEOUT}s")


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
    digest = hashlib.sha256()
    pages = 0
    chars = 0
    for page in reader.pages:
        text = normalize_text(page.extract_text() or "")
        digest.update(text.encode("utf-8"))
        digest.update(b"\n")
        if text:
            pages += 1
            chars += len(text)
    return digest.hexdigest(), pages, chars


def annotations_signature(reader: PdfReader) -> dict[str, Any]:
    total = links = widgets = fields = 0
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
                links += subtype == "/Link"
                widgets += subtype == "/Widget"
            except Exception:
                types["/Unreadable"] = types.get("/Unreadable", 0) + 1
    try:
        fields = len(reader.get_fields() or {})
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
        src.close(); dst.close()
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
            src.close(); dst.close()
            return {"passed": False, "reason": f"render-size-mismatch-page-{index + 1}", "samples": samples}
        pa = list(aw.getdata())
        pb = list(bw.getdata())
        diff_sum = 0
        changed = 0
        for x, y in zip(pa, pb):
            d = abs(x[0] - y[0]) + abs(x[1] - y[1]) + abs(x[2] - y[2])
            diff_sum += d
            if d > 12:
                changed += 1
        mae = diff_sum / (len(pa) * 3) / 255.0 if pa else 0.0
        changed_ratio = changed / len(pa) if pa else 0.0
        worst_mae = max(worst_mae, mae)
        worst_changed = max(worst_changed, changed_ratio)
        samples.append({"page": index + 1, "mae": round(mae, 6), "changedPixelRatio": round(changed_ratio, 6)})
    src.close(); dst.close()
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


def slug(path: Path) -> str:
    value = re.sub(r"[^A-Za-z0-9._-]+", "-", path.stem).strip("-")
    return value[:100] or "document"


def qpdf_evidence(telemetry: dict[str, Any] | None) -> dict[str, Any]:
    """Extract qpdf evidence without inventing qpdf activity.

    R7.2.3 treats missing structural/qpdf telemetry as *incomplete evidence*,
    not as a successful qpdf result. This is important when another compression
    branch (for example image optimization) produces a smaller final PDF.
    """
    if not telemetry:
        return {
            "available": False,
            "outcome": "telemetry-unavailable",
            "semanticState": "evidence-incomplete",
            "evidenceSemanticsPassed": False,
            "calibrationEvidenceComplete": False,
            "contradictions": ["QPDF_TELEMETRY_UNAVAILABLE"],
        }

    diagnostics = telemetry.get("structuralDiagnostics") or []
    attempt_decision = telemetry.get("structuralQpdfAttemptDecision")
    if not isinstance(attempt_decision, dict):
        attempt_decision = None
    lifecycle = telemetry.get("structuralStage") or {}
    if not isinstance(lifecycle, dict):
        lifecycle = {}
    structural_candidates = [
        c for c in telemetry.get("candidates", [])
        if c.get("stage") == "structural"
    ]
    risks = sorted({d.get("resourceRisk") for d in diagnostics if d.get("resourceRisk")})
    profiles = sorted({d.get("optimizationProfile") for d in diagnostics if d.get("optimizationProfile")})
    reasons = [d.get("reason") for d in diagnostics if d.get("reason")]
    decision_state = attempt_decision.get("state") if attempt_decision else None
    decision_reason = attempt_decision.get("reason") if attempt_decision else None
    decision_attempted_kinds = attempt_decision.get("attemptedKinds") if attempt_decision else None
    decision_skipped_kinds = attempt_decision.get("skippedKinds") if attempt_decision else None

    guard_reason = "QPDF_OUTPUT_DISABLED_BY_RESOURCE_GUARD"
    guard_blocked = guard_reason in reasons
    oom = any(
        d.get("reason") == "QPDF_MEMORY_EXHAUSTED"
        or "oom" in str(d.get("runtimeErrorMessage", "")).lower()
        for d in diagnostics
    )
    attempted = bool(structural_candidates) or any(
        d.get("status") in {"generated", "rejected", "failed"}
        and d.get("reason") != "QPDF_OUTPUT_DISABLED_BY_RESOURCE_GUARD"
        for d in diagnostics
    )
    smaller = any(
        c.get("generated") and c.get("outputBytes", 0) < c.get("inputBytes", 0)
        for c in structural_candidates
    )
    certified = any(
        c.get("stage") == "structural" and c.get("certification") == "passed"
        for c in telemetry.get("candidates", [])
    )

    contradictions: list[str] = []
    if attempt_decision is not None and attempt_decision.get("scope") != "structural":
        contradictions.append("INVALID_QPDF_ATTEMPT_DECISION_SCOPE")
    if decision_state in {"attempted", "guard-blocked"} and lifecycle and not lifecycle.get("entered", False):
        contradictions.append("STRUCTURAL_DECISION_WITHOUT_STAGE_ENTRY")
    if decision_reason == "STRUCTURAL_STAGE_NOT_ENTERED" and lifecycle.get("entered"):
        contradictions.append("STRUCTURAL_STAGE_ENTERED_WITH_NOT_ENTERED_REASON")
    if decision_reason != "ALREADY_COMPRESSED_FAST_PATH" and lifecycle.get("entered") and not lifecycle.get("completed", False):
        contradictions.append("STRUCTURAL_STAGE_ENTERED_BUT_NOT_COMPLETED")
    if decision_state == "attempted" and not diagnostics:
        contradictions.append("QPDF_ATTEMPTED_WITHOUT_STRUCTURAL_DIAGNOSTICS")
    if decision_state == "guard-blocked" and not guard_blocked:
        contradictions.append("QPDF_GUARD_DECISION_WITHOUT_GUARD_DIAGNOSTIC")
    if decision_state == "not-attempted" and diagnostics:
        contradictions.append("QPDF_NOT_ATTEMPTED_WITH_STRUCTURAL_DIAGNOSTICS")
    if guard_blocked and attempted:
        contradictions.append("GUARD_BLOCK_AND_QPDF_ATTEMPTED")
    if guard_blocked and oom:
        contradictions.append("GUARD_BLOCK_AND_QPDF_OOM")
    # R1.1: an explicit guard block is valid for both known-high and
    # unknown-complexity workloads. Unknown is intentionally conservative: it
    # means the guard cannot safely establish low/elevated qpdf eligibility,
    # not that the guard decision is contradictory. A contradiction exists only
    # when a known, non-high risk profile is explicitly blocked by the high-risk
    # guard contract.
    if guard_blocked and risks and set(risks).issubset({"low", "elevated"}):
        contradictions.append("GUARD_BLOCK_WITH_NON_HIGH_RESOURCE_RISK")
    if guard_blocked and any(
        reason not in {"QPDF_OUTPUT_DISABLED_BY_RESOURCE_GUARD"}
        for reason in reasons
    ):
        contradictions.append("GUARD_BLOCK_WITH_NON_GUARD_FAILURE_REASON")
    if certified and not smaller:
        contradictions.append("CERTIFIED_STRUCTURAL_CANDIDATE_NOT_SMALLER")
    if smaller and not structural_candidates:
        contradictions.append("SMALLER_STRUCTURAL_CANDIDATE_WITHOUT_STRUCTURAL_RECORD")

    resource_signals = next(
        (d.get("resourceSignals") for d in diagnostics if isinstance(d.get("resourceSignals"), dict)),
        None,
    )
    resource_signal_provenance = next(
        (d.get("resourceSignalProvenance") for d in diagnostics if isinstance(d.get("resourceSignalProvenance"), dict)),
        None,
    )
    required_signal_keys = {"fileBytes", "pages", "streamBytes", "imageBytes", "objectCount"}
    required_provenance_keys = required_signal_keys
    valid_statuses = {"measured", "measured-zero", "unavailable"}
    provenance_present = (
        isinstance(resource_signal_provenance, dict)
        and required_provenance_keys.issubset(resource_signal_provenance.keys())
        and all(resource_signal_provenance.get(key) in valid_statuses for key in required_provenance_keys)
    )
    resource_signals_complete = (
        isinstance(resource_signals, dict)
        and required_signal_keys.issubset(resource_signals.keys())
        and provenance_present
    )
    resource_signals_usable = (
        resource_signals_complete
        and all(resource_signal_provenance.get(key) != "unavailable" for key in required_provenance_keys)
    )

    fast_path_not_applicable = decision_reason == "ALREADY_COMPRESSED_FAST_PATH"

    if contradictions:
        semantic_state = "contradictory"
        outcome = "evidence-contradiction"
    elif fast_path_not_applicable:
        # R1.1: the structural qpdf stage was deliberately skipped because the
        # source is already below the per-page fast-path threshold. This is a
        # valid non-qpdf production path, not missing evidence.
        semantic_state = "not-applicable"
        outcome = "structural-stage-skipped"
    elif guard_blocked:
        semantic_state = "guard-blocked"
        outcome = "blocked-safe-fallback" if risks == ["unknown"] else "blocked-high-risk"
    elif oom:
        semantic_state = "qpdf-oom"
        outcome = "oom"
    elif smaller and certified:
        semantic_state = "certified-smaller"
        outcome = "smaller-certified"
    elif attempted:
        semantic_state = "qpdf-attempted"
        outcome = "attempted-no-certified-smaller"
    else:
        semantic_state = "not-attempted"
        outcome = "not-attempted"

    # Calibration evidence is a separate concept from safety evidence. A
    # conservative unknown guard decision is safe production evidence but does
    # not establish that the workload belongs in low/elevated/high threshold
    # calibration. Only usable forensic signals or an explicit known-high guard
    # decision qualify for calibration.
    calibration_complete = resource_signals_usable or (guard_blocked and risks == ["high"])
    semantics_passed = not contradictions
    if attempt_decision is None:
        semantics_passed = False
    elif fast_path_not_applicable:
        semantics_passed = True
    elif semantic_state == "not-attempted":
        semantics_passed = False
    elif guard_blocked:
        # Unknown/high guard blocks are valid safety decisions as long as the
        # explicit guard diagnostic and resource provenance are coherent.
        semantics_passed = semantics_passed and bool(risks) and resource_signals_complete

    return {
        "available": True,
        "attemptDecision": attempt_decision,
        "attemptDecisionState": decision_state,
        "attemptDecisionReason": decision_reason,
        "attemptedKinds": decision_attempted_kinds,
        "skippedKinds": decision_skipped_kinds,
        "resourceRisk": risks[0] if len(risks) == 1 else risks,
        "optimizationProfile": profiles[0] if len(profiles) == 1 else profiles,
        "resourceSignals": resource_signals,
        "resourceSignalsComplete": resource_signals_complete,
        "resourceSignalsUsable": resource_signals_usable,
        "resourceSignalProvenance": resource_signal_provenance,
        "outcome": outcome,
        "semanticState": semantic_state,
        "evidenceSemanticsPassed": semantics_passed,
        "calibrationEvidenceComplete": calibration_complete,
        "attempted": attempted,
        "blocked": semantic_state == "guard-blocked",
        "oom": oom,
        "smallerStructuralCandidate": smaller,
        "certifiedStructuralCandidate": certified,
        "diagnosticCount": len(diagnostics),
        "diagnosticReasons": reasons,
        "structuralCandidateCount": len(structural_candidates),
        "structuralStage": lifecycle,
        "contradictions": contradictions,
    }


def run_case_level(page, source: Path, level: str, case_dir: Path, source_meta: dict[str, Any]) -> dict[str, Any]:
    label, mae_limit, changed_limit = LEVELS[level]
    console_telemetry: list[dict[str, Any]] = []

    def on_console(message) -> None:
        if message.type != "info" or not message.text.startswith("[SafePDFHub Compression Benchmark]"):
            return
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
    page.locator("button.compress-v2-btn").click(timeout=ACTION_TIMEOUT)
    page.locator("app-operation-result").wait_for(state="visible", timeout=ACTION_TIMEOUT)
    page.get_by_role("button", name="Download compressed PDF", exact=False).wait_for(state="visible", timeout=ACTION_TIMEOUT)
    with page.expect_download(timeout=ACTION_TIMEOUT) as download_info:
        page.get_by_role("button", name="Download compressed PDF", exact=False).click(timeout=ACTION_TIMEOUT)
    download = download_info.value
    elapsed_ms = (time.perf_counter() - started) * 1000
    heap_after = heap_snapshot(page)

    output = case_dir / f"{level}.pdf"
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
    telemetry = console_telemetry[-1] if console_telemetry else None
    qpdf = qpdf_evidence(telemetry)
    size_delta = source_meta["bytes"] - output_meta["bytes"]
    reduction = size_delta / source_meta["bytes"] * 100 if source_meta["bytes"] else 0.0
    returned_original = output_meta["sha256"] == source_meta["sha256"]
    acceptance_failure_reasons: list[str] = []
    if not structural["pageCount"]:
        acceptance_failure_reasons.append("PAGE_COUNT_MISMATCH")
    if not structural["geometry"]:
        acceptance_failure_reasons.append("PAGE_GEOMETRY_MISMATCH")
    if not structural["metadata"]:
        acceptance_failure_reasons.append("METADATA_MISMATCH")
    if not semantic["textHash"]:
        acceptance_failure_reasons.append("TEXT_HASH_MISMATCH")
    if not semantic["annotations"]:
        acceptance_failure_reasons.append("ANNOTATIONS_MISMATCH")
    if not visual["passed"]:
        acceptance_failure_reasons.append("VISUAL_FIDELITY_FAILED")
    if output_meta["bytes"] > source_meta["bytes"]:
        acceptance_failure_reasons.append("OUTPUT_LARGER_THAN_SOURCE")
    if telemetry is not None and telemetry.get("finalBytes") != output_meta["bytes"]:
        acceptance_failure_reasons.append("TELEMETRY_DOWNLOAD_SIZE_MISMATCH")
    evidence_semantics_passed = qpdf.get("evidenceSemanticsPassed", False)
    if not evidence_semantics_passed:
        acceptance_failure_reasons.append("QPDF_EVIDENCE_SEMANTICS_FAILED")
    if telemetry is None:
        acceptance_failure_reasons.append("COMPRESSION_TELEMETRY_UNAVAILABLE")
    acceptance = not acceptance_failure_reasons

    result = {
        "source": source.name,
        "sourcePath": str(source),
        "level": level,
        "label": label,
        "durationMs": round(elapsed_ms, 2),
        "inputBytes": source_meta["bytes"],
        "inputPages": source_meta["pages"],
        "outputBytes": output_meta["bytes"],
        "reductionBytes": size_delta,
        "reductionPercent": round(reduction, 4),
        "smaller": output_meta["bytes"] < source_meta["bytes"],
        "returnedOriginal": returned_original,
        "heapBeforeBytes": heap_before,
        "heapAfterBytes": heap_after,
        "heapDeltaBytes": heap_after - heap_before if heap_before is not None and heap_after is not None else None,
        "structural": structural,
        "semantic": semantic,
        "visual": visual,
        "qpdf": qpdf,
        "evidenceSemanticsPassed": evidence_semantics_passed,
        "telemetry": telemetry,
        "finalDecision": telemetry.get("finalDecision") if telemetry else None,
        "finalDecisionReason": telemetry.get("finalDecisionReason") if telemetry else None,
        "candidateCertificationReasons": [
            {
                "stage": candidate.get("stage"),
                "label": candidate.get("label"),
                "certification": candidate.get("certification"),
                "reason": candidate.get("certificationReason"),
            }
            for candidate in (telemetry.get("candidates", []) if telemetry else [])
            if candidate.get("certification") == "rejected"
        ],
        "acceptanceFailureReasons": acceptance_failure_reasons,
        "acceptancePassed": acceptance,
    }
    page.remove_listener("console", on_console)
    return result


def discover_inputs(paths: list[str], input_dir: str | None, recursive: bool) -> list[Path]:
    found: list[Path] = []
    for value in paths:
        path = Path(value).expanduser().resolve()
        if path.is_file() and path.suffix.lower() == ".pdf":
            found.append(path)
        elif path.is_dir():
            found.extend(sorted(path.rglob("*.pdf") if recursive else path.glob("*.pdf")))
        else:
            fail(f"Input not found or not a PDF: {path}")
    if input_dir:
        directory = Path(input_dir).expanduser().resolve()
        if not directory.is_dir():
            fail(f"Input directory not found: {directory}")
        found.extend(sorted(directory.rglob("*.pdf") if recursive else directory.glob("*.pdf")))
    unique: list[Path] = []
    seen: set[str] = set()
    for path in found:
        key = str(path).lower()
        if key not in seen:
            seen.add(key)
            unique.append(path)
    if not unique:
        fail("No PDF inputs found. Supply --input PDF (repeatable) or --input-dir DIR.")
    return unique


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", action="append", default=[], help="PDF file or directory; repeatable")
    parser.add_argument("--input-dir", default=None)
    parser.add_argument("--recursive", action="store_true")
    parser.add_argument("--levels", nargs="+", choices=list(LEVELS), default=list(LEVELS))
    parser.add_argument("--max-files", type=int, default=0)
    parser.add_argument("--start-server", action="store_true")
    parser.add_argument("--output-dir", default=None)
    parser.add_argument("--browser", default=None)
    args = parser.parse_args()

    inputs = discover_inputs(args.input, args.input_dir, args.recursive)
    if args.max_files > 0:
        inputs = inputs[:args.max_files]
    out_root = Path(args.output_dir).expanduser().resolve() if args.output_dir else ROOT / "benchmark-results" / "qpdf-r7-capability-matrix"
    out_root.mkdir(parents=True, exist_ok=True)
    log(f"Corpus: {len(inputs)} PDF(s) | levels: {', '.join(args.levels)}")

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

        cases: list[dict[str, Any]] = []
        with sync_playwright() as pw:
            launch: dict[str, Any] = {"headless": True}
            if executable:
                launch["executable_path"] = executable
            browser = pw.chromium.launch(**launch)
            context = browser.new_context(accept_downloads=True, viewport={"width": 1440, "height": 1000})
            page = context.new_page()
            for source in inputs:
                source_meta = pdf_fingerprint(source)
                case_dir = out_root / slug(source)
                case_dir.mkdir(parents=True, exist_ok=True)
                log(f"Input: {source.name} | {source_meta['bytes']} bytes | {source_meta['pages']} pages")
                for level in args.levels:
                    result = run_case_level(page, source, level, case_dir, source_meta)
                    cases.append(result)
                    log(json.dumps({
                        "source": source.name,
                        "level": level,
                        "runtimeMs": result["durationMs"],
                        "outputBytes": result["outputBytes"],
                        "reductionPercent": result["reductionPercent"],
                        "qpdf": result["qpdf"],
                        "acceptancePassed": result["acceptancePassed"],
                    }, indent=2))
            context.close()
            browser.close()

        # Evidence-only aggregation. No threshold is automatically changed.
        by_risk: dict[str, dict[str, int]] = {}
        for case in cases:
            risk = case["qpdf"].get("resourceRisk", "unknown")
            risk_key = json.dumps(risk, sort_keys=True)
            bucket = by_risk.setdefault(risk_key, {"cases": 0, "qpdfAttempted": 0, "blocked": 0, "oom": 0, "smallerCertified": 0, "accepted": 0})
            bucket["cases"] += 1
            bucket["qpdfAttempted"] += int(bool(case["qpdf"].get("attempted")))
            bucket["blocked"] += int(case["qpdf"].get("semanticState") == "guard-blocked")
            bucket["oom"] += int(case["qpdf"].get("outcome") == "oom")
            bucket["smallerCertified"] += int(case["qpdf"].get("outcome") == "smaller-certified")
            bucket["accepted"] += int(case["acceptancePassed"])

        report = {
            "version": 1,
            "benchmark": "SafePDFHub Compression V2 — QPDF-R7 Real-World Capability Matrix",
            "timestampUtc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "mode": "evidence-only; no automatic threshold calibration",
            "corpus": [{"name": p.name, "path": str(p)} for p in inputs],
            "levels": args.levels,
            "cases": cases,
            "summaryByObservedRisk": by_risk,
            "calibrationPolicy": {
                "automaticThresholdChanges": False,
                "highRiskPolicy": "preserved from R6/R6.1",
                "thresholdChangesRequire": "representative corpus evidence plus explicit engineering review",
            },
            "acceptanceCriteria": {
                "pageCountAndGeometryEveryPage": True,
                "metadataExact": True,
                "fullTextSha256": True,
                "annotationsAndForms": True,
                "visualSample": f"up to {SAMPLE_PAGES} pages at {RENDER_DPI} DPI",
                "outputNotLarger": True,
                "telemetryFinalBytesMatchesDownload": True,
            },
        }
        json_path = out_root / "qpdf-r7-capability-matrix.json"
        json_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
        md = [
            "# SafePDFHub Compression V2 — QPDF-R7 Capability Matrix",
            "",
            "R7 is evidence collection only. It does not automatically change production resource thresholds.",
            "",
            "| PDF | Pages | Risk | Level | QPDF outcome | Output bytes | Reduction | Runtime ms | Acceptance |",
            "|---|---:|---|---|---|---:|---:|---:|---|",
        ]
        for case in cases:
            md.append(
                f"| {case['source']} | {case['inputPages']} | {case['qpdf'].get('resourceRisk', 'unknown')} | {case['level']} | {case['qpdf'].get('outcome', 'unknown')} | {case['outputBytes']} | {case['reductionPercent']:.4f}% | {case['durationMs']:.2f} | {'PASS' if case['acceptancePassed'] else 'FAIL'} |"
            )
        md.extend(["", "## R1.1 evidence-state semantics", "", "Unknown-complexity guard blocks are valid safety decisions and are not contradictions. They are not calibration evidence because the resource signals are not fully usable.", "", "An already-compressed fast path is recorded as `not-applicable` for qpdf evidence because the structural stage is deliberately skipped and the fallback candidate is still subject to final certification.", "", "## Threshold calibration rule", "", "No threshold is changed by this harness. Any calibration must be based on representative low/elevated/high corpus evidence and reviewed explicitly."])
        md_path = out_root / "qpdf-r7-capability-matrix.md"
        md_path.write_text("\n".join(md) + "\n", encoding="utf-8")
        log(f"JSON report: {json_path}")
        log(f"Markdown report: {md_path}")
        return 0 if all(case["acceptancePassed"] for case in cases) else 2
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
        handle = getattr(server, "_r7_log_handle", None) if server is not None else None
        if handle:
            handle.close()


if __name__ == "__main__":
    raise SystemExit(main())
