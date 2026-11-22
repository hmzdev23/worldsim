"""Run the simulation server.

python -m worldsim_sim [fixture.json] [--port 8765] [--start-minutes 390]
                      [--speed 1] [--paused] [--minutes-per-second 1]
                      [--scenario-fixture NAME] [--director-timeout 180]
                      [--scenario-pace 5]

The fixture is the demo served at /stream. Runs created with POST /scenarios
call the Director; --scenario-fixture makes every run use that Director
fixture instead (offline, deterministic, no model credentials).

Pacing: the demo moves --minutes-per-second sim minutes per wall second at 1x.
Each scenario run moves --scenario-pace percent of its own length per tick
(--tick-seconds), so a run of any length plays in about 20 ticks at 1x.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from .engine import CONTRACTS, SPEEDS, Simulation

DEFAULT_FIXTURE = CONTRACTS / "fixtures" / "japan-earthquake.json"


def build(argv: list[str] | None = None):
    parser = argparse.ArgumentParser(prog="worldsim_sim", description=__doc__.splitlines()[0])
    parser.add_argument("fixture", nargs="?", type=Path, default=DEFAULT_FIXTURE)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--start-minutes", type=int, default=0, help="initial sim time (402 = quake in the demo)")
    parser.add_argument("--speed", type=int, choices=SPEEDS, default=1)
    parser.add_argument("--paused", action="store_true", help="start paused")
    parser.add_argument("--minutes-per-second", type=float, default=1.0, help="sim minutes per wall second at 1x")
    parser.add_argument("--tick-seconds", type=float, default=1.0)
    parser.add_argument("--scenario-fixture", metavar="NAME",
                        help="serve every POST /scenarios run from this Director fixture (e.g. global-pandemic)")
    parser.add_argument("--director-timeout", type=float, default=180.0, help="seconds per scenario generation")
    parser.add_argument("--scenario-pace", type=float, default=6, metavar="PERCENT",
                        help="percent of a scenario run's length per tick at 1x (default 6: the clock crosses a run in about 17 s, plus a stop on each event)")
    args = parser.parse_args(argv)

    from .scenarios import ScenarioRegistry
    from .server import create_app

    batch = json.loads(args.fixture.read_text(encoding="utf-8"))
    sim = Simulation.from_batch(batch, speed=args.speed, state="paused" if args.paused else "playing")
    sim.seek(args.start_minutes)
    if not 0 < args.scenario_pace <= 100:
        parser.error("--scenario-pace must be a percent in (0, 100]")
    scenarios = ScenarioRegistry(
        timeout_s=args.director_timeout, fixture=args.scenario_fixture, pace=args.scenario_pace / 100
    )
    app = create_app(
        sim, tick_seconds=args.tick_seconds, minutes_per_second=args.minutes_per_second, scenarios=scenarios
    )
    return app, args


def main(argv: list[str] | None = None) -> None:
    import uvicorn

    app, args = build(argv)
    uvicorn.run(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
