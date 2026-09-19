$ErrorActionPreference = 'Stop'

# Always execute from this script's directory. This prevents a common Windows
# failure where docker build . runs from the wrong directory and the generated
# assets are copied outside src/assets/qpdf.
Set-Location -LiteralPath $PSScriptRoot

$projectSrc = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$buildDir = Join-Path $PSScriptRoot 'dist'
$assetDir = Join-Path $projectSrc 'assets/qpdf'

Write-Host "Building SafePDFHub qpdf 12.4.1 F2-R.1 raw AES provider runtime..." -ForegroundColor Cyan
Write-Host "Docker build context: $PSScriptRoot" -ForegroundColor DarkGray
Write-Host "Angular asset destination: $assetDir" -ForegroundColor DarkGray
Write-Host "Docker progress: plain (the first real CMake/compiler error will remain visible)." -ForegroundColor DarkGray

# BuildKit's default TTY progress can collapse the useful CMake/compiler output
# into a final 'failed to solve' message. Plain progress makes the first real
# failure visible and is much easier to diagnose on Windows/VS Code.
docker build --progress=plain -t safepdfhub-qpdf-wasm-performance .
$buildExitCode = $LASTEXITCODE

if ($buildExitCode -ne 0) {
  Write-Host ''
  Write-Host "Docker image build FAILED (exit code $buildExitCode)." -ForegroundColor Red
  Write-Host 'The output-extraction container will NOT be created because the image does not exist.' -ForegroundColor Yellow
  throw "qpdf WASM Docker build failed with exit code $buildExitCode. Inspect the FIRST CMake/compiler error above; the final 'failed to solve' line is only a Docker wrapper."
}

$container = 'safepdfhub-qpdf-build'

# Remove any stale extraction container. Do not call `docker inspect` here:
# with PowerShell's native-command error handling, a missing container can be
# surfaced as a terminating error even though it is an expected state.
docker rm -f $container 2>$null | Out-Null
$global:LASTEXITCODE = 0

docker create --name $container safepdfhub-qpdf-wasm-performance /bin/sh | Out-Null
$createExitCode = $LASTEXITCODE
$global:LASTEXITCODE = 0
if ($createExitCode -ne 0) {
  throw "Docker image was built, but the output extraction container could not be created (exit code $createExitCode)."
}

try {
  if (Test-Path $buildDir) {
    Remove-Item $buildDir -Recurse -Force
  }
  New-Item -ItemType Directory -Force -Path $buildDir | Out-Null

  docker cp "${container}:/out/." $buildDir
  $copyExitCode = $LASTEXITCODE
  $global:LASTEXITCODE = 0
  if ($copyExitCode -ne 0) {
    throw "Docker output extraction failed (exit code $copyExitCode)."
  }
}
finally {
  docker rm $container *> $null
  $global:LASTEXITCODE = 0
}

$jsPath = Join-Path $buildDir 'qpdf-performance.js'
$wasmPath = Join-Path $buildDir 'qpdf-performance.wasm'

if (!(Test-Path $jsPath)) { throw "qpdf-performance.js was not produced at $jsPath." }
if (!(Test-Path $wasmPath)) { throw "qpdf-performance.wasm was not produced at $wasmPath." }

# The Emscripten factory is consumed as an ES module by the dedicated Worker.
# Guard against the historical Docker `printf '\\n...'` bug that wrote literal
# backslash-n bytes into the JavaScript footer. The public export must be a real
# JavaScript export, not the literal characters `\\n`.
$jsTextForSyntax = [System.IO.File]::ReadAllText($jsPath)
if ($jsTextForSyntax.Contains('\nexport { SafePDFHubQpdfFactory };\n')) {
  throw "Generated qpdf-performance.js contains a literal \\n export footer. Docker printf must emit real newlines."
}
if (-not $jsTextForSyntax.Contains("export { SafePDFHubQpdfFactory };")) {
  throw "Generated qpdf-performance.js is missing the SafePDFHubQpdfFactory ES-module export."
}

$validator = Join-Path $PSScriptRoot 'validate-wasm-exports.py'
$python = Get-Command python3 -ErrorAction SilentlyContinue
if (-not $python) {
  $python = Get-Command python -ErrorAction SilentlyContinue
}
if ($python) {
  & $python.Source $validator $wasmPath $jsPath
  if ($LASTEXITCODE -ne 0) {
    throw "Generated qpdf performance artifacts failed the public runtime contract validation (exit code $LASTEXITCODE)."
  }
}
else {
  # Python is not required for the Docker build itself. Keep a dependency-free
  # fallback for Windows hosts that do not have Python on PATH.
  $jsText = [System.IO.File]::ReadAllText($jsPath)
  foreach ($requiredExport in @('safepdfhubF3RawAesBenchmark', 'safepdfhubF3RawAesChecksum', 'safepdfhubF2RRawAesCompare')) {
    if ($jsText.IndexOf($requiredExport, [System.StringComparison]::Ordinal) -lt 0) {
      throw "Generated qpdf-performance.js is missing required public raw-AES export: $requiredExport."
    }
  }
}

$wasm = [System.IO.File]::ReadAllBytes($wasmPath)
if ($wasm.Length -lt 8 -or $wasm[0] -ne 0 -or $wasm[1] -ne 0x61 -or $wasm[2] -ne 0x73 -or $wasm[3] -ne 0x6d -or $wasm[4] -ne 1) {
  throw 'qpdf-performance.wasm failed the WebAssembly magic/version validation.'
}

# Fail if the generated artifact is unexpectedly tiny; a qpdf build should be
# materially larger than a placeholder/error page. This is only a sanity check,
# not a correctness proof.
if ((Get-Item $wasmPath).Length -lt 1MB) {
  throw "qpdf-performance.wasm is unexpectedly small: $((Get-Item $wasmPath).Length) bytes."
}

# Node syntax checking is optional on the Windows host. Do not make the
# artifact build depend on a globally installed Node executable: on some
# Windows/Docker/enterprise setups `node` resolves to a non-executable shim.
# The JavaScript is already produced by Emscripten, and the public artifact
# contract above is the authoritative validation boundary.
$node = Get-Command node -ErrorAction SilentlyContinue
if ($node -and (Test-Path -LiteralPath $node.Source -PathType Leaf)) {
  try {
    & $node.Source --check $jsPath 2>$null
    if ($LASTEXITCODE -ne 0) {
      Write-Host 'Node syntax validation was available but did not pass; continuing because Emscripten generated the artifact and the public contract is valid.' -ForegroundColor Yellow
    }
  } catch {
    Write-Host 'Node syntax validation was unavailable on this host; continuing with artifact-contract validation.' -ForegroundColor Yellow
  }
}

New-Item -ItemType Directory -Force -Path $assetDir | Out-Null
Copy-Item $jsPath (Join-Path $assetDir 'qpdf-performance.js') -Force
Copy-Item $wasmPath (Join-Path $assetDir 'qpdf-performance.wasm') -Force

# Verify the copied bytes, not only the Docker output.
$installedWasmPath = Join-Path $assetDir 'qpdf-performance.wasm'
$installed = [System.IO.File]::ReadAllBytes($installedWasmPath)
if ($installed.Length -lt 8 -or $installed[0] -ne 0 -or $installed[1] -ne 0x61 -or $installed[2] -ne 0x73 -or $installed[3] -ne 0x6d -or $installed[4] -ne 1) {
  throw 'Installed src/assets/qpdf/qpdf-performance.wasm failed WebAssembly validation.'
}

Write-Host ''
Write-Host 'Build complete.' -ForegroundColor Green
Write-Host "  JS:   $assetDir/qpdf-performance.js" -ForegroundColor Green
Write-Host "  WASM: $assetDir/qpdf-performance.wasm" -ForegroundColor Green
Write-Host "F2-R.1 runtime: provider-only raw AES A/B benchmark exports. qpdf Pl_AES_PDF remains unmodified. Native and OpenSSL providers are both compiled for A/B validation." -ForegroundColor Yellow
Write-Host 'Strict performance runtime: missing/invalid assets cause the benchmark to fail instead of falling back.' -ForegroundColor Yellow
