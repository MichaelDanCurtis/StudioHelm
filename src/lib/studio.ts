import type { Connection, Node, XYPosition } from "@xyflow/react";
import inventory from "../data/demo-inventory.json" with { type: "json" };

export const capture = inventory;
export type Port = Pick<(typeof inventory.ports)[number], "id" | "hardware" | "type" | "input_name" | "output_name" | "supports_input" | "supports_output" | "connection_flag" | "connection_meaning" | "preset_destinations" | "global_destinations"> & { active?: boolean; enabled_input?: boolean; enabled_output?: boolean };
export type Capture = {
  captured_at: string;
  revision?: string;
  device: typeof inventory.device;
  network: { hostname: string; address: string };
  preset: { number: number; name: string; scene?: number; unchanged_at_end: boolean };
  ports: Port[];
};
export function captureFor(scene: Scene): Capture { return scene.snapshot ?? inventory; }
export function portsFor(scene: Scene) { return new Map(captureFor(scene).ports.map(port => [port.id, port])); }
export type Family = "DIN" | "USB DAW" | "USB HOST" | "RTP" | "CONTROL";
export type BlockKind = "remap" | "midi-osc" | "osc";
export type NodeKind = "port" | BlockKind;
export type Protocol = "MIDI" | "OSC";
export type PatchData = {
  kind: NodeKind;
  title: string;
  subtitle: string;
  family: Family | "PROCESSOR" | "OSC";
  portId?: number;
  direction?: "input" | "output";
  fromChannel: number;
  toChannel: number;
  cc: number;
  oscPath: string;
  host: string;
  udpPort: number;
  routeCount?: number;
  readAt?: string;
};
export type PatchNode = Node<PatchData, "patch">;
export type Route = { id: string; source: string; target: string };
export type Scene = {
  version: 1;
  name: string;
  serial: string;
  capturedAt: string;
  snapshot?: Capture;
  nodes: PatchNode[];
  additions: Route[];
  removals: string[];
};

export const PORTS = new Map(inventory.ports.map((port) => [port.id, port]));
export const FAMILIES: Family[] = [
  "DIN",
  "USB DAW",
  "USB HOST",
  "RTP",
  "CONTROL",
];
export const STORAGE_KEY = "mioxlplus.studio.v1";
export const defaults = {
  fromChannel: 1,
  toChannel: 1,
  cc: 1,
  oscPath: "/control/value",
  host: "127.0.0.1",
  udpPort: 9000,
};
export const BLOCKS: {
  kind: BlockKind;
  title: string;
  description: string;
  family: PatchData["family"];
}[] = [
  {
    kind: "remap",
    title: "Channel remap",
    description: "Send MIDI to a different channel",
    family: "PROCESSOR",
  },
  {
    kind: "midi-osc",
    title: "MIDI → OSC",
    description: "Turn a controller into an OSC value",
    family: "PROCESSOR",
  },
  {
    kind: "osc",
    title: "OSC destination",
    description: "A destination on your network",
    family: "OSC",
  },
];

export function familyOf(port: Port): Family {
  if (port.hardware.startsWith("DIN")) return "DIN";
  if (port.hardware.startsWith("USB DAW")) return "USB DAW";
  if (port.hardware.startsWith("USB")) return "USB HOST";
  if (port.hardware.startsWith("RTP")) return "RTP";
  return "CONTROL";
}

export function portNode(
  portId: number,
  direction: "input" | "output",
  position: XYPosition,
  snapshot: Capture = inventory,
): PatchNode {
  const port = snapshot.ports.find(port => port.id === portId)!;
  return {
    id: `${direction === "input" ? "in" : "out"}-${portId}`,
    type: "patch",
    position,
    data: {
      ...defaults,
      kind: "port",
      portId,
      direction,
      family: familyOf(port),
      title:
        (direction === "input" ? port.input_name : port.output_name) ||
        port.hardware,
      subtitle: port.hardware,
    },
  };
}

export function blockNode(kind: BlockKind, position: XYPosition): PatchNode {
  const definition = BLOCKS.find((block) => block.kind === kind)!;
  return {
    id: `${kind}-${crypto.randomUUID()}`,
    type: "patch",
    position,
    data: {
      ...defaults,
      kind,
      title: definition.title,
      subtitle: "Host processing",
      family: definition.family,
    },
  };
}

export function routesFrom(snapshot: Capture): Route[] {
  return snapshot.ports.flatMap(port => [...new Set([...port.preset_destinations, ...port.global_destinations])].map(destination => ({
    id: `in-${port.id}__out-${destination}`, source: `in-${port.id}`, target: `out-${destination}`,
  })));
}
export const capturedRoutes = routesFrom(inventory);
export function routesFor(scene: Scene): Route[] { return routesFrom(captureFor(scene)); }

export function initialScene(snapshot: Capture = inventory): Scene {
  return {
    version: 1,
    name: snapshot.preset.name,
    serial: snapshot.device.serial,
    capturedAt: snapshot.captured_at,
    ...(snapshot.revision ? { snapshot } : {}),
    nodes: [
      portNode(1, "input", { x: 0, y: 125 }, snapshot),
      portNode(2, "input", { x: 0, y: 390 }, snapshot),
      portNode(13, "output", { x: 455, y: 0 }, snapshot),
      portNode(39, "output", { x: 455, y: 235 }, snapshot),
      portNode(40, "output", { x: 455, y: 470 }, snapshot),
    ],
    additions: [],
    removals: [],
  };
}

export function activeRoutes(scene: Scene): Route[] {
  const removed = new Set(scene.removals);
  return [
    ...routesFor(scene).filter((route) => !removed.has(route.id)),
    ...scene.additions,
  ];
}

export function protocols(node: PatchNode): {
  input?: Protocol;
  output?: Protocol;
} {
  if (node.data.kind === "port")
    return node.data.direction === "input"
      ? { output: "MIDI" }
      : { input: "MIDI" };
  if (node.data.kind === "osc") return { input: "OSC" };
  return {
    input: "MIDI",
    output: node.data.kind === "midi-osc" ? "OSC" : "MIDI",
  };
}

export function connectionError(
  scene: Scene,
  connection: Pick<Connection, "source" | "target">,
): string | null {
  const source = scene.nodes.find((node) => node.id === connection.source);
  const target = scene.nodes.find((node) => node.id === connection.target);
  if (!source || !target) return "Choose a source and a destination.";
  if (source.id === target.id) return "Choose a different destination.";
  const from = protocols(source).output;
  const to = protocols(target).input;
  if (!from || !to) return "Connect a right-hand output to a left-hand input.";
  if (from !== to)
    return `This output carries ${from}. Choose a ${from} input or add a converter.`;
  const routes = activeRoutes(scene);
  if (
    routes.some(
      (route) => route.source === source.id && route.target === target.id,
    )
  )
    return "These ports are already connected.";
  const frontier = [target.id];
  const visited = new Set<string>();
  while (frontier.length) {
    const next = frontier.pop()!;
    if (next === source.id)
      return "This connection would create a cycle in this patch.";
    if (!visited.has(next)) {
      visited.add(next);
      frontier.push(
        ...routes
          .filter((route) => route.source === next)
          .map((route) => route.target),
      );
    }
  }
  return null;
}

export function connectRoute(
  scene: Scene,
  source: string,
  target: string,
): Scene {
  if (connectionError(scene, { source, target })) return scene;
  const id = `${source}__${target}`;
  return routesFor(scene).some(route => route.id === id)
    ? { ...scene, removals: scene.removals.filter((removed) => removed !== id) }
    : { ...scene, additions: [...scene.additions, { id, source, target }] };
}

export function removeRoute(scene: Scene, id: string): Scene {
  return routesFor(scene).some(route => route.id === id)
    ? { ...scene, removals: [...new Set([...scene.removals, id])] }
    : {
        ...scene,
        additions: scene.additions.filter((route) => route.id !== id),
      };
}

export function endpointName(id: string, nodes: PatchNode[], snapshot: Capture = inventory): string {
  const node = nodes.find((item) => item.id === id);
  if (node)
    return node.data.kind === "port"
      ? `${node.data.title} · ${node.data.subtitle}`
      : node.data.title;
  const [direction, rawId] = id.split("-");
  const port = snapshot.ports.find(port => port.id === Number(rawId));
  return port
    ? `${direction === "in" ? port.input_name : port.output_name} · ${port.hardware}`
    : id;
}

export function parseScene(value: unknown): Scene | null {
  if (!value || typeof value !== "object") return null;
  const raw = structuredClone(value) as Scene;
  if (raw.snapshot && !validCapture(raw.snapshot)) return null;
  const snapshot = captureFor(raw);
  const portMap = portsFor(raw);
  if (
    raw.version !== 1 ||
    raw.serial !== snapshot.device.serial ||
    raw.capturedAt !== snapshot.captured_at ||
    typeof raw.name !== "string" ||
    !raw.name.trim() ||
    raw.name.length > 80 ||
    !Array.isArray(raw.nodes) ||
    raw.nodes.length > 200 ||
    !Array.isArray(raw.additions) ||
    raw.additions.length > 2000 ||
    !Array.isArray(raw.removals)
  )
    return null;
  const ids = new Set<string>();
  for (const node of raw.nodes) {
    if (
      !node ||
      typeof node.id !== "string" ||
      ids.has(node.id) ||
      node.type !== "patch" ||
      !Number.isFinite(node.position?.x) ||
      !Number.isFinite(node.position?.y) ||
      !node.data
    )
      return null;
    ids.add(node.id);
    const data = node.data;
    if (
      !["port", "remap", "midi-osc", "osc"].includes(data.kind) ||
      typeof data.title !== "string" ||
      data.title.length > 80
    )
      return null;
    if (data.kind === "port") {
      const port = portMap.get(data.portId ?? -1);
      if (
        !port ||
        !["input", "output"].includes(data.direction ?? "") ||
        node.id !== `${data.direction === "input" ? "in" : "out"}-${port.id}` ||
        !(data.direction === "input"
          ? port.supports_input
          : port.supports_output)
      )
        return null;
      node.data = portNode(port.id, data.direction!, node.position, snapshot).data;
    } else {
      if (!node.id.startsWith(`${data.kind}-`)) return null;
      if (
        ![data.fromChannel, data.toChannel].every(
          (n) => Number.isInteger(n) && n >= 1 && n <= 16,
        ) ||
        !Number.isInteger(data.cc) ||
        data.cc < 0 ||
        data.cc > 127 ||
        typeof data.oscPath !== "string" ||
        !/^\/[a-zA-Z0-9_\-/.]{0,127}$/.test(data.oscPath) ||
        typeof data.host !== "string" ||
        !/^[a-zA-Z0-9.:-]{1,253}$/.test(data.host) ||
        !Number.isInteger(data.udpPort) ||
        data.udpPort < 1 ||
        data.udpPort > 65535
      )
        return null;
      node.data = {
        ...data,
        family: BLOCKS.find((block) => block.kind === data.kind)!.family,
        subtitle: "Host processing",
      };
    }
  }
  if (raw.removals.some((id) => !routesFor(raw).some(route => route.id === id))) return null;
  let candidate: Scene = {
    ...raw,
    additions: [],
    removals: [...new Set(raw.removals)],
  };
  for (const route of raw.additions) {
    if (
      !route ||
      route.id !== `${route.source}__${route.target}` ||
      connectionError(candidate, route)
    )
      return null;
    candidate = connectRoute(candidate, route.source, route.target);
  }
  return candidate;
}

export function readScene(): { scene: Scene; warning?: string } {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return { scene: initialScene() };
    const scene = parseScene(JSON.parse(saved));
    if (scene) return { scene };
    // Preserve an older device-bound draft before the synthetic fallback replaces it.
    const backupKey = `${STORAGE_KEY}.invalid-backup`;
    if (!localStorage.getItem(backupKey)) localStorage.setItem(backupKey, saved);
    return { scene: initialScene(), warning: "The saved draft did not match this inventory. Its original JSON was preserved in local storage before opening the demo." };
  } catch {
    return {
      scene: initialScene(),
      warning:
        "Local storage is unavailable. Export your scene to keep a copy.",
    };
  }
}

export function validCapture(value: unknown): value is Capture {
  if (!value || typeof value !== "object") return false;
  const raw = value as Capture;
  if (typeof raw.device?.serial !== "string" || !raw.device.serial.trim() || raw.device.serial.length > 80 ||
      raw.device?.model !== inventory.device.model ||
      typeof raw.device.device_name !== "string" || typeof raw.device.firmware !== "string" ||
      typeof raw.captured_at !== "string" || !Number.isFinite(Date.parse(raw.captured_at)) ||
      typeof raw.network?.address !== "string" || !Number.isInteger(raw.preset?.number) ||
      typeof raw.preset.name !== "string" || !Array.isArray(raw.ports) || raw.ports.length !== inventory.ports.length ||
      (raw.revision !== undefined && !/^[a-f0-9]{64}$/.test(raw.revision))) return false;
  const ids = new Set<number>();
  return raw.ports.every(port => {
    if (!port || !Number.isInteger(port.id) || port.id < 1 || port.id > raw.ports.length || ids.has(port.id)) return false;
    ids.add(port.id);
    return typeof port.hardware === "string" && typeof port.input_name === "string" && typeof port.output_name === "string" &&
      typeof port.supports_input === "boolean" && typeof port.supports_output === "boolean" &&
      [port.preset_destinations, port.global_destinations].every(list => Array.isArray(list) && list.every(id => Number.isInteger(id) && id > 0 && id <= raw.ports.length));
  });
}

export function refreshScene(scene: Scene, snapshot: Capture): Scene {
  if (!validCapture(snapshot)) throw new Error("The device returned an invalid inventory.");
  const old = captureFor(scene);
  const before = routesFor(scene).map(route => route.id).sort().join(",");
  const after = routesFrom(snapshot).map(route => route.id).sort().join(",");
  if ((scene.additions.length || scene.removals.length) &&
      (scene.serial !== snapshot.device.serial || old.preset.number !== snapshot.preset.number || (old.preset.scene ?? 1) !== snapshot.preset.scene || before !== after))
    throw new Error("Device routing changed while you have a draft. Export or clear the draft, then refresh.");
  return { ...scene, serial: snapshot.device.serial, snapshot, capturedAt: snapshot.captured_at,
    nodes: scene.nodes.map(node => node.data.kind === "port"
      ? { ...node, data: portNode(node.data.portId!, node.data.direction!, node.position, snapshot).data }
      : node) };
}

export function hardwareDraft(scene: Scene) {
  return { additions: scene.additions.filter(route => /^in-\d+__out-\d+$/.test(route.id)).map(route => route.id), removals: scene.removals };
}
