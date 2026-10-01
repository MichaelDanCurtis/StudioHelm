import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  MiniMap,
  applyNodeChanges,
  useReactFlow,
  useNodesInitialized,
  type Connection,
  type Edge,
  type NodeChange,
  type XYPosition,
} from "@xyflow/react";
import {
  ArrowDownToLine,
  ArrowRight,
  Check,
  CircleHelp,
  Command,
  GitBranch,
  Layers,
  LayoutGrid,
  List,
  Maximize2,
  Minus,
  MousePointer2,
  PanelLeftClose,
  PanelRightClose,
  Plus,
  Redo2,
  RefreshCw,
  Network,
  Radio,
  Search,
  Undo2,
  X,
} from "lucide-react";
import { Library } from "./components/Library";
import { Inspector } from "./components/Inspector";
import { PatchNode } from "./components/PatchNode";
import { PatchEdge } from "./components/PatchEdge";
import { NetworkPanel } from "./components/NetworkPanel";
import { ControlRoom } from "./components/ControlRoom";
import { GearInventoryEditor } from "./components/GearInventoryEditor";
import { planQuickRoute, type QuickRoutePlan } from "./lib/controls";
import { GEAR_INVALID_BACKUP_KEY, GEAR_KEY, parseGearInventory, readGearInventory, type GearInventory } from "./lib/gear-inventory";
import { deviceRequest, type ApplyPlan } from "./lib/device";
import { Modal } from "./components/Modal";
import {
  activeRoutes,
  BLOCKS,
  blockNode,
  captureFor,
  routesFor,
  refreshScene,
  hardwareDraft,
  type Capture,
  connectRoute,
  connectionError,
  endpointName,
  initialScene,
  portsFor,
  portNode,
  protocols,
  readScene,
  removeRoute,
  STORAGE_KEY,
  type BlockKind,
  type PatchNode as PatchNodeType,
  type Port,
  type Scene,
} from "./lib/studio";

const nodeTypes = { patch: PatchNode };
const edgeTypes = { patch: PatchEdge };
const familyColors: Record<string, string> = {
  DIN: "#ddb783",
  "USB DAW": "#ad9dcc",
  "USB HOST": "#98acc7",
  RTP: "#7dbaa9",
  CONTROL: "#adbfa7",
  PROCESSOR: "#ddae76",
  OSC: "#95bfbc",
};
type History = { past: Scene[]; present: Scene; future: Scene[] };
type ModalName = "save" | "review" | "help" | "blocks" | "network" | "inventory" | null;

function Studio() {
  const [loaded] = useState(readScene);
  const [gearLoaded] = useState(readGearInventory);
  const [gear, setGear] = useState<GearInventory>(gearLoaded.inventory);
  const [history, setHistory] = useState<History>(() => ({
    past: [],
    present: loaded.scene,
    future: [],
  }));
  const scene = history.present;
  const capture = captureFor(scene);
  const capturedRoutes = routesFor(scene);
  const PORTS = portsFor(scene);
  const currentScene = useRef(scene);
  currentScene.current = scene;
  const busyRef = useRef(false);
  const [deviceBusy, setDeviceBusy] = useState("");
  const [deviceError, setDeviceError] = useState("");
  const [deviceRead, setDeviceRead] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [applyPlan, setApplyPlan] = useState<ApplyPlan | null>(null);
  const [applyResult, setApplyResult] = useState("");

  async function refreshDevice() {
    if (busyRef.current) return;
    busyRef.current = true; setDeviceBusy("Reading mioXL…"); setDeviceError("");
    try {
      const { snapshot } = await deviceRequest<{ snapshot: Capture }>("refresh");
      const next = refreshScene(currentScene.current, snapshot);
      const unchanged = captureFor(currentScene.current).revision === snapshot.revision;
      setHistory(current => ({ past: unchanged ? current.past : [], present: next, future: unchanged ? current.future : [] }));
      setDeviceRead(true); setApplyPlan(null);
    } catch (cause) {
      setDeviceRead(false); setAutoRefresh(false);
      setDeviceError(cause instanceof Error ? cause.message : "Could not read the mioXL.");
    } finally { busyRef.current = false; setDeviceBusy(""); }
  }
  const refreshRef = useRef(refreshDevice);
  refreshRef.current = refreshDevice;
  useEffect(() => { void refreshRef.current(); }, []);
  useEffect(() => {
    if (!autoRefresh) return;
    const timer = window.setInterval(() => {
      if (!document.hidden && !busyRef.current && !document.querySelector("dialog[open]")) void refreshRef.current();
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [autoRefresh]);

  async function prepareApply() {
    if (busyRef.current) return;
    busyRef.current = true; setDeviceBusy("Checking device…"); setDeviceError(""); setApplyResult(""); setApplyPlan(null);
    try {
      setApplyPlan(await deviceRequest<ApplyPlan>("plan", { revision: capture.revision, ...hardwareDraft(scene) }));
    } catch (cause) { setDeviceError(cause instanceof Error ? cause.message : "Could not prepare changes."); }
    finally { busyRef.current = false; setDeviceBusy(""); }
  }
  async function applyToDevice() {
    if (!applyPlan || busyRef.current) return;
    busyRef.current = true; setDeviceBusy("Applying and verifying…"); setDeviceError("");
    const applied = applyPlan;
    try {
      const result = await deviceRequest<{ snapshot: Capture; backup: string; verified: boolean }>("apply", { id: applied.id });
      const remaining = { ...currentScene.current,
        additions: currentScene.current.additions.filter(route => !applied.additions.includes(route.id)),
        removals: currentScene.current.removals.filter(id => !applied.removals.includes(id)) };
      // Host drafts remain in the scene; the verified hardware snapshot becomes their new baseline.
      const next = refreshScene({ ...remaining, snapshot: result.snapshot, capturedAt: result.snapshot.captured_at }, result.snapshot);
      setHistory({ past: [], present: next, future: [] }); setDeviceRead(true);
      setApplyResult(`Verified on mioXL. Recovery record: ${result.backup}. Changes are in the running preset; they have not been saved to flash.`);
    } catch (cause) { setDeviceRead(false); setDeviceError(cause instanceof Error ? cause.message : "Apply failed. Refresh to inspect device state."); }
    finally { setApplyPlan(null); busyRef.current = false; setDeviceBusy(""); }
  }
  const [selectedNode, setSelectedNode] = useState<string | null>("in-1");
  const [selectedRoute, setSelectedRoute] = useState<string | null>(null);
  const [view, setView] = useState<"canvas" | "routes" | "controls">("canvas");
  const [routeSearch, setRouteSearch] = useState("");
  const [modal, setModal] = useState<ModalName>(null);
  function navigateView(next: "canvas" | "routes" | "controls") {
    setModal(null);
    setApplyPlan(null);
    setView(next);
  }
  const [toast, setToast] = useState(loaded.warning ?? gearLoaded.warning ?? "");
  function changeGear(next: GearInventory) {
    setGear(next);
    const parsed = parseGearInventory(next);
    if (!parsed) { setToast("Finish the instrument or endpoint name before the inventory can be saved."); return; }
    try {
      if (gearLoaded.invalidRaw && !localStorage.getItem(GEAR_INVALID_BACKUP_KEY))
        localStorage.setItem(GEAR_INVALID_BACKUP_KEY, gearLoaded.invalidRaw);
      localStorage.setItem(GEAR_KEY, JSON.stringify(parsed));
    } catch { setToast("Inventory edits are visible here but browser storage is unavailable."); }
  }
  const [storageState, setStorageState] = useState<
    "saved" | "saving" | "unavailable"
  >("saved");
  const [libraryOpen, setLibraryOpen] = useState(() => window.innerWidth > 900);
  const [inspectorOpen, setInspectorOpen] = useState(
    () => window.innerWidth > 900,
  );
  const [zoom, setZoom] = useState(1);
  const flowArea = useRef<HTMLDivElement>(null);
  const { fitView, zoomIn, zoomOut, screenToFlowPosition, setCenter } =
    useReactFlow<PatchNodeType>();
  const nodesInitialized = useNodesInitialized();
  const routes = useMemo(() => activeRoutes(scene), [scene]);
  const node = scene.nodes.find((item) => item.id === selectedNode);
  const route = routes.find((item) => item.id === selectedRoute);
  const draftCount = scene.additions.length + scene.removals.length;
  const blockCount = scene.nodes.filter(
    (item) => item.data.kind !== "port",
  ).length;

  const commit = useCallback((update: (current: Scene) => Scene) => {
    setHistory((current) => {
      const next = update(current.present);
      return next === current.present
        ? current
        : {
            past: [...current.past.slice(-49), current.present],
            present: next,
            future: [],
          };
    });
  }, []);
  const undo = useCallback(
    () =>
      setHistory((current) =>
        current.past.length
          ? {
              past: current.past.slice(0, -1),
              present: current.past[current.past.length - 1],
              future: [current.present, ...current.future],
            }
          : current,
      ),
    [],
  );
  const redo = useCallback(
    () =>
      setHistory((current) =>
        current.future.length
          ? {
              past: [...current.past, current.present],
              present: current.future[0],
              future: current.future.slice(1),
            }
          : current,
      ),
    [],
  );

  useEffect(() => {
    if (!nodesInitialized || view !== "canvas" || !flowArea.current) return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(
        () => void fitView({ padding: 0.16, maxZoom: 1, duration: 150 }),
      );
    });
    observer.observe(flowArea.current);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [fitView, nodesInitialized, view]);

  useEffect(() => {
    setStorageState("saving");
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(scene));
        setStorageState("saved");
      } catch {
        setStorageState("unavailable");
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [scene]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 5000);
    return () => window.clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if (
        event.target instanceof HTMLElement &&
        (event.target.closest("input, textarea, select, dialog") ||
          event.target.isContentEditable)
      )
        return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      } else if (event.key === "Escape") {
        setSelectedNode(null);
        setSelectedRoute(null);
      } else if (event.key === "?" && !event.metaKey) setModal("help");
      else if (event.key === "/") {
        event.preventDefault();
        setLibraryOpen(true);
        window.setTimeout(
          () =>
            document
              .querySelector<HTMLInputElement>('[aria-label="Search ports"]')
              ?.focus(),
          0,
        );
      } else if (
        (event.key === "Backspace" || event.key === "Delete") &&
        selectedRoute
      ) {
        event.preventDefault();
        commit((current) => removeRoute(current, selectedRoute));
        setSelectedRoute(null);
      }
    }
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [commit, redo, selectedRoute, undo]);

  const renderNodes = useMemo(
    () =>
      scene.nodes.map((item) => ({
        ...item,
        selected: item.id === selectedNode,
        deletable: false,
        data: {
          ...item.data,
          readAt: capture.revision ? capture.captured_at : undefined,
          routeCount: routes.filter(
            (path) => path.source === item.id || path.target === item.id,
          ).length,
        },
      })),
    [routes, scene.nodes, selectedNode],
  );
  const renderEdges: Edge[] = useMemo(() => {
    const visible = new Set(scene.nodes.map((item) => item.id));
    const added = new Set(scene.additions.map((item) => item.id));
    return routes
      .filter((path) => visible.has(path.source) && visible.has(path.target))
      .map((path) => {
        const target = scene.nodes.find((item) => item.id === path.target)!;
        const source = scene.nodes.find((item) => item.id === path.source)!;
        const draft = added.has(path.id);
        return {
          ...path,
          type: "patch",
          sourceHandle: "output",
          targetHandle: "input",
          selected: path.id === selectedRoute,
          data: { draft, protocol: protocols(source).output },
          style: {
            stroke: draft ? "#edc080" : familyColors[target.data.family],
            strokeWidth: path.id === selectedRoute ? 3 : 1.8,
            strokeDasharray: draft ? "7 5" : undefined,
            opacity:
              selectedNode &&
              path.source !== selectedNode &&
              path.target !== selectedNode
                ? 0.35
                : 0.85,
          },
          ariaLabel: `${endpointName(path.source, scene.nodes, capture)} to ${endpointName(path.target, scene.nodes, capture)}${draft ? ", draft" : ", captured"}`,
        };
      });
  }, [routes, scene.additions, scene.nodes, selectedNode, selectedRoute]);

  const onNodesChange = useCallback((changes: NodeChange<PatchNodeType>[]) => {
    const moves = changes.filter(
      (change) => change.type === "position" || change.type === "dimensions",
    );
    if (moves.length)
      setHistory((current) => ({
        ...current,
        present: {
          ...current.present,
          nodes: applyNodeChanges(moves, current.present.nodes),
        },
      }));
  }, []);
  const checkpoint = useCallback(
    () =>
      setHistory((current) => ({
        ...current,
        past: [...current.past.slice(-49), current.present],
        future: [],
      })),
    [],
  );
  const selectNode = useCallback((id: string) => {
    setSelectedNode(id);
    setSelectedRoute(null);
    setInspectorOpen(true);
  }, []);
  const selectRoute = (id: string) => {
    setSelectedRoute(id);
    setSelectedNode(null);
    setInspectorOpen(true);
  };

  function connect(source: string, target: string) {
    const error = connectionError(scene, { source, target });
    if (error) {
      setToast(error);
      return;
    }
    commit((current) => connectRoute(current, source, target));
    setToast("Connection added to your local draft.");
  }
  function stageQuickRoute(plan: QuickRoutePlan): string {
    const latest = planQuickRoute(currentScene.current, plan.action);
    if (latest.fingerprint !== plan.fingerprint)
      throw new Error("Routing changed. Preview this control again before staging it.");
    if (!latest.removals.length && !latest.addition) return "That route is already the selected destination draft.";
    currentScene.current = latest.next;
    setHistory(current => ({ past: [...current.past.slice(-49), current.present], present: latest.next, future: [] }));
    setApplyPlan(null);
    setToast(`${plan.action.name} staged locally: ${latest.removals.length} replaced, ${latest.addition ? 1 : 0} connected.`);
    return "Replacement staged in the local draft. Review routes before any hardware apply.";
  }
  function centerPosition(): XYPosition {
    const bounds = flowArea.current?.getBoundingClientRect();
    const position = bounds
      ? screenToFlowPosition({
          x: bounds.x + bounds.width / 2 - 110,
          y: bounds.y + bounds.height / 2 - 50,
        })
      : { x: 300, y: 250 };
    while (
      scene.nodes.some(
        (item) =>
          Math.abs(item.position.x - position.x) < 275 &&
          Math.abs(item.position.y - position.y) < 195,
      )
    )
      position.y += 210;
    return position;
  }
  function addPort(
    port: Port,
    direction: "input" | "output",
    position?: XYPosition,
  ) {
    const next = portNode(port.id, direction, position ?? centerPosition(), capture);
    const existing = scene.nodes.find((item) => item.id === next.id);
    if (!existing)
      commit((current) => ({ ...current, nodes: [...current.nodes, next] }));
    selectNode(next.id);
    setView("canvas");
    if (existing)
      void setCenter(existing.position.x + 125, existing.position.y + 85, {
        zoom: Math.max(zoom, 0.8),
        duration: 250,
      });
    else setToast(`${port.hardware} added to the canvas.`);
  }
  function addBlock(kind: BlockKind, position?: XYPosition) {
    const next = blockNode(kind, position ?? centerPosition());
    commit((current) => ({ ...current, nodes: [...current.nodes, next] }));
    selectNode(next.id);
    setModal(null);
    setView("canvas");
    setToast("Block added. Connect its handles to build a processing chain.");
  }
  function onDrop(event: DragEvent) {
    event.preventDefault();
    try {
      const data = JSON.parse(event.dataTransfer.getData("application/mioxl"));
      const position = screenToFlowPosition({
        x: event.clientX - 125,
        y: event.clientY - 45,
      });
      if (BLOCKS.some((block) => block.kind === data.kind))
        addBlock(data.kind, position);
      else if (
        PORTS.has(data.portId) &&
        ["input", "output"].includes(data.direction)
      ) {
        const port = PORTS.get(data.portId)!;
        if (
          data.direction === "input"
            ? port.supports_input
            : port.supports_output
        )
          addPort(port, data.direction, position);
      }
    } catch {
      setToast("Choose a port or processing block from the library.");
    }
  }
  function deleteRoute(id: string) {
    commit((current) => removeRoute(current, id));
    setSelectedRoute(null);
    setToast("Connection removed in your local draft.");
  }
  function exportScene(exportedScene = scene) {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            ...exportedScene,
            exportKind: "mioxlplus-local-scene",
            exportedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${exportedScene.name.replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase()}-mioxlplus.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setToast("Local scene exported.");
  }
  const filteredRoutes = routes.filter((path) =>
    `${endpointName(path.source, scene.nodes, capture)} ${endpointName(path.target, scene.nodes, capture)}`
      .toLowerCase()
      .includes(routeSearch.toLowerCase()),
  );

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand" aria-label="MioXLplus">
          <span className="brand-symbol">
            <i />
            <i />
            <i />
            <i />
          </span>
          <span>
            mio<span className="brand-light">XL</span>
            <sup>plus</sup>
          </span>
        </div>
        <nav className="workflow-nav" aria-label="Workflow">
          <span className="workflow-label">Workflow</span>
          <div className="view-tabs" role="tablist" aria-label="Workflow views">
            <button role="tab" aria-selected={view === "canvas"} onClick={() => navigateView("canvas")}><GitBranch size={14} /> Canvas</button>
            <button role="tab" aria-selected={view === "routes"} onClick={() => navigateView("routes")}><List size={15} /> Routes<span>{routes.length}</span></button>
            <button role="tab" aria-selected={view === "controls"} onClick={() => navigateView("controls")}><Radio size={15} /> Control room</button>
          </div>
        </nav>
        <div className="header-actions">
          <span
            className={`save-state ${storageState === "unavailable" ? "warning" : ""}`}
          >
            <span className="status-dot" />
            {storageState === "saved"
              ? "Saved locally"
              : storageState === "saving"
                ? "Saving…"
                : "Export to save"}
          </span>
          <button
            className="button secondary review-button"
            onClick={() => { setApplyPlan(null); setApplyResult(""); setModal("review"); }}
          >
            Review draft
            {draftCount ? (
              <span className="button-count">{draftCount}</span>
            ) : null}
          </button>
          <button className="button primary" onClick={() => setModal("save")}>
            <Layers size={15} />
            Save scene
          </button>
        </div>
      </header>
      <div
        inert={!!deviceBusy && !!applyPlan}
        className={`workspace ${view === "controls" ? "controls-workspace" : ""} ${!libraryOpen ? "hide-library" : ""} ${!inspectorOpen ? "hide-inspector" : ""}`}
      >
        {libraryOpen ? (
          <Library scene={scene} onAddPort={addPort} onAddBlock={addBlock} gear={gear} onOpenGear={() => setModal("inventory")} />
        ) : null}
        <main className="main-stage">
          <header className="stage-heading">
            <div>
              <div className="eyebrow">
                <span className="amber-line" />
                {view === "controls" ? "THE MODULAR CONTROL ROOM" : "THE STUDIO PATCHBAY"}
              </div>
              {view === "controls" ? <><h1>Your instruments. <span>One touch away.</span></h1><p>Design control panels, choose routes, and rehearse keyboard gestures locally.</p></> : <><h1>Your signal. <span>Your flow.</span></h1><p>Make connections. Shape possibilities.</p></>}
            </div>
            {view === "canvas" && <div className="stage-heading-actions">
              <button className="button add-block" onClick={() => setModal("blocks")}><Plus size={14} /> Add block</button>
              <button className="icon-button help-button" onClick={() => setModal("help")} aria-label="Canvas help"><CircleHelp size={18} /></button>
            </div>}
          </header>
          <div className="device-toolbar">
            <div className={`device-read-status ${deviceRead ? "verified" : ""}`}>
              <span className="status-dot" /><span>{deviceBusy || (deviceRead ? `${capture.device.device_name} · ${capture.network.address}` : "Snapshot available")}</span>
              <small>{capture.revision ? `Read ${new Date(capture.captured_at).toLocaleTimeString()}` : "Synthetic demo"}</small>
            </div>
            <div className="device-controls">
              <label title="Read device configuration every 30 seconds while this tab is visible"><input type="checkbox" checked={autoRefresh} onChange={event => setAutoRefresh(event.target.checked)} />Auto</label>
              <button className="button subtle" onClick={() => void refreshDevice()} disabled={!!deviceBusy} aria-label="Refresh mioXL"><RefreshCw size={14} className={deviceBusy === "Reading mioXL…" ? "spin" : ""} /><span>Refresh</span></button>
              <button className="button subtle" onClick={() => setModal("network")} disabled={!!deviceBusy}><Network size={14} />Network</button>
            </div>
          </div>
          {deviceError ? <div className="device-alert" role="alert">{deviceError}<button aria-label="Dismiss device error" onClick={() => setDeviceError("")}><X size={14} /></button></div> : null}
          <div
            className="flow-area"
            ref={flowArea}
            onDrop={onDrop}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
            }}
          >
            <div
              className={`canvas-wrapper ${view !== "canvas" ? "offstage" : ""}`}
            >
              <ReactFlow<PatchNodeType>
                nodes={renderNodes}
                edges={renderEdges}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                onNodesChange={onNodesChange}
                onNodeDragStart={checkpoint}
                onNodeClick={(_, item) => selectNode(item.id)}
                onEdgeClick={(_, item) => selectRoute(item.id)}
                onPaneClick={() => {
                  setSelectedNode(null);
                  setSelectedRoute(null);
                }}
                onConnect={(connection: Connection) =>
                  connect(connection.source, connection.target)
                }
                isValidConnection={(connection) =>
                  !connectionError(scene, connection)
                }
                onMove={(_, viewport) => setZoom(viewport.zoom)}
                fitView
                fitViewOptions={{ padding: 0.16, maxZoom: 1 }}
                minZoom={0.2}
                maxZoom={1.7}
                connectionLineStyle={{ stroke: "#edc080", strokeWidth: 2 }}
                connectionRadius={28}
                deleteKeyCode={null}
                colorMode="dark"
                snapToGrid
                snapGrid={[15, 15]}
                aria-label="Studio routing canvas"
              >
                <Background
                  variant={BackgroundVariant.Dots}
                  gap={22}
                  size={1.1}
                  color="#3a3d38"
                />
                <MiniMap
                  pannable
                  zoomable
                  position="bottom-right"
                  nodeColor={(item) =>
                    familyColors[item.data.family as string] ?? "#edc080"
                  }
                  nodeStrokeWidth={0}
                  maskColor="rgba(21,24,22,.78)"
                />
              </ReactFlow>
              <div className="canvas-meta">
                <span className="canvas-crumb">
                  <LayoutGrid size={13} />
                  STUDIO <span>/</span> {scene.nodes.length} NODES
                </span>
                <span className="canvas-caption">
                  {renderEdges.length} visible paths
                </span>
              </div>
              <div className="canvas-bottom">
                <div className="canvas-controls">
                  <button
                    aria-label="Undo"
                    title="Undo · ⌘Z"
                    onClick={undo}
                    disabled={!history.past.length}
                  >
                    <Undo2 size={16} />
                  </button>
                  <button
                    aria-label="Redo"
                    title="Redo · ⇧⌘Z"
                    onClick={redo}
                    disabled={!history.future.length}
                  >
                    <Redo2 size={16} />
                  </button>
                  <i />
                  <button
                    onClick={() => void zoomOut({ duration: 180 })}
                    aria-label="Zoom out"
                  >
                    <Minus size={15} />
                  </button>
                  <span>{Math.round(zoom * 100)}%</span>
                  <button
                    onClick={() => void zoomIn({ duration: 180 })}
                    aria-label="Zoom in"
                  >
                    <Plus size={15} />
                  </button>
                  <i />
                  <button
                    aria-label="Arrange nodes"
                    title="Arrange nodes"
                    onClick={() => {
                      commit((current) => {
                        const rows = [0, 0, 0];
                        const hasBlocks = current.nodes.some(
                          (item) =>
                            item.data.kind !== "port" &&
                            item.data.kind !== "osc",
                        );
                        return {
                          ...current,
                          nodes: current.nodes.map((item) => {
                            const column = !protocols(item).input
                              ? 0
                              : protocols(item).output
                                ? 1
                                : hasBlocks
                                  ? 2
                                  : 1;
                            return {
                              ...item,
                              position: {
                                x: column * 425,
                                y:
                                  rows[column]++ * 220 +
                                  (column === 0 ? 90 : 0),
                              },
                            };
                          }),
                        };
                      });
                      requestAnimationFrame(
                        () =>
                          void fitView({
                            duration: 250,
                            padding: 0.16,
                            maxZoom: 1,
                          }),
                      );
                    }}
                  >
                    <LayoutGrid size={14} />
                  </button>
                  <button
                    onClick={() =>
                      void fitView({ duration: 250, padding: 0.16, maxZoom: 1 })
                    }
                    aria-label="Fit canvas"
                  >
                    <Maximize2 size={15} />
                  </button>
                </div>
                <span className="canvas-instruction">
                  <MousePointer2 size={12} />
                  Drag a handle to connect
                </span>
              </div>
            </div>
            {view === "routes" ? (
              <div className="route-table-view">
                <div className="table-heading">
                  <div>
                    <h2>Every connection, in one place.</h2>
                    <p>
                      {capturedRoutes.length} {capture.revision ? "device" : "synthetic demo"} routes ·{" "}
                      {scene.additions.length} added · {scene.removals.length}{" "}
                      removed
                    </p>
                  </div>
                  <label className="search-field">
                    <Search size={15} />
                    <input
                      value={routeSearch}
                      onChange={(event) => setRouteSearch(event.target.value)}
                      placeholder="Find a route…"
                      aria-label="Search routes"
                    />
                  </label>
                </div>
                <table>
                  <thead>
                    <tr>
                      <th>Source</th>
                      <th>Destination</th>
                      <th>Status</th>
                      <th>
                        <span className="sr-only">Inspect</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRoutes.map((path) => (
                      <tr
                        key={path.id}
                        className={
                          path.id === selectedRoute ? "selected-row" : ""
                        }
                      >
                        <td>{endpointName(path.source, scene.nodes, capture)}</td>
                        <td>{endpointName(path.target, scene.nodes, capture)}</td>
                        <td>
                          <span
                            className={`route-status ${scene.additions.some((item) => item.id === path.id) ? "draft" : ""}`}
                          >
                            {scene.additions.some((item) => item.id === path.id)
                              ? "Draft"
                              : "Captured"}
                          </span>
                        </td>
                        <td>
                          <button
                            className="icon-button"
                            aria-label={`Inspect route ${path.id}`}
                            onClick={() => selectRoute(path.id)}
                          >
                            <ArrowRight size={15} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!filteredRoutes.length ? (
                  <p className="table-empty">
                    No matching routes. Try a port name or number.
                  </p>
                ) : null}
              </div>
            ) : null}
            <div className={`control-room-wrap ${view !== "controls" ? "offstage" : ""}`}><ControlRoom scene={scene} onStage={stageQuickRoute}/></div>
          </div>
          <footer className="stage-footer">
            <div>
              <button
                className="icon-button"
                onClick={() => setLibraryOpen((open) => !open)}
                aria-label="Toggle port library"
              >
                <PanelLeftClose size={14} />
              </button>
              <span>
                {capture.revision ? "DEVICE READ" : "DEMO"} <i />
                {new Date(capture.captured_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }).toUpperCase()}
              </span>
            </div>
            <div>
              <span className="footer-drafts">
                {draftCount
                  ? `${draftCount} route ${draftCount === 1 ? "edit" : "edits"}`
                  : capture.revision ? "Device routes · draft edits stay local" : "Explore synthetic demo routes"}
                {blockCount
                  ? ` · ${blockCount} draft ${blockCount === 1 ? "block" : "blocks"}`
                  : ""}
              </span>
              {view !== "controls" && <button
                className="icon-button"
                onClick={() => setInspectorOpen((open) => !open)}
                aria-label="Toggle inspector"
              >
                <PanelRightClose size={14} />
              </button>}
            </div>
          </footer>
        </main>
        {inspectorOpen && view !== "controls" ? (
          <Inspector
            scene={scene}
            node={node}
            route={route}
            onClose={() => {
              setSelectedNode(null);
              setSelectedRoute(null);
            }}
            onConnect={connect}
            onUpdate={(id, data) => {
              commit((current) => ({
                ...current,
                nodes: current.nodes.map((item) =>
                  item.id === id
                    ? { ...item, data: { ...item.data, ...data } }
                    : item,
                ),
              }));
              setToast("Block settings saved to your draft.");
            }}
            onRemoveNode={(id) => {
              commit((current) => ({
                ...current,
                nodes: current.nodes.filter((item) => item.id !== id),
                additions: current.additions.filter(
                  (path) => path.source !== id && path.target !== id,
                ),
              }));
              setSelectedNode(null);
            }}
            onRemoveRoute={deleteRoute}
            onSelectRoute={selectRoute}
            onRevealRoute={(path) => {
              commit((current) => {
                const nodes = [...current.nodes];
                for (const id of [path.source, path.target]) {
                  if (nodes.some((item) => item.id === id)) continue;
                  const [prefix, number] = id.split("-");
                  const direction = prefix === "in" ? "input" : "output";
                  if (PORTS.has(Number(number)))
                    nodes.push(
                      portNode(Number(number), direction, {
                        x: direction === "input" ? 0 : 455,
                        y:
                          nodes.filter(
                            (item) => item.data.direction === direction,
                          ).length * 220,
                      }, capture),
                    );
                }
                return { ...current, nodes };
              });
              setView("canvas");
            }}
          />
        ) : null}
      </div>
      {toast ? (
        <div className="toast" role="status">
          <Check size={16} />
          <span>{toast}</span>
          <button
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <X size={14} />
          </button>
        </div>
      ) : null}
      {modal === "inventory" ? <Modal title="Gear inventory and physical wiring" wide onClose={() => setModal(null)}><GearInventoryEditor inventory={gear} scene={scene} onChange={changeGear} onStage={stageQuickRoute}/></Modal> : null}
      {modal === "network" ? <NetworkPanel onClose={() => setModal(null)} /> : null}
      {modal === "blocks" ? (
        <Modal
          title="A little more possibility."
          onClose={() => setModal(null)}
        >
          <p className="modal-intro">
            Add a processing block, then connect it to your signal path.
          </p>
          <div className="add-block-grid">
            {BLOCKS.map((block) => (
              <button key={block.kind} onClick={() => addBlock(block.kind)}>
                <span className="block-graphic">
                  <GitBranch size={27} />
                </span>
                <strong>{block.title}</strong>
                <span>{block.description}</span>
                <small>
                  ADD TO CANVAS <Plus size={12} />
                </small>
              </button>
            ))}
          </div>
          <p className="modal-note">
            Blocks are editable drafts. The processing runtime is not connected
            to this interface yet.
          </p>
        </Modal>
      ) : null}
      {modal === "save" ? (
        <Modal title="Give this flow a home." onClose={() => setModal(null)}>
          <p className="modal-intro">
            Your layout and staged routes are saved in this browser. Export a
            scene to keep a portable copy.
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const name = String(
                new FormData(event.currentTarget).get("name"),
              ).trim();
              if (name) {
                commit((current) => ({ ...current, name }));
                setModal(null);
                setToast(`“${name}” saved locally.`);
              }
            }}
          >
            <label className="modal-field">
              Scene name
              <input
                name="name"
                defaultValue={scene.name}
                required
                maxLength={80}
                autoFocus
              />
            </label>
            <div className="scene-summary">
              <span>
                <b>{scene.nodes.length}</b>nodes
              </span>
              <span>
                <b>{draftCount}</b>route edits
              </span>
              <span>
                <b>{blockCount}</b>blocks
              </span>
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="button secondary"
                onClick={(event) => {
                  const form = event.currentTarget.closest("form")!;
                  if (form.reportValidity()) {
                    const name = String(new FormData(form).get("name")).trim();
                    if (name) exportScene({ ...scene, name });
                  }
                }}
              >
                <ArrowDownToLine size={15} />
                Export JSON
              </button>
              <button type="submit" className="button primary">
                <Check size={15} />
                Save scene
              </button>
            </div>
          </form>
          <p className="modal-note">
            A MioXLplus scene stores your visual patch and drafts. It is not a
            hardware preset backup.
          </p>
        </Modal>
      ) : null}
      {modal === "review" ? (
        <Modal title="Your draft, at a glance." onClose={deviceBusy ? () => {} : () => { setApplyPlan(null); setModal(null); }}>
          <p className="modal-intro">
            Compare your local changes with {capture.preset.name}, preset {capture.preset.number}.
          </p>
          <div className="review-summary">
            <span>
              <b>+{scene.additions.length}</b>connections
            </span>
            <span>
              <b>−{scene.removals.length}</b>connections
            </span>
            <span>
              <b>{blockCount}</b>host blocks
            </span>
          </div>
          <div className="review-list">
            {scene.additions.map((path) => (
              <div key={path.id}>
                <span className="review-plus">+</span>
                <p>
                  {endpointName(path.source, scene.nodes, capture)}
                  <ArrowRight size={12} />
                  {endpointName(path.target, scene.nodes, capture)}
                </p>
              </div>
            ))}
            {scene.removals.map((id) => {
              const path = capturedRoutes.find((item) => item.id === id)!;
              return (
                <div key={id}>
                  <span className="review-minus">−</span>
                  <p>
                    {endpointName(path.source, scene.nodes, capture)}
                    <ArrowRight size={12} />
                    {endpointName(path.target, scene.nodes, capture)}
                  </p>
                </div>
              );
            })}
            {!draftCount && !blockCount ? (
              <div className="review-empty">
                <Check size={24} />
                <p>
                  Your routing matches the captured preset.
                  <br />
                  Add a connection or block to start a draft.
                </p>
              </div>
            ) : null}
            {scene.nodes
              .filter((item) => item.data.kind !== "port")
              .map((item) => (
                <div key={item.id}>
                  <GitBranch size={16} />
                  <p>
                    {item.data.title}
                    <span className="muted">Draft host block</span>
                  </p>
                </div>
              ))}
          </div>
          <div className="review-notice">
            Direct port routes can be applied to the running mioXL preset. Host processing blocks stay in your draft. A routing recovery record is saved before writing; every changed port is read back.
          </div>
          {deviceError ? <p className="device-error" role="alert">{deviceError}</p> : null}
          {applyResult ? <p className="apply-success" role="status">{applyResult}</p> : null}
          {applyPlan ? <div className="apply-confirmation">
            <strong>Ready for {applyPlan.device.model} · {applyPlan.device.serial}</strong>
            <p>{applyPlan.additions.length} additions · {applyPlan.removals.length} removals · preset {applyPlan.preset.number} “{applyPlan.preset.name}”</p>
            <p>Changes affect MIDI immediately. This updates the working preset; saving to device flash is a separate operation.</p>
            <button className="button primary" disabled={!!deviceBusy} onClick={() => void applyToDevice()}>{deviceBusy || "Apply to mioXL"}</button>
          </div> : null}
          <div className="modal-actions">
            <button
              disabled={!!deviceBusy}
              className="button subtle"
              onClick={() => {
                commit(() => initialScene(capture));
                setApplyPlan(null);
                setModal(null);
                selectNode("in-1");
                setToast("Baseline scene restored. You can undo this.");
              }}
            >
              {capture.revision ? "Clear local draft" : "Restore demo baseline"}
            </button>
            <button className="button secondary" onClick={() => exportScene()}>
              <ArrowDownToLine size={15} />
              Export draft
            </button>
            {!applyPlan ? <button className="button primary" disabled={!!deviceBusy || !capture.revision || !(hardwareDraft(scene).additions.length + scene.removals.length)} onClick={() => void prepareApply()}>{deviceBusy || "Review hardware changes"}</button> : null}
          </div>
        </Modal>
      ) : null}
      {modal === "help" ? (
        <Modal title="Find your flow." onClose={() => setModal(null)}>
          <p className="modal-intro">
            A visual patchbay for mioXL. Offline mode uses a synthetic demo; a configured live read replaces it with device state.
          </p>
          <div className="help-steps">
            <div>
              <span>01</span>
              <p>
                <strong>Build your canvas</strong>Click or drag ports from the
                library. Use Sources for mioXL inputs and Destinations for its
                outputs.
              </p>
            </div>
            <div>
              <span>02</span>
              <p>
                <strong>Make a connection</strong>Drag a right-hand handle to a
                compatible left-hand handle. You can also use “Create a
                connection” in the inspector.
              </p>
            </div>
            <div>
              <span>03</span>
              <p>
                <strong>Shape and save</strong>Add processing blocks, inspect
                your paths, and save a local scene. Solid lines are baseline
                routes; dashed lines are drafts.
              </p>
            </div>
          </div>
          <div className="shortcut-list">
            <span>
              <kbd>
                <Command size={12} /> Z
              </kbd>
              Undo
            </span>
            <span>
              <kbd>⇧ ⌘ Z</kbd>Redo
            </span>
            <span>
              <kbd>/</kbd>Search ports
            </span>
            <span>
              <kbd>esc</kbd>Clear selection
            </span>
          </div>
          <p className="modal-note">
            The graph starts with a focused selection. The Routes view contains
            all {capturedRoutes.length} baseline routes. Hardware changes require
            a configured device and an explicit review and apply step.
          </p>
        </Modal>
      ) : null}
    </div>
  );
}

export default function App() {
  return (
    <ReactFlowProvider>
      <Studio />
    </ReactFlowProvider>
  );
}
