/**
 * qrTransport.js — Air-gapped serialization pipeline
 * Replaces webrtc.js network streaming with high-density data compression
 */

import { encrypt, decrypt } from './crypto.js';

/**
 * Encrypts a JSON payload and packs it into a URL-safe Base64 string prefixed for de-flating
 */
export async function packPayload(data, sharedKey) {
  const jsonString = JSON.stringify(data);
  const encryptedBuffer = await encrypt(sharedKey, jsonString);
  const compressedB64 = await deflate(new Uint8Array(encryptedBuffer));
  return 'z:' + compressedB64;
}

/**
 * Unpacks and decrypts an air-gapped QR data payload
 */
export async function unpackPayload(qrString, sharedKey) {
  if (!qrString.startsWith('z:')) {
    throw new Error("Invalid transport signature context.");
  }
  const encryptedBytes = await inflate(qrString.slice(2));
  const decryptedJson = await decrypt(sharedKey, encryptedBytes.buffer);
  return JSON.parse(decryptedJson);
}

// ── INTERNAL DEFLATE/INFLATE ENGINE ──────────────────────────────────────────

async function deflate(bytes) {
  const cs = new CompressionStream('deflate-raw');
  const writer = cs.writable.getWriter();
  writer.write(bytes);
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
  
  const chunks = [];
  const reader = ds.readable.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.length; }
  return merged;
}
