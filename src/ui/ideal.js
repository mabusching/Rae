/**
 * ideal.js — My Ideal profile editor
 *
 * Personal reference template across 18 domains.
 * Uses Pass 2 question framing (aspirational, "I would want...").
 * Internal only — never transmitted in any payload.
 * Used as optional seed when starting Pass 2 in a new relationship sandbox.
 */

import { DOMAINS, CATEGORIES, getDomainsByCategory, X_LABELS, Z_BINARY_STATEMENT, Z_CONCENTRATED, Z_DISPERSED } from '../domains.js';
import { saveIdealProfile, loadIdealProfile } from '../storage.js';
import { state, navigate, toast, renderNav } from './app.js';

export async function renderIdeal() {
  const wrap = document.createElement('div');

  // Load existing ideal profile if any
  let ideal = await loadIdealProfile();
  if (!ideal) {
    ideal = { id: 'ideal', domains: {}, updatedAt: null };
    DOMAINS.forEach(d => {
      ideal.domains[d.id] = { x: null, zBinary: 'yes', zScale: null };
    });
  }

  const content = document.createElement('div');
  content.className = 'page-wide';

  content.innerHTML = `
    <div style="margin-bottom:2rem;">
      <div class="label" style="margin-bottom:0.25rem;">My Ideal</div>
      <div class="display display-sm">Your Unconstrained Design</div>
      <p style="font-family:var(--font-serif);font-style:italic;color:var(--text-muted);font-size:0.9rem;line-height:1.6;margin-top:0.5rem;">
        How would you design each domain if you were starting from scratch with no constraints?
        This is your personal reference — it never leaves your device and is never shared with anyone.
      </p>
      <div style="margin-top:0.75rem;display:flex;align-items:center;gap:0.5rem;">
        <span class="badge badge-neutral">Internal only</span>
        <span style="font-family:var(--font-mono);font-size:0.65rem;color:var(--text-muted);">
          ${ideal.updatedAt ? 'Last updated ' + new Date(ideal.updatedAt).toLocaleDateString() : 'Not yet saved'}
        </span>
      </div>
    </div>
    <div id="ideal-domains"></div>
    <div style="margin-top:2rem;display:flex;gap:1rem;align-items:center;">
      <button class="btn btn-primary" id="save-ideal-btn">Save My Ideal</button>
      <span id="save-status" style="font-family:var(--font-mono);font-size:0.72rem;color:var(--text-muted);"></span>
    </div>
  `;

  wrap.appendChild(content);

  const _nav = document.createElement('div');
  _nav.innerHTML = renderNav('dashboard');
  wrap.appendChild(_nav);

  setTimeout(() => {
    buildIdealDomains(content.querySelector('#ideal-domains'), ideal);
    wireSaveButton(content, ideal);
    bindNavEvents(wrap);
  }, 0);

  return wrap;
}

// ── DOMAIN CARDS ──────────────────────────────────────────────────────────────

function buildIdealDomains(container, ideal) {
  Object.values(CATEGORIES).forEach(category => {
    const section = document.createElement('div');
    section.className = 'category-section';

    const domains = getDomainsByCategory(category.id);
    const isEdges = category.id === 'edges';

    section.innerHTML = `
      <div class="category-header">
        <div class="category-dot" style="background:${category.color};"></div>
        <div class="category-name" style="color:${category.color};">${category.label}</div>
      </div>
    `;

    const cardsWrap = document.createElement('div');
    cardsWrap.className = 'stack stack-sm';

    domains.forEach(domain => {
      const domainData = ideal.domains[domain.id] || { x: null, zBinary: 'yes', zScale: null };
      const card = buildIdealDomainCard(domain, domainData, ideal, isEdges);
      cardsWrap.appendChild(card);
    });

    section.appendChild(cardsWrap);
    container.appendChild(section);
  });
}

function buildIdealDomainCard(domain, domainData, ideal, isEdges) {
  const xVal = domainData.x || 3;
  const zBinary = domainData.zBinary || 'yes';
  const zScale = domainData.zScale || 3;
  const isComplete = domainData.x !== null;

  const card = document.createElement('div');
  card.className = `domain-card category-${domain.category} ${isComplete ? 'complete' : ''}`;

  card.innerHTML = `
    <div class="domain-header">
      <div class="domain-title-row">
        <span class="domain-emoji">${domain.emoji}</span>
        <span class="domain-name">${domain.label}</span>
        <span class="domain-category-tag">${CATEGORIES[domain.category].label}</span>
      </div>
      <div class="domain-status-icon ${isComplete ? 'done' : 'empty'}">${isComplete ? '✓' : '○'}</div>
    </div>

    <div class="domain-body" style="display:none;">
      <!-- X: Aspirational presence -->
      <div class="question-block">
        <div class="question-axis">X · Aspirational Presence</div>
        <div class="question-text">${domain.pass2Question}</div>
        <div class="slider-value" id="ideal-x-val-${domain.id}">${X_LABELS[xVal]}</div>
        <div class="slider-wrap">
          <input type="range" min="1" max="5" step="1" value="${xVal}"
            id="ideal-x-${domain.id}" />
          <div class="slider-labels">
            ${[1,2,3,4,5].map(n => `<span class="label" style="font-size:0.55rem;">${n}</span>`).join('')}
          </div>
        </div>
      </div>

      <!-- Z: Unique to relationship binary + optional scale -->
      <div class="question-block">
        <div class="question-axis">Z · Structure</div>
        <div class="question-text">${Z_BINARY_STATEMENT}</div>
        <div class="z-binary-group" style="margin-bottom:0.75rem;">
          <div class="z-binary-options" style="grid-template-columns:1fr 1fr;">
            <button class="z-opt ${zBinary === 'yes' ? 'selected-yes' : ''}"
              id="ideal-z-yes-${domain.id}" data-val="yes">Yes</button>
            <button class="z-opt ${zBinary === 'no' ? 'selected-no' : ''}"
              id="ideal-z-no-${domain.id}" data-val="no">No</button>
          </div>
        </div>
        <div id="ideal-z-scale-${domain.id}" style="${zBinary === 'yes' ? 'display:none;' : ''}">
          <div class="slider-value" id="ideal-z-val-${domain.id}" style="font-size:0.72rem;color:var(--text-muted);"></div>
          <div class="slider-wrap">
            <input type="range" min="1" max="5" step="1" value="${zScale}"
              id="ideal-z-slider-${domain.id}" />
            <div class="slider-labels">
              <span class="label" style="font-size:0.55rem;">${Z_CONCENTRATED}</span>
              <span class="label" style="font-size:0.55rem;">${Z_DISPERSED}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  // Toggle expand
  card.querySelector('.domain-header').addEventListener('click', () => {
    const body = card.querySelector('.domain-body');
    const isOpen = body.style.display !== 'none';
    body.style.display = isOpen ? 'none' : 'block';
    card.classList.toggle('active', !isOpen);
  });

  // Wire X slider
  const xSlider = card.querySelector(`#ideal-x-${domain.id}`);
  const xValEl  = card.querySelector(`#ideal-x-val-${domain.id}`);
  xSlider.addEventListener('input', () => {
    const val = parseInt(xSlider.value);
    xValEl.textContent = X_LABELS[val];
    ideal.domains[domain.id].x = val;
    updateCardStatus(card, ideal.domains[domain.id]);
  });

  // Wire Z binary buttons
  ['yes', 'no'].forEach(opt => {
    const btn = card.querySelector(`#ideal-z-${opt}-${domain.id}`);
    btn.addEventListener('click', () => {
      card.querySelector(`#ideal-z-yes-${domain.id}`).classList.remove('selected-yes');
      card.querySelector(`#ideal-z-no-${domain.id}`).classList.remove('selected-no');
      btn.classList.add(`selected-${opt}`);
      ideal.domains[domain.id].zBinary = opt;
      const scaleWrap = card.querySelector(`#ideal-z-scale-${domain.id}`);
      scaleWrap.style.display = opt === 'yes' ? 'none' : 'block';
      if (opt === 'yes') {
        ideal.domains[domain.id].zScale = null;
      }
    });
  });

  // Wire Z scale slider
  const zSlider = card.querySelector(`#ideal-z-slider-${domain.id}`);
  const zValEl  = card.querySelector(`#ideal-z-val-${domain.id}`);
  zSlider.addEventListener('input', () => {
    const val = parseInt(zSlider.value);
    zValEl.textContent = zScaleLabel(val);
    ideal.domains[domain.id].zScale = val;
  });

  return card;
}

function updateCardStatus(card, domainData) {
  const done = domainData.x !== null;
  card.classList.toggle('complete', done);
  const statusEl = card.querySelector('.domain-status-icon');
  if (statusEl) {
    statusEl.className = `domain-status-icon ${done ? 'done' : 'empty'}`;
    statusEl.textContent = done ? '✓' : '○';
  }
}

function zScaleLabel(val) {
  const labels = {
    1: 'Concentrated — this relationship is primary',
    2: 'Mostly concentrated',
    3: 'Balanced across connections',
    4: 'Mostly dispersed',
    5: 'Dispersed — distributed broadly',
  };
  return labels[val] || '';
}

// ── SAVE ──────────────────────────────────────────────────────────────────────

function wireSaveButton(container, ideal) {
  const btn = container.querySelector('#save-ideal-btn');
  const status = container.querySelector('#save-status');

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      ideal.updatedAt = Date.now();
      await saveIdealProfile(ideal);
      status.textContent = 'Saved';
      status.style.color = 'var(--success)';
      setTimeout(() => { status.textContent = ''; }, 2000);
    } catch (err) {
      status.textContent = 'Save failed: ' + err.message;
      status.style.color = 'var(--danger)';
    } finally {
      btn.disabled = false;
    }
  });
}

// ── NAV ───────────────────────────────────────────────────────────────────────

function bindNavEvents(wrap) {
  wrap.querySelectorAll('[data-nav]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const target = btn.dataset.nav;
      if (target === 'dashboard') await navigate('dashboard');
      else if (target === 'survey') await navigate('survey', { currentPass: 1 });
      else if (target === 'connect') await navigate('connect');
    });
  });
}
