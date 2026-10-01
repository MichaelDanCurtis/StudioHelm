import { test, expect, type Page } from "@playwright/test";
import { createSocket } from "node:dgram";
import { readFile } from "node:fs/promises";
import { CONTROLS_KEY, parseControls, planQuickRoute, emptyControls, type RouteAction } from "../src/lib/controls";
import { encodePeakParameter, formatMidiBytes } from "../src/lib/peak-midi";
import { transitionNote, transitionRoute, disconnectedSource } from "../src/lib/note-transition";
import { midiPressEdge, midiToggleEdge } from "../src/lib/midi-trigger";
import { surfaceFrame } from "../src/lib/surface";
import { activeRoutes, initialScene, STORAGE_KEY } from "../src/lib/studio";

test.describe.configure({ mode: "serial" });

const action: RouteAction = { id: "piano-peak", name: "Piano to Peak", source: 2, target: 13,
  policy: "destination", oscPath: "/mioxlplus/route/piano-peak", color: "sage" };

test("quick route replaces destination inputs and preserves unrelated routes", () => {
  const before = initialScene();
  const plan = planQuickRoute(before, action);
  expect(plan.removals.map(route => route.id)).toEqual(["in-1__out-13"]);
  expect(plan.addition?.id).toBe("in-2__out-13");
  expect(activeRoutes(plan.next).some(route => route.id === "in-1__out-14")).toBe(true);
  expect(activeRoutes(plan.next).filter(route => route.target === "out-13").map(route => route.source)).toEqual(["in-2"]);
  expect(planQuickRoute(plan.next, action).removals).toEqual([]);
  expect(planQuickRoute(plan.next, action).addition).toBeNull();
  const exclusive = planQuickRoute(before, { ...action, policy: "both" });
  expect(exclusive.removals.map(route => route.id).sort()).toEqual(["in-1__out-13", "in-2__out-14", "in-2__out-40"]);
});

test.beforeEach(async ({ page }) => {
  await page.context().route("**/api/studio/**", route => route.fulfill({ status: 503, json: { error: "Offline simulation fixture" } }));
});

async function createPeakAction(page: Page) {
  await page.goto("/");
  await page.getByRole("tab", { name: "Control room" }).click();
  await page.getByRole("button", { name: /Novation Peak/ }).click();
  await page.getByRole("combobox", { name: "Instrument output" }).selectOption("13");
  await page.getByRole("button", { name: "Create first control" }).click();
  await page.getByRole("textbox", { name: "Button name" }).fill("Piano to Peak");
  await page.getByRole("combobox", { name: "Quick route source" }).selectOption("2");
  await page.getByRole("combobox", { name: "Instrument profile" }).selectOption("novation-peak");
  await page.getByRole("button", { name: "Save control" }).click();
  await expect(page.locator(".route-control")).toHaveCount(1);
}

test("centered workflow keeps workspace context and closes canvas overlays on view changes", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "Workflow" })).toBeVisible();
  const centerOffset = await page.getByRole("navigation", { name: "Workflow" }).evaluate(element => {
    const box = element.getBoundingClientRect(); return Math.abs(box.left + box.width / 2 - window.innerWidth / 2);
  });
  expect(centerOffset).toBeLessThan(12);
  await expect(page.getByRole("link", { name: "MioXLplus Studio" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Port library" })).toBeVisible();
  await page.getByRole("button", { name: "Canvas help" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("tab", { name: /Routes/ }).evaluate((element: HTMLElement) => element.click());
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".canvas-wrapper")).toBeHidden();
  await expect(page.getByRole("heading", { name: "Port library" })).toBeVisible();
  await page.getByRole("tab", { name: "Canvas", exact: true }).click();
  await expect(page.locator(".react-flow__node")).toHaveCount(5);
  await page.getByRole("button", { name: "Add block" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("tab", { name: "Control room" }).evaluate((element: HTMLElement) => element.click());
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".canvas-wrapper")).toBeHidden();
  await expect(page.getByRole("heading", { name: "Port library" })).toBeVisible();
  await page.getByRole("tab", { name: "Canvas", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Canvas", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".react-flow__node")).toHaveCount(5);
  await page.getByRole("button", { name: "Save scene", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("panel edits, previews exact replacement, stages locally, and survives reload", async ({ page }) => {
  await createPeakAction(page);
  await page.locator(".control-content").evaluate(element => { element.scrollTop = 0; });
  await page.screenshot({ path: "test-results/control-room-desktop.png", fullPage: true });
  await page.evaluate(() => {
    const original = CanvasRenderingContext2D.prototype.fillText;
    (window as unknown as { canvasLabels: string[] }).canvasLabels = [];
    CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
      (window as unknown as { canvasLabels: string[] }).canvasLabels.push(String(text));
      return original.call(this, text, ...args);
    };
  });
  const previewDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export preview PNG" }).click();
  const png = await previewDownload;
  expect(png.suggestedFilename()).toBe("novation-peak-surface-preview.png");
  const bytes = await readFile((await png.path())!);
  expect(bytes.subarray(1, 4).toString()).toBe("PNG");
  expect(bytes.readUInt32BE(16)).toBe(960);
  expect(bytes.readUInt32BE(20)).toBe(240);
  const labels = await page.evaluate(() => (window as unknown as { canvasLabels: string[] }).canvasLabels);
  expect(labels).toContain("unknown");
  expect(labels).toContain("nrpn:1:0:17");
  await page.locator(".control-content").evaluate(element => { element.scrollTop = element.scrollHeight; });
  await page.screenshot({ path: "test-results/control-room-surface.png", fullPage: true });
  await page.locator(".route-control").click();
  await expect(page.locator(".preview-removal")).toHaveCount(1);
  await expect(page.locator(".preview-removal")).toContainText("beer");
  await page.getByRole("button", { name: "Stage replacement draft" }).click();
  await expect(page.getByRole("button", { name: "Review draft 2" })).toBeVisible();
  await expect.poll(async () => (await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), STORAGE_KEY)).removals.length).toBe(1);
  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), STORAGE_KEY);
  expect(saved.removals).toEqual(["in-1__out-13"]);
  expect(saved.additions.map((route: { id: string }) => route.id)).toEqual(["in-2__out-13"]);
  expect((await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), CONTROLS_KEY)).profiles[0].destination).toBe(13);
  await page.reload();
  await page.getByRole("tab", { name: "Control room" }).click();
  await expect(page.locator(".route-control")).toHaveCount(1);
  await page.locator(".route-control").click();
  await expect(page.getByText("No existing route needs removal.")).toBeVisible();
});

test("control surface fits a narrow browser without page overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("tab", { name: "Control room" }).click();
  await expect(page.getByRole("button", { name: "Create first control" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Workflow" })).toBeVisible();
  await page.getByRole("button", { name: "Toggle port library" }).click();
  await expect(page.getByRole("heading", { name: "Port library" })).toBeVisible();
  await page.getByRole("button", { name: "Toggle port library" }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/control-room-mobile.png", fullPage: true });
});

test("keyboard adapter ignores notes and stops on disconnect", async ({ page }) => {
  await page.addInitScript(() => {
    const fake = { id: "sim-keyboard", name: "Simulated keyboard", onmidimessage: null as null | ((event: {data: Uint8Array}) => void), async close() {} };
    Object.defineProperty(navigator, "requestMIDIAccess", { configurable: true, value: async () => ({ inputs: new Map([[fake.id, fake]]) }) });
    (window as unknown as { sendTestMidi: (bytes: number[]) => void }).sendTestMidi = bytes => fake.onmidimessage?.({ data: new Uint8Array(bytes) });
  });
  await createPeakAction(page);
  await page.getByRole("button", { name: "Keyboard input" }).click();
  await page.getByRole("combobox", { name: "Route action" }).selectOption({ label: "Piano to Peak" });
  await page.getByRole("button", { name: "Add mapping" }).click();
  await page.getByRole("button", { name: "Connect MIDI input…" }).click();
  await page.getByRole("combobox", { name: "Selected keyboard" }).selectOption("sim-keyboard");
  await page.evaluate(() => (window as unknown as { sendTestMidi: (bytes: number[]) => void }).sendTestMidi([0x90, 60, 127]));
  await expect(page.getByRole("button", { name: "Review draft", exact: true })).toBeVisible();
  await page.evaluate(() => (window as unknown as { sendTestMidi: (bytes: number[]) => void }).sendTestMidi([0xb0, 112, 127]));
  await expect(page.getByRole("button", { name: "Stage replacement draft" })).toBeVisible();
  await page.getByRole("button", { name: "Keyboard input" }).click();
  await page.getByRole("combobox", { name: "Selected keyboard" }).selectOption("");
  await page.evaluate(() => (window as unknown as { sendTestMidi: (bytes: number[]) => void }).sendTestMidi([0xb0, 112, 127]));
  await expect(page.getByRole("button", { name: "Review draft", exact: true })).toBeVisible();
});

test("mapped keyboard CC simulation stages the shared action", async ({ page }) => {
  await createPeakAction(page);
  await page.getByRole("button", { name: "Keyboard input" }).click();
  await page.getByRole("spinbutton", { name: "CC number" }).fill("112");
  await page.getByRole("combobox", { name: "Route action" }).selectOption({ label: "Piano to Peak" });
  await page.getByRole("button", { name: "Add mapping" }).click();
  await page.getByRole("button", { name: "Simulate press" }).click();
  await expect(page.getByRole("button", { name: "Stage replacement draft" })).toBeVisible();
  await expect(page.getByText(/Last input: Keyboard CC/)).toBeVisible();
});

test("loopback OSC triggers a saved action and can be stopped", async ({ page, request }) => {
  await createPeakAction(page);
  const config = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), CONTROLS_KEY);
  const path = config.actions[0].oscPath as string;
  await expect.poll(async () => (await (await request.get("/api/controls/status")).json()).bindings).toBe(1);
  await page.getByRole("button", { name: "OSC bridge" }).click();
  await page.getByRole("spinbutton", { name: "OSC UDP port" }).fill("0");
  await page.getByRole("button", { name: "Start local listener" }).click();
  await expect.poll(async () => (await (await request.get("/api/controls/status")).json()).running).toBe(true);
  const { port } = await (await request.get("/api/controls/status")).json() as { port: number };
  const pad = (value: string) => { const length = Math.ceil((value.length + 1) / 4) * 4; const bytes = Buffer.alloc(length); bytes.write(value); return bytes; };
  const data = Buffer.concat([pad(path), pad(",")]);
  const zero = Buffer.concat([pad(path), pad(",i"), Buffer.alloc(4)]);
  const socket = createSocket("udp4");
  try {
    await new Promise<void>((resolve, reject) => socket.send(zero, port, "127.0.0.1", error => error ? reject(error) : resolve()));
    await expect.poll(async () => (await (await request.get("/api/controls/status")).json()).seq).toBe(0);
    await new Promise<void>((resolve, reject) => socket.send(data, port, "127.0.0.1", error => error ? reject(error) : resolve()));
    await expect(page.getByRole("button", { name: "Stage replacement draft" })).toBeVisible();
    await new Promise<void>((resolve, reject) => socket.send(data, port, "127.0.0.1", error => error ? reject(error) : resolve()));
    await expect(page.getByRole("button", { name: "Stage replacement draft" })).toBeVisible();
  } finally {
    socket.close();
    await page.getByRole("button", { name: "OSC bridge" }).click();
    await page.getByRole("button", { name: "Stop listener" }).click();
  }
});

test("control bridge refuses foreign origins and form posts", async ({ request }) => {
  const foreign = await request.post("/api/controls/start", { headers: { Origin: "https://example.com", "X-MioXLplus": "studio" }, data: { port: 0, client: "test-owner-2" } });
  expect(foreign.status()).toBe(403);
  const form = await request.post("/api/controls/start", { form: { port: "0" } });
  expect(form.status()).toBe(403);
});


test("saved mappings reject duplicate IDs", () => {
  const controls = emptyControls();
  controls.actions = [action];
  controls.midiBindings = [
    { id: "same", actionId: action.id, channel: 1, cc: 112 },
    { id: "same", actionId: action.id, channel: 1, cc: 113 },
  ];
  expect(parseControls(controls)).toBeNull();
});

test("CC press consumes a cooldown edge until the next release", () => {
  const armed = new Map<string, boolean>(), fired = new Map<string, number>();
  const press = (value: number, at: number) => midiPressEdge(armed, fired, "1:112", value, at);
  expect(press(127, 0)).toBe(true);
  expect(press(0, 100)).toBe(false);
  expect(press(127, 200)).toBe(false);
  expect(press(127, 600)).toBe(false);
  expect(press(0, 700)).toBe(false);
  expect(press(127, 800)).toBe(true);
});

test("toggle button triggers on each distinct state after cooldown", () => {
  const last = new Map<string, number>(), fired = new Map<string, number>();
  const change = (value: number, at: number) => midiToggleEdge(last, fired, "1:112", value, at);
  expect(change(0, 0)).toBe(false);
  expect(change(127, 600)).toBe(true);
  expect(change(127, 1200)).toBe(false);
  expect(change(0, 1300)).toBe(true);
  expect(change(127, 1400)).toBe(false);
  expect(change(127, 2000)).toBe(false);
  expect(change(0, 2100)).toBe(true);
});

test("Peak CC and NRPN traces are bounded and never include CC38", () => {
  const profile = emptyControls().profiles[0];
  expect(profile.parameters.every(item => item.value === null)).toBe(true);
  expect(encodePeakParameter(profile.parameters[0], 64)).toEqual([[0xb0, 79, 64]]);
  const saw = profile.parameters.find(item => item.id === "saw-density")!;
  const bytes = encodePeakParameter(saw, 99);
  expect(bytes).toEqual([[0xb0, 99, 0], [0xb0, 98, 17], [0xb0, 6, 99]]);
  expect(bytes.some(item => item[1] === 38)).toBe(false);
  expect(formatMidiBytes(bytes)).toBe("B0 63 00 · B0 62 11 · B0 06 63");
  expect(() => encodePeakParameter(saw, 128)).toThrow();
  expect(() => encodePeakParameter({ ...saw, nrpn: [1, 1] }, 20)).toThrow();
});

test("held-note fanout releases both removed outputs and preserves unaffected notes", () => {
  const pressed = transitionNote([], 2, 1, 60, 100, [14, 40]);
  const other = transitionNote(pressed.notes, 3, 1, 61, 100, [16]);
  expect(transitionRoute(other.notes, 2, [14, 40])).toContain("14, 40");
  expect(transitionRoute(other.notes, 2, [14])).toContain("output(s) 14");
  expect(transitionRoute(other.notes, 2, [])).toBeNull();
  const release = transitionNote(other.notes, 2, 1, 60, 0, 13);
  expect(release.releases.map(item => item.destination)).toEqual([14, 40]);
  expect(release.notes).toEqual(other.notes.filter(item => item.source === 3));
  expect(disconnectedSource(other.notes, 2)).toContain("2 simulated held note(s)");
  expect(transitionNote([], 2, 1, 60, 0, 14).releases).toEqual([]);
});

test("OSC owner lease stops listener after a lost tab", async ({ request }) => {
  const started = await request.post("/api/controls/start", { data: { port: 0, client: "lease-owner" }, headers: { "X-MioXLplus": "studio" } });
  expect(started.ok()).toBe(true);
  await expect.poll(async () => (await (await request.get("/api/controls/status")).json()).running, { timeout: 6500 }).toBe(false);
});

test("held-note preview keeps the original simulated release output", async ({ page }) => {
  await createPeakAction(page);
  await page.locator(".route-control").click();
  await page.getByRole("button", { name: "Edit control" }).click();
  await page.getByRole("combobox", { name: "Replacement rule" }).selectOption("both");
  await page.getByRole("button", { name: "Save control" }).click();
  await page.locator(".route-control").click();
  await page.getByRole("button", { name: "Hold C4" }).click();
  await expect(page.getByText(/removed output\(s\) 14, 40/)).toBeVisible();
  await page.getByRole("button", { name: "Simulate source loss" }).click();
  await expect(page.getByText(/Physical silence cannot be confirmed/)).toBeVisible();
  await page.getByRole("button", { name: "Release C4" }).click();
  await expect(page.getByText(/original outputs 14, 40/)).toBeVisible();
});

test("surface preview preserves unknown values and Peak NRPN label", () => {
  const frame = surfaceFrame(emptyControls().profiles[0]);
  expect(frame.parameters[0]).toMatchObject({ value: "unknown", binding: "cc:1:79" });
  expect(frame.parameters[7]).toMatchObject({ value: "unknown", binding: "nrpn:1:0:17" });
});

test("Peak slider shows simulated bytes and retains unknown values elsewhere", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Control room" }).click();
  await page.getByRole("button", { name: /Novation Peak/ }).click();
  const slider = page.locator(".instrument-parameters input").first();
  await slider.focus();
  await slider.press("End");
  await expect(page.getByText(/B0 4F 7F · simulated, not sent/)).toBeVisible();
  await expect(page.getByText("CC 80 · Ch 1 · unknown")).toBeVisible();
});

test("OSC listener lease expires after owning tab reloads", async ({ page, request }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Control room" }).click();
  await page.getByRole("button", { name: "OSC bridge" }).click();
  await page.getByRole("spinbutton", { name: "OSC UDP port" }).fill("0");
  await page.getByRole("button", { name: "Start local listener" }).click();
  await expect.poll(async () => (await (await request.get("/api/controls/status")).json()).running).toBe(true);
  await page.reload();
  await expect.poll(async () => (await (await request.get("/api/controls/status")).json()).running, { timeout: 6500 }).toBe(false);
});

test("second tab cannot replace active OSC bindings or consume its events", async ({ page, browser, request }) => {
  await createPeakAction(page);
  const controls = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), CONTROLS_KEY);
  await page.getByRole("button", { name: "OSC bridge" }).click();
  await page.getByRole("spinbutton", { name: "OSC UDP port" }).fill("0");
  await page.getByRole("button", { name: "Start local listener" }).click();
  await expect.poll(async () => (await (await request.get("/api/controls/status")).json()).running).toBe(true);
  const { port } = await (await request.get("/api/controls/status")).json() as { port: number };
  const otherContext = await browser.newContext();
  await otherContext.route("**/api/studio/**", route => route.fulfill({ status: 503, json: { error: "Offline second-tab fixture" } }));
  const other = await otherContext.newPage();
  const sender = createSocket("udp4");
  try {
    await other.goto("/");
    await other.getByRole("tab", { name: "Control room" }).click();
    const denied = await other.evaluate(async () => {
      const configure = await fetch("/api/controls/configure", { method: "POST", headers: { "Content-Type": "application/json", "X-MioXLplus": "studio" }, body: JSON.stringify({ client: "second-tab-client", bindings: [] }) });
      const events = await fetch("/api/controls/events?after=0&client=second-tab-client");
      return [configure.status, events.status];
    });
    expect(denied).toEqual([403, 403]);
    expect((await (await request.get("/api/controls/status")).json()).bindings).toBe(1);
    const pad = (value: string) => { const bytes = Buffer.alloc(Math.ceil((value.length + 1) / 4) * 4); bytes.write(value); return bytes; };
    const packet = Buffer.concat([pad(controls.actions[0].oscPath), pad(",")]);
    await new Promise<void>((resolve, reject) => sender.send(packet, port, "127.0.0.1", error => error ? reject(error) : resolve()));
    await expect(page.getByRole("button", { name: "Stage replacement draft" })).toBeVisible();
    await expect(other.getByRole("button", { name: "Stage replacement draft" })).toHaveCount(0);
  } finally {
    sender.close();
    await otherContext.close();
    await page.close();
    await expect.poll(async () => (await (await request.get("/api/controls/status")).json()).running, { timeout: 6500 }).toBe(false);
  }
});
