#!/usr/bin/env python3
"""Create the isolated F2-R.2 qpdf candidate tree and patch script."""
from __future__ import annotations

import re
import shutil
import subprocess
from pathlib import Path

SOURCE = Path('/src/qpdf')
CANDIDATE = Path('/src/qpdf-f2r2-candidate')
FROZEN = Path('/src/safepdfhub-patches/apply-bulk-aes.py.frozen')
CANDIDATE_PATCH = Path('/src/safepdfhub-patches/apply-bulk-aes-f2r2-candidate.py')

if not SOURCE.is_dir():
    raise RuntimeError(f'F2-R.2 source tree is missing: {SOURCE}')
if CANDIDATE.exists():
    shutil.rmtree(CANDIDATE)

print('F2-R.2: copying pristine F2-R.1 qpdf source tree')
shutil.copytree(
    SOURCE,
    CANDIDATE,
    ignore=shutil.ignore_patterns('build', 'build-*', '.git'),
)

text = FROZEN.read_text(encoding='utf-8')
text = text.replace(
    'ROOT = Path("/src/qpdf")',
    'ROOT = Path("/src/qpdf-f2r2-candidate")',
    1,
)
text = text.replace(
    "ROOT = Path('/src/qpdf')",
    "ROOT = Path('/src/qpdf-f2r2-candidate')",
    1,
)

# F2-R.2 correction 1:
# The enlarged pipeline buffer changes finish() so the final call to flush()
# may contain one AES block (or another block-aligned tail) rather than a full
# 256 KiB pipeline chunk. The original qpdf assertion must therefore accept
# both full chunks and non-zero AES-block-aligned final chunks.
anchor = 'aes_cc = source_path("libqpdf/Pl_AES_PDF.cc")\ns = read(aes_cc)\n'
injection = '''aes_cc = source_path("libqpdf/Pl_AES_PDF.cc")
s = read(aes_cc)

# F2-R.2: accept full pipeline chunks and block-aligned final chunks.
_flush_assert_old = 'util::assertion(offset == buf_size, "AES pipeline: flush called when buffer was not full");'
_flush_assert_new = (
    'util::assertion(\\n'
    '        offset == buf_size || (offset != 0 && (offset % block_size) == 0),\\n'
    '        "AES pipeline: flush called with a non-block-aligned buffer");'
)
if _flush_assert_old not in s:
    raise RuntimeError(
        "F2-R.2 candidate flush assertion: original qpdf assertion anchor not found"
    )
s = s.replace(_flush_assert_old, _flush_assert_new, 1)
'''
if anchor not in text:
    raise RuntimeError('F2-R.2 candidate: Pl_AES_PDF.cc insertion anchor not found')
text = text.replace(anchor, injection, 1)

# F2-R.2 correction 2:
# The frozen final validation accidentally counts `bytes` declarations across
# the whole translation unit. Validate the declaration only inside flush().
old_validation = '''if not re.search(r"size_t\\s+bytes\\s*=\\s*this->offset\\s*;", aes_cc_final):
    raise RuntimeError(
        "F2 final validation: flush() does not derive encrypted length from offset"
    )
if len(re.findall(r"(?m)^\\s*(?:unsigned\\s+int|size_t)\\s+bytes\\s*=", aes_cc_final)) != 1:
    raise RuntimeError(
        "F2 final validation: flush() must contain exactly one function-scope bytes declaration"
    )
'''
new_validation = '''flush_final_start, flush_final_end = locate_function_body(
    aes_cc_final,
    r"void\\s+Pl_AES_PDF::flush\\s*\\(\\s*bool\\s+strip_padding\\s*\\)",
    "F2 final validation flush scope",
)
flush_final_body = aes_cc_final[flush_final_start:flush_final_end]
if not re.search(r"size_t\\s+bytes\\s*=\\s*this->offset\\s*;", flush_final_body):
    raise RuntimeError(
        "F2 final validation: flush() does not derive encrypted length from offset"
    )
if len(re.findall(r"(?m)^\\s*(?:unsigned\\s+int|size_t)\\s+bytes\\s*=", flush_final_body)) != 1:
    raise RuntimeError(
        "F2 final validation: flush() must contain exactly one function-scope bytes declaration"
    )
if not re.search(
    r"util::assertion\\(\\s*offset\\s*==\\s*buf_size\\s*\\|\\|\\s*\\(offset\\s*!=\\s*0\\s*&&\\s*\\(offset\\s*%\\s*block_size\\)\\s*==\\s*0\\s*\\)",
    flush_final_body,
    flags=re.S,
):
    raise RuntimeError(
        "F2-R.2 final validation: flush() does not accept block-aligned partial final chunks"
    )
'''
if old_validation not in text:
    raise RuntimeError('F2-R.2 candidate: final validation anchor not found')
text = text.replace(old_validation, new_validation, 1)

CANDIDATE_PATCH.write_text(text, encoding='utf-8')

print('F2-R.2: applying isolated F2 candidate transformation only to the copy')
subprocess.run(['python3', str(CANDIDATE_PATCH)], check=True)

# F2-R.2 correction 3:
# The frozen F2 patch attempts to normalize an IV-size comparison written as
# `bytes != buf_size`, but qpdf 12.4.x Pl_AES_PDF::setIV() uses an assertion
# written as `bytes == buf_size`. Because buf_size is enlarged by F2, that
# assertion would incorrectly require a 256 KiB IV instead of the AES 16-byte
# IV. Candidate-only fix: change only the setIV() assertion to block_size.

def _locate_function_body(source: str, signature_pattern: str, label: str) -> tuple[int, int]:
    match = re.search(signature_pattern, source, flags=re.S)
    if not match:
        raise RuntimeError(f"{label}: could not locate function signature")
    brace_start = source.find('{', match.end())
    if brace_start < 0:
        raise RuntimeError(f"{label}: could not locate opening brace")
    depth = 0
    i = brace_start
    state = 'code'
    while i < len(source):
        ch = source[i]
        nxt = source[i + 1] if i + 1 < len(source) else ''
        if state == 'code':
            if ch == '/' and nxt == '/':
                state = 'line_comment'; i += 2; continue
            if ch == '/' and nxt == '*':
                state = 'block_comment'; i += 2; continue
            if ch == '"':
                state = 'string'; i += 1; continue
            if ch == "'":
                state = 'char'; i += 1; continue
            if ch == '{':
                depth += 1
            elif ch == '}':
                depth -= 1
                if depth == 0:
                    return brace_start, i + 1
            i += 1
            continue
        if state == 'line_comment':
            if ch == '\n': state = 'code'
            i += 1; continue
        if state == 'block_comment':
            if ch == '*' and nxt == '/': state = 'code'; i += 2; continue
            i += 1; continue
        if state == 'string':
            if ch == '\\': i += 2; continue
            if ch == '"': state = 'code'
            i += 1; continue
        if state == 'char':
            if ch == '\\': i += 2; continue
            if ch == "'": state = 'code'
            i += 1; continue
    raise RuntimeError(f"{label}: unterminated function body")

_candidate_aes_cc = CANDIDATE / 'libqpdf/Pl_AES_PDF.cc'
_candidate_source = _candidate_aes_cc.read_text(encoding='utf-8')

_setiv_signature = r"void\s+Pl_AES_PDF::setIV\s*\(\s*unsigned\s+char\s+const\*\s+iv\s*,\s*size_t\s+bytes\s*\)"
_setiv_start, _setiv_end = _locate_function_body(
    _candidate_source,
    _setiv_signature,
    'F2-R.2 candidate setIV scope before correction',
)
_setiv_body = _candidate_source[_setiv_start:_setiv_end]

# qpdf 12.4.x uses an assertion of the form `bytes == buf_size`. After F2
# enlarges buf_size, that is the wrong semantic quantity for an AES IV.
_setiv_old_guard = 'bytes == buf_size'
_setiv_new_guard = 'bytes == this->block_size'
_setiv_old_count = len(re.findall(r"\bbytes\s*==\s*buf_size\b", _setiv_body))
if _setiv_old_count != 1:
    raise RuntimeError(
        'F2-R.2 candidate setIV correction: expected exactly one `bytes == buf_size` guard, '
        f'found {_setiv_old_count}.\nObserved setIV body before correction:\n{_setiv_body}'
    )
_setiv_body_fixed = re.sub(
    r"\bbytes\s*==\s*buf_size\b",
    _setiv_new_guard,
    _setiv_body,
    count=1,
)
_candidate_source = (
    _candidate_source[:_setiv_start] +
    _setiv_body_fixed +
    _candidate_source[_setiv_end:]
)
_candidate_aes_cc.write_text(_candidate_source, encoding='utf-8')

_setiv_start, _setiv_end = _locate_function_body(
    _candidate_source,
    _setiv_signature,
    'F2-R.2 candidate setIV scope after correction',
)
_setiv_body = _candidate_source[_setiv_start:_setiv_end]
_setiv_fixed_count = len(
    re.findall(r"\bbytes\s*==\s*this->block_size\b", _setiv_body)
)
_setiv_remaining_buf_count = len(
    re.findall(r"\bbytes\s*==\s*buf_size\b", _setiv_body)
)
if _setiv_fixed_count != 1 or _setiv_remaining_buf_count != 0:
    raise RuntimeError(
        'F2-R.2 candidate setIV validation: expected exactly one block-size assertion '
        f'and no buf_size assertion; found block_size={_setiv_fixed_count}, '
        f'buf_size={_setiv_remaining_buf_count}.\nObserved setIV body:\n{_setiv_body}'
    )
print('F2-R.2 candidate setIV guard: normalized to AES block_size (16 bytes)')

# Hard safety boundary: reference source remains present and separate.
for rel in ('libqpdf/qpdf/Pl_AES_PDF.hh', 'libqpdf/Pl_AES_PDF.cc'):
    if not (SOURCE / rel).is_file():
        raise RuntimeError(f'F2-R.2 reference source unexpectedly missing: {rel}')

print('F2-R.2 candidate patch applied successfully.')
print('F2-R.2 safety boundary: /src/qpdf remains the untouched reference tree.')
