#!/usr/bin/env python3
"""Validate the SafePDFHub qpdf performance artifact contract.

Important: optimized Emscripten builds may minify the *internal* WebAssembly
export names (for example ``ia``, ``ja`` ...). Those names are not the public
JavaScript API and therefore must not be treated as a missing-export failure.
The public contract is the Emscripten Module API exposed by qpdf-performance.js.
"""
from __future__ import annotations

import sys
from pathlib import Path

REQUIRED = (
    "safepdfhubF3RawAesBenchmark",
    "safepdfhubF3RawAesChecksum",
    "safepdfhubF2RRawAesCompare",
)
FACTORY = "SafePDFHubQpdfFactory"


def validate_wasm_header(path: Path) -> int:
    data = path.read_bytes()
    if len(data) < 8:
        raise ValueError(f"WASM is too small: {len(data)} bytes")
    if data[:4] != b"\x00asm":
        raise ValueError("invalid WebAssembly magic header")
    if data[4:8] != b"\x01\x00\x00\x00":
        raise ValueError("unsupported/invalid WebAssembly binary version")
    return len(data)


def validate_js_contract(path: Path) -> None:
    text = path.read_text(encoding="utf-8")

    missing = [name for name in REQUIRED if name not in text]
    if missing:
        raise ValueError(
            "generated JavaScript is missing required public raw-AES export names: "
            + ", ".join(missing)
        )

    if FACTORY not in text:
        raise ValueError(
            f"generated JavaScript is missing the Emscripten factory export: {FACTORY}"
        )

    # The worker calls Emscripten's Module._<C symbol> API. Requiring the
    # underscored names here catches accidental changes to the generated
    # public API while remaining independent of internal WASM name minification.
    missing_module_symbols = [
        "_" + name for name in REQUIRED if ("_" + name) not in text
    ]
    if missing_module_symbols:
        raise ValueError(
            "generated JavaScript is missing required Emscripten Module symbols: "
            + ", ".join(missing_module_symbols)
        )


def main() -> int:
    if len(sys.argv) != 3:
        print(
            "usage: validate-wasm-exports.py <qpdf-performance.wasm> <qpdf-performance.js>",
            file=sys.stderr,
        )
        return 2

    wasm = Path(sys.argv[1])
    js = Path(sys.argv[2])

    if not wasm.is_file():
        print(f"Missing WASM artifact: {wasm}", file=sys.stderr)
        return 1
    if not js.is_file():
        print(f"Missing JavaScript artifact: {js}", file=sys.stderr)
        return 1

    try:
        wasm_bytes = validate_wasm_header(wasm)
        validate_js_contract(js)
    except (OSError, UnicodeError, ValueError) as exc:
        print(f"SafePDFHub qpdf performance artifact validation FAILED: {exc}", file=sys.stderr)
        return 1

    print("SafePDFHub qpdf performance artifact contract validated:")
    print(f"  WASM: {wasm_bytes:,} bytes; valid WebAssembly header/version")
    print(f"  JS:   {js.stat().st_size:,} bytes; public Emscripten API present")
    for name in REQUIRED:
        print(f"  RAW:  {name}")
    print(f"  Factory: {FACTORY}")
    print("  Note: internal WASM export names may be minified by Emscripten; that is expected and is not a failure.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
