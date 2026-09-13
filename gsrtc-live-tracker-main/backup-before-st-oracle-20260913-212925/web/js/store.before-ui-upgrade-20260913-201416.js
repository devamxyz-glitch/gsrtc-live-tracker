/* Everything the app remembers lives here — in this browser only, never on a server.
   One namespaced key, one schema version, so a future format change can migrate cleanly. */

const KEY = 'st.tracker.v1';
const MAX_RECENT_PLATES = 8;
const MAX_RECENT_ROUTES = 8;

const DEFAULTS = {
  v: 1,
  settings: {
    lang: null,              // null => detect from the browser
    theme: 'system',         // system | light | dark
    text: 'normal',          // normal | large
    refresh: 20,             // seconds between live polls
    mapStyle: 'detailed',    // Voyager: most place names of the keyless raster options
    stats: true,             // anonymous feature counters; see stats.js and Settings
  },
  commutes: [],              // { id, fromId, fromName, fromGu, toId, toName, toGu }
  buses: [],                 // { plate, depot, division, label }
  recentPlates: [],          // { plate, at }
  recentRoutes: [],          // { fromId, fromName, toId, toName, at }
  lastSeen: {},              // plate -> { lat, lng, status, at }  (offline fallback)
  lastLocation: null,        // { lat, lng, at }
};

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULTS);
    const parsed = JSON.parse(raw);
    const res = { ...structuredClone(DEFAULTS), ...parsed, settings: { ...DEFAULTS.settings, ...(parsed.settings || {}) } };
    if (res.settings.text === 'largest') res.settings.text = 'large';
    return res;
  } catch {
    return structuredClone(DEFAULTS);
  }
}

let state = read();
const listeners = new Set();

function commit() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* quota or private mode — the app still works, it just forgets */
  }
  listeners.forEach((fn) => fn(state));
}

export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

/**
 * A local, random id that says "the same install" for crowd reports.
 *
 * The per-hour report limit and the 30-second undo both need to tell one rider from another. That
 * used to be a hash of the IP, which behind the proxy is the same address for everybody — so the
 * first person to report a bus silenced everyone else for an hour, and an undo could withdraw a
 * stranger's report.
 *
 * Deliberately *not* the analytics device id: that one can be switched off and reset by the rider,
 * and reporting has to keep working when they do. It is also a link between the two datasets that
 * there is no reason to create.
 */
export function reporterId() {
  if (!state.reporterId) {
    state.reporterId = (crypto.randomUUID?.() || String(Math.random()).slice(2)).replace(/-/g, '');
    commit();
  }
  return state.reporterId;
}

export const settings = {
  get: () => state.settings,
  set(patch) { state.settings = { ...state.settings, ...patch }; commit(); },
};

/* ------------------------------------------------------------ saved buses */
export const buses = {
  list: () => state.buses,
  has: (plate) => state.buses.some((b) => b.plate === plate),
  toggle(bus) {
    const i = state.buses.findIndex((b) => b.plate === bus.plate);
    if (i >= 0) state.buses.splice(i, 1);
    else state.buses.unshift({ plate: bus.plate, depot: bus.depot || '', division: bus.division || '', label: bus.label || '' });
    commit();
    return i < 0;
  },
  remove(plate) {
    state.buses = state.buses.filter((b) => b.plate !== plate);
    commit();
  },
};

/* ------------------------------------------------------------ commutes */
export const commutes = {
  list: () => state.commutes,
  has: (fromId, toId) => state.commutes.some((c) => c.fromId === fromId && c.toId === toId),
  add(c) {
    if (commutes.has(c.fromId, c.toId)) return false;
    state.commutes.unshift({ id: `${c.fromId}-${c.toId}`, ...c });
    commit();
    return true;
  },
  remove(id) {
    state.commutes = state.commutes.filter((c) => c.id !== id);
    commit();
  },
  reverse(id) {
    const c = state.commutes.find((x) => x.id === id);
    if (!c) return;
    Object.assign(c, {
      id: `${c.toId}-${c.fromId}`,
      fromId: c.toId, fromName: c.toName, fromGu: c.toGu,
      toId: c.fromId, toName: c.fromName, toGu: c.fromGu,
    });
    commit();
  },
};

/* ------------------------------------------------------------ recents */
export const recents = {
  plates: () => state.recentPlates,
  routes: () => state.recentRoutes,
  pushPlate(plate) {
    if (!plate) return;
    const previous = state.recentPlates.find((r) => r.plate === plate);
    state.recentPlates = [{ plate, at: Date.now(), count: (previous?.count || 0) + 1 },
      ...state.recentPlates.filter((r) => r.plate !== plate)].slice(0, MAX_RECENT_PLATES);
    commit();
  },

  /**
   * The buses this device keeps coming back to.
   *
   * Nearly half of all lookups in the app are the same handful of plates, and people were
   * re-typing them daily — so the phone already knows the answer. Kept entirely on-device:
   * "which buses does this person follow" is a commute and a timetable, and the server has no
   * business holding it just to save someone a few keystrokes.
   */
  frequentPlates(min = 2, limit = 4) {
    return state.recentPlates
      .filter((r) => (r.count || 0) >= min)
      .sort((a, b) => (b.count || 0) - (a.count || 0) || b.at - a.at)
      .slice(0, limit);
  },
  /** Drops one plate. A recents list nobody can prune is a list people stop trusting. */
  removePlate(plate) {
    state.recentPlates = state.recentPlates.filter((r) => r.plate !== plate);
    commit();
  },
  pushRoute(r) {
    if (!r?.fromId || !r?.toId) return;
    state.recentRoutes = [{ ...r, at: Date.now() },
      ...state.recentRoutes.filter((x) => !(x.fromId === r.fromId && x.toId === r.toId))].slice(0, MAX_RECENT_ROUTES);
    commit();
  },
};

/* ------------------------------------------------------------ offline fallback */
export const lastSeen = {
  get: (plate) => state.lastSeen[plate] || null,
  put(plate, data) {
    state.lastSeen[plate] = { ...data, at: Date.now() };
    // keep the map small; only the last dozen buses matter offline
    const keys = Object.keys(state.lastSeen);
    if (keys.length > 12) {
      keys.sort((a, b) => state.lastSeen[a].at - state.lastSeen[b].at)
        .slice(0, keys.length - 12).forEach((k) => delete state.lastSeen[k]);
    }
    commit();
  },
};

export const location = {
  get: () => state.lastLocation || null,
  set: (coords) => {
    if (!coords || typeof coords.lat !== 'number' || typeof coords.lng !== 'number') return;
    state.lastLocation = { lat: coords.lat, lng: coords.lng, at: Date.now() };
    commit();
  },
};

export function clearAll() {
  state = structuredClone(DEFAULTS);
  commit();
}
