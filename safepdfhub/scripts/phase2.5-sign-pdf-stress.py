#!/usr/bin/env python3
"""SafePDFHub Sign PDF P2.5 browser stress harness.

This harness launches the Angular dev server and a Chromium-family browser against
an intentionally non-public, dev-only Sign PDF benchmark route.
It is a real workload benchmark, not a route-smoke test.
"""
from __future__ import annotations
import argparse, os, shutil, subprocess, sys, tempfile, time, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def log(message: str) -> None:
    print(f"[sign-pdf-stress] {message}", flush=True)

def browser_candidates() -> list[Path]:
    values = []
    for key in ("SAFE_PDFHUB_BROWSER", "CHROME_PATH"):
        value = os.environ.get(key)
        if value: values.append(Path(value))
    local = os.environ.get("LOCALAPPDATA", "")
    program_files = os.environ.get("ProgramFiles", r"C:\Program Files")
    program_files_x86 = os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")
    values += [
        Path(program_files_x86) / "Microsoft/Edge/Application/msedge.exe",
        Path(program_files) / "Microsoft/Edge/Application/msedge.exe",
        Path(program_files) / "Google/Chrome/Application/chrome.exe",
        Path(program_files_x86) / "Google/Chrome/Application/chrome.exe",
        Path(local) / "Microsoft/Edge/Application/msedge.exe" if local else Path(""),
        Path(local) / "Google/Chrome/Application/chrome.exe" if local else Path(""),
    ]
    for command in ("msedge", "google-chrome", "chrome", "chromium", "chromium-browser"):
        found = shutil.which(command)
        if found: values.append(Path(found))
    return [p for p in values if str(p) and p.exists()]

def wait_for_server(url: str, timeout: float = 120.0) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=2) as response:
                if response.status < 500: return
        except Exception:
            time.sleep(0.5)
    raise RuntimeError(f"Angular dev server did not become reachable: {url}")

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--start-server", action="store_true")
    parser.add_argument("--profile", choices=("quick", "full"), default="quick")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=4200)
    args = parser.parse_args()

    browsers = browser_candidates()
    if not browsers:
        print("ERROR: Chromium-family browser executable not found. Set SAFE_PDFHUB_BROWSER or CHROME_PATH.", file=sys.stderr)
        return 2
    browser = browsers[0]
    url = f"http://{args.host}:{args.port}/__dev/sign-pdf-benchmark?auto=1&profile={args.profile}"
    server = None
    temp_profile = tempfile.mkdtemp(prefix="safepdfhub-sign-benchmark-")
    try:
        if args.start_server:
            command = ["npm.cmd", "start", "--", "--host", args.host, "--port", str(args.port)] if os.name == "nt" else ["npm", "start", "--", "--host", args.host, "--port", str(args.port)]
            log(f"Starting Angular dev server: {' '.join(command)}")
            server = subprocess.Popen(command, cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        wait_for_server(url)
        log(f"Browser: {browser}")
        log(f"URL: {url}")
        start = time.perf_counter()
        command = [str(browser), "--headless=new", "--disable-gpu", "--no-sandbox", f"--user-data-dir={temp_profile}", "--dump-dom", "--virtual-time-budget=900000", url]
        completed = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, timeout=960)
        elapsed = (time.perf_counter() - start) * 1000
        dom = completed.stdout
        passed = "PASS" in dom and "signing-stress-results" in dom
        failed = "sign-pdf-benchmark" in dom and "FAIL" in dom
        log(f"Browser workload completed in {elapsed:.0f} ms.")
        log(f"Benchmark result table detected: {'PASS' if passed else 'FAIL'}")
        if failed:
            log("At least one benchmark scenario reported FAIL.")
        if completed.stderr.strip():
            log(completed.stderr.strip()[-2000:])
        return 0 if passed and not failed and completed.returncode == 0 else 1
    finally:
        if server is not None:
            log("Stopping Angular dev server.")
            server.terminate()
            try: server.wait(timeout=10)
            except subprocess.TimeoutExpired: server.kill()
        shutil.rmtree(temp_profile, ignore_errors=True)

if __name__ == "__main__":
    raise SystemExit(main())
