# MioXLplus Studio

A visual MIDI patchbay built with React, TypeScript, Vite, and React Flow. Its checked-in offline starting point is a **synthetic demo**, not a captured device configuration. The optional local adapter can read a configured mioXL; hardware changes require a separate explicit review and apply action.

## Run locally

```sh
npm ci
npm run dev
```

Open [MioXLplus Studio](http://127.0.0.1:5186). The development server binds to localhost and uses port 5186 exclusively. Fonts are bundled locally. Python 3 is required for optional device access. To enable a live read, set `MIOXLPLUS_DEVICE_HOST` and `MIOXLPLUS_DEVICE_SERIAL` in your local shell for the intended mioXL before starting Vite. Neither value is checked in. Without both values, the device adapter refuses to open a session. The offline demo never supplies a hardware identity.

## Available now

- Optional live device reads on opening, a Refresh button, and optional 30-second configuration polling when a device is configured.
- Timestamped device state, with draft preservation and detection of external routing changes.
- Review-and-apply for direct preset routes, including a recovery journal, stale-state checks, acknowledgements and read-back.
- A network inventory panel for RTP-MIDI, Dante discovery, MOTU AVB switches and MOTU AVB mixer API inspection.
- A modular **Control room** with named panels, one-touch route actions, a Novation Peak instrument profile, simulated eight-control surface preview, keyboard CC bindings and an opt-in local OSC bridge.
- A shared workspace sidebar and centered **Workflow** navigation for Canvas, Routes, and Control room, plus a manually entered gear inventory and physical MIDI DIN wiring map.

- Custom source, destination, and processor cards on a pan/zoom canvas.
- Drag connections between compatible handles, or use the inspector's connection form.
- Search the 61 synthetic demo ports and click or drag them onto the canvas; a configured live read supplies device ports.
- Inspect 88 synthetic demo routes in the searchable Routes view, or device routes after a live read.
- Stage route additions and removals, review differences, undo/redo, arrange nodes, and use the minimap.
- Create and edit channel-remap, MIDI-to-OSC, and OSC-destination blocks.
- Automatically save the current scene in local browser storage; rename and export a portable JSON scene.
- Use collapsible panels on small screens, keyboard shortcuts, and reduced-motion preferences.

The default canvas shows five ports and four synthetic demo routes as a focused starting view. Solid paths represent the current baseline, either demo or a verified device read; dashed paths represent new local connections. Removing a node from the canvas hides that endpoint and removes draft connections attached to it; a live hardware route is retained unless a connection is explicitly removed.

## Gear inventory and workflow

### Integrated workflow concept

Open [`mockups/studio-system.html`](mockups/studio-system.html) locally to review **StudioHelm** (working title), a separate, interactive concept for a centralized studio controller with mioXL as one integration. **Sound engineer** sets up equipment and physical wiring, **Producer** designs named instrument interactions and a panel, and **Performer** sees a simple surface with an obvious return to editing. Its neutral industrial styling uses blue signal accents, dot-matrix headings, and a glass highlight on the selected device. It is a mockup only; its catalog choices, cables, Ableton relationship, OSC addresses, and performer controls do not save state or operate devices. Dashed cables are hypothetical. The Akai MPC X name is user confirmed, while its ports and control profile still need verification. This concept is not yet integrated into the running app.

The wordmark identifies the app; the centered **Workflow** choices switch between Canvas, Routes, and Control room. The same left workspace sidebar remains available in each view. Open **wiring map** there to name instruments, their MIDI IN/OUT endpoints, and each physical DIN connection. Instrument MIDI OUT connects to a mioXL DIN input; a mioXL DIN output connects to instrument MIDI IN. No Moog One, Peak, or other physical connection is inferred from demo or device port names. The inventory starts empty and saves separately under `mioxlplus.gear.v1`, preserving existing numeric route drafts and Control room mappings.

Named gear routes resolve through those explicit physical connections. Missing wires, multiple wires on one endpoint, and shared DIN sides are shown as blockers. A resolved route opens an exact replacement preview before **Stage local draft** changes browser state; it does not write the mioXL. The manufacturer profile catalog currently includes the published Novation Peak parameter map as a manually selectable profile. Unit channel and wiring remain separate. Device identity, MIDI-CI Property Exchange, and MIDI learn have schema space but no active query or learning operation. Audio inventory is a separate reserved type; MOTU control and audio routing remain deferred.

## Control room and safe rehearsal

Open **Control room** to create panels and route controls. Each control names a mioXL input and output and previews the exact routes it would replace. The default rule removes other incoming routes to the chosen destination; **Destination + source routes** also removes that source's other outputs. Unrelated routes stay intact. Global routes cannot be replaced. Clicking **Stage replacement draft** changes only the saved browser draft. OSC and keyboard triggers select the same action and open its current replacement preview. You must click **Stage replacement draft** after reviewing it; no trigger applies a hardware preset.

The seeded **Novation Peak** profile has no assigned mioXL output. Select the actual output before linking a route control. Its resonance, overdrive, amp envelope and Mod Env 1 attack controls use published single-CC numbers. Oscillator 1 saw density uses the documented NRPN 0:17 sequence (CC 99, 98, 6). Initial values are **unknown**; moving a slider saves a **simulated browser value** and shows the encoded byte event. The encoder never opens a MIDI output or sends bytes. CC 38 is deliberately absent. Cutoff is omitted because the paired CC 29/61 value encoding still needs verification. The eight-control page and exported 960×240 PNG are illustrative. S88 MK3 display transport is unverified and disabled; this app does not send an image to the keyboard.

**Keyboard input** asks for Web MIDI input permission only when you click Connect. Choose an input and map an explicit channel and CC to a saved route control. The default is S88 MK3 MIDI Mode button 1 (channel 1, CC 112) in toggle mode, per NI’s MIDI Mode documentation: each distinct high or low state can open a preview, subject to a 500 ms guard. Momentary rising-edge mode is also available and consumes even cooldown-suppressed presses until release. Musical note messages are ignored. The Simulate press button exercises this path without opening a device. The held-note rehearsal models C4 fanout across every current route from the source. A release remains addressed to each original simulated output across route changes; unaffected held routes remain tracked, and source loss reports unresolved releases. It cannot establish physical silence. No note-off or panic messages are sent; release held keys before any later hardware routing apply.

**OSC bridge** starts only when you click Start local listener. It binds UDP to `127.0.0.1` (default port 9001), accepts mapped OSC addresses with no argument or one positive integer/float, and ignores unmapped/zero messages. The owning browser tab alone can change active bindings or read events and renews a three-second lease while polling. A closed, reloaded, or disconnected tab causes the loopback UDP listener to close within about four seconds. Remote clients and hardware execution are not enabled. Panel definitions are saved in this browser; the bridge's event queue and active binding list are memory-only. Stopping the app also closes its listener.

This layout shares the existing `cr-s88` semantic `SurfaceFrame` shape (bank, module, page, eight labels/values). The independent Control Room project remains unchanged. Its S88 MK3 USB display protocol has no verified render path; physical captures, protocol decoding, and a safe activation sequence are required before a native screen image can be sent.

## Device operations

Open **Review draft → Review hardware changes → Apply to mioXL** to apply direct port routes. Apply affects the running preset immediately; saving it to flash is not implemented. Host blocks stay in the draft. Global routes cannot be edited here. Read-before-write checks stop stale reviews, and failed writes trigger conditional routing recovery.

Successful physical device reads and hardware preflight are verified. **The write/recovery flow is implemented and tested with a simulated device; a physical routing write has not been exercised.** Local recovery records are in `.runtime/backups/`; these are routing records, not complete hardware backups. Other configuration editors can still race a multi-row operation; a forced process exit or lost device connection may require manual recovery.

The **Network** panel can perform an explicit local read-only discovery when enabled. Enter a local MOTU address to inspect supported controls. Mixer changes and live MIDI-to-MOTU mappings are not running yet. No captured local addresses or identities are included in the repository-ready source.

MIDIMonster runtime supervision, performance MIDI handling, complete preset backups, flash persistence, multi-mioXL editing and scene import remain future work. The graph's cycle checks cover modelled paths, not unknown physical cable loops.

Captured device evidence is kept locally and excluded from the repository-ready source.

## Verification

```sh
npm run build
npx playwright install chromium
npm test
python3 -m unittest server.test_device -v
```

Browser tests launch a fresh server with the device adapter disabled; mocked device calls cannot reach hardware, including from extra browser tabs. Adapter write tests use a simulated device. The source build uses `src/data/demo-inventory.json` and does not depend on captured local research files. For a no-screenshot browser run, exclude the two existing visual export tests with `npx playwright test --grep-invert 'panel edits, previews|control surface fits'`.

Generated test results, screenshots, hardware preflight records, and private research inputs stay in ignored local directories.

## Project structure

- `src/App.tsx`: canvas state, history, views, local persistence, scene dialogs.
- `src/components/`: custom nodes and edges, port library, inspector, dialogs.
- `server/`: local Vite API, bounded TNG adapter, network discovery, route recovery tests.
- `src/lib/studio.ts`: snapshot model, route validation, graph operations, stored-scene validation.
- `src/styles.css`: visual system and responsive layouts.
- `tests/studio.spec.ts`: browser journeys and graph integrity checks.
- `src/data/demo-inventory.json`: explicitly synthetic offline fixture.
- `mockups/`: interactive StudioHelm interface concept, separate from the running app.

## Background

Local research and captured device evidence are not part of the repository-ready source. React Flow integration follows its [custom-node](https://reactflow.dev/learn/customization/custom-nodes), [handle](https://reactflow.dev/learn/customization/handles), and [connection-validation](https://reactflow.dev/examples/interaction/validation) documentation.
