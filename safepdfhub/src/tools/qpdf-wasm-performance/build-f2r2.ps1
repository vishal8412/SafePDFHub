$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

$baseImage = 'safepdfhub-qpdf-wasm-performance:latest'
$builderImage = 'safepdfhub-qpdf-wasm-performance-build:latest'
$tag = 'safepdfhub-qpdf-wasm-f2r2:latest'
$buildDir = Join-Path $PSScriptRoot 'dist-f2r2'
$projectSrc = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$assetDir = Join-Path $projectSrc 'assets/qpdf/f2r2'

Write-Host 'Building SafePDFHub F2-R.2 isolated PDF-pipeline candidate...' -ForegroundColor Cyan
Write-Host "Required validated base image: $baseImage" -ForegroundColor DarkGray

$images = docker image ls --format '{{.Repository}}:{{.Tag}}'
if ($images -notcontains $baseImage) {
  throw "F2-R.2 requires the successful F2-R.1 image '$baseImage'. Run build.ps1 first; no source changes are made by this script."
}

# The normal F2-R.1 Dockerfile ends in a scratch artifact image. F2-R.2 needs
# the validated builder stage as its base so it can create an isolated qpdf
# source copy without rebuilding the dependency/toolchain layers from scratch.
if ($images -notcontains $builderImage) {
  Write-Host 'Creating the reusable F2-R.1 builder-stage image (cached layers are reused).' -ForegroundColor DarkGray
  docker build --progress=plain --target build -t $builderImage -f Dockerfile .
  if ($LASTEXITCODE -ne 0) { throw "F2-R.1 builder-stage image creation failed with exit code $LASTEXITCODE." }
}

docker build --progress=plain -f Dockerfile.f2r2 -t $tag .
if ($LASTEXITCODE -ne 0) {
  throw "F2-R.2 Docker build failed. Inspect the FIRST compiler/CMake error above."
}

$container = 'safepdfhub-f2r2-build'
docker rm -f $container 2>$null | Out-Null
$global:LASTEXITCODE = 0
docker create --name $container $tag /bin/sh | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'F2-R.2 output extraction container could not be created.' }

try {
  if (Test-Path $buildDir) { Remove-Item $buildDir -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $buildDir | Out-Null
  docker cp "${container}:/out/." $buildDir
  if ($LASTEXITCODE -ne 0) { throw 'F2-R.2 output extraction failed.' }
} finally {
  docker rm $container *> $null
  $global:LASTEXITCODE = 0
}

foreach ($path in @(
  (Join-Path $buildDir 'f2r2-reference/qpdf-reference.js'),
  (Join-Path $buildDir 'f2r2-reference/qpdf-reference.wasm'),
  (Join-Path $buildDir 'f2r2-candidate/qpdf-f2r2-candidate.js'),
  (Join-Path $buildDir 'f2r2-candidate/qpdf-f2r2-candidate.wasm')
)) {
  if (!(Test-Path $path)) { throw "Missing F2-R.2 artifact: $path" }
}

if (Test-Path $assetDir) { Remove-Item $assetDir -Recurse -Force }
New-Item -ItemType Directory -Force -Path $assetDir | Out-Null
Copy-Item (Join-Path $buildDir 'f2r2-reference/*') $assetDir -Force
Copy-Item (Join-Path $buildDir 'f2r2-candidate/*') $assetDir -Force

Write-Host ''
Write-Host 'F2-R.2 build complete.' -ForegroundColor Green
Write-Host "Reference: $assetDir/qpdf-reference.js + qpdf-reference.wasm" -ForegroundColor Green
Write-Host "Candidate: $assetDir/qpdf-f2r2-candidate.js + qpdf-f2r2-candidate.wasm" -ForegroundColor Green
Write-Host 'IMPORTANT: candidate artifacts are validation-only and must never replace qpdf-performance.js/.wasm.' -ForegroundColor Yellow
