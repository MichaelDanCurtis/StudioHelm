import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  workers: 2,
  use: {
    baseURL: "http://127.0.0.1:5186",
    viewport: { width: 1512, height: 982 },
    trace: "retain-on-failure",
  },
  reporter: [
    ["list"],
    ["json", { outputFile: "test-results/frontend-tests.json" }],
  ],
  webServer: {
    command: "MIOXLPLUS_INERT_DEVICE=1 npm run dev",
    url: "http://127.0.0.1:5186",
    reuseExistingServer: false,
  },
});
