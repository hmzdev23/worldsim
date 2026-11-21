"""CLI: python3 -m worlddirector "scenario" | --fixture japan-earthquake

Prints the validated batch as JSON on stdout. On failure prints
{"error": code, "message": ...} on stderr and exits 1 (2 for bad usage).
"""

from __future__ import annotations

import argparse
import json
import sys
from typing import Optional, Sequence

from .director import DEFAULT_EFFORT, DEFAULT_MODEL, DEFAULT_TIMEOUT_S, generate
from .errors import DirectorError


def main(argv: Optional[Sequence[str]] = None) -> int:
    p = argparse.ArgumentParser(prog="worlddirector", description="Turn a scenario into proposed WORLD//SIM events.")
    p.add_argument("scenario", nargs="?", default="", help="hypothetical scenario text")
    p.add_argument("--fixture", help="replay a checked-in response instead of calling Codex (e.g. japan-earthquake)")
    p.add_argument("--simulation-id")
    p.add_argument("--branch-id", default="main")
    p.add_argument("--first-id", type=int, default=1, help="number for the first evt-NNNN id")
    p.add_argument("--model", default=DEFAULT_MODEL)
    p.add_argument("--effort", default=DEFAULT_EFFORT)
    p.add_argument("--timeout", type=float, default=DEFAULT_TIMEOUT_S, help="seconds")
    args = p.parse_args(argv)
    if not args.fixture and not args.scenario.strip():
        p.error("give a scenario or --fixture NAME")

    try:
        batch = generate(
            args.scenario,
            fixture=args.fixture,
            simulation_id=args.simulation_id,
            branch_id=args.branch_id,
            first_id=args.first_id,
            model=args.model,
            effort=args.effort,
            timeout_s=args.timeout,
        )
    except DirectorError as err:
        json.dump(err.to_dict(), sys.stderr, indent=2)
        sys.stderr.write("\n")
        return 1
    json.dump(batch, sys.stdout, indent=2, ensure_ascii=False)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
