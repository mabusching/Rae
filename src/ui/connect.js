/**
 * connect.js — Two-round QR-based connection
 *
 * Round 1 — Identity exchange (tiny ~110 char QR, any camera):
 *   Each partner: show own identity QR → scan partner's identity QR
 *   Result: both devices independently derive the same ECDH shared key
 *
 * Round 2 — Data exchange (encrypted ~400 char QR):
 *   Each partner: show own encrypted session QR → scan partner's data QR
 *   Result: partner session loaded, relationship synced
 *
 * No servers. No real-time channel. No signaling. Four scans total.
 */

import {
  buildIdentityQR, parseIdentityQR,
  buildDataQR, parseDataQR,
  deriveSharedKeyFromPartner,
  buildUnlockRequestQR, buildUnlockConfirmQR, parseUnlockQR,
} from '../webrtc.js';
import {
  saveRelationship, loadRelationship, loadAllRelationships,
  saveSession, loadLatestSession, createEmptySession,
  getActiveKeypair, clearEncryptionKey,
} from '../storage.js';
import { hashPublicKey } from '../crypto.js';
import { generateIdenticon, svgToDataURL, shortFingerprint } from '../identity.js';
import { state, navigate, toast, renderNav } from './app.js';

// ── MODULE STATE ──────────────────────────────────────────────────────────────
// Cleared at the start of each new connection session

let _sharedKey       = null;  // AES-GCM key derived after identity exchange
let _partnerPublicKey = null; // base64 string
let _partnerAlias    = '';
let _stream          = null;  // camera stream
let _scanInterval    = null;  // QR scan interval

function resetConnectionState() {
  _sharedKey        = null;
  _partnerPublicKey = null;
  _partnerAlias     = '';
  stopCamera();
}

// ── ENTRY POINT ───────────────────────────────────────────────────────────────

export async function renderConnect() {
  resetConnectionState();
  const wrap = document.createElement('div');

  const content = document.createElement('div');
  content.className = 'page';

  const isUnlockMode = state.connectMode === 'unlock';

  content.innerHTML = `
    <div style="margin-bottom:2rem;">
      <div class="label" style="margin-bottom:0.25rem;">${isUnlockMode ? 'Edges Unlock' : 'Connect'}</div>
      <div class="display display-sm">${isUnlockMode ? 'Mutual Unlock Exchange' : 'Partner Sync'}</div>
      <p style="font-family:var(--font-serif);font-style:italic;color:var(--text-muted);font-size:0.9rem;line-height:1.6;margin-top:0.5rem;">
        ${isUnlockMode
          ? "Both partners must scan each other's unlock QR. Two scans, then Edges are available."
          : 'Two rounds of QR scans. No servers, no accounts, no internet required.'}
      </p>
    </div>
    <div id="connect-body"></div>
  `;

  wrap.appendChild(content);
  const _nav = document.createElement('div');
  _nav.innerHTML = renderNav('connect');
  wrap.appendChild(_nav);

  setTimeout(() => {
    if (isUnlockMode) {
      renderUnlockOptions(content.querySelector('#connect-body'));
    } else {
      renderRound1Options(content.querySelector('#connect-body'));
    }
    bindNavEvents(wrap);
  }, 0);

  return wrap;
}

// ── ROUND 1: IDENTITY EXCHANGE ────────────────────────────────────────────────

function renderRound1Options(container) {
  const keypair = getActiveKeypair();
  if (!keypair) {
    container.innerHTML = `<div class="badge badge-danger">Keys not loaded — lock and unlock the app first.</div>`;
    return;
  }

  container.innerHTML = `
    <div class="card" style="margin-bottom:1rem;">
      <div class="label" style="margin-bottom:0.5rem;">Round 1 · Identity</div>
      <p style="font-family:var(--font-serif);font-style:italic;color:var(--text-muted);font-size:0.85rem;line-height:1.6;margin-bottom:1.25rem;">
        Exchange identity QRs with your partner. Either of you can go first.
        These are tiny — readable by any camera.
      </p>
      <div class="stack stack-sm">
        <button class="btn btn-primary btn-full" id="show-identity-btn">
          Show My Identity QR
        </button>
        <button class="btn btn-outline btn-full" id="scan-identity-btn">
          Scan Partner's QR First
        </button>
      </div>
    </div>

    <div class="card-sm" style="margin-top:0.75rem;">
      <div class="label" style="margin-bottom:0.5rem;">Returning partners</div>
      <div id="existing-relationships"></div>
    </div>
  `;

  loadExistingRelationships(container.querySelector('#existing-relationships'));

  container.querySelector('#show-identity-btn').addEventListener('click', () => {
    renderShowIdentityQR(container);
  });
  container.querySelector('#scan-identity-btn').addEventListener('click', () => {
    renderScanIdentityQR(container, false);
  });
}

// Show own identity QR, then prompt to scan partner's
async function renderShowIdentityQR(container, afterScan = false) {
  const keypair = getActiveKeypair();
  const identity = state.identity;

  container.innerHTML = `
    <div class="stack stack-md">
      <div class="row-between">
        <div class="label">Round 1 · Your Identity QR</div>
        <button class="btn btn-ghost btn-sm" id="back-btn">← Back</button>
      </div>
      <p style="font-family:var(--font-serif);font-style:italic;color:var(--text-muted);font-size:0.85rem;">
        Ask your partner to scan this with their camera.
      </p>
      <div id="identity-qr-wrap" class="qr-container"></div>
      <div class="mono text-center" style="font-size:0.65rem;opacity:0.5;">
        ${shortFingerprint(identity.keyHash)} · ${identity.alias}
      </div>
      <hr class="divider"/>
      <div class="label" style="margin-bottom:0.5rem;">They scanned it? Now scan theirs:</div>
      <button class="btn btn-primary btn-full" id="scan-their-btn">
        Scan Partner's QR →
      </button>
    </div>
  `;

  container.querySelector('#back-btn').addEventListener('click', () => {
    renderRound1Options(container);
  });
  container.querySelector('#scan-their-btn').addEventListener('click', () => {
    renderScanIdentityQR(container, true);
  });

  // Generate and display identity QR
  const qrStr = buildIdentityQR(identity.publicKey, identity.alias);
  await renderQRCode(container.querySelector('#identity-qr-wrap'), qrStr);
}

// Scan partner's identity QR, then show own if we haven't yet
async function renderScanIdentityQR(container, alreadyShownOwn) {
  container.innerHTML = `
    <div class="stack stack-md">
      <div class="row-between">
        <div class="label">Round 1 · Scan Partner QR</div>
        <button class="btn btn-ghost btn-sm" id="back-btn">← Back</button>
      </div>
      <p style="font-family:var(--font-serif);font-style:italic;color:var(--text-muted);font-size:0.85rem;">
        Point your camera at your partner's identity QR.
      </p>
      <div class="scan-viewfinder" id="viewfinder">
        <video id="scan-video" autoplay muted playsinline></video>
        <div class="scan-overlay"><div class="scan-frame"></div></div>
      </div>
      <div id="scan-status" class="badge badge-neutral pulse text-center">
        Starting camera...
      </div>
    </div>
  `;

  container.querySelector('#back-btn').addEventListener('click', () => {
    stopCamera();
    if (alreadyShownOwn) renderShowIdentityQR(container);
    else renderRound1Options(container);
  });

  startCameraAndScan(container, async (data) => {
    stopCamera();

    const statusEl = container.querySelector('#scan-status');
    if (statusEl) {
      statusEl.textContent = 'Processing...';
      statusEl.className = 'badge badge-warning';
    }

    try {
      const { publicKey, alias } = parseIdentityQR(data);

      // Derive shared key from ECDH
      const keypair = getActiveKeypair();
      _sharedKey        = await deriveSharedKeyFromPartner(keypair.privateKey, publicKey);
      _partnerPublicKey = publicKey;
      _partnerAlias     = alias;

      // Save partner relationship
      await savePartnerFromKey(publicKey, alias);

      if (!alreadyShownOwn) {
        // They scanned first — now show them ours
        renderShowIdentityQR(container, true);
      } else {
        // Both scanned — identity round complete
        renderIdentityComplete(container);
      }
    } catch (err) {
      if (statusEl) {
        statusEl.textContent = 'Error: ' + err.message;
        statusEl.className = 'badge badge-danger';
        statusEl.classList.remove('pulse');
      }
    }
  });
}

function renderIdentityComplete(container) {
  container.innerHTML = `
    <div class="stack stack-md fade-in">
      <div class="badge badge-success text-center" style="justify-content:center;">
        ✓ Identity exchange complete
      </div>
      <div class="card-sm" style="display:flex;align-items:center;gap:0.75rem;">
        <img
          src="${svgToDataURL(generateIdenticon(
            _partnerPublicKey ? _partnerPublicKey.slice(0, 32) : '0'.repeat(32)
          ))}"
          style="width:40px;height:40px;border-radius:6px;"
        />
        <div>
          <div style="font-size:0.88rem;">${_partnerAlias}</div>
          <div class="mono" style="font-size:0.65rem;color:var(--text-muted);">
            Keys matched — shared secret established
          </div>
        </div>
      </div>
      <hr class="divider" style="margin:0.25rem 0;"/>
      <div class="label" style="margin-bottom:0.25rem;">Round 2 · Data Exchange</div>
      <p style="font-family:var(--font-serif);font-style:italic;color:var(--text-muted);font-size:0.85rem;line-height:1.6;">
        Now exchange your session data. Each QR is encrypted with your shared key.
      </p>
      <button class="btn btn-primary btn-full" id="start-round2-btn">
        Continue to Data Exchange →
      </button>
    </div>
  `;

  container.querySelector('#start-round2-btn').addEventListener('click', () => {
    renderRound2Options(container);
  });
}

// ── ROUND 2: DATA EXCHANGE ────────────────────────────────────────────────────

function renderRound2Options(container) {
  container.innerHTML = `
    <div class="stack stack-md">
      <div class="label" style="margin-bottom:0.25rem;">Round 2 · Data Exchange</div>
      <p style="font-family:var(--font-serif);font-style:italic;color:var(--text-muted);font-size:0.85rem;line-height:1.6;">
        Same pattern as Round 1. Either of you can go first.
      </p>
      <button class="btn btn-primary btn-full" id="show-data-btn">
        Show My Data QR
      </button>
      <button class="btn btn-outline btn-full" id="scan-data-btn">
        Scan Partner's Data First
      </button>
    </div>
  `;

  container.querySelector('#show-data-btn').addEventListener('click', () => {
    renderShowDataQR(container);
  });
  container.querySelector('#scan-data-btn').addEventListener('click', () => {
    renderScanDataQR(container, false);
  });
}

async function renderShowDataQR(container, afterScan = false) {
  container.innerHTML = `
    <div class="stack stack-md">
      <div class="row-between">
        <div class="label">Round 2 · Your Data QR</div>
        <button class="btn btn-ghost btn-sm" id="back-btn">← Back</button>
      </div>
      <p style="font-family:var(--font-serif);font-style:italic;color:var(--text-muted);font-size:0.85rem;">
        Ask your partner to scan this. Your data is encrypted — only they can read it.
      </p>
      <div id="data-qr-status" class="badge badge-neutral pulse text-center">
        Encrypting...
      </div>
      <div id="data-qr-wrap" class="qr-container"></div>
      <hr class="divider"/>
      <div class="label" style="margin-bottom:0.5rem;">They scanned it? Now scan theirs:</div>
      <button class="btn btn-primary btn-full" id="scan-their-data-btn">
        Scan Partner's Data →
      </button>
    </div>
  `;

  container.querySelector('#back-btn').addEventListener('click', () => {
    if (afterScan) renderScanDataQR(container, true);
    else renderRound2Options(container);
  });
  container.querySelector('#scan-their-data-btn').addEventListener('click', () => {
    renderScanDataQR(container, true);
  });

  // Build and display data QR
  try {
    const sessionData = buildSessionPayload();
    const qrStr = await buildDataQR(sessionData, _sharedKey);
    const statusEl = container.querySelector('#data-qr-status');
    if (statusEl) {
      statusEl.textContent = `Encrypted · ${qrStr.length} chars`;
      statusEl.className = 'badge badge-success';
      statusEl.classList.remove('pulse');
    }
    await renderQRCode(container.querySelector('#data-qr-wrap'), qrStr);
  } catch (err) {
    const statusEl = container.querySelector('#data-qr-status');
    if (statusEl) {
      statusEl.textContent = 'Error: ' + err.message;
      statusEl.className = 'badge badge-danger';
    }
  }
}

async function renderScanDataQR(container, alreadyShownOwn) {
  container.innerHTML = `
    <div class="stack stack-md">
      <div class="row-between">
        <div class="label">Round 2 · Scan Partner Data</div>
        <button class="btn btn-ghost btn-sm" id="back-btn">← Back</button>
      </div>
      <p style="font-family:var(--font-serif);font-style:italic;color:var(--text-muted);font-size:0.85rem;">
        Scan your partner's encrypted data QR.
      </p>
      <div class="scan-viewfinder" id="viewfinder">
        <video id="scan-video" autoplay muted playsinline></video>
        <div class="scan-overlay"><div class="scan-frame"></div></div>
      </div>
      <div id="scan-status" class="badge badge-neutral pulse text-center">
        Starting camera...
      </div>
    </div>
  `;

  container.querySelector('#back-btn').addEventListener('click', () => {
    stopCamera();
    if (alreadyShownOwn) renderShowDataQR(container, true);
    else renderRound2Options(container);
  });

  startCameraAndScan(container, async (data) => {
    stopCamera();
    const statusEl = container.querySelector('#scan-status');
    if (statusEl) {
      statusEl.textContent = 'Decrypting...';
      statusEl.className = 'badge badge-warning';
    }

    try {
      const partnerData = await parseDataQR(data, _sharedKey);
      await savePartnerSessionData(partnerData);

      if (!alreadyShownOwn) {
        // They shared first — now show ours
        renderShowDataQR(container, true);
      } else {
        // Both rounds complete
        renderSyncComplete(container);
      }
    } catch (err) {
      if (statusEl) {
        statusEl.textContent = 'Decrypt failed — wrong partner or mismatched keys?';
        statusEl.className = 'badge badge-danger';
        statusEl.classList.remove('pulse');
      }
      console.error('[RAE] Data QR decrypt error:', err);
    }
  });
}

function renderSyncComplete(container) {
  container.innerHTML = `
    <div class="stack stack-lg fade-in text-center" style="padding-top:1rem;">
      <div style="font-size:2.5rem;">✓</div>
      <div class="display display-sm">Synced</div>
      <p style="font-family:var(--font-serif);font-style:italic;color:var(--text-muted);font-size:0.9rem;">
        Both partners' data has been exchanged and encrypted.
        Your session is ready.
      </p>
      <div class="card-sm" style="display:flex;align-items:center;gap:0.75rem;text-align:left;">
        <img
          src="${svgToDataURL(generateIdenticon(
            _partnerPublicKey ? _partnerPublicKey.slice(0, 32) : '0'.repeat(32)
          ))}"
          style="width:40px;height:40px;border-radius:6px;"
        />
        <div>
          <div style="font-size:0.88rem;">${_partnerAlias}</div>
          <div class="mono" style="font-size:0.65rem;color:var(--success);">Connected</div>
        </div>
      </div>
      <button class="btn btn-primary btn-full" id="begin-pass1-btn">
        Begin Pass 1 →
      </button>
    </div>
  `;

  container.querySelector('#begin-pass1-btn').addEventListener('click', async () => {
    await navigate('survey', { currentPass: 1 });
  });
}


// ── EDGES UNLOCK FLOW ─────────────────────────────────────────────────────────

function renderUnlockOptions(container) {
  container.innerHTML = `
    <div class="stack stack-md">
      <div class="card" style="background:rgba(75,175,125,0.06);border-color:rgba(75,175,125,0.25);">
        <div class="label" style="color:var(--edges);margin-bottom:0.5rem;">How it works</div>
        <p style="font-family:var(--font-serif);font-style:italic;color:var(--text-muted);font-size:0.85rem;line-height:1.6;">
          Show your unlock QR → partner scans and confirms → partner shows theirs → you scan.
          Both devices unlock simultaneously.
        </p>
      </div>
      <button class="btn btn-primary btn-full" id="show-unlock-btn">Show My Unlock QR</button>
      <button class="btn btn-outline btn-full" id="scan-unlock-btn">Scan Partner's Unlock QR First</button>
    </div>
  `;
  container.querySelector('#show-unlock-btn').addEventListener('click', () => renderShowUnlockQR(container, false));
  container.querySelector('#scan-unlock-btn').addEventListener('click', () => renderScanUnlockQR(container, false));
}

async function renderShowUnlockQR(container, afterScan) {
  const identity = state.identity;
  container.innerHTML = `
    <div class="stack stack-md">
      <div class="row-between">
        <div class="label">Your Unlock QR</div>
        <button class="btn btn-ghost btn-sm" id="back-btn">← Back</button>
      </div>
      <p style="font-family:var(--font-serif);font-style:italic;color:var(--text-muted);font-size:0.85rem;">
        Ask your partner to scan this, then tap confirm on their device.
      </p>
      <div id="unlock-qr-wrap" class="qr-container"></div>
      <hr class="divider"/>
      <div class="label" style="margin-bottom:0.5rem;">They confirmed? Now scan theirs:</div>
      <button class="btn btn-primary btn-full" id="scan-their-unlock-btn">Scan Partner's QR →</button>
    </div>
  `;
  container.querySelector('#back-btn').addEventListener('click', () => renderUnlockOptions(container));
  container.querySelector('#scan-their-unlock-btn').addEventListener('click', () => renderScanUnlockQR(container, true));
  const qrStr = buildUnlockRequestQR(identity.publicKey);
  await renderQRCode(container.querySelector('#unlock-qr-wrap'), qrStr);
}

async function renderScanUnlockQR(container, alreadyShownOwn) {
  container.innerHTML = `
    <div class="stack stack-md">
      <div class="row-between">
        <div class="label">Scan Unlock QR</div>
        <button class="btn btn-ghost btn-sm" id="back-btn">← Back</button>
      </div>
      <div class="scan-viewfinder" id="viewfinder">
        <video id="scan-video" autoplay muted playsinline></video>
        <div class="scan-overlay"><div class="scan-frame"></div></div>
      </div>
      <div id="scan-status" class="badge badge-neutral pulse text-center">Starting camera...</div>
    </div>
  `;
  container.querySelector('#back-btn').addEventListener('click', () => {
    stopCamera();
    if (alreadyShownOwn) renderShowUnlockQR(container, true);
    else renderUnlockOptions(container);
  });
  startCameraAndScan(container, async (data) => {
    stopCamera();
    const statusEl = container.querySelector('#scan-status');
    try {
      const { type, publicKey } = parseUnlockQR(data);
      const rel = state.activeRelationshipId ? await loadRelationship(state.activeRelationshipId) : null;
      if (rel && rel.partnerPublicKey !== publicKey) throw new Error('QR is from an unknown partner');
      if (type === 'edges-req') {
        renderConfirmUnlock(container, publicKey, alreadyShownOwn);
      } else if (type === 'edges-ok') {
        await setEdgesUnlocked();
        renderUnlockComplete(container);
      }
    } catch (err) {
      if (statusEl) {
        statusEl.textContent = 'Error: ' + err.message;
        statusEl.className = 'badge badge-danger';
        statusEl.classList.remove('pulse');
      }
    }
  });
}

async function renderConfirmUnlock(container, partnerPublicKey, alreadyShownOwn) {
  container.innerHTML = `
    <div class="stack stack-md fade-in">
      <div class="display display-sm">Confirm Edges Unlock</div>
      <p style="font-family:var(--font-serif);font-style:italic;color:var(--text-muted);font-size:0.9rem;line-height:1.6;">
        Your partner is requesting mutual Edges access. Confirming unlocks Romance,
        Physicality, Touch, Sex, Kink, and Power Dynamic for both of you.
        This requires mutual consent — this is it.
      </p>
      <button class="btn btn-primary btn-full" id="confirm-unlock-btn"
        style="background:var(--edges);border-color:var(--edges);">✓ Confirm Unlock</button>
      <button class="btn btn-ghost btn-full" id="decline-btn">Not now</button>
    </div>
  `;
  container.querySelector('#confirm-unlock-btn').addEventListener('click', async () => {
    await setEdgesUnlocked();
    if (!alreadyShownOwn) renderShowConfirmQR(container);
    else renderUnlockComplete(container);
  });
  container.querySelector('#decline-btn').addEventListener('click', () => renderUnlockOptions(container));
}

async function renderShowConfirmQR(container) {
  const identity = state.identity;
  container.innerHTML = `
    <div class="stack stack-md fade-in">
      <div class="badge badge-success text-center" style="justify-content:center;">✓ Edges unlocked on your device</div>
      <div class="label">Show Confirmation QR</div>
      <p style="font-family:var(--font-serif);font-style:italic;color:var(--text-muted);font-size:0.85rem;">
        Ask your partner to scan this to unlock Edges on their device too.
      </p>
      <div id="confirm-qr-wrap" class="qr-container"></div>
    </div>
  `;
  const qrStr = buildUnlockConfirmQR(identity.publicKey);
  await renderQRCode(container.querySelector('#confirm-qr-wrap'), qrStr);
}

function renderUnlockComplete(container) {
  container.innerHTML = `
    <div class="stack stack-lg fade-in text-center" style="padding-top:1rem;">
      <div style="font-size:2.5rem;">🔓</div>
      <div class="display display-sm">Edges Unlocked</div>
      <p style="font-family:var(--font-serif);font-style:italic;color:var(--text-muted);font-size:0.9rem;">
        Both partners confirmed. Edges domains are now available in your surveys.
      </p>
      <button class="btn btn-primary btn-full" id="back-survey-btn">Return to Survey →</button>
    </div>
  `;
  container.querySelector('#back-survey-btn').addEventListener('click', async () => {
    await navigate('survey', { currentPass: state.currentPass || 1 });
  });
}

async function setEdgesUnlocked() {
  if (!state.activeRelationshipId) return;
  const rel = await loadRelationship(state.activeRelationshipId);
  if (rel) {
    rel.edgesUnlocked = true;
    await saveRelationship(rel);
    toast('Edges unlocked');
  }
}

// ── EXISTING RELATIONSHIPS ────────────────────────────────────────────────────

async function loadExistingRelationships(container) {
  try {
    const rels = await loadAllRelationships();
    if (!rels.length) {
      container.innerHTML = `<div style="font-size:0.78rem;color:var(--text-muted);">No prior connections.</div>`;
      return;
    }
    container.innerHTML = rels.map(rel => `
      <div class="row-between" style="padding:0.5rem 0;border-bottom:1px solid var(--border);cursor:pointer;"
        data-rel-id="${rel.id}">
        <div style="display:flex;align-items:center;gap:0.5rem;">
          <img src="${rel.partnerIdenticon}" style="width:28px;height:28px;border-radius:4px;"/>
          <span style="font-size:0.82rem;">${rel.partnerAlias}</span>
        </div>
        <span style="font-size:0.72rem;color:var(--text-muted);">Resume →</span>
      </div>
    `).join('');

    container.querySelectorAll('[data-rel-id]').forEach(el => {
      el.addEventListener('click', async () => {
        const id = el.dataset.relId;
        state.activeRelationshipId = id;
        const session = await loadLatestSession(id);
        state.activeSession = session;
        await navigate('survey', { currentPass: session?.signoffs?.pass1?.mine ? 2 : 1 });
      });
    });
  } catch (err) {
    container.innerHTML = `<div style="font-size:0.78rem;color:var(--danger);">Could not load connections.</div>`;
  }
}

// ── DATA HELPERS ──────────────────────────────────────────────────────────────

function buildSessionPayload() {
  // Send the active session — only what's been filled in
  const session = state.activeSession;
  if (!session) throw new Error('No active session — complete at least Pass 1 first');
  return {
    type: 'session-sync',
    session: {
      relationshipId: session.relationshipId,
      domains: session.domains,
      signoffs: session.signoffs,
    },
  };
}

async function savePartnerFromKey(publicKey, alias) {
  const keyHash = await hashPublicKey(publicKey);
  const identiconSVG = generateIdenticon(keyHash);
  const identiconURL = svgToDataURL(identiconSVG);

  state.peerPublicKey = publicKey;

  const existing = await loadRelationship(keyHash);
  if (existing) {
    state.activeRelationshipId = keyHash;
    const session = await loadLatestSession(keyHash);
    state.activeSession = session;
    return;
  }

  const relationship = {
    id: keyHash,
    partnerAlias: alias,
    partnerIdenticon: identiconURL,
    partnerPublicKey: publicKey,
    partnerKeyHash: keyHash,
    status: 'active',
    edgesUnlocked: false,
    createdAt: Date.now(),
    lastSyncAt: Date.now(),
  };

  await saveRelationship(relationship);
  state.activeRelationshipId = keyHash;

  const session = await loadLatestSession(keyHash);
  if (!session) {
    const newSession = createEmptySession(keyHash);
    await saveSession(newSession);
    state.activeSession = newSession;
  } else {
    state.activeSession = session;
  }
}

async function savePartnerSessionData(partnerData) {
  if (partnerData.type !== 'session-sync' || !partnerData.session) {
    throw new Error('Unexpected data format');
  }
  state.partnerSession = partnerData.session;

  if (state.activeRelationshipId) {
    const rel = await loadRelationship(state.activeRelationshipId);
    if (rel) {
      rel.lastSyncAt = Date.now();

      // Mutual Edges unlock — both partners must have flagged it
      const mySession = state.activeSession;
      const theirSession = partnerData.session;
      if (
        !rel.edgesUnlocked &&
        mySession?.edgesUnlockRequested &&
        theirSession?.edgesUnlockRequested
      ) {
        rel.edgesUnlocked = true;
        toast('✓ Edges unlocked — both partners confirmed');
      }

      // Merge their signoffs into our session so we see their status
      if (mySession && theirSession?.signoffs) {
        mySession.signoffs.pass1.theirs = theirSession.signoffs?.pass1?.mine || false;
        mySession.signoffs.pass2.theirs = theirSession.signoffs?.pass2?.mine || false;
        mySession.updatedAt = Date.now();
        await saveSession(mySession);
      }

      await saveRelationship(rel);
    }
  }
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
      errorCorrectionLevel: 'L',
    });
    container.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'qr-canvas-wrap';
    wrap.appendChild(canvas);
    container.appendChild(wrap);
  } catch (err) {
    container.innerHTML = `<div class="badge badge-danger">QR error: ${err.message}</div>`;
  }
}

// ── CAMERA ────────────────────────────────────────────────────────────────────

function startCameraAndScan(container, onResult) {
  navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 640 } }
  }).then(async stream => {
    _stream = stream;
    const video = container.querySelector('#scan-video');
    const statusEl = container.querySelector('#scan-status');
    if (!video) return;

    video.srcObject = stream;
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
          _scanInterval = null;
          onResult(code.data);
        }
      }
    }, 200);
  }).catch(err => {
    const statusEl = container.querySelector('#scan-status');
    if (statusEl) {
      statusEl.textContent = 'Camera access denied';
      statusEl.className = 'badge badge-danger';
      statusEl.classList.remove('pulse');
    }
  });
}

function stopCamera() {
  if (_scanInterval) { clearInterval(_scanInterval); _scanInterval = null; }
  if (_stream) { _stream.getTracks().forEach(t => t.stop()); _stream = null; }
}

// ── NAV ───────────────────────────────────────────────────────────────────────

function bindNavEvents(wrap) {
  wrap.querySelectorAll('[data-nav]').forEach(btn => {
    btn.addEventListener('click', async () => {
      stopCamera();
      const target = btn.dataset.nav;
      if (target === 'dashboard') await navigate('dashboard');
      else if (target === 'survey') await navigate('survey', { currentPass: state.currentPass || 1 });
      else if (target === 'connect') await navigate('connect');
    });
  });
}
