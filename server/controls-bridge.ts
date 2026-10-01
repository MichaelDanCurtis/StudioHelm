import { createSocket, type Socket } from "node:dgram";
import type { Plugin, Connect } from "vite";

type Binding = { id: string; path: string };
type Event = { seq: number; id: string; path: string; at: string };

function oscMessage(data: Buffer): string | null {
  if (data.length < 8 || data.length > 512) return null;
  const addressEnd = data.indexOf(0);
  if (addressEnd < 2 || addressEnd > 96 || addressEnd % 4 === 0 && addressEnd + 4 > data.length) return null;
  const address = data.toString("ascii", 0, addressEnd);
  if (!/^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(address)) return null;
  const tagsStart = (addressEnd + 4) & ~3;
  const tagsEnd = data.indexOf(0, tagsStart);
  if (tagsEnd < 0) return null;
  const tags = data.toString("ascii", tagsStart, tagsEnd);
  const argsStart = (tagsEnd + 4) & ~3;
  if (tags === ",") return address;
  if (tags === ",T") return address;
  if (tags === ",i" && argsStart + 4 <= data.length && data.readInt32BE(argsStart) > 0) return address;
  if (tags === ",f" && argsStart + 4 <= data.length && data.readFloatBE(argsStart) > 0) return address;
  return null;
}

export function controlsBridge(): Plugin {
  let socket: Socket | null = null;
  let port: number | null = null;
  let bindings: Binding[] = [];
  let seq = 0;
  const events: Event[] = [];
  let lastError = "";
  let owner: string | null = null;
  let leaseUntil = 0;
  const validClient = (value: unknown): value is string => typeof value === "string" && /^[\w-]{8,80}$/.test(value);
  const validBindings = (value: unknown): value is Binding[] => Array.isArray(value) && value.length <= 48 &&
    value.every((item: Binding) => item && typeof item.id === "string" && /^[\w-]{1,80}$/.test(item.id) &&
      typeof item.path === "string" && item.path.length <= 96 && /^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(item.path)) &&
    new Set(value.map((item: Binding) => item.path)).size === value.length;
  const status = () => ({ running: !!socket, host: "127.0.0.1", port, seq, lastError, bindings: bindings.length });
  const stop = async () => {
    const closing = socket;
    socket = null; port = null; owner = null; leaseUntil = 0; events.length = 0;
    if (closing) await new Promise<void>(resolve => closing.close(() => resolve()));
  };
  const middleware: Connect.NextHandleFunction = async (req, res, next) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!url.pathname.startsWith("/api/controls/")) return next();
    const respond = (code: number, body: unknown) => {
      res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify(body));
    };
    const host = req.headers.host ?? "";
    if (!/^(127\.0\.0\.1|localhost):(5186|4186)$/.test(host) ||
        (req.headers.origin && req.headers.origin !== `http://${host}`)) return respond(403, { error: "Local studio origin required." });
    const operation = url.pathname.slice("/api/controls/".length);
    if (req.method === "GET" && operation === "status") return respond(200, status());
    if (req.method === "GET" && operation === "events") {
      const after = Number(url.searchParams.get("after") ?? seq);
      if (!Number.isSafeInteger(after) || after < 0) return respond(400, { error: "Invalid event cursor." });
      const client = url.searchParams.get("client");
      if (socket && client !== owner) return respond(403, { error: "Only the owning tab can read OSC events." });
      if (socket) leaseUntil = Date.now() + 3000;
      return respond(200, { ...status(), events: socket ? events.filter(event => event.seq > after) : [] });
    }
    if (!["configure", "start", "stop"].includes(operation)) return respond(404, { error: "Unknown controls operation." });
    if (req.method !== "POST") return respond(405, { error: "Method not supported." });
    if (req.headers["x-mioxlplus"] !== "studio" || !req.headers["content-type"]?.startsWith("application/json"))
      return respond(403, { error: "Use the local studio controls." });
    try {
      let raw = "";
      for await (const part of req) {
        raw += part.toString();
        if (raw.length > 16_384) throw new Error("Request is too large.");
      }
      const body = raw ? JSON.parse(raw) : {};
      if (operation === "configure") {
        if (!validClient(body.client)) return respond(400, { error: "A browser session is required to configure OSC." });
        if (socket && body.client !== owner) return respond(403, { error: "Only the owning tab can change OSC bindings." });
        if (!validBindings(body.bindings))
          return respond(400, { error: "Invalid or duplicate OSC bindings." });
        bindings = body.bindings;
      } else if (operation === "start") {
        if (!validClient(body.client)) return respond(400, { error: "A browser session is required to own the listener." });
        if (socket && owner !== body.client) return respond(409, { error: "Another tab owns the OSC listener. Wait for its lease to expire." });
        if (body.bindings !== undefined) {
          if (!validBindings(body.bindings)) return respond(400, { error: "Invalid or duplicate OSC bindings." });
          bindings = body.bindings;
        }
        if (!socket) {
          const requested = body.port;
          if (!Number.isInteger(requested) || requested < 0 || requested > 65535 || (requested !== 0 && requested < 1024))
            return respond(400, { error: "Choose a UDP port from 1024 to 65535." });
          const opened = createSocket("udp4");
          opened.on("message", (data, remote) => {
            if (remote.address !== "127.0.0.1") return;
            const path = oscMessage(data);
            const binding = bindings.find(item => item.path === path);
            if (!binding) return;
            events.push({ seq: ++seq, id: binding.id, path: binding.path, at: new Date().toISOString() });
            if (events.length > 100) events.shift();
          });
          opened.on("error", error => { lastError = error.message; void stop(); });
          try {
            await new Promise<void>((resolve, reject) => {
              opened.once("error", reject);
              opened.bind(requested, "127.0.0.1", () => { opened.removeListener("error", reject); resolve(); });
            });
          } catch (error) { opened.close(); throw error; }
          socket = opened; port = opened.address().port; lastError = "";
        }
        owner = body.client; leaseUntil = Date.now() + 3000;
      } else {
        if (socket && body.client !== owner) return respond(409, { error: "Only the owning tab can stop the listener." });
        await stop();
      }
      return respond(200, status());
    } catch (error) {
      return respond(400, { error: error instanceof Error ? error.message : "Controls request failed." });
    }
  };
  return { name: "mioxlplus-controls-bridge",
    configureServer(server) { server.middlewares.use(middleware); const timer = setInterval(() => { if (socket && Date.now() > leaseUntil) void stop(); }, 500); server.httpServer?.on("close", () => { clearInterval(timer); void stop(); }); },
    configurePreviewServer(server) { server.middlewares.use(middleware); const timer = setInterval(() => { if (socket && Date.now() > leaseUntil) void stop(); }, 500); server.httpServer?.on("close", () => { clearInterval(timer); void stop(); }); },
  };
}
