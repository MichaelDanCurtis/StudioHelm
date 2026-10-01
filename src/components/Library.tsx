import { useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  CircuitBoard,
  Plus,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import {
  BLOCKS,
  captureFor,
  familyOf,
  FAMILIES,
  type BlockKind,
  type Port,
  type Scene,
} from "../lib/studio";
import { FamilyIcon } from "./PatchNode";
import type { GearInventory } from "../lib/gear-inventory";

type Props = {
  scene: Scene;
  onAddPort: (port: Port, direction: "input" | "output") => void;
  onAddBlock: (kind: BlockKind) => void;
  gear: GearInventory;
  onOpenGear: () => void;
};

export function Library({ scene, onAddPort, onAddBlock, gear, onOpenGear }: Props) {
  const capture = captureFor(scene);
  const [tab, setTab] = useState<"input" | "output" | "blocks">("input");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string[]>(["DIN", "USB DAW", "RTP"]);
  const onCanvas = useMemo(
    () => new Set(scene.nodes.map((node) => node.id)),
    [scene.nodes],
  );
  const filtered = capture.ports.filter(
    (port) =>
      (tab === "input" ? port.supports_input : port.supports_output) &&
      `${port.hardware} ${port.input_name} ${port.output_name}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <aside className="library" aria-label="Port library">
      <div className="sidebar-label">
        <span>YOUR WORKSPACE</span>
        <span className="tiny-tag">01</span>
      </div>
      <div className="device-card">
        <div className="device-card-title">
          <span className="device-mark">
            <CircuitBoard size={20} />
          </span>
          <div>
            <strong>mioXL</strong>
            <span>iConnectivity</span>
          </div>
          <span className="snapshot-dot" title="Device inventory" />
        </div>
        <div className="rack-illustration" aria-hidden="true">
          <span className="rack-brand">
            mio<span>XL</span>
          </span>
          <div className="rack-ports">
            {Array.from({ length: 8 }, (_, i) => (
              <i key={i} />
            ))}
          </div>
          <span className="rack-screen" />
        </div>
        <div className="device-card-meta">
          <span>
            {capture.device.device_name} <span className="muted">/ {capture.revision ? "DEVICE" : "DEMO"}</span>
          </span>
          <span>{capture.ports.length} ports</span>
        </div>
      </div>
      <section className="gear-sidebar"><div><strong>Gear inventory</strong><span>{gear.units.length} instrument{gear.units.length === 1 ? "" : "s"}</span></div><p>{gear.units.length ? gear.units.map(unit => unit.name).join(" · ") : "Name instruments and map their physical DIN wiring."}</p><button className="button secondary" onClick={onOpenGear}>Open wiring map</button></section>
      <div className="library-heading">
        <h2>Port library</h2>
        <span>{capture.ports.length}</span>
      </div>
      <label className="search-field">
        <Search size={15} />
        <input
          aria-label="Search ports"
          placeholder="Find a port…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <kbd>/</kbd>
      </label>
      <div className="library-tabs" role="tablist" aria-label="Port library">
        <button
          role="tab"
          aria-selected={tab === "input"}
          onClick={() => setTab("input")}
        >
          Sources
        </button>
        <button
          role="tab"
          aria-selected={tab === "output"}
          onClick={() => setTab("output")}
        >
          Destinations
        </button>
        <button
          role="tab"
          aria-selected={tab === "blocks"}
          aria-label="Processing blocks"
          onClick={() => setTab("blocks")}
        >
          <SlidersHorizontal size={15} />
        </button>
      </div>
      <div className="library-scroll">
        {tab === "blocks" ? (
          <div className="block-library">
            <p>Shape the signal.</p>
            <span>Build a processing chain on your canvas.</span>
            {BLOCKS.map((block) => (
              <button
                className="block-item"
                key={block.kind}
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.setData(
                    "application/mioxl",
                    JSON.stringify({ kind: block.kind }),
                  );
                  event.dataTransfer.effectAllowed = "move";
                }}
                onClick={() => onAddBlock(block.kind)}
              >
                <span className="library-icon family-processor">
                  <FamilyIcon family={block.family} />
                </span>
                <span>
                  <strong>{block.title}</strong>
                  <small>{block.description}</small>
                </span>
                <Plus size={14} />
              </button>
            ))}
            <div className="library-note">
              Processing blocks are local drafts. Connect the runtime in a later
              step.
            </div>
          </div>
        ) : (
          <>
            {FAMILIES.map((family) => {
              const ports = filtered.filter(
                (port) => familyOf(port) === family,
              );
              const open = expanded.includes(family) || Boolean(search);
              if (!ports.length) return null;
              return (
                <section className="port-group" key={family}>
                  <button
                    className="group-heading"
                    onClick={() =>
                      setExpanded((groups) =>
                        groups.includes(family)
                          ? groups.filter((item) => item !== family)
                          : [...groups, family],
                      )
                    }
                    aria-expanded={open}
                  >
                    <ChevronDown
                      size={13}
                      className={open ? "" : "is-collapsed"}
                    />
                    <span>{family === "CONTROL" ? "AUTOMATION" : family}</span>
                    <span>{ports.length}</span>
                  </button>
                  {open
                    ? ports.map((port) => {
                        const added = onCanvas.has(
                          `${tab === "input" ? "in" : "out"}-${port.id}`,
                        );
                        const name =
                          tab === "input" ? port.input_name : port.output_name;
                        return (
                          <button
                            className={`port-item ${added ? "on-canvas" : ""}`}
                            key={port.id}
                            aria-label={`${added ? "Show" : "Add"} ${port.hardware} ${tab === "input" ? "source" : "destination"}`}
                            draggable
                            onDragStart={(event) => {
                              event.dataTransfer.setData(
                                "application/mioxl",
                                JSON.stringify({
                                  portId: port.id,
                                  direction: tab,
                                }),
                              );
                              event.dataTransfer.effectAllowed = "move";
                            }}
                            onClick={() => onAddPort(port, tab)}
                          >
                            <span
                              className={`library-icon family-${family.toLowerCase().replaceAll(" ", "-")}`}
                            >
                              <FamilyIcon family={family} size={15} />
                            </span>
                            <span className="port-item-copy">
                              <strong>{name || port.hardware}</strong>
                              <small>
                                {name !== port.hardware
                                  ? port.hardware
                                  : "mioXL"}
                              </small>
                            </span>
                            {added ? (
                              <Check size={13} className="port-added" />
                            ) : (
                              <Plus size={13} />
                            )}
                          </button>
                        );
                      })
                    : null}
                </section>
              );
            })}
            {!filtered.length ? (
              <p className="empty-library">No ports match “{search}”.</p>
            ) : null}
          </>
        )}
      </div>
      <div className="library-bottom">
        <span className="outlined-plus">
          <Plus size={15} />
        </span>
        <div>
          <strong>Room to grow.</strong>
          <span>One canvas for your whole studio.</span>
        </div>
      </div>
    </aside>
  );
}
