"""WORLD//WIRE: deterministic, clearly fictional news derived from applied simulation events."""

from .wire import SIMULATED_LABEL, derive_news, format_sim_time, news_for_event, news_from_stream

__all__ = ["SIMULATED_LABEL", "derive_news", "format_sim_time", "news_for_event", "news_from_stream"]
