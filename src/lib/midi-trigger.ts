export function midiPressEdge(armed: Map<string, boolean>, fired: Map<string, number>,
  key: string, value: number, now: number): boolean {
  if (!Number.isInteger(value) || value < 0 || value > 127) return false;
  if (value < 64) { armed.set(key, true); return false; }
  if (armed.get(key) === false) return false;
  // The rising edge is consumed before the cooldown check.
  armed.set(key, false);
  if (now - (fired.get(key) ?? -Infinity) < 500) return false;
  fired.set(key, now);
  return true;
}

export function midiToggleEdge(last: Map<string, number>, fired: Map<string, number>,
  key: string, value: number, now: number): boolean {
  if (!Number.isInteger(value) || value < 0 || value > 127) return false;
  const state = value >= 64 ? 1 : 0;
  const previous = last.get(key);
  if (previous === state) return false;
  last.set(key, state);
  // An initial zero establishes baseline without selecting a route.
  if (previous === undefined && state === 0) return false;
  if (now - (fired.get(key) ?? -Infinity) < 500) return false;
  fired.set(key, now);
  return true;
}
