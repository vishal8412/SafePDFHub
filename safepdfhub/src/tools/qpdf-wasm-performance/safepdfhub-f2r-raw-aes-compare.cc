#include <qpdf/QPDFCryptoProvider.hh>
#include <qpdf/QPDFCryptoImpl.hh>
#include <emscripten/emscripten.h>
#include <chrono>
#include <cstddef>
#include <cstring>
#include <memory>
#include <stdexcept>
#include <vector>

namespace {
std::shared_ptr<QPDFCryptoImpl> get_crypto(int provider_id)
{
    switch (provider_id) {
    case 0:
        return QPDFCryptoProvider::getImpl("openssl");
    case 1:
        return QPDFCryptoProvider::getImpl("native");
    default:
        throw std::invalid_argument("SafePDFHub F2-R.1: unknown crypto provider id");
    }
}

std::vector<unsigned char> run_aes(
    std::shared_ptr<QPDFCryptoImpl> const& crypto,
    int bits,
    int chunk_size,
    size_t total_bytes,
    bool bulk)
{
    std::vector<unsigned char> input(static_cast<size_t>(chunk_size));
    std::vector<unsigned char> output(total_bytes);
    for (size_t i = 0; i < input.size(); ++i) {
        input[i] = static_cast<unsigned char>((i * 131U + 17U) & 0xffU);
    }

    unsigned char key[32] = {};
    unsigned char iv[16] = {};
    for (size_t i = 0; i < sizeof(key); ++i) {
        key[i] = static_cast<unsigned char>((i * 29U + 3U) & 0xffU);
    }
    for (size_t i = 0; i < sizeof(iv); ++i) {
        iv[i] = static_cast<unsigned char>((i * 47U + 11U) & 0xffU);
    }

    crypto->rijndael_init(true, key, static_cast<size_t>(bits / 8), true, iv);

    size_t processed = 0;
    while (processed < total_bytes) {
        size_t const remaining = total_bytes - processed;
        size_t const bytes = remaining >= static_cast<size_t>(chunk_size)
            ? static_cast<size_t>(chunk_size)
            : (remaining & ~static_cast<size_t>(15));
        if (bytes == 0) {
            throw std::logic_error("F2-R.1 comparison: non-block-aligned remainder");
        }

        if (bulk) {
            crypto->rijndael_process_buffer(input.data(), output.data() + processed, bytes);
        } else {
            unsigned char block[QPDFCryptoImpl::rijndael_buf_size];
            for (size_t offset = 0; offset < bytes; offset += QPDFCryptoImpl::rijndael_buf_size) {
                std::memcpy(block, input.data() + offset, sizeof(block));
                crypto->rijndael_process(block, output.data() + processed + offset);
            }
        }
        processed += bytes;
    }

    crypto->rijndael_finalize();
    return output;
}

unsigned int checksum(std::vector<unsigned char> const& bytes)
{
    unsigned int result = 0;
    if (!bytes.empty()) {
        result = static_cast<unsigned int>(bytes.front())
            ^ (static_cast<unsigned int>(bytes.back()) << 8)
            ^ (static_cast<unsigned int>(bytes[bytes.size() / 2]) << 16);
    }
    return result;
}
}

extern "C" {

EMSCRIPTEN_KEEPALIVE
double safepdfhubF2RRawAesCompare(
    int provider_id,
    int bits,
    int chunk_size,
    int total_mib)
{
    try {
        if ((bits != 128 && bits != 256) || chunk_size <= 0 ||
            (chunk_size % 16) != 0 || total_mib <= 0 || total_mib > 64) {
            return -2.0;
        }

        size_t const total_bytes = static_cast<size_t>(total_mib) * 1024ULL * 1024ULL;
        auto single_crypto = get_crypto(provider_id);
        auto bulk_crypto = get_crypto(provider_id);

        auto const single_started = std::chrono::steady_clock::now();
        auto single = run_aes(single_crypto, bits, chunk_size, total_bytes, false);
        auto const single_finished = std::chrono::steady_clock::now();

        auto const bulk_started = std::chrono::steady_clock::now();
        auto bulk = run_aes(bulk_crypto, bits, chunk_size, total_bytes, true);
        auto const bulk_finished = std::chrono::steady_clock::now();

        if (single != bulk) {
            std::printf(
                "SAFEPDFHUB_F2R_RAW_AES_COMPARE provider=%d bits=%d chunk=%d status=MISMATCH\n",
                provider_id, bits, chunk_size);
            return 0.0;
        }

        auto const single_us = std::chrono::duration_cast<std::chrono::microseconds>(
            single_finished - single_started).count();
        auto const bulk_us = std::chrono::duration_cast<std::chrono::microseconds>(
            bulk_finished - bulk_started).count();
        double const mib = static_cast<double>(total_bytes) / (1024.0 * 1024.0);
        double const single_mib_s = mib / (static_cast<double>(single_us) / 1000000.0);
        double const bulk_mib_s = mib / (static_cast<double>(bulk_us) / 1000000.0);
        std::printf(
            "SAFEPDFHUB_F2R_RAW_AES_COMPARE provider=%d bits=%d chunk=%d status=PASS single_us=%lld bulk_us=%lld single_mib_s=%.3f bulk_mib_s=%.3f checksum=%u\n",
            provider_id,
            bits,
            chunk_size,
            static_cast<long long>(single_us),
            static_cast<long long>(bulk_us),
            single_mib_s,
            bulk_mib_s,
            checksum(single));
        return 1.0;
    } catch (...) {
        return -1.0;
    }
}

}
