import { ArrowCounterClockwise, Crosshair, Pause, Play } from "@phosphor-icons/react";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import feed from "../../../services/newsroom/feeds/japan-earthquake.json";
import { japanDemo } from "../lib/earthquake";
import { readScenarioNews, streamUrl } from "../lib/scenario-api";
import { fallbackNewsItem, formatSimTime, sameRun, type NewsItem, type Playback, type RunIdentity, type ScenarioEvent, type ScenarioRun, type StreamMessage } from "../lib/scenario";
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
  const progress = Math.max(0, Math.min(1, (simTime - run.startMinute) / Math.max(1, run.endMinute - run.startMinute)));

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
      sendControl({ action: "pause" });
      return;
    }
    if (atEnd) seek(run.startMinute);
    if (simTime <= run.startMinute || atEnd) focusFirstEvent();
    sendControl({ action: "play" });
  }

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
        elapsedSeconds={(simTime - run.startMinute) / minutesPerSecond}
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
              sendControl({ action: "pause" });
              seek(run.startMinute);
            }}>
            <ArrowCounterClockwise size={17} aria-hidden="true" />
          </button>
        </div>
        <div className="timeline-track">
          <div className="timeline-meta">
            <label htmlFor="playback-position">Simulation timeline</label>
            <span>{formatSimTime(simTime)} <span className="time-divider">/</span> {formatSimTime(run.endMinute)}</span>
          </div>
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
