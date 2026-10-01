import { test, expect } from "@playwright/test";
import { capture, STORAGE_KEY, type Capture } from "../src/lib/studio";

function snapshot(): Capture {
  return { ...structuredClone(capture), captured_at: new Date().toISOString(), revision: "a".repeat(64), preset: { ...capture.preset, scene: 1 } };
}

test("live inventory updates names, survives reload, and preserves local draft on refresh", async ({ page }) => {
  const fresh = snapshot(); fresh.ports[0].input_name = "Live keyboard";
  await page.route("**/api/studio/**", route => route.fulfill({ json: { snapshot: fresh } }));
  await page.goto("/");
  await expect(page.locator(".device-read-status")).toContainText(fresh.network.address);
  await expect(page.getByTestId("node-in-1")).toContainText("Live keyboard");
  await page.getByTestId("node-in-2").click();
  await page.getByRole("combobox", {name: "Connect to destination"}).selectOption("out-13");
  await page.getByRole("button", {name: "Connect", exact: true}).click();
  await page.getByRole("button", {name:"Refresh mioXL"}).click();
  await expect(page.getByRole("button", {name:"Review draft 1"})).toBeVisible();
  await expect(page.getByText("Saved locally", {exact:true})).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("node-in-1")).toContainText("Live keyboard");
  await expect(page.getByRole("button", {name:"Review draft 1"})).toBeVisible();
});

test("external route change stops refresh from rebasing a local draft silently", async ({page}) => {
  const fresh = snapshot();
  await page.route("**/api/studio/**", route => route.fulfill({json:{snapshot:fresh}}));
  await page.goto("/");
  await expect(page.locator(".device-read-status")).toContainText(fresh.network.address);
  await page.getByTestId("node-in-2").click();
  await page.getByRole("combobox", {name:"Connect to destination"}).selectOption("out-13");
  await page.getByRole("button", {name:"Connect", exact:true}).click();
  fresh.ports[1].preset_destinations.push(12); fresh.revision = "b".repeat(64);
  await page.getByRole("button", {name:"Refresh mioXL"}).click();
  await expect(page.getByRole("alert")).toContainText("Device routing changed");
  await expect(page.getByText("Saved locally", {exact:true})).toBeVisible();
  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), STORAGE_KEY);
  expect(saved.additions).toHaveLength(1);
  expect(saved.snapshot.revision).toBe("a".repeat(64));
});

test("hardware review does not write until explicit apply, then adopts verified state", async ({page}) => {
  const fresh = snapshot(); let writes = 0;
  await page.route("**/api/studio/**", async route => {
    const op = route.request().url().split("/").pop();
    if (op === "refresh") return route.fulfill({json:{snapshot:fresh}});
    if (op === "plan") {
      expect(route.request().postDataJSON().additions).toEqual(["in-2__out-13"]);
      return route.fulfill({json:{id:"test-plan",expiresAt:Date.now()/1000+120,device:fresh.device,preset:fresh.preset,additions:["in-2__out-13"],removals:[]}});
    }
    if (op === "apply") {
      writes++;
      expect(route.request().postDataJSON()).toEqual({id:"test-plan"});
      fresh.ports[1].preset_destinations.push(13); fresh.revision = "b".repeat(64);
      return route.fulfill({json:{snapshot:fresh,backup:"routes-test.json",verified:true}});
    }
    return route.fulfill({status:404,json:{error:"Unexpected request"}});
  });
  await page.goto("/");
  await expect(page.locator(".device-read-status")).toContainText(fresh.network.address);
  await page.getByTestId("node-in-2").click();
  await page.getByRole("combobox", {name:"Connect to destination"}).selectOption("out-13");
  await page.getByRole("button", {name:"Connect",exact:true}).click();
  await page.getByRole("button", {name:"Review draft 1"}).click();
  await page.getByRole("button", {name:"Review hardware changes"}).click();
  await expect(page.getByRole("button", {name:"Apply to mioXL",exact:true})).toBeVisible();
  expect(writes).toBe(0);
  await page.getByRole("button", {name:"Apply to mioXL",exact:true}).click();
  await expect(page.locator(".apply-success")).toContainText("Verified on mioXL");
  expect(writes).toBe(1);
  await expect(page.getByRole("button", {name:"Review hardware changes"})).toBeDisabled();
});

test("MOTU discovery shows real API controls supplied by adapter and performs no writes", async ({page}) => {
  const operations:string[]=[];
  await page.route("**/api/studio/**", route => {
    const op=route.request().url().split("/").pop()!;operations.push(op);
    return route.fulfill({json:op==="refresh"?{snapshot:snapshot()}:{at:new Date().toISOString(),scope:"Test discovery",mode:"read-only",services:[],checks:[],motu:[{uid:"0001f2fffe000001",name:"Studio 828",model:"828es",address:"192.0.2.20",parameterCount:1000,controlCount:1,controls:[{path:"mix/chan/0/matrix/fader",value:0.5}]}]}});
  });
  await page.goto("/");
  await expect(page.locator(".device-read-status")).toContainText(capture.network.address);
  await page.getByRole("button",{name:"Network",exact:true}).click();
  await page.getByRole("button",{name:"Scan network"}).click();
  await expect(page.getByText("Studio 828",{exact:true})).toBeVisible();
  await page.getByText("Explore mixer controls").click();
  await expect(page.getByText("mix/chan/0/matrix/fader",{exact:true})).toBeVisible();
  expect(operations).toEqual(["refresh","discover"]);
});

test("local device API rejects foreign origins, simple form requests, and GET writes", async ({request}) => {
  const foreign=await request.post("/api/studio/apply",{headers:{Origin:"https://example.com","X-MioXLplus":"studio"},data:{id:"x"}});
  expect(foreign.status()).toBe(403);
  const form=await request.post("/api/studio/apply",{form:{id:"x"}});
  expect(form.status()).toBe(403);
  const get=await request.get("/api/studio/apply");
  expect(get.status()).toBe(405);
});
