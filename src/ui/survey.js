/**
 * survey.js — Pass 1 and Pass 2 survey interfaces
 */

import { DOMAINS, CATEGORIES, X_LABELS, Y_LABELS, Z_LABELS, getDomainsByCategory } from '../domains.js';
import { saveSession, loadLatestSession, saveRelationship, loadRelationship, createEmptySession } from '../storage.js';
import { state, navigate, toast, renderNav } from './app.js';

export async function renderSurvey(pass = 1) {
  const wrap = document.createElement('div');

  // Load or create session
  let session = null;
  if (state.activeRelationshipId) {
    session = await loadLatestSession(state.activeRelationshipId);
  }
  if (!session) {
    session = createEmptySession(state.activeRelationshipId || 'standalone');
    state.activeSession = session;
  } else {
    state.activeSession = session;
  }

  const relationship = state.activeRelationshipId
    ? await loadRelationship(state.activeRelationshipId)
    : null;

  const edgesUnlocked = relationship?.edgesUnlocked || false;

  const content = document.createElement('div');
  content.className = 'page-wide';

  // Header
  content.innerHTML = `
    <div class="pass-header">
      <div>
        <div class="label">Pass ${pass} of 3</div>
        <div class="display display-sm" style="margin-top:0.25rem;">
          ${pass === 1 ? 'Current State' : 'Aspirational Design'}
        </div>
      </div>
      <div id="completion-count" class="pass-count"></div>
    </div>
    <p style="font-family:var(--font-serif);font-style:italic;color:var(--text-muted);font-size:0.9rem;line-height:1.6;margin-bottom:2rem;">
      ${pass === 1
        ? 'Answer independently and honestly. Your partner\'s responses are private until both of you have signed off.'
        : 'Imagine designing this relationship from scratch, with full intentionality. Where would you want each domain to be?'}
    </p>
    <div id="domains-container" class="stack stack-md"></div>
    <div id="signoff-section" style="margin-top:2rem;"></div>
  `;

  wrap.appendChild(content);
  const _nav = document.createElement('div');
  _nav.innerHTML = renderNav('survey');
  wrap.appendChild(_nav);

  setTimeout(() => {
    buildDomainCards(content, session, pass, edgesUnlocked, relationship);
    updateCompletionCount(content, session, pass);
    buildSignoffSection(content, session, pass, relationship);
    bindNavEvents(wrap);
  }, 0);

  return wrap;
}

// ── DOMAIN CARDS ──────────────────────────────────────────────────────────────

function buildDomainCards(container, session, pass, edgesUnlocked, relationship) {
  const domainsContainer = container.querySelector('#domains-container');

  Object.values(CATEGORIES).forEach(category => {
    const section = document.createElement('div');
    section.className = 'category-section';

    const domains = getDomainsByCategory(category.id);
    const isEdges = category.id === 'edges';

    section.innerHTML = `
      <div class="category-header">
        <div class="category-dot" style="background:${category.color};"></div>
        <div class="category-name" style="color:${category.color};">${category.label}</div>
        <div class="category-desc">&nbsp;· ${category.description}</div>
      </div>
    `;

    if (isEdges && !edgesUnlocked) {
      section.innerHTML += `
        <div class="edges-locked-banner">
          <div class="edges-locked-icon">🔒</div>
          <div class="edges-locked-title">Edges Locked</div>
          <p class="edges-locked-desc">
            This section becomes available after both partners initiate a mutual unlock.
            Neither partner can see these responses until both consent to share them.
          </p>
          ${relationship ? `<button class="btn btn-ghost btn-sm" id="request-unlock-btn" style="margin-top:0.5rem;">Request Unlock</button>` : ''}
        </div>
      `;

      if (relationship) {
        section.querySelector('#request-unlock-btn')?.addEventListener('click', () => {
          toast('Unlock request sent to your partner');
        });
      }
    } else {
      const cardsWrap = document.createElement('div');
      cardsWrap.className = 'stack stack-sm';

      domains.forEach(domain => {
        const card = buildDomainCard(domain, session, pass);
        cardsWrap.appendChild(card);
      });

      section.appendChild(cardsWrap);
    }

    domainsContainer.appendChild(section);
  });
}

function buildDomainCard(domain, session, pass) {
  const domainData = session.domains[domain.id];
  const passData = pass === 1 ? domainData.pass1 : domainData.pass2;
  const isComplete = isPassComplete(domain, passData, pass);
  const isNullable = domain.nullable;
  const isNA = domainData.notApplicable;

  const card = document.createElement('div');
  card.className = `domain-card category-${domain.category} ${isComplete ? 'complete' : ''}`;
  card.dataset.domainId = domain.id;

  // Build status
  let statusClass = 'empty';
  let statusIcon = '○';
  if (isNA) { statusClass = 'done'; statusIcon = '–'; }
  else if (isComplete) { statusClass = 'done'; statusIcon = '✓'; }
  else if (passData) { statusClass = 'partial'; statusIcon = '◐'; }

  card.innerHTML = `
    <div class="domain-header">
      <div class="domain-title-row">
        <span class="domain-emoji">${domain.emoji}</span>
        <span class="domain-name">${domain.label}</span>
        <span class="domain-category-tag">${CATEGORIES[domain.category].label}</span>
      </div>
      <div class="domain-status-icon ${statusClass}">${statusIcon}</div>
    </div>
    <div class="domain-body" style="display:none;">
      ${isNullable ? buildNullableToggle(domain, isNA) : ''}
      <div class="question-blocks ${isNA ? 'hidden' : ''}">
        ${buildPassQuestions(domain, passData, pass)}
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

  // N/A toggle
  if (isNullable) {
    card.querySelector('.nullable-toggle')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      const sw = card.querySelector('.toggle-switch');
      const blocks = card.querySelector('.question-blocks');
      const wasNA = sw.classList.contains('on');
      sw.classList.toggle('on', !wasNA);
      blocks.classList.toggle('hidden', !wasNA);

      session.domains[domain.id].notApplicable = !wasNA;
      session.updatedAt = Date.now();
      await saveSession(session);
      updateCard(card, domain, session, pass);
      updateCompletionCount(card.closest('.page-wide') || document, session, pass);
    });
  }

  // Wire sliders
  wireSliders(card, domain, session, pass);

  return card;
}

function buildNullableToggle(domain, isNA) {
  return `
    <div class="nullable-toggle" style="padding:0.75rem 0;border-bottom:1px solid var(--border);">
      <div class="toggle-switch ${isNA ? 'on' : ''}"></div>
      <span class="nullable-label">${domain.nullableLabel || 'Not applicable'}</span>
    </div>
  `;
}

function buildPassQuestions(domain, passData, pass) {
  if (pass === 1) {
    const xVal = passData?.x || 3;
    const yVal = passData?.y || 3;

    return `
      <div class="question-block">
        <div class="question-axis">X · Presence / Quality</div>
        <div class="question-text">${domain.pass1Question}</div>
        <div class="slider-value" id="x-val-${domain.id}">${X_LABELS[xVal]}</div>
        <div class="slider-wrap">
          <input type="range" min="1" max="5" step="1" value="${xVal}" id="x-slider-${domain.id}" data-axis="x">
          <div class="slider-labels">
            ${[1,2,3,4,5].map(n => `<span class="label" style="font-size:0.55rem;">${n}</span>`).join('')}
          </div>
        </div>
      </div>
      <div class="question-block">
        <div class="question-axis">Y · Intentionality</div>
        <div class="question-text">${domain.intentionalityQuestion}</div>
        <div class="slider-value" id="y-val-${domain.id}">${Y_LABELS[yVal]}</div>
        <div class="slider-wrap">
          <input type="range" min="1" max="5" step="1" value="${yVal}" id="y-slider-${domain.id}" data-axis="y">
          <div class="slider-labels">
            ${[1,2,3,4,5].map(n => `<span class="label" style="font-size:0.55rem;">${n}</span>`).join('')}
          </div>
        </div>
      </div>
    `;
  } else {
    // Pass 2
    const xVal = passData?.x || 3;
    const zBinary = passData?.zBinary || null;
    const zScale = passData?.zScale || 3;

    return `
      <div class="question-block">
        <div class="question-axis">X · Aspirational Presence</div>
        <div class="question-text">${domain.pass2Question}</div>
        <div class="slider-value" id="x-val-${domain.id}">${X_LABELS[xVal]}</div>
        <div class="slider-wrap">
          <input type="range" min="1" max="5" step="1" value="${xVal}" id="x-slider-${domain.id}" data-axis="x">
          <div class="slider-labels">
            ${[1,2,3,4,5].map(n => `<span class="label" style="font-size:0.55rem;">${n}</span>`).join('')}
          </div>
        </div>
      </div>
      <div class="question-block">
        <div class="question-axis">Z · Exclusivity</div>
        <div class="question-text">${domain.zQuestion}</div>
        <div class="z-binary-group">
          <div class="z-binary-label">Should this domain be exclusive to this relationship?</div>
          <div class="z-binary-options">
            <button class="z-opt ${zBinary === 'yes' ? 'selected-yes' : ''}" data-z="yes" id="z-yes-${domain.id}">Exclusive</button>
            <button class="z-opt ${zBinary === 'no' ? 'selected-no' : ''}" data-z="no" id="z-no-${domain.id}">Open</button>
            <button class="z-opt ${zBinary === 'complicated' ? 'selected-complicated' : ''}" data-z="complicated" id="z-comp-${domain.id}">Nuanced</button>
          </div>
        </div>
        <div id="z-scale-wrap-${domain.id}" style="${zBinary === 'yes' ? 'display:none;' : ''}">
          <div class="slider-value" id="z-val-${domain.id}">${Z_LABELS[zScale]}</div>
          <div class="slider-wrap">
            <input type="range" min="1" max="5" step="1" value="${zScale}" id="z-slider-${domain.id}" data-axis="z">
            <div class="slider-labels">
              <span class="label" style="font-size:0.55rem;">Open</span>
              <span class="label" style="font-size:0.55rem;">Exclusive</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }
}

function wireSliders(card, domain, session, pass) {
  // Wait for DOM
  requestAnimationFrame(() => {
    // X slider
    const xSlider = card.querySelector(`#x-slider-${domain.id}`);
    const xValEl = card.querySelector(`#x-val-${domain.id}`);
    if (xSlider && xValEl) {
      xSlider.addEventListener('input', async () => {
        const val = parseInt(xSlider.value);
        xValEl.textContent = (pass === 1 ? X_LABELS : X_LABELS)[val];
        await updatePassData(session, domain.id, pass, { x: val });
        updateCard(card, domain, session, pass);
      });
    }

    if (pass === 1) {
      // Y slider
      const ySlider = card.querySelector(`#y-slider-${domain.id}`);
      const yValEl = card.querySelector(`#y-val-${domain.id}`);
      if (ySlider && yValEl) {
        ySlider.addEventListener('input', async () => {
          const val = parseInt(ySlider.value);
          yValEl.textContent = Y_LABELS[val];
          await updatePassData(session, domain.id, pass, { y: val });
          updateCard(card, domain, session, pass);
        });
      }
    } else {
      // Z binary buttons
      ['yes', 'no', 'complicated'].forEach(opt => {
        const btn = card.querySelector(`#z-${opt === 'complicated' ? 'comp' : opt}-${domain.id}`);
        if (!btn) return;
        btn.addEventListener('click', async () => {
          // Clear all selected states
          card.querySelector(`#z-yes-${domain.id}`)?.classList.remove('selected-yes');
          card.querySelector(`#z-no-${domain.id}`)?.classList.remove('selected-no');
          card.querySelector(`#z-comp-${domain.id}`)?.classList.remove('selected-complicated');

          // Set selected
          btn.classList.add(`selected-${opt}`);

          // Show/hide scale
          const scaleWrap = card.querySelector(`#z-scale-wrap-${domain.id}`);
          if (scaleWrap) scaleWrap.style.display = opt === 'yes' ? 'none' : 'block';

          await updatePassData(session, domain.id, pass, { zBinary: opt });
          updateCard(card, domain, session, pass);
        });
      });

      // Z scale slider
      const zSlider = card.querySelector(`#z-slider-${domain.id}`);
      const zValEl = card.querySelector(`#z-val-${domain.id}`);
      if (zSlider && zValEl) {
        zSlider.addEventListener('input', async () => {
          const val = parseInt(zSlider.value);
          zValEl.textContent = Z_LABELS[val];
          await updatePassData(session, domain.id, pass, { zScale: val });
        });
      }
    }
  });
}

async function updatePassData(session, domainId, pass, updates) {
  const domainData = session.domains[domainId];
  const key = pass === 1 ? 'pass1' : 'pass2';

  if (!domainData[key]) {
    domainData[key] = pass === 1 ? { x: 3, y: 3 } : { x: 3, zBinary: null, zScale: 3 };
  }

  Object.assign(domainData[key], updates);
  session.updatedAt = Date.now();

  if (session.relationshipId && session.relationshipId !== 'standalone') {
    await saveSession(session);
  }
}

function isPassComplete(domain, passData, pass) {
  if (!passData) return false;
  if (pass === 1) return passData.x && passData.y;
  return passData.x && passData.zBinary;
}

function updateCard(card, domain, session, pass) {
  const passData = pass === 1
    ? session.domains[domain.id].pass1
    : session.domains[domain.id].pass2;
  const isNA = session.domains[domain.id].notApplicable;
  const complete = isNA || isPassComplete(domain, passData, pass);

  card.classList.toggle('complete', complete);
  const statusEl = card.querySelector('.domain-status-icon');
  if (statusEl) {
    statusEl.className = `domain-status-icon ${isNA ? 'done' : complete ? 'done' : passData ? 'partial' : 'empty'}`;
    statusEl.textContent = isNA ? '–' : complete ? '✓' : passData ? '◐' : '○';
  }
}

// ── COMPLETION COUNT ──────────────────────────────────────────────────────────

function updateCompletionCount(container, session, pass) {
  const countEl = container.querySelector('#completion-count');
  if (!countEl) return;

  const total = DOMAINS.length;
  const done = DOMAINS.filter(d => {
    if (session.domains[d.id].notApplicable) return true;
    const data = pass === 1 ? session.domains[d.id].pass1 : session.domains[d.id].pass2;
    return isPassComplete(d, data, pass);
  }).length;

  countEl.textContent = `${done} / ${total}`;

  // Update signoff button state
  const signoffBtn = container.querySelector('#signoff-btn');
  if (signoffBtn) signoffBtn.disabled = done < total;
}

// ── SIGNOFF SECTION ───────────────────────────────────────────────────────────

function buildSignoffSection(container, session, pass, relationship) {
  const section = container.querySelector('#signoff-section');
  if (!section) return;

  const mySignoff = session.signoffs[`pass${pass}`]?.mine;
  const theirSignoff = session.signoffs[`pass${pass}`]?.theirs;

  if (mySignoff) {
    section.innerHTML = `
      <div class="signoff-gate">
        <div class="signoff-title">Sign-off Submitted</div>
        <div class="signoff-text">
          You have acknowledged Pass ${pass}. ${theirSignoff
            ? 'Your partner has also signed off. Proceed to the next pass.'
            : 'Waiting for your partner to sign off before the next pass unlocks.'}
        </div>
        <div class="signoff-status">
          <div class="signoff-partner">
            <div class="signoff-dot done"></div>
            You — signed off
          </div>
          <div class="signoff-partner">
            <div class="signoff-dot ${theirSignoff ? 'done' : 'pending'}"></div>
            ${relationship?.partnerAlias || 'Partner'} — ${theirSignoff ? 'signed off' : 'pending'}
          </div>
        </div>
        ${theirSignoff ? `
          <button class="btn btn-primary" id="next-pass-btn" style="margin-top:1rem;">
            ${pass === 2 ? 'Begin Pass 3 Together →' : 'Continue to Pass 2 →'}
          </button>
        ` : ''}
      </div>
    `;

    section.querySelector('#next-pass-btn')?.addEventListener('click', async () => {
      if (pass === 1) await navigate('survey', { currentPass: 2 });
      else if (pass === 2) await navigate('pass3');
    });
    return;
  }

  section.innerHTML = `
    <div class="signoff-gate">
      <div class="signoff-title">Pass ${pass} Sign-Off</div>
      <div class="signoff-text">
        ${pass === 1
          ? 'By signing off, you confirm that you have answered honestly and independently, and that you have had — or are ready to have — a conversation about what you\'re each seeing. You are not agreeing to anything yet.'
          : 'By signing off, you confirm these are your genuine aspirations for this relationship — not what you think your partner wants to hear, and not a compromise you haven\'t agreed to. You are committing to this as your honest aspirational input.'}
      </div>
      <div class="signoff-status">
        <div class="signoff-partner">
          <div class="signoff-dot pending"></div>
          You — not yet signed
        </div>
        <div class="signoff-partner">
          <div class="signoff-dot ${theirSignoff ? 'done' : 'pending'}"></div>
          ${relationship?.partnerAlias || 'Partner'} — ${theirSignoff ? 'signed off' : 'pending'}
        </div>
      </div>
      <button class="btn btn-primary" id="signoff-btn" style="margin-top:1rem;" disabled>
        Sign Off on Pass ${pass}
      </button>
      <p style="font-family:var(--font-mono);font-size:0.65rem;color:var(--text-muted);margin-top:0.5rem;">
        Complete all domains to enable sign-off.
      </p>
    </div>
  `;

  const signoffBtn = section.querySelector('#signoff-btn');

  // Check current completion
  const total = DOMAINS.length;
  const done = DOMAINS.filter(d => {
    if (session.domains[d.id].notApplicable) return true;
    const data = pass === 1 ? session.domains[d.id].pass1 : session.domains[d.id].pass2;
    return isPassComplete(d, data, pass);
  }).length;
  signoffBtn.disabled = done < total;

  signoffBtn.addEventListener('click', async () => {
    session.signoffs[`pass${pass}`].mine = true;
    session.updatedAt = Date.now();
    if (session.relationshipId && session.relationshipId !== 'standalone') await saveSession(session);
    toast('Sign-off recorded');
    buildSignoffSection(container, session, pass, relationship);
  });
}

// ── NAV BINDING ───────────────────────────────────────────────────────────────

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
