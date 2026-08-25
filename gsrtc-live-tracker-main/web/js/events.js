/* Minimal pub/sub so screens can talk to each other without importing each other. */
const handlers = new Map();

export function on(name, fn) {
  if (!handlers.has(name)) handlers.set(name, new Set());
  handlers.get(name).add(fn);
  return () => handlers.get(name).delete(fn);
}

export function emit(name, ...args) {
  handlers.get(name)?.forEach((fn) => {
    try { fn(...args); } catch (e) { console.error(`[events] ${name}`, e); }
  });
}
