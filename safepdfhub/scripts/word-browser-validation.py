"""Compatibility entry point for the current OCR browser acceptance suite.
Install Playwright/Chromium for QA and set PLAYWRIGHT_MODULE / WORD_BROWSER as needed.
"""
from pathlib import Path
import subprocess
raise SystemExit(subprocess.call(['node', 'scripts/ocr-browser-validation.cjs'], cwd=Path(__file__).resolve().parent.parent))
