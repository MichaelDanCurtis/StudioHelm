import type { FormEvent } from "react";
import {
  ArrowDown,
  ArrowRight,
  Cable,
  CircleHelp,
  GitBranch,
  Link2,
  Plus,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import {
  activeRoutes,
  captureFor,
  connectionError,
  endpointName,
  portsFor,
  protocols,
  type PatchData,
  type PatchNode,
  type Route,
  type Scene,
} from "../lib/studio";
import { FamilyIcon } from "./PatchNode";

type Props = {
  scene: Scene;
  node?: PatchNode;
  route?: Route;
  onClose: () => void;
  onConnect: (source: string, target: string) => void;
  onUpdate: (id: string, data: Partial<PatchData>) => void;
  onRemoveNode: (id: string) => void;
  onRemoveRoute: (id: string) => void;
  onSelectRoute: (id: string) => void;
  onRevealRoute: (route: Route) => void;
};

function BlockSettings({
  node,
  onUpdate,
}: Pick<Props, "onUpdate"> & { node: PatchNode }) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const updates: Partial<PatchData> = {
      title: String(fields.get("title")).trim(),
    };
    if (node.data.kind === "remap") {
      updates.fromChannel = Number(fields.get("fromChannel"));
      updates.toChannel = Number(fields.get("toChannel"));
    } else if (node.data.kind === "midi-osc") {
      updates.cc = Number(fields.get("cc"));
      updates.oscPath = String(fields.get("oscPath"));
    } else {
      updates.host = String(fields.get("host"));
      updates.udpPort = Number(fields.get("udpPort"));
    }
    onUpdate(node.id, updates);
  }
  return (
    <form className="block-settings" onSubmit={submit}>
      <label>
        Block name
        <input
          name="title"
          defaultValue={node.data.title}
          required
          maxLength={80}
        />
      </label>
      {node.data.kind === "remap" ? (
        <div className="field-pair">
          <label>
            From channel
            <select name="fromChannel" defaultValue={node.data.fromChannel}>
              {Array.from({ length: 16 }, (_, i) => (
                <option key={i} value={i + 1}>
                  {i + 1}
                </option>
              ))}
            </select>
          </label>
          <ArrowRight size={15} />
          <label>
            To channel
            <select name="toChannel" defaultValue={node.data.toChannel}>
              {Array.from({ length: 16 }, (_, i) => (
                <option key={i} value={i + 1}>
                  {i + 1}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : node.data.kind === "midi-osc" ? (
        <>
          <label>
            MIDI controller
            <input
              name="cc"
              aria-label="MIDI controller number"
              type="number"
              min={0}
              max={127}
              defaultValue={node.data.cc}
              required
            />
          </label>
          <label>
            OSC address
            <input
              name="oscPath"
              defaultValue={node.data.oscPath}
              required
              pattern="/[a-zA-Z0-9_\-/.]*"
              maxLength={128}
            />
          </label>
          <div className="range-preview">
            <span>
              MIDI <b>0 — 127</b>
            </span>
            <ArrowRight size={14} />
            <span>
              OSC <b>0.0 — 1.0</b>
            </span>
          </div>
        </>
      ) : (
        <>
          <label>
            Host
            <input
              name="host"
              defaultValue={node.data.host}
              required
              pattern="[a-zA-Z0-9.:\-]+"
              maxLength={253}
            />
          </label>
          <label>
            UDP port
            <input
              name="udpPort"
              type="number"
              min={1}
              max={65535}
              defaultValue={node.data.udpPort}
              required
            />
          </label>
        </>
      )}
      <button className="button secondary" type="submit">
        <CheckIcon />
        Update block
      </button>
    </form>
  );
}

function CheckIcon() {
  return <SlidersHorizontal size={14} />;
}

export function Inspector({
  scene,
  node,
  route,
  onClose,
  onConnect,
  onUpdate,
  onRemoveNode,
  onRemoveRoute,
  onSelectRoute,
  onRevealRoute,
}: Props) {
  const allRoutes = activeRoutes(scene);
  const paths = node
    ? allRoutes.filter(
        (item) => item.source === node.id || item.target === node.id,
      )
    : [];
  const capture = captureFor(scene);
  const port = node?.data.portId ? portsFor(scene).get(node.data.portId) : null;
  const targets = node
    ? scene.nodes.filter(
        (target) =>
          !connectionError(scene, { source: node.id, target: target.id }),
      )
    : [];
  return (
    <aside className="inspector" aria-label="Selection inspector">
      <header className="inspector-heading">
        <span>
          <SlidersHorizontal size={15} />
          INSPECTOR
        </span>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="Clear selection"
        >
          <X size={15} />
        </button>
      </header>
      <div className="inspector-content">
        {route ? (
          <>
            <div className="inspector-hero">
              <span className="inspector-symbol">
                <Link2 size={28} />
              </span>
              <span className="eyebrow">SIGNAL PATH</span>
              <h2>
                One connection.
                <br />
                Endless possibilities.
              </h2>
            </div>
            <div className="path-detail">
              <div>
                <span>SOURCE</span>
                <strong>{endpointName(route.source, scene.nodes, capture)}</strong>
              </div>
              <ArrowDown size={16} />
              <div>
                <span>DESTINATION</span>
                <strong>{endpointName(route.target, scene.nodes, capture)}</strong>
              </div>
            </div>
            <button
              className="button secondary full-width reveal-route"
              onClick={() => onRevealRoute(route)}
            >
              <GitBranch size={14} />
              Show on canvas
            </button>
            <div className="inspector-section">
              <h3>Connection details</h3>
              <dl>
                <div>
                  <dt>Status</dt>
                  <dd>
                    {scene.additions.some((item) => item.id === route.id)
                      ? "Local draft"
                      : "Captured route"}
                  </dd>
                </div>
                <div>
                  <dt>Execution</dt>
                  <dd>
                    {route.source.startsWith("in-") &&
                    route.target.startsWith("out-")
                      ? "mioXL hardware"
                      : "Host · planned"}
                  </dd>
                </div>
              </dl>
            </div>
            <button
              className="button danger subtle"
              onClick={() => onRemoveRoute(route.id)}
            >
              <Trash2 size={14} />
              Remove connection
            </button>
          </>
        ) : node ? (
          <>
            <div
              className={`inspector-hero family-${node.data.family.toLowerCase().replaceAll(" ", "-")}`}
            >
              <div className="inspector-symbol">
                <FamilyIcon family={node.data.family} size={29} />
              </div>
              <span className="eyebrow">
                {node.data.kind === "port"
                  ? `${node.data.family} ${node.data.direction === "input" ? "SOURCE" : "DESTINATION"}`
                  : "PROCESSING BLOCK"}
              </span>
              <h2>{node.data.title}</h2>
              <p>
                {node.data.kind === "port"
                  ? `${node.data.subtitle} on mioXL`
                  : "A little more possibility in your signal."}
              </p>
            </div>
            {node.data.kind === "port" ? (
              <>
                <div className="inspector-section">
                  <h3>
                    Port details<span className="small-chip">{capture.revision ? "DEVICE READ" : "CAPTURED"}</span>
                  </h3>
                  <dl>
                    <div>
                      <dt>Device</dt>
                      <dd>
                        mioXL <span className="muted">/ {capture.revision ? "DEVICE" : "DEMO"}</span>
                      </dd>
                    </div>
                    <div>
                      <dt>MIDI channels</dt>
                      <dd>1 – 16</dd>
                    </div>
                    <div>
                      <dt>Protocol</dt>
                      <dd>MIDI 1.0</dd>
                    </div>
                    <div>
                      <dt>Preset</dt>
                      <dd>
                        {capture.preset.name}{" "}
                        <span className="muted">/ {capture.preset.number.toString().padStart(2, "0")}</span>
                      </dd>
                    </div>
                  </dl>
                </div>
                <div className="inspector-section">
                  <h3>Channel range</h3>
                  <div
                    className="channel-grid"
                    role="group"
                    aria-label="All 16 MIDI channels available"
                  >
                    {Array.from({ length: 16 }, (_, i) => (
                      <span key={i}>{i + 1}</span>
                    ))}
                  </div>
                  <p className="field-hint">
                    Port routing carries all channels. Add a processing block to
                    shape the signal.
                  </p>
                </div>
                {port?.hardware.startsWith("DIN") ? (
                  <div className="quiet-notice">
                    <CircleHelp size={14} />
                    <span>
                      DIN ports do not report whether an instrument is plugged
                      in.
                    </span>
                  </div>
                ) : null}
              </>
            ) : (
              <div className="inspector-section">
                <h3>
                  Block settings<span className="small-chip amber">DRAFT</span>
                </h3>
                <BlockSettings
                  key={`${node.id}-${JSON.stringify(node.data)}`}
                  node={node}
                  onUpdate={onUpdate}
                />
              </div>
            )}
            {protocols(node).output ? (
              <div className="inspector-section">
                <h3>Create a connection</h3>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    const target = String(
                      new FormData(event.currentTarget).get("target"),
                    );
                    if (target) {
                      onConnect(node.id, target);
                      event.currentTarget.reset();
                    }
                  }}
                >
                  <select
                    name="target"
                    aria-label="Connect to destination"
                    defaultValue=""
                    required
                    disabled={!targets.length}
                  >
                    <option value="" disabled>
                      {targets.length
                        ? "Choose a node on canvas"
                        : "All compatible nodes connected"}
                    </option>
                    {targets.map((target) => (
                      <option key={target.id} value={target.id}>
                        {target.data.title} · {target.data.subtitle}
                      </option>
                    ))}
                  </select>
                  {targets.length ? (
                    <button
                      className="button secondary full-width"
                      type="submit"
                    >
                      <Plus size={14} />
                      Connect
                    </button>
                  ) : (
                    <p className="field-hint connection-hint">
                      Add a destination or a processing block to make another
                      connection.
                    </p>
                  )}
                </form>
              </div>
            ) : null}
            <div className="inspector-section">
              <h3>
                Connections<span className="count-badge">{paths.length}</span>
              </h3>
              <div className="inspector-paths">
                {paths.length ? (
                  paths.map((path) => (
                    <button
                      key={path.id}
                      onClick={() => onSelectRoute(path.id)}
                    >
                      <span className="path-line">
                        <i />
                        <i />
                      </span>
                      <span>
                        {endpointName(
                          path.source === node.id ? path.target : path.source,
                          scene.nodes,
                        )}
                      </span>
                      <ArrowRight size={13} />
                    </button>
                  ))
                ) : (
                  <p className="field-hint">
                    Drag between the circular handles to make your first
                    connection.
                  </p>
                )}
              </div>
            </div>
            <button
              className="button subtle"
              onClick={() => onRemoveNode(node.id)}
            >
              <X size={14} />
              Remove from canvas
            </button>
          </>
        ) : (
          <div className="inspector-empty">
            <div className="inspector-symbol">
              <Cable size={30} />
            </div>
            <span className="eyebrow">FOLLOW YOUR SIGNAL</span>
            <h2>
              The details
              <br />
              make the difference.
            </h2>
            <p>
              Select a port, a processing block, or a connection to take a
              closer look.
            </p>
            <div className="inspector-tip">
              <span>01</span>
              <p>Add ports from the library.</p>
              <span>02</span>
              <p>Drag from an output to an input.</p>
              <span>03</span>
              <p>Save your patch as a local scene.</p>
            </div>
          </div>
        )}
      </div>
      <footer className="inspector-footer">
        <span className="status-dot" />
        Inventory view<span>LOCAL</span>
      </footer>
    </aside>
  );
}
