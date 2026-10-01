import type { Parameter } from "./controls";

// Pure, offline encoding. No MIDI device or output is opened here.
export type MidiBytes = [number, number, number];
const peakNrpn = new Set(["0:17", "0:26", "0:35", "0:55"]);
const peakCc = new Set([75, 79, 80, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 117, 103]);

export function encodePeakParameter(parameter: Parameter, value: number): MidiBytes[] {
  if (!Number.isInteger(parameter.channel) || parameter.channel < 1 || parameter.channel > 16 ||
      !Number.isInteger(value) || value < 0 || value > 127) throw new Error("Invalid Peak MIDI channel or value.");
  const status = 0xb0 | (parameter.channel - 1);
  if (parameter.nrpn) {
    const [msb, lsb] = parameter.nrpn;
    if (!peakNrpn.has(`${msb}:${lsb}`)) throw new Error("Unverified Peak NRPN parameter.");
    // One indivisible event in the simulator. CC38 is deliberately absent.
    return [[status, 99, msb], [status, 98, lsb], [status, 6, value]];
  }
  if (!peakCc.has(parameter.cc)) throw new Error("Unverified Peak CC parameter.");
  return [[status, parameter.cc, value]];
}

export function formatMidiBytes(messages: MidiBytes[]): string {
  return messages.map(bytes => bytes.map(byte => byte.toString(16).toUpperCase().padStart(2, "0")).join(" ")).join(" · ");
}
