import { test, expect } from "@playwright/test";
import { emptyGearInventory, parseGearInventory, resolveNamedRoute, type GearInventory } from "../src/lib/gear-inventory";
import { initialScene } from "../src/lib/studio";

const example = (): GearInventory => ({ ...emptyGearInventory(), units: [
  { id: "moog", name: "Moog One", midiChannel: null, profileId: null, profileSource: "manual", profileEvidence: null,
    endpoints: [{ id: "moog-out", name: "MIDI OUT", direction: "out" }, { id: "moog-in", name: "MIDI IN", direction: "in" }] },
  { id: "peak", name: "Peak", midiChannel: 1, profileId: "novation-peak", profileSource: "manual", profileEvidence: null,
    endpoints: [{ id: "peak-out", name: "MIDI OUT", direction: "out" }, { id: "peak-in", name: "MIDI IN", direction: "in" }] },
], routes: [{ id: "moog-to-peak", name: "Moog to Peak", sourceEndpointId: "moog-out", targetEndpointId: "peak-in", policy: "destination" }] });

test("physical MIDI resolution requires explicit direction-correct DIN wiring", () => {
  const inventory = example(), route = inventory.routes[0], scene = initialScene();
  expect(parseGearInventory(inventory)).not.toBeNull();
  expect(resolveNamedRoute(inventory, scene, route).issues).toEqual(["Source: Physical wire is missing.", "Destination: Physical wire is missing."]);
  inventory.wires = [{ id: "one", endpointId: "moog-out", mioPort: 1 }, { id: "two", endpointId: "peak-in", mioPort: 2 }];
  expect(resolveNamedRoute(inventory, scene, route)).toEqual({ source: 1, target: 2, issues: [] });
  inventory.wires.push({ id: "three", endpointId: "moog-out", mioPort: 3 });
  expect(resolveNamedRoute(inventory, scene, route).issues).toContain("Source: Endpoint has ambiguous physical wires.");
  inventory.wires.pop();
  inventory.wires.push({ id: "four", endpointId: "peak-out", mioPort: 1 });
  expect(resolveNamedRoute(inventory, scene, route).issues).toContain("Source: Physical DIN side is assigned to multiple gear endpoints.");
  inventory.wires.pop();
  inventory.wires[0].mioPort = 9; // DIN 9 has no input side in the saved inventory.
  expect(resolveNamedRoute(inventory, scene, route).issues).toContain("Source: Selected mioXL DIN side is unavailable for this direction.");
  expect(parseGearInventory({ ...inventory, routes: [{ ...route, sourceEndpointId: "peak-in" }] })).toBeNull();
});

test("manual gear inventory survives view changes and resolves a named draft", async ({ page }) => {
  await page.route("**/api/studio/**", route => route.fulfill({ status: 503, json: { error: "Offline inventory fixture" } }));
  await page.goto("/");
  await page.getByRole("button", { name: "Open wiring map" }).click();
  await expect(page.getByRole("dialog", { name: "Gear inventory and physical wiring" })).toBeVisible();
  for (const name of ["Moog One", "Peak"]) {
    await page.getByRole("textbox", { name: "New instrument" }).fill(name);
    await page.getByRole("button", { name: "Add instrument" }).click();
  }
  await page.getByRole("combobox", { name: "Profile for Peak" }).selectOption("novation-peak");
  await expect(page.getByText("Physical wire is missing.").first()).toBeVisible();
  await page.getByRole("combobox", { name: "Wire gear endpoint" }).selectOption({ label: "Moog One MIDI OUT (OUT)" });
  await page.getByRole("combobox", { name: "Wire mioXL DIN side" }).selectOption("1");
  await page.getByRole("button", { name: "Add connection" }).click();
  await page.getByRole("combobox", { name: "Wire gear endpoint" }).selectOption({ label: "Peak MIDI IN (IN)" });
  await page.getByRole("combobox", { name: "Wire mioXL DIN side" }).selectOption("2");
  await page.getByRole("button", { name: "Add connection" }).click();
  await page.getByRole("textbox", { name: "Named route" }).fill("Moog to Peak");
  await page.getByRole("combobox", { name: "Named route source" }).selectOption({ label: "Moog One MIDI OUT" });
  await page.getByRole("combobox", { name: "Named route destination" }).selectOption({ label: "Peak MIDI IN" });
  await page.getByRole("button", { name: "Add named route" }).click();
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(page.locator(".gear-preview")).toContainText("2 existing routes would be removed");
  await page.getByRole("button", { name: "Stage local draft" }).click();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await expect(page.getByRole("button", { name: "Review draft 3" })).toBeVisible();
  await page.getByRole("tab", { name: "Control room" }).click();
  await expect(page.getByRole("button", { name: "Open wiring map" })).toBeVisible();
  await expect(page.locator(".gear-sidebar")).toContainText("Moog One");
  await page.reload();
  await page.getByRole("tab", { name: "Control room" }).click();
  await expect(page.locator(".gear-sidebar")).toContainText("Peak");
});
