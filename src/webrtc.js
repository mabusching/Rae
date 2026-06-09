/**
 * webrtc.js — P2P transport layer
 * QR calling card handshake, RTCDataChannel, encrypted payload exchange
 */

import { importPublicKey, deriveSharedKey, encrypt, decrypt } from './crypto.js';

// No STUN servers for local network mode.
// STUN is for NAT traversal across the internet — on a shared local network,
// host candidates (local IP addresses) are gathered immediately and are
// sufficient for device-to-device connections. STUN causes the ICE timeout.
const ICE_SERVERS = [];

const CHUNK_SIZE = 16384; // 16KB chunks for large payloads
const ICE_GATHER_TIMEOUT = 3000; // 3s max wait — host candidates arrive in <500ms locally

// ── CONNECTION STATE ──────────────────────────────────────────────────────────

let _pc = null;           // RTCPeerConnection
let _dc = null;           // RTCDataChannel
let _onMessage = null;    // Message handler callback
let _onStateChange = null;
let _receiveBuffer = [];
let _receivedSize = 0;
let _expectedSize = 0;

export function setMessageHandler(fn) { _onMessage = fn; }
export function setStateChangeHandler(fn) { _onStateChange = fn; }

export function getConnectionState() {
  return _pc?.connectionState || 'disconnected';
}

// ── INITIATOR FLOW (generates offer QR) ──────────────────────────────────────

/**
 * Step 1: Initiator creates offer
 * Returns an offer payload to encode as QR
 */
export async function createOffer(identity) {
  _pc = createPeerConnection();
  _dc = _pc.createDataChannel('rae', { ordered: true });
  setupDataChannel(_dc);

  const offer = await _pc.createOffer();
  await _pc.setLocalDescription(offer);

  // Wait for ICE gathering (or timeout) before encoding QR
  // On local network, host candidates arrive within ~500ms
  await waitForICE(_pc);

  // identity.publicKey is already base64 — stored that way in the identity record
  // identicon is intentionally excluded — receiver derives it from the public key
  return {
    type: 'rae-offer',
    sdp: _pc.localDescription.sdp,
    publicKey: identity.publicKey,
    alias: identity.alias,
  };
}

/**
 * Step 3: Initiator receives answer from QR scan
 */
export async function receiveAnswer(answerPayload) {
  const desc = new RTCSessionDescription({ type: 'answer', sdp: answerPayload.sdp });
  await _pc.setRemoteDescription(desc);
  // identicon derived from publicKey on receiving end — not transmitted
  return {
    publicKey: answerPayload.publicKey,
    alias: answerPayload.alias,
  };
}

// ── RESPONDER FLOW (scans offer QR, generates answer QR) ─────────────────────

/**
 * Step 2: Responder receives offer, creates answer
 * Returns an answer payload to encode as QR
 */
export async function receiveOfferAndAnswer(offerPayload, identity) {
  _pc = createPeerConnection();

  // Responder waits for data channel from initiator
  _pc.ondatachannel = (e) => {
    _dc = e.channel;
    setupDataChannel(_dc);
  };

  const desc = new RTCSessionDescription({ type: 'offer', sdp: offerPayload.sdp });
  await _pc.setRemoteDescription(desc);

  const answer = await _pc.createAnswer();
  await _pc.setLocalDescription(answer);

  await waitForICE(_pc);

  // identicon intentionally excluded — receiver derives it from the public key
  return {
    type: 'rae-answer',
    sdp: _pc.localDescription.sdp,
    publicKey: identity.publicKey,
    alias: identity.alias,
    offerPublicKey: offerPayload.publicKey,
  };
}

// ── PEER CONNECTION SETUP ─────────────────────────────────────────────────────

function createPeerConnection() {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

  pc.onconnectionstatechange = () => {
    console.log('[WebRTC] Connection state:', pc.connectionState);
    _onStateChange?.(pc.connectionState);
  };

  pc.onicecandidateerror = (e) => {
    console.warn('[WebRTC] ICE candidate error:', e.errorText);
  };

  return pc;
}

function setupDataChannel(dc) {
  dc.binaryType = 'arraybuffer';

  dc.onopen = () => {
    console.log('[WebRTC] Data channel open');
    _onStateChange?.('channel-open');
  };

  dc.onclose = () => {
    console.log('[WebRTC] Data channel closed');
    _onStateChange?.('channel-closed');
  };

  dc.onmessage = (e) => {
    handleIncomingChunk(e.data);
  };
}

function waitForICE(pc) {
  // Resolves when ICE gathering completes OR after timeout — never rejects.
  // On a local network, host candidates arrive in <500ms.
  // We wait up to 3s then proceed with whatever candidates we have.
  // This is the correct approach for QR-based signaling: encode the SDP
  // with gathered candidates and display the QR immediately.
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      console.log('[WebRTC] ICE gather timeout — proceeding with available candidates');
      resolve();
    }, ICE_GATHER_TIMEOUT);

    pc.onicegatheringstatechange = () => {
      if (pc.iceGatheringState === 'complete') {
        clearTimeout(timer);
        resolve();
      }
    };
  });
}

// ── CHUNKED MESSAGING ─────────────────────────────────────────────────────────

/**
 * Send an encrypted payload over the data channel
 * Automatically chunks large messages
 */
export async function sendPayload(data, theirPublicKeyB64, myPrivateKey) {
  if (!_dc || _dc.readyState !== 'open') {
    throw new Error('Data channel not open');
  }

  const theirPublicKey = await importPublicKey(theirPublicKeyB64);
  const sharedKey = await deriveSharedKey(myPrivateKey, theirPublicKey);

  const json = JSON.stringify(data);
  const encrypted = await encrypt(sharedKey, json);
  const bytes = new Uint8Array(encrypted);

  // Send header with total size
  const header = JSON.stringify({ type: 'rae-payload', size: bytes.byteLength });
  _dc.send(header);

  // Send in chunks
  for (let i = 0; i < bytes.byteLength; i += CHUNK_SIZE) {
    const chunk = bytes.slice(i, i + CHUNK_SIZE);
    _dc.send(chunk.buffer);
    // Small yield to prevent buffering
    if (i % (CHUNK_SIZE * 10) === 0) await new Promise(r => setTimeout(r, 10));
  }
}

function handleIncomingChunk(data) {
  if (typeof data === 'string') {
    // Header message
    try {
      const header = JSON.parse(data);
      if (header.type === 'rae-payload') {
        _receiveBuffer = [];
        _receivedSize = 0;
        _expectedSize = header.size;
      } else if (header.type === 'rae-signal') {
        _onMessage?.({ type: 'signal', data: header });
      }
    } catch (e) {
      console.error('[WebRTC] Bad header:', e);
    }
  } else {
    // Binary chunk
    _receiveBuffer.push(data);
    _receivedSize += data.byteLength;

    if (_expectedSize > 0 && _receivedSize >= _expectedSize) {
      // Reassemble
      const combined = new Uint8Array(_receivedSize);
      let offset = 0;
      for (const chunk of _receiveBuffer) {
        combined.set(new Uint8Array(chunk), offset);
        offset += chunk.byteLength;
      }
      _receiveBuffer = [];
      _receivedSize = 0;
      _expectedSize = 0;
      _onMessage?.({ type: 'payload', data: combined.buffer });
    }
  }
}

/**
 * Decrypt a received payload
 */
export async function decryptPayload(encryptedBuffer, theirPublicKeyB64, myPrivateKey) {
  const theirPublicKey = await importPublicKey(theirPublicKeyB64);
  const sharedKey = await deriveSharedKey(myPrivateKey, theirPublicKey);
  const json = await decrypt(sharedKey, encryptedBuffer);
  return JSON.parse(json);
}

// ── SIGNALING ─────────────────────────────────────────────────────────────────

/**
 * Send a signaling message (sign-off notification, etc)
 */
export function sendSignal(type, data = {}) {
  if (!_dc || _dc.readyState !== 'open') return false;
  const msg = JSON.stringify({ type: 'rae-signal', signal: type, ...data });
  _dc.send(msg);
  return true;
}

// ── TEARDOWN ──────────────────────────────────────────────────────────────────

export function closeConnection() {
  if (_dc) { _dc.close(); _dc = null; }
  if (_pc) { _pc.close(); _pc = null; }
  _receiveBuffer = [];
  _receivedSize = 0;
  _expectedSize = 0;
}

// ── QR PAYLOAD SERIALIZATION ──────────────────────────────────────────────────
//
// Compression pipeline: JSON → deflate-raw → base64
// Reduces a typical 700-char SDP payload to ~300 chars → Version 10 QR, easy scan.
// identicon is never included — receiver derives it deterministically from publicKey.
// Falls back to plain JSON if CompressionStream is unavailable.

export async function serializeForQR(payload) {
  const json = JSON.stringify(payload);
  try {
    const compressed = await deflate(json);
    // Prefix 'z:' so the receiver knows to decompress
    return 'z:' + compressed;
  } catch {
    // Fallback: uncompressed plain JSON
    return json;
  }
}

export async function deserializeFromQR(str) {
  if (str.startsWith('z:')) {
    const json = await inflate(str.slice(2));
    return JSON.parse(json);
  }
  return JSON.parse(str);
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
  // Use base64url (no +/= padding issues in QR alphanumeric mode)
  return btoa(String.fromCharCode(...merged))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function inflate(b64url) {
  // Restore standard base64
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
