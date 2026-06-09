/**
 * dashboard.js — Main dashboard: identity, relationships, status
 */

import { loadAllRelationships, loadLatestSession, deleteRelationship, deleteKeypair, saveKeypair, clearEncryptionKey } from '../storage.js';
import { generateKeypair, exportPublicKey, hashPublicKey } from '../crypto.js';
import { generateIdenticon, svgToDataURL } from '../identity.js';
import { shortFingerprint } from '../identity.js';
import { state, navigate, toast, renderNav } from './app.js';

export async function renderDashboard() {
  const wrap = document.createElement('div');

  const identity = state.identity;
  const relationships = await loadAllRelationships();
  state.relationships = relationships;

  const content = document.createElement('div');
  content.className = 'page';

  content.innerHTML = `
    <div id="identity-section" style="margin-bottom:2rem;"></div>
    <div id="relationships-section"></div>
  `;

  wrap.appendChild(content);
  const _nav = document.createElement('div');
  _nav.innerHTML = renderNav('dashboard');
  wrap.appendChild(_nav);

  setTimeout(() => {
    renderIdentityCard(content.querySelector('#identity-section'), identity);
    renderRelationshipsList(content.querySelector('#relationships-section'), relationships);
    bindNavEvents(wrap);
  }, 0);

  return wrap;
}

// ── IDENTITY CARD ─────────────────────────────────────────────────────────────

function renderIdentityCard(container, identity) {
  container.innerHTML = `
    <div style="display:flex;align-items:center;gap:1rem;margin-bottom:1.5rem;">
      <img
        src="${identity.identicon}"
        alt="Your identicon"
        class="identicon"
        style="width:52px;height:52px;"
      />
      <div style="flex:1;min-width:0;">
        <div style="font-family:var(--font-serif);font-style:italic;font-size:1.2rem;color:var(--text-primary);">
          ${identity.alias}
        </div>
        <div class="mono" style="font-size:0.65rem;margin-top:2px;">
          ${shortFingerprint(identity.keyHash)}
        </div>
      </div>
      <button class="btn btn-ghost btn-sm" id="lock-btn">Lock</button>
    </div>
  `;

  container.querySelector('#lock-btn').addEventListener('click', async () => {
    clearEncryptionKey();
    state.identity = null;
    state.relationships = [];
    state.activeRelationshipId = null;
    state.activeSession = null;
    await navigate('onboarding', { step: 'unlock' });
  });
}

// ── RELATIONSHIPS LIST ────────────────────────────────────────────────────────

function renderRelationshipsList(container, relationships) {
  if (relationships.length === 0) {
    container.innerHTML = `
      <div class="label" style="margin-bottom:1rem;">Connections</div>
      <div class="card-ghost text-center" style="padding:2.5rem 1.5rem;">
        <div style="font-size:2rem;margin-bottom:0.75rem;">🔗</div>
        <div style="font-family:var(--font-mono);font-size:0.72rem;color:var(--text-muted);margin-bottom:1rem;">
          No connections yet
        </div>
        <button class="btn btn-outline btn-sm" id="connect-first-btn">
          Connect with a Partner →
        </button>
      </div>
      <hr class="divider"/>
      <div id="standalone-section"></div>
    `;
    container.querySelector('#connect-first-btn')?.addEventListener('click', async () => { await navigate('connect'); });
    renderStandaloneSection(container.querySelector('#standalone-section'));
    return;
  }

  container.innerHTML = `
    <div class="label" style="margin-bottom:1rem;">Connections</div>
    <div class="stack stack-sm" id="rel-list"></div>
    <hr class="divider"/>
    <div id="standalone-section"></div>
    <div style="margin-top:1rem;">
      <button class="btn btn-ghost btn-sm btn-full" id="add-connection-btn">+ Add Connection</button>
    </div>
  `;

  const list = container.querySelector('#rel-list');
  relationships.forEach(rel => {
    const card = buildRelationshipCard(rel);
    list.appendChild(card);
  });

  container.querySelector('#add-connection-btn')?.addEventListener('click', async () => { await navigate('connect'); });
  renderStandaloneSection(container.querySelector('#standalone-section'));
}

function buildRelationshipCard(rel) {
  const card = document.createElement('div');
  card.className = 'relationship-card';

  const passStatus = getPassStatus(rel);

  card.innerHTML = `
    <img
      src="${rel.partnerIdenticon || ''}"
      alt="${rel.partnerAlias}"
      class="identicon"
      style="width:44px;height:44px;"
    />
    <div class="relationship-info">
      <div class="relationship-name">${rel.partnerAlias}</div>
      <div class="relationship-meta">
        ${rel.edgesUnlocked ? '🔓 Edges unlocked · ' : ''}
        Last sync ${formatRelativeTime(rel.lastSyncAt)}
      </div>
    </div>
    <div class="stack stack-xs" style="align-items:flex-end;">
      <div class="relationship-pass-indicator">
        <div class="pass-pip ${passStatus.pass1 === 'done' ? 'done' : passStatus.pass1 === 'active' ? 'active' : ''}"></div>
        <div class="pass-pip ${passStatus.pass2 === 'done' ? 'done' : passStatus.pass2 === 'active' ? 'active' : ''}"></div>
        <div class="pass-pip ${passStatus.pass3 === 'done' ? 'done' : passStatus.pass3 === 'active' ? 'active' : ''}"></div>
      </div>
      <div class="mono" style="font-size:0.6rem;">Pass ${passStatus.current}</div>
    </div>
  `;

  card.addEventListener('click', async () => {
    state.activeRelationshipId = rel.id;
    const session = await loadLatestSession(rel.id);
    state.activeSession = session;
    await navigate('survey', { currentPass: passStatus.current, activeRelationshipId: rel.id });
  });

  // Long press for options
  let pressTimer;
  card.addEventListener('touchstart', () => {
    pressTimer = setTimeout(() => showRelationshipOptions(rel, card), 600);
  });
  card.addEventListener('touchend', () => clearTimeout(pressTimer));
  card.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showRelationshipOptions(rel, card);
  });

  return card;
}

function getPassStatus(rel) {
  // Simplified — in production would check actual session signoffs
  return { pass1: 'active', pass2: 'pending', pass3: 'pending', current: 1 };
}

function showRelationshipOptions(rel, card) {
  const existing = document.querySelector('.relationship-options-menu');
  if (existing) existing.remove();

  const menu = document.createElement('div');
  menu.className = 'card-sm relationship-options-menu';
  menu.style.cssText = `
    position:fixed;bottom:80px;left:1rem;right:1rem;z-index:500;
    background:var(--elevated);border:1px solid var(--border-active);
  `;

  menu.innerHTML = `
    <div style="font-family:var(--font-mono);font-size:0.72rem;color:var(--text-muted);margin-bottom:0.75rem;">
      ${rel.partnerAlias}
    </div>
    <div class="stack stack-sm">
      <button class="btn btn-ghost btn-sm btn-full" id="opt-sync">Sync via Connect</button>
      <button class="btn btn-ghost btn-sm btn-full" id="opt-edges">
        ${rel.edgesUnlocked ? 'Re-lock Edges' : 'Request Edges Unlock'}
      </button>
      <button class="btn btn-danger btn-sm btn-full" id="opt-disconnect">Disconnect & Rotate Keys</button>
      <button class="btn btn-ghost btn-sm btn-full" id="opt-cancel">Cancel</button>
    </div>
  `;

  document.body.appendChild(menu);

  menu.querySelector('#opt-sync').addEventListener('click', async () => {
    menu.remove();
    state.activeRelationshipId = rel.id;
    await navigate('connect');
  });

  menu.querySelector('#opt-edges').addEventListener('click', () => {
    menu.remove();
    toast(rel.edgesUnlocked ? 'Edges re-lock requires partner confirmation' : 'Edges unlock request sent to partner');
  });

  menu.querySelector('#opt-disconnect').addEventListener('click', async () => {
    menu.remove();
    if (confirm(`Disconnect from ${rel.partnerAlias}? This will delete all session history and rotate your keys.`)) {
      // Delete relationship and all associated sessions
      await deleteRelationship(rel.id);

      // Rotate keypair — delete old, generate fresh, persist to IDB
      await deleteKeypair();
      const newKeypair = await generateKeypair();
      const newPublicKeyB64 = await exportPublicKey(newKeypair.publicKey);
      const newKeyHash = await hashPublicKey(newPublicKeyB64);
      const newIdenticon = svgToDataURL(generateIdenticon(newKeyHash));
      await saveKeypair(newKeypair);

      // Update stored identity with rotated public key
      const { saveIdentity } = await import('../storage.js');
      const identity = state.identity;
      if (identity) {
        identity.publicKey = newPublicKeyB64;
        identity.keyHash = newKeyHash;
        identity.identicon = newIdenticon;
        await saveIdentity(identity);
        state.identity = identity;
      }

      toast('Disconnected — cryptographic identity rotated.');
      await navigate('dashboard');
    }
  });

  menu.querySelector('#opt-cancel').addEventListener('click', () => menu.remove());

  // Tap outside to close
  setTimeout(() => {
    document.addEventListener('click', () => menu.remove(), { once: true });
  }, 100);
}

// ── STANDALONE SECTION ────────────────────────────────────────────────────────

function renderStandaloneSection(container) {
  if (!container) return;
  container.innerHTML = `
    <div class="label" style="margin-bottom:0.75rem;">My Ideal</div>
    <div class="card" style="cursor:pointer;" id="ideal-btn">
      <div style="display:flex;align-items:center;justify-content:space-between;">
        <div>
          <div style="font-size:0.88rem;margin-bottom:0.2rem;">Your Unconstrained Design</div>
          <div style="font-family:var(--font-mono);font-size:0.7rem;color:var(--text-muted);">
            Internal only · Never shared · Seeds Pass 2 in new connections
          </div>
        </div>
        <span style="color:var(--text-muted);font-size:1.2rem;">→</span>
      </div>
    </div>
  `;

  container.querySelector('#ideal-btn').addEventListener('click', async () => {
    await navigate('ideal');
  });
}

// ── UTILITIES ─────────────────────────────────────────────────────────────────

function formatRelativeTime(timestamp) {
  if (!timestamp) return 'never';
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

function bindNavEvents(wrap) {
  wrap.querySelectorAll('[data-nav]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const target = btn.dataset.nav;
      if (target === 'dashboard') await navigate('dashboard');
      else if (target === 'survey') await navigate('survey', { currentPass: state.currentPass || 1 });
      else if (target === 'connect') await navigate('connect');
    });
  });
}
