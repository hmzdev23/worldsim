# NEWS-005 · Live WORLD//WIRE for any scenario

Issue #51. Hand the adapter to Anthony in #49 and agree with Hamza in #52 on matching items to the active run.

Owner Amir. Work in `services/newsroom/` and `tests/newsroom/`.

The templates already derive good copy for applied events from any scenario. The browser imports only the generated Japan feed, so other runs get fallback text. The runtime needs one source of real template copy for both the archive and the alert.

## Implement

- Give Anthony an importable path from a run's released snapshot to WORLD//WIRE items. Reuse `derive_news` and existing stream semantics. An initial implementation can derive from the applied prefix at each read. Preserve headline, dek, category, severity, simulation time, and event focus.
- Agree on the news response with Anthony and Hamza. One option is an envelope with `simulation_id`, `branch_id`, and `items`. Keep the item shape. Anthony mounts the route and owns simulation service dependencies. Hamza replaces the static lookup and filters race-prone responses against the current applied events.
- Validate concise fictional copy for Iceland and an unfamiliar event label. Preserve chronological context so a follow-up reads the same during normal play and after a seek. Do not carry state across runs keyed only by event ID.
- Keep the offline CLI and Japan generated-feed checks as regression coverage. The runtime uses the Python newsroom and the current run's data.

## Done when

An applied event from a non-Japan run yields the same story in its live alert and archive. Offline tests cover run isolation, replay, snapshot replacement, and withholding future items until their events are released. Provide Anthony with the adapter and Hamza with a representative item and the semantics for matching events.
