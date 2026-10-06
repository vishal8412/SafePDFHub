#!/usr/bin/env python3
"""Acquire declared public PDFs for the SafePDFHub R7.2.1 corpus.

This tool downloads only URLs declared in corpus-acquisition-plan.json, verifies
PDF magic bytes and optional expected byte counts, computes SHA-256, and writes
acquisition metadata. It never executes qpdf and never changes production
thresholds. The actual PDFs are benchmark inputs and are intentionally excluded
from release ZIPs by the corpus packaging policy.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
PLAN = ROOT / "benchmark-corpus" / "qpdf-r7" / "corpus-acquisition-plan.json"
CORPUS = ROOT / "benchmark-corpus" / "qpdf-r7"
MAX_BYTES = 120_000_000
USER_AGENT = "SafePDFHub-R7.2.1-Corpus-Acquisition/1.0"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download(url: str, destination: Path, max_bytes: int) -> tuple[int, str]:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/pdf,*/*;q=0.8"})
    with urllib.request.urlopen(request, timeout=90) as response:
        total = 0
        with destination.open("wb") as handle:
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > max_bytes:
                    raise RuntimeError(f"download exceeds safety limit of {max_bytes} bytes")
                handle.write(chunk)
    if total < 5 or destination.read_bytes()[:5] != b"%PDF-":
        raise RuntimeError("downloaded artifact does not begin with %PDF-")
    return total, sha256(destination)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", default=str(PLAN))
    parser.add_argument("--corpus-dir", default=str(CORPUS))
    parser.add_argument("--ids", nargs="*", help="optional source IDs; default downloads every public URL in the plan")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--max-bytes", type=int, default=MAX_BYTES)
    args = parser.parse_args()

    plan_path = Path(args.plan).resolve()
    corpus_dir = Path(args.corpus_dir).resolve()
    plan = json.loads(plan_path.read_text(encoding="utf-8"))
    sources: list[dict[str, Any]] = plan.get("sources", [])
    selected = {item for item in (args.ids or [])}
    records: list[dict[str, Any]] = []

    for source in sources:
        source_id = source.get("id")
        if selected and source_id not in selected:
            continue
        url = source.get("url")
        if not url:
            records.append({"id": source_id, "status": "local-user-supplied", "url": None})
            continue
        relative = source_id + ".pdf"
        destination = corpus_dir / "acquired" / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        record: dict[str, Any] = {"id": source_id, "url": url, "path": destination.relative_to(corpus_dir).as_posix()}
        if args.dry_run:
            record["status"] = "planned"
            records.append(record)
            continue
        try:
            if destination.exists():
                record["status"] = "already-present"
                record["bytes"] = destination.stat().st_size
                record["sha256"] = sha256(destination)
            else:
                started = time.monotonic()
                bytes_count, digest = download(url, destination, args.max_bytes)
                record["status"] = "downloaded"
                record["bytes"] = bytes_count
                record["sha256"] = digest
                record["durationMs"] = round((time.monotonic() - started) * 1000, 2)
            expected = source.get("bytesPublished")
            if expected is not None and record.get("bytes") != expected:
                record["status"] = "size-mismatch"
                record["expectedBytes"] = expected
        except (urllib.error.URLError, TimeoutError, OSError, RuntimeError) as exc:
            record["status"] = "failed"
            record["error"] = str(exc)
        records.append(record)

    report = {
        "version": 1,
        "benchmark": "SafePDFHub Compression V2 — QPDF-R7.2.1 Corpus Acquisition",
        "mode": "public-source acquisition only; no qpdf execution; no threshold changes",
        "records": records,
        "summary": {
            "selected": len(records),
            "downloaded": sum(r.get("status") == "downloaded" for r in records),
            "alreadyPresent": sum(r.get("status") == "already-present" for r in records),
            "failed": sum(r.get("status") == "failed" for r in records),
            "sizeMismatch": sum(r.get("status") == "size-mismatch" for r in records),
            "localUserSupplied": sum(r.get("status") == "local-user-supplied" for r in records),
        },
    }
    output = corpus_dir / "metadata" / "r7.2.1-acquisition-report.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report["summary"], indent=2))
    print(f"Report: {output}")
    return 0 if report["summary"]["failed"] == 0 and report["summary"]["sizeMismatch"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
