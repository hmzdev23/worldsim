"use client";

import { Crosshair, GlobeHemisphereWest, Pause, Play, ArrowCounterClockwise } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { earthquake, scenarioStartMinute, scenarioEndMinute, type ScenarioEvent } from "../lib/earthquake";
import { ImpactDashboard } from "./impact-dashboard";
import { WorldMap, type WorldMapHandle } from "./world-map";
import { WorldWire } from "./world-wire";

const speeds = [1, 2, 4];
const parsedRate = Number(process.env.NEXT_PUBLIC_SIMULATION_MINUTES_PER_SECOND ?? "60");
const minutesPerSecond = Number.isFinite(parsedRate) && parsedRate > 0 ? parsedRate : 60;
const startMinute = scenarioStartMinute;
const duration = Math.max(1, (scenarioEndMinute - startMinute) / minutesPerSecond);

type Playback = { state: "playing" | "paused"; speed: number };
type AppliedEvent = ScenarioEvent;
type StreamMessage =
  | { kind: "snapshot"; sim_time_minutes: number; playback: Playback; events: AppliedEvent[] }
  | { kind: "event"; sim_time_minutes: number; event: AppliedEvent }
  | { kind: "clock"; sim_time_minutes: number; playback: Playback };

function formatSimTime(minutes: number) {
  const day = Math.floor(minutes / 1440) + 1;
  const hour = Math.floor(minutes % 1440 / 60);
  const minute = Math.floor(minutes % 60);
  return `DAY ${day} · ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function streamUrl() {
  if (process.env.NEXT_PUBLIC_SIMULATION_WS_URL) return process.env.NEXT_PUBLIC_SIMULATION_WS_URL;
  return `ws://${window.location.hostname}:8765/stream`;
}

export function Simulation() {
  const mapRef = useRef<WorldMapHandle>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const [connectionState, setConnectionState] = useState<"connecting" | "connected" | "reconnecting">("connecting");
  const [simTime, setSimTime] = useState(startMinute);
  const [appliedEvents, setAppliedEvents] = useState<AppliedEvent[]>([]);
  const [playback, setPlayback] = useState<Playback>({ state: "paused", speed: 1 });
  const connected = connectionState === "connected";
  const speed = playback.speed;
  const elapsed = Math.min(duration, Math.max(0, (simTime - startMinute) / minutesPerSecond));

  useEffect(() => {
    let stopped = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let socket: WebSocket | null = null;

    function connect() {
      if (stopped) return;
      setConnectionState((previous) => previous === "connecting" ? "connecting" : "reconnecting");
      socket = new WebSocket(streamUrl());
      socketRef.current = socket;
      socket.onopen = () => {
        if (!stopped) {
          setConnectionState("connected");
          socket?.send(JSON.stringify({ action: "pause" }));
          socket?.send(JSON.stringify({ action: "seek", sim_time_minutes: startMinute }));
        }
      };
      socket.onmessage = (message) => {
        let data: StreamMessage;
        try {
          data = JSON.parse(message.data as string) as StreamMessage;
        } catch {
          return;
        }
        if (data.kind === "snapshot") {
          setSimTime(data.sim_time_minutes);
          setPlayback(data.playback);
          setAppliedEvents(data.events);
        } else if (data.kind === "event") {
          setAppliedEvents((events) => events.some((event) => event.id === data.event.id)
            ? events
            : [...events, data.event].sort((a, b) => a.sim_time_minutes - b.sim_time_minutes || a.sequence - b.sequence));
        } else if (data.kind === "clock") {
          setSimTime(data.sim_time_minutes);
          setPlayback(data.playback);
        }
      };
      socket.onclose = () => {
        if (socketRef.current === socket) socketRef.current = null;
        if (stopped) return;
        setConnectionState("reconnecting");
        retryTimer = setTimeout(connect, 1200);
      };
      socket.onerror = () => socket?.close();
    }

    connect();
    return () => {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      socketRef.current = null;
      socket?.close();
    };
  }, []);

  const sendControl = useCallback((control: Record<string, unknown>) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify(control));
  }, []);

  useEffect(() => {
    if (connected && playback.state === "playing" && elapsed >= duration) {
      sendControl({ action: "pause" });
    }
  }, [connected, elapsed, playback.state, sendControl]);

  function focusEpicenter() {
    mapRef.current?.focusLocation(earthquake.location);
  }

  function seek(to: number) {
    const minute = Math.round(startMinute + to * minutesPerSecond);
    sendControl({ action: "seek", sim_time_minutes: minute });
  }

  function togglePlayback() {
    if (playback.state === "playing") {
      sendControl({ action: "pause" });
      return;
    }
    if (elapsed >= duration) seek(0);
    if (elapsed === 0 || elapsed >= duration) focusEpicenter();
    sendControl({ action: "play" });
  }

  const playbackLabel = playback.state === "playing" ? "Pause" : elapsed >= duration ? "Replay" : "Play";
  const hasEarthquake = appliedEvents.some((event) => event.id === earthquake.id);
  const statusText = connected
    ? "Fictional simulation · stream connected"
    : connectionState === "connecting"
      ? "Connecting to local simulation"
      : "Run ./scripts/run-demo.sh to connect";

  return (
    <main className="simulation-shell">
      <header className="masthead">
        <h1 className="wordmark">
          <span className="brand-icon"><GlobeHemisphereWest size={23} weight="duotone" /></span>
          <span>WORLD<span className="wordmark-slashes">//</span>SIM</span>
        </h1>
        <span className="mode-label" role="status" aria-live="polite"><span aria-hidden="true" />{statusText}</span>
      </header>

      <div className="workspace">
        <WorldMap ref={mapRef} elapsedSeconds={elapsed} events={appliedEvents} />

        <aside className="scenario-panel" aria-labelledby="scenario-title">
          <div className="scenario-heading">
            <span className="section-label">Demo scenario</span>
            <h2 id="scenario-title">{earthquake.title}</h2>
            <p>{earthquake.description}</p>
          </div>
          <dl className="scenario-details">
            <div><dt>Magnitude</dt><dd>{earthquake.magnitude}</dd></div>
            <div><dt>Region</dt><dd>{earthquake.region}</dd></div>
            <div>
              <dt>Epicenter</dt>
              <dd>{earthquake.location.lat.toFixed(2)}° N, {earthquake.location.lon.toFixed(2)}° E</dd>
            </div>
          </dl>
          <button className="focus-button" type="button" onClick={focusEpicenter}>
            <Crosshair size={19} /> Fly to epicenter
          </button>
          <div className="map-key">
            <h3 className="section-label">Map key</h3>
            <span><i className="key-epicenter" aria-hidden="true" /> Epicenter</span>
            <span><i className="key-wave" aria-hidden="true" /> Shockwave</span>
          </div>
        </aside>

        <ImpactDashboard events={appliedEvents} />
        <WorldWire events={appliedEvents} />

        <section className="timeline" aria-label="Simulation playback">
          <div className="timeline-tools">
            <button className="play-button" type="button" onClick={togglePlayback} disabled={!connected}>
              {playback.state === "playing" ? <Pause size={17} weight="fill" /> : <Play size={17} weight="fill" />}
              {playbackLabel}
            </button>
            <button className="reset-button" type="button" aria-label="Reset playback" title="Reset playback"
              disabled={!connected}
              onClick={() => {
                sendControl({ action: "pause" });
                sendControl({ action: "seek", sim_time_minutes: startMinute });
              }}>
              <ArrowCounterClockwise size={18} />
            </button>
          </div>
          <div className="timeline-track">
            <div className="timeline-meta">
              <label className="section-label" htmlFor="playback-position">Simulation timeline</label>
              <span>{formatSimTime(simTime)} <span className="time-divider">/</span> {formatSimTime(scenarioEndMinute)}</span>
            </div>
            <input
              id="playback-position"
              className="position-input"
              type="range"
              min={0}
              max={duration}
              step={0.05}
              value={Math.floor(elapsed * 20) / 20}
              aria-valuetext={`${Math.floor(elapsed)} of ${duration} seconds`}
              disabled={!connected}
              onChange={(event) => seek(event.currentTarget.valueAsNumber)}
              style={{ "--elapsed": `${(elapsed / duration) * 100}%` } as CSSProperties}
            />
          </div>
          <div className="speed-control" role="group" aria-label="Playback speed">
            {speeds.map((option) => (
              <button key={option} type="button" aria-pressed={speed === option} disabled={!connected}
                onClick={() => sendControl({ action: "speed", speed: option })}>
                {option}×
              </button>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
