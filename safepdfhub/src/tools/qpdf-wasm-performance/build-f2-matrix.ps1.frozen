$ErrorActionPreference = 'Stop'

Set-Location -LiteralPath $PSScriptRoot

$projectSrc = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$matrixDir = Join-Path $PSScriptRoot 'dist-f2-matrix'
$assetDir = Join-Path $projectSrc 'assets/qpdf'

# F2.5 benchmark sizes. Keep the list small enough that the full matrix is
# practical while covering the usual cache/call-overhead transition points.
$bufferSizes = @(16384, 65536, 262144, 1048576, 4194304)

if (Test-Path $matrixDir) {
  Remove-Item $matrixDir -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $matrixDir | Out-Null

foreach ($size in $bufferSizes) {
  Write-Host ''
  Write-Host "============================================================" -ForegroundColor Cyan
  Write-Host "F2.5 build: AES bulk buffer $size bytes" -ForegroundColor Cyan
  Write-Host "============================================================" -ForegroundColor Cyan

  $tag = "safepdfhub-qpdf-f2-$size"
  docker build --progress=plain `
    --build-arg QPDF_AES_BULK_BUFFER_SIZE=$size `
    -t $tag `
    .
  if ($LASTEXITCODE -ne 0) {
    throw "F2.5 Docker build failed for buffer $size bytes (exit code $LASTEXITCODE)."
  }

  $container = "safepdfhub-qpdf-f2-$size-build"
  docker rm -f $container 2>$null | Out-Null
  docker create --name $container $tag | Out-Null

  $outDir = Join-Path $matrixDir "$size"
  New-Item -ItemType Directory -Force -Path $outDir | Out-Null

  try {
    docker cp "${container}:/out/." $outDir
  }
  finally {
    docker rm $container 2>$null | Out-Null
  }

  $wasmPath = Join-Path $outDir 'qpdf-performance.wasm'
  $jsPath = Join-Path $outDir 'qpdf-performance.js'
  if (!(Test-Path $wasmPath)) { throw "Missing WASM artifact for buffer $size." }
  if (!(Test-Path $jsPath)) { throw "Missing JS artifact for buffer $size." }

  $validator = Join-Path $PSScriptRoot 'validate-wasm-exports.py'
  $python = Get-Command python3 -ErrorAction SilentlyContinue
  if (-not $python) { $python = Get-Command python -ErrorAction SilentlyContinue }
  if ($python) {
    & $python.Source $validator $wasmPath $jsPath
    if ($LASTEXITCODE -ne 0) {
      throw "Artifact contract validation failed for buffer $size bytes (exit code $LASTEXITCODE)."
    }
  }

  $wasm = [System.IO.File]::ReadAllBytes($wasmPath)
  if ($wasm.Length -lt 8 -or $wasm[0] -ne 0 -or $wasm[1] -ne 0x61 -or $wasm[2] -ne 0x73 -or $wasm[3] -ne 0x6d -or $wasm[4] -ne 1) {
    throw "WASM validation failed for buffer $size."
  }
}

Write-Host ''
Write-Host 'F2.5 build matrix complete.' -ForegroundColor Green
Write-Host "Artifacts: $matrixDir" -ForegroundColor Green
Write-Host ''
Write-Host 'Next step: benchmark each artifact against the same PDF corpus and' -ForegroundColor Yellow
Write-Host 'promote only the fastest configuration that passes correctness tests.' -ForegroundColor Yellow
Write-Host ''
Write-Host "Production asset destination: $assetDir" -ForegroundColor DarkGray
