#!/usr/bin/env python3
"""R7.5 clean benchmark orchestrator.

Runs the hardened R7 matrix only after the R7.5 corpus preflight passes.
Never permits a partial corpus run to be represented as a clean full-corpus run.
"""
from __future__ import annotations
import argparse, json, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PREFLIGHT = ROOT / 'scripts' / 'compression-v2-qpdf-r7.5-clean-corpus-preflight.mjs'
MATRIX = ROOT / 'scripts' / 'compression-v2-qpdf-r7-capability-matrix.py'


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--start-server', action='store_true')
    parser.add_argument('--browser')
    parser.add_argument('--output-dir')
    parser.add_argument('--levels', nargs='+', choices=['light', 'recommended', 'strong'])
    args = parser.parse_args()

    preflight = subprocess.run(['node', str(PREFLIGHT)], cwd=ROOT)
    if preflight.returncode != 0:
        print('\nR7.5 STOPPED: corpus preflight did not pass. No partial benchmark was executed.', file=sys.stderr)
        return preflight.returncode

    command = [sys.executable, str(MATRIX), '--input-dir', str(ROOT / 'benchmark-corpus' / 'qpdf-r7'), '--recursive']
    if args.start_server:
        command.append('--start-server')
    if args.browser:
        command += ['--browser', args.browser]
    if args.output_dir:
        command += ['--output-dir', args.output_dir]
    if args.levels:
        command += ['--levels', *args.levels]
    return subprocess.run(command, cwd=ROOT).returncode

if __name__ == '__main__':
    raise SystemExit(main())
