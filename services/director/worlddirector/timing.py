"""Stage timings for scenario preparation (DIR-006, #61).

Pass a `Stages` to `prepare_scenario` (or `generate`) to record how long each
stage of one real preparation took, and optionally to hear when each stage
starts (for progress shown in the UI):

    stages = Stages(on_stage=lambda name: print("now:", name))
    batch = prepare_scenario(prompt, simulation_id=run_id, stages=stages)
    stages.to_json()
    # {"stages": [{"name": "prompt", "seconds": 0.0004}, {"name": "model", "seconds": 41.2},
    #             {"name": "parse", "seconds": 0.0011}, {"name": "validate", "seconds": 0.0213}],
    #  "total_seconds": 41.23}

Stages, in order:
  prompt   - prompt checks and building the model prompt
  model    - the `codex exec` process: CLI startup, sign-in and the model call
             together (see `python -m worlddirector.timing` for a startup estimate)
  parse    - reading the model's JSON answer
  validate - validation and batch assembly (the contract, causal order, IDs)
Fixture runs record `fixture` instead of `model` and `parse`.

Recording a stage is the only effect. A failing stage is still recorded, and
the error propagates unchanged.
"""

from __future__ import annotations

import contextlib
import time
from typing import Callable, Iterator, Optional

STAGES = ("prompt", "model", "fixture", "parse", "validate")


class Stages:
    def __init__(
        self,
        on_stage: Optional[Callable[[str], None]] = None,
        clock: Callable[[], float] = time.perf_counter,
    ) -> None:
        self.on_stage = on_stage
        self.clock = clock
        self.seconds: dict[str, float] = {}

    @contextlib.contextmanager
    def stage(self, name: str) -> Iterator[None]:
        if self.on_stage is not None:
            self.on_stage(name)
        start = self.clock()
        try:
            yield
        finally:
            self.seconds[name] = self.seconds.get(name, 0.0) + (self.clock() - start)

    @property
    def total(self) -> float:
        return sum(self.seconds.values())

    def to_json(self) -> dict:
        return {
            "stages": [{"name": name, "seconds": round(sec, 4)} for name, sec in self.seconds.items()],
            "total_seconds": round(self.total, 4),
        }


def stage(stages: Optional[Stages], name: str):
    """`stages.stage(name)`, or a no-op when timings are not requested."""
    return stages.stage(name) if stages is not None else contextlib.nullcontext()


def main(argv: Optional[list] = None) -> int:
    """python -m worlddirector.timing "prompt" [--runs 3] [--fixture NAME] [--startup-probe]

    Prepares the scenario N times and prints each run's stage timings plus
    the median per stage, as JSON. With --startup-probe it also times
    `codex --version`, an estimate of CLI process startup alone, so the model
    stage can be split into startup and model time. Run it on the machine
    with the signed-in Codex CLI.
    """
    import argparse
    import json
    import shutil
    import statistics
    import subprocess

    from .errors import DirectorError
    from .runner import prepare_scenario

    p = argparse.ArgumentParser(prog="worlddirector.timing", description=main.__doc__.splitlines()[0])
    p.add_argument("prompt")
    p.add_argument("--runs", type=int, default=3)
    p.add_argument("--fixture", help="time a fixture run instead of the model (offline check)")
    p.add_argument("--timeout", type=float, default=240)
    p.add_argument("--startup-probe", action="store_true", help="also time `codex --version` N times")
    args = p.parse_args(argv)

    runs = []
    for index in range(args.runs):
        stages = Stages()
        error = None
        try:
            prepare_scenario(args.prompt, simulation_id=f"timing-{index + 1}", timeout_s=args.timeout,
                             fixture=args.fixture, stages=stages)
        except DirectorError as exc:
            error = exc.code
        runs.append({**stages.to_json(), "error": error})

    names = [n for n in STAGES if any(n in {s["name"] for s in r["stages"]} for r in runs)]
    median = {
        name: round(statistics.median(s["seconds"] for r in runs for s in r["stages"] if s["name"] == name), 4)
        for name in names
    }
    report: dict = {"runs": runs, "median_seconds": median}
    if args.startup_probe:
        codex = shutil.which("codex")
        probes = []
        for _ in range(args.runs if codex else 0):
            start = time.perf_counter()
            subprocess.run([codex, "--version"], capture_output=True, check=False)
            probes.append(round(time.perf_counter() - start, 4))
        report["codex_startup_seconds"] = probes or None
    print(json.dumps(report, indent=2))
    return 0 if all(r["error"] is None for r in runs) else 1


if __name__ == "__main__":
    raise SystemExit(main())
