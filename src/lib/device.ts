import type { Capture } from "./studio";
export type ApplyPlan = {
  id: string; expiresAt: number; device: Capture["device"]; preset: Capture["preset"];
  additions: string[]; removals: string[];
};
export type NetworkInventory = {
  at: string; scope: string; mode: string;
  services: { name: string; service: string; hostname: string; address: string; port: number; manufacturer: string | null }[];
  motu: { uid: string; name: string; model: string; address: string; at: string; controlCount: number; parameterCount: number; controls: {path: string; value: number | string}[] }[];
  switches?: {address: string; name: string; firmware: string; mac: string; avbPorts: number[]; at: string}[];
  checks: {address: string; error: string}[];
};
export async function deviceRequest<T>(operation: string, body: unknown = {}): Promise<T> {
  const response = await fetch(`/api/studio/${operation}`, {
    method: "POST", headers: { "Content-Type": "application/json", "X-MioXLplus": "studio" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(operation === "apply" ? 605_000 : 125_000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Device request failed.");
  return result as T;
}
