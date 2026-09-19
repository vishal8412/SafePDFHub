# ============================================================================
# SafePDFHub - High Performance qpdf WebAssembly
#
# Toolchain:
#   Emscripten 4.0.23
#   qpdf       12.4.1
#   OpenSSL    3.5.1
#
# Output:
#   /out/qpdf-performance.js
#   /out/qpdf-performance.wasm
#
# Architecture:
#
#   OpenSSL
#      |
#      +-- libcrypto.a
#      +-- libssl.a
#      |
#   zlib
#      |
#   libjpeg-turbo
#      |
#   qpdf
#      |
#      +-- libqpdf.a
#      |
#   final emcc link
#      |
#      +-- qpdf-performance.js
#      +-- qpdf-performance.wasm
#
# ============================================================================


# ============================================================================
# BUILD IMAGE
# ============================================================================

FROM emscripten/emsdk:4.0.23 AS build


# ============================================================================
# Environment
# ============================================================================

ENV EMSDK=/emsdk
ENV EMSCRIPTEN=/emsdk/upstream/emscripten
ENV EM_CONFIG=/emsdk/.emscripten

ENV PATH=/emsdk:/emsdk/upstream/emscripten:/emsdk/upstream/bin:/usr/local/bin:/usr/bin:/bin


# ============================================================================
# Build dependencies
# ============================================================================

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        git \
        ca-certificates \
        perl \
        python3 \
        make \
        cmake \
        ninja-build \
        pkg-config \
        autoconf \
        automake \
        libtool \
        patch \
        sed \
        grep \
        file \
        binutils \
    && rm -rf /var/lib/apt/lists/*


# ============================================================================
# Verify Emscripten
# ============================================================================

RUN set -eux; \
    echo "============================================================"; \
    echo "SafePDFHub Emscripten toolchain"; \
    echo "============================================================"; \
    command -v python3; \
    python3 --version; \
    command -v emcc; \
    emcc --version; \
    command -v em++; \
    em++ --version; \
    command -v emar; \
    command -v emranlib; \
    emcc --check


# ============================================================================
# Versions
# ============================================================================

ARG QPDF_VERSION=12.4.1
ARG QPDF_TAG=v12.4.1

# OpenSSL 3.5.1 is intentionally pinned here.
#
# This combination has already been validated with the Emscripten
# toolchain being used by this project.
ARG OPENSSL_VERSION=3.5.1
ARG OPENSSL_TAG=openssl-3.5.1

# F2 bulk AES-CBC buffer. The build-time patch validates this against the
# supported benchmark sizes: 16 KiB, 64 KiB, 256 KiB, 1 MiB, 4 MiB.
ARG QPDF_AES_BULK_BUFFER_SIZE=262144
ENV QPDF_AES_BULK_BUFFER_SIZE=${QPDF_AES_BULK_BUFFER_SIZE}


# ============================================================================
# Workspace
# ============================================================================

WORKDIR /src


# ============================================================================
# Download qpdf
# ============================================================================

RUN set -eux; \
    git clone \
        --depth 1 \
        --branch "${QPDF_TAG}" \
        https://github.com/qpdf/qpdf.git \
        /src/qpdf


# ============================================================================
# Download OpenSSL
# ============================================================================

RUN set -eux; \
    git clone \
        --depth 1 \
        --branch "${OPENSSL_TAG}" \
        https://github.com/openssl/openssl.git \
        /src/openssl


# ============================================================================
# Download zlib
# ============================================================================

RUN set -eux; \
    git clone \
        --depth 1 \
        https://github.com/madler/zlib.git \
        /src/zlib


# ============================================================================
# Download libjpeg-turbo
# ============================================================================

RUN set -eux; \
    git clone \
        --depth 1 \
        https://github.com/libjpeg-turbo/libjpeg-turbo.git \
        /src/jpeg-turbo


# ============================================================================
# Output directories
# ============================================================================

ENV PREFIX=/opt/safepdfhub
ENV OPENSSL_PREFIX=/opt/safepdfhub/openssl

RUN mkdir -p \
    "${PREFIX}" \
    "${OPENSSL_PREFIX}" \
    /out \
    /src/safepdfhub-patches

COPY patches/apply-f2r-raw-aes.py /src/safepdfhub-patches/apply-f2r-raw-aes.py
COPY validate-wasm-exports.py /src/safepdfhub-patches/validate-wasm-exports.py
COPY safepdfhub-f3-crypto-benchmark.cc /src/safepdfhub-patches/safepdfhub-f3-crypto-benchmark.cc
COPY safepdfhub-f2r-raw-aes-compare.cc /src/safepdfhub-patches/safepdfhub-f2r-raw-aes-compare.cc


# ============================================================================
# Optimization
# ============================================================================

ENV CFLAGS="-O3 -flto -msimd128"
ENV CXXFLAGS="-O3 -flto -msimd128"
ENV LDFLAGS="-O3 -flto"


# ============================================================================
# IMPORTANT:
#
# Emscripten's pkg-config handling uses EM_PKG_CONFIG_PATH.
#
# We therefore set BOTH variables.
# ============================================================================

ENV PKG_CONFIG_PATH=/opt/safepdfhub/lib/pkgconfig:/opt/safepdfhub/openssl/lib/pkgconfig
ENV EM_PKG_CONFIG_PATH=/opt/safepdfhub/lib/pkgconfig:/opt/safepdfhub/openssl/lib/pkgconfig


# ============================================================================
# ZLIB
# ============================================================================

RUN set -eux; \
    echo "============================================================"; \
    echo "Building zlib"; \
    echo "============================================================"; \
    \
    cd /src/zlib; \
    \
    emconfigure ./configure \
        --prefix="${PREFIX}" \
        --static; \
    \
    emmake make -j2; \
    emmake make install; \
    \
    echo; \
    echo "Installed zlib files:"; \
    find "${PREFIX}" -maxdepth 3 -type f | sort


# ============================================================================
# LIBJPEG-TURBO
# ============================================================================

RUN set -eux; \
    echo "============================================================"; \
    echo "Building libjpeg-turbo"; \
    echo "============================================================"; \
    \
    cd /src/jpeg-turbo; \
    \
    emcmake cmake \
        -S . \
        -B build \
        -G Ninja \
        -DCMAKE_BUILD_TYPE=Release \
        -DCMAKE_VERBOSE_MAKEFILE=ON \
        -DCMAKE_INSTALL_PREFIX="${PREFIX}" \
        -DENABLE_SHARED=OFF \
        -DENABLE_STATIC=ON \
        -DWITH_SIMD=0 \
        -DCMAKE_C_FLAGS="${CFLAGS}"; \
    \
    cmake --build build -j2; \
    cmake --install build; \
    \
    echo; \
    echo "Installed JPEG files:"; \
    find "${PREFIX}" -maxdepth 3 -type f | sort


# ============================================================================
# OPENSSL
#
# CRITICAL:
#
# Do NOT use:
#
#   make build_sw
#
# Build:
#
#   build_generated
#   libcrypto.a
#   libssl.a
#
# This follows the known Emscripten/OpenSSL WebAssembly build pattern.
# ============================================================================

RUN set -eux; \
    echo "============================================================"; \
    echo "Building OpenSSL ${OPENSSL_VERSION}"; \
    echo "============================================================"; \
    \
    cd /src/openssl; \
    \
    echo "Emscripten:"; \
    command -v emcc; \
    emcc --version; \
    \
    echo; \
    echo "Configuring OpenSSL"; \
    \
    emconfigure ./Configure \
        linux-x32 \
        no-asm \
        no-threads \
        no-shared \
        no-dso \
        no-module \
        no-apps \
        no-tests \
        no-engine \
        no-hw \
        no-dtls \
        no-ssl3 \
        -static \
        --prefix="${OPENSSL_PREFIX}" \
        --libdir=lib \
        -O3; \
    \
    echo; \
    echo "============================================================"; \
    echo "Removing CROSS_COMPILE"; \
    echo "============================================================"; \
    \
    sed -i \
        's|^CROSS_COMPILE.*$|CROSS_COMPILE=|g' \
        Makefile; \
    \
    echo; \
    echo "============================================================"; \
    echo "Removing problematic CNF flags"; \
    echo "============================================================"; \
    \
    sed -i \
        '/^CNF_CFLAGS=/d' \
        Makefile; \
    \
    sed -i \
        '/^CNF_LDFLAGS=/d' \
        Makefile; \
    \
    echo; \
    echo "============================================================"; \
    echo "OpenSSL compiler configuration"; \
    echo "============================================================"; \
    \
    grep -E \
        '^(CROSS_COMPILE|CC|CXX|AR|RANLIB|LD|CFLAGS|CXXFLAGS|LDFLAGS)=' \
        Makefile || true; \
    \
    echo; \
    echo "============================================================"; \
    echo "Building OpenSSL generated sources"; \
    echo "============================================================"; \
    \
    emmake make -j1 build_generated; \
    \
    echo; \
    echo "============================================================"; \
    echo "Building libcrypto.a"; \
    echo "============================================================"; \
    \
    emmake make -j1 libcrypto.a; \
    \
    echo; \
    echo "============================================================"; \
    echo "Building libssl.a"; \
    echo "============================================================"; \
    \
    emmake make -j1 libssl.a; \
    \
    echo; \
    echo "============================================================"; \
    echo "Installing OpenSSL"; \
    echo "============================================================"; \
    \
    emmake make -j1 install_sw


# ============================================================================
# Verify OpenSSL
# ============================================================================

RUN set -eux; \
    echo "============================================================"; \
    echo "OpenSSL validation"; \
    echo "============================================================"; \
    \
    echo "OpenSSL installation tree:"; \
    find "${OPENSSL_PREFIX}" -maxdepth 4 -type f | sort; \
    \
    echo; \
    echo "Checking static libraries:"; \
    test -f "${OPENSSL_PREFIX}/lib/libcrypto.a"; \
    test -f "${OPENSSL_PREFIX}/lib/libssl.a"; \
    \
    ls -lh "${OPENSSL_PREFIX}/lib/libcrypto.a"; \
    ls -lh "${OPENSSL_PREFIX}/lib/libssl.a"; \
    \
    echo; \
    echo "Checking OpenSSL headers:"; \
    test -f "${OPENSSL_PREFIX}/include/openssl/opensslv.h"; \
    \
    echo; \
    echo "Checking OpenSSL pkg-config files:"; \
    find "${OPENSSL_PREFIX}" -type f -name "*.pc" -print || true; \
    \
    echo; \
    echo "============================================================"; \
    echo "OpenSSL build PASSED"; \
    echo "============================================================"


# ============================================================================
# Validate dependency pkg-config files
# ============================================================================

RUN set -eux; \
    echo "============================================================"; \
    echo "Validating dependency discovery"; \
    echo "============================================================"; \
    \
    export PKG_CONFIG_PATH="${PREFIX}/lib/pkgconfig:${OPENSSL_PREFIX}/lib/pkgconfig"; \
    export EM_PKG_CONFIG_PATH="${PREFIX}/lib/pkgconfig:${OPENSSL_PREFIX}/lib/pkgconfig"; \
    \
    echo "PKG_CONFIG_PATH=${PKG_CONFIG_PATH}"; \
    echo "EM_PKG_CONFIG_PATH=${EM_PKG_CONFIG_PATH}"; \
    \
    echo; \
    echo "All pkg-config files:"; \
    find "${PREFIX}" "${OPENSSL_PREFIX}" \
        -type f \
        -name "*.pc" \
        -print | sort; \
    \
    echo; \
    echo "zlib:"; \
    pkg-config --modversion zlib; \
    pkg-config --cflags zlib; \
    pkg-config --libs zlib; \
    \
    echo; \
    echo "libjpeg:"; \
    pkg-config --modversion libjpeg; \
    pkg-config --cflags libjpeg; \
    pkg-config --libs libjpeg; \
    \
    echo; \
    echo "OpenSSL:"; \
    pkg-config --modversion openssl; \
    pkg-config --cflags openssl; \
    pkg-config --libs openssl; \
    \
    echo; \
    echo "Static libraries:"; \
    test -f "${PREFIX}/lib/libz.a"; \
    test -f "${PREFIX}/lib/libjpeg.a"; \
    test -f "${OPENSSL_PREFIX}/lib/libssl.a"; \
    test -f "${OPENSSL_PREFIX}/lib/libcrypto.a"; \
    \
    ls -lh \
        "${PREFIX}/lib/libz.a" \
        "${PREFIX}/lib/libjpeg.a" \
        "${OPENSSL_PREFIX}/lib/libssl.a" \
        "${OPENSSL_PREFIX}/lib/libcrypto.a"


# ============================================================================
# ============================================================================
# QPDF CONFIGURATION
#
# Emscripten's emcmake configures pkg-config for cross compilation.
# Custom dependency locations must be supplied through EM_PKG_CONFIG_PATH.
#
# We also explicitly set PKG_CONFIG_LIBDIR so qpdf's pkg-config checks use
# only the Emscripten-built dependency libraries.
# ============================================================================

RUN set -eux; \
    echo "============================================================"; \
    echo "Applying SafePDFHub F2-R.1 raw AES provider patch"; \
    echo "============================================================"; \
    cd /src/qpdf; \
    echo "qpdf 12.4.x crypto source layout:"; \
    find libqpdf -maxdepth 2 -type f \
        \( -name 'QPDFCrypto*.hh' -o -name 'QPDFCrypto*.cc' -o -name 'Pl_AES_PDF.hh' -o -name 'Pl_AES_PDF.cc' \
        \) -print | sort; \
    test -f include/qpdf/QPDFCryptoImpl.hh; \
    test -f libqpdf/QPDFCrypto_openssl.cc; \
    test -f libqpdf/qpdf/QPDFCrypto_openssl.hh; \
    test -f libqpdf/qpdf/Pl_AES_PDF.hh; \
    test -f libqpdf/Pl_AES_PDF.cc; \
    python3 /src/safepdfhub-patches/apply-f2r-raw-aes.py; \
    echo "F2-R.1 provider-only patch applied; Pl_AES_PDF remains unchanged"; \
    \
    echo "============================================================"; \
    echo "Configuring qpdf ${QPDF_VERSION}"; \
    echo "============================================================"; \
    \
    export PKG_CONFIG_PATH="${PREFIX}/lib/pkgconfig:${OPENSSL_PREFIX}/lib/pkgconfig"; \
    export EM_PKG_CONFIG_PATH="${PREFIX}/lib/pkgconfig:${OPENSSL_PREFIX}/lib/pkgconfig"; \
    export PKG_CONFIG_LIBDIR="${PREFIX}/lib/pkgconfig:${OPENSSL_PREFIX}/lib/pkgconfig"; \
    \
    echo; \
    echo "PKG_CONFIG_PATH=${PKG_CONFIG_PATH}"; \
    echo "EM_PKG_CONFIG_PATH=${EM_PKG_CONFIG_PATH}"; \
    echo "PKG_CONFIG_LIBDIR=${PKG_CONFIG_LIBDIR}"; \
    \
    echo; \
    echo "pkg-config files:"; \
    find "${PREFIX}/lib/pkgconfig" "${OPENSSL_PREFIX}/lib/pkgconfig" \
        -maxdepth 1 \
        -type f \
        -name "*.pc" \
        -print | sort; \
    \
    echo; \
    echo "Testing zlib:"; \
    pkg-config --modversion zlib; \
    pkg-config --cflags zlib; \
    pkg-config --libs zlib; \
    \
    echo; \
    echo "Testing libjpeg:"; \
    pkg-config --modversion libjpeg; \
    pkg-config --cflags libjpeg; \
    pkg-config --libs libjpeg; \
    \
    echo; \
    echo "Testing OpenSSL:"; \
    pkg-config --modversion openssl; \
    pkg-config --cflags openssl; \
    pkg-config --libs openssl; \
    \
    echo; \
    echo "Checking static libraries:"; \
    test -f "${PREFIX}/lib/libz.a"; \
    test -f "${PREFIX}/lib/libjpeg.a"; \
    test -f "${OPENSSL_PREFIX}/lib/libssl.a"; \
    test -f "${OPENSSL_PREFIX}/lib/libcrypto.a"; \
    \
    echo; \
    echo "============================================================"; \
    echo "Running qpdf CMake"; \
    echo "============================================================"; \
    echo "qpdf crypto CMake options:"; \
    grep -n -E "REQUIRE_CRYPTO_(NATIVE|OPENSSL)|USE_IMPLICIT_CRYPTO|DEFAULT_CRYPTO" CMakeLists.txt || true; \
    echo; \
    echo "Forcing qpdf's own dependency cache variables:"; \
    echo "  OPENSSL_H_PATH=${OPENSSL_PREFIX}/include"; \
    echo "  OPENSSL_LIB_PATH=${OPENSSL_PREFIX}/lib/libcrypto.a"; \
    echo "  ZLIB_H_PATH=${PREFIX}/include"; \
    echo "  ZLIB_LIB_PATH=${PREFIX}/lib/libz.a"; \
    echo "  LIBJPEG_H_PATH=${PREFIX}/include"; \
    echo "  LIBJPEG_LIB_PATH=${PREFIX}/lib/libjpeg.a"; \
    echo; \
    \
    echo "Running CMake configure with captured diagnostics..."; \
    if emcmake cmake \
        -S . \
        -B build \
        -G Ninja \
        -DCMAKE_BUILD_TYPE=Release \
        -DCMAKE_INSTALL_PREFIX="${PREFIX}" \
        -DCMAKE_PREFIX_PATH="${PREFIX};${OPENSSL_PREFIX}" \
        -DCMAKE_FIND_ROOT_PATH="${PREFIX};${OPENSSL_PREFIX}" \
        -DCMAKE_FIND_ROOT_PATH_MODE_PROGRAM=NEVER \
        -DCMAKE_FIND_ROOT_PATH_MODE_LIBRARY=ONLY \
        -DCMAKE_FIND_ROOT_PATH_MODE_INCLUDE=ONLY \
        -DBUILD_SHARED_LIBS=OFF \
        -DBUILD_STATIC_LIBS=ON \
        -DBUILD_DOC=OFF \
        -DINSTALL_MANUAL=OFF \
        -DINSTALL_EXAMPLES=OFF \
        -DINSTALL_PKGCONFIG=OFF \
        -DINSTALL_CMAKE_PACKAGE=OFF \
        -DUSE_IMPLICIT_CRYPTO=OFF \
        -DREQUIRE_CRYPTO_OPENSSL=ON \
        -DREQUIRE_CRYPTO_NATIVE=ON \
        -DDEFAULT_CRYPTO=openssl \
        -DSTATIC_OPENSSL=ON \
        -DSTATIC_JPEG=ON \
        -DZLIB_ROOT="${PREFIX}" \
        -DZLIB_INCLUDE_DIR="${PREFIX}/include" \
        -DZLIB_LIBRARY="${PREFIX}/lib/libz.a" \
        -DZLIB_H_PATH="${PREFIX}/include" \
        -DZLIB_LIB_PATH="${PREFIX}/lib/libz.a" \
        -DJPEG_ROOT="${PREFIX}" \
        -DJPEG_INCLUDE_DIR="${PREFIX}/include" \
        -DJPEG_LIBRARY="${PREFIX}/lib/libjpeg.a" \
        -DLIBJPEG_H_PATH="${PREFIX}/include" \
        -DLIBJPEG_LIB_PATH="${PREFIX}/lib/libjpeg.a" \
        -DOPENSSL_ROOT_DIR="${OPENSSL_PREFIX}" \
        -DOPENSSL_INCLUDE_DIR="${OPENSSL_PREFIX}/include" \
        -DOPENSSL_CRYPTO_LIBRARY="${OPENSSL_PREFIX}/lib/libcrypto.a" \
        -DOPENSSL_SSL_LIBRARY="${OPENSSL_PREFIX}/lib/libssl.a" \
        -DOPENSSL_LIBRARIES="${OPENSSL_PREFIX}/lib/libssl.a;${OPENSSL_PREFIX}/lib/libcrypto.a" \
        -DOPENSSL_H_PATH="${OPENSSL_PREFIX}/include" \
        -DOPENSSL_LIB_PATH="${OPENSSL_PREFIX}/lib/libcrypto.a" \
        -DCMAKE_C_FLAGS="${CFLAGS} -I${PREFIX}/include -I${OPENSSL_PREFIX}/include" \
        -DCMAKE_CXX_FLAGS="${CXXFLAGS} -I${PREFIX}/include -I${OPENSSL_PREFIX}/include" \
        -DCMAKE_EXE_LINKER_FLAGS="${LDFLAGS} -L${PREFIX}/lib -L${OPENSSL_PREFIX}/lib" \
        > /tmp/safepdfhub-qpdf-cmake.log 2>&1; \
    then \
        echo "qpdf CMake configure PASSED"; \
        cat /tmp/safepdfhub-qpdf-cmake.log; \
    else \
        status=$?; \
        echo "============================================================"; \
        echo "qpdf CMake configure FAILED (exit code ${status})"; \
        echo "============================================================"; \
        cat /tmp/safepdfhub-qpdf-cmake.log || true; \
        echo; \
        echo "CMake cache diagnostics:"; \
        if [ -f build/CMakeCache.txt ]; then grep -E "(OPENSSL|ZLIB|JPEG|CRYPTO)" build/CMakeCache.txt | sort || true; fi; \
        echo; \
        echo "CMake error log:"; \
        cat build/CMakeFiles/CMakeError.log 2>/dev/null || true; \
        echo; \
        echo "CMake output log:"; \
        cat build/CMakeFiles/CMakeOutput.log 2>/dev/null || true; \
        exit ${status}; \
    fi

# ============================================================================
# BUILD qpdf LIBRARY
# ============================================================================

RUN set -eux; \
    echo "============================================================"; \
    echo "Building libqpdf.a"; \
    echo "============================================================"; \
    \
    cd /src/qpdf; \
    \
    cmake --build build \
        -j2 \
        --target libqpdf


# ============================================================================
# Verify libqpdf
# ============================================================================

RUN set -eux; \
    echo "============================================================"; \
    echo "Validating libqpdf"; \
    echo "============================================================"; \
    \
    test -f /src/qpdf/build/libqpdf/libqpdf.a; \
    \
    ls -lh /src/qpdf/build/libqpdf/libqpdf.a


# ============================================================================
# FINAL WASM LINK
#
# Architecture:
#
#   libqpdf.a
#       +
#   qpdf/qpdf.cc
#       +
#   OpenSSL
#       +
#   zlib
#       +
#   libjpeg
#       =
#   qpdf-performance.wasm
#
# ============================================================================

RUN set -eux; \
    echo "============================================================"; \
    echo "Creating qpdf-performance WASM"; \
    echo "============================================================"; \
    \
    cd /src/qpdf; \
    \
    emcc \
        ${LDFLAGS} \
        ${CFLAGS} \
        -I"${PREFIX}/include" \
        -I"${OPENSSL_PREFIX}/include" \
        -I"${PWD}/include" \
        -L"${PREFIX}/lib" \
        -L"${OPENSSL_PREFIX}/lib" \
        --closure 0 \
        -s WASM_BIGINT=1 \
        -s ALLOW_MEMORY_GROWTH=1 \
        -s FORCE_FILESYSTEM=1 \
        -s ENVIRONMENT='web,worker' \
        -s MODULARIZE=1 \
        -s EXPORT_NAME='SafePDFHubQpdfFactory' \
        -s EXPORTED_RUNTIME_METHODS='["callMain","FS","WORKERFS","ENV"]' \
        -s EXPORTED_FUNCTIONS='["_main","_safepdfhubF3RawAesBenchmark","_safepdfhubF3RawAesChecksum","_safepdfhubF2RRawAesCompare"]' \
        -s INCOMING_MODULE_JS_API='["noInitialRun","locateFile","preRun","print","printErr"]' \
        -s NO_DISABLE_EXCEPTION_CATCHING=1 \
        -o /out/qpdf-performance.js \
        /src/qpdf/qpdf/qpdf.cc \
        /src/safepdfhub-patches/safepdfhub-f3-crypto-benchmark.cc \
        /src/safepdfhub-patches/safepdfhub-f2r-raw-aes-compare.cc \
        /src/qpdf/build/libqpdf/libqpdf.a \
        -lworkerfs.js \
        -lssl \
        -lcrypto \
        -lz \
        -ljpeg

# Keep the generated artifact contract close to the link step. This makes a
# broken export contract fail at the image-build boundary rather than later
# during Angular integration or browser benchmarking.
RUN set -eux; \
    test -s /out/qpdf-performance.js; \
    test -s /out/qpdf-performance.wasm; \
    grep -q 'safepdfhubF3RawAesBenchmark' /out/qpdf-performance.js; \
    grep -q 'safepdfhubF3RawAesChecksum' /out/qpdf-performance.js; \
    grep -q 'safepdfhubF2RRawAesCompare' /out/qpdf-performance.js; \
    grep -q 'SafePDFHubQpdfFactory' /out/qpdf-performance.js; \
    echo 'Public raw-AES JavaScript contract is present.'


# Angular's security Worker is an ES-module Worker. Export the Emscripten
# factory so it can be loaded with dynamic import() instead of importScripts.
RUN printf '\nexport { SafePDFHubQpdfFactory };\n' >> /out/qpdf-performance.js

# F3 is part of the runtime contract. Validate the public Emscripten Module API
# and the WASM container, not the internal WASM export names. Emscripten may
# legally minify those internal names in optimized builds.
RUN set -eux; \
    python3 /src/safepdfhub-patches/validate-wasm-exports.py \
        /out/qpdf-performance.wasm \
        /out/qpdf-performance.js; \
    echo 'SafePDFHub qpdf performance artifact contract validated.'



# ============================================================================
# FINAL VALIDATION
# ============================================================================

RUN set -eux; \
    echo "============================================================"; \
    echo "Final WASM validation"; \
    echo "============================================================"; \
    \
    test -f /out/qpdf-performance.js; \
    test -f /out/qpdf-performance.wasm; \
    \
    echo; \
    echo "Generated JavaScript:"; \
    ls -lh /out/qpdf-performance.js; \
    \
    echo; \
    echo "Generated WebAssembly:"; \
    ls -lh /out/qpdf-performance.wasm; \
    \
    echo; \
    echo "WASM information:"; \
    file /out/qpdf-performance.wasm; \
    \
    echo; \
    echo "WASM magic header:"; \
    od -An -tx1 -N4 /out/qpdf-performance.wasm; \
    \
    test "$(od -An -tx1 -N4 /out/qpdf-performance.wasm | tr -d ' \n')" = "0061736d"; \
    \
    echo; \
    echo "JavaScript module header:"; \
    head -c 200 /out/qpdf-performance.js; \
    echo; \
    \
    echo; \
    echo "============================================================"; \
    echo "SafePDFHub qpdf WASM BUILD PASSED"; \
    echo "============================================================"


# ============================================================================
# ARTIFACT IMAGE
# ============================================================================

FROM scratch

COPY --from=build /out /out
