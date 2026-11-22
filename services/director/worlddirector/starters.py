"""Starter scenarios: ready-made prompts with an offline fixture behind each.

A starter is only a starting point. Every run of it gets a new variation seed
(variation.py), so watching the same starter twice gives two different
plausible futures.
"""

from __future__ import annotations

import json
from pathlib import Path

from .errors import DirectorError

STARTERS_PATH = Path(__file__).resolve().parent.parent / "fixtures" / "starters.json"


def list_starters() -> list[dict]:
    """[{fixture, title, category, icon, prompt, summary}] in display order."""
    from .runner import RUN_FIXTURES  # noqa: PLC0415 - avoid an import cycle

    data = json.loads(STARTERS_PATH.read_text(encoding="utf-8"))
    starters = data.get("starters")
    if not isinstance(starters, list):
        raise DirectorError("fixture_missing", "starters.json has no starters list")
    for s in starters:
        if s.get("fixture") not in RUN_FIXTURES:
            raise DirectorError("fixture_missing", f"Starter {s.get('fixture')!r} has no run fixture")
    return [dict(s) for s in starters]
