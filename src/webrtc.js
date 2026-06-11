/**
 * transport.js (webrtc.js) — QR transport utilities
 *
 * WebRTC fully removed. Connection now uses two sequential QR rounds:
 *   Round 1: identity exchange  (tiny ~100 char QR, any camera)
 *   Round 2: data exchange      (encrypted session QR, ~400 chars)
 *
 * ECDH shared key is derived independently on both devices after
 * the identity exchange — no signaling server required.
 */

import { importPublicKey, deriveSharedKey, encrypt, decrypt, bufferToBase64, base64ToBuffer } from './crypto.js';

// ── ECDH SHARED KEY ───────────────────────────────────────────────────────────

/**
 * Derive a shared AES-GCM key from our private key + their base64 public key.
 * Both devices call this independently and arrive at the same key.
 */
export async function deriveSharedKeyFromPartner(myPrivateKey, theirPublicKeyB64) {
  const theirPublicKey = await importPublicKey(theirPublicKeyB64);
  return deriveSharedKey(myPrivateKey, theirPublicKey);
}

// ── SESSION DATA ENCRYPTION ───────────────────────────────────────────────────

/**
 * Encrypt session data with the ECDH shared key.
 * Returns a base64 string safe for QR encoding.
 */
export async function encryptSessionData(data, sharedKey) {
  const json = JSON.stringify(data);
  const encrypted = await encrypt(sharedKey, json);
  return bufferToBase64(encrypted);
}

/**
 * Decrypt a base64-encoded encrypted session payload.
 * Returns the original data object.
 */
export async function decryptSessionData(b64, sharedKey) {
  const buf = base64ToBuffer(b64);
  const json = await decrypt(sharedKey, buf);
  return JSON.parse(json);
}

// ── QR IDENTITY PAYLOAD ───────────────────────────────────────────────────────

/**
 * Build the identity QR string — plain JSON, no compression.
 * Short enough (~110 chars) that compression would add overhead.
 * Produces a v4 QR readable by any camera.
 */
export function buildIdentityQR(publicKeyB64, alias) {
  return JSON.stringify({ v: 1, t: 'id', k: publicKeyB64, n: alias });
}

export function parseIdentityQR(str) {
  const obj = JSON.parse(str);
  if (obj.v !== 1 || obj.t !== 'id' || !obj.k || !obj.n) {
    throw new Error('Not a valid RAE identity QR');
  }
  return { publicKey: obj.k, alias: obj.n };
}

// ── QR DATA PAYLOAD ───────────────────────────────────────────────────────────

/**
 * Build the data QR string — compress then wrap in envelope.
 * The encrypted session payload is already binary-safe base64,
 * so we just wrap it with metadata and compress the whole envelope.
 */
export async function buildDataQR(sessionData, sharedKey) {
  const encrypted = await encryptSessionData(sessionData, sharedKey);
  const envelope = JSON.stringify({ v: 1, t: 'data', e: encrypted });
  return serializeForQR(envelope);
}

export async function parseDataQR(str, sharedKey) {
  const envelopeStr = await deserializeFromQR(str);
  const envelope = JSON.parse(envelopeStr);
  if (envelope.v !== 1 || envelope.t !== 'data' || !envelope.e) {
    throw new Error('Not a valid RAE data QR');
  }
  return decryptSessionData(envelope.e, sharedKey);
}

// ── QR COMPRESSION ────────────────────────────────────────────────────────────
// Compression pipeline: string → deflate-raw → base64url
// Prefix 'z:' so receiver knows to decompress.
// Falls back to plain string if CompressionStream unavailable.

export async function serializeForQR(str) {
  try {
    const compressed = await deflate(str);
    return 'z:' + compressed;
  } catch {
    return str;
  }
}

export async function deserializeFromQR(str) {
  if (str.startsWith('z:')) {
    return inflate(str.slice(2));
  }
  return str;
}

async function deflate(str) {
  const input = new TextEncoder().encode(str);
  const cs = new CompressionStream('deflate-raw');
  const writer = cs.writable.getWriter();
  writer.write(input);
  writer.close();
  const chunks = [];
  const reader = cs.readable.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.length; }
  return btoa(String.fromCharCode(...merged))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function inflate(b64url) {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '==='.slice(0, (4 - b64.length % 4) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const ds = new DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter();
  writer.write(bytes);
  writer.close();
  return new Response(ds.readable).text();
}

// ── EDGES UNLOCK QR ───────────────────────────────────────────────────────────
// Tiny plain-JSON QRs (~115 chars) — no encryption needed,
// public keys are not secret. Partner's key is verified on receive.

export function buildUnlockRequestQR(myPublicKey) {
  return JSON.stringify({ v: 1, t: 'edges-req', k: myPublicKey });
}

export function buildUnlockConfirmQR(myPublicKey) {
  return JSON.stringify({ v: 1, t: 'edges-ok', k: myPublicKey });
}

export function parseUnlockQR(str) {
  const obj = JSON.parse(str);
  if (obj.v !== 1) throw new Error('Unknown QR version');
  if (obj.t !== 'edges-req' && obj.t !== 'edges-ok') throw new Error('Not an unlock QR');
  if (!obj.k) throw new Error('Missing public key');
  return { type: obj.t, publicKey: obj.k };
}
