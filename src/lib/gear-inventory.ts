import { captureFor, type Scene } from "./studio";

export const GEAR_KEY = "mioxlplus.gear.v1";
export const GEAR_INVALID_BACKUP_KEY = "mioxlplus.gear.v1.invalid-backup";
export const PROFILE_CATALOG = [{ id: "novation-peak", manufacturer: "Novation", name: "Peak", note: "Published CC and NRPN parameter map" }] as const;
export const MODEL_CATALOG = [
  { id: "moog-one", name: "Moog One", maker: "Moog", kind: "midi", ports: [{ name: "MIDI OUT", direction: "out" }, { name: "MIDI IN", direction: "in" }], source: "https://cdn.inmusicbrands.com/Moog/MoogOne/Moog_One_Manual_8_2_19.pdf", note: "DIN IN/OUT verified; physical connections still need confirmation." },
  { id: "novation-peak", name: "Peak", maker: "Novation", kind: "midi", ports: [{ name: "MIDI OUT", direction: "out" }, { name: "MIDI IN", direction: "in" }], source: "https://userguides.novationmusic.com/hc/en-gb/articles/25494651161362-Peak-hardware-overview", note: "DIN IN/OUT verified; physical connections still need confirmation." },
  { id: "kontrol-s88-mk3", name: "Kontrol S88 MK3", maker: "Native Instruments", kind: "midi", ports: [{ name: "MIDI OUT", direction: "out" }], source: "https://docs.native-instruments.com/ni-tech-manuals/kontrol-s-mk3-manual/en/midi-mode", note: "DIN OUT verified. Other connectors are not modeled here." },
  { id: "akai-mpc-x", name: "MPC X", maker: "Akai", kind: "midi", ports: [], source: "", note: "User-confirmed model name. Port list and control behavior require source verification." },
  { id: "mioxl", name: "mioXL", maker: "iConnectivity", kind: "hub", ports: [], source: "https://www.iconnectivity.com/mioxl", note: "DIN sides come from the captured mioXL port inventory." },
  { id: "motu-24ai", name: "24Ai", maker: "MOTU", kind: "audio", ports: [], source: "https://motu.com/techsupport/manuals", note: "Audio connector details await confirmation on this unit." },
  { id: "motu-24ao", name: "24Ao", maker: "MOTU", kind: "audio", ports: [], source: "https://motu.com/techsupport/manuals", note: "Audio connector details await confirmation on this unit." },
  { id: "motu-828es", name: "828es", maker: "MOTU", kind: "audio", ports: [], source: "https://motu.com/techsupport/manuals", note: "Audio connector details await confirmation on this unit; add a second instance as needed." },
] as const;

export type MidiEndpoint = { id: string; name: string; direction: "in" | "out" };
// Reserved for future opt-in, input-only MIDI learn. No learn operation is active.
export type ControlBindingEvidence = { controlId: string; channel: number; cc: number; method: "manual" | "midi-learn"; evidence: string | null };
export type GearUnit = {
  id: string; name: string; midiChannel: number | null; endpoints: MidiEndpoint[];
  modelId?: string | null;
  capabilities?: ("midi" | "audio" | "controller" | "display")[];
  audioPorts?: AudioPort[];
  position?: { x: number; y: number };
  profileId: string | null; profileSource: "manual" | "device-identity" | "midi-ci"; profileEvidence: string | null;
  controlBindings?: ControlBindingEvidence[];
};
export type PhysicalWire = { id: string; endpointId: string; mioPort: number };
export type NamedRoute = { id: string; name: string; sourceEndpointId: string; targetEndpointId: string; policy: "destination" | "both" };
// Reserved separately from MIDI routing. No audio discovery, wiring editor, or controller is active.
export type AudioPort = { id: string; name: string; direction: "in" | "out" };
export type AudioInventoryExtension = { units: { id: string; name: string; model: string | null; ports?: AudioPort[] }[]; links: { id: string; from: string; to: string }[] };
export type GearInventory = { version: 1; units: GearUnit[]; wires: PhysicalWire[]; routes: NamedRoute[]; audio: AudioInventoryExtension };
export const emptyGearInventory = (): GearInventory => ({ version: 1, units: [], wires: [], routes: [], audio: { units: [], links: [] } });

const validId = (value: unknown) => typeof value === "string" && /^[\w-]{1,80}$/.test(value);
const validName = (value: unknown) => typeof value === "string" && value.trim().length > 0 && value.length <= 80;
export function parseGearInventory(value: unknown): GearInventory | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as GearInventory;
  if (raw.version !== 1 || !Array.isArray(raw.units) || raw.units.length > 64 ||
      !Array.isArray(raw.wires) || raw.wires.length > 128 || !Array.isArray(raw.routes) || raw.routes.length > 128 ||
      !raw.audio || !Array.isArray(raw.audio.units) || !Array.isArray(raw.audio.links) || raw.audio.units.length > 32 || raw.audio.links.length > 128) return null;
  const unitIds = new Set<string>(), endpointIds = new Set<string>(), directions = new Map<string, "in" | "out">();
  for (const unit of raw.units) {
    if (!unit || !validId(unit.id) || unitIds.has(unit.id) || !validName(unit.name) ||
        (unit.midiChannel !== null && (!Number.isInteger(unit.midiChannel) || unit.midiChannel < 1 || unit.midiChannel > 16)) ||
        (unit.profileId !== null && !validId(unit.profileId)) ||
        (unit.modelId !== undefined && unit.modelId !== null && !validId(unit.modelId)) ||
        (unit.position !== undefined && (!unit.position || !Number.isFinite(unit.position.x) || !Number.isFinite(unit.position.y) ||
          Math.abs(unit.position.x) > 10000 || Math.abs(unit.position.y) > 10000)) ||
        !["manual", "device-identity", "midi-ci"].includes(unit.profileSource) ||
        (unit.profileSource === "manual" ? unit.profileEvidence !== null : !validName(unit.profileEvidence)) ||
        !Array.isArray(unit.endpoints) || unit.endpoints.length > 16 ||
        (unit.capabilities !== undefined && (!Array.isArray(unit.capabilities) || unit.capabilities.some(capability => !["midi", "audio", "controller", "display"].includes(capability)))) ||
        (unit.audioPorts !== undefined && (!Array.isArray(unit.audioPorts) || unit.audioPorts.length > 64 || unit.audioPorts.some(port => !port || !validId(port.id) || !validName(port.name) || !["in", "out"].includes(port.direction)))) ||
        (unit.controlBindings !== undefined && (!Array.isArray(unit.controlBindings) || unit.controlBindings.length > 64 ||
          unit.controlBindings.some(binding => !binding || !validId(binding.controlId) ||
            !Number.isInteger(binding.channel) || binding.channel < 1 || binding.channel > 16 ||
            !Number.isInteger(binding.cc) || binding.cc < 0 || binding.cc > 127 ||
            !["manual", "midi-learn"].includes(binding.method) ||
            (binding.evidence !== null && !validName(binding.evidence))))) ) return null;
    unitIds.add(unit.id);
    for (const endpoint of unit.endpoints) {
      if (!endpoint || !validId(endpoint.id) || endpointIds.has(endpoint.id) || !validName(endpoint.name) ||
          !["in", "out"].includes(endpoint.direction)) return null;
      endpointIds.add(endpoint.id); directions.set(endpoint.id, endpoint.direction);
    }
  }
  const wireIds = new Set<string>();
  for (const wire of raw.wires) {
    if (!wire || !validId(wire.id) || wireIds.has(wire.id) || !endpointIds.has(wire.endpointId) ||
        !Number.isInteger(wire.mioPort) || wire.mioPort < 1 || wire.mioPort > 61) return null;
    wireIds.add(wire.id);
  }
  const routeIds = new Set<string>();
  for (const route of raw.routes) {
    if (!route || !validId(route.id) || routeIds.has(route.id) || !validName(route.name) ||
        directions.get(route.sourceEndpointId) !== "out" || directions.get(route.targetEndpointId) !== "in" ||
        !["destination", "both"].includes(route.policy)) return null;
    routeIds.add(route.id);
  }
  const audioUnitIds = new Set<string>(), audioPortIds = new Set<string>();
  for (const unit of raw.units) for (const port of unit.audioPorts ?? []) {
    if (audioPortIds.has(port.id)) return null;
    audioPortIds.add(port.id);
  }
  for (const unit of raw.audio.units) {
    if (!unit || !validId(unit.id) || audioUnitIds.has(unit.id) || !validName(unit.name) ||
      (unit.model !== null && !validId(unit.model)) || !Array.isArray(unit.ports) || unit.ports.length > 64) return null;
    audioUnitIds.add(unit.id);
    for (const port of unit.ports) {
      if (!port || !validId(port.id) || audioPortIds.has(port.id) || !validName(port.name) || !["in", "out"].includes(port.direction)) return null;
      audioPortIds.add(port.id);
    }
  }
  const audioLinkIds = new Set<string>();
  for (const link of raw.audio.links) {
    if (!link || !validId(link.id) || audioLinkIds.has(link.id) || !audioPortIds.has(link.from) || !audioPortIds.has(link.to)) return null;
    const allPorts = [...raw.units.flatMap(unit => unit.audioPorts ?? []), ...raw.audio.units.flatMap(unit => unit.ports ?? [])];
    const from = allPorts.find(port => port.id === link.from);
    const to = allPorts.find(port => port.id === link.to);
    if (from?.direction !== "out" || to?.direction !== "in") return null;
    audioLinkIds.add(link.id);
  }
  return raw;
}

export function readGearInventory(): { inventory: GearInventory; warning?: string; invalidRaw?: string } {
  try {
    const saved = localStorage.getItem(GEAR_KEY);
    if (!saved) return { inventory: emptyGearInventory() };
    const parsed = parseGearInventory(JSON.parse(saved));
    return parsed ? { inventory: parsed } : { inventory: emptyGearInventory(), invalidRaw: saved, warning: "Saved gear inventory is invalid. Its original data is retained until you make a new edit." };
  } catch {
    return { inventory: emptyGearInventory(), warning: "Gear inventory could not be loaded. No saved wiring was changed." };
  }
}

export type EndpointResolution = { port: number | null; issues: string[] };
export function resolveEndpoint(inventory: GearInventory, scene: Scene, endpointId: string): EndpointResolution {
  const endpoint = inventory.units.flatMap(unit => unit.endpoints).find(item => item.id === endpointId);
  if (!endpoint) return { port: null, issues: ["Endpoint is missing."] };
  const wires = inventory.wires.filter(wire => wire.endpointId === endpointId);
  if (!wires.length) return { port: null, issues: ["Physical wire is missing."] };
  if (wires.length > 1) return { port: null, issues: ["Endpoint has ambiguous physical wires."] };
  const port = captureFor(scene).ports.find(item => item.id === wires[0].mioPort);
  if (!port || !/^DIN \d+$/.test(port.hardware) || !(endpoint.direction === "out" ? port.supports_input : port.supports_output))
    return { port: null, issues: ["Selected mioXL DIN side is unavailable for this direction."] };
  const shared = inventory.wires.filter(wire => wire.mioPort === port.id && wire.endpointId !== endpointId &&
    inventory.units.some(unit => unit.endpoints.some(item => item.id === wire.endpointId && item.direction === endpoint.direction)));
  if (shared.length) return { port: null, issues: ["Physical DIN side is assigned to multiple gear endpoints."] };
  return { port: port.id, issues: [] };
}

export function resolveNamedRoute(inventory: GearInventory, scene: Scene, route: NamedRoute) {
  const source = resolveEndpoint(inventory, scene, route.sourceEndpointId);
  const target = resolveEndpoint(inventory, scene, route.targetEndpointId);
  return { source: source.port, target: target.port, issues: [
    ...source.issues.map(issue => `Source: ${issue}`), ...target.issues.map(issue => `Destination: ${issue}`),
  ] };
}
