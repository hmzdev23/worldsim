import { ArrowCounterClockwise, Crosshair, Pause, Play, SkipBack, SkipForward } from "@phosphor-icons/react";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import feed from "../../../services/newsroom/feeds/japan-earthquake.json";
import { japanDemo } from "../lib/earthquake";
import { readScenarioNews, streamUrl } from "../lib/scenario-api";
import { fallbackNewsItem, formatSimTime, pacingSummary, sameRun, type NewsItem, type Playback, type RunIdentity, type ScenarioEvent, type ScenarioRun, type StreamMessage } from "../lib/scenario";
import { eventPins, stepBoundaries } from "../lib/playback";
import { HeadlineAlert } from "./headline-alert";
import { ImpactDashboard } from "./impact-dashboard";
import { WorldMap, type WorldMapHandle } from "./world-map";
import { WorldWire } from "./world-wire";

const speeds = [1, 2, 4];
const rate = Number(process.env.NEXT_PUBLIC_SIMULATION_MINUTES_PER_SECOND ?? 60);
const minutesPerSecond = Number.isFinite(rate) && rate > 0 ? rate : 60;
const demoReports = new Map<string, NewsItem>(feed.map((item) => [item.event_id, item]));

type EventState = {
  identity: RunIdentity;
  revision: number;
  applied: ScenarioEvent[];
  queue: ScenarioEvent[];
};

function useRunNews(run: ScenarioRun, events: EventState, isDemo: boolean) {
  const { applied, revision, identity } = events;
  const [news, setNews] = useState<{ revision: number; applied: ScenarioEvent[]; items: Map<string, NewsItem> }>();

  useEffect(() => {
    if (isDemo || applied.length === 0) return;
    const controller = new AbortController();
    const currentIds = new Set(applied.map((event) => event.id));
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]);

    function receive(items: NewsItem[]) {
      if (controller.signal.aborted) return;
      setNews((previous) => {
        const reports = new Map(previous?.revision === revision ? previous.items : undefined);
        for (const item of items) {
          if (currentIds.has(item.event_id) && item.focus?.event_id === item.event_id) reports.set(item.event_id, item);
        }
        return { revision, applied, items: reports };
      });
    }

    readScenarioNews(run, signal).then(receive, () => receive([]));
    return () => controller.abort();
  }, [applied, isDemo, revision, run]);

  return useMemo(() => {
    const currentNews = news?.revision === revision ? news : undefined;
    const loading = !isDemo && applied.length > 0 && currentNews?.applied !== applied;
    const items = new Map<string, NewsItem>();
    for (const event of applied) {
      const item = isDemo && sameRun(identity, japanDemo) ? demoReports.get(event.id) : currentNews?.items.get(event.id);
      if (item) items.set(event.id, item);
      else if (!loading) items.set(event.id, fallbackNewsItem(event));
    }
    return { items, loading };
  }, [applied, identity, isDemo, news, revision]);
}

export function RunConsole({ run, isDemo }: { run: ScenarioRun; isDemo: boolean }) {
  const mapRef = useRef<WorldMapHandle>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const seekFloorRef = useRef<number | undefined>(undefined);
  const [connection, setConnection] = useState<"connecting" | "connected" | "reconnecting" | "unavailable">("connecting");
  const [simTime, setSimTime] = useState(run.startMinute);
  const [playback, setPlayback] = useState<Playback>({ state: "paused", speed: 1 });
  const [events, setEvents] = useState<EventState>({ identity: run, revision: 0, applied: [], queue: [] });
  const reducedMotion = useReducedMotion();
  const { items: reports, loading: newsLoading } = useRunNews(run, events, isDemo);
  const connected = connection === "connected";
  const atEnd = simTime >= run.endMinute;
  const reportedHeadline = events.queue[0] && reports.get(events.queue[0].id);
  const pacing = pacingSummary(run.pacing, playback.speed, run.endMinute - simTime);
  const progress = Math.max(0, Math.min(1, (simTime - run.startMinute) / Math.max(1, run.endMinute - run.startMinute)));
  const steps = useMemo(() => stepBoundaries(run), [run]);
  const currentStep = steps.findLastIndex((minute) => minute <= simTime);
  const [stopEachStep, setStopEachStep] = useState(false);
  const stopAtRef = useRef<number | undefined>(undefined);
  const pins = useMemo(() => eventPins(events.applied, run), [events.applied, run]);
  const wasAtEnd = useRef(atEnd);

  // When a run plays to its end, frame every place it touched.
  useEffect(() => {
    if (atEnd && !wasAtEnd.current && events.applied.length > 1) mapRef.current?.fitEvents(events.applied);
    wasAtEnd.current = atEnd;
  }, [atEnd, events.applied]);

  useEffect(() => {
    let stopped = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    function connect() {
      if (stopped) return;
      const socket = new WebSocket(streamUrl(isDemo ? undefined : run.id));
      socketRef.current = socket;
      let initialized = false;
      socket.onopen = () => {
        if (stopped || !isDemo) return;
        socket.send(JSON.stringify({ action: "pause" }));
        socket.send(JSON.stringify({ action: "seek", sim_time_minutes: run.startMinute }));
      };
      socket.onmessage = (message) => {
        if (stopped) return;
        let data: StreamMessage;
        try {
          data = JSON.parse(message.data as string) as StreamMessage;
        } catch {
          return;
        }
        if (!isDemo && !sameRun(data, run)) return;
        if (data.kind === "snapshot") {
          if (!initialized && isDemo && (data.sim_time_minutes !== run.startMinute || data.playback.state !== "paused")) return;
          initialized = true;
          setConnection("connected");
          setSimTime(data.sim_time_minutes);
          setPlayback(data.playback);
          setEvents((previous) => ({
            identity: { simulation_id: data.simulation_id, branch_id: data.branch_id },
            revision: previous.revision + 1,
            applied: data.events,
            queue: [],
          }));
        } else if (!initialized) {
          return;
        } else if (data.kind === "event" && data.event.status === "applied") {
          const { event } = data;
          if (seekFloorRef.current !== undefined && event.sim_time_minutes <= seekFloorRef.current) return;
          setEvents((previous) => {
            if (previous.applied.some((applied) => applied.id === event.id)) return previous;
            return {
              ...previous,
              applied: [...previous.applied, event].sort((a, b) => a.sim_time_minutes - b.sim_time_minutes || a.sequence - b.sequence),
              queue: [...previous.queue, event].sort((a, b) => a.sim_time_minutes - b.sim_time_minutes || a.sequence - b.sequence),
            };
          });
        } else if (data.kind === "clock") {
          setSimTime(data.sim_time_minutes);
          setPlayback(data.playback);
        }
      };
      socket.onclose = ({ code }) => {
        if (socketRef.current === socket) socketRef.current = null;
        if (stopped) return;
        if (code === 4404 || code === 4410) {
          setConnection("unavailable");
          return;
        }
        setConnection("reconnecting");
        retryTimer = setTimeout(connect, 1200);
      };
      socket.onerror = () => socket.close();
    }

    queueMicrotask(connect);
    return () => {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [isDemo, run]);

  function sendControl(control: { action: "play" | "pause" } | { action: "speed"; speed: number } | { action: "seek"; sim_time_minutes: number }) {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(control));
  }

  function focusFirstEvent() {
    mapRef.current?.focusLocation(run.firstEvent.location);
  }

  function seek(minute: number) {
    seekFloorRef.current = minute;
    sendControl({ action: "seek", sim_time_minutes: minute });
  }

  function togglePlayback() {
    if (playback.state === "playing") {
      stopAtRef.current = undefined;
      sendControl({ action: "pause" });
      return;
    }
    if (atEnd) seek(run.startMinute);
    if (simTime <= run.startMinute || atEnd) focusFirstEvent();
    stopAtRef.current = stopEachStep ? nextBoundary(atEnd ? run.startMinute : simTime) : undefined;
    sendControl({ action: "play" });
  }

  function nextBoundary(minute: number) {
    return steps.find((boundary) => boundary > minute) ?? run.endMinute;
  }

  /** Pause and move one step (5% of the run) forward or back. */
  function step(direction: 1 | -1) {
    stopAtRef.current = undefined;
    if (playback.state === "playing") sendControl({ action: "pause" });
    const target = direction > 0 ? nextBoundary(simTime) : steps.findLast((boundary) => boundary < simTime) ?? run.startMinute;
    if (simTime <= run.startMinute && direction > 0) focusFirstEvent();
    seek(target);
  }

  function jumpTo(minute: number) {
    stopAtRef.current = undefined;
    if (playback.state === "playing") sendControl({ action: "pause" });
    seek(minute);
  }

  // "Stop at each step": pause as soon as the clock reaches the next step,
  // snapping back to the step if a fast tick went past it.
  useEffect(() => {
    const target = stopAtRef.current;
    if (target === undefined || playback.state !== "playing" || simTime < target) return;
    stopAtRef.current = undefined;
    sendControl({ action: "pause" });
    if (simTime > target && target < run.endMinute) seek(target);
  }, [playback.state, run.endMinute, simTime]);

  // Keyboard: Space plays or pauses; the arrow keys (or , and .) step. The
  // listener reads the latest render's handlers, updated before paint.
  const keyHandlers = useRef({ connected, step, togglePlayback });
  useLayoutEffect(() => {
    keyHandlers.current = { connected, step, togglePlayback };
  });
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const handlers = keyHandlers.current;
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || !handlers.connected) return;
      const target = event.target as HTMLElement | null;
      const typing = target?.closest("input, textarea, select, button, a, [contenteditable], canvas");
      if (event.key === "," || (!typing && event.key === "ArrowLeft")) handlers.step(-1);
      else if (event.key === "." || (!typing && event.key === "ArrowRight")) handlers.step(1);
      else if (!typing && event.key === " ") handlers.togglePlayback();
      else return;
      event.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const playbackLabel = playback.state === "playing" ? "Pause" : atEnd ? "Replay" : "Play";
  const status = {
    connected: "Live stream connected",
    connecting: "Connecting to stream",
    reconnecting: "Reconnecting to stream",
    unavailable: "Run ended. Generate a new scenario.",
  }[connection];
  const firstPlace = run.firstEvent.location.name;

  return (
    <div className="workspace">
      <WorldMap
        ref={mapRef}
        elapsedSeconds={(simTime - run.startMinute) / (run.pacing?.mode === "relative" && run.pacing.minutes_per_tick > 0
          ? run.pacing.minutes_per_tick / run.pacing.tick_seconds
          : minutesPerSecond)}
        events={events.applied}
        focusCountry={run.firstEvent.location.country_code}
      >
        <HeadlineAlert
          item={reportedHeadline}
          queuedCount={Math.max(0, events.queue.length - 1)}
          onAdvance={() => setEvents((previous) => ({ ...previous, queue: previous.queue.slice(1) }))}
          onDismiss={() => setEvents((previous) => ({ ...previous, queue: previous.queue.slice(1) }))}
        />
      </WorldMap>

      <motion.aside
        className="inspector"
        aria-label="Scenario inspector"
        initial={isDemo || reducedMotion ? false : { opacity: 0, x: 5 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.18 }}
      >
        <div className="scenario-summary">
          <div className="scenario-status">
            <span>{isDemo ? "Japan demo" : "Prompted scenario"}</span>
            <span className="run-stream" role="status"><i data-connected={connected} aria-hidden="true" />{status}</span>
          </div>
          <h2>{run.title}</h2>
          <button className="focus-button" type="button" onClick={focusFirstEvent}>
            <Crosshair size={16} aria-hidden="true" /> {firstPlace}
          </button>
        </div>
        <ImpactDashboard events={events.applied} />
        <WorldWire items={[...reports.values()].reverse()} loading={newsLoading} />
      </motion.aside>

      <section className="timeline" aria-label="Simulation playback">
        <div className="timeline-tools">
          <motion.button
            className="play-button"
            type="button"
            onClick={togglePlayback}
            disabled={!connected}
            whileTap={{ scale: 0.96 }}
            transition={{ duration: 0.12 }}
          >
            {playback.state === "playing" ? <Pause size={15} weight="fill" aria-hidden="true" /> : <Play size={15} weight="fill" aria-hidden="true" />}
            {playbackLabel}
          </motion.button>
          <button className="reset-button" type="button" aria-label="Reset playback" title="Reset playback"
            disabled={!connected}
            onClick={() => {
              stopAtRef.current = undefined;
              sendControl({ action: "pause" });
              seek(run.startMinute);
            }}>
            <ArrowCounterClockwise size={17} aria-hidden="true" />
          </button>
          <button className="step-button" type="button" aria-label="Previous step" title="Previous step (← or ,)"
            disabled={!connected || simTime <= run.startMinute} onClick={() => step(-1)}>
            <SkipBack size={16} weight="fill" aria-hidden="true" />
          </button>
          <button className="step-button" type="button" aria-label="Next step" title="Next step (→ or .)"
            disabled={!connected || atEnd} onClick={() => step(1)}>
            <SkipForward size={16} weight="fill" aria-hidden="true" />
          </button>
        </div>
        <div className="timeline-track">
          <div className="timeline-meta">
            <label htmlFor="playback-position">Simulation timeline</label>
            <span>{formatSimTime(simTime)} <span className="time-divider">/</span> {formatSimTime(run.endMinute)}</span>
          </div>
          <div className="timeline-rail">
          <input
            id="playback-position"
            className="position-input"
            type="range"
            min={run.startMinute}
            max={run.endMinute}
            step={1}
            value={Math.min(run.endMinute, Math.max(run.startMinute, simTime))}
            aria-valuetext={formatSimTime(simTime)}
            disabled={!connected || run.startMinute === run.endMinute}
            onChange={(event) => seek(event.currentTarget.valueAsNumber)}
            style={{ "--elapsed": `${progress * 100}%` } as CSSProperties}
          />
            <div className="timeline-steps" aria-hidden="true">
              {steps.map((minute, index) => (
                <i key={index} data-passed={minute <= simTime}
                  style={{ left: `${((minute - run.startMinute) / Math.max(1, run.endMinute - run.startMinute)) * 100}%` }} />
              ))}
            </div>
            <div className="timeline-events" role="group" aria-label="Jump to event">
              {pins.map((pin) => (
                <button key={pin.events[0].id} type="button" data-type={pin.events[0].type} data-count={pin.events.length}
                  style={{ left: `${pin.left * 100}%` }}
                  aria-label={`Jump to ${pin.label}`}
                  title={pin.label}
                  disabled={!connected}
                  onClick={() => jumpTo(pin.events[0].sim_time_minutes)} />
              ))}
            </div>
          </div>
          <div className="timeline-stepper">
            <span className="step-count">Step {Math.max(0, currentStep)} / {steps.length - 1} · {Math.round(progress * 100)}%</span>
            <label className="stop-each-step">
              <input type="checkbox" checked={stopEachStep} disabled={!connected}
                onChange={(event) => {
                  const on = event.currentTarget.checked;
                  setStopEachStep(on);
                  stopAtRef.current = on && playback.state === "playing" ? nextBoundary(simTime) : undefined;
                }} />
              Stop at each step
            </label>
          </div>
          {pacing && (
            <p className="timeline-pacing" aria-label="Playback pacing">
              <span>{pacing.rate}</span>
              <span>{pacing.left}</span>
            </p>
          )}
        </div>
        <div className="speed-control" role="group" aria-label="Playback speed">
          {speeds.map((speed) => (
            <button key={speed} type="button" aria-pressed={playback.speed === speed} disabled={!connected}
              onClick={() => sendControl({ action: "speed", speed })}>
              {speed}×
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
