import { ArrowCounterClockwise, Crosshair, Pause, Play, SkipBack, SkipForward } from "@phosphor-icons/react";
import { motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import feed from "../../../services/newsroom/feeds/japan-earthquake.json";
import { japanDemo } from "../lib/earthquake";
import { readSatire, readScenarioNews, streamUrl } from "../lib/scenario-api";
import { fallbackNewsItem, focusNewsItem, formatSimTime, pacingSummary, sameRun, type NewsItem, type Playback, type RunIdentity, type SatireReport, type ScenarioEvent, type ScenarioRun, type StreamMessage, type Tone } from "../lib/scenario";
import { AbsurdityIndex } from "./absurdity-index";
import { HeadlineAlert } from "./headline-alert";
import { SocialFeed } from "./social-feed";
import { ImpactDashboard } from "./impact-dashboard";
import { WorldMap, type WorldMapHandle } from "./world-map";
import { WorldWire } from "./world-wire";
import { PresentationControls } from "./presentation-controls";

import { enableHeadlineSound, soundHeadline } from "../lib/headline-sound";

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

/**
 * Satire layer for the current applied events. Fetched again whenever the applied
 * set changes (play, seek, replay, reset) and filtered to that set, so jokes never
 * run ahead of the clock. Presentation only: facts and impacts come from elsewhere.
 */
function useSatire(run: ScenarioRun, events: EventState, tone: Tone, isDemo: boolean) {
  const { applied, revision } = events;
  const [state, setState] = useState<{ key: string; report?: SatireReport }>();
  const key = `${tone}|${revision}|${applied.length}`;

  useEffect(() => {
    if (tone === "straight" || applied.length === 0) return;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]);
    readSatire(run, isDemo, tone, signal).then(
      (report) => { if (!controller.signal.aborted) setState((previous) => ({ key, report: report ?? previous?.report })); },
      () => { if (!controller.signal.aborted) setState((previous) => ({ key, report: previous?.report })); },
    );
    return () => controller.abort();
  }, [applied, isDemo, key, run, tone]);

  return useMemo(() => {
    if (tone === "straight") return undefined;
    const ids = new Set(applied.map((event) => event.id));
    const report = state?.report?.tone === tone ? state.report : undefined;
    return {
      loading: applied.length > 0 && state?.key !== key,
      items: new Map((report?.items ?? []).filter((item) => ids.has(item.event_id)).map((item) => [item.event_id, item as NewsItem])),
      posts: (report?.posts ?? []).filter((post) => ids.has(post.event_id)),
      absurdity: applied.length === 0 ? [] : report?.absurdity ?? [],
    };
  }, [applied, key, state, tone]);
}

/**
 * One run, watched. Runs started from the home screen (`autoStart`) play as a
 * story: the clock stops on each development and waits for the viewer to advance.
 */
export function RunConsole({ run, isDemo, tone = "straight", autoStart = false, initialSpeed = 1, onRunAgain }: {
  run: ScenarioRun; isDemo: boolean; tone?: Tone; autoStart?: boolean; initialSpeed?: number; onRunAgain?: () => void;
}) {
  const mapRef = useRef<WorldMapHandle>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const seekFloorRef = useRef<number | undefined>(undefined);
  const awaitingSeekSnapshot = useRef(false);
  const waitingForHeadline = useRef(false);
  // Previous event: the headline to show again once the seek's snapshot arrives.
  const replayHeadline = useRef<string | undefined>(undefined);
  const [connection, setConnection] = useState<"connecting" | "connected" | "reconnecting" | "unavailable">("connecting");
  const [simTime, setSimTime] = useState(run.startMinute);
  const [playback, setPlayback] = useState<Playback>({ state: "paused", speed: 1 });
  const [events, setEvents] = useState<EventState>({ identity: run, revision: 0, applied: [], queue: [] });
  const reducedMotion = useReducedMotion();
  const { items: facts, loading: newsLoading } = useRunNews(run, events, isDemo);
  const satire = useSatire(run, events, tone, isDemo);
  const reports = useMemo(() => {
    if (!satire) return facts;
    const merged = new Map<string, NewsItem>();
    for (const [id, item] of facts) merged.set(id, satire.items.get(id) ?? item);
    return merged;
  }, [facts, satire]);
  const connected = connection === "connected";
  const atEnd = simTime >= run.endMinute;
  const reportedHeadline = events.queue[0] && reports.get(events.queue[0].id);
  const pacing = pacingSummary(run.pacing, playback.speed, run.endMinute - simTime);
  const progress = Math.max(0, Math.min(1, (simTime - run.startMinute) / Math.max(1, run.endMinute - run.startMinute)));
  const story = autoStart || isDemo;
  const [wantPlaying, setWantPlaying] = useState(false);
  const [beatReady, setBeatReady] = useState(true);
  const [film, setFilm] = useState<{ status: "idle" | "queued" | "generating" | "ready" | "failed"; stage: string; videoUrl?: string; message?: string }>({ status: "idle", stage: "idle" });
  const [filmOpen, setFilmOpen] = useState(false);
  const [filmDismissed, setFilmDismissed] = useState(false);
  const [autoFollow, setAutoFollow] = useState(true);
  const [followSuspended, setFollowSuspended] = useState(false);
  const [manualSerial, setManualSerial] = useState(0);
  useEffect(() => {
    if (!followSuspended) return;
    const timer = setTimeout(() => setFollowSuspended(false), 20000);
    return () => clearTimeout(timer);
  }, [manualSerial, followSuspended]);
  const [selectedId, setSelectedId] = useState<string>();
  const lastBeat = useRef(run.startMinute);
  const started = useRef(false);
  useEffect(() => {
    if (!autoStart || !connected || started.current) return;
    started.current = true;
    sendControl({ action: "speed", speed: initialSpeed });
    setWantPlaying(true);
    if (!story) sendControl({ action: "play" });
    // Story playback is started after the stream connects.
  }, [autoStart, connected, initialSpeed]);
  const followLocation = events.applied.find(e => e.id === selectedId)?.location;
  const highlightedCountry = followLocation?.country_code ?? run.firstEvent.location.country_code;
  const lastFocus = useRef<string | undefined>(undefined);
  const advanceStory = useCallback(() => {
    mapRef.current?.stopMotion();
    setEvents(previous => {
      const queue = previous.queue.slice(1);
      waitingForHeadline.current = queue.length > 0;
      return { ...previous, queue };
    });
    setBeatReady(true);
  }, []);

  const announced = useRef(new Set<string>());
  const headlineId = reportedHeadline?.event_id;
  useEffect(() => {
    if (!headlineId || announced.current.has(headlineId)) return;
    announced.current.add(headlineId);
    soundHeadline();
  }, [headlineId]);

  // Snapshot boundaries cancel pending cosmetic work; they never replay old reports.
  useEffect(() => { setBeatReady(true); lastBeat.current = simTime; }, [events.revision]);
  // Keep the simulation stopped until the viewer advances each queued headline.
  useEffect(() => {
    if (story && wantPlaying && beatReady && !atEnd &&
        events.queue.length === 0 && playback.state === "paused" && connected) sendControl({action: "play", until_next_event: true});
  }, [wantPlaying, beatReady, atEnd, events.queue.length, playback.state, connected, story]);
  useEffect(() => {
    if (reportedHeadline) setSelectedId(reportedHeadline.event_id);
  }, [reportedHeadline?.event_id]);
  useEffect(() => {
    if (followSuspended || !autoFollow) { lastFocus.current = undefined; return; }
    if (story && followLocation) {
      const key = `${followLocation.lat.toFixed(1)},${followLocation.lon.toFixed(1)}`;
      if (key !== lastFocus.current) {
        mapRef.current?.focusLocation(followLocation, false);
        lastFocus.current = key;
      }
    }
  }, [selectedId, autoFollow, followSuspended, story, followLocation]);

  useEffect(() => {
    if (!story || isDemo) return;
    const controller = new AbortController();
    let retry: ReturnType<typeof setTimeout> | undefined;
    async function refresh(start: boolean) {
      try {
        const response = await fetch(`/api/recap-films/${encodeURIComponent(run.id)}`, {
          method: start ? "POST" : "GET",
          headers: start ? { "Content-Type": "application/json" } : undefined,
          body: start ? JSON.stringify({ tone }) : undefined,
          signal: controller.signal,
        });
        const data = await response.json() as { status?: "queued" | "generating" | "ready" | "failed"; stage?: string; videoUrl?: string; message?: string };
        if (!response.ok || !data.status) throw new Error(data.message ?? "The recap film job is unavailable.");
        setFilm({ status: data.status, stage: data.stage ?? "starting", videoUrl: data.videoUrl, message: data.message });
        if (data.status === "queued" || data.status === "generating") retry = setTimeout(() => void refresh(false), 2500);
      } catch (error) {
        if (controller.signal.aborted) return;
        setFilm({ status: "failed", stage: "failed", message: error instanceof Error ? error.message : "The recap film is unavailable." });
      }
    }
    void refresh(true);
    return () => { controller.abort(); if (retry) clearTimeout(retry); };
  }, [run.id, story, tone, isDemo]);

  useEffect(() => {
    if (story && atEnd && events.queue.length === 0 && film.status !== "idle" && !filmDismissed) setFilmOpen(true);
  }, [story, atEnd, events.queue.length, film.status, filmDismissed]);
  useEffect(() => {
    if (story) document.querySelector(".workspace")?.scrollIntoView({block: "start"});
  }, [run.id]);

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
        seekFloorRef.current = run.startMinute;
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
        if (!isDemo && !sameRun(run, data)) return;
        if (data.kind === "snapshot") {
          if (!initialized && isDemo && (data.sim_time_minutes !== run.startMinute || data.playback.state !== "paused")) return;
          initialized = true;
          waitingForHeadline.current = false;
          setConnection("connected");
          setSimTime(data.sim_time_minutes);
          setPlayback(data.playback);
          // Read the ref now: React runs the updater below later, after it is cleared.
          const seeking = awaitingSeekSnapshot.current;
          awaitingSeekSnapshot.current = false;
          const replay = replayHeadline.current;
          replayHeadline.current = undefined;
          setEvents((previous) => ({
            identity: { simulation_id: data.simulation_id, branch_id: data.branch_id },
            revision: previous.revision + 1,
            applied: data.events,
            // A story run opens on its first report; stepping back shows that event's report
            // again; otherwise a snapshot never replays old reports.
            queue: story && replay
              ? data.events.filter((e) => e.id === replay)
              : story && !seeking ? [...previous.queue.filter(e => data.events.some(a => a.id === e.id)),
                  ...data.events.filter(e => !previous.applied.some(a => a.id === e.id))] : [],
          }));
          if (replay) waitingForHeadline.current = true;
        } else if (!initialized) {
          return;
        } else if (data.kind === "event" && data.event.status === "applied") {
          const { event } = data;
          if (seekFloorRef.current !== undefined && event.sim_time_minutes <= seekFloorRef.current) return;
          if (story) {
            // Do not rely only on the server's stop-at-event flag: the direct pause
            // closes the event/clock message race and keeps playback stopped locally.
            socket.send(JSON.stringify({ action: "pause" }));
            waitingForHeadline.current = true;
            setPlayback((previous) => ({ ...previous, state: "paused" }));
          }
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
          if (story && waitingForHeadline.current && data.playback.state === "playing") {
            setPlayback((previous) => ({ ...previous, state: "paused" }));
          } else {
            setPlayback(data.playback);
          }
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
      if (socketRef.current?.readyState === WebSocket.OPEN) socketRef.current.send(JSON.stringify({action: "pause"}));
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [isDemo, run]);

  function sendControl(control: { action: "play"; until_next_event?: boolean } | { action: "pause" } | { action: "speed"; speed: number } | { action: "seek"; sim_time_minutes: number }) {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(control));
  }

  function focusFirstEvent() {
    mapRef.current?.focusLocation(run.firstEvent.location);
  }

  function seek(minute: number) {
    setWantPlaying(false); setBeatReady(true);
    waitingForHeadline.current = false;
    awaitingSeekSnapshot.current = true;
    seekFloorRef.current = minute;
    sendControl({ action: "seek", sim_time_minutes: minute });
  }

  function togglePlayback() {
    enableHeadlineSound();
    if (story) {
      if (events.queue.length) { nextEvent(); return; }
      if (!atEnd && wantPlaying) {
        setWantPlaying(false);
        sendControl({ action: "pause" });
        return;
      }
      if (atEnd) { seek(run.startMinute); focusFirstEvent(); }
      setWantPlaying(true);
      if (!atEnd) sendControl({ action: "play", until_next_event: true });
      return;
    }
    if (playback.state === "playing") {
      setWantPlaying(false);
      sendControl({ action: "pause" });
      return;
    }
    if (atEnd) seek(run.startMinute);
    if (simTime <= run.startMinute || atEnd) focusFirstEvent();
    setWantPlaying(true);
    sendControl({ action: "play" });
  }

  /** Step forward: past the current headline to the next event, then wait there. */
  function nextEvent() {
    enableHeadlineSound();
    setWantPlaying(true);
    if (events.queue.length > 0) advanceStory();
    else if (!atEnd) sendControl({ action: "play", until_next_event: true });
  }

  /** Step back: rewind to the event before the current one and show its headline again. */
  function previousEvent() {
    const current = events.queue[0] ?? events.applied.at(-1);
    const index = current ? events.applied.findIndex((e) => e.id === current.id) : -1;
    const target = index > 0 ? events.applied[index - 1] : undefined;
    if (!target) return;
    sendControl({ action: "pause" });
    replayHeadline.current = target.id;
    seek(target.sim_time_minutes);
  }

  const currentIndex = (() => {
    const current = events.queue[0] ?? events.applied.at(-1);
    return current ? events.applied.findIndex((e) => e.id === current.id) : -1;
  })();

  const playbackLabel = story
    ? events.queue.length ? "Continue" : atEnd ? "Replay" : wantPlaying ? "Pause" : "Play"
    : playback.state === "playing" ? "Pause" : atEnd ? "Replay" : "Play";
  const filmPercent = film.stage === "render" ? 80 : film.stage === "assemble" ? 95 : film.stage === "narration" ? 35 : film.stage === "script" ? 15 : 0;
  const status = {
    connected: "Live stream connected",
    connecting: "Connecting to stream",
    reconnecting: "Reconnecting to stream",
    unavailable: "Run ended. Generate a new scenario.",
  }[connection];
  const firstPlace = run.firstEvent.location.name;

  return (
    <div className="workspace" data-tone={tone}>
      {story && <div className="story-toolbar">
        <PresentationControls autoFollow={autoFollow} suspended={followSuspended} onFollow={() => {
            if (followSuspended) { setFollowSuspended(false); setAutoFollow(true); }
            else setAutoFollow(v => !v);
          }} />
      </div>}
      <WorldMap
        ref={mapRef}
        playing={playback.state === "playing"}
        initialFocus={autoStart ? run.firstEvent.location : undefined}
        elapsedSeconds={(simTime - run.startMinute) / (run.pacing?.mode === "relative" && run.pacing.minutes_per_tick > 0
          ? run.pacing.minutes_per_tick / run.pacing.tick_seconds
          : minutesPerSecond)}
        events={events.applied}
        focusCountry={highlightedCountry}
        selectedEventId={selectedId}
        onManualInteraction={() => { setFollowSuspended(true); setManualSerial(n => n + 1); }}
        follow={story && autoFollow && !followSuspended}
      >
        {story && atEnd && events.queue.length === 0 && onRunAgain && (
          <section className="run-complete" aria-label="Run complete">
            <p><strong>Simulation complete.</strong> Run it again for a different future.</p>
            <button type="button" onClick={onRunAgain}>Run again with a new seed</button>
          </section>
        )}
        <HeadlineAlert
          item={reportedHeadline}
          queuedCount={Math.max(0, events.queue.length - 1)}
          onAdvance={() => { nextEvent(); }}
        />
      </WorldMap>

      {filmOpen && story && atEnd && events.queue.length === 0 && (
        <div className="recap-modal-backdrop" role="presentation">
          <section className="recap-modal" role="dialog" aria-modal="true" aria-labelledby="recap-modal-title">
            <button className="recap-modal-close" type="button" onClick={() => { setFilmOpen(false); setFilmDismissed(true); }} aria-label="Close recap">×</button>
            <p className="alt-kicker">Your run is complete</p>
            <h2 id="recap-modal-title">The recap film</h2>
            {film.status === "ready" && film.videoUrl ? (
              <video className="recap-video" controls playsInline preload="metadata" src={film.videoUrl} />
            ) : film.status === "failed" ? (
              <p role="status">{film.message ?? "The recap film could not be rendered."}</p>
            ) : (
              <div className="recap-pending" role="status">
                <span className="recap-spinner" aria-hidden="true" />
                <p>{filmPercent > 0 ? `Your recap video is about ${filmPercent}% generated.` : "Your recap video is being prepared."}</p>
                <span>It will appear here when rendering finishes.</span>
              </div>
            )}
            <button className="recap-modal-done" type="button" onClick={() => { setFilmOpen(false); setFilmDismissed(true); }}>Close</button>
          </section>
        </div>
      )}

      <motion.aside
        className="inspector"
        aria-label="Scenario inspector"
        initial={isDemo || reducedMotion ? false : { opacity: 0, x: 5 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.18 }}
      >
        <div className="scenario-summary">
          <div className="scenario-status">
            <span>{isDemo ? "Japan demo" : run.seed !== undefined ? `Run · seed ${run.seed}` : "Prompted scenario"}</span>
            <span className="run-stream" role="status"><i data-connected={connected} aria-hidden="true" />{status}</span>
          </div>

          <button className="focus-button" type="button" onClick={focusFirstEvent}>
            <Crosshair size={16} aria-hidden="true" /> {firstPlace}
          </button>
        </div>
        {satire && <AbsurdityIndex metrics={satire.absurdity} />}
        <WorldWire items={[...reports.values()].reverse()} loading={newsLoading || Boolean(satire?.loading && satire.items.size === 0)}
          satire={Boolean(satire)} selectedId={selectedId} onSelect={(item) => { setSelectedId(item.event_id); focusNewsItem(item); }} />
        <ImpactDashboard events={events.applied} />
        {satire && <SocialFeed posts={satire.posts} loading={satire.loading} />}
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
            {playbackLabel === "Pause" ? <Pause size={15} weight="fill" aria-hidden="true" /> : <Play size={15} weight="fill" aria-hidden="true" />}
            {playbackLabel}
          </motion.button>
          {story && <>
            <button className="step-button" type="button" aria-label="Previous event" title="Previous event"
              disabled={!connected || currentIndex <= 0} onClick={previousEvent}>
              <SkipBack size={16} weight="fill" aria-hidden="true" />
            </button>
            <button className="step-button" type="button" aria-label="Next event" title="Next event"
              disabled={!connected || (atEnd && events.queue.length <= 1)} onClick={nextEvent}>
              <SkipForward size={16} weight="fill" aria-hidden="true" />
            </button>
          </>}
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
          {pacing && (
            <p className="timeline-pacing" aria-label="Playback pacing">
              <span>{pacing.rate}</span>
              <span>{story ? (events.queue.length ? "Paused for headline" : atEnd ? "Complete" : playback.state) : pacing.left}</span>
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
