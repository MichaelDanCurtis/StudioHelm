import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import {
  blockNode,
  capture,
  capturedRoutes,
  connectRoute,
  connectionError,
  initialScene,
  parseScene,
  refreshScene,
  removeRoute,
  STORAGE_KEY,
} from "../src/lib/studio";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/studio/**", route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({error: "Offline test fixture"}) }));
});

async function saved(page: Page) {
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  return page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!),
    STORAGE_KEY,
  );
}

async function dragConnection(page: Page, from: string, to: string) {
  const source = page.getByTestId(`handle-out-${from}`);
  const target = page.getByTestId(`handle-in-${to}`);
  await expect(source).toBeVisible();
  await expect(target).toBeVisible();
  const a = (await source.boundingBox())!;
  const b = (await target.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 24 });
  await page.mouse.up();
}

test("synthetic demo opens with route counts, rendered minimap, and no runtime errors", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Your signal. Your flow." }),
  ).toBeVisible();
  await expect(page.locator(".react-flow__node")).toHaveCount(5);
  await expect(page.locator(".react-flow__edge")).toHaveCount(4);
  await expect(page.locator(".react-flow__minimap-node")).toHaveCount(5);
  await page.getByRole("tab", { name: "Routes 88" }).click();
  await expect(page.locator("tbody tr")).toHaveCount(88);
  await page.getByRole("textbox", { name: "Search routes" }).fill("Demo input 5");
  await expect(page.locator("tbody tr")).toHaveCount(2);
  await page.getByRole("tab", { name: "Canvas", exact: true }).click();
  expect(errors).toEqual([]);
});

test("pointer drag creates a draft, undo/redo work, and refresh restores it", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Fit canvas", exact: true }).click();
  await dragConnection(page, "in-2", "out-13");
  await expect(page.locator(".react-flow__edge")).toHaveCount(5);
  await expect(
    page.getByRole("button", { name: "Review draft 1" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator(".react-flow__edge")).toHaveCount(4);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(page.locator(".react-flow__edge")).toHaveCount(5);
  const state = await saved(page);
  expect(state.additions).toHaveLength(1);
  await page.reload();
  await expect(page.locator(".react-flow__edge")).toHaveCount(5);
  await dragConnection(page, "in-2", "out-13");
  expect((await saved(page)).additions).toHaveLength(1);
});

test("keyboard-friendly connection form stages routes and review removal is reversible", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByTestId("node-in-2").click();
  await page
    .getByRole("combobox", { name: "Connect to destination" })
    .selectOption("out-13");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.locator(".react-flow__edge")).toHaveCount(5);
  await page.getByRole("tab", { name: "Routes 89" }).click();
  await page
    .getByRole("button", { name: "Inspect route in-1__out-13", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Remove connection", exact: true })
    .click();
  await expect(page.getByRole("tab", { name: "Routes 88" })).toBeVisible();
  await page.getByRole("button", { name: "Review draft 2" }).click();
  await expect(
    page.getByRole("button", {name:"Review hardware changes"}),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Restore demo baseline" }).click();
  await page.getByRole("tab", { name: "Canvas", exact: true }).click();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  expect((await saved(page)).removals).toEqual(["in-1__out-13"]);
});

test("blocks have editable saved settings and signal types reject incompatible links", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Add block", exact: true }).click();
  await page.getByRole("button", { name: /^MIDI → OSC/ }).click();
  await page.getByLabel("MIDI controller number").fill("74");
  await page
    .getByLabel("OSC address", { exact: true })
    .fill("/lights/intensity");
  await page.getByRole("button", { name: "Update block" }).click();
  await expect(
    page.getByText("CC 74 → /lights/intensity", { exact: true }),
  ).toBeVisible();
  const state = await saved(page);
  const block = state.nodes.find(
    (node: { data: { kind: string } }) => node.data.kind === "midi-osc",
  );
  expect(block.data.cc).toBe(74);
  await page.reload();
  await expect(
    page.getByText("CC 74 → /lights/intensity", { exact: true }),
  ).toBeVisible();
  await dragConnection(page, block.id, "out-13");
  expect((await saved(page)).additions).toHaveLength(0);
});

test("library search and real drag/drop add a port, node movement persists", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Destinations", exact: true }).click();
  await page.getByRole("textbox", { name: "Search ports" }).fill("DIN 12");
  const item = page.getByRole("button", {
    name: "Add DIN 12 destination",
    exact: true,
  });
  await expect(item).toBeVisible();
  await item.dragTo(page.locator(".flow-area"), {
    targetPosition: { x: 400, y: 200 },
  });
  await expect(page.getByTestId("node-out-12")).toBeVisible();
  const before = (await saved(page)).nodes.find(
    (node: { id: string }) => node.id === "out-12",
  ).position;
  const node = page.getByTestId("node-out-12");
  const box = (await node.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 30);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + 70, { steps: 12 });
  await page.mouse.up();
  const after = (await saved(page)).nodes.find(
    (item: { id: string }) => item.id === "out-12",
  ).position;
  expect(after).not.toEqual(before);
  await page.reload();
  expect(
    (await saved(page)).nodes.find(
      (item: { id: string }) => item.id === "out-12",
    ).position,
  ).toEqual(after);
});

test("scene export uses the entered name and contains a local draft, not a hardware backup", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Save scene", exact: true }).click();
  await page.getByLabel("Scene name", { exact: true }).fill("Evening session");
  const promise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON" }).click();
  const download = await promise;
  expect(download.suggestedFilename()).toBe("evening-session-mioxlplus.json");
  const exported = JSON.parse(await readFile((await download.path())!, "utf8"));
  expect(exported.name).toBe("Evening session");
  expect(exported.exportKind).toBe("mioxlplus-local-scene");
  expect(exported.serial).toBe("DEMO-MIOXL");
  expect(exported.nodes).toHaveLength(5);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save scene", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Evening session");
  expect((await saved(page)).name).toBe("Evening session");
  await page.reload();
  expect((await saved(page)).name).toBe("Evening session");
});

test("small screens show the canvas and allow drawers without page overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Your signal. Your flow." }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Toggle port library" }).click();
  await expect(
    page.getByRole("textbox", { name: "Search ports" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Toggle port library" }).click();
  await page.getByRole("button", { name: "Canvas help" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("corrupt stored drafts preserve the original JSON and open the demo without a crash", async ({
  page,
}) => {
  await page.addInitScript(
    (key) => localStorage.setItem(key, '{"version":1,"nodes":[null]}'),
    STORAGE_KEY,
  );
  await page.goto("/");
  await expect(page.locator(".react-flow__node")).toHaveCount(5);
  await expect(page.getByRole("status")).toContainText(
    "saved draft did not match this inventory",
  );
  expect(await page.evaluate(key => localStorage.getItem(`${key}.invalid-backup`), STORAGE_KEY))
    .toBe('{"version":1,"nodes":[null]}');
});

test("routing model preserves capture, handles restore, and rejects cycles and corrupt imports", () => {
  const original = initialScene();
  expect(capturedRoutes).toHaveLength(88);
  expect(
    connectionError(original, { source: "in-1", target: "out-13" }),
  ).toContain("already connected");
  const removed = removeRoute(original, "in-1__out-13");
  expect(connectRoute(removed, "in-1", "out-13").removals).toEqual([]);
  expect(original.removals).toEqual([]);
  const a = blockNode("remap", { x: 0, y: 0 }),
    b = blockNode("remap", { x: 300, y: 0 });
  const connected = connectRoute(
    { ...original, nodes: [...original.nodes, a, b] },
    a.id,
    b.id,
  );
  expect(connectionError(connected, { source: b.id, target: a.id })).toContain(
    "cycle",
  );
  expect(parseScene({ ...original, serial: "wrong-device" })).toBeNull();
  expect(
    parseScene({
      ...original,
      additions: [{ id: "ghost__out-13", source: "ghost", target: "out-13" }],
    }),
  ).toBeNull();
});

test("a different configured live serial replaces demo identity only without a draft", () => {
  const snapshot = { ...structuredClone(capture), captured_at: "2026-10-01T00:00:00Z",
    revision: "a".repeat(64), device: { ...capture.device, serial: "SIMULATED-LIVE" } };
  const live = refreshScene(initialScene(), snapshot);
  expect(live.serial).toBe("SIMULATED-LIVE");
  expect(parseScene(live)?.serial).toBe("SIMULATED-LIVE");
  const draft = connectRoute(initialScene(), "in-2", "out-13");
  expect(() => refreshScene(draft, snapshot)).toThrow("Device routing changed");
});
