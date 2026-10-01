// A rehearsal model only. The browser has no claim to physical held-note state.
export type HeldNote = { source: number; channel: number; note: number; destination: number };
export type NoteTransition = { notes: HeldNote[]; releases: HeldNote[]; warning: string | null };

export function transitionNote(notes: HeldNote[], source: number, channel: number, note: number,
  velocity: number, destinations: number | number[] | null): NoteTransition {
  if (![source, channel, note, velocity].every(Number.isInteger) || source < 1 || source > 61 ||
      channel < 1 || channel > 16 || note < 0 || note > 127 || velocity < 0 || velocity > 127)
    throw new Error("Invalid simulated note event.");
  const matching = notes.filter(item => item.source === source && item.channel === channel && item.note === note);
  if (velocity === 0) return { notes: notes.filter(item => !matching.includes(item)), releases: matching, warning: null };
  const outputs = destinations === null ? [] : Array.isArray(destinations) ? destinations : [destinations];
  if (!outputs.length || outputs.some(destination => !Number.isInteger(destination) || destination < 1 || destination > 61))
    return { notes, releases: [], warning: "No simulated route destination; note-on was not tracked." };
  const next = [...new Set(outputs)].map(destination => ({ source, channel, note, destination }));
  return { notes: [...notes.filter(item => !matching.includes(item)), ...next], releases: matching,
    warning: matching.length ? "Repeated note-on replaced a tracked note; its original destination still needs release." : null };
}

export function transitionRoute(notes: HeldNote[], source: number, removedDestinations: number[]): string | null {
  const removed = new Set(removedDestinations);
  const held = notes.filter(note => note.source === source && removed.has(note.destination));
  return held.length ? `${held.length} simulated held note release(s) retain removed output(s) ${[...new Set(held.map(note => note.destination))].join(", ")}; other held outputs remain unaffected. No MIDI was sent.` : null;
}

export function disconnectedSource(notes: HeldNote[], source: number): string | null {
  const held = notes.filter(note => note.source === source);
  return held.length ? `${held.length} simulated held note(s) have an unresolved release after source disconnect. Physical silence cannot be confirmed.` : null;
}
