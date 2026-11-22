import { ArrowCounterClockwise, Crosshair, Pause, Play } from "@phosphor-icons/react";
import { motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import feed from "../../../services/newsroom/feeds/japan-earthquake.json";
import { japanDemo } from "../lib/earthquake";
import { readScenarioNews, streamUrl } from "../lib/scenario-api";
import {
  branchFromDecision, controlRun, PlayerRequestError, readPlayerState, readPlayerSummary, submitDecision,
  type PlayerState, type PlayerSummary,
} from "../lib/player-api";
import { fallbackNewsItem, focusNewsItem, formatSimTime, pacingSummary, sameRun, sameRunOrBranch, type NewsItem, type Playback, type RunIdentity, type ScenarioEvent, type ScenarioRun, type StreamMessage } from "../lib/scenario";
import { AlternateTimeline } from "./alternate-timeline";
import { DecisionCard } from "./decision-card";
import { HeadlineAlert } from "./headline-alert";
import { ImpactDashboard } from "./impact-dashboard";
import { PlayerSummaryPanel } from "./player-summary";
import { WorldMap, type WorldMapHandle } from "./world-map";
import { WorldWire } from "./world-wire";
import { PresentationControls } from "./presentation-controls";
import { beatDelay, headlineDelay, type PresentationSpeed } from "../lib/presentation";

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

// Player mode (prototype): poll the decision state over HTTP (no stream contract change).
function usePlayer(run: ScenarioRun) {
  const [state, setState] = useState<PlayerState>();
  const [summary, setSummary] = useState<PlayerSummary>();
  const requestNumber = useRef(0);
  const refresh = useCallback(async () => {
    if (!run.player) return;
    try {
      const serial = ++requestNumber.current;
      const next = await readPlayerState(run.id);
      const summary = next.finished ? await readPlayerSummary(run.id) : undefined;
      if (serial !== requestNumber.current) return;
      setState(next); setSummary(summary);
    } catch {
      // The run may have been evicted; the stream status says so.
    }
  }, [run]);

  useEffect(() => {
    if (!run.player) return;
    refresh();
    const timer = setInterval(refresh, 500);
    return () => clearInterval(timer);
  }, [refresh, run.player]);

  return { state, summary, refresh };
}

export function RunConsole({ run, isDemo, onRestart, onSelectRole }: { run: ScenarioRun; isDemo: boolean; onRestart?: () => void; onSelectRole?: () => void }) {
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
  const player = usePlayer(run);
  const [playerBusy, setPlayerBusy] = useState(false);
  const [playerError, setPlayerError] = useState<string>();
  const pending = player.state?.pending ?? null;
  const cardWaiting = Boolean(pending?.waiting);
  const finished = Boolean(run.player && player.summary?.finished && events.queue.length === 0);
  const [compareOpen, setCompareOpen] = useState(false);
  const [presentationSpeed, setPresentationSpeed] = useState<PresentationSpeed>("normal");
  const [reading, setReading] = useState(false);
  const [wantPlaying, setWantPlaying] = useState(false);
  const [beatReady, setBeatReady] = useState(true);
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
  const [beatSerial, setBeatSerial] = useState(0);
  const followLocation = cardWaiting ? events.applied.find(e => e.id === pending?.trigger.event_id)?.location
    : events.applied.find(e => e.id === selectedId)?.location;
  const highlightedCountry = followLocation?.country_code ?? run.firstEvent.location.country_code;
  const lastFocus = useRef<string | undefined>(undefined);
  const advanceStory = useCallback(() => {
    mapRef.current?.stopMotion();
    setEvents(previous => ({...previous, queue: previous.queue.slice(1)}));
    setBeatReady(true);
  }, []);

  // Snapshot boundaries cancel pending cosmetic work; they never replay old reports.
  useEffect(() => { setBeatReady(true); lastBeat.current = simTime; }, [events.revision]);
  useEffect(() => {
    if (!run.player || simTime <= lastBeat.current) return;
    lastBeat.current = simTime;
    if (wantPlaying && !atEnd && !cardWaiting && presentationSpeed !== "fast") {
      sendControl({action: "pause"});
      setBeatReady(false);
      setBeatSerial(n => n + 1);
    }
  }, [simTime, wantPlaying, atEnd, cardWaiting, presentationSpeed, run.player]);
  useEffect(() => {
    if (beatReady) return;
    const timer = setTimeout(() => setBeatReady(true), beatDelay(presentationSpeed));
    return () => clearTimeout(timer);
  }, [beatSerial, beatReady, presentationSpeed]);
  useEffect(() => {
    if (!run.player || !reportedHeadline || reading || cardWaiting || !wantPlaying) return;
    const timer = setTimeout(advanceStory, headlineDelay(presentationSpeed, reportedHeadline.severity));
    return () => clearTimeout(timer);
  }, [reportedHeadline?.event_id, reading, cardWaiting, wantPlaying, presentationSpeed, advanceStory, run.player]);
  useEffect(() => {
    if (run.player && wantPlaying && beatReady && !reading && !cardWaiting && !atEnd && !player.state?.finished &&
        events.queue.length === 0 && playback.state === "paused" && connected) sendControl({action: "play"});
  }, [wantPlaying, beatReady, reading, cardWaiting, atEnd, player.state?.finished, events.queue.length, playback.state, connected, run.player]);
  useEffect(() => {
    if (run.player && reading) sendControl({action: "pause"});
  }, [reading, run.player]);
  useEffect(() => {
    if (reportedHeadline && !cardWaiting) setSelectedId(reportedHeadline.event_id);
  }, [reportedHeadline?.event_id, cardWaiting]);
  useEffect(() => {
    if (followSuspended || !autoFollow) { lastFocus.current = undefined; return; }
    if (run.player && followLocation && (cardWaiting || !reading)) {
      const key = `${followLocation.lat.toFixed(1)},${followLocation.lon.toFixed(1)}`;
      if (key !== lastFocus.current || cardWaiting) {
        mapRef.current?.focusLocation(followLocation, presentationSpeed === "fast");
        lastFocus.current = key;
      }
    }
  }, [selectedId, pending?.id, autoFollow, followSuspended, cardWaiting, presentationSpeed]);
  useEffect(() => {
    if (run.player) document.querySelector(".workspace")?.scrollIntoView({block: "start"});
  }, [run.id]);
  const compareHeadingRef = useRef<HTMLHeadingElement>(null);
  const madeDecisions = (player.state?.decisions ?? []).filter((d) => d.status === "resolved").length;

  // The comparison opens (below the map) once the run ends, and closes when a seek or branch reopens the run.
  useEffect(() => setCompareOpen(finished), [finished]);

  function showComparison() {
    setCompareOpen(true);
    requestAnimationFrame(() => {
      compareHeadingRef.current?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
      compareHeadingRef.current?.focus({ preventScroll: true });
    });
  }

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
        if (!isDemo && !sameRunOrBranch(run, data)) return;
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
            queue: run.player && previous.identity.branch_id !== data.branch_id
              ? [...previous.queue.filter(e => data.events.some(n => n.id === e.id)),
                 ...data.events.filter(e => !previous.applied.some(old => old.id === e.id))]
              : run.player && previous.applied.length === 0 ? data.events : [],
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
    setWantPlaying(false); setReading(false); setBeatReady(true);
    seekFloorRef.current = minute;
    if (run.player) {
      void playerSeek(minute);
      return;
    }
    sendControl({ action: "seek", sim_time_minutes: minute });
  }

  // Seeking back past decisions voids them, so ask first (seek goes over HTTP to get the 409).
  // Returns whether the seek happened.
  async function playerSeek(minute: number): Promise<boolean> {
    const state = player.state;
    const later = (state?.decisions ?? []).filter((d) => d.status === "resolved" && (d.at_minutes ?? 0) > minute).length
      + (state?.pending && state.pending.trigger.minute > minute ? 1 : 0);
    if (later > 0 && !window.confirm(
      `Seeking back to ${formatSimTime(minute)} voids ${later} later decision${later === 1 ? "" : "s"}. Continue?`)) {
      await player.refresh();
      return false;
    }
    let done = true;
    try {
      await controlRun(run.id, { action: "seek", sim_time_minutes: minute, void_decisions: later > 0 });
    } catch (error) {
      done = false;
      setPlayerError(error instanceof Error ? error.message : "Seek failed.");
    }
    await player.refresh();
    return done;
  }

  async function decide(body: { option_id?: string; free_text?: string }) {
    if (!pending) return;
    setPlayerBusy(true);
    setPlayerError(undefined);
    try {
      let at = player.state?.sim_time_minutes ?? simTime;
      if (playback.state === "playing") at = (await controlRun(run.id, { action: "pause" })).sim_time_minutes;
      await submitDecision(run.id, { decision_id: pending.id, at_minutes: at, ...body });
      setWantPlaying(true); setReading(false); setBeatReady(true);
    } catch (error) {
      setPlayerError(error instanceof PlayerRequestError || error instanceof Error ? error.message : "That decision failed.");
    } finally {
      await player.refresh();
      setPlayerBusy(false);
    }
  }

  async function branchFrom(decisionId: string) {
    setPlayerBusy(true);
    try {
      setWantPlaying(false); setReading(false);
      await branchFromDecision(run.id, decisionId);
      setCompareOpen(false);
      mapRef.current?.focusLocation(run.firstEvent.location);
      document.querySelector(".workspace")?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
    } catch (error) {
      setPlayerError(error instanceof Error ? error.message : "Could not branch from that decision.");
    } finally {
      await player.refresh();
      setPlayerBusy(false);
    }
  }

  function togglePlayback() {
    if (run.player ? wantPlaying : playback.state === "playing") {
      setWantPlaying(false);
      sendControl({ action: "pause" });
      return;
    }
    if (run.player && atEnd) {
      // Replay in player mode starts a new attempt: confirm voiding the decisions first, then play.
      seekFloorRef.current = run.startMinute;
      void playerSeek(run.startMinute).then((done) => {
        if (!done) return;
        focusFirstEvent(); setWantPlaying(true); setReading(false);
        sendControl({ action: "play" });
      });
      return;
    }
    if (atEnd) seek(run.startMinute);
    if (simTime <= run.startMinute || atEnd) focusFirstEvent();
    setWantPlaying(true); setReading(false);
    sendControl({ action: "play" });
  }

  const playbackLabel = (run.player ? wantPlaying && !cardWaiting && !finished : playback.state === "playing") ? "Pause" : atEnd ? "Replay" : "Play";
  const status = {
    connected: "Live stream connected",
    connecting: "Connecting to stream",
    reconnecting: "Reconnecting to stream",
    unavailable: "Run ended. Generate a new scenario.",
  }[connection];
  const firstPlace = run.firstEvent.location.name;

  return (
    <div className="workspace">
      {run.player && <div className="story-toolbar">
        <PresentationControls speed={presentationSpeed} onSpeed={setPresentationSpeed}
          held={reading} onHold={() => setReading(v => !v)} onSkip={advanceStory}
          autoFollow={autoFollow} suspended={followSuspended} onFollow={() => {
            if (followSuspended) { setFollowSuspended(false); setAutoFollow(true); }
            else setAutoFollow(v => !v);
          }} />
        {player.state?.phase && <section className="crisis-phase" aria-label="Current crisis phase" aria-live="polite">
          <span>Phase {player.state.phase.index} / {player.state.phase.total} · {formatSimTime(simTime)}</span>
          <strong>{player.state.phase.title}</strong><p>{player.state.phase.summary}</p>
          <progress aria-label="Crisis phase progress" value={player.state.phase.index} max={player.state.phase.total} />
        </section>}
      </div>}
      <WorldMap
        ref={mapRef}
        elapsedSeconds={(simTime - run.startMinute) / (run.pacing?.mode === "relative" && run.pacing.minutes_per_tick > 0
          ? run.pacing.minutes_per_tick / run.pacing.tick_seconds
          : minutesPerSecond)}
        events={events.applied}
        focusCountry={highlightedCountry}
        selectedEventId={cardWaiting ? pending?.trigger.event_id : selectedId}
        onManualInteraction={() => { setFollowSuspended(true); setManualSerial(n => n + 1); }}
      >
        {finished && !cardWaiting && (
          <section className="run-complete" aria-label="Run complete">
            <p><strong>Simulation complete.</strong> {player.summary?.comparison.headline}</p>
            <button type="button" onClick={showComparison}>See what your decisions changed</button>
          </section>
        )}
        {run.player && player.state && pending && (
          <DecisionCard key={pending.id} state={player.state} pending={pending} busy={playerBusy} error={playerError}
            onChoose={(optionId) => decide({ option_id: optionId })}
            onFreeText={(text) => decide({ free_text: text })} />
        )}
        <HeadlineAlert
          // While a decision card waits it has the floor; queued headlines show after.
          item={cardWaiting || (finished && events.queue.length === 0) ? undefined : reportedHeadline}
          queuedCount={Math.max(0, events.queue.length - 1)}
          onAdvance={advanceStory}
          onDismiss={advanceStory}
        />
      </WorldMap>

      <motion.aside
        className="inspector"
        aria-label="Scenario inspector"
        initial={isDemo || reducedMotion ? false : { opacity: 0, x: 5 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.18 }}
      >
        {run.player && player.summary && finished && (
          <PlayerSummaryPanel summary={player.summary} busy={playerBusy}
            onTryAgain={() => onRestart?.()} onSelectRole={onSelectRole} onBranch={(id) => branchFrom(id)} onCompare={showComparison} />
        )}
        <div className="scenario-summary">
          <div className="scenario-status">
            <span>{isDemo ? "Japan demo" : run.player ? `Player mode · ${run.player.roleTitle}` : "Prompted scenario"}</span>
            <span className="run-stream" role="status"><i data-connected={connected} aria-hidden="true" />{status}</span>
          </div>
          <h2>{run.title}</h2>
          {run.player && player.state && (
            <p className="player-branch" role="status">
              {player.state.branch_id === "main" ? "Original timeline" : `Your timeline · branch ${player.state.branch_id}`}
              {" · "}{madeDecisions} decision{madeDecisions === 1 ? "" : "s"} made
            </p>
          )}
          <button className="focus-button" type="button" onClick={focusFirstEvent}>
            <Crosshair size={16} aria-hidden="true" /> {firstPlace}
          </button>
        </div>
        <ImpactDashboard events={events.applied} />
        <WorldWire items={[...reports.values()].reverse()} loading={newsLoading} selectedId={selectedId}
          onSelect={(item) => { setSelectedId(item.event_id); if (!cardWaiting) focusNewsItem(item); }} />
      </motion.aside>

      <section className="timeline" aria-label="Simulation playback">
        <div className="timeline-tools">
          <motion.button
            className="play-button"
            type="button"
            onClick={togglePlayback}
            disabled={!connected || cardWaiting}
            title={cardWaiting ? "A decision is waiting" : undefined}
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
            {run.player && cardWaiting && <span className="player-paused">Paused · decision waiting</span>}
            {run.player && pending && !pending.waiting && <span className="player-paused" data-deferred="">Decision deferred</span>}
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
              <span>{run.player ? `Simulation clock · ${playback.speed}×` : pacing.rate}</span>
              <span>{run.player ? (atEnd ? "at the end" : "Story pace controls reading time") : pacing.left}</span>
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

      {run.player && player.summary && finished && compareOpen && (
        <AlternateTimeline ref={compareHeadingRef} comparison={player.summary.comparison} score={player.summary.score}
          busy={playerBusy} onClose={() => {
            setCompareOpen(false);
            document.querySelector(".workspace")?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
          }}
          onTryAgain={() => onRestart?.()} onBranch={(id) => branchFrom(id)} />
      )}
    </div>
  );
}
