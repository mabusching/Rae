/**
 * webrtc.js — P2P transport layer
 * QR calling card handshake, RTCDataChannel, encrypted payload exchange
 */

import { exportPublicKey, importPublicKey, deriveSharedKey, encrypt, decrypt, bufferToBase64, base64ToBuffer } from './crypto.js';

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

const CHUNK_SIZE = 16384; // 16KB chunks for large payloads
const CONNECTION_TIMEOUT = 60000; // 60s

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

  // Wait for ICE gathering to complete
  await waitForICE(_pc);

  const publicKeyB64 = await exportPublicKey(identity.publicKey);

  return {
    type: 'rae-offer',
    sdp: _pc.localDescription.sdp,
    publicKey: publicKeyB64,
    alias: identity.alias,
    identicon: identity.identicon,
  };
}

/**
 * Step 3: Initiator receives answer from QR scan
 */
export async function receiveAnswer(answerPayload) {
  const desc = new RTCSessionDescription({ type: 'answer', sdp: answerPayload.sdp });
  await _pc.setRemoteDescription(desc);
  return {
    publicKey: answerPayload.publicKey,
    alias: answerPayload.alias,
    identicon: answerPayload.identicon,
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

  const publicKeyB64 = await exportPublicKey(identity.publicKey);

  return {
    type: 'rae-answer',
    sdp: _pc.localDescription.sdp,
    publicKey: publicKeyB64,
    alias: identity.alias,
    identicon: identity.identicon,
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
  return new Promise((resolve, reject) => {
    if (pc.iceGatheringState === 'complete') {
      resolve();
      return;
    }
    const timeout = setTimeout(() => reject(new Error('ICE timeout')), CONNECTION_TIMEOUT);
    pc.onicegatheringstatechange = () => {
      if (pc.iceGatheringState === 'complete') {
        clearTimeout(timeout);
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

/**
 * Serialize a WebRTC offer/answer to a compact JSON string for QR encoding
 * SDP can be large — we truncate non-essential lines
 */
export function serializeForQR(payload) {
  return JSON.stringify(payload);
}

export function deserializeFromQR(str) {
  return JSON.parse(str);
}
