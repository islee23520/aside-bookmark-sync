import { z } from "zod";
import { credentialsSchema, type Credentials } from "./protocol";

// Chrome 120에서도 동작하도록 최신 Uint8Array hex 메서드에 의존하지 않는다.
function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function roomIdFromKey(authKey: Credentials["authKey"]): Promise<string> {
  const bytes = Uint8Array.from(authKey.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));
  return hex(await crypto.subtle.digest("SHA-256", bytes));
}

export async function deriveCredentials(password: string): Promise<Credentials> {
  const material = new TextEncoder().encode(z.string().min(1).max(1_024).parse(password));
  try {
    const key = await crypto.subtle.importKey("raw", material, "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({
      name: "PBKDF2", hash: "SHA-256", iterations: 600_000,
      salt: new TextEncoder().encode("aside-bookmark-sync:v1:auth"),
    }, key, 256);
    const authKey = hex(bits);
    const roomId = hex(await crypto.subtle.digest("SHA-256", bits));
    return credentialsSchema.parse({ authKey, roomId });
  } finally {
    material.fill(0);
  }
}
