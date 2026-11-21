# WEB-005 · Prompt-to-play console

Issue #52. Review #49 for the run API and #51 for live news. Bring #48 into this branch before integrating alert changes.

Owner Hamza. Work in `apps/web/`, including desktop E2E.

## Product and design

A user types a fictional scenario, sees it prepare, then watches the map, clock, impact panel, and WORLD//WIRE tell the same unfolding story. Keep the map as the main canvas. Put a compact prompt/run bar above it, pin the scrubber within reach below it, and put impacts and the news archive in one inspector. Keep the event headline overlay from #48.

Use dark graphite surfaces, hairline separators, restrained density, and quiet secondary controls. Give WORLD//SIM its own layout and keep amber as the signal for playback and breaking headlines. The map imagery carries the visual detail. [Linear on visual hierarchy and density](https://linear.app/now/behind-the-latest-design-refresh)

Use CSS `system-ui` for Apple SF Pro and native system fallbacks elsewhere. Remove unused Space Grotesk imports/dependencies when switching the app. Use tabular numerals for the clock and stats, with mono reserved for technical values where needed. [Apple on system fonts](https://developer.apple.com/documentation/technologyoverviews/managing-the-fonts-for-your-app)

Use Motion for React (`motion/react`, formerly Framer Motion) for a short press response, inspector entry, and headline swaps. Keep the map and existing playback engine independent of those animations. Honor OS reduced motion, preserve focus order and announce only the currently visible headline. [Motion accessibility](https://motion.dev/docs/react-accessibility)

## Integrate

- For a new run, submit the prompt to Anthony's scenario endpoint and use its run ID and state to show progress or retry. Keep the existing Japan demo available as a sample.
- Use the run's metadata, timeline, and stream to initialize the map and playback. Focus the first event using event coordinates. The first location, labels, markers, and end time come from the run.
- Consume Amir's live WORLD//WIRE items for both archive and alert. Key news by run and event. Match fetched items to the current applied event set and ignore superseded requests when switching or seeking. Keep enqueueing limited to newly applied stream events, using #48 as the starting point.
- Use Anthony's local session routes and Amir's news envelope. Review this work stacked on #48 while the alert PR is open. Target main after #48 lands.

## Done when

From a clean browser session, the desktop test submits a prompt against a deterministic non-Japan generator, plays the run, checks its timing and non-Japan map focus and card copy, and seeks and replays. Starting a second scenario cleans up the previous run's connection, alerts, and state. Japan still plays as a sample. Check keyboard input, visibility of the focused marker, and reduced motion. Run build, typecheck, and desktop Playwright.

## Follow-up ideas

- Explain the event chain. Selecting a headline highlights its causes and downstream effects via `parent_ids`.
- Try an intervention. Fork an airport closure scenario before a decision, choose an earlier reopening, then compare delays and rerouted traffic on matching timelines.
- Share a replay. Save the event log and a time range as a link that replays the same map and headlines.
