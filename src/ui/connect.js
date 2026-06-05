/**
 * connect.js — QR handshake, WebRTC connection, partner sync
 */

import {
  createOffer, receiveAnswer, receiveOfferAndAnswer,
  sendPayload, decryptPayload, closeConnection,
  setMessageHandler, setStateChangeHandler,
  serializeForQR, deserializeFromQR,
} from '../webrtc.js';
import {
  saveRelationship, loadRelationship, loadAllRelationships,
  saveSession, loadLatestSession, createEmptySession,
  getActiveKeypair,
} from '../storage.js';
import { hashPublicKey } from '../crypto.js';
import { generateIdenticon, svgToDataURL, shortFingerprint } from '../identity.js';
import { state, navigate, toast, renderNav } from './app.js';

export async function renderConnect() {
  const wrap = document.createElement('div');

  const content = document.createElement('div');
  content.className = 'page';

  content.innerHTML = `
    <div style="margin-bottom:2rem;">
      <div class="label" style="margin-bottom:0.25rem;">Connect</div>
      <div class="display display-sm">Partner Sync</div>
      <p style="font-family:var(--font-serif);font-style:italic;color:var(--text-muted);font-size:0.9rem;line-height:1.6;margin-top:0.5rem;">
        Establish a direct encrypted connection with your partner to exchange pass data or sync agreements.
      </p>
    </div>

    <div id="connect-body"></div>
  `;

  wrap.appendChild(content);
  wrap.innerHTML += renderNav('connect');

  setTimeout(() => {
    renderConnectOptions(content.querySelector('#connect-body'));
    bindNavEvents(wrap);
  }, 0);

  return wrap;
}

// ── CONNECT OPTIONS ───────────────────────────────────────────────────────────

function renderConnectOptions(container) {
  container.innerHTML = `
    <div class="stack stack-md">
      <div class="card" style="cursor:pointer;" id="btn-show-qr">
        <div style="display:flex;align-items:center;gap:1rem;">
          <div style="font-size:2rem;">📲</div>
          <div>
            <div style="font-size:0.9rem;font-weight:400;margin-bottom:0.2rem;">Show My QR</div>
            <div style="font-family:var(--font-mono);font-size:0.72rem;color:var(--text-muted);">
              Generate a calling card for your partner to scan
            </div>
          </div>
        </div>
      </div>

      <div class="card" style="cursor:pointer;" id="btn-scan-qr">
        <div style="display:flex;align-items:center;gap:1rem;">
          <div style="font-size:2rem;">📷</div>
          <div>
            <div style="font-size:0.9rem;font-weight:400;margin-bottom:0.2rem;">Scan Partner QR</div>
            <div style="font-family:var(--font-mono);font-size:0.72rem;color:var(--text-muted);">
              Open camera to scan your partner's calling card
            </div>
          </div>
        </div>
      </div>

      <hr class="divider" />

      <div class="label" style="margin-bottom:0.5rem;">How it works</div>
      <div class="card-sm stack stack-sm">
        <div class="connection-step">
          <div class="step-number">1</div>
          <div class="step-content">
            <div class="step-title">One partner shows their QR</div>
            <div class="step-desc">Generates an encrypted calling card containing a WebRTC offer and public key.</div>
          </div>
        </div>
        <div class="connection-step">
          <div class="step-number">2</div>
          <div class="step-content">
            <div class="step-title">Other partner scans it</div>
            <div class="step-desc">Camera reads the offer, generates an answer QR automatically.</div>
          </div>
        </div>
        <div class="connection-step">
          <div class="step-number">3</div>
          <div class="step-content">
            <div class="step-title">First partner scans the answer</div>
            <div class="step-desc">Direct encrypted P2P channel opens. No data hits a server.</div>
          </div>
        </div>
        <div class="connection-step">
          <div class="step-number">4</div>
          <div class="step-content">
            <div class="step-title">Data syncs and channel closes</div>
            <div class="step-desc">Pass data exchanges, agreements sync, connection terminates.</div>
          </div>
        </div>
      </div>
    </div>
  `;

  container.querySelector('#btn-show-qr').addEventListener('click', () => renderShowQR(container));
  container.querySelector('#btn-scan-qr').addEventListener('click', () => renderScanQR(container));
}

// ── SHOW QR (initiator) ───────────────────────────────────────────────────────

async function renderShowQR(container) {
  container.innerHTML = `
    <div class="stack stack-md">
      <div style="display:flex;align-items:center;gap:1rem;margin-bottom:0.5rem;">
        <button class="btn btn-ghost btn-sm" id="back-btn">← Back</button>
        <div class="label">Your Calling Card</div>
      </div>
      <div id="qr-status" class="badge badge-neutral pulse">Generating...</div>
      <div class="qr-container" id="qr-wrap"></div>
      <p style="font-family:var(--font-mono);font-size:0.72rem;color:var(--text-muted);text-align:center;">
        Ask your partner to scan this with their device.
      </p>
      <div id="step2-section" style="display:none;">
        <hr class="divider" />
        <div class="label" style="margin-bottom:0.75rem;">Step 2 — Scan Partner's Answer</div>
        <button class="btn btn-primary btn-full" id="scan-answer-btn">Open Camera for Answer QR</button>
      </div>
      <div id="connection-status"></div>
    </div>
  `;

  container.querySelector('#back-btn').addEventListener('click', () => renderConnectOptions(container));

  try {
    const offerPayload = await createOffer({
      publicKey: getMyPublicKey(),
      alias: state.identity.alias,
      identicon: state.identity.identicon,
    });

    const qrData = serializeForQR(offerPayload);
    await renderQRCode(container.querySelector('#qr-wrap'), qrData);

    container.querySelector('#qr-status').textContent = 'Ready to scan';
    container.querySelector('#qr-status').className = 'badge badge-success';

    // Show step 2 after a moment
    setTimeout(() => {
      container.querySelector('#step2-section').style.display = 'block';
    }, 2000);

    container.querySelector('#scan-answer-btn')?.addEventListener('click', () => {
      renderScanAnswer(container, offerPayload);
    });

    // Set up connection state handler
    setStateChangeHandler((connState) => {
      const statusEl = container.querySelector('#connection-status');
      if (!statusEl) return;
      if (connState === 'channel-open') {
        statusEl.innerHTML = `<div class="badge badge-success">🔗 Connected — exchanging data...</div>`;
        handleConnectedAsInitiator(container);
      } else if (connState === 'disconnected' || connState === 'failed') {
        statusEl.innerHTML = `<div class="badge badge-danger">Connection lost</div>`;
      }
    });

  } catch (err) {
    container.querySelector('#qr-status').textContent = 'Error: ' + err.message;
    container.querySelector('#qr-status').className = 'badge badge-danger';
  }
}

// ── SCAN QR (responder) ───────────────────────────────────────────────────────

async function renderScanQR(container) {
  container.innerHTML = `
    <div class="stack stack-md">
      <div style="display:flex;align-items:center;gap:1rem;margin-bottom:0.5rem;">
        <button class="btn btn-ghost btn-sm" id="back-btn">← Back</button>
        <div class="label">Scan Partner QR</div>
      </div>
      <p style="font-family:var(--font-serif);font-style:italic;color:var(--text-muted);font-size:0.85rem;">
        Point your camera at your partner's calling card QR code.
      </p>
      <div class="scan-viewfinder" id="viewfinder">
        <video id="scan-video" autoplay muted playsinline></video>
        <div class="scan-overlay">
          <div class="scan-frame"></div>
        </div>
      </div>
      <div id="scan-status" class="badge badge-neutral pulse text-center">Waiting for camera...</div>
      <div id="answer-qr-section" style="display:none;">
        <hr class="divider"/>
        <div class="label" style="margin-bottom:0.75rem;">Show this to your partner</div>
        <div class="qr-container" id="answer-qr-wrap"></div>
        <p style="font-family:var(--font-mono);font-size:0.72rem;color:var(--text-muted);text-align:center;">
          Ask your partner to scan this answer QR on their device.
        </p>
      </div>
      <div id="connection-status"></div>
    </div>
  `;

  container.querySelector('#back-btn').addEventListener('click', () => {
    stopCamera();
    renderConnectOptions(container);
  });

  await startCameraAndScan(container, async (data) => {
    stopCamera();
    try {
      const offerPayload = deserializeFromQR(data);
      if (offerPayload.type !== 'rae-offer') { toast('Not a valid RAE calling card'); return; }

      container.querySelector('#scan-status').textContent = 'Offer received — generating answer...';
      container.querySelector('#scan-status').className = 'badge badge-warning';

      const answerPayload = await receiveOfferAndAnswer(offerPayload, {
        publicKey: getMyPublicKey(),
        alias: state.identity.alias,
        identicon: state.identity.identicon,
      });

      const answerQRData = serializeForQR(answerPayload);
      container.querySelector('#answer-qr-section').style.display = 'block';
      await renderQRCode(container.querySelector('#answer-qr-wrap'), answerQRData);

      container.querySelector('#scan-status').textContent = 'Answer ready — waiting for connection';
      container.querySelector('#scan-status').className = 'badge badge-success';
      container.querySelector('#scan-status').classList.remove('pulse');

      // Save partner info
      await savePartnerFromPayload(offerPayload);

      setStateChangeHandler((connState) => {
        const statusEl = container.querySelector('#connection-status');
        if (!statusEl) return;
        if (connState === 'channel-open') {
          statusEl.innerHTML = `<div class="badge badge-success">🔗 Connected — exchanging data...</div>`;
          handleConnectedAsResponder(container, offerPayload);
        }
      });

    } catch (err) {
      toast('Scan error: ' + err.message);
    }
  });
}

// ── SCAN ANSWER (initiator step 2) ────────────────────────────────────────────

async function renderScanAnswer(container, offerPayload) {
  const section = document.createElement('div');
  section.className = 'stack stack-md';
  section.innerHTML = `
    <div class="label">Scan Answer QR</div>
    <div class="scan-viewfinder" id="viewfinder">
      <video id="scan-video" autoplay muted playsinline></video>
      <div class="scan-overlay"><div class="scan-frame"></div></div>
    </div>
    <div id="scan-status" class="badge badge-neutral pulse">Waiting for camera...</div>
  `;

  container.querySelector('#step2-section').replaceWith(section);

  await startCameraAndScan(container, async (data) => {
    stopCamera();
    try {
      const answerPayload = deserializeFromQR(data);
      if (answerPayload.type !== 'rae-answer') { toast('Not a valid answer QR'); return; }

      section.querySelector('#scan-status').textContent = 'Answer received — connecting...';

      await receiveAnswer(answerPayload);
      await savePartnerFromPayload(answerPayload);

    } catch (err) {
      toast('Error: ' + err.message);
    }
  });
}

// ── CONNECTED HANDLERS ────────────────────────────────────────────────────────

async function handleConnectedAsInitiator(container) {
  setMessageHandler(async ({ type, data }) => {
    if (type === 'payload') {
      await handleReceivedPayload(data, container);
    }
  });
  await sendMySession(container);
}

async function handleConnectedAsResponder(container, offerPayload) {
  setMessageHandler(async ({ type, data }) => {
    if (type === 'payload') {
      await handleReceivedPayload(data, container);
    }
  });
  await sendMySession(container);
}

async function sendMySession(container) {
  try {
    const session = state.activeSession;
    if (!session) { toast('No active session to share'); return; }

    const theirPublicKey = state.peerPublicKey;
    if (!theirPublicKey) { toast('Partner public key not found'); return; }

    const myPrivateKey = getMyPrivateKey();
    if (!myPrivateKey) {
      toast('Keypair not loaded — please lock and unlock the app');
      return;
    }

    await sendPayload({ type: 'session-sync', session }, theirPublicKey, myPrivateKey);
    toast('Session data sent to partner');
  } catch (err) {
    toast('Send error: ' + err.message);
  }
}

async function handleReceivedPayload(encryptedData, container) {
  try {
    // For prototype, handle as JSON directly
    const text = new TextDecoder().decode(encryptedData);
    const payload = JSON.parse(text);

    if (payload.type === 'session-sync' && payload.session) {
      state.partnerSession = payload.session;
      await saveRelationshipFromSession(payload.session);

      const statusEl = container.querySelector('#connection-status');
      if (statusEl) {
        statusEl.innerHTML = `
          <div class="badge badge-success" style="margin-bottom:0.75rem;">✓ Partner data received</div>
          <button class="btn btn-primary btn-full" id="go-pass3-btn" style="margin-top:0.5rem;">
            View Divergence Analysis →
          </button>
        `;
        statusEl.querySelector('#go-pass3-btn')?.addEventListener('click', () => {
          navigate('pass3');
        });
      }
      toast('Partner session received');
      closeConnection();
    }
  } catch (err) {
    console.error('Payload handling error:', err);
    toast('Error processing partner data');
  }
}

// ── PARTNER MANAGEMENT ────────────────────────────────────────────────────────

async function savePartnerFromPayload(payload) {
  const keyHash = await hashPublicKey(payload.publicKey);
  state.peerPublicKey = payload.publicKey;

  const existing = await loadRelationship(keyHash);
  if (existing) {
    state.activeRelationshipId = keyHash;
    return;
  }

  const identicon = payload.identicon || svgToDataURL(generateIdenticon(keyHash));

  const relationship = {
    id: keyHash,
    partnerAlias: payload.alias || 'Partner',
    partnerIdenticon: identicon,
    partnerPublicKey: payload.publicKey,
    partnerKeyHash: keyHash,
    status: 'active',
    edgesUnlocked: false,
    createdAt: Date.now(),
    lastSyncAt: Date.now(),
  };

  await saveRelationship(relationship);
  state.activeRelationshipId = keyHash;

  // Create empty session if none exists
  const existingSession = await loadLatestSession(keyHash);
  if (!existingSession) {
    const newSession = createEmptySession(keyHash);
    await saveSession(newSession);
    state.activeSession = newSession;
  }
}

async function saveRelationshipFromSession(theirSession) {
  if (!state.activeRelationshipId) return;
  const rel = await loadRelationship(state.activeRelationshipId);
  if (rel) {
    rel.lastSyncAt = Date.now();
    await saveRelationship(rel);
  }
}

// ── CAMERA UTILITIES ──────────────────────────────────────────────────────────

let _stream = null;
let _scanInterval = null;

async function startCameraAndScan(container, onResult) {
  try {
    _stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 640 } }
    });

    const video = container.querySelector('#scan-video');
    const statusEl = container.querySelector('#scan-status');
    if (!video) return;

    video.srcObject = _stream;
    await video.play();

    if (statusEl) {
      statusEl.textContent = 'Scanning...';
      statusEl.className = 'badge badge-warning pulse';
    }

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    _scanInterval = setInterval(() => {
      if (video.readyState !== video.HAVE_ENOUGH_DATA) return;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

      if (window.jsQR) {
        const code = window.jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: 'dontInvert',
        });
        if (code) {
          clearInterval(_scanInterval);
          if (statusEl) {
            statusEl.textContent = 'QR detected';
            statusEl.className = 'badge badge-success';
          }
          onResult(code.data);
        }
      }
    }, 200);

  } catch (err) {
    const statusEl = container.querySelector('#scan-status');
    if (statusEl) {
      statusEl.textContent = 'Camera access denied';
      statusEl.className = 'badge badge-danger';
      statusEl.classList.remove('pulse');
    }
    toast('Camera permission required for scanning');
  }
}

function stopCamera() {
  if (_scanInterval) { clearInterval(_scanInterval); _scanInterval = null; }
  if (_stream) { _stream.getTracks().forEach(t => t.stop()); _stream = null; }
}

// ── QR RENDERING ──────────────────────────────────────────────────────────────

async function renderQRCode(container, data) {
  if (!container) return;
  if (!window.QRCode) {
    container.innerHTML = `<div class="badge badge-danger">QR library not loaded</div>`;
    return;
  }

  const canvas = document.createElement('canvas');
  try {
    await window.QRCode.toCanvas(canvas, data, {
      width: 240,
      margin: 2,
      color: { dark: '#1A1410', light: '#FFFFFF' },
      errorCorrectionLevel: 'M',
    });
    container.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'qr-canvas-wrap';
    wrap.appendChild(canvas);
    container.appendChild(wrap);
  } catch (err) {
    container.innerHTML = `<div class="badge badge-danger">QR generation failed: ${err.message}</div>`;
  }
}

// ── HELPERS ───────────────────────────────────────────────────────────────────

function getMyPublicKey() {
  // Returns the base64 public key from identity (loaded at unlock)
  return state.identity?.publicKey || '';
}

function getMyPrivateKey() {
  // Returns the live CryptoKey private key from the active keypair
  // Loaded from IDB into memory during PIN unlock via loadAndActivateKeypair()
  const keypair = getActiveKeypair();
  return keypair?.privateKey || null;
}

function bindNavEvents(wrap) {
  wrap.querySelectorAll('[data-nav]').forEach(btn => {
    btn.addEventListener('click', () => {
      stopCamera();
      const target = btn.dataset.nav;
      if (target === 'dashboard') navigate('dashboard');
      else if (target === 'survey') navigate('survey', { currentPass: state.currentPass || 1 });
      else if (target === 'connect') navigate('connect');
    });
  });
}
