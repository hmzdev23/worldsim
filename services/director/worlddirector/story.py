"""Select a short walkthrough from the canonical run timeline."""

MAX_HEADLINES = 8


def headline_events(events: list[dict]) -> list[dict]:
    """Keep the opening and outcome, then balance severity, variety, and timing."""
    if len(events) <= MAX_HEADLINES:
        return list(events)

    selected = {0, len(events) - 1}
    types = {events[index]["type"] for index in selected}
    countries = {events[index]["location"]["country_code"] for index in selected}

    def score(index: int) -> float:
        event = events[index]
        spacing = min(abs(index - other) for other in selected) / (len(events) - 1)
        return (event["severity"] + spacing
                + .35 * (event["type"] not in types)
                + .2 * (event["location"]["country_code"] not in countries))

    while len(selected) < MAX_HEADLINES:
        index = max((i for i in range(1, len(events) - 1) if i not in selected), key=score)
        selected.add(index)
        types.add(events[index]["type"])
        countries.add(events[index]["location"]["country_code"])
    return [events[index] for index in sorted(selected)]
