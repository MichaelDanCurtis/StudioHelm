import { useCallback, useMemo } from "react";
import { ReactFlow, Background, BackgroundVariant, Handle, Position, type Connection, type Edge, type Node, type NodeProps } from "@xyflow/react";
import { captureFor, type Scene } from "../lib/studio";
import type { GearInventory } from "../lib/gear-inventory";

type Port = { id: string; label: string; direction: "in" | "out"; side: "gear" | "hub" | "audio" };
type CardNode = Node<{ title: string; subtitle: string; ports: Port[]; signal: "midi" | "audio" }, "card">;

function DeviceCard({ data }: NodeProps<CardNode>) {
  return <div className={`wiring-card ${data.signal}`}>
    <strong>{data.title}</strong><small>{data.subtitle}</small>
    {data.ports.length ? data.ports.map(port => <div className="wiring-port" key={port.id}>
      <Handle id={`${port.side}:${port.id}`} type={port.direction === "out" ? "source" : "target"}
        position={port.side === "hub" ? Position.Left : Position.Right} className={`wiring-handle ${data.signal}`} />
      <span>{port.label}</span><em>{port.direction.toUpperCase()}</em>
    </div>) : <p className="wiring-port-empty">Ports unknown · add confirmed ports below</p>}
  </div>;
}
const nodeTypes = { card: DeviceCard };

type Props = { inventory: GearInventory; scene: Scene; onChange: (next: GearInventory) => void; onNotice: (message: string) => void };
export function GearWiringCanvas({ inventory, scene, onChange, onNotice }: Props) {
  const { nodes, edges } = useMemo(() => {
    const capture = captureFor(scene);
    const din = capture.ports.filter(port => /^DIN \d+$/.test(port.hardware));
    const inputs = din.filter(port => port.supports_input);
    const outputs = din.filter(port => port.supports_output);
    const nodes: CardNode[] = inventory.units.map((unit, index) => ({
      id: unit.id, type: "card", position: { x: 30, y: 28 + index * 172 },
      data: { title: unit.name, subtitle: `MIDI · ${unit.modelId ?? "custom unit"}`, signal: "midi", ports: unit.endpoints.map(port => ({ id: port.id, label: port.name, direction: port.direction, side: "gear" })) },
    }));
    nodes.push({ id: "mioxl-inputs", type: "card", position: { x: 470, y: 28 }, data: {
      title: "mioXL · DIN inputs", subtitle: "Captured port inventory · MIDI", signal: "midi",
      ports: inputs.map(port => ({ id: String(port.id), label: port.hardware, direction: "in", side: "hub" })),
    } });
    nodes.push({ id: "mioxl-outputs", type: "card", position: { x: 470, y: 375 }, data: {
      title: "mioXL · DIN outputs", subtitle: "Captured port inventory · MIDI", signal: "midi",
      ports: outputs.map(port => ({ id: String(port.id), label: port.hardware, direction: "out", side: "hub" })),
    } });
    const audioTop = Math.max(780, 80 + inventory.units.length * 172);
    inventory.audio.units.forEach((unit, index) => nodes.push({
      id: unit.id, type: "card", position: { x: index % 2 ? 470 : 30, y: audioTop + Math.floor(index / 2) * 180 },
      data: { title: unit.name, subtitle: `AUDIO · ${unit.model ?? "custom unit"}`, signal: "audio", ports: (unit.ports ?? []).map(port => ({ id: port.id, label: port.name, direction: port.direction, side: "audio" })) },
    }));
    const endpointUnit = new Map(inventory.units.flatMap(unit => unit.endpoints.map(port => [port.id, unit.id] as const)));
    const endpointDirection = new Map(inventory.units.flatMap(unit => unit.endpoints.map(port => [port.id, port.direction] as const)));
    const audioUnit = new Map(inventory.audio.units.flatMap(unit => (unit.ports ?? []).map(port => [port.id, unit.id] as const)));
    const edges: Edge[] = inventory.wires.flatMap(wire => {
      const unit = endpointUnit.get(wire.endpointId), direction = endpointDirection.get(wire.endpointId);
      if (!unit || !direction) return [];
      return [{ id: wire.id, source: direction === "out" ? unit : "mioxl-outputs", sourceHandle: direction === "out" ? `gear:${wire.endpointId}` : `hub:${wire.mioPort}`,
        target: direction === "out" ? "mioxl-inputs" : unit, targetHandle: direction === "out" ? `hub:${wire.mioPort}` : `gear:${wire.endpointId}`,
        type: "smoothstep", animated: false, style: { stroke: "#dfa95c", strokeWidth: 2.5 }, label: "MIDI DIN", labelStyle: { fill: "#e8bb79", fontSize: 10 } }];
    });
    inventory.audio.links.forEach(link => {
      const source = audioUnit.get(link.from), target = audioUnit.get(link.to);
      if (source && target) edges.push({ id: link.id, source, sourceHandle: `audio:${link.from}`, target, targetHandle: `audio:${link.to}`,
        type: "smoothstep", style: { stroke: "#77b9cf", strokeWidth: 2.5 }, label: "AUDIO", labelStyle: { fill: "#9bd0df", fontSize: 10 } });
    });
    return { nodes, edges };
  }, [inventory, scene]);

  const connect = useCallback((connection: Connection) => {
    const from = connection.sourceHandle?.split(":") ?? [], to = connection.targetHandle?.split(":") ?? [];
    let endpointId = "", mioPort = 0;
    if (from[0] === "gear" && to[0] === "hub") { endpointId = from[1]; mioPort = Number(to[1]); }
    else if (from[0] === "hub" && to[0] === "gear") { endpointId = to[1]; mioPort = Number(from[1]); }
    if (endpointId) {
      const endpoint = inventory.units.flatMap(unit => unit.endpoints).find(item => item.id === endpointId);
      const port = captureFor(scene).ports.find(item => item.id === mioPort);
      if (!endpoint || !port || !/^DIN \d+$/.test(port.hardware) || !(endpoint.direction === "out" ? port.supports_input : port.supports_output))
        return onNotice("Connect instrument OUT to mioXL DIN IN, or mioXL DIN OUT to instrument IN.");
      if (inventory.wires.some(wire => wire.endpointId === endpointId || wire.mioPort === mioPort && inventory.units.some(unit => unit.endpoints.some(item => item.id === wire.endpointId && item.direction === endpoint.direction))))
        return onNotice("That endpoint or DIN side is already wired in this direction. Remove its cable first.");
      onChange({ ...inventory, wires: [...inventory.wires, { id: crypto.randomUUID(), endpointId, mioPort }] });
      return onNotice("MIDI DIN cable recorded in this browser. Confirm it matches the physical cable.");
    }
    if (from[0] === "audio" && to[0] === "audio") {
      const ports = inventory.audio.units.flatMap(unit => unit.ports ?? []);
      if (ports.find(port => port.id === from[1])?.direction !== "out" || ports.find(port => port.id === to[1])?.direction !== "in")
        return onNotice("Connect an audio OUT port to an audio IN port.");
      onChange({ ...inventory, audio: { ...inventory.audio, links: [...inventory.audio.links, { id: crypto.randomUUID(), from: from[1], to: to[1] }] } });
      return onNotice("Audio cable recorded locally. No MOTU routing command was sent.");
    }
    onNotice("MIDI and audio cables must connect matching port types.");
  }, [inventory, onChange, onNotice, scene]);
  return <div className="wiring-visual" aria-label="Physical wiring canvas">
    <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onConnect={connect}
      onEdgeClick={(_, edge) => { if (inventory.wires.some(wire => wire.id === edge.id)) onChange({ ...inventory, wires: inventory.wires.filter(wire => wire.id !== edge.id) });
        else onChange({ ...inventory, audio: { ...inventory.audio, links: inventory.audio.links.filter(link => link.id !== edge.id) } }); onNotice("Cable removed from the local map."); }}
      fitView fitViewOptions={{ padding: .12, maxZoom: 1 }} minZoom={.25} maxZoom={1.4} nodesDraggable nodesConnectable elementsSelectable>
      <Background variant={BackgroundVariant.Dots} color="#425147" gap={22}/>
    </ReactFlow>
    <span className="wiring-visual-hint">Drag from OUT to IN to record a cable · click a cable to remove it · pan or zoom to explore</span>
  </div>;
}
