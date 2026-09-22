import { z } from "zod";
import { authKeySchema, roomIdSchema } from "./protocol";

export const credentialsSchema = z
  .strictObject({ roomId: roomIdSchema, authKey: authKeySchema })
  .readonly();
export type Credentials = z.infer<typeof credentialsSchema>;

export async function roomIdFromAuthKey(
  authKey: Credentials["authKey"],
): Promise<Credentials["roomId"]> {
  const bytes = Uint8Array.fromHex(authKey);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return roomIdSchema.parse(new Uint8Array(digest).toHex());
}

export async function deriveCredentials(password: string): Promise<Credentials> {
  const material = new TextEncoder().encode(z.string().min(1).max(1_024).parse(password));
  try {
    const key = await crypto.subtle.importKey("raw", material, "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        salt: new TextEncoder().encode("aside-bookmark-sync:v1:auth"),
        iterations: 600_000,
      },
      key,
      256,
    );
    const authKey = authKeySchema.parse(new Uint8Array(bits).toHex());
    return { authKey, roomId: await roomIdFromAuthKey(authKey) };
  } finally {
    material.fill(0);
  }
}
