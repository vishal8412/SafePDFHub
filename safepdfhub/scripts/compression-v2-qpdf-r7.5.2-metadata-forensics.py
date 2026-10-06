#!/usr/bin/env python3
"""Local-only metadata differential for R7.5.2 investigation.

The default report is privacy-safe: values are represented by SHA-256 digests
and lengths. Use --show-values only on trusted local PDFs when exact values are
needed to diagnose a specific certification mismatch.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

from pypdf import PdfReader

FIELDS = (
    "/Title",
    "/Author",
    "/Subject",
    "/Creator",
    "/Producer",
    "/Keywords",
    "/CreationDate",
    "/ModDate",
)


def value_info(value: Any, show_values: bool) -> dict[str, Any]:
    text = "" if value is None else str(value)
    result: dict[str, Any] = {
        "present": value is not None,
        "length": len(text),
        "sha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
    }
    if show_values:
        result["value"] = text
    return result


def metadata(path: Path, show_values: bool) -> dict[str, Any]:
    reader = PdfReader(str(path))
    info = reader.metadata or {}
    return {
        field: value_info(info.get(field), show_values)
        for field in FIELDS
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("candidate", type=Path)
    parser.add_argument("--show-values", action="store_true")
    args = parser.parse_args()

    source = metadata(args.source, args.show_values)
    candidate = metadata(args.candidate, args.show_values)
    fields = {
        field: {
            "matched": source[field] == candidate[field],
            "source": source[field],
            "candidate": candidate[field],
        }
        for field in FIELDS
    }
    mismatches = [field for field, result in fields.items() if not result["matched"]]

    print(json.dumps({
        "source": str(args.source),
        "candidate": str(args.candidate),
        "fields": fields,
        "mismatchedFields": mismatches,
        "metadataExact": not mismatches,
        "showValues": args.show_values,
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
