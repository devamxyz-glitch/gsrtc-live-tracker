/**
 * Continuous vehicle tracking.
 *
 * A single client watching one bus has to wait for two polls before it can say anything about
 * speed. The server does not: it keeps polling the buses people are interested in and holds a
 * short history for each, so the first request already comes back with speed, movement and a
 * trail.
 *
 * ⚠️ Load discipline. The upstream is a third party whose API we are reusing without an
 * agreement, so this deliberately does NOT track the whole 8.5k fleet. It tracks only what
 * someone is actually looking at, and it is capped: at the defaults the tracker never exceeds
 * roughly `TRACKER_MAX_PLATES / (TRACKER_INTERVAL_MS / 1000)` requests per second — about three.
 * Raising those limits raises the chance of the credentials being rotated or the IP blocked.
 * Set TRACKER_ENABLED=0 to turn the whole thing off and fall back to on-demand fetching.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { gsrtc } from './upstream.mjs';
import { speedFrom, movementFrom, freshness } from '../web/js/insight.js';
import * as push from './push.mjs';

const env = process.env;
// Anchored to the project, not cwd — same reasoning as .env in upstream.mjs.
const PROJECT_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

export const config = {
  enabled: env.TRACKER_ENABLED !== '0',
  maxPlates: Number(env.TRACKER_MAX_PLATES || 80),
  intervalMs: Number(env.TRACKER_INTERVAL_MS || 25000),      // a plate someone is watching now
  idleIntervalMs: Number(env.TRACKER_IDLE_INTERVAL_MS || 45000), // a plate only on a route map
  concurrency: Number(env.TRACKER_CONCURRENCY || 3),
  dropAfterMs: Number(env.TRACKER_DROP_AFTER_MS || 5 * 60 * 1000),
  historySize: Number(env.TRACKER_HISTORY || 40),
  tickMs: 1000,
  // Restarts are routine — a deploy, a crash, a reboot. Without this every restart throws
  // away the history that makes speed available immediately, and the first person back on
  // the app waits for it to be rebuilt from scratch.
  stateFile: env.TRACKER_STATE_FILE || path.join(PROJECT_ROOT, '.data', 'tracker.json'),
  saveEveryMs: Number(env.TRACKER_SAVE_MS || 30000),
};

const entries = new Map();   // plate -> entry
let inFlight = 0;
let loop = null;
let saveTimer = null;
let dirty = false;
let backoffUntil = 0;
let consecutiveErrors = 0;
const counters = { polls: 0, errors: 0, started: Date.now() };

function makeEntry(plate) {
  return {
    plate,
    fixes: [],          // { lat, lng, at }
    row: null,          // the last full status row from upstream
    lastPolled: 0,
    lastInterest: 0,
    focused: false,     // someone has this bus open, rather than just on a map
    failures: 0,
  };
}

/**
 * Register interest in one or more plates. Everything the tracker does is driven by this —
 * nothing is polled that nobody asked for.
 *
 * `focused` marks the bus a client currently has open, which earns the shorter interval.
 */
export function watch(plates, { focused = false } = {}) {
  if (!config.enabled) return;
  const now = Date.now();
  for (const raw of [].concat(plates)) {
    const plate = String(raw || '').trim().toUpperCase();
    if (!plate) continue;
    let entry = entries.get(plate);
    if (!entry) {
      if (entries.size >= config.maxPlates && !evictOne()) continue;
      entry = makeEntry(plate);
      entries.set(plate, entry);
    }
    entry.lastInterest = now;
    if (focused) entry.focused = true;
  }
  start();
}

/** Drops the plate nobody has asked about for longest. Returns false if all are still wanted. */
function evictOne() {
  let oldest = null;
  for (const entry of entries.values()) {
    if (!oldest || entry.lastInterest < oldest.lastInterest) oldest = entry;
  }
  if (!oldest || Date.now() - oldest.lastInterest < 30000) return false;
  entries.delete(oldest.plate);
  return true;
}

/** What the tracker knows about a plate right now, or null if it is not tracking it. */
export function get(plate) {
  const entry = entries.get(String(plate || '').trim().toUpperCase());
  if (!entry || !entry.fixes.length) return null;
  return snapshot(entry);
}

function snapshot(entry) {
  const move = movementFrom(entry.fixes);
  const speed = speedFrom(entry.fixes);
  const last = entry.fixes[entry.fixes.length - 1];
  return {
    plate: entry.plate,
    row: entry.row,
    lat: last.lat,
    lng: last.lng,
    updatedAt: last.at,
    // The client seeds its own history from these, so speed is on screen immediately
    // instead of twenty seconds after the page opens.
    fixes: entry.fixes.map((f) => ({ lat: f.lat, lng: f.lng, at: f.at })),
    speedKmh: speed.kmh,
    speedConfidence: speed.confidence,
    movement: move.state,
    stillForMs: move.stillForMs ?? null,
    freshness: freshness(last.at),
    samples: entry.fixes.length,
  };
}

/** Snapshots for a set of plates, skipping any the tracker has nothing for yet. */
export function getMany(plates) {
  const out = new Map();
  for (const raw of plates) {
    const snap = get(raw);
    if (snap) out.set(snap.plate, snap);
  }
  return out;
}

export function stats() {
  return {
    enabled: config.enabled,
    persisted: config.enabled && fs.existsSync(config.stateFile),
    watching: entries.size,
    withFixes: [...entries.values()].filter((e) => e.fixes.length).length,
    polls: counters.polls,
    errors: counters.errors,
    pollsPerSecond: Number((counters.polls / Math.max(1, (Date.now() - counters.started) / 1000)).toFixed(2)),
    backingOff: Date.now() < backoffUntil,
  };
}

/* ------------------------------------------------------------------ persistence */
/**
 * A fix older than this is not worth restoring: the bus has moved on, and a stale point
 * would poison the speed estimate the moment it is paired with a fresh one.
 */
const MAX_RESTORE_AGE_MS = 10 * 60 * 1000;

/** Reads any state left by the previous process. Safe to call when the file does not exist. */
export function restore() {
  if (!config.enabled) return 0;
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(config.stateFile, 'utf8'));
  } catch {
    return 0;   // no state, unreadable, or corrupt — starting cold is always valid
  }
  if (!Array.isArray(parsed?.entries)) return 0;

  const cutoff = Date.now() - MAX_RESTORE_AGE_MS;
  let restored = 0;
  for (const saved of parsed.entries) {
    const fixes = (saved.fixes || []).filter((f) => f && f.at > cutoff);
    if (!saved.plate || !fixes.length) continue;
    entries.set(saved.plate, {
      ...makeEntry(saved.plate),
      fixes,
      row: saved.row || null,
      // Everything restored is stale by definition; let the loop re-poll it promptly, and
      // treat it as unfocused until a client says otherwise.
      lastInterest: Date.now(),
      lastPolled: 0,
    });
    restored += 1;
  }
  if (restored) start();
  return restored;
}

/** Atomic write: a half-written state file would be thrown away on the next boot. */
async function persist() {
  if (!config.enabled || !dirty) return;
  dirty = false;
  const payload = {
    savedAt: Date.now(),
    entries: [...entries.values()]
      .filter((e) => e.fixes.length)
      .map((e) => ({ plate: e.plate, fixes: e.fixes, row: e.row })),
  };
  const tmp = `${config.stateFile}.tmp`;
  try {
    await fsp.mkdir(path.dirname(config.stateFile), { recursive: true });
    await fsp.writeFile(tmp, JSON.stringify(payload));
    await fsp.rename(tmp, config.stateFile);
  } catch {
    // Losing the snapshot costs a warm start, never correctness. Never take the app down.
    dirty = true;
  }
}

function scheduleSave() {
  if (saveTimer || !config.enabled) return;
  saveTimer = setInterval(persist, config.saveEveryMs);
  saveTimer.unref?.();
}

/* ------------------------------------------------------------------ the loop */
function start() {
  if (loop || !config.enabled) return;
  loop = setInterval(tick, config.tickMs);
  loop.unref?.();
  scheduleSave();
}

function stop() {
  clearInterval(loop);
  loop = null;
  // The save timer belongs to the loop. Left running it persisted an empty watch list every
  // thirty seconds for as long as the process lived, having nothing to save.
  clearInterval(saveTimer);
  saveTimer = null;
}

function intervalFor(entry) {
  // A bus that keeps failing gets progressively less attention rather than none.
  const base = entry.focused ? config.intervalMs : config.idleIntervalMs;
  return base * Math.min(8, 2 ** entry.failures);
}

let lastAlertSync = 0;

function tick() {
  const now = Date.now();

  // A bus somebody is waiting for must keep being polled even with every app closed —
  // that is the entire point of a push alert. Refresh that list periodically.
  if (now - lastAlertSync > 20000) {
    lastAlertSync = now;
    const plates = push.platesToWatch();
    if (plates.length) watch(plates);
    for (const plate of plates) {
      const entry = entries.get(plate);
      if (entry) entry.lastInterest = now;   // keep it out of the eviction sweep
    }
  }

  // Forget anything nobody has asked about recently.
  for (const [plate, entry] of entries) {
    if (now - entry.lastInterest > config.dropAfterMs) entries.delete(plate);
    else if (now - entry.lastInterest > config.intervalMs * 2) entry.focused = false;
  }
  if (!entries.size) return stop();
  if (now < backoffUntil) return;

  const due = [...entries.values()]
    .filter((entry) => now - entry.lastPolled >= intervalFor(entry))
    .sort((a, b) => a.lastPolled - b.lastPolled)
    .slice(0, Math.max(0, config.concurrency - inFlight));

  for (const entry of due) poll(entry);
}

async function poll(entry) {
  entry.lastPolled = Date.now();
  inFlight += 1;
  try {
    const rows = await gsrtc.vehicleStatus(entry.plate);
    counters.polls += 1;
    consecutiveErrors = 0;
    entry.failures = 0;

    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) return;
    entry.row = row;

    const lat = parseFloat(row.Latitude), lng = parseFloat(row.Longitude);
    if (!isFinite(lat) || !isFinite(lng) || (lat === 0 && lng === 0)) return;

    const previous = entry.fixes[entry.fixes.length - 1];
    // Identical coordinates still count as evidence the bus has not moved, but there is no
    // point storing the same point over and over — refresh the timestamp instead.
    if (previous && previous.lat === lat && previous.lng === lng) {
      previous.at = Date.now();
      return;
    }
    entry.fixes.push({ lat, lng, at: Date.now() });
    if (entry.fixes.length > config.historySize) entry.fixes.shift();
    dirty = true;

    // Arrival alerts ride on the polling we are already doing, so a subscriber costs the
    // operator nothing extra. Never let a push failure interrupt tracking.
    push.evaluate(entry.plate, { lat, lng }, { nextStop: row.NextLocation || '' })
      .catch(() => {});
  } catch (e) {
    counters.errors += 1;
    entry.failures += 1;
    consecutiveErrors += 1;
    // The upstream is someone else's service. If it starts refusing us, ease off entirely
    // rather than hammering it while it is unhappy.
    if (consecutiveErrors >= 5) {
      backoffUntil = Date.now() + Math.min(5 * 60000, 10000 * 2 ** Math.min(5, consecutiveErrors - 5));
    }
  } finally {
    inFlight -= 1;
  }
}

/** Flushes state and stops the loops. Called on SIGINT/SIGTERM so a deploy keeps its history. */
export async function shutdown() {
  stop();
  clearInterval(saveTimer);
  saveTimer = null;
  await persist();
  entries.clear();
}
