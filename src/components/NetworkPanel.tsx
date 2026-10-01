import { useState } from "react";
import { Network, RefreshCw, Radio, ArrowUpRight } from "lucide-react";
import { Modal } from "./Modal";
import { deviceRequest, type NetworkInventory } from "../lib/device";

export function NetworkPanel({ onClose }: { onClose: () => void }) {
  const [result, setResult] = useState<NetworkInventory | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [address, setAddress] = useState("");
  async function discover() {
    setBusy(true); setError("");
    try { setResult(await deviceRequest<NetworkInventory>("discover", { address: address.trim() || undefined })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Discovery failed."); }
    finally { setBusy(false); }
  }
  return <Modal title="Your connected studio." onClose={busy ? () => {} : onClose}>
    <p className="modal-intro">Discover MIDI and audio equipment. Read a MOTU AVB interface to explore its available mixer controls.</p>
    <form className="network-search" onSubmit={event => { event.preventDefault(); void discover(); }}>
      <label className="modal-field">MOTU IP address <span className="muted">Optional</span>
        <input aria-label="MOTU IP address" value={address} onChange={event => setAddress(event.target.value)} placeholder="192.168.1.…" maxLength={15} pattern="[0-9.]+" />
      </label>
      <button className="button primary" disabled={busy}><RefreshCw size={15} className={busy ? "spin" : ""} />{busy ? "Discovering…" : "Scan network"}</button>
    </form>
    {error ? <p className="device-error" role="alert">{error}</p> : null}
    {result ? <>
      <div className="network-summary"><span>{result.services.length} services found</span><span>{result.motu.length} MOTU interfaces</span><span>Read only</span></div>
      <div className="network-devices">
        {result.switches?.map(device => <article className="network-device" key={device.mac}>
          <Network size={24} /><div><strong>{device.name}</strong><p>MOTU AVB switch · {device.address}</p><span>Firmware {device.firmware} · {device.avbPorts.filter(Boolean).length} AVB ports enabled</span>
            <p className="field-hint">Network infrastructure · no MIDI or mixer controls</p>
            <a href={`http://${device.address}/`} target="_blank" rel="noreferrer">Open switch interface <ArrowUpRight size={12} /></a></div>
        </article>)}
        {result.motu.map(device => <article className="network-device motu-device" key={device.uid}>
          <Radio size={24} /><div><strong>{device.name}</strong><p>MOTU {device.model} · {device.address}</p><span>{device.parameterCount} parameters · {device.controlCount} mixer controls</span>
          <details><summary>Explore mixer controls</summary><div className="control-list">{device.controls.map(control => <div key={control.path}><code>{control.path}</code><span>{control.value}</span></div>)}</div></details>
          <a href={`http://${device.address}/`} target="_blank" rel="noreferrer">Open device interface <ArrowUpRight size={12} /></a></div>
        </article>)}
        {result.services.map(device => <article className="network-device" key={`${device.address}-${device.service}-${device.name}`}>
          <Network size={22} /><div><strong>{device.name}</strong><p>{device.manufacturer ? `${device.manufacturer} · ` : ""}{device.address}:{device.port}</p><span>{device.service === "_apple-midi._udp" ? "RTP-MIDI" : device.service === "_netaudio-cmc._udp" ? "Dante control discovery" : device.service}</span></div>
        </article>)}
      </div>
      {!result.motu.length ? <div className="review-notice">No MOTU AVB API confirmed. If your interface is on another subnet or does not advertise Bonjour, enter its local IP address above.</div> : null}
      {address && result.checks.some(check => check.address === address) ? <p className="device-error" role="alert">{result.checks.find(check => check.address === address)?.error}</p> : null}
      <p className="modal-note">Scanned {new Date(result.at).toLocaleTimeString()}. {result.scope}.</p>
    </> : <div className="network-empty"><Network size={36} /><h3>Bring the rest of your studio into view.</h3><p>Discover equipment, confirm its identity, and explore the controls it exposes.</p></div>}
    <p className="modal-note">MIDI-to-MOTU control is the next integration: map a controller to a supported fader, mute, or pan parameter. Discovery reads device settings without changing the mix.</p>
  </Modal>;
}
