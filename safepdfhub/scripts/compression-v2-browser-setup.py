#!/usr/bin/env python3
"""Install the Python dependencies and Chromium required by the V2 browser acceptance harness."""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REQUIREMENTS = Path(__file__).resolve().with_name("requirements-compression-v2-browser.txt")


def run(args: list[str]) -> None:
    print("[V2-BROWSER-SETUP]", " ".join(args), flush=True)
    subprocess.run(args, cwd=ROOT, check=True)


if __name__ == "__main__":
    run([sys.executable, "-m", "pip", "install", "-r", str(REQUIREMENTS)])
    run([sys.executable, "-m", "playwright", "install", "chromium"])
    print("[V2-BROWSER-SETUP] Browser acceptance dependencies are ready.", flush=True)
