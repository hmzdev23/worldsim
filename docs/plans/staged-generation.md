# Staged generation: proposed run semantics (#61)

Status: **proposal for Mathys and Anthony to agree.** Nothing here is implemented yet.

**Goal.** A prompted run becomes playable from a first, smaller batch while the Director prepares later events. It must never start from an invalid partial batch, and replays must stay deterministic.

## 1. Starting a run
- **First batch.** The Director returns a complete, validated first batch covering the opening of the scenario. That means at least 3 events, and the first event at the scenario's start.
- **Ready means fully applied.** The run becomes `ready` only when every event in the first batch is applied, exactly as today. If any event is rejected, the run fails (SIM-004 rules). Rejected events are never dropped to save the rest.
- **The status says more is coming.** It adds `"complete": false` and `"pending": "continuation"` while later batches are being prepared.

## 2. Run end and future events
- **`end_minutes`** stays "the last applied event" (SIM-003). While `complete` is false, it is provisional.
- **The clamp stays.** The clock still stops at the current end, so playback never runs ahead into time that has no events yet. The status adds `"waiting": true` while the run is paused at a provisional end.
- **Resuming.** When a continuation batch applies, the end moves out (already supported). A run that was waiting resumes on its own, while one the user paused stays paused.
- **Where a continuation starts.** It continues from history (`generate(history=…)`, DIR-002), so its events come after the last applied event. They can't land in the past: the clock can't pass the end, and a seek past a provisional end is clamped to the end until `complete` is true.
- **Pacing (SIM-005).** The span grows when a batch applies, so the per-tick step grows too. The UI should show the provisional span, and must not treat it as a final length while `complete` is false.

## 3. Failures
- **All or nothing.** A continuation batch is applied in full or not at all. The engine validates a copy first, and on any rejection discards the whole batch.
- **A failed continuation does not fail the run.** The run stays `ready` with what it has. It becomes `complete: true` and reports `"continuation_error": public_error(...)`, so the UI can say "This scenario ended early" without losing playback.
- **Timeouts.** A continuation gets its own `timeout_s`. A late result after the run was evicted is ignored, as SIM-004 does today.

## 4. Seek, replay and news
- **Applied events are permanent.** Seek and replay cover every event applied so far, in canonical order, each exactly once (SIM-002/003).
- **Replay after a continuation** includes the continuation, so the timeline is the same as if it had arrived in one batch.
- **News** reads applied, released events only (NEWS-005), so nothing changes for WORLD//WIRE.

## 5. Interfaces to agree
- **Director:**
  - `prepare_scenario(..., first_batch_events=N)` returns the first batch.
  - `continue_scenario(history, *, simulation_id, branch_id, timeout_s, stages=None)` returns the next batch or raises `DirectorError`.
  - The same `public_error` mapping applies to both.
- **Simulation:**
  - The registry schedules continuations after `ready`.
  - The run status adds `complete`, `pending`, `waiting` and `continuation_error`.
  - `Simulation.ingest_atomic(batch)`.
- **Web:** while `complete` is false, show "More events are being prepared" next to the timeline, plus `waiting` at a provisional end. Use `stage` / `elapsed_s` (PR #66) for progress.

## Open questions
1. How many events go in the first batch, and should the first batch use a lower effort? (Effort must stay `high`, per #61.)
2. How many continuations, and what is the time horizon for each one?
3. Should continuations run while paused, or only while playing?
4. Should a continuation also run for fixture runs (split one fixture into stages) to give deterministic tests?
