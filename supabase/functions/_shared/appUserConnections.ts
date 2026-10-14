// Server-only: encrypted per-user connection keys (lovack_*).
import { createClient } from "npm:@supabase/supabase-js@2";

export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
];

async function key(): Promise<CryptoKey> {
  const raw = Deno.env.get("APP_USER_CONNECTION_KEY_SECRET");
  if (!raw) throw new Error("APP_USER_CONNECTION_KEY_SECRET is not set");
  return crypto.subtle.importKey("raw", Uint8Array.from(atob(raw), (c) => c.charCodeAt(0)), "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function encrypt(plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(), new TextEncoder().encode(plaintext)));
  const buf = new Uint8Array(iv.length + ct.length);
  buf.set(iv); buf.set(ct, iv.length);
  return btoa(String.fromCharCode(...buf));
}

async function decrypt(stored: string): Promise<string> {
  const buf = Uint8Array.from(atob(stored), (c) => c.charCodeAt(0));
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: buf.subarray(0, 12) }, await key(), buf.subarray(12));
  return new TextDecoder().decode(pt);
}

function admin() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

export async function saveConnectionKeyForUser(userId: string, connectorId: string, connectionAPIKey: string) {
  const { error } = await admin().from("app_user_connections").upsert({
    user_id: userId,
    connector_id: connectorId,
    connection_key_ciphertext: await encrypt(connectionAPIKey),
    reconnect_required: false,
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id,connector_id" });
  if (error) throw error;
}

export async function getConnectionKeyForUser(userId: string, connectorId: string): Promise<string | null> {
  const { data, error } = await admin().from("app_user_connections")
    .select("connection_key_ciphertext").eq("user_id", userId).eq("connector_id", connectorId).maybeSingle();
  if (error) throw error;
  return data ? await decrypt(data.connection_key_ciphertext) : null;
}

export async function deleteConnectionForUser(userId: string, connectorId: string) {
  await admin().from("app_user_connections").delete().eq("user_id", userId).eq("connector_id", connectorId);
}
