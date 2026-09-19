#!/usr/bin/env python3
"""Apply SafePDFHub F3 profiling hooks on top of the F2 qpdf patch."""
from __future__ import annotations

from pathlib import Path
import re

ROOT = Path("/src/qpdf")


def source_path(*candidates: str) -> Path:
    for rel in candidates:
        p = ROOT / rel
        if p.is_file():
            return p
    raise RuntimeError(
        "qpdf source layout mismatch while applying F3.\nExpected one of:\n"
        + "\n".join(f"  {c}" for c in candidates)
    )


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def write(path: Path, text: str) -> None:
    path.write_text(text, encoding="utf-8")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one anchor, found {count}")
    return text.replace(old, new, 1)


def assert_contains(text: str, needle: str, label: str) -> None:
    if needle not in text:
        raise RuntimeError(f"{label}: expected generated source to contain {needle!r}")


# qpdf 12.4.1:
#   libqpdf/qpdf/Pl_AES_PDF.hh
#   libqpdf/Pl_AES_PDF.cc
hh = source_path("libqpdf/qpdf/Pl_AES_PDF.hh")
cc = source_path("libqpdf/Pl_AES_PDF.cc")

s = read(hh)
if "bool f3_profile_enabled = false;" not in s:
    pattern = r"(\s*unsigned char\s+specified_iv\s*\[\s*block_size\s*\]\s*;)"
    replacement = r"\1\n    bool f3_profile_enabled = false;"
    s = re.sub(pattern, replacement, s, count=1)
    if "bool f3_profile_enabled = false;" not in s:
        raise RuntimeError("F3 cached profiling flag member: specified_iv anchor not found")
write(hh, s)

s = read(cc)
for inc in ("#include <chrono>\n", "#include <cstdio>\n", "#include <cstdlib>\n"):
    if inc.strip() not in s:
        s = inc + s

if "QPDF_F3_PROFILE" not in s:
    # Match the constructor by its qualified name, not by a generic first '{'.
    pattern = r"(Pl_AES_PDF::Pl_AES_PDF\s*\([\s\S]*?\)\s*(?::\s*[\s\S]*?)?\{)"
    replacement = (
        r"\1\n"
        "    this->f3_profile_enabled = []() {\n"
        "        char const* value = std::getenv(\"QPDF_F3_PROFILE\");\n"
        "        return value != nullptr && value[0] == '1';\n"
        "    }();"
    )
    s2, count = re.subn(pattern, replacement, s, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(
            "F3 constructor anchor: expected exactly one Pl_AES_PDF constructor"
        )
    s = s2

old = """this->crypto->rijndael_process_buffer(
        this->inbuf.get(), this->outbuf.get(), this->buf_size);"""

if "SAFEPDFHUB_F3_AES provider=" not in s:
    if s.count(old) != 1:
        raise RuntimeError(
            "F3 bulk profiling anchor: expected exactly one F2 bulk call; "
            f"found {s.count(old)}"
        )

    new = """if (this->f3_profile_enabled) {
        auto const f3_started = std::chrono::steady_clock::now();
        this->crypto->rijndael_process_buffer(
            this->inbuf.get(), this->outbuf.get(), bytes);
        auto const f3_finished = std::chrono::steady_clock::now();
        auto const f3_us = std::chrono::duration_cast<std::chrono::microseconds>(
            f3_finished - f3_started).count();
        char const* provider = std::getenv("QPDF_CRYPTO_PROVIDER");
        std::printf(
            "SAFEPDFHUB_F3_AES provider=%s mode=bulk bytes=%zu elapsed_us=%lld calls=1\\n",
            provider ? provider : "default",
            bytes,
            static_cast<long long>(f3_us));
    } else {
        this->crypto->rijndael_process_buffer(
            this->inbuf.get(), this->outbuf.get(), bytes);
    }"""
    s = s.replace(old, new, 1)

assert_contains(read(hh), "bool f3_profile_enabled", "F3 profile flag")
assert_contains(s, "QPDF_F3_PROFILE", "F3 environment probe")
assert_contains(s, "SAFEPDFHUB_F3_AES provider=", "F3 telemetry")
assert_contains(s, "this->inbuf.get(), this->outbuf.get(), bytes", "F3 actual flush length")
assert_contains(s, "bytes,", "F3 telemetry byte count")
write(cc, s)

print("SafePDFHub F3 profiling patch applied successfully.")
