import { useEffect, useRef } from "react";
import { nearestFrame } from "./quantities";

/** The playback speeds offered, as multiples of real time. */
export const SPEEDS = [0.25, 0.5, 1, 2, 4];

/** How far back the trail reaches behind the time cursor [s]. */
export const TRAIL_SECONDS = 3;

/** `time` moved on by `step` [s] through the run's `times`, wrapping from its end to its start. */
export function advanceTime(times: Float64Array, time: number, step: number): number {
  const start = times[0];
  const duration = times[times.length - 1] - start;
  if (!(duration > 0)) return start;
  const elapsed = (time - start + step) % duration;
  return start + (elapsed < 0 ? elapsed + duration : elapsed);
}

/**
 * The first frame of the trail drawn behind `frame`: `TRAIL_SECONDS` back, but never
 * before `cleared`, the frame of the last seek, unless the cursor has since passed back
 * over it.
 */
export function trailStart(times: Float64Array, cleared: number, frame: number): number {
  const reach = nearestFrame(times, times[frame] - TRAIL_SECONDS);
  return cleared <= frame ? Math.max(cleared, reach) : frame;
}

/** Whether the user asked the system for less motion. */
export function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

interface PlaybackOptions {
  times: Float64Array;
  frame: number;
  playing: boolean;
  /** Multiple of real time. */
  speed: number;
  /** Called with the frame playback moved the cursor to; `wrapped` when it looped. */
  onFrame: (frame: number, wrapped: boolean) => void;
}

/** Moves the time cursor through `times` at `speed` times real time while `playing`. */
export function usePlayback({ times, frame, playing, speed, onFrame }: PlaybackOptions) {
  const clock = useRef({ time: times[frame], frame });
  if (clock.current.frame !== frame) clock.current = { time: times[frame], frame };
  const latest = useRef({ speed, onFrame });
  latest.current = { speed, onFrame };

  useEffect(() => {
    if (!playing || times.length < 2) return;
    let request = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const step = ((now - last) / 1000) * latest.current.speed;
      last = now;
      const before = clock.current;
      const time = advanceTime(times, before.time, step);
      const next = nearestFrame(times, time);
      clock.current = { time, frame: next };
      if (next !== before.frame) latest.current.onFrame(next, time < before.time);
      request = requestAnimationFrame(tick);
    };
    request = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(request);
  }, [playing, times]);
}

/** Calls `toggle` on Space, unless a text field, list or button has the key. */
export function useSpaceToggle(toggle: () => void) {
  const latest = useRef(toggle);
  latest.current = toggle;
  useEffect(() => {
    const press = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.repeat || event.altKey || event.ctrlKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest?.("input, select, textarea, button, [contenteditable]")) return;
      event.preventDefault();
      latest.current();
    };
    window.addEventListener("keydown", press);
    return () => window.removeEventListener("keydown", press);
  }, []);
}
