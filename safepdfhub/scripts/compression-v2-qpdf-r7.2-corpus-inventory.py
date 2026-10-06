#!/usr/bin/env python3
"""Inventory and integrity-audit the SafePDFHub R7.2 qpdf benchmark corpus.

This tool never changes production thresholds and never executes qpdf. It
correlates the acquisition plan/report with the files actually present,
validates PDF parseability with both pypdf and PyMuPDF, records size/page
boundary proximity, and reports provenance/parser disagreements without
inventing resource-risk classifications.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Any

try:
    import pymupdf
    from pypdf import PdfReader
except ModuleNotFoundError as exc:
    print(
        f"Missing R7.2 dependency: {exc.name}. Install the existing browser benchmark requirements.",
        file=sys.stderr,
    )
    raise SystemExit(2)

ROOT = Path(__file__).resolve().parents[1]
CORPUS_ROOT = ROOT / "benchmark-corpus" / "qpdf-r7"
MANIFEST = CORPUS_ROOT / "corpus-manifest.json"
ACQUISITION_PLAN = CORPUS_ROOT / "corpus-acquisition-plan.json"
ACQUISITION_REPORT = CORPUS_ROOT / "metadata" / "r7.2.1-acquisition-report.json"
AUTHORITATIVE_SHA = "775929bf05792007ae123b17ff6991007149055032fc9baa315afd79a3a74e3d"
MB = 1024 * 1024
THRESHOLDS = {
    "elevated": {
        "fileBytes": 8 * MB,
        "pages": 300,
        "streamBytes": 32 * MB,
        "imageBytes": 16 * MB,
        "objectCount": 10_000,
    },
    "high": {
        "fileBytes": 12 * MB,
        "pages": 1_000,
        "streamBytes": 64 * MB,
        "imageBytes": 32 * MB,
        "objectCount": 20_000,
    },
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def boundary_band(value: int, threshold: int) -> str:
    ratio = value / threshold
    if 0.75 <= ratio <= 1.25:
        return "near"
    if ratio < 0.75:
        return "below"
    return "above"


def classify_size_page(bytes_count: int, pages: int) -> str:
    high = (bytes_count >= 12 * MB and pages >= 500) or bytes_count >= 25 * MB or pages >= 1500
    if high:
        return "high-or-higher-by-size-page-signals"
    elevated = (bytes_count >= 8 * MB and pages >= 300) or bytes_count >= 12 * MB or pages >= 1000
    if elevated:
        return "elevated-or-higher-by-size-page-signals"
    return "low-by-size-page-signals"


def pypdf_probe(path: Path) -> dict[str, Any]:
    reader = PdfReader(str(path), strict=False)
    pages = len(reader.pages)
    forms = 0
    annotations = 0
    images = 0
    text_pages = 0
    try:
        forms = len(reader.get_fields() or {})
    except Exception:
        forms = 0
    for page in reader.pages:
        annots = page.get("/Annots")
        if annots:
            annotations += len(annots)
        resources = page.get("/Resources")
        if resources:
            xobjects = resources.get("/XObject")
            if xobjects:
                for ref in xobjects.values():
                    try:
                        obj = ref.get_object()
                        if obj.get("/Subtype") == "/Image":
                            images += 1
                    except Exception:
                        pass
        try:
            if (page.extract_text() or "").strip():
                text_pages += 1
        except Exception:
            pass
    return {
        "ok": True,
        "pages": pages,
        "textPages": text_pages,
        "imageReferences": images,
        "annotations": annotations,
        "formFields": forms,
    }


def pymupdf_probe(path: Path) -> dict[str, Any]:
    document = pymupdf.open(str(path))
    try:
        pages = len(document)
        text_pages = 0
        for index in range(pages):
            try:
                if document[index].get_text("text").strip():
                    text_pages += 1
            except Exception:
                pass
        return {"ok": True, "pages": pages, "textPages": text_pages}
    finally:
        document.close()


def declared_records(manifest: dict[str, Any], plan: dict[str, Any], report: dict[str, Any]) -> dict[str, dict[str, Any]]:
    records: dict[str, dict[str, Any]] = {}
    for source in plan.get("sources", []):
        if isinstance(source, dict) and source.get("id"):
            records[source["id"]] = {**source}
    for document in manifest.get("documents", []):
        if isinstance(document, dict) and document.get("id"):
            records[document["id"]] = {**records.get(document["id"], {}), **document}
    for record in report.get("records", []):
        if isinstance(record, dict) and record.get("id"):
            records[record["id"]] = {**records.get(record["id"], {}), **record}
    return records


def path_to_declared_id(path: str, declarations: dict[str, dict[str, Any]]) -> str | None:
    normalized = path.replace("\\", "/")
    for identifier, record in declarations.items():
        declared_path = str(record.get("path", "")).replace("\\", "/")
        if declared_path and normalized == declared_path:
            return identifier
        if declared_path and normalized.endswith("/" + declared_path):
            return identifier
        expected = Path(declared_path).name if declared_path else ""
        if expected and Path(normalized).name == expected:
            return identifier
    return None


def expected_sha(identifier: str | None, declarations: dict[str, dict[str, Any]]) -> str | None:
    if not identifier:
        return None
    value = declarations.get(identifier, {}).get("sha256Published")
    return value.lower() if isinstance(value, str) else None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--corpus-dir", default=str(CORPUS_ROOT))
    parser.add_argument("--manifest", default=str(MANIFEST))
    parser.add_argument("--output", default=None)
    args = parser.parse_args()

    corpus_dir = Path(args.corpus_dir).resolve()
    manifest_path = Path(args.manifest).resolve()
    if not corpus_dir.is_dir():
        print(f"Corpus directory not found: {corpus_dir}", file=sys.stderr)
        return 1

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    plan = json.loads(ACQUISITION_PLAN.read_text(encoding="utf-8")) if ACQUISITION_PLAN.exists() else {}
    report = json.loads(ACQUISITION_REPORT.read_text(encoding="utf-8")) if ACQUISITION_REPORT.exists() else {}
    declarations = declared_records(manifest, plan, report)

    paths = sorted(p for p in corpus_dir.rglob("*.pdf") if p.is_file())
    records: list[dict[str, Any]] = []
    for path in paths:
        relative = path.relative_to(corpus_dir).as_posix()
        identifier = path_to_declared_id(relative, declarations)
        file_sha = sha256(path)
        if file_sha.lower() == AUTHORITATIVE_SHA:
            identifier = "authoritative-15mb-842p"
        record: dict[str, Any] = {
            "id": identifier,
            "path": relative,
            "sha256": file_sha,
            "bytes": path.stat().st_size,
            "provenance": "declared" if identifier else "undeclared",
            "publishedSha256Match": None,
            "authoritativeBaseline": file_sha.lower() == AUTHORITATIVE_SHA,
        }
        expected = expected_sha(identifier, declarations)
        if identifier == "authoritative-15mb-842p" and not expected:
            expected = AUTHORITATIVE_SHA
        if expected:
            record["publishedSha256Match"] = record["sha256"].lower() == expected

        try:
            py = pypdf_probe(path)
            record["pypdf"] = py
        except Exception as exc:
            record["pypdf"] = {"ok": False, "errorType": type(exc).__name__, "error": str(exc)}

        try:
            mu = pymupdf_probe(path)
            record["pymupdf"] = mu
        except Exception as exc:
            record["pymupdf"] = {"ok": False, "errorType": type(exc).__name__, "error": str(exc)}

        py_ok = bool(record["pypdf"].get("ok"))
        mu_ok = bool(record["pymupdf"].get("ok"))
        record["parseStatus"] = (
            "both-parsers-pass" if py_ok and mu_ok else
            "pypdf-only" if py_ok else
            "pymupdf-only" if mu_ok else
            "both-parsers-failed"
        )
        if py_ok:
            pages = int(record["pypdf"]["pages"])
            record.update({
                "pages": pages,
                "textPages": record["pypdf"]["textPages"],
                "imageReferences": record["pypdf"]["imageReferences"],
                "annotations": record["pypdf"]["annotations"],
                "formFields": record["pypdf"]["formFields"],
                "sizePageClassification": classify_size_page(record["bytes"], pages),
                "boundaryProximity": {
                    "8MiB": boundary_band(record["bytes"], 8 * MB),
                    "12MiB": boundary_band(record["bytes"], 12 * MB),
                    "25MiB": boundary_band(record["bytes"], 25 * MB),
                    "300Pages": boundary_band(pages, 300),
                    "500Pages": boundary_band(pages, 500),
                    "1000Pages": boundary_band(pages, 1000),
                    "1500Pages": boundary_band(pages, 1500),
                },
            })
            if mu_ok:
                mu_pages = int(record["pymupdf"]["pages"])
                record["parserPageCounts"] = {"pypdf": pages, "pymupdf": mu_pages}
                record["parserDisagreement"] = "PAGE_COUNT_MISMATCH" if mu_pages != pages else None
            else:
                record["parserPageCounts"] = {"pypdf": pages, "pymupdf": None}
                record["parserDisagreement"] = None
        elif mu_ok:
            mu_pages = int(record["pymupdf"]["pages"])
            record["parserPageCounts"] = {"pypdf": None, "pymupdf": mu_pages}
            record["parserDisagreement"] = None
        else:
            record["parserPageCounts"] = {"pypdf": None, "pymupdf": None}
            record["parserDisagreement"] = "BOTH_PARSERS_FAILED"

        if record.get("authoritativeBaseline"):
            record["authoritativeIdentity"] = {
                "sha256": AUTHORITATIVE_SHA,
                "expectedBytes": 15_513_995,
                "expectedPages": 842,
                "bytesMatch": record["bytes"] == 15_513_995,
                "pagesMatch": int(record.get("pages") or record.get("pymupdf", {}).get("pages") or 0) == 842,
                "identityPassed": record["bytes"] == 15_513_995 and int(record.get("pages") or record.get("pymupdf", {}).get("pages") or 0) == 842,
            }
        record["forensicSignals"] = (
            "not-available-in-inventory; authoritative resourceRisk requires SafePDFHub forensic analyzer telemetry"
        )
        records.append(record)

    observed_paths = {r["path"] for r in records}
    declared_paths = {
        str(v.get("path", "")).replace("\\", "/")
        for v in declarations.values()
        if v.get("path")
    }
    missing_declared_paths = sorted(path for path in declared_paths if not any(
        p == path or p.endswith("/" + path) for p in observed_paths
    ))
    undeclared = sorted(r["path"] for r in records if not r.get("id"))

    both_pass = sum(r["parseStatus"] == "both-parsers-pass" for r in records)
    both_fail = sum(r["parseStatus"] == "both-parsers-failed" for r in records)
    pypdf_only = sum(r["parseStatus"] == "pypdf-only" for r in records)
    pymupdf_only = sum(r["parseStatus"] == "pymupdf-only" for r in records)
    sha_mismatch = sum(r.get("publishedSha256Match") is False for r in records)
    summary = {
        "documents": len(records),
        "parseErrors": both_fail,
        "pypdfOnly": pypdf_only,
        "pymupdfOnly": pymupdf_only,
        "bothParsersPass": both_pass,
        "parserDisagreements": sum(r.get("parserDisagreement") == "PAGE_COUNT_MISMATCH" for r in records),
        "trueParserDisagreements": sum(r.get("parserDisagreement") == "PAGE_COUNT_MISMATCH" for r in records),
        "pypdfFailures": sum(not bool(r.get("pypdf", {}).get("ok")) for r in records),
        "pymupdfFailures": sum(not bool(r.get("pymupdf", {}).get("ok")) for r in records),
        "publishedSha256Mismatches": sha_mismatch,
        "declaredDocuments": len(declarations),
        "missingDeclared": len(missing_declared_paths),
        "undeclared": len(undeclared),
        "sizePageLow": sum(r.get("sizePageClassification") == "low-by-size-page-signals" for r in records),
        "sizePageElevatedOrHigher": sum(r.get("sizePageClassification") == "elevated-or-higher-by-size-page-signals" for r in records),
        "sizePageHighOrHigher": sum(r.get("sizePageClassification") == "high-or-higher-by-size-page-signals" for r in records),
        "forensicRiskClassificationAvailable": False,
        "calibrationEligibleFromInventory": False,
        "authoritativeBaselineCount": sum(1 for r in records if r.get("authoritativeBaseline")),
        "authoritativeBaselineIdentityPassed": all(
            r.get("authoritativeIdentity", {}).get("identityPassed") is True
            for r in records if r.get("authoritativeBaseline")
        ) and any(r.get("authoritativeBaseline") for r in records),
    }
    report_out = {
        "version": 2,
        "benchmark": "SafePDFHub Compression V2 — QPDF-R7.2 Corpus Inventory",
        "mode": "inventory-only; no qpdf execution; no threshold changes",
        "thresholds": THRESHOLDS,
        "summary": summary,
        "missingDeclared": missing_declared_paths,
        "undeclared": undeclared,
        "records": records,
        "parserSemantics": {
            "bothParsersPass": "both parser stacks succeed; page counts must agree",
            "pypdfOnly": "pypdf succeeds and PyMuPDF fails; compatibility fallback, not disagreement",
            "pymupdfOnly": "PyMuPDF succeeds and pypdf fails; compatibility fallback, not disagreement",
            "bothParsersFailed": "hard corpus failure; document is unusable for benchmark",
            "trueDisagreement": "both parsers succeed but authoritative comparable page counts differ"
        },
        "requiredEvidence": {
            "low": 5,
            "elevated": 8,
            "high": 5,
            "boundary": 12,
            "independentForensicSignals": ["fileBytes", "pages", "streamBytes", "imageBytes", "objectCount"],
            "qpdfOutcomes": ["attempted", "blocked", "oom", "smaller-certified", "attempted-no-certified-smaller"],
        },
    }
    output = Path(args.output).resolve() if args.output else corpus_dir / "r7.2-corpus-inventory.json"
    output.write_text(json.dumps(report_out, indent=2), encoding="utf-8")
    print(f"R7.2 corpus inventory: {len(records)} PDF(s)")
    print(f"Both parsers pass: {both_pass}")
    print(f"pypdf-only: {pypdf_only}")
    print(f"PyMuPDF-only: {pymupdf_only}")
    print(f"Both parsers failed: {both_fail}")
    print(f"Parser disagreements: {summary['parserDisagreements']}")
    print(f"Declared missing: {summary['missingDeclared']}")
    print(f"Undeclared: {summary['undeclared']}")
    print("Calibration eligible from inventory: NO")
    print(f"Report: {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
