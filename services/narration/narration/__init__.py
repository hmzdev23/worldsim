"""WORLD//SIM recap narration (RECAP-002): storyboard scenes -> ElevenLabs speech."""

from .mp3 import mp3_duration
from .narrate import (
    DEFAULT_MODEL_ID,
    DEFAULT_VOICE_ID,
    NarrationError,
    cache_key,
    load_settings,
    load_storyboard,
    narrate,
)

__all__ = [
    "DEFAULT_MODEL_ID",
    "DEFAULT_VOICE_ID",
    "NarrationError",
    "cache_key",
    "load_settings",
    "load_storyboard",
    "mp3_duration",
    "narrate",
]
