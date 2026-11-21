"""Talk to the simulation service (SIM-001, services/simulation) over HTTP.

Standard library only. GET /snapshot gives the Director its history, and
POST /events hands it a proposed batch to apply or reject.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any

from .errors import DirectorError

DEFAULT_SIM_URL = "http://127.0.0.1:8765"


def _request(url: str, data: Any = None, timeout_s: float = 10) -> Any:
    body = None if data is None else json.dumps(data).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="GET" if data is None else "POST")
    if body is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=timeout_s) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")
        raise DirectorError("sim_error", f"Simulation answered {exc.code} for {url}", detail) from None
    except (urllib.error.URLError, OSError) as exc:
        raise DirectorError("sim_unreachable", f"Could not reach the simulation at {url}: {exc}") from None
    except json.JSONDecodeError:
        raise DirectorError("sim_error", f"Simulation returned invalid JSON for {url}") from None


def get_snapshot(base_url: str = DEFAULT_SIM_URL, timeout_s: float = 10) -> dict:
    """The simulation's current snapshot: simulation/branch IDs and applied events so far."""
    snap = _request(base_url.rstrip("/") + "/snapshot", timeout_s=timeout_s)
    if not isinstance(snap, dict) or not isinstance(snap.get("events"), list):
        raise DirectorError("sim_error", "Simulation snapshot has no events list")
    return snap


def post_batch(batch: dict, base_url: str = DEFAULT_SIM_URL, timeout_s: float = 10) -> dict:
    """Send a proposed batch. Returns {"batch": ..., "rejections": [...]} from the simulation."""
    result = _request(base_url.rstrip("/") + "/events", data=batch, timeout_s=timeout_s)
    if not isinstance(result, dict) or "batch" not in result:
        raise DirectorError("sim_error", "Simulation response is missing the batch")
    return result
