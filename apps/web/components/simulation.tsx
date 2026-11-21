"use client";

import { Crosshair, GlobeHemisphereWest, Pause, Play, ArrowCounterClockwise } from "@phosphor-icons/react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { earthquake } from "../lib/earthquake";
import { WorldMap, type WorldMapHandle } from "./world-map";

const speeds = [1, 2, 4];
const duration = earthquake.durationSeconds;

function formatElapsed(seconds: number) {
  return `00:${String(Math.floor(seconds)).padStart(2, "0")}`;
}

export function Simulation() {
  const mapRef = useRef<WorldMapHandle>(null);
  const elapsedRef = useRef(0);
  const [elapsed, setElapsed] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);

  useEffect(() => {
    if (!playing) return;
    let previous = performance.now();
    function advance(now: number) {
      const next = Math.min(duration, elapsedRef.current + ((now - previous) / 1000) * speed);
      previous = now;
      elapsedRef.current = next;
      setElapsed(next);
      if (next < duration) {
        frame = requestAnimationFrame(advance);
      } else {
        setPlaying(false);
      }
    }
    let frame = requestAnimationFrame(advance);
    return () => cancelAnimationFrame(frame);
  }, [playing, speed]);

  function seek(to: number) {
    elapsedRef.current = to;
    setElapsed(to);
  }

  function focusEpicenter() {
    mapRef.current?.focusLocation(earthquake.location);
  }

  function togglePlayback() {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (elapsed >= duration) seek(0);
    if (elapsed === 0 || elapsed >= duration) focusEpicenter();
    setPlaying(true);
  }

  const playbackLabel = playing ? "Pause" : elapsed >= duration ? "Replay" : "Play";

  return (
    <main className="simulation-shell">
      <header className="masthead">
        <h1 className="wordmark">
          <span className="brand-icon"><GlobeHemisphereWest size={23} weight="duotone" /></span>
          <span>WORLD<span className="wordmark-slashes">//</span>SIM</span>
        </h1>
        <span className="mode-label"><span aria-hidden="true" /> Fictional simulation</span>
      </header>

      <div className="workspace">
        <WorldMap ref={mapRef} elapsedSeconds={elapsed} />

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

        <section className="timeline" aria-label="Simulation playback">
          <div className="timeline-tools">
            <button className="play-button" type="button" onClick={togglePlayback}>
              {playing ? <Pause size={17} weight="fill" /> : <Play size={17} weight="fill" />}
              {playbackLabel}
            </button>
            <button className="reset-button" type="button" aria-label="Reset playback" title="Reset playback"
              onClick={() => {
                setPlaying(false);
                seek(0);
              }}>
              <ArrowCounterClockwise size={18} />
            </button>
          </div>
          <div className="timeline-track">
            <div className="timeline-meta">
              <label className="section-label" htmlFor="playback-position">Simulation timeline</label>
              <span>{formatElapsed(elapsed)} <span className="time-divider">/</span> {formatElapsed(duration)}</span>
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
              onChange={(event) => seek(event.currentTarget.valueAsNumber)}
              style={{ "--elapsed": `${(elapsed / duration) * 100}%` } as CSSProperties}
            />
          </div>
          <div className="speed-control" role="group" aria-label="Playback speed">
            {speeds.map((option) => (
              <button key={option} type="button" aria-pressed={speed === option} onClick={() => setSpeed(option)}>
                {option}×
              </button>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
