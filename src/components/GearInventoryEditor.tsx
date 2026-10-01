import { useState } from "react";
import { captureFor, endpointName, type Scene } from "../lib/studio";
import { planQuickRoute, type QuickRoutePlan, type RouteAction } from "../lib/controls";
import { PROFILE_CATALOG, resolveEndpoint, resolveNamedRoute,
  type GearInventory, type GearUnit, type MidiEndpoint, type NamedRoute } from "../lib/gear-inventory";

type Props = { inventory: GearInventory; scene: Scene; onChange: (next: GearInventory) => void; onStage: (plan: QuickRoutePlan) => string };
export function GearInventoryEditor({ inventory, scene, onChange, onStage }: Props) {
  const [unitName, setUnitName] = useState("");
  const [wireEndpoint, setWireEndpoint] = useState("");
  const [wirePort, setWirePort] = useState(0);
  const [routeName, setRouteName] = useState("");
  const [sourceEndpoint, setSourceEndpoint] = useState("");
  const [targetEndpoint, setTargetEndpoint] = useState("");
  const [preview, setPreview] = useState<QuickRoutePlan | null>(null);
  const [message, setMessage] = useState("");
  const endpoints = inventory.units.flatMap(unit => unit.endpoints.map(endpoint => ({ ...endpoint, unit })));
  const selectedWireEndpoint = endpoints.find(item => item.id === wireEndpoint);
  const dinPorts = captureFor(scene).ports.filter(port => /^DIN \d+$/.test(port.hardware));
  const wirePorts = dinPorts.filter(port => selectedWireEndpoint?.direction === "out" ? port.supports_input : port.supports_output);
  const label = (id: string) => {
    const endpoint = endpoints.find(item => item.id === id);
    return endpoint ? `${endpoint.unit.name} ${endpoint.name}` : "Missing endpoint";
  };
  const updateUnit = (id: string, update: (unit: GearUnit) => GearUnit) => onChange({ ...inventory,
    units: inventory.units.map(unit => unit.id === id ? update(unit) : unit) });
  function addUnit() {
    const name = unitName.trim();
    if (!name) return setMessage("Name the instrument before adding it.");
    const unit: GearUnit = { id: crypto.randomUUID(), name, midiChannel: null, profileId: null, controlBindings: [],
      profileSource: "manual", profileEvidence: null, endpoints: [
        { id: crypto.randomUUID(), name: "MIDI OUT", direction: "out" },
        { id: crypto.randomUUID(), name: "MIDI IN", direction: "in" },
      ] };
    onChange({ ...inventory, units: [...inventory.units, unit] }); setUnitName(""); setMessage("Instrument added without assumed wiring.");
  }
  function deleteUnit(unit: GearUnit) {
    const ids = new Set(unit.endpoints.map(endpoint => endpoint.id));
    onChange({ ...inventory, units: inventory.units.filter(item => item.id !== unit.id),
      wires: inventory.wires.filter(wire => !ids.has(wire.endpointId)),
      routes: inventory.routes.filter(route => !ids.has(route.sourceEndpointId) && !ids.has(route.targetEndpointId)) });
    setPreview(null);
  }
  function deleteEndpoint(unit: GearUnit, endpoint: MidiEndpoint) {
    onChange({ ...inventory, units: inventory.units.map(item => item.id === unit.id ?
      { ...item, endpoints: item.endpoints.filter(entry => entry.id !== endpoint.id) } : item),
      wires: inventory.wires.filter(wire => wire.endpointId !== endpoint.id),
      routes: inventory.routes.filter(route => route.sourceEndpointId !== endpoint.id && route.targetEndpointId !== endpoint.id) });
    setPreview(null);
  }
  function addWire() {
    if (!wireEndpoint || !wirePort || !wirePorts.some(port => port.id === wirePort)) return setMessage("Choose a gear endpoint and compatible mioXL DIN side.");
    onChange({ ...inventory, wires: [...inventory.wires, { id: crypto.randomUUID(), endpointId: wireEndpoint, mioPort: wirePort }] });
    setWirePort(0); setMessage("Physical connection recorded as your manual entry, not device discovery.");
  }
  function addRoute() {
    const name = routeName.trim();
    if (!name || !sourceEndpoint || !targetEndpoint) return setMessage("Name the route and choose a gear MIDI OUT and MIDI IN.");
    const route: NamedRoute = { id: crypto.randomUUID(), name, sourceEndpointId: sourceEndpoint,
      targetEndpointId: targetEndpoint, policy: "destination" };
    onChange({ ...inventory, routes: [...inventory.routes, route] }); setRouteName("");
    setMessage("Named route saved locally. Its physical ports must resolve before preview.");
  }
  function routeAction(route: NamedRoute): RouteAction | null {
    const resolved = resolveNamedRoute(inventory, scene, route);
    if (resolved.issues.length || !resolved.source || !resolved.target) { setMessage(resolved.issues.join(" ")); return null; }
    return { id: route.id, name: route.name, source: resolved.source, target: resolved.target,
      policy: route.policy, oscPath: `/mioxlplus/gear/${route.id}`, color: "blue" };
  }
  return <div className="gear-editor">
    <p className="modal-intro">Record what is physically plugged in, then name the routes you want. DIN wiring is entered by you; device port names alone do not prove a connection. No hardware command is sent here.</p>
    <section className="gear-section"><h3>Instruments <span>{inventory.units.length}</span></h3>
      {inventory.units.map(unit => <div className="gear-unit" key={unit.id}>
        <div className="gear-unit-head"><label>Instrument name<input aria-label={`Name ${unit.name}`} value={unit.name} maxLength={80} onChange={event => updateUnit(unit.id, current => ({ ...current, name: event.target.value }))}/></label><button className="button subtle" onClick={() => deleteUnit(unit)}>Remove</button></div>
        <div className="gear-unit-settings"><label>Parameter profile<select aria-label={`Profile for ${unit.name}`} value={unit.profileId ?? ""} onChange={event => updateUnit(unit.id, current => ({ ...current, profileId: event.target.value || null, profileSource: "manual", profileEvidence: null }))}><option value="">Unspecified</option>{PROFILE_CATALOG.map(profile => <option key={profile.id} value={profile.id}>{profile.manufacturer} {profile.name}</option>)}</select></label><label>MIDI channel<select aria-label={`MIDI channel for ${unit.name}`} value={unit.midiChannel ?? ""} onChange={event => updateUnit(unit.id, current => ({ ...current, midiChannel: event.target.value ? Number(event.target.value) : null }))}><option value="">Unknown</option>{Array.from({ length: 16 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}</select></label></div>
        <small className="gear-evidence">Profile choice is manual. Identity discovery, MIDI-CI Property Exchange and control MIDI learn have not been run.</small>
        {unit.endpoints.map(endpoint => { const status = resolveEndpoint(inventory, scene, endpoint.id); return <div className="gear-endpoint" key={endpoint.id}><span>{endpoint.direction === "out" ? "Instrument OUT → mioXL IN" : "mioXL OUT → instrument IN"}</span><input aria-label={`Endpoint ${unit.name} ${endpoint.name}`} value={endpoint.name} maxLength={80} onChange={event => updateUnit(unit.id, current => ({ ...current, endpoints: current.endpoints.map(item => item.id === endpoint.id ? { ...item, name: event.target.value } : item) }))}/><small>{status.port ? `DIN ${status.port} · ${endpoint.direction === "out" ? "mioXL input" : "mioXL output"}` : status.issues.join(" ")}</small><button className="icon-button" aria-label={`Remove endpoint ${unit.name} ${endpoint.name}`} onClick={() => deleteEndpoint(unit, endpoint)}>×</button></div>; })}
        <div className="gear-inline-actions"><button className="button subtle" onClick={() => updateUnit(unit.id, current => ({ ...current, endpoints: [...current.endpoints, { id: crypto.randomUUID(), name: "MIDI OUT", direction: "out" }] }))}>Add MIDI OUT</button><button className="button subtle" onClick={() => updateUnit(unit.id, current => ({ ...current, endpoints: [...current.endpoints, { id: crypto.randomUUID(), name: "MIDI IN", direction: "in" }] }))}>Add MIDI IN</button></div>
      </div>)}
      <div className="gear-form"><label>New instrument<input aria-label="New instrument" placeholder="e.g. Moog One" value={unitName} maxLength={80} onChange={event => setUnitName(event.target.value)}/></label><button className="button primary" onClick={addUnit}>Add instrument</button></div>
    </section>
    <section className="gear-section"><h3>Physical DIN connections <span>{inventory.wires.length}</span></h3><p>OUT and IN are relative to the instrument. DIN numbers refer to the matching side of the mioXL.</p>
      {inventory.wires.map(wire => { const endpoint = endpoints.find(item => item.id === wire.endpointId); return <div className="gear-wire" key={wire.id}><span>{label(wire.endpointId)} {endpoint?.direction === "out" ? "→ mioXL DIN input" : "← mioXL DIN output"} {wire.mioPort}</span><button className="button subtle" onClick={() => onChange({ ...inventory, wires: inventory.wires.filter(item => item.id !== wire.id) })}>Remove</button></div>; })}
      <div className="gear-form"><label>Gear endpoint<select aria-label="Wire gear endpoint" value={wireEndpoint} onChange={event => { setWireEndpoint(event.target.value); setWirePort(0); }}><option value="">Choose endpoint</option>{endpoints.map(endpoint => <option key={endpoint.id} value={endpoint.id}>{endpoint.unit.name} {endpoint.name} ({endpoint.direction === "out" ? "OUT" : "IN"})</option>)}</select></label><label>mioXL DIN side<select aria-label="Wire mioXL DIN side" value={wirePort} onChange={event => setWirePort(Number(event.target.value))}><option value={0}>Choose DIN port</option>{wirePorts.map(port => <option key={port.id} value={port.id}>{port.hardware} {selectedWireEndpoint?.direction === "out" ? "IN" : "OUT"}</option>)}</select></label><button className="button primary" onClick={addWire}>Add connection</button></div>
    </section>
    <section className="gear-section"><h3>Named MIDI routes <span>{inventory.routes.length}</span></h3><p>Routes resolve from the physical map. Missing, ambiguous and conflicting wires block staging.</p>
      {inventory.routes.map(route => { const resolved = resolveNamedRoute(inventory, scene, route); return <div className="gear-route" key={route.id}><strong>{route.name}</strong><span>{label(route.sourceEndpointId)} → {label(route.targetEndpointId)}</span><small>{resolved.issues.length ? resolved.issues.join(" ") : `${endpointName(`in-${resolved.source}`, scene.nodes, captureFor(scene))} → ${endpointName(`out-${resolved.target}`, scene.nodes, captureFor(scene))}`}</small><select aria-label={`Replacement scope for ${route.name}`} value={route.policy} onChange={event => onChange({ ...inventory, routes: inventory.routes.map(item => item.id === route.id ? { ...item, policy: event.target.value as NamedRoute["policy"] } : item) })}><option value="destination">Replace destination incoming routes</option><option value="both">Replace destination and source routes</option></select><div><button className="button secondary" disabled={!!resolved.issues.length} onClick={() => { try { const action = routeAction(route); if (action) setPreview(planQuickRoute(scene, action)); } catch (error) { setMessage(error instanceof Error ? error.message : "Cannot preview route."); } }}>Preview</button><button className="button subtle" onClick={() => { onChange({ ...inventory, routes: inventory.routes.filter(item => item.id !== route.id) }); setPreview(null); }}>Remove</button></div></div>; })}
      <div className="gear-form"><label>Route name<input aria-label="Named route" value={routeName} maxLength={80} onChange={event => setRouteName(event.target.value)}/></label><label>From instrument OUT<select aria-label="Named route source" value={sourceEndpoint} onChange={event => setSourceEndpoint(event.target.value)}><option value="">Choose OUT</option>{endpoints.filter(item => item.direction === "out").map(item => <option key={item.id} value={item.id}>{item.unit.name} {item.name}</option>)}</select></label><label>To instrument IN<select aria-label="Named route destination" value={targetEndpoint} onChange={event => setTargetEndpoint(event.target.value)}><option value="">Choose IN</option>{endpoints.filter(item => item.direction === "in").map(item => <option key={item.id} value={item.id}>{item.unit.name} {item.name}</option>)}</select></label><button className="button primary" onClick={addRoute}>Add named route</button></div>
      {preview && <div className="gear-preview"><strong>Local replacement preview · {preview.action.name}</strong><p>{preview.removals.length} existing route{preview.removals.length === 1 ? "" : "s"} would be removed; {preview.addition ? "one route would be added" : "the requested route is already present"}.</p>{preview.removals.map(route => <small key={route.id}>{endpointName(route.source, scene.nodes, captureFor(scene))} → {endpointName(route.target, scene.nodes, captureFor(scene))}</small>)}<button className="button primary" onClick={() => { try { const route = inventory.routes.find(item => item.id === preview.action.id); const action = route && routeAction(route); if (!action) return; const latest = planQuickRoute(scene, action); if (latest.fingerprint !== preview.fingerprint || latest.action.source !== preview.action.source || latest.action.target !== preview.action.target || latest.action.policy !== preview.action.policy) { setPreview(latest); return setMessage("Wiring or routing changed. Review the updated replacement list."); } setMessage(onStage(latest)); setPreview(null); } catch (error) { setMessage(error instanceof Error ? error.message : "Could not stage route."); } }}>Stage local draft</button></div>}
    </section>
    <p className="gear-evidence">Audio equipment and links are reserved as a separate inventory type. MOTU control and audio routing are not active here.</p>
    {message && <p className="gear-message" role="status">{message}</p>}
  </div>;
}
