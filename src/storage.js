/**
 * storage.js — IndexedDB layer with transparent encryption
 * All writes pass through AES-GCM before hitting disk
 *
 * Keypair persistence model:
 *   CryptoKey objects are stored directly in IDB via structured clone.
 *   The private key is non-exportable — it never appears as raw bytes in JS.
 *   The keypair store is separate from encrypted stores because CryptoKey
 *   objects cannot be JSON-serialized; IDB handles them natively.
 *   On each PIN unlock, the keypair is loaded from IDB into _keypair.
 *   On intentional disconnect, the keypair store entry is deleted and a new
 *   keypair is generated, rotating the public identity.
 */

import { encrypt, decrypt } from './crypto.js';

const DB_NAME = 'rae_v1';
const DB_VERSION = 2; // bumped for keypair store addition

let _db = null;
let _encKey = null;    // AES-GCM key derived from PIN — set after unlock
let _keypair = null;   // ECDH CryptoKeyPair — loaded from IDB after unlock

// ── DATABASE INIT ─────────────────────────────────────────────────────────────

export function initDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;

      // Identity store — single record
      if (!db.objectStoreNames.contains('identity')) {
        db.createObjectStore('identity', { keyPath: 'id' });
      }

      // Relationships store — keyed by partner public key hash
      if (!db.objectStoreNames.contains('relationships')) {
        const rs = db.createObjectStore('relationships', { keyPath: 'id' });
        rs.createIndex('status', 'status', { unique: false });
      }

      // Sessions store — pass data per relationship
      if (!db.objectStoreNames.contains('sessions')) {
        const ss = db.createObjectStore('sessions', { keyPath: 'id' });
        ss.createIndex('relationshipId', 'relationshipId', { unique: false });
      }

      // Absolute profile store — single record for date mode
      if (!db.objectStoreNames.contains('absoluteProfile')) {
        db.createObjectStore('absoluteProfile', { keyPath: 'id' });
      }

      // Key metadata — stores salt for PIN derivation (not the key itself)
      if (!db.objectStoreNames.contains('keyMeta')) {
        db.createObjectStore('keyMeta', { keyPath: 'id' });
      }

      // Keypair store — CryptoKey objects stored via structured clone.
      // Private key is non-exportable; IDB is the only place it lives.
      // Not encrypted: CryptoKey objects cannot be JSON-serialized.
      // Security relies on the non-exportable flag + browser same-origin sandbox.
      if (!db.objectStoreNames.contains('keypair')) {
        db.createObjectStore('keypair', { keyPath: 'id' });
      }
    };

    req.onsuccess = (e) => {
      _db = e.target.result;
      resolve(_db);
    };

    req.onerror = () => reject(req.error);
  });
}

export function setEncryptionKey(key) {
  _encKey = key;
}

export function clearEncryptionKey() {
  _encKey = null;
  _keypair = null;
}

export function isUnlocked() {
  return _encKey !== null;
}

// ── KEYPAIR PERSISTENCE ───────────────────────────────────────────────────────
// CryptoKey objects are stored directly in IDB using structured clone.
// The private key is non-exportable — it never appears as raw bytes.

/**
 * Persist a generated CryptoKeyPair to IDB.
 * Call once at identity creation. Survives page reloads indefinitely
 * until explicitly deleted (on disconnect/key rotation).
 */
export async function saveKeypair(keypair) {
  await idbPut('keypair', {
    id: 'local',
    publicKey: keypair.publicKey,
    privateKey: keypair.privateKey,
    createdAt: Date.now(),
  });
  _keypair = keypair;
}

/**
 * Load the persisted keypair from IDB into module memory.
 * Called on every PIN unlock so the keys are available for the session.
 * Returns the keypair or null if none exists.
 */
export async function loadAndActivateKeypair() {
  const record = await idbGet('keypair', 'local');
  if (!record) return null;
  _keypair = { publicKey: record.publicKey, privateKey: record.privateKey };
  return _keypair;
}

/**
 * Get the active in-memory keypair.
 * Only available after loadAndActivateKeypair() has been called.
 */
export function getActiveKeypair() {
  return _keypair;
}

/**
 * Delete the keypair from IDB and clear memory.
 * Used on intentional disconnect — forces key rotation on next setup.
 */
export async function deleteKeypair() {
  await idbDelete('keypair', 'local');
  _keypair = null;
}

/**
 * Check whether a keypair already exists in IDB.
 * Used to distinguish first launch from returning user.
 */
export async function hasKeypair() {
  const record = await idbGet('keypair', 'local');
  return record !== null;
}

// ── CORE CRUD ─────────────────────────────────────────────────────────────────

async function encryptedPut(storeName, record) {
  if (!_encKey) throw new Error('Storage locked');
  const json = JSON.stringify(record);
  const encrypted = await encrypt(_encKey, json);
  const blob = {
    id: record.id,
    data: encrypted,
    updatedAt: Date.now(),
  };
  return idbPut(storeName, blob);
}

async function encryptedGet(storeName, id) {
  if (!_encKey) throw new Error('Storage locked');
  const blob = await idbGet(storeName, id);
  if (!blob) return null;
  const json = await decrypt(_encKey, blob.data);
  return JSON.parse(json);
}

async function encryptedGetAll(storeName) {
  if (!_encKey) throw new Error('Storage locked');
  const blobs = await idbGetAll(storeName);
  const results = [];
  for (const blob of blobs) {
    const json = await decrypt(_encKey, blob.data);
    results.push(JSON.parse(json));
  }
  return results;
}

async function encryptedDelete(storeName, id) {
  return idbDelete(storeName, id);
}

// ── RAW IDB HELPERS ───────────────────────────────────────────────────────────

function idbPut(storeName, record) {
  return new Promise((resolve, reject) => {
    const tx = _db.transaction(storeName, 'readwrite');
    const req = tx.objectStore(storeName).put(record);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGet(storeName, id) {
  return new Promise((resolve, reject) => {
    const tx = _db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

function idbGetAll(storeName) {
  return new Promise((resolve, reject) => {
    const tx = _db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

function idbDelete(storeName, id) {
  return new Promise((resolve, reject) => {
    const tx = _db.transaction(storeName, 'readwrite');
    const req = tx.objectStore(storeName).delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ── KEY METADATA ──────────────────────────────────────────────────────────────
// Salt stored unencrypted — needed to re-derive key from PIN

export async function saveKeyMeta(salt) {
  const saltArray = Array.from(new Uint8Array(salt));
  await idbPut('keyMeta', { id: 'local', salt: saltArray, createdAt: Date.now() });
}

export async function loadKeyMeta() {
  const meta = await idbGet('keyMeta', 'local');
  if (!meta) return null;
  return new Uint8Array(meta.salt);
}

export async function hasKeyMeta() {
  const meta = await idbGet('keyMeta', 'local');
  return meta !== null;
}

// ── IDENTITY ──────────────────────────────────────────────────────────────────

export async function saveIdentity(identity) {
  return encryptedPut('identity', { ...identity, id: 'local' });
}

export async function loadIdentity() {
  return encryptedGet('identity', 'local');
}

// ── RELATIONSHIPS ─────────────────────────────────────────────────────────────

export async function saveRelationship(relationship) {
  return encryptedPut('relationships', relationship);
}

export async function loadRelationship(id) {
  return encryptedGet('relationships', id);
}

export async function loadAllRelationships() {
  return encryptedGetAll('relationships');
}

export async function deleteRelationship(id) {
  await encryptedDelete('relationships', id);
  // Also delete all sessions for this relationship
  const sessions = await loadSessionsForRelationship(id);
  for (const s of sessions) {
    await encryptedDelete('sessions', s.id);
  }
}

// ── SESSIONS ──────────────────────────────────────────────────────────────────

export async function saveSession(session) {
  return encryptedPut('sessions', session);
}

export async function loadSession(id) {
  return encryptedGet('sessions', id);
}

export async function loadSessionsForRelationship(relationshipId) {
  const all = await encryptedGetAll('sessions');
  return all.filter(s => s.relationshipId === relationshipId)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function loadLatestSession(relationshipId) {
  const sessions = await loadSessionsForRelationship(relationshipId);
  return sessions[0] || null;
}

// ── ABSOLUTE PROFILE ──────────────────────────────────────────────────────────

export async function saveAbsoluteProfile(profile) {
  return encryptedPut('absoluteProfile', { ...profile, id: 'absolute' });
}

export async function loadAbsoluteProfile() {
  return encryptedGet('absoluteProfile', 'absolute');
}

// ── SESSION FACTORY ───────────────────────────────────────────────────────────

export function createEmptySession(relationshipId) {
  const domains = {};
  // Import domain IDs
  const domainIds = [
    'friendship', 'communication', 'domestic', 'cocaregiving',
    'lifepartner', 'collaborating', 'emotionalintimacy', 'emotionalsupport',
    'socialpartners', 'finances', 'caretaking', 'business',
    'romance', 'physicality', 'touch', 'sex', 'kink', 'powerdynamic'
  ];
  domainIds.forEach(id => {
    domains[id] = {
      pass1: null, // { x, y }
      pass2: null, // { x, zBinary, zScale }
      pass3: null, // { agreedX, agreedZ, notes, resolved }
    };
  });

  return {
    id: `session_${relationshipId}_${Date.now()}`,
    relationshipId,
    currentPass: 1,
    signoffs: {
      pass1: { mine: false, theirs: false },
      pass2: { mine: false, theirs: false },
    },
    domains,
    agreement: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}
