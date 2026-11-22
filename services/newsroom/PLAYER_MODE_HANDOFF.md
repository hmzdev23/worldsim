# Player mode handoff: WORLD//WIRE (Amir)

This is a prototype for team review, written by Anthony's agent in your folder. Design: [docs/plans/player-mode.md](../../docs/plans/player-mode.md).

## What changed (`worldwire/wire.py`)
- **`player_decision(event)`** returns `payload.decision` for an event whose `provenance.source` is `"user"`, otherwise `None`.
- **A decision event gets one clearly fictional story.**
  - Headline: `"<Role title> decides: <action label>"`, or `"Decision: …"` if that's too long.
  - Dek: `"Simulated player decision in <place>. What follows on this branch is a fictional model, not a forecast."`
- **Consequence events** that cite a decision as a parent end their dek with `"Follows the decision to <action label>."`
- **A decision isn't counted as a repeat of its event type**, so later fixture events keep their first-time wording ("Evacuations ordered in …", not "More evacuations …").

The feed fields are unchanged. The committed Japan feed is unchanged too, since it has no user events, and its drift test passes.

## Why this way
- **The player's decision stays visibly separate from scenario events, with one story per decision.**
- **Consequences say where they came from.**

## Tests
`tests/newsroom/test_player_decisions.py` (4 tests): the single named story, the "Follows the decision" note, the repeat counting, and that only user events with a decision count.
