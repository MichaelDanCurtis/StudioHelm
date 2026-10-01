import {
  activeRoutes, captureFor, connectRoute, endpointName, portNode,
  portsFor, removeRoute, type Route, type Scene,
} from "./studio";

export type ReplacementPolicy = "destination" | "both";
export type RouteAction = {
  id: string;
  name: string;
  source: number;
  target: number;
  policy: ReplacementPolicy;
  oscPath: string;
  color: "amber" | "sage" | "blue" | "rose";
  profileId?: string;
};
export type ControlPanel = { id: string; name: string; description: string; actionIds: string[] };
export type Parameter = { id: string; name: string; cc: number; channel: number; value: number | null; nrpn?: [number, number] };
export type InstrumentProfile = { id: string; name: string; destination: number; parameters: Parameter[] };
export type MidiBinding = { id: string; actionId: string; channel: number; cc: number; mode?: "rising" | "toggle" };
export type Controls = { version: 1; panels: ControlPanel[]; actions: RouteAction[]; profiles: InstrumentProfile[]; midiBindings: MidiBinding[] };
export const CONTROLS_KEY = "mioxlplus.controls.v1";
export const emptyControls = (): Controls => ({
  version: 1,
  panels: [{ id: crypto.randomUUID(), name: "Quick routes", description: "Pick an instrument to preview a replacement route", actionIds: [] }],
  actions: [],
  profiles: [{ id: "novation-peak", name: "Novation Peak", destination: 0, parameters: [
    { id: "resonance", name: "Filter resonance", cc: 79, channel: 1, value: null },
    { id: "overdrive", name: "Filter overdrive", cc: 80, channel: 1, value: null },
    { id: "amp-attack", name: "Amp attack", cc: 86, channel: 1, value: null },
    { id: "amp-decay", name: "Amp decay", cc: 87, channel: 1, value: null },
    { id: "amp-sustain", name: "Amp sustain", cc: 88, channel: 1, value: null },
    { id: "amp-release", name: "Amp release", cc: 89, channel: 1, value: null },
    { id: "mod1-attack", name: "Mod 1 attack", cc: 90, channel: 1, value: null },
    { id: "saw-density", name: "Osc 1 saw density", cc: 0, nrpn: [0, 17], channel: 1, value: null },
  ] }],
  midiBindings: [],
});
export const validOscPath = (value: string) => /^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(value) && value.length <= 96;

export function parseControls(value: unknown): Controls | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Controls;
  if (raw.version !== 1 || !Array.isArray(raw.panels) || raw.panels.length > 8 || !Array.isArray(raw.actions) || raw.actions.length > 48 ||
      !Array.isArray(raw.profiles) || raw.profiles.length > 32 || !Array.isArray(raw.midiBindings) || raw.midiBindings.length > 32) return null;
  const panelIds = new Set<string>();
  const actionIds = new Set<string>();
  const paths = new Set<string>();
  const profileIds = new Set<string>();
  for (const profile of raw.profiles) {
    if (!profile || typeof profile.id !== "string" || !/^[\w-]{1,80}$/.test(profile.id) || profileIds.has(profile.id) ||
        typeof profile.name !== "string" || !profile.name.trim() || profile.name.length > 60 ||
        !Number.isInteger(profile.destination) || profile.destination < 0 || profile.destination > 61 ||
        !Array.isArray(profile.parameters) || profile.parameters.length > 16 ||
        profile.parameters.some(parameter => !parameter || typeof parameter.id !== "string" ||
          !/^[\w-]{1,80}$/.test(parameter.id) || typeof parameter.name !== "string" || !parameter.name.trim() || parameter.name.length > 48 ||
          !Number.isInteger(parameter.cc) || parameter.cc < 0 || parameter.cc > 127 ||
          !Number.isInteger(parameter.channel) || parameter.channel < 1 || parameter.channel > 16 ||
          (parameter.value !== null && (!Number.isInteger(parameter.value) || parameter.value < 0 || parameter.value > 127)) ||
          (parameter.nrpn !== undefined && (!Array.isArray(parameter.nrpn) || parameter.nrpn.length !== 2 || parameter.nrpn.some(n => !Number.isInteger(n) || n < 0 || n > 127))) ) ||
        new Set(profile.parameters.map(parameter => parameter.id)).size !== profile.parameters.length) return null;
    profileIds.add(profile.id);
  }
  for (const action of raw.actions) {
    if (!action || typeof action.id !== "string" || !/^[\w-]{1,80}$/.test(action.id) || actionIds.has(action.id) ||
        typeof action.name !== "string" || !action.name.trim() || action.name.length > 60 ||
        !Number.isInteger(action.source) || action.source < 1 || action.source > 61 ||
        !Number.isInteger(action.target) || action.target < 1 || action.target > 61 ||
        !["destination", "both"].includes(action.policy) || !validOscPath(action.oscPath) || paths.has(action.oscPath) ||
        !["amber", "sage", "blue", "rose"].includes(action.color) ||
        (action.profileId !== undefined && (!profileIds.has(action.profileId) || raw.profiles.find(profile => profile.id === action.profileId)?.destination !== action.target))) return null;
    actionIds.add(action.id); paths.add(action.oscPath);
  }
  for (const panel of raw.panels) {
    if (!panel || typeof panel.id !== "string" || !/^[\w-]{1,80}$/.test(panel.id) || panelIds.has(panel.id) ||
        typeof panel.name !== "string" || !panel.name.trim() || panel.name.length > 60 ||
        typeof panel.description !== "string" || panel.description.length > 120 ||
        !Array.isArray(panel.actionIds) || panel.actionIds.length > 24 ||
        new Set(panel.actionIds).size !== panel.actionIds.length || panel.actionIds.some(id => !actionIds.has(id))) return null;
    panelIds.add(panel.id);
  }
  for (const binding of raw.midiBindings) {
    if (!binding || typeof binding.id !== "string" || !/^[\w-]{1,80}$/.test(binding.id) || !actionIds.has(binding.actionId) ||
        !Number.isInteger(binding.channel) || binding.channel < 1 || binding.channel > 16 ||
        !Number.isInteger(binding.cc) || binding.cc < 0 || binding.cc > 127 ||
        (binding.mode !== undefined && binding.mode !== "rising" && binding.mode !== "toggle")) return null;
  }
  if (new Set(raw.midiBindings.map(binding => `${binding.channel}:${binding.cc}`)).size !== raw.midiBindings.length) return null;
  if (new Set(raw.midiBindings.map(binding => binding.id)).size !== raw.midiBindings.length) return null;
  return raw;
}

export function readControls(): { controls: Controls; warning?: string } {
  try {
    const saved = localStorage.getItem(CONTROLS_KEY);
    if (!saved) return { controls: emptyControls() };
    const controls = parseControls(JSON.parse(saved));
    return controls ? { controls } : { controls: emptyControls(), warning: "Invalid saved control panels were ignored." };
  } catch {
    return { controls: emptyControls(), warning: "Control panels could not be loaded from this browser." };
  }
}

export type QuickRoutePlan = {
  action: RouteAction;
  removals: Route[];
  addition: Route | null;
  alreadyActive: boolean;
  next: Scene;
  fingerprint: string;
};

export function planQuickRoute(scene: Scene, action: RouteAction): QuickRoutePlan {
  const ports = portsFor(scene);
  const source = ports.get(action.source), target = ports.get(action.target);
  if (!source?.supports_input || !target?.supports_output) throw new Error("Choose a valid mioXL source and destination.");
  if (!["destination", "both"].includes(action.policy)) throw new Error("Unknown replacement rule.");
  const sourceId = `in-${action.source}`, targetId = `out-${action.target}`;
  const wantedId = `${sourceId}__${targetId}`;
  const current = activeRoutes(scene);
  const removals = current.filter(route => route.id !== wantedId &&
    (route.target === targetId || (action.policy === "both" && route.source === sourceId)));
  if (removals.length > 16) throw new Error("This action affects more than 16 routes. Edit the routing draft directly.");
  const snapshot = captureFor(scene);
  const global = removals.find(route => {
    const port = snapshot.ports.find(item => route.source === `in-${item.id}`);
    return (port?.global_destinations as number[] | undefined)?.includes(Number(route.target.slice(4)));
  });
  if (global) throw new Error(`Cannot replace the global route ${endpointName(global.source, scene.nodes, snapshot)} → ${endpointName(global.target, scene.nodes, snapshot)}. Global routes are read-only.`);
  let next: Scene = { ...scene, nodes: [...scene.nodes] };
  if (!next.nodes.some(node => node.id === sourceId)) next.nodes.push(portNode(action.source, "input", { x: 0, y: next.nodes.length * 75 }, snapshot));
  if (!next.nodes.some(node => node.id === targetId)) next.nodes.push(portNode(action.target, "output", { x: 455, y: next.nodes.length * 75 }, snapshot));
  for (const route of removals) next = removeRoute(next, route.id);
  const alreadyActive = current.some(route => route.id === wantedId);
  if (!alreadyActive) next = connectRoute(next, sourceId, targetId);
  const addition = !alreadyActive ? { id: wantedId, source: sourceId, target: targetId } : null;
  if (addition && !activeRoutes(next).some(route => route.id === wantedId)) throw new Error("This route conflicts with the current draft.");
  return { action, removals, addition, alreadyActive, next,
    fingerprint: `${snapshot.revision ?? snapshot.captured_at}:${current.map(route => route.id).sort().join(",")}` };
}
