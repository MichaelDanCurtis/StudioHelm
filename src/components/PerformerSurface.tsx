import { useState } from "react";
import { captureFor, endpointName, type Scene } from "../lib/studio";
import { planQuickRoute, readControls, type QuickRoutePlan } from "../lib/controls";

export function PerformerSurface({ scene, onEdit, onStage }: { scene: Scene; onEdit: () => void; onStage: (plan: QuickRoutePlan) => string }) {
  const [loaded] = useState(readControls);
  const [preview, setPreview] = useState<QuickRoutePlan | null>(null);
  const [message, setMessage] = useState(loaded.warning ?? "");
  const controls = loaded.controls;
  const snapshot = captureFor(scene);
  return <section className="performer-surface">
    <div className="performer-head"><div><span className="gear-kicker">PERFORMER · LOCAL SURFACE</span><h2>Just the controls you need.</h2><p>Choose a saved control to review its routing effect. No physical cable, MIDI, OSC, or hardware command is sent by this preview.</p></div><button className="button secondary" onClick={onEdit}>← Return to Producer editor</button></div>
    {controls.panels.map(panel => <section className="performer-panel" key={panel.id}><div className="performer-panel-head"><h3>{panel.name}</h3><span>{panel.actionIds.length} control{panel.actionIds.length === 1 ? "" : "s"}</span></div><p>{panel.description}</p><div className="performer-action-grid">{panel.actionIds.map(id => { const action = controls.actions.find(item => item.id === id); return action && <button key={id} onClick={() => { try { setPreview(planQuickRoute(scene, action)); setMessage(""); } catch (error) { setPreview(null); setMessage(error instanceof Error ? error.message : "This control cannot be previewed."); } }}><strong>{action.name}</strong><small>{endpointName(`in-${action.source}`, scene.nodes, snapshot)} → {endpointName(`out-${action.target}`, scene.nodes, snapshot)}</small><em>Preview action →</em></button>; })}{!panel.actionIds.length && <div className="performer-empty">This panel has no controls yet. Add one in Producer.</div>}</div></section>)}
    {preview && <div className="performer-preview"><strong>Review · {preview.action.name}</strong><p>{preview.removals.length} existing route{preview.removals.length === 1 ? "" : "s"} would be removed; {preview.addition ? "one route would be added" : "the route is already present"}.</p>{preview.removals.map(route => <small key={route.id}>{endpointName(route.source, scene.nodes, snapshot)} → {endpointName(route.target, scene.nodes, snapshot)}</small>)}<div><button className="button primary" onClick={() => { try { setMessage(onStage(preview)); setPreview(null); } catch (error) { setMessage(error instanceof Error ? error.message : "Review this action again."); setPreview(null); } }}>Stage local draft</button><button className="button subtle" onClick={() => setPreview(null)}>Cancel</button></div></div>}
    <div className="performer-status"><span>OSC · no listener started by this screen</span><span>{snapshot.revision ? "Configured mioXL read" : "Synthetic demo baseline"}</span></div>
    {message && <p className="gear-message" role="status">{message}</p>}
  </section>;
}
