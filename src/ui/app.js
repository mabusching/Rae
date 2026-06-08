/**
 * app.js — Root application controller
 * Handles routing, global state, and view orchestration
 */

import { initDB, loadKeyMeta, hasKeyMeta, loadIdentity, isUnlocked, loadAllRelationships, loadAndActivateKeypair,clearEncryptionKey } from '../storage.js';
import { renderOnboarding } from './onboarding.js';
import { renderDashboard } from './dashboard.js';
import { renderSurvey } from './survey.js';
import { renderConnect } from './connect.js';
import { renderPass3 } from './pass3.js';

// ── GLOBAL STATE ──────────────────────────────────────────────────────────────

export const state = {
  identity: null,
  relationships: [],
  activeRelationshipId: null,
  activeSession: null,
  currentView: 'loading', // loading | onboarding | dashboard | survey | connect | pass3
  currentPass: null,
  edgesUnlocked: false,
};

// ── ROUTER ────────────────────────────────────────────────────────────────────

export async function navigate(view, params = {}) {
  state.currentView = view;
  Object.assign(state, params);
  await render();
}

async function render() {
  const app = document.getElementById('app');

  switch (state.currentView) {
    case 'loading':
      app.innerHTML = renderLoadingScreen();
      break;

    case 'onboarding':
      app.innerHTML = '';
      app.appendChild(await renderOnboarding());
      break;

    case 'dashboard':
      app.innerHTML = '';
      app.appendChild(await renderDashboard());
      break;

    case 'survey':
      app.innerHTML = '';
      app.appendChild(await renderSurvey(state.currentPass));
      break;

    case 'connect':
      app.innerHTML = '';
      app.appendChild(await renderConnect());
      break;

    case 'pass3':
      app.innerHTML = '';
      app.appendChild(await renderPass3());
      break;
  }
}

function renderLoadingScreen() {
  return `
    <div style="display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;gap:1rem;">
      <div style="font-family:var(--font-serif);font-style:italic;font-size:1.5rem;color:var(--text-secondary);">
        Relational Alignment Engine
      </div>
      <div class="spin" style="width:20px;height:20px;border:2px solid var(--border);border-top-color:var(--ember);border-radius:50%;"></div>
    </div>
  `;
}

// ── TOAST SYSTEM ──────────────────────────────────────────────────────────────

export function toast(message, duration = 3000) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }

  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  container.appendChild(el);

  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity 0.3s';
    setTimeout(() => el.remove(), 300);
  }, duration);
}

// ── BOTTOM NAV ─────────────────────────────────────────────────────────────────

export function renderNav(activeTab) {
  const tabs = [
    { id: 'dashboard', icon: iconHome(), label: 'Home' },
    { id: 'survey', icon: iconSurvey(), label: 'Survey' },
    { id: 'connect', icon: iconConnect(), label: 'Connect' },
  ];

  return `
    <nav class="bottom-nav">
      ${tabs.map(t => `
        <button class="nav-item ${activeTab === t.id ? 'active' : ''}" data-nav="${t.id}">
          ${t.icon}
          <span>${t.label}</span>
        </button>
      `).join('')}
    </nav>
  `;
}

function iconHome() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
    <path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/>
  </svg>`;
}

function iconSurvey() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
    <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"/>
  </svg>`;
}

function iconConnect() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
    <path d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"/>
  </svg>`;
}

// ── BOOT SEQUENCE ──────────────────────────────────────────────────────────────

export async function boot() {
  await initDB();
  const hasMeta = await hasKeyMeta();

  if (!hasMeta) {
    // First launch — go to onboarding
    await navigate('onboarding');
    return;
  }

  if (!isUnlocked()) {
    // Has identity but not unlocked — show PIN entry
    await navigate('onboarding', { step: 'unlock' });
    return;
  }

  // Fully unlocked (e.g. hot-reload during development)
  // Load identity and keypair into memory
  state.identity = await loadIdentity();
  await loadAndActivateKeypair();
  state.relationships = await loadAllRelationships();
  await navigate('dashboard');
}
