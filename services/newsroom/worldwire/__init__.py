"""WORLD//WIRE: deterministic, clearly fictional news derived from applied simulation events."""

from .live import news_response, released_events
from .wire import SIMULATED_LABEL, WireFeed, derive_news, format_sim_time, news_for_event, news_from_stream

__all__ = [
    "SIMULATED_LABEL",
    "WireFeed",
    "derive_news",
    "format_sim_time",
    "news_for_event",
    "news_from_stream",
    "news_response",
    "released_events",
]
