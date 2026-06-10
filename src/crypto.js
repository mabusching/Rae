/**
 * crypto.js — Web Crypto API wrapper
 * PBKDF2 key derivation, AES-GCM encryption, ECDH keypair generation
 */

const PBKDF2_ITERATIONS = 310000;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;

// ── KEY DERIVATION ────────────────────────────────────────────────────────────

/**
 * Derive an AES-GCM key from a PIN using PBKDF2
 * Returns { key, salt } — salt must be stored alongside encrypted data
 */
export async function deriveKeyFromPIN(pin, salt = null) {
  const encoder = new TextEncoder();
  const pinBuffer = encoder.encode(pin);

  const rawSalt = salt
    ? salt
    : crypto.getRandomValues(new Uint8Array(SALT_LENGTH));

  const baseKey = await crypto.subtle.importKey(
    'raw',
    pinBuffer,
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  const key = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: rawSalt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );

  return { key, salt: rawSalt };
}

// ── SYMMETRIC ENCRYPTION ─────────────────────────────────────────────────────

/**
 * Encrypt arbitrary data with AES-GCM
 * Returns ArrayBuffer: [iv (12 bytes) | ciphertext]
 */
export async function encrypt(key, data) {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const encoder = new TextEncoder();
  const plaintext = typeof data === 'string' ? encoder.encode(data) : data;

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    plaintext
  );

  // Prepend IV to ciphertext
  const result = new Uint8Array(IV_LENGTH + ciphertext.byteLength);
  result.set(iv, 0);
  result.set(new Uint8Array(ciphertext), IV_LENGTH);
  return result.buffer;
}

/**
 * Decrypt AES-GCM data
 * Expects ArrayBuffer: [iv (12 bytes) | ciphertext]
 * Returns decrypted string
 */
export async function decrypt(key, data) {
  const bytes = new Uint8Array(data);
  const iv = bytes.slice(0, IV_LENGTH);
  const ciphertext = bytes.slice(IV_LENGTH);

  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext
  );

  return new TextDecoder().decode(plaintext);
}

// ── ASYMMETRIC KEYPAIR ────────────────────────────────────────────────────────

/**
 * Generate an ECDH keypair for identity and peer exchange
 * Private key is non-exportable — stays in browser keystore
 */
export async function generateKeypair() {
  const keypair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    false, // non-exportable private key
    ['deriveKey', 'deriveBits']
  );
  return keypair;
}

/**
 * Export public key as base64 string for QR/transport
 */
export async function exportPublicKey(publicKey) {
  const raw = await crypto.subtle.exportKey('raw', publicKey);
  return bufferToBase64(raw);
}

/**
 * Import a public key from base64 string
 */
export async function importPublicKey(base64) {
  const raw = base64ToBuffer(base64);
  return crypto.subtle.importKey(
    'raw',
    raw,
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    []
  );
}

/**
 * Derive a shared AES key from our private key + their public key
 * Used to encrypt payloads for peer exchange
 */
export async function deriveSharedKey(privateKey, theirPublicKey) {
  return crypto.subtle.deriveKey(
    { name: 'ECDH', public: theirPublicKey },
    privateKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

// ── IDENTITY HASH ─────────────────────────────────────────────────────────────

/**
 * Generate a deterministic fingerprint from a public key
 * Used for identicon generation and relationship IDs
 */
export async function hashPublicKey(publicKeyBase64) {
  const encoder = new TextEncoder();
  const data = encoder.encode(publicKeyBase64);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return bufferToHex(hash);
}

// ── UTILITIES ─────────────────────────────────────────────────────────────────

export function bufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function base64ToBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export function bufferToHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
