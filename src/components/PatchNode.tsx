import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
  ArrowRight,
  Cable,
  CircuitBoard,
  Network,
  Radio,
  SlidersHorizontal,
  Usb,
} from "lucide-react";
import {
  protocols,
  type PatchData,
  type PatchNode as PatchNodeType,
} from "../lib/studio";

export function FamilyIcon({
  family,
  size = 18,
}: {
  family: PatchData["family"];
  size?: number;
}) {
  const Icon =
    family === "DIN"
      ? Cable
      : family.startsWith("USB")
        ? Usb
        : family === "RTP"
          ? Network
          : family === "OSC"
            ? Radio
            : family === "PROCESSOR"
              ? SlidersHorizontal
              : CircuitBoard;
  return <Icon size={size} strokeWidth={1.6} />;
}

export const PatchNode = memo(function PatchNode({
  id,
  data,
  selected,
  isConnectable,
}: NodeProps<PatchNodeType>) {
  const io = protocols({ id, data } as PatchNodeType);
  const isPort = data.kind === "port";
  return (
    <article
      className={`patch-node family-${data.family.toLowerCase().replaceAll(" ", "-")} ${selected ? "is-selected" : ""}`}
      data-testid={`node-${id}`}
    >
      <header className="node-eyebrow">
        <span>
          {isPort
            ? data.direction === "input"
              ? "SOURCE"
              : "DESTINATION"
            : "HOST BLOCK"}
        </span>
        <span className="node-protocol">
          {data.family === "PROCESSOR" ? "TRANSFORM" : data.family}
        </span>
      </header>
      <div className="node-main">
        <span className="node-icon">
          <FamilyIcon family={data.family} size={23} />
        </span>
        <div>
          <h2>{data.title}</h2>
          <p>
            {isPort
              ? `${data.subtitle} · mioXL`
              : data.kind === "osc"
                ? `${data.host}:${data.udpPort}`
                : data.kind === "remap"
                  ? `Channel ${data.fromChannel} → ${data.toChannel}`
                  : `CC ${data.cc} → ${data.oscPath}`}
          </p>
        </div>
      </div>
      <div className="node-signal">
        <span>
          {io.input ? (
            <>
              <i className="signal-dot" />
              {io.input} IN
            </>
          ) : (
            <>
              <i className="signal-dot" />
              16 CHANNELS
            </>
          )}
        </span>
        <span>
          {io.output ? (
            <>
              {io.output} OUT <ArrowRight size={11} />
            </>
          ) : io.input === "MIDI" ? (
            "16 CHANNELS"
          ) : (
            "UDP"
          )}
        </span>
      </div>
      <footer className="node-footer">
        <span className={`status-dot ${isPort ? "" : "draft"}`} />
        <span>{isPort ? data.readAt ? "Read from device" : "Captured configuration" : "Draft · not running"}</span>
        <span className="node-count">
          {data.routeCount ?? 0} <span>paths</span>
        </span>
      </footer>
      {io.input ? (
        <Handle
          type="target"
          position={Position.Left}
          id="input"
          isConnectable={isConnectable}
          title={`${data.title} ${io.input} input`}
          data-testid={`handle-in-${id}`}
        />
      ) : null}
      {io.output ? (
        <Handle
          type="source"
          position={Position.Right}
          id="output"
          isConnectable={isConnectable}
          title={`${data.title} ${io.output} output`}
          data-testid={`handle-out-${id}`}
        />
      ) : null}
    </article>
  );
});
