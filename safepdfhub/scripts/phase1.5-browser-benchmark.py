#!/usr/bin/env python3
"""SafePDFHub Sign PDF browser route smoke/benchmark.

This is a browser-route smoke benchmark, not a large-PDF memory benchmark.
It starts the Angular dev server when requested, discovers a Chromium-family
browser on Windows/macOS/Linux, loads /tools/sign-pdf, and verifies that the
route renders expected Sign PDF content.

Browser discovery order:
1. SAFE_PDFHUB_BROWSER environment variable
2. CHROME_PATH environment variable
3. Microsoft Edge
4. Google Chrome
5. Chromium / chromium-browser

A browser may also be supplied explicitly with --browser.
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

DEFAULT_URL = "http://127.0.0.1:4200/tools/sign-pdf"
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 4200
SERVER_START_TIMEOUT = 60.0
REQUEST_TIMEOUT = 2.0


def log(message: str) -> None:
    print(f"[browser-benchmark] {message}")


def executable_candidates() -> list[Path | str]:
    candidates: list[Path | str] = []

    for env_name in ("SAFE_PDFHUB_BROWSER", "CHROME_PATH"):
        value = os.environ.get(env_name)
        if value:
            candidates.append(Path(value).expanduser())

    if os.name == "nt":
        local_app_data = os.environ.get("LOCALAPPDATA", "")
        program_files = os.environ.get("PROGRAMFILES", r"C:\Program Files")
        program_files_x86 = os.environ.get("PROGRAMFILES(X86)", r"C:\Program Files (x86)")

        candidates.extend(
            [
                Path(program_files) / "Microsoft" / "Edge" / "Application" / "msedge.exe",
                Path(program_files_x86) / "Microsoft" / "Edge" / "Application" / "msedge.exe",
                Path(local_app_data) / "Microsoft" / "Edge" / "Application" / "msedge.exe",
                Path(program_files) / "Google" / "Chrome" / "Application" / "chrome.exe",
                Path(program_files_x86) / "Google" / "Chrome" / "Application" / "chrome.exe",
                Path(local_app_data) / "Google" / "Chrome" / "Application" / "chrome.exe",
                Path(program_files) / "Chromium" / "Application" / "chrome.exe",
            ]
        )

    for name in ("msedge", "microsoft-edge", "google-chrome", "chrome", "chromium", "chromium-browser"):
        found = shutil.which(name)
        if found:
            candidates.append(found)

    return candidates


def find_browser(explicit: str | None) -> str:
    if explicit:
        path = Path(explicit).expanduser()
        if path.is_file():
            return str(path.resolve())
        resolved = shutil.which(explicit)
        if resolved:
            return resolved
        raise RuntimeError(f"Requested browser was not found: {explicit}")

    seen: set[str] = set()
    for candidate in executable_candidates():
        value = str(candidate)
        key = os.path.normcase(os.path.abspath(value)) if os.path.sep in value else value
        if key in seen:
            continue
        seen.add(key)

        path = Path(value)
        if path.is_file():
            return str(path.resolve())

        resolved = shutil.which(value)
        if resolved:
            return resolved

    raise RuntimeError(
        "No Chromium-family browser executable was found. "
        "Install Microsoft Edge/Google Chrome, or set SAFE_PDFHUB_BROWSER "
        "or CHROME_PATH to the browser executable."
    )


def server_reachable(url: str) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=REQUEST_TIMEOUT) as response:
            return 200 <= response.status < 500
    except (urllib.error.URLError, TimeoutError, OSError):
        return False


def wait_for_server(url: str, process: subprocess.Popen[bytes]) -> None:
    deadline = time.monotonic() + SERVER_START_TIMEOUT
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(
                f"Angular dev server exited before becoming reachable (exit code {process.returncode})."
            )
        if server_reachable(url):
            return
        time.sleep(0.5)
    raise RuntimeError(f"Angular dev server did not become reachable within {SERVER_START_TIMEOUT:.0f}s: {url}")


def start_server(host: str, port: int) -> subprocess.Popen[bytes]:
    npm = "npm.cmd" if os.name == "nt" else "npm"
    command = [npm, "start", "--", "--host", host, "--port", str(port)]
    log("Starting Angular dev server: " + " ".join(command))
    return subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def run_browser(browser: str, url: str) -> float:
    command = [
        browser,
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--disable-background-networking",
        "--disable-extensions",
        "--hide-scrollbars",
        "--virtual-time-budget=7000",
        "--dump-dom",
        url,
    ]

    log(f"Browser: {browser}")
    log(f"URL: {url}")
    started = time.perf_counter()
    completed = subprocess.run(command, capture_output=True, text=True, timeout=30, check=False)
    elapsed_ms = (time.perf_counter() - started) * 1000

    if completed.returncode != 0:
        stderr = completed.stderr.strip()
        raise RuntimeError(
            f"Browser exited with code {completed.returncode}."
            + (f" stderr: {stderr[-1000:]}" if stderr else "")
        )

    dom = completed.stdout
    normalized = dom.lower()
    if "sign pdf" not in normalized and "sign-pdf" not in normalized:
        raise RuntimeError("Sign PDF route did not expose expected Sign PDF content in the browser DOM.")

    log(f"Route smoke completed in {elapsed_ms:.0f} ms.")
    log("Sign PDF content detected in DOM: PASS")
    return elapsed_ms


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--start-server", action="store_true", help="Start the Angular dev server before running the browser.")
    parser.add_argument("--browser", help="Explicit Chromium-family executable path or command name.")
    parser.add_argument("--host", default=DEFAULT_HOST, help=f"Angular host (default: {DEFAULT_HOST}).")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help=f"Angular port (default: {DEFAULT_PORT}).")
    parser.add_argument("--url", default=None, help="Full URL to smoke-test. Defaults to the configured host/port Sign PDF route.")
    args = parser.parse_args()

    url = args.url or f"http://{args.host}:{args.port}/tools/sign-pdf"
    server: subprocess.Popen[bytes] | None = None

    try:
        browser = find_browser(args.browser)

        if args.start_server:
            server = start_server(args.host, args.port)
            wait_for_server(f"http://{args.host}:{args.port}/", server)
        elif not server_reachable(url):
            raise RuntimeError(
                f"The target URL is not reachable: {url}. Start the app with `npm start` "
                "or use `--start-server`."
            )

        run_browser(browser, url)
        log("Browser route smoke benchmark: PASS")
        return 0

    except Exception as exc:  # noqa: BLE001 - CLI boundary
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    finally:
        if server is not None and server.poll() is None:
            log("Stopping Angular dev server.")
            server.terminate()
            try:
                server.wait(timeout=10)
            except subprocess.TimeoutExpired:
                server.kill()
                server.wait(timeout=5)


if __name__ == "__main__":
    raise SystemExit(main())
