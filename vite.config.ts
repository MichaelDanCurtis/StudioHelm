import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

import { studioAdapter } from "./server/vite-adapter.ts";
import { controlsBridge } from "./server/controls-bridge.ts";

export default defineConfig({ plugins: [react(), studioAdapter(), controlsBridge()] });
