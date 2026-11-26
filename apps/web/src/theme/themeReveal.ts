/**
 * Organic light/dark "reveal" transition.
 *
 * Ported from the theme-toggle reference the product owner supplied (cojeev `applyTheme` /
 * `themeRevealPath`), without its `motion` dependency:
 *   - The browser's View Transitions API snapshots the current page, the new colour mode is
 *     committed synchronously, and the *new* page is revealed through a clip-path.
 *   - The clip-path is a smooth 12-lobed blob that grows from an origin chosen from nine
 *     screen zones (corners, edge midpoints, centre), never repeating the previous zone, so the
 *     reveal starts somewhere different each time.
 *   - Duration 1.2–1.38 s, easing cubic-bezier(.42, 0, .18, 1), same as the reference.
 *
 * Falls back to an instant switch when the user prefers reduced motion, the tab is hidden,
 * or the browser lacks View Transitions / `clip-path: path()` (e.g. older Firefox/Safari).
 * Scrolling or resizing mid-reveal finishes it immediately, as in the reference.
 * The CSS half lives in styles.css under "Theme reveal".
 */

type Point = { x: number; y: number };

/** Corners, edge midpoints and centre, as fractions of the viewport. */
const ZONES: ReadonlyArray<readonly [number, number]> = [
  [0.07, 0.07], [0.93, 0.07], [0.93, 0.93], [0.07, 0.93],
  [0.06, 0.5], [0.94, 0.5], [0.5, 0.06], [0.5, 0.94], [0.5, 0.5],
];
let previousZone = -1;

/** Pick a reveal origin in a different zone from last time, with a little jitter. */
function variedOrigin(width: number, height: number): Point {
  let zone = Math.floor(Math.random() * (previousZone >= 0 ? 8 : 9));
  if (previousZone >= 0 && zone >= previousZone) zone++;
  previousZone = zone;
  const [fx, fy] = ZONES[zone]!;
  const jitter = () => (Math.random() - 0.5) * 0.07;
  return {
    x: Math.max(12, Math.min(width - 12, width * (fx + jitter()))),
    y: Math.max(12, Math.min(height - 12, height * (fy + jitter()))),
  };
}

/**
 * Closed blob path (viewport px) at `progress` 0..1. Twelve points on a wobbling radius are
 * joined with Catmull-Rom-style cubic Béziers; at progress 1 it reaches past every corner.
 */
export function revealPath(progress: number, origin: Point, width: number, height: number, phase = 0): string {
  const p = Math.max(0, Math.min(1, progress));
  const { x, y } = origin;
  const reach = Math.hypot(Math.max(x, width - x), Math.max(y, height - y)) / 0.72;
  const pts = Array.from({ length: 12 }, (_, i) => {
    const a = (i * Math.PI) / 6;
    const r = reach * p * (1 + 0.12 * Math.sin(a * 3 + p * 0.65 + phase) + 0.065 * Math.cos(a * 5 - p * 0.35 - phase * 0.7));
    return { x: x + Math.cos(a) * r, y: y + Math.sin(a) * r };
  });
  const f = (n: number) => Number(n.toFixed(2));
  let d = `M${f(pts[0]!.x)} ${f(pts[0]!.y)}`;
  for (let i = 0; i < 12; i++) {
    const b = pts[(i + 11) % 12]!, s = pts[i]!, e = pts[(i + 1) % 12]!, n = pts[(i + 2) % 12]!;
    d += `C${f(s.x + (e.x - b.x) / 6)} ${f(s.y + (e.y - b.y) / 6)} ${f(e.x - (n.x - s.x) / 6)} ${f(e.y - (n.y - s.y) / 6)} ${f(e.x)} ${f(e.y)}`;
  }
  return d + 'Z';
}

/** CSS cubic-bezier(x1, y1, x2, y2) as a function of time 0..1 (Newton–Raphson + bisection). */
function cubicBezier(x1: number, y1: number, x2: number, y2: number) {
  const bez = (t: number, a: number, b: number) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
  const slope = (t: number, a: number, b: number) => 3 * a * (1 - t) ** 2 + 6 * (b - a) * t * (1 - t) + 3 * (1 - b) * t * t;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 6; i++) {
      const s = slope(t, x1, x2);
      if (Math.abs(s) < 1e-6) break;
      t -= (bez(t, x1, x2) - x) / s;
    }
    if (t < 0 || t > 1 || Math.abs(bez(t, x1, x2) - x) > 1e-4) {
      let lo = 0, hi = 1; t = x;
      for (let i = 0; i < 30; i++) { if (bez(t, x1, x2) < x) lo = t; else hi = t; t = (lo + hi) / 2; }
    }
    return bez(t, y1, y2);
  };
}
const ease = cubicBezier(0.42, 0, 0.18, 1);

type VT = { ready: Promise<void>; finished: Promise<void>; skipTransition: () => void };
let running: (() => void) | null = null;

/**
 * Run `commit` (which must apply the new colour mode synchronously, e.g. via flushSync)
 * behind the organic reveal. Safe to call repeatedly; a second call finishes the first.
 */
export function revealThemeChange(commit: () => void): void {
  running?.();
  const doc = document as Document & { startViewTransition?: (cb: () => void) => VT };
  const root = doc.documentElement;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const supported = typeof doc.startViewTransition === 'function' && CSS.supports('clip-path', 'path("M0 0L1 0L1 1Z")');
  if (reduced || doc.hidden || !supported) { commit(); return; }

  const width = root.clientWidth, height = root.clientHeight;
  const origin = variedOrigin(width, height);
  const phase = Math.random() * Math.PI * 2;
  const duration = 1200 + Math.random() * 180;
  let raf = 0, done = false, view: VT | null = null;

  const setClip = (progress: number) => root.style.setProperty('--theme-reveal-clip', `path("${revealPath(progress, origin, width, height, phase)}")`);
  const finish = () => {
    if (done) return;
    done = true;
    cancelAnimationFrame(raf);
    view?.skipTransition();
    root.removeAttribute('data-theme-reveal');
    root.style.removeProperty('--theme-reveal-clip');
    window.removeEventListener('scroll', finish, true);
    window.removeEventListener('resize', finish);
    if (running === finish) running = null;
  };
  running = finish;

  setClip(0);
  root.setAttribute('data-theme-reveal', '');
  window.addEventListener('scroll', finish, { capture: true, passive: true });
  window.addEventListener('resize', finish, { passive: true });
  try {
    view = doc.startViewTransition(commit);
  } catch {
    finish();
    commit();
    return;
  }
  view.ready.then(() => {
    if (done) return;
    const start = performance.now();
    const step = (now: number) => {
      if (done) return;
      const t = Math.min(1, (now - start) / duration);
      setClip(ease(t));
      if (t < 1) raf = requestAnimationFrame(step); else finish();
    };
    raf = requestAnimationFrame(step);
  }, finish);
  view.finished.then(finish, finish);
}
