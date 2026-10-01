import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Cable, Check, CircleHelp, Keyboard, Plus, Radio, SlidersHorizontal, Trash2 } from "lucide-react";
import {
  CONTROLS_KEY, parseControls, planQuickRoute, readControls, validOscPath,
  type Controls, type InstrumentProfile, type QuickRoutePlan, type RouteAction, type MidiBinding,
} from "../lib/controls";
import { activeRoutes, captureFor, endpointName, type Scene } from "../lib/studio";
import { downloadSurfacePreview, surfaceFrame } from "../lib/surface";
import { encodePeakParameter, formatMidiBytes } from "../lib/peak-midi";
import { midiPressEdge, midiToggleEdge } from "../lib/midi-trigger";
import { transitionNote, transitionRoute, disconnectedSource, type HeldNote } from "../lib/note-transition";

type BridgeStatus = { running: boolean; host: string; port: number | null; seq: number; lastError: string; bindings: number };
type BridgeEvent = { seq: number; id: string; path: string; at: string };
type MidiInputLike = { id: string; name?: string | null; onmidimessage: ((event: { data: Uint8Array }) => void) | null; close(): Promise<void> };
type MidiAccessLike = { inputs: Map<string, MidiInputLike> };
const colors: RouteAction["color"][] = ["amber", "sage", "blue", "rose"];

async function bridgeRequest<T>(operation: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/controls/${operation}`, body === undefined ? undefined : {
    method: "POST", headers: { "Content-Type": "application/json", "X-MioXLplus": "studio" }, body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Control bridge unavailable.");
  return result as T;
}

function actionDraft(): RouteAction {
  const id = crypto.randomUUID();
  return { id, name: "", source: 0, target: 0, policy: "destination", oscPath: `/mioxlplus/route/${id}`, color: "amber" };
}

export function ControlRoom({ scene, onStage }: { scene: Scene; onStage: (plan: QuickRoutePlan) => string }) {
  const [loaded] = useState(readControls);
  const [controls, setControls] = useState<Controls>(loaded.controls);
  const controlsRef = useRef(controls); controlsRef.current = controls;
  const sceneRef = useRef(scene); sceneRef.current = scene;
  const [panelId, setPanelId] = useState(controls.panels[0]?.id ?? "");
  const [section, setSection] = useState<"panels" | "keyboard" | "osc">("panels");
  const [draft, setDraft] = useState<RouteAction | null>(null);
  const [preview, setPreview] = useState<QuickRoutePlan | null>(null);
  const [selectedProfile, setSelectedProfile] = useState<string | null>(null);
  const [message, setMessage] = useState(loaded.warning ?? "");
  const [bridge, setBridge] = useState<BridgeStatus | null>(null);
  const [bridgePort, setBridgePort] = useState(9001);
  const [midiInputs, setMidiInputs] = useState<MidiInputLike[]>([]);
  const [selectedInputId, setSelectedInputId] = useState("");
  const [bindingAction, setBindingAction] = useState("");
  const [bindingChannel, setBindingChannel] = useState(1);
  const [bindingCc, setBindingCc] = useState(112);
  const [bindingMode, setBindingMode] = useState<NonNullable<MidiBinding["mode"]>>("toggle");
  const [trace, setTrace] = useState<string[]>([]);
  const [heldNotes, setHeldNotes] = useState<HeldNote[]>([]);
  const [noteMessage, setNoteMessage] = useState("");
  const clientRef = useRef(crypto.randomUUID());
  const midiInputRef = useRef<MidiInputLike | null>(null);
  const midiAccessRef = useRef<MidiAccessLike | null>(null);
  const armedRef = useRef(new Map<string, boolean>());
  const toggledRef = useRef(new Map<string, number>());
  const firedRef = useRef(new Map<string, number>());
  const cursorRef = useRef<number | null>(null);
  const [lastTrigger, setLastTrigger] = useState("");
  const panel = controls.panels.find(item => item.id === panelId);
  const profile = controls.profiles.find(item => item.id === selectedProfile);
  const snapshot = captureFor(scene);
  const sources = useMemo(() => snapshot.ports.filter(port => port.supports_input), [snapshot]);
  const destinations = useMemo(() => snapshot.ports.filter(port => port.supports_output), [snapshot]);

  useEffect(() => {
    const parsed = parseControls(controls);
    if (!parsed) { setMessage("Invalid panel settings were not saved."); return; }
    try { localStorage.setItem(CONTROLS_KEY, JSON.stringify(parsed)); }
    catch { setMessage("Browser storage is unavailable. Panel edits will be lost on reload."); }
    void bridgeRequest<BridgeStatus>("configure", { client: clientRef.current, bindings: parsed.actions.map(item => ({ id: item.id, path: item.oscPath })) })
      .catch(error => setMessage(error.message));
  }, [controls]);

  useEffect(() => {
    let mounted = true;
    void bridgeRequest<BridgeStatus>("status").then(status => {
      if (!mounted) return;
      setBridge(status); cursorRef.current = status.seq;
      if (status.port) setBridgePort(status.port);
    }).catch(error => { if (mounted) setMessage(error.message); });
    const timer = window.setInterval(async () => {
      if (cursorRef.current === null) return;
      try {
        const result = await bridgeRequest<BridgeStatus & { events: BridgeEvent[] }>(`events?after=${cursorRef.current}&client=${clientRef.current}`);
        if (!mounted) return;
        setBridge(result);
        for (const event of result.events) {
          cursorRef.current = Math.max(cursorRef.current ?? 0, event.seq);
          const action = controlsRef.current.actions.find(item => item.id === event.id && item.oscPath === event.path);
          if (action) trigger(action, "OSC");
        }
      } catch (error) { if (mounted) setMessage(error instanceof Error ? error.message : "OSC bridge disconnected."); }
    }, 700);
    return () => { mounted = false; window.clearInterval(timer); };
  }, []);

  useEffect(() => () => { if (midiInputRef.current) { midiInputRef.current.onmidimessage = null; void midiInputRef.current.close(); } }, []);

  function trigger(action: RouteAction, origin: string) {
    try {
      const plan = planQuickRoute(sceneRef.current, action);
      setPreview(plan); setDraft(null); setSection("panels");
      setSelectedProfile(action.profileId ?? null);
      setLastTrigger(`${origin} · ${action.name} · ${new Date().toLocaleTimeString()}`);
      setMessage(`${origin} selected ${action.name}. Review the replacement list, then stage the local draft.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not stage route."); }
  }

  function processMidi(data: Uint8Array) {
    if (data.length < 3 || (data[0] & 0xf0) !== 0xb0) return; // CC only; never route on musical notes.
    const channel = (data[0] & 0x0f) + 1, cc = data[1], value = data[2];
    const key = `${channel}:${cc}`;
    const binding = controlsRef.current.midiBindings.find(item => item.channel === channel && item.cc === cc);
    if (!binding) return;
    const active = binding.mode === "toggle"
      ? midiToggleEdge(toggledRef.current, firedRef.current, key, value, Date.now())
      : midiPressEdge(armedRef.current, firedRef.current, key, value, Date.now());
    if (!active) return;
    const action = controlsRef.current.actions.find(item => item.id === binding.actionId);
    if (action) trigger(action, "Keyboard CC");
  }

  async function connectMidi() {
    try {
      const request = (navigator as Navigator & { requestMIDIAccess?: (options: { sysex: boolean }) => Promise<unknown> }).requestMIDIAccess;
      if (!request) throw new Error("Web MIDI input is unavailable in this browser.");
      const access = await request.call(navigator, { sysex: false }) as MidiAccessLike;
      midiAccessRef.current = access;
      const inputs = [...access.inputs.values()]; setMidiInputs(inputs);
      setMessage(inputs.length ? "Choose one keyboard input to listen for mapped CC controls." : "No MIDI inputs found. You can still simulate a mapped CC below.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "MIDI permission was not granted."); }
  }

  async function selectMidiInput(id: string) {
    if (midiInputRef.current) { midiInputRef.current.onmidimessage = null; await midiInputRef.current.close(); }
    midiInputRef.current = null; setSelectedInputId(id); armedRef.current.clear(); toggledRef.current.clear(); firedRef.current.clear();
    if (!id) return;
    const input = midiAccessRef.current?.inputs.get(id);
    if (!input) { setMessage("This MIDI input disconnected. Reconnect to continue."); return; }
    input.onmidimessage = event => processMidi(event.data);
    midiInputRef.current = input;
    setMessage(`Listening for mapped CC messages from ${input.name || "selected keyboard"}. Note messages are ignored.`);
  }

  function saveAction() {
    if (!draft) return;
    const name = draft.name.trim(), path = draft.oscPath.trim();
    if (!name || !draft.source || !draft.target || !validOscPath(path)) { setMessage("Enter a name, valid source and destination, and OSC path."); return; }
    if (controls.actions.some(item => item.id !== draft.id && item.oscPath === path)) { setMessage("Each OSC path must be unique."); return; }
    const linked = controls.profiles.find(item => item.id === draft.profileId);
    if (linked && linked.destination !== draft.target) { setMessage("The selected instrument must use this destination."); return; }
    const action = { ...draft, name, oscPath: path };
    try { planQuickRoute(scene, action); } catch (error) { setMessage(error instanceof Error ? error.message : "Invalid route."); return; }
    setControls(current => ({ ...current,
      actions: current.actions.some(item => item.id === action.id) ? current.actions.map(item => item.id === action.id ? action : item) : [...current.actions, action],
      panels: current.panels.map(item => item.id === panelId && !item.actionIds.includes(action.id) ? { ...item, actionIds: [...item.actionIds, action.id] } : item),
    }));
    setDraft(null); setMessage("Control saved locally. Its button opens a replacement preview.");
  }

  function removeAction(id: string) {
    setControls(current => ({ ...current, actions: current.actions.filter(item => item.id !== id),
      panels: current.panels.map(item => ({ ...item, actionIds: item.actionIds.filter(actionId => actionId !== id) })),
      midiBindings: current.midiBindings.filter(item => item.actionId !== id) }));
    setDraft(null); setPreview(null);
  }

  function updateProfile(next: InstrumentProfile) {
    setControls(current => ({ ...current, profiles: current.profiles.map(item => item.id === next.id ? next : item) }));
  }

  async function toggleBridge() {
    try {
      if (bridge?.running) setBridge(await bridgeRequest<BridgeStatus>("stop", { client: clientRef.current }));
      else {
        const next = await bridgeRequest<BridgeStatus>("start", { port: bridgePort, client: clientRef.current,
          bindings: controls.actions.map(item => ({ id: item.id, path: item.oscPath })) });
        setBridge(next); cursorRef.current = next.seq;
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : "OSC bridge failed."); }
  }

  function simulateParameter(profile: InstrumentProfile, parameter: InstrumentProfile["parameters"][number], value: number) {
    try {
      const bytes = encodePeakParameter(parameter, value);
      updateProfile({ ...profile, parameters: profile.parameters.map(item => item.id === parameter.id ? { ...item, value } : item) });
      setTrace(current => [`${parameter.name} ${value}: ${formatMidiBytes(bytes)} · simulated, not sent`, ...current].slice(0, 12));
    } catch (error) { setMessage(error instanceof Error ? error.message : "Parameter cannot be encoded."); }
  }

  function simulateHeldNote(plan: QuickRoutePlan, velocity: number) {
    const source = plan.action.source;
    if (velocity > 0) {
      const outputs = activeRoutes(sceneRef.current).filter(route => route.source === `in-${source}`).map(route => Number(route.target.slice(4)));
      if (!outputs.length) { setNoteMessage("No current route from this source to rehearse a held note."); return; }
      const next = transitionNote(heldNotes, source, 1, 60, velocity, outputs);
      setHeldNotes(next.notes);
      const removedOutputs = plan.removals.filter(route => route.source === `in-${source}`).map(route => Number(route.target.slice(4)));
      setNoteMessage(transitionRoute(next.notes, source, removedOutputs) ?? `Simulated C4 held on outputs ${outputs.join(", ")}; none are removed by this action.`);
    } else {
      const next = transitionNote(heldNotes, source, 1, 60, 0, plan.action.target);
      setHeldNotes(next.notes);
      setNoteMessage(next.releases.length ? `Simulated C4 note-off stays on original outputs ${next.releases.map(item => item.destination).join(", ")}; no bytes sent.` : "No simulated C4 note was held.");
    }
  }

  return <div className="control-room">
    <aside className="control-rail">
      <div className="control-rail-title">CONTROL ROOM <span>LOCAL DRAFT</span></div>
      <button className={section === "panels" ? "active" : ""} onClick={() => setSection("panels")}><SlidersHorizontal size={16}/> Panels</button>
      {controls.panels.map(item => <button key={item.id} className={`control-panel-link ${section === "panels" && panelId === item.id ? "active" : ""}`} onClick={() => { setPanelId(item.id); setSection("panels"); setDraft(null); setPreview(null); }}>{item.name}<span>{item.actionIds.length}</span></button>)}
      <button className="control-rail-add" onClick={() => {
        if (controls.panels.length >= 8) return setMessage("Maximum of eight panels.");
        const id = crypto.randomUUID();
        setControls(current => ({ ...current, panels: [...current.panels, { id, name: `Panel ${current.panels.length + 1}`, description: "", actionIds: [] }] }));
        setPanelId(id); setSection("panels");
      }}><Plus size={15}/> New panel</button>
      <div className="control-rail-divider"/>
      <button className={section === "keyboard" ? "active" : ""} onClick={() => setSection("keyboard")}><Keyboard size={16}/> Keyboard input</button>
      <button className={section === "osc" ? "active" : ""} onClick={() => setSection("osc")}><Radio size={16}/> OSC bridge <i className={bridge?.running ? "live" : ""}/></button>
      <div className="control-rail-foot"><Cable size={15}/> Route actions only stage edits. No MIDI or SysEx is sent.</div>
    </aside>
    <div className="control-content">
      {section === "panels" && panel && <>
        <div className="control-content-head"><span className="eyebrow">YOUR CONTROL SURFACE</span><div className="control-heading-row"><div><h2>{panel.name}</h2><p>{panel.description || "Build a set of named instrument routes."}</p></div><button className="button secondary" onClick={() => { setDraft(actionDraft()); setPreview(null); }}><Plus size={15}/> Add route control</button></div></div>
        <div className="control-panel-edit"><label>Panel name<input aria-label="Panel name" value={panel.name} maxLength={60} onChange={event => setControls(current => ({ ...current, panels: current.panels.map(item => item.id === panel.id ? { ...item, name: event.target.value } : item) }))}/></label><label>Description<input aria-label="Panel description" value={panel.description} maxLength={120} onChange={event => setControls(current => ({ ...current, panels: current.panels.map(item => item.id === panel.id ? { ...item, description: event.target.value } : item) }))}/></label>{controls.panels.length > 1 && <button className="icon-button" aria-label="Delete panel" title="Delete panel (controls remain available)" onClick={() => { setControls(current => ({ ...current, panels: current.panels.filter(item => item.id !== panel.id) })); setPanelId(controls.panels.find(item => item.id !== panel.id)!.id); }}><Trash2 size={16}/></button>}</div>
        <div className="control-button-grid">{panel.actionIds.map(id => controls.actions.find(item => item.id === id)).filter((item): item is RouteAction => !!item).map(action => <button key={action.id} className={`route-control ${action.color}`} onClick={() => { try { setPreview(planQuickRoute(scene, action)); setDraft(null); setSelectedProfile(action.profileId ?? null); } catch (error) { setMessage(error instanceof Error ? error.message : "Invalid route action."); } }}><span className="route-control-top"><span className="route-control-icon"><ArrowRight size={20}/></span><span className="route-control-dots">•••</span></span><strong>{action.name}</strong><small>{endpointName(`in-${action.source}`, scene.nodes, snapshot)}<ArrowRight size={12}/>{endpointName(`out-${action.target}`, scene.nodes, snapshot)}</small><span className="route-control-path">{action.oscPath}</span></button>)}
          {!panel.actionIds.length && <div className="control-empty"><Cable size={30}/><h3>One touch from piano to synth.</h3><p>Add a route control, choose the exact input and destination, then preview which existing routes it replaces.</p><button className="button primary" onClick={() => setDraft(actionDraft())}><Plus size={15}/> Create first control</button></div>}
        </div>
        <section className="instrument-section"><div className="control-heading-row"><div><span className="eyebrow">INSTRUMENT PROFILES</span><h3>Shape the selected sound</h3></div></div><div className="instrument-list">{controls.profiles.map(item => <button key={item.id} className={selectedProfile === item.id ? "selected" : ""} onClick={() => setSelectedProfile(item.id)}><span>{item.name}</span><small>{item.destination ? endpointName(`out-${item.destination}`, scene.nodes, snapshot) : "Choose mioXL output"}</small></button>)}</div>{profile && <div className="surface-preview"><div className="surface-preview-head"><div><span className="eyebrow">S88 SEMANTIC PAGE · SIMULATION</span><h4>{profile.name}</h4></div><button className="button secondary" onClick={() => { try { downloadSurfacePreview(surfaceFrame(profile)); } catch (error) { setMessage(error instanceof Error ? error.message : "Preview export failed."); } }}>Export preview PNG</button></div><div className="surface-slots">{Array.from({ length: 8 }, (_, index) => profile.parameters[index]).map((parameter, index) => <div key={parameter?.id ?? index}><small>{String(index + 1).padStart(2, "0")}</small><strong>{parameter?.name ?? "—"}</strong><b>{parameter?.value === null ? "unknown" : parameter?.value ?? ""}</b><small>{parameter ? parameter.nrpn ? `NRPN ${parameter.nrpn.join(":")}` : `CC ${parameter.cc}` : ""}</small></div>)}</div><p>Illustrative layout only. Image size and USB display protocol are unverified; this PNG is not sent to the keyboard.</p></div>}</section>
      </>}
      {section === "keyboard" && <div className="control-module"><span className="eyebrow">CONTROL ROOM / KEYBOARD</span><h2>Make a mapped control choose an instrument.</h2><p>Only a chosen MIDI input and explicit CC bindings can trigger routing. Musical notes and unbound controls are ignored. Every trigger opens a replacement preview for manual staging. S88 MK3 MIDI Mode buttons 1–8 use CC 112–119 on channel 1; the default is button 1.</p><div className="control-card"><h3>Input</h3><button className="button secondary" onClick={() => void connectMidi()}>Connect MIDI input…</button><label>Selected keyboard<select aria-label="Selected keyboard" value={selectedInputId} onChange={event => void selectMidiInput(event.target.value)}><option value="">None · simulation only</option>{midiInputs.map(input => <option key={input.id} value={input.id}>{input.name || input.id}</option>)}</select></label></div><div className="control-card"><h3>Map a CC control</h3><div className="control-form-grid"><label>Channel<input type="number" min="1" max="16" value={bindingChannel} onChange={event => setBindingChannel(Number(event.target.value))}/></label><label>CC number<input type="number" min="0" max="127" value={bindingCc} onChange={event => setBindingCc(Number(event.target.value))}/></label><label>Activation<select aria-label="CC activation" value={bindingMode} onChange={event => setBindingMode(event.target.value as NonNullable<MidiBinding["mode"]>)}><option value="toggle">Toggle button · either change</option><option value="rising">Momentary · low to high</option></select></label><label>Route action<select value={bindingAction} onChange={event => setBindingAction(event.target.value)}><option value="">Choose action</option>{controls.actions.map(action => <option key={action.id} value={action.id}>{action.name}</option>)}</select></label></div><button className="button primary" onClick={() => {
        if (!bindingAction || !Number.isInteger(bindingChannel) || bindingChannel < 1 || bindingChannel > 16 || !Number.isInteger(bindingCc) || bindingCc < 0 || bindingCc > 127) return setMessage("Choose a valid channel, CC, and route action.");
        if (controls.midiBindings.some(item => item.channel === bindingChannel && item.cc === bindingCc)) return setMessage("That channel and CC are already mapped.");
        setControls(current => ({ ...current, midiBindings: [...current.midiBindings, { id: crypto.randomUUID(), actionId: bindingAction, channel: bindingChannel, cc: bindingCc, mode: bindingMode }] }));
      }}>Add mapping</button></div><div className="binding-list">{controls.midiBindings.map(binding => <div key={binding.id}><b>Ch {binding.channel} · CC {binding.cc} · {binding.mode === "toggle" ? "toggle" : "rising"}</b><span>{controls.actions.find(action => action.id === binding.actionId)?.name ?? "Missing action"}</span><button className="button secondary" onClick={() => { processMidi(new Uint8Array([0xb0 + binding.channel - 1, binding.cc, binding.mode === "toggle" && toggledRef.current.get(`${binding.channel}:${binding.cc}`) === 1 ? 0 : 127])); if (binding.mode !== "toggle") processMidi(new Uint8Array([0xb0 + binding.channel - 1, binding.cc, 0])); }}>Simulate press</button><button className="icon-button" aria-label={`Remove CC ${binding.cc} mapping`} onClick={() => setControls(current => ({ ...current, midiBindings: current.midiBindings.filter(item => item.id !== binding.id) }))}><Trash2 size={15}/></button></div>)}</div><p className="control-note"><CircleHelp size={14}/> Web MIDI asks browser permission only after you click Connect. No MIDI output is opened. The S88 display protocol remains unverified; this is a desktop preview, not a keyboard screen transmission.</p></div>}
      {section === "osc" && <div className="control-module"><span className="eyebrow">CONTROL ROOM / OSC</span><h2>Let a local OSC client press your buttons.</h2><p>Opt in to a loopback-only UDP listener. Send a mapped OSC address with no argument or a positive int/float. Zero and unmatched messages do nothing. A trigger opens a replacement preview. The owning tab renews a short listener lease; closing or losing that tab stops UDP within about four seconds.</p><div className="control-card osc-connection"><div><strong>{bridge?.running ? "Listening" : "Stopped"}</strong><small>{bridge?.running ? `${bridge.host}:${bridge.port}` : "No UDP listener active"}</small></div><label>UDP port<input aria-label="OSC UDP port" type="number" min="1024" max="65535" value={bridgePort} disabled={!!bridge?.running} onChange={event => setBridgePort(Number(event.target.value))}/></label><button className={bridge?.running ? "button secondary" : "button primary"} onClick={() => void toggleBridge()}>{bridge?.running ? "Stop listener" : "Start local listener"}</button></div><div className="control-card"><h3>Mapped addresses</h3>{controls.actions.map(action => <div className="osc-binding" key={action.id}><code>{action.oscPath}</code><span>{action.name}</span></div>)}{!controls.actions.length && <p>Create a route control to assign an OSC address.</p>}</div><p className="control-note"><CircleHelp size={14}/> This prototype only accepts OSC from apps on this Mac. Remote network clients require a separately reviewed listener and access design.</p></div>}
      {message && <div className="control-message" role="status">{message}</div>}
      {lastTrigger && <div className="control-last">Last input: {lastTrigger}</div>}
    </div>
    <aside className="control-inspector">
      {draft && <><span className="eyebrow">CONTROL EDITOR</span><h3>{controls.actions.some(item => item.id === draft.id) ? "Edit route control" : "New route control"}</h3><label>Button name<input aria-label="Button name" value={draft.name} maxLength={60} placeholder="Piano → Peak" onChange={event => setDraft({ ...draft, name: event.target.value })}/></label><label>Source<select aria-label="Quick route source" value={draft.source} onChange={event => setDraft({ ...draft, source: Number(event.target.value) })}><option value="0">Choose input</option>{sources.map(port => <option key={port.id} value={port.id}>{port.input_name} · {port.hardware}</option>)}</select></label><label>Instrument profile<select aria-label="Instrument profile" value={draft.profileId ?? ""} onChange={event => { const linked = controls.profiles.find(item => item.id === event.target.value); setDraft({ ...draft, profileId: linked?.id, target: linked?.destination || draft.target }); }}><option value="">None</option>{controls.profiles.filter(item => item.destination).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Destination<select aria-label="Quick route destination" value={draft.target} onChange={event => setDraft({ ...draft, target: Number(event.target.value), profileId: undefined })}><option value="0">Choose output</option>{destinations.map(port => <option key={port.id} value={port.id}>{port.output_name} · {port.hardware}</option>)}</select></label><label>Replacement rule<select aria-label="Replacement rule" value={draft.policy} onChange={event => setDraft({ ...draft, policy: event.target.value as RouteAction["policy"] })}><option value="destination">Destination incoming routes</option><option value="both">Destination + source routes</option></select></label><p className="inspector-explain">Destination mode removes other inputs to this synth. Both ends also removes this source’s other outputs. Unrelated routes remain.</p><label>OSC address<input aria-label="OSC address for action" value={draft.oscPath} maxLength={96} onChange={event => setDraft({ ...draft, oscPath: event.target.value })}/></label><div className="color-picker" aria-label="Button color">{colors.map(color => <button aria-label={`${color} color`} aria-pressed={draft.color === color} className={color} key={color} onClick={() => setDraft({ ...draft, color })}/>)}</div><button className="button primary full-width" onClick={saveAction}><Check size={15}/> Save control</button><button className="button secondary full-width" onClick={() => setDraft(null)}>Cancel</button>{controls.actions.some(item => item.id === draft.id) && <button className="button danger full-width" onClick={() => removeAction(draft.id)}>Delete control</button>}</>}
      {!draft && preview && <><span className="eyebrow">ROUTE PREVIEW</span><h3>{preview.action.name}</h3><p className="inspector-explain">This action changes only your local draft. It will not send MIDI or write the mioXL.</p><div className="preview-route"><b>Keep</b><span>{endpointName(`in-${preview.action.source}`, scene.nodes, snapshot)}</span><ArrowRight size={14}/><span>{endpointName(`out-${preview.action.target}`, scene.nodes, snapshot)}</span></div><h4>Replace {preview.removals.length} route{preview.removals.length === 1 ? "" : "s"}</h4>{preview.removals.map(route => <div className="preview-removal" key={route.id}>{endpointName(route.source, scene.nodes, snapshot)} <ArrowRight size={12}/> {endpointName(route.target, scene.nodes, snapshot)}</div>)}{!preview.removals.length && <p className="inspector-explain">No existing route needs removal.</p>}<p className="inspector-explain">Held notes are not cleared by a route draft. Release keys before any later hardware apply.</p><div className="held-rehearsal"><b>Held-note rehearsal · simulated only</b><button className="button secondary" onClick={() => simulateHeldNote(preview, 100)}>Hold C4</button><button className="button secondary" onClick={() => simulateHeldNote(preview, 0)}>Release C4</button><button className="button secondary" onClick={() => setNoteMessage(disconnectedSource(heldNotes, preview.action.source) ?? "No simulated note remains on this source.")}>Simulate source loss</button>{noteMessage && <small role="status">{noteMessage}</small>}</div><button className="button primary full-width" onClick={() => { try { const latest = planQuickRoute(sceneRef.current, preview.action); if (latest.fingerprint !== preview.fingerprint) { setPreview(latest); setMessage("Routing changed. Review the updated replacement list."); return; } setMessage(onStage(latest)); setSelectedProfile(latest.action.profileId ?? null); setPreview(null); } catch (error) { setMessage(error instanceof Error ? error.message : "Route changed."); } }}>Stage replacement draft</button><button className="button secondary full-width" onClick={() => { setDraft({ ...preview.action }); setPreview(null); }}>Edit control</button></>}
      {!draft && !preview && profile && <><span className="eyebrow">INSTRUMENT VIEW</span><h3>{profile.name}</h3><p className="inspector-explain">Initial parameter values are unknown. Moving a slider creates a simulated value and byte trace; it does not read or send MIDI.</p><label>mioXL output<select aria-label="Instrument output" value={profile.destination} onChange={event => { const destination = Number(event.target.value); if (controls.actions.some(action => action.profileId === profile.id && action.target !== destination)) { setMessage("Edit linked route controls before changing this output."); return; } updateProfile({ ...profile, destination }); }}><option value="0">Not assigned</option>{destinations.map(port => <option key={port.id} value={port.id}>{port.output_name} · {port.hardware}</option>)}</select></label><div className="instrument-parameters">{profile.parameters.map(parameter => <label key={parameter.id}>{parameter.name}<small>{parameter.nrpn ? `NRPN ${parameter.nrpn.join(":")}` : `CC ${parameter.cc}`} · Ch {parameter.channel} · {parameter.value === null ? "unknown" : `simulated ${parameter.value}`}</small><input type="range" min="0" max="127" value={parameter.value ?? 0} onChange={event => simulateParameter(profile, parameter, Number(event.target.value))}/></label>)}</div>{trace.length > 0 && <div className="midi-trace"><h4>Simulated MIDI byte events · not sent</h4>{trace.map((item, index) => <code key={`${index}:${item}`}>{item}</code>)}</div>}<p className="inspector-explain">Peak cutoff is omitted here pending paired CC 29/61 encoding validation. The KONTROL S88 MK3 framebuffer transport is unverified and disabled.</p></>}
      {!draft && !preview && !profile && <div className="control-inspector-empty"><SlidersHorizontal size={27}/><h3>Design the way you play.</h3><p>Pick a route control to preview its exact replacement, or select an instrument to view its controls.</p></div>}
    </aside>
  </div>;
}
