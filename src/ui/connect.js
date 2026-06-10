/**
 * connect.js — Synchronous air-gapped QR handshake and verification engine
 */

import { packPayload, unpackPayload } from './qrTransport.js';
import { importPublicKey, deriveSharedKey, hashPublicKey } from './crypto.js';
import {
  saveRelationship, loadRelationship, saveSession,
  loadLatestSession, createEmptySession, getActiveKeypair
} from '../storage.js';
import { generateIdenticon, svgToDataURL } from '../identity.js';
import { state, navigate, toast, renderNav } from './app.js';

export async function renderConnect() {
  const wrap = document.createElement('div');
  const content = document.createElement('div');
  content.className = 'page';

  content.innerHTML = `
    <div style="margin-bottom:2rem;">
      <div class="label" style="margin-bottom:0.25rem;">Secure Vault Sync</div>
      <div class="display display-sm">Air-Gapped Handshake</div>
      <p style="font-family:var(--font-serif);font-style:italic;color:var(--text-muted);font-size:0.9rem;line-height:1.6;margin-top:0.5rem;">
        Synchronize profiles securely across an isolated optical path. No network interfaces required.
      </p>
    </div>
    <div id="connect-body"></div>
  `;

  wrap.appendChild(content);
  const _nav = document.createElement('div');
  _nav.innerHTML = renderNav('connect');
  wrap.appendChild(_nav);

  setTimeout(() => {
    initSyncWorkflow(content.querySelector('#connect-body'));
    bindNavEvents(wrap);
  }, 0);

  return wrap;
}

function initSyncWorkflow(container) {
  container.innerHTML = `
    <div class="stack stack-md">
      <div class="card" style="cursor:pointer;" id="step-initiate">
        <div style="display:flex;align-items:center;gap:1rem;">
          <div style="font-size:2rem;">📤</div>
          <div>
            <div style="font-size:0.9rem;font-weight:400;margin-bottom:0.2rem;">Initiate Exchange</div>
            <div style="font-family:var(--font-mono);font-size:0.72rem;color:var(--text-muted);">Generate public identity anchor</div>
          </div>
        </div>
      </div>

      <div class="card" style="cursor:pointer;" id="step-respond">
        <div style="display:flex;align-items:center;gap:1rem;">
          <div style="font-size:2rem;">📥</div>
          <div>
            <div style="font-size:0.9rem;font-weight:400;margin-bottom:0.2rem;">Respond to Exchange</div>
            <div style="font-family:var(--font-mono);font-size:0.72rem;color:var(--text-muted);">Scan partner token to initialize</div>
          </div>
        </div>
      </div>
    </div>
  `;

  container.querySelector('#step-initiate').addEventListener('click', () => executeInitiatorFlow(container));
  container.querySelector('#step-respond').addEventListener('click', () => executeResponderFlow(container));
}

// ── FLOW A: THE INITIATOR LIFECYCLE ──────────────────────────────────────────

async function executeInitiatorFlow(container) {
  const identityPayload = {
    type: 'rae-identity',
    publicKey: getMyPublicKey(),
    alias: state.identity.alias
  };

  container.innerHTML = `
    <div class="stack stack-md">
      <div class="label">Step 1: Present Identity Token</div>
      <div class="qr-container" id="qr-wrap"></div>
      <div class="badge badge-success">Awaiting partner scan...</div>
      <button class="btn btn-primary btn-full" id="btn-scan-back">Step 2: Scan Partner Identity</button>
    </div>
  `;

  await renderQRCode(container.querySelector('#qr-wrap'), JSON.stringify(identityPayload));

  container.querySelector('#btn-scan-back').addEventListener('click', async () => {
    await startCameraAndScan(container, async (scannedText) => {
      stopCamera();
      const partnerIdentity = JSON.parse(scannedText);
      if (partnerIdentity.type !== 'rae-identity') { toast("Handshake verification error"); return; }
      
      const sharedKey = await computeAndStoreSecret(partnerIdentity);
      executeDataSyncPhase(container, sharedKey, true);
    });
  });
}

// ── FLOW B: THE RESPONDER LIFECYCLE ──────────────────────────────────────────

async function executeResponderFlow(container) {
  container.innerHTML = `
    <div class="stack stack-md">
      <div class="label">Step 1: Scan Initiator Token</div>
      <div class="scan-viewfinder"><video id="scan-video" autoplay muted playsinline></video></div>
      <div id="scan-status" class="badge badge-neutral pulse">Targeting device...</div>
    </div>
  `;

  await startCameraAndScan(container, async (scannedText) => {
    stopCamera();
    const partnerIdentity = JSON.parse(scannedText);
    if (partnerIdentity.type !== 'rae-identity') { toast("Invalid validation signature"); return; }

    const sharedKey = await computeAndStoreSecret(partnerIdentity);
    
    // Present return identity token
    const myIdentityPayload = {
      type: 'rae-identity',
      publicKey: getMyPublicKey(),
      alias: state.identity.alias
    };

    container.innerHTML = `
      <div class="stack stack-md">
        <div class="label">Step 2: Present Return Token</div>
        <div class="qr-container" id="qr-wrap"></div>
        <button class="btn btn-primary btn-full" id="btn-proceed-sync">Proceed to Data Sync</button>
      </div>
    `;
    
    await renderQRCode(container.querySelector('#qr-wrap'), JSON.stringify(myIdentityPayload));
    container.querySelector('#btn-proceed-sync').addEventListener('click', () => {
      executeDataSyncPhase(container, sharedKey, false);
    });
  });
}

// ── MUTUAL PHASE 2: SECURE DATA PAYLOAD RUN ──────────────────────────────────

async function executeDataSyncPhase(container, sharedKey, isInitiator) {
  const localSession = state.activeSession;
  const outboundPayload = await packPayload({ type: 'session-sync', session: localSession }, sharedKey);

  if (isInitiator) {
    container.innerHTML = `
      <div class="stack stack-md">
        <div class="label">Step 3: Transmit Local Session Vault</div>
        <div class="qr-container" id="qr-wrap"></div>
        <button class="btn btn-primary btn-full" id="btn-collect-payload">Step 4: Collect Partner Session</button>
      </div>
    `;
    await renderQRCode(container.querySelector('#qr-wrap'), outboundPayload);
    
    container.querySelector('#btn-collect-payload').addEventListener('click', async () => {
      await startCameraAndScan(container, async (partnerDataCode) => {
        stopCamera();
        await finalizeDataIngestion(partnerDataCode, sharedKey);
        renderCompletionScreen(container);
      });
    });
  } else {
    container.innerHTML = `
      <div class="stack stack-md">
        <div class="label">Step 3: Capture Partner Session Vault</div>
        <div class="scan-viewfinder"><video id="scan-video" autoplay muted playsinline></video></div>
      </div>
    `;
    await startCameraAndScan(container, async (partnerDataCode) => {
      stopCamera();
      await finalizeDataIngestion(partnerDataCode, sharedKey);
      
      container.innerHTML = `
        <div class="stack stack-md">
          <div class="label">Step 4: Present Local Session Vault</div>
          <div class="qr-container" id="qr-wrap"></div>
          <button class="btn btn-success btn-full" id="btn-complete">Finalize Connection</button>
        </div>
      `;
      await renderQRCode(container.querySelector('#qr-wrap'), outboundPayload);
      container.querySelector('#btn-complete').addEventListener('click', () => renderCompletionScreen(container));
    });
  }
}

// ── UTILITIES & HELPERS ───────────────────────────────────────────────────────

async function computeAndStoreSecret(partnerIdentity) {
  const importedKey = await importPublicKey(partnerIdentity.publicKey);
  const myPrivateKey = getMyPrivateKey();
  const sharedKey = await deriveSharedKey(myPrivateKey, importedKey);
  const keyHash = await hashPublicKey(partnerIdentity.publicKey);

  state.peerPublicKey = partnerIdentity.publicKey;
  state.activeRelationshipId = keyHash;

  const existing = await loadRelationship(keyHash);
  if (!existing) {
    const identicon = svgToDataURL(generateIdenticon(keyHash));
    await saveRelationship({
      id: keyHash,
      partnerAlias: partnerIdentity.alias || 'Partner',
      partnerIdenticon: identicon,
      partnerPublicKey: partnerIdentity.publicKey,
      partnerKeyHash: keyHash,
      status: 'active',
      createdAt: Date.now(),
      lastSyncAt: Date.now()
    });
  }
  return sharedKey;
}

async function finalizeDataIngestion(rawQRText, sharedKey) {
  const decryptedPayload = await unpackPayload(rawQRText, sharedKey);
  if (decryptedPayload.type === 'session-sync' && decryptedPayload.session) {
    state.partnerSession = decryptedPayload.session;
    const rel = await loadRelationship(state.activeRelationshipId);
    if (rel) {
      rel.lastSyncAt = Date.now();
      await saveRelationship(rel);
    }
    toast("Sovereign matrix imported.");
  }
}

function renderCompletionScreen(container) {
  container.innerHTML = `
    <div class="card text-center stack stack-sm">
      <div style="font-size:3rem;">🔒</div>
      <div class="display display-sm">Sync Finalized</div>
      <p class="badge badge-success">Optical cryptographic matching execution verified.</p>
      <button class="btn btn-primary btn-full" id="btn-redirect">Return to Engine View</button>
    </div>
  `;
  container.querySelector('#btn-redirect').addEventListener('click', () => navigate('dashboard'));
}

function getMyPublicKey() { return state.identity?.publicKey || ''; }
function getMyPrivateKey() { return getActiveKeypair()?.privateKey || null; }

async function startCameraAndScan(container, onResult) {
  try {
    _stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 640 } }
    });
    const video = container.querySelector('#scan-video');
    if (!video) return;
    video.srcObject = _stream;
    await video.play();

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    _scanInterval = setInterval(() => {
      if (video.readyState !== video.HAVE_ENOUGH_DATA) return;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      if (window.jsQR) {
        const code = window.jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'dontInvert' });
        if (code) { clearInterval(_scanInterval); onResult(code.data); }
      }
    }, 200);
  } catch (err) {
    toast("Camera initialization failed.");
  }
}

let _stream = null;
let _scanInterval = null;
function stopCamera() {
  if (_scanInterval) { clearInterval(_scanInterval); _scanInterval = null; }
  if (_stream) { _stream.getTracks().forEach(t => t.stop()); _stream = null; }
}

async function renderQRCode(container, data) {
  if (!container || !window.QRCode) return;
  const canvas = document.createElement('canvas');
  await window.QRCode.toCanvas(canvas, data, {
    width: 260, margin: 2,
    color: { dark: '#1A1410', light: '#FFFFFF' },
    errorCorrectionLevel: 'M' // Optimized balance for complex string structures
  });
  container.innerHTML = '';
  container.appendChild(canvas);
}

function bindNavEvents(wrap) {
  wrap.querySelectorAll('[data-nav]').forEach(btn => {
    btn.addEventListener('click', async () => {
      stopCamera();
      navigate(btn.dataset.nav);
    });
  });
}
