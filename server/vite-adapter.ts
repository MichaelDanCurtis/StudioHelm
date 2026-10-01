import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { Plugin, Connect } from "vite";

export function studioAdapter(): Plugin {
  const root = fileURLToPath(new URL("../", import.meta.url));
  let busy = false;
  let sharedRead: Promise<string> | null = null;
  const middleware: Connect.NextHandleFunction = async (req, res, next) => {
    const path = req.url?.split("?")[0];
    if (!path?.startsWith("/api/studio/")) return next();
    const respond = (status: number, body: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify(body));
    };
    const host = req.headers.host ?? "";
    if (!/^(127\.0\.0\.1|localhost):(5186|4186)$/.test(host) ||
        (req.headers.origin && req.headers.origin !== `http://${host}`)) {
      return respond(403, { error: "Studio API requires the local studio origin." });
    }
    const operation = path.slice("/api/studio/".length);
    if (!["status", "refresh", "plan", "apply", "discover"].includes(operation))
      return respond(404, { error: "Unknown studio operation." });
    if (req.method !== (operation === "status" ? "GET" : "POST"))
      return respond(405, { error: "Method not supported." });
    if (operation !== "status" && (req.headers["x-mioxlplus"] !== "studio" || !req.headers["content-type"]?.startsWith("application/json")))
      return respond(403, { error: "Use the studio controls to make device requests." });
    // Playwright's server is inert even if a browser route mock is missed.
    if (process.env.MIOXLPLUS_INERT_DEVICE === "1")
      return respond(503, { error: "Device adapter disabled for browser tests." });
    if (operation === "refresh" && sharedRead) {
      try {
        const envelope = JSON.parse(await sharedRead);
        return respond(envelope.ok ? 200 : 409, envelope.ok ? envelope.result : { error: envelope.error });
      } catch { return respond(503, { error: "Device read failed. Refresh to reconnect." }); }
    }
    if (busy) return respond(409, { error: "The device adapter is busy. Try again shortly." });
    busy = true;
    try {
      let body = "";
      for await (const part of req) {
        body += part.toString();
        if (body.length > 256_000) throw new Error("Request is too large.");
      }
      const payload = body ? JSON.parse(body) : {};
      const request = new Promise<string>((resolve, reject) => {
        const child = spawn(process.env.MIOXLPLUS_PYTHON ?? "python3", ["-m", "server.bridge", operation],
          { cwd: root, stdio: ["pipe", "pipe", "pipe"] });
        let stdout = "", stderr = "";
        // A write is never retried. The adapter journals each attempted bitmap for recovery.
        const timeout = setTimeout(() => { child.kill("SIGTERM"); reject(new Error("Device operation timed out. Refresh before retrying; check .runtime/backups if an apply was in progress.")); }, operation === "apply" ? 600_000 : 120_000);
        child.stdout.on("data", data => { stdout += data; });
        child.stderr.on("data", data => { stderr += data; });
        child.on("error", error => { clearTimeout(timeout); reject(error); });
        child.on("close", code => {
          clearTimeout(timeout);
          if (code === 0) resolve(stdout);
          else reject(new Error(stderr.trim() || "Device adapter stopped unexpectedly."));
        });
        child.stdin.end(JSON.stringify(payload));
      });
      if (operation === "refresh") sharedRead = request;
      const envelope = JSON.parse(await request);
      respond(envelope.ok ? 200 : 409, envelope.ok ? envelope.result : { error: envelope.error });
    } catch (error) {
      respond(500, { error: error instanceof Error ? error.message : "Device request failed." });
    } finally { busy = false; sharedRead = null; }
  };
  return {
    name: "mioxlplus-device-adapter",
    configureServer(server) { server.middlewares.use(middleware); },
    configurePreviewServer(server) { server.middlewares.use(middleware); },
  };
}
