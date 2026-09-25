/**
 * Web Crypto helpers for the Google OAuth boundary.
 *
 * Uses the runtime Web Crypto API only (no `node:crypto`) so the same code
 * runs on Node, Vercel, and the Cloudflare Workers/vinext runtime.
 */

const textEncoder = new TextEncoder();

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecodeToBytes(value: string): Uint8Array<ArrayBuffer> | null {
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

export function createRandomToken(byteLength = 32): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(byteLength)));
}

export function timingSafeStringEqual(left: string, right: string): boolean {
  const leftBytes = textEncoder.encode(left);
  const rightBytes = textEncoder.encode(right);
  let difference = leftBytes.length ^ rightBytes.length;
  const length = Math.max(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

export async function sha256Base64Url(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(input));
  return base64UrlEncode(new Uint8Array(digest));
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/**
 * Sign an opaque string with HMAC-SHA256. `purpose` is part of the signed
 * payload so a value signed for one cookie can never be replayed as another.
 */
export async function signValue(secret: string, purpose: string, value: string): Promise<string> {
  const key = await importHmacKey(secret);
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, textEncoder.encode(`${purpose}.${value}`)),
  );
  return `${value}.${base64UrlEncode(signature)}`;
}

/** Return the original value when the HMAC is valid, otherwise null. */
export async function verifySignedValue(
  secret: string,
  purpose: string,
  token: string,
): Promise<string | null> {
  const separator = token.lastIndexOf(".");
  if (separator <= 0 || separator === token.length - 1) return null;
  const value = token.slice(0, separator);
  const signature = base64UrlDecodeToBytes(token.slice(separator + 1));
  if (!signature) return null;
  const key = await importHmacKey(secret);
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    signature,
    textEncoder.encode(`${purpose}.${value}`),
  );
  return valid ? value : null;
}

export function base64UrlEncodeJson(value: unknown): string {
  const json = JSON.stringify(value);
  if (json === undefined) throw new TypeError("value is not JSON serializable");
  return base64UrlEncode(textEncoder.encode(json));
}

export function base64UrlDecodeJson(value: string): unknown {
  const bytes = base64UrlDecodeToBytes(value);
  if (!bytes) return null;
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}
