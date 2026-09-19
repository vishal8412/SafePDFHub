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
volatile unsigned int f3_checksum_sink = 0;
std::shared_ptr<QPDFCryptoImpl> get_crypto(int provider_id)
{
    switch (provider_id) {
    case 0: return QPDFCryptoProvider::getImpl("openssl");
    case 1: return QPDFCryptoProvider::getImpl("native");
    default: throw std::invalid_argument("SafePDFHub F3: unknown crypto provider id");
    }
}
}
extern "C" {
EMSCRIPTEN_KEEPALIVE
 double safepdfhubF3RawAesBenchmark(int provider_id, int bits, int buffer_size, int total_mib, int bulk)
{
    try {
        if ((bits != 128 && bits != 256) || buffer_size <= 0 || (buffer_size % 16) != 0 || total_mib <= 0 || total_mib > 1024) return -2.0;
        size_t const total_bytes = static_cast<size_t>(total_mib) * 1024ULL * 1024ULL;
        size_t const chunk_bytes = static_cast<size_t>(buffer_size);
        std::vector<unsigned char> input(chunk_bytes), output(chunk_bytes);
        for (size_t i = 0; i < chunk_bytes; ++i) input[i] = static_cast<unsigned char>((i * 131U + 17U) & 0xffU);
        unsigned char key[32] = {};
        unsigned char iv[16] = {};
        for (size_t i = 0; i < sizeof(key); ++i) key[i] = static_cast<unsigned char>((i * 29U + 3U) & 0xffU);
        for (size_t i = 0; i < sizeof(iv); ++i) iv[i] = static_cast<unsigned char>((i * 47U + 11U) & 0xffU);
        auto crypto = get_crypto(provider_id);
        crypto->rijndael_init(true, key, static_cast<size_t>(bits / 8), true, iv);
        size_t processed = 0;
        auto const started = std::chrono::steady_clock::now();
        while (processed < total_bytes) {
            size_t const remaining = total_bytes - processed;
            size_t const bytes = remaining >= chunk_bytes ? chunk_bytes : remaining & ~static_cast<size_t>(15);
            if (bytes == 0) break;
            if (bulk) {
                crypto->rijndael_process_buffer(input.data(), output.data(), bytes);
            } else {
                unsigned char block[QPDFCryptoImpl::rijndael_buf_size];
                for (size_t offset = 0; offset < bytes; offset += QPDFCryptoImpl::rijndael_buf_size) {
                    std::memcpy(block, input.data() + offset, sizeof(block));
                    crypto->rijndael_process(block, output.data() + offset);
                }
            }
            processed += bytes;
        }
        crypto->rijndael_finalize();
        auto const finished = std::chrono::steady_clock::now();
        unsigned int checksum = 0;
        if (!output.empty()) checksum = static_cast<unsigned int>(output.front()) ^ (static_cast<unsigned int>(output.back()) << 8) ^ (static_cast<unsigned int>(output[output.size() / 2]) << 16);
        f3_checksum_sink = checksum;
        auto const elapsed_us = std::chrono::duration_cast<std::chrono::microseconds>(finished - started).count();
        return static_cast<double>(elapsed_us) / 1000.0;
    } catch (...) { return -1.0; }
}
EMSCRIPTEN_KEEPALIVE
unsigned int safepdfhubF3RawAesChecksum() { return f3_checksum_sink; }
}
