#!/usr/bin/env python3
"""Apply SafePDFHub F2-R.1 raw AES bulk-provider extension.

F2-R deliberately does NOT modify Pl_AES_PDF or any qpdf stream-buffering,
CBC-state, IV, padding, or finish/flush semantics.

It adds one optional bulk operation to QPDFCryptoImpl and gives the OpenSSL
provider a real EVP_Update implementation. The default implementation remains
16-byte-at-a-time and therefore preserves behavior for providers that do not
implement a bulk primitive.
"""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path("/src/qpdf")


def source_path(*candidates: str) -> Path:
    for rel in candidates:
        path = ROOT / rel
        if path.is_file():
            return path
    raise RuntimeError(
        "F2-R.1 qpdf source layout mismatch. Expected one of:\n"
        + "\n".join(f"  {candidate}" for candidate in candidates)
    )


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def write(path: Path, text: str) -> None:
    path.write_text(text, encoding="utf-8")


def require_exact(text: str, needle: str, label: str) -> None:
    count = text.count(needle)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one match, found {count}")


# ---------------------------------------------------------------------------
# 1. Add the bulk operation to qpdf's crypto-provider interface.
# ---------------------------------------------------------------------------
impl = source_path("include/qpdf/QPDFCryptoImpl.hh")
s = read(impl)

if "rijndael_process_buffer(" not in s:
    if "#include <cstring>" not in s:
        s = "#include <cstring>\n" + s
    if "#include <stdexcept>" not in s:
        s = "#include <stdexcept>\n" + s

    pattern = (
        r"(?P<indent>\s*)virtual void rijndael_process\(\s*"
        r"unsigned char\* in_data,\s*unsigned char\* out_data\) = 0;"
    )
    replacement = r"""\g<indent>virtual void rijndael_process(unsigned char* in_data, unsigned char* out_data) = 0;
\g<indent>// Optional bulk AES operation. The default implementation deliberately
\g<indent>// preserves qpdf's original 16-byte provider semantics.
\g<indent>virtual void rijndael_process_buffer(
\g<indent>    unsigned char const* in_data, unsigned char* out_data, size_t len)
\g<indent>{
\g<indent>    if ((len % rijndael_buf_size) != 0) {
\g<indent>        throw std::logic_error(
\g<indent>            "QPDFCryptoImpl: AES bulk length is not block aligned");
\g<indent>    }
\g<indent>    unsigned char block[rijndael_buf_size];
\g<indent>    for (size_t offset = 0; offset < len; offset += rijndael_buf_size) {
\g<indent>        std::memcpy(block, in_data + offset, rijndael_buf_size);
\g<indent>        rijndael_process(block, out_data + offset);
\g<indent>    }
\g<indent>}"""
    out, count = re.subn(pattern, replacement, s, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(
            "F2-R.1 QPDFCryptoImpl: could not locate rijndael_process declaration"
        )
    s = out
else:
    # Fresh qpdf is expected here. Refuse a pre-mutated source rather than
    # silently composing F2-R with the unsafe historical F2 pipeline patch.
    if "Pl_AES_PDF" in s and "F2-R" not in s:
        raise RuntimeError(
            "F2-R.1 refuses to continue on an already-mutated crypto interface; "
            "use a fresh qpdf source tree."
        )

write(impl, s)

# ---------------------------------------------------------------------------
# 2. Add the override declaration to the OpenSSL provider.
# ---------------------------------------------------------------------------
openssl_h = source_path("libqpdf/qpdf/QPDFCrypto_openssl.hh")
s = read(openssl_h)

if "rijndael_process_buffer(" not in s:
    if "#include <cstddef>" not in s and "#include <stddef.h>" not in s:
        s = "#include <cstddef>\n" + s

    pattern = (
        r"(?P<indent>\s*)void rijndael_process\(\s*"
        r"unsigned char\* in_data,\s*unsigned char\* out_data\) override;"
    )
    replacement = r"""\g<indent>void rijndael_process(unsigned char* in_data, unsigned char* out_data) override;
\g<indent>void rijndael_process_buffer(
\g<indent>    unsigned char const* in_data, unsigned char* out_data, size_t len) override;"""
    out, count = re.subn(pattern, replacement, s, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(
            "F2-R.1 OpenSSL header: could not locate rijndael_process declaration"
        )
    s = out

if "bool rijndael_encrypt" not in s:
    marker = "    EVP_CIPHER_CTX* const cipher_ctx;\n"
    if marker not in s:
        raise RuntimeError(
            "F2-R.1 OpenSSL header: cipher_ctx member anchor not found"
        )
    s = s.replace(
        marker,
        marker + "    bool rijndael_encrypt = false;\n",
        1,
    )

write(openssl_h, s)

# ---------------------------------------------------------------------------
# 3. Implement one EVP_EncryptUpdate / EVP_DecryptUpdate call.
# ---------------------------------------------------------------------------
openssl_cc = source_path("libqpdf/QPDFCrypto_openssl.cc")
s = read(openssl_cc)

if "#include <stdexcept>" not in s:
    s = "#include <stdexcept>\n" + s

if "this->rijndael_encrypt = encrypt;" not in s:
    pattern = r"(void\s+QPDFCrypto_openssl::rijndael_init\s*\([^)]*\)\s*\{)"
    out, count = re.subn(
        pattern,
        r"\1\n    this->rijndael_encrypt = encrypt;",
        s,
        count=1,
        flags=re.S,
    )
    if count != 1:
        raise RuntimeError(
            "F2-R.1 OpenSSL source: could not locate rijndael_init"
        )
    s = out

if "QPDFCrypto_openssl::rijndael_process_buffer" not in s:
    pattern = (
        r"(void\s+QPDFCrypto_openssl::rijndael_process\s*\(\s*"
        r"unsigned char\*\s+in_data,\s*unsigned char\*\s+out_data\s*\)"
        r"\s*\{.*?\n\})\s*"
        r"(void\s+QPDFCrypto_openssl::rijndael_finalize\s*\()"
    )
    replacement = r"""\1

void
QPDFCrypto_openssl::rijndael_process_buffer(
    unsigned char const* in_data, unsigned char* out_data, size_t len)
{
    if (len == 0) {
        return;
    }
    if ((len % QPDFCryptoImpl::rijndael_buf_size) != 0) {
        throw std::logic_error(
            "QPDFCrypto_openssl: AES bulk length is not block aligned");
    }

    // F2-R.1 is intentionally a provider-only experiment. qpdf's stream
    // pipeline is not changed, so this method is exercised only by the raw
    // correctness/performance harness until a separate bulk pipeline class is
    // proven against the original Pl_AES_PDF implementation.
    int const int_len = QIntC::to_int(len);
    int out_len = 0;
    if (this->rijndael_encrypt) {
        check_openssl(EVP_EncryptUpdate(
            this->cipher_ctx, out_data, &out_len, in_data, int_len));
    } else {
        check_openssl(EVP_DecryptUpdate(
            this->cipher_ctx, out_data, &out_len, in_data, int_len));
    }
    if (out_len != int_len) {
        throw std::logic_error(
            "QPDFCrypto_openssl: AES bulk update changed output length");
    }
}

\2"""
    out, count = re.subn(pattern, replacement, s, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(
            "F2-R.1 OpenSSL source: could not locate rijndael_process/finalize"
        )
    s = out

write(openssl_cc, s)

# ---------------------------------------------------------------------------
# 4. Hard safety gate: F2-R.1 must not touch Pl_AES_PDF.
# ---------------------------------------------------------------------------
aes_h = source_path("libqpdf/qpdf/Pl_AES_PDF.hh")
aes_cc = source_path("libqpdf/Pl_AES_PDF.cc")
for path in (aes_h, aes_cc):
    original_marker = "F2-R.1"
    text = read(path)
    if original_marker in text or "rijndael_process_buffer" in text:
        raise RuntimeError(
            f"F2-R.1 safety gate: {path} was already modified by a bulk pipeline patch"
        )

# The patch is intentionally small. These assertions make the build fail at
# the patch boundary if a qpdf source-layout change causes accidental drift.
require_exact(read(impl), "virtual void rijndael_process_buffer(", "F2-R.1 interface")
require_exact(read(openssl_h), "void rijndael_process_buffer(", "F2-R.1 OpenSSL declaration")
require_exact(read(openssl_cc), "QPDFCrypto_openssl::rijndael_process_buffer", "F2-R.1 OpenSSL implementation")

print("SafePDFHub F2-R.1 raw AES provider patch applied successfully.")
print("Safety gate: Pl_AES_PDF.hh and Pl_AES_PDF.cc remain unmodified.")
