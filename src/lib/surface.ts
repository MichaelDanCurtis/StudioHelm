import type { InstrumentProfile } from "./controls";

// Mirrors Control Room's semantic SurfaceFrame shape, not a verified S88 USB packet.
export type SurfaceFrame = { bank: string; module: string; page: number; parameters: { label: string; value: string; binding: string | null }[] };
export function surfaceFrame(profile: InstrumentProfile, page = 0): SurfaceFrame {
  return { bank: "MioXLplus instruments", module: profile.name, page,
    parameters: profile.parameters.slice(page * 8, page * 8 + 8).map(parameter => ({
      label: parameter.name, value: parameter.value === null ? "unknown" : String(parameter.value),
      binding: parameter.nrpn ? `nrpn:${parameter.channel}:${parameter.nrpn.join(":")}` : `cc:${parameter.channel}:${parameter.cc}`,
    })) };
}

export function downloadSurfacePreview(frame: SurfaceFrame) {
  const canvas = document.createElement("canvas");
  canvas.width = 960; canvas.height = 240;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas export is unavailable.");
  ctx.fillStyle = "#17201b"; ctx.fillRect(0, 0, 960, 240);
  ctx.fillStyle = "#9dc191"; ctx.font = "600 13px sans-serif"; ctx.fillText("CONTROL ROOM  /  SIMULATED SCREEN LAYOUT", 24, 29);
  ctx.fillStyle = "#f0eee6"; ctx.font = "600 25px sans-serif"; ctx.fillText(frame.module, 24, 67);
  for (let index = 0; index < 8; index++) {
    const x = 24 + index * 116;
    ctx.fillStyle = "#29372d"; ctx.fillRect(x, 87, 106, 127);
    ctx.fillStyle = "#a9c89f"; ctx.font = "600 11px sans-serif"; ctx.fillText(String(index + 1).padStart(2, "0"), x + 9, 106);
    const parameter = frame.parameters[index];
    if (!parameter) continue;
    ctx.fillStyle = "#eceee5"; ctx.font = "600 11px sans-serif";
    const words = parameter.label.split(" ");
    ctx.fillText(words.slice(0, 2).join(" ").slice(0, 16), x + 9, 133);
    ctx.fillText(words.slice(2).join(" ").slice(0, 16), x + 9, 148);
    ctx.fillStyle = "#b8dcac"; ctx.font = "600 25px sans-serif"; ctx.fillText(parameter.value, x + 9, 187);
    ctx.fillStyle = "#8eab8d"; ctx.font = "10px sans-serif"; ctx.fillText(parameter.binding ?? "", x + 9, 204);
  }
  const link = document.createElement("a");
  link.download = `${frame.module.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-surface-preview.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();
}
