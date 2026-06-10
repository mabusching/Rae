/**
 * storage.js — IndexedDB layer with transparent encryption
 *
 * Version history:
 *   v1 — initial schema
 *   v2 — added keypair store
 *   v3 — renamed absoluteProfile → idealProfile (migration included)
 */

import { encrypt, decrypt } from './crypto.js';

const DB_NAME = 'rae_v1';
const DB_VERSION = 3;

let _db = null;
let _encKey = null;
let _keypair = null;

// ── BLOCKED MESSAGE ───────────────────────────────────────────────────────────

function showBlockedMessage() {
  const app = document.getElementById('app');
  if (app) app.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;gap:1rem;padding:2rem;text-align:center;">
      <div style="color:#E8A84C;font-family:serif;font-size:1.1rem;">Close other tabs running RAE, then reload.</div>
    </div>`;
}

// ── DATABASE INIT ─────────────────────────────────────────────────────────────

export function initDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      const tx = e.target.transaction;
      const oldVersion = e.oldVersion;

      // ── v1 / fresh install stores ──────────────────────────────────────────
      if (!db.objectStoreNames.contains('identity')) {
        db.createObjectStore('identity', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('relationships')) {
        const rs = db.createObjectStore('relationships', { keyPath: 'id' });
        rs.createIndex('status', 'status', { unique: false });
      }
      if (!db.objectStoreNames.contains('sessions')) {
        const ss = db.createObjectStore('sessions', { keyPath: 'id' });
        ss.createIndex('relationshipId', 'relationshipId', { unique: false });
      }
      if (!db.objectStoreNames.contains('keyMeta')) {
        db.createObjectStore('keyMeta', { keyPath: 'id' });
      }

      // ── v2 — keypair store ─────────────────────────────────────────────────
      if (!db.objectStoreNames.contains('keypair')) {
        db.createObjectStore('keypair', { keyPath: 'id' });
      }

      // ── v3 — rename absoluteProfile → idealProfile ─────────────────────────
      if (oldVersion < 3) {
        if (db.objectStoreNames.contains('absoluteProfile')) {
          // Copy existing data into new store before deleting old one
          const newStore = db.createObjectStore('idealProfile', { keyPath: 'id' });
          const oldStore = tx.objectStore('absoluteProfile');
          oldStore.openCursor().onsuccess = (ev) => {
            const cursor = ev.target.result;
            if (cursor) {
              // Re-key from 'absolute' to 'ideal' to match new convention
              const record = { ...cursor.value, id: 'ideal' };
              newStore.put(record);
              cursor.continue();
            }
          };
          db.deleteObjectStore('absoluteProfile');
        } else {
          // Fresh install at v3 — just create idealProfile directly
          if (!db.objectStoreNames.contains('idealProfile')) {
            db.createObjectStore('idealProfile', { keyPath: 'id' });
          }
        }
      } else {
        // Already at v3+ — create if missing (shouldn't happen, but safe)
        if (!db.objectStoreNames.contains('idealProfile')) {
          db.createObjectStore('idealProfile', { keyPath: 'id' });
        }
      }
    };

    req.onsuccess = (e) => { _db = e.target.result; resolve(_db); };
    req.onerror = () => reject(req.error);
    req.onblocked = () => { console.warn('[RAE] IDB blocked'); showBlockedMessage(); };
  });
}

export function setEncryptionKey(key) { _encKey = key; }
export function clearEncryptionKey() { _encKey = null; _keypair = null; }
export function isUnlocked() { return _encKey !== null; }

// ── KEYPAIR ───────────────────────────────────────────────────────────────────

export async function saveKeypair(keypair) {
  await idbPut('keypair', { id: 'local', publicKey: keypair.publicKey, privateKey: keypair.privateKey, createdAt: Date.now() });
  _keypair = keypair;
}

export async function loadAndActivateKeypair() {
  const record = await idbGet('keypair', 'local');
  if (!record) return null;
  _keypair = { publicKey: record.publicKey, privateKey: record.privateKey };
  return _keypair;
}

export function getActiveKeypair() { return _keypair; }

export async function deleteKeypair() {
  await idbDelete('keypair', 'local');
  _keypair = null;
}

export async function hasKeypair() {
  const record = await idbGet('keypair', 'local');
  return record !== null;
}

// ── CORE CRUD ─────────────────────────────────────────────────────────────────

async function encryptedPut(storeName, record) {
  if (!_encKey) throw new Error('Storage locked');
  const encrypted = await encrypt(_encKey, JSON.stringify(record));
  return idbPut(storeName, { id: record.id, data: encrypted, updatedAt: Date.now() });
}

async function encryptedGet(storeName, id) {
  if (!_encKey) throw new Error('Storage locked');
  const blob = await idbGet(storeName, id);
  if (!blob) return null;
  return JSON.parse(await decrypt(_encKey, blob.data));
}

async function encryptedGetAll(storeName) {
  if (!_encKey) throw new Error('Storage locked');
  const blobs = await idbGetAll(storeName);
  const results = [];
  for (const blob of blobs) results.push(JSON.parse(await decrypt(_encKey, blob.data)));
  return results;
}

async function encryptedDelete(storeName, id) { return idbDelete(storeName, id); }

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

export async function saveKeyMeta(salt) {
  await idbPut('keyMeta', { id: 'local', salt: Array.from(new Uint8Array(salt)), createdAt: Date.now() });
}

export async function loadKeyMeta() {
  const meta = await idbGet('keyMeta', 'local');
  return meta ? new Uint8Array(meta.salt) : null;
}

export async function hasKeyMeta() {
  return (await idbGet('keyMeta', 'local')) !== null;
}

// ── IDENTITY ──────────────────────────────────────────────────────────────────

export async function saveIdentity(identity) { return encryptedPut('identity', { ...identity, id: 'local' }); }
export async function loadIdentity() { return encryptedGet('identity', 'local'); }

// ── RELATIONSHIPS ─────────────────────────────────────────────────────────────

export async function saveRelationship(r) { return encryptedPut('relationships', r); }
export async function loadRelationship(id) { return encryptedGet('relationships', id); }
export async function loadAllRelationships() { return encryptedGetAll('relationships'); }

export async function deleteRelationship(id) {
  await encryptedDelete('relationships', id);
  const sessions = await loadSessionsForRelationship(id);
  for (const s of sessions) await encryptedDelete('sessions', s.id);
}

// ── SESSIONS ──────────────────────────────────────────────────────────────────

export async function saveSession(session) { return encryptedPut('sessions', session); }
export async function loadSession(id) { return encryptedGet('sessions', id); }

export async function loadSessionsForRelationship(relationshipId) {
  const all = await encryptedGetAll('sessions');
  return all.filter(s => s.relationshipId === relationshipId).sort((a, b) => b.createdAt - a.createdAt);
}

export async function loadLatestSession(relationshipId) {
  const sessions = await loadSessionsForRelationship(relationshipId);
  return sessions[0] || null;
}

// ── IDEAL PROFILE ─────────────────────────────────────────────────────────────
// Personal reference template — never transmitted, used for internal divergence only

export async function saveIdealProfile(profile) {
  return encryptedPut('idealProfile', { ...profile, id: 'ideal' });
}

export async function loadIdealProfile() {
  return encryptedGet('idealProfile', 'ideal');
}

// ── SESSION FACTORY ───────────────────────────────────────────────────────────

export function createEmptySession(relationshipId) {
  const domainIds = [
    'friendship', 'communication', 'domestic', 'cocaregiving',
    'lifepartner', 'collaborating', 'emotionalintimacy', 'emotionalsupport',
    'socialpartners', 'finances', 'caretaking', 'business',
    'romance', 'physicality', 'touch', 'sex', 'kink', 'powerdynamic',
  ];
  const domains = {};
  domainIds.forEach(id => {
    domains[id] = {
      pass1: null,                          // { x, y }
      pass2: null,                          // { x, zBinary: 'yes'|'no', zScale: 1-5|null }
      pass3: null,                          // { agreedX, agreedZ, notes, resolved }
      notApplicable: false,
    };
  });

  return {
    id: `session_${relationshipId}_${Date.now()}`,
    relationshipId,
    pass2Seeded: null,          // null | 'ideal' | 'blank' — tracks seeding choice
    edgesUnlockRequested: false, // set to true when this partner wants mutual Edges unlock
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
