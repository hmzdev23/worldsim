#!/usr/bin/env python3
"""Stage and render one of the manually authored Three.js recap prototypes."""
from __future__ import annotations
import argparse
import os
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parent
VARIANTS = ('japan', 'japan-people-legacy', 'montreal-v1', 'montreal-v2', 'montreal-wip-v3')

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('variant', choices=VARIANTS)
    parser.add_argument('--lemo', default=os.environ.get('LEMO_ROOT'), help='path to an installed Lemo-Opuscar checkout; or set LEMO_ROOT')
    parser.add_argument('--workers', type=int, default=3)
    parser.add_argument('--fps', type=int, default=30)
    parser.add_argument('--width', type=int, default=1080)
    parser.add_argument('--height', type=int, default=1920)
    parser.add_argument('--shot', type=int, choices=range(8), help='render only this zero-based shot; skips assembly')
    parser.add_argument('--prepare-only', action='store_true', help='stage assets and audio without rendering')
    parser.add_argument('--assemble-only', action='store_true', help='assemble already rendered shots')
    args = parser.parse_args()
    if args.workers < 1 or args.fps < 1 or min(args.width, args.height) < 16 or args.width % 2 or args.height % 2:
        parser.error('workers and fps must be positive; width and height must be even and at least 16')
    if args.shot is not None and args.assemble_only:
        parser.error('--shot and --assemble-only cannot be combined')
    src = ROOT / 'films' / args.variant
    staged = ROOT / 'build' / args.variant
    staged.mkdir(parents=True, exist_ok=True)
    shutil.copytree(src, staged, dirs_exist_ok=True)
    shutil.copytree(ROOT / 'assets', staged / 'assets', dirs_exist_ok=True)
    (staged / 'shots').mkdir(exist_ok=True)
    if args.prepare_only:
        print(f'Staged {args.variant} in {staged}')
        return 0
    if not args.assemble_only:
        if not args.lemo:
            parser.error('give --lemo PATH or set LEMO_ROOT to the renderer checkout')
        renderer = Path(args.lemo).expanduser().resolve() / 'core/render/video.mjs'
        if not renderer.is_file():
            parser.error(f'renderer not found at {renderer}')
        for shot in ([args.shot] if args.shot is not None else range(8)):
            command = ['node', str(renderer), str(staged), '--fps', str(args.fps), '--workers', str(args.workers),
                       '--size', f'{args.width}x{args.height}', '--q', f'shot={shot}',
                       '--out', str(staged / 'shots' / f'shot-{shot + 1:02}.mp4')]
            subprocess.run(command, check=True)
        if args.shot is not None:
            print(f'Single shot available under {staged / "shots"}; assembly skipped.')
            return 0
    subprocess.run([sys.executable, str(staged / 'assemble.py')], cwd=staged, check=True)
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
