"""CLI: python3 -m worlddirector "scenario" | --fixture NAME [--history FILE | --sim [URL]]

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
from .sim_client import DEFAULT_SIM_URL, get_snapshot, post_batch


def main(argv: Optional[Sequence[str]] = None) -> int:
    p = argparse.ArgumentParser(prog="worlddirector", description="Turn a scenario into proposed WORLD//SIM events.")
    p.add_argument("scenario", nargs="?", default="", help="hypothetical scenario text")
    p.add_argument("--fixture", help="replay a checked-in response instead of calling Codex (e.g. japan-earthquake)")
    p.add_argument("--history", help="JSON batch/snapshot of what already happened; the Director continues from it")
    p.add_argument(
        "--sim",
        nargs="?",
        const=DEFAULT_SIM_URL,
        metavar="URL",
        help=f"continue the running simulation: read its /snapshot as history and POST the batch to /events (default {DEFAULT_SIM_URL})",
    )
    p.add_argument(
        "--applied",
        action="store_true",
        help="mark every event applied, as the simulation would (used to regenerate contracts/fixtures/japan-earthquake.json)",
    )
    p.add_argument("--simulation-id")
    p.add_argument("--branch-id")
    p.add_argument("--first-id", type=int, help="number for the first evt-NNNN id (default: after the history)")
    p.add_argument("--model", default=DEFAULT_MODEL)
    p.add_argument("--effort", default=DEFAULT_EFFORT)
    p.add_argument("--timeout", type=float, default=DEFAULT_TIMEOUT_S, help="seconds")
    args = p.parse_args(argv)
    if not args.fixture and not args.scenario.strip():
        p.error("give a scenario or --fixture NAME")

    try:
        history = None
        if args.history:
            try:
                with open(args.history, encoding="utf-8") as f:
                    history = json.load(f)
            except (OSError, json.JSONDecodeError) as exc:
                raise DirectorError("invalid_history", f"Could not read history file: {exc}") from None
        if args.sim and history is None:
            history = get_snapshot(args.sim)
        batch = generate(
            args.scenario,
            fixture=args.fixture,
            history=history,
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
    if args.applied:
        batch = {**batch, "events": [{**e, "status": "applied"} for e in batch["events"]]}
    if args.sim:
        try:
            result = post_batch(batch, args.sim)
        except DirectorError as err:
            json.dump(err.to_dict(), sys.stderr, indent=2)
            sys.stderr.write("\n")
            return 1
        json.dump(result, sys.stdout, indent=2, ensure_ascii=False)
        sys.stdout.write("\n")
        applied = sum(e.get("status") == "applied" for e in result["batch"].get("events", []))
        sys.stderr.write(f"simulation applied {applied} of {len(batch['events'])} events\n")
        return 0
    json.dump(batch, sys.stdout, indent=2, ensure_ascii=False)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
