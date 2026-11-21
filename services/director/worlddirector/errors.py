from __future__ import annotations


class DirectorError(Exception):
    """A generation failure the caller can report or retry.

    code is one of: invalid_scenario, codex_missing, codex_timeout,
    codex_failed, invalid_json, invalid_events, invalid_history, fixture_missing.
    """

    def __init__(self, code: str, message: str, detail: str = "") -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.detail = detail

    def to_dict(self) -> dict:
        out = {"error": self.code, "message": self.message}
        if self.detail:
            out["detail"] = self.detail[-2000:]
        return out
