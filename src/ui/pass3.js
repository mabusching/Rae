/**
 * pass3.js — Pass 3: divergence view, negotiation, agreement log
 */

import { DOMAINS, DOMAIN_MAP, X_LABELS, Z_LABELS } from '../domains.js';
import { saveSession, saveRelationship, loadRelationship } from '../storage.js';
import { computeDivergence, gapColor, gapSeverity, sortByDivergence } from '../divergence.js';
import { state, navigate, toast, renderNav } from './app.js';

export async function renderPass3() {
  const wrap = document.createElement('div');

  const session = state.activeSession;
  const relationship = state.activeRelationshipId
    ? await loadRelationship(state.activeRelationshipId)
    : null;

  const partnerSession = state.partnerSession || null;
  const hasBothSessions = session && partnerSession;

  const content = document.createElement('div');
  content.className = 'page-wide';

  content.innerHTML = `
    <div style="margin-bottom:2rem;">
      <div class="label" style="margin-bottom:0.25rem;">Pass 3 of 3</div>
      <div class="display display-sm">Agreement & Timeline</div>
      <p style="font-family:var(--font-serif);font-style:italic;color:var(--text-muted);font-size:0.9rem;line-height:1.6;margin-top:0.5rem;">
        This pass requires both partners to be present. Review your divergences together, negotiate agreed coordinates, and log your commitments.
      </p>
    </div>
    <div id="pass3-body"></div>
  `;

  wrap.appendChild(content);
  wrap.innerHTML += renderNav('survey');

  setTimeout(() => {
    const body = content.querySelector('#pass3-body');
    if (!hasBothSessions) {
      renderWaitingForSync(body, relationship);
    } else {
      renderDivergenceAndAgreement(body, session, partnerSession, relationship);
    }
    bindNavEvents(wrap);
  }, 0);

  return wrap;
}

// ── WAITING FOR SYNC ──────────────────────────────────────────────────────────

function renderWaitingForSync(container, relationship) {
  container.innerHTML = `
    <div class="card-ghost text-center stack stack-md" style="padding:3rem 2rem;">
      <div style="font-size:2.5rem;">🔄</div>
      <div class="display display-sm">Waiting for Partner Sync</div>
      <p style="font-size:0.85rem;color:var(--text-muted);line-height:1.6;max-width:280px;margin:0 auto;">
        Both partners need to be connected and have completed Pass 2 before Pass 3 can begin.
        Use the Connect tab to establish a peer connection.
      </p>
      <button class="btn btn-outline" id="go-connect-btn" style="margin-top:1rem;">
        Go to Connect →
      </button>
    </div>
  `;
  container.querySelector('#go-connect-btn')?.addEventListener('click', () => navigate('connect'));
}

// ── DIVERGENCE + AGREEMENT VIEW ───────────────────────────────────────────────

function renderDivergenceAndAgreement(container, mySession, theirSession, relationship) {
  const divergence = computeDivergence(mySession, theirSession);
  const sorted = sortByDivergence(divergence);
  const agg = divergence.aggregate;

  const myAlias = state.identity?.alias || 'You';
  const theirAlias = relationship?.partnerAlias || 'Partner';

  container.innerHTML = `
    <div id="alignment-overview"></div>
    <div id="divergence-list" style="margin-top:2rem;"></div>
    <div id="aligned-domains" style="margin-top:2rem;"></div>
    <div id="agreement-form" style="margin-top:2rem;"></div>
    <div id="agreement-log-section" style="margin-top:2rem;"></div>
  `;

  renderAlignmentOverview(container.querySelector('#alignment-overview'), agg, myAlias, theirAlias);
  renderDivergenceList(container.querySelector('#divergence-list'), sorted, mySession, theirSession, myAlias, theirAlias);
  renderAlignedDomains(container.querySelector('#aligned-domains'), sorted, mySession, theirSession);
  renderAgreementForm(container.querySelector('#agreement-form'), mySession, theirSession, relationship, divergence);
  renderAgreementLog(container.querySelector('#agreement-log-section'), mySession);
}

// ── ALIGNMENT OVERVIEW ────────────────────────────────────────────────────────

function renderAlignmentOverview(container, agg, myAlias, theirAlias) {
  const pct = agg.overallAlignment ?? 0;
  const radius = 44;
  const circ = 2 * Math.PI * radius;
  const dashOffset = circ * (1 - pct / 100);

  const conflictCount = agg.exclusivityConflicts.length;
  const divergentCount = agg.highDivergenceDomains.length;
  const alignedCount = agg.strongAlignmentDomains.length;

  container.innerHTML = `
    <div class="card">
      <div class="alignment-ring">
        <svg width="120" height="120" viewBox="0 0 120 120">
          <circle cx="60" cy="60" r="${radius}" fill="none" stroke="var(--border-active)" stroke-width="8"/>
          <circle
            cx="60" cy="60" r="${radius}"
            fill="none"
            stroke="${pct >= 75 ? 'var(--success)' : pct >= 50 ? 'var(--warning)' : 'var(--danger)'}"
            stroke-width="8"
            stroke-dasharray="${circ}"
            stroke-dashoffset="${dashOffset}"
            stroke-linecap="round"
            style="transition:stroke-dashoffset 1s ease;"
          />
        </svg>
        <div class="alignment-ring-label">
          <div class="alignment-pct">${pct}%</div>
          <div class="alignment-sub">aligned</div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:0.75rem;text-align:center;">
        <div>
          <div style="font-family:var(--font-mono);font-size:1.2rem;color:var(--success);">${alignedCount}</div>
          <div class="label">Strong<br>alignment</div>
        </div>
        <div>
          <div style="font-family:var(--font-mono);font-size:1.2rem;color:var(--warning);">${divergentCount}</div>
          <div class="label">High<br>divergence</div>
        </div>
        <div>
          <div style="font-family:var(--font-mono);font-size:1.2rem;color:var(--danger);">${conflictCount}</div>
          <div class="label">Exclusivity<br>conflicts</div>
        </div>
      </div>

      ${conflictCount > 0 ? `
        <div style="margin-top:1rem;padding:0.75rem;background:rgba(232,93,93,0.08);border:1px solid rgba(232,93,93,0.2);border-radius:var(--radius-md);">
          <div style="font-family:var(--font-mono);font-size:0.7rem;color:var(--danger);letter-spacing:0.1em;text-transform:uppercase;margin-bottom:0.35rem;">Exclusivity conflicts require direct conversation</div>
          <div style="font-size:0.78rem;color:var(--text-muted);">
            ${agg.exclusivityConflicts.map(id => DOMAIN_MAP[id]?.label).join(', ')}
          </div>
        </div>
      ` : ''}
    </div>
  `;
}

// ── DIVERGENCE LIST ───────────────────────────────────────────────────────────

function renderDivergenceList(container, sorted, mySession, theirSession, myAlias, theirAlias) {
  const divergent = sorted.filter(d => d.aspirationalGap > 0 || d.exclusivityConflict);
  if (divergent.length === 0) {
    container.innerHTML = `
      <div class="card-ghost text-center" style="padding:2rem;">
        <div style="font-size:1.5rem;margin-bottom:0.5rem;">🎯</div>
        <div style="font-family:var(--font-mono);font-size:0.72rem;color:var(--success);letter-spacing:0.1em;text-transform:uppercase;">
          Full aspirational alignment
        </div>
        <p style="font-size:0.82rem;color:var(--text-muted);margin-top:0.5rem;">
          Your Pass 2 targets match across all domains.
        </p>
      </div>
    `;
    return;
  }

  const label = document.createElement('div');
  label.innerHTML = `<div class="label" style="margin-bottom:1rem;">Negotiation Agenda · ${divergent.length} domain${divergent.length !== 1 ? 's' : ''}</div>`;
  container.appendChild(label);

  divergent.forEach(({ domainId, aspirationalGap, perceptualGap, exclusivityConflict, personalDrift }) => {
    const domain = DOMAIN_MAP[domainId];
    if (!domain) return;

    const myP1 = mySession.domains[domainId].pass1;
    const myP2 = mySession.domains[domainId].pass2;
    const theirP1 = theirSession.domains[domainId]?.pass1;
    const theirP2 = theirSession.domains[domainId]?.pass2;

    const gap = aspirationalGap ?? perceptualGap ?? 0;
    const color = gapColor(gap);
    const severity = gapSeverity(gap);

    const row = document.createElement('div');
    row.className = 'agreement-domain';

    row.innerHTML = `
      <div class="agreement-domain-header">
        <div style="display:flex;align-items:center;gap:0.5rem;">
          <span style="font-size:1.1rem;">${domain.emoji}</span>
          <span style="font-size:0.9rem;">${domain.label}</span>
        </div>
        <div style="display:flex;align-items:center;gap:0.5rem;">
          ${exclusivityConflict ? `<span class="badge badge-danger">⚠ Exclusivity conflict</span>` : ''}
          <span class="badge" style="background:${color}22;color:${color};border-color:${color}44;">
            ${severity}
          </span>
        </div>
      </div>

      <div class="agreement-domain-body">
        <!-- Partner comparison -->
        <div class="partner-coord-row">
          <div class="partner-coord">
            <div class="partner-coord-label">${myAlias} · Pass 1</div>
            <div class="partner-coord-vals">${myP1 ? `X:${myP1.x} Y:${myP1.y}` : '—'}</div>
          </div>
          <div class="partner-coord">
            <div class="partner-coord-label">${theirAlias} · Pass 1</div>
            <div class="partner-coord-vals">${theirP1 ? `X:${theirP1.x} Y:${theirP1.y}` : '—'}</div>
          </div>
        </div>
        <div class="partner-coord-row">
          <div class="partner-coord">
            <div class="partner-coord-label">${myAlias} · Pass 2 Target</div>
            <div class="partner-coord-vals">${myP2 ? `X:${myP2.x} Z:${myP2.zBinary === 'yes' ? 'Excl.' : myP2.zScale || '—'}` : '—'}</div>
          </div>
          <div class="partner-coord">
            <div class="partner-coord-label">${theirAlias} · Pass 2 Target</div>
            <div class="partner-coord-vals">${theirP2 ? `X:${theirP2.x} Z:${theirP2.zBinary === 'yes' ? 'Excl.' : theirP2.zScale || '—'}` : '—'}</div>
          </div>
        </div>

        ${exclusivityConflict ? `
          <div style="padding:0.75rem;background:rgba(232,93,93,0.08);border:1px solid rgba(232,93,93,0.2);border-radius:var(--radius-md);margin-bottom:1rem;font-size:0.8rem;color:var(--danger);">
            ${myAlias} wants ${exclusivityConflict.mine === 'exclusive' ? 'exclusivity' : 'openness'} ·
            ${theirAlias} wants ${exclusivityConflict.theirs === 'exclusive' ? 'exclusivity' : 'openness'}.
            This requires direct conversation before agreement can be logged.
          </div>
        ` : ''}

        <!-- Agreed coordinate input -->
        <div class="agreed-coord-row">
          <div class="agreed-coord-label">Agreed Coordinate</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;margin-bottom:0.75rem;">
            <div>
              <div class="label" style="margin-bottom:0.35rem;">Agreed X (1–5)</div>
              <div class="slider-value" id="agreed-x-val-${domainId}">
                ${mySession.domains[domainId].pass3?.agreedX ? X_LABELS[mySession.domains[domainId].pass3.agreedX] : 'Not set'}
              </div>
              <input type="range" min="1" max="5" step="1"
                value="${mySession.domains[domainId].pass3?.agreedX || Math.round(((myP2?.x||3) + (theirP2?.x||3)) / 2)}"
                id="agreed-x-${domainId}"
                data-domain="${domainId}"
              />
            </div>
            <div>
              <div class="label" style="margin-bottom:0.35rem;">Agreed Z (1–5)</div>
              <div class="slider-value" id="agreed-z-val-${domainId}">
                ${mySession.domains[domainId].pass3?.agreedZ ? Z_LABELS[mySession.domains[domainId].pass3.agreedZ] : 'Not set'}
              </div>
              <input type="range" min="1" max="5" step="1"
                value="${mySession.domains[domainId].pass3?.agreedZ || 3}"
                id="agreed-z-${domainId}"
                data-domain="${domainId}"
              />
            </div>
          </div>

          <div style="margin-bottom:0.5rem;">
            <div class="label" style="margin-bottom:0.35rem;">Notes</div>
            <textarea
              class="input"
              id="agreed-notes-${domainId}"
              placeholder="Specific agreements, conditions, context..."
              style="min-height:60px;"
            >${mySession.domains[domainId].pass3?.notes || ''}</textarea>
          </div>

          <div style="display:flex;align-items:center;justify-content:space-between;">
            <label style="display:flex;align-items:center;gap:0.5rem;cursor:pointer;">
              <input type="checkbox" id="resolved-${domainId}"
                ${mySession.domains[domainId].pass3?.resolved ? 'checked' : ''}
                style="accent-color:var(--ember);"
              />
              <span style="font-family:var(--font-mono);font-size:0.72rem;color:var(--text-muted);">
                Mark as resolved
              </span>
            </label>
            ${!mySession.domains[domainId].pass3?.resolved ? `
              <span class="unresolved-flag">
                ⚑ Acknowledged — revisit pending
              </span>
            ` : ''}
          </div>
        </div>
      </div>
    `;

    // Wire agreed coordinate inputs
    const agreedXSlider = row.querySelector(`#agreed-x-${domainId}`);
    const agreedZSlider = row.querySelector(`#agreed-z-${domainId}`);
    const agreedXVal = row.querySelector(`#agreed-x-val-${domainId}`);
    const agreedZVal = row.querySelector(`#agreed-z-val-${domainId}`);
    const notesEl = row.querySelector(`#agreed-notes-${domainId}`);
    const resolvedEl = row.querySelector(`#resolved-${domainId}`);

    async function saveAgreement() {
      if (!mySession.domains[domainId].pass3) {
        mySession.domains[domainId].pass3 = {};
      }
      mySession.domains[domainId].pass3 = {
        agreedX: parseInt(agreedXSlider.value),
        agreedZ: parseInt(agreedZSlider.value),
        notes: notesEl.value,
        resolved: resolvedEl.checked,
      };
      mySession.updatedAt = Date.now();
      await saveSession(mySession);
    }

    agreedXSlider?.addEventListener('input', () => {
      agreedXVal.textContent = X_LABELS[parseInt(agreedXSlider.value)];
      saveAgreement();
    });

    agreedZSlider?.addEventListener('input', () => {
      agreedZVal.textContent = Z_LABELS[parseInt(agreedZSlider.value)];
      saveAgreement();
    });

    notesEl?.addEventListener('input', () => saveAgreement());
    resolvedEl?.addEventListener('change', () => {
      const unresolvedFlag = row.querySelector('.unresolved-flag');
      if (unresolvedFlag) unresolvedFlag.style.display = resolvedEl.checked ? 'none' : 'flex';
      saveAgreement();
    });

    container.appendChild(row);
  });
}

// ── ALIGNED DOMAINS ───────────────────────────────────────────────────────────

function renderAlignedDomains(container, sorted, mySession, theirSession) {
  const aligned = sorted.filter(d => (d.aspirationalGap ?? 0) === 0 && !d.exclusivityConflict);
  if (aligned.length === 0) return;

  container.innerHTML = `
    <div class="label" style="margin-bottom:1rem;">Intentional Strengths · ${aligned.length} aligned</div>
    <div class="card" style="padding:0.5rem 1.25rem;">
      ${aligned.map(({ domainId }) => {
        const domain = DOMAIN_MAP[domainId];
        const myP2 = mySession.domains[domainId].pass2;
        return `
          <div class="div-domain-row">
            <div class="div-domain-name">
              <span>${domain.emoji}</span>
              <span>${domain.label}</span>
            </div>
            <div style="flex:1;">
              <div style="font-family:var(--font-mono);font-size:0.72rem;color:var(--success);">
                X:${myP2?.x || '—'} · ${myP2?.zBinary === 'yes' ? 'Exclusive' : `Z:${myP2?.zScale || '—'}`}
              </div>
            </div>
            <span class="badge badge-success">aligned</span>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

// ── AGREEMENT FORM ────────────────────────────────────────────────────────────

function renderAgreementForm(container, mySession, theirSession, relationship, divergence) {
  const alreadySigned = mySession.agreement?.signedByMe;

  container.innerHTML = `
    <div class="signoff-gate">
      <div class="signoff-title">Lock Agreement & Set Review Date</div>
      <div class="signoff-text">
        Once both partners sign, the agreed coordinates are written to your local commitment log.
        Set a review date — the tool will surface this session when that date arrives.
      </div>

      <div style="margin:1.25rem 0;">
        <div class="label" style="margin-bottom:0.5rem;">Review date</div>
        <input
          type="date"
          class="input"
          id="review-date-input"
          value="${mySession.agreement?.reviewDate || getDefaultReviewDate()}"
          style="font-family:var(--font-mono);"
        />
      </div>

      <div class="signoff-status" style="margin-bottom:1rem;">
        <div class="signoff-partner">
          <div class="signoff-dot ${alreadySigned ? 'done' : 'pending'}"></div>
          ${state.identity?.alias || 'You'} — ${alreadySigned ? 'signed' : 'not signed'}
        </div>
        <div class="signoff-partner">
          <div class="signoff-dot ${mySession.agreement?.signedByThem ? 'done' : 'pending'}"></div>
          ${relationship?.partnerAlias || 'Partner'} — ${mySession.agreement?.signedByThem ? 'signed' : 'not signed'}
        </div>
      </div>

      ${!alreadySigned ? `
        <button class="btn btn-primary" id="sign-agreement-btn">
          Sign Agreement
        </button>
      ` : `
        <div class="badge badge-success">✓ You have signed this agreement</div>
        ${mySession.agreement?.signedByThem
          ? `<div class="badge badge-success" style="margin-left:0.5rem;">✓ Partner signed — agreement locked</div>`
          : `<p style="font-family:var(--font-mono);font-size:0.7rem;color:var(--text-muted);margin-top:0.75rem;">Waiting for partner to sign. Share your session via Connect.</p>`
        }
      `}
    </div>
  `;

  container.querySelector('#sign-agreement-btn')?.addEventListener('click', async () => {
    const reviewDate = container.querySelector('#review-date-input').value;
    if (!reviewDate) { toast('Set a review date first'); return; }

    mySession.agreement = {
      ...mySession.agreement,
      reviewDate,
      signedByMe: true,
      signedAt: Date.now(),
    };
    mySession.updatedAt = Date.now();
    await saveSession(mySession);
    toast('Agreement signed');
    renderAgreementForm(container, mySession, theirSession, relationship, divergence);
    renderAgreementLog(container.closest('#pass3-body')?.querySelector('#agreement-log-section'), mySession);
  });
}

function getDefaultReviewDate() {
  const d = new Date();
  d.setMonth(d.getMonth() + 3);
  return d.toISOString().split('T')[0];
}

// ── AGREEMENT LOG ─────────────────────────────────────────────────────────────

function renderAgreementLog(container, session) {
  if (!container) return;
  if (!session.agreement?.signedByMe) {
    container.innerHTML = '';
    return;
  }

  const resolvedDomains = DOMAINS.filter(d => session.domains[d.id].pass3?.resolved);
  const unresolvedDomains = DOMAINS.filter(d => {
    const p3 = session.domains[d.id].pass3;
    return p3 && !p3.resolved;
  });

  const timestamp = new Date(session.agreement.signedAt || Date.now());
  const reviewDate = session.agreement.reviewDate
    ? new Date(session.agreement.reviewDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : 'Not set';

  container.innerHTML = `
    <div class="label" style="margin-bottom:1rem;">Commitment Log</div>
    <div class="agreement-log">
      <div class="agreement-log-header">
        <div style="font-family:var(--font-mono);font-size:0.72rem;color:var(--text-primary);">
          Session Agreement
        </div>
        <div class="review-date-badge">
          ⟳ Review ${reviewDate}
        </div>
      </div>

      <div class="agreement-log-entry">
        <div class="agreement-log-date">
          Signed ${timestamp.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
        </div>

        ${resolvedDomains.length > 0 ? `
          <div style="margin-top:0.75rem;">
            <div class="label" style="margin-bottom:0.5rem;color:var(--success);">Resolved</div>
            ${resolvedDomains.map(d => {
              const p3 = session.domains[d.id].pass3;
              return `
                <div style="padding:0.5rem 0;border-bottom:1px solid var(--border);">
                  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.2rem;">
                    <span style="font-size:0.82rem;">${d.emoji} ${d.label}</span>
                    <span style="font-family:var(--font-mono);font-size:0.7rem;color:var(--ember);">
                      X:${p3.agreedX} Z:${p3.agreedZ}
                    </span>
                  </div>
                  ${p3.notes ? `<div style="font-family:var(--font-serif);font-style:italic;font-size:0.78rem;color:var(--text-muted);">${p3.notes}</div>` : ''}
                </div>
              `;
            }).join('')}
          </div>
        ` : ''}

        ${unresolvedDomains.length > 0 ? `
          <div style="margin-top:0.75rem;">
            <div class="label" style="margin-bottom:0.5rem;color:var(--warning);">Acknowledged — Pending</div>
            ${unresolvedDomains.map(d => `
              <div style="padding:0.4rem 0;border-bottom:1px solid var(--border);">
                <span style="font-size:0.82rem;color:var(--text-muted);">${d.emoji} ${d.label}</span>
                <span style="font-family:var(--font-mono);font-size:0.68rem;color:var(--warning);margin-left:0.5rem;">
                  revisit by ${reviewDate}
                </span>
              </div>
            `).join('')}
          </div>
        ` : ''}
      </div>
    </div>

    <button class="btn btn-ghost btn-sm" id="export-log-btn" style="margin-top:1rem;">
      Export as text
    </button>
  `;

  container.querySelector('#export-log-btn')?.addEventListener('click', () => {
    exportLog(session, resolvedDomains, unresolvedDomains, reviewDate);
  });
}

function exportLog(session, resolved, unresolved, reviewDate) {
  const lines = [];
  lines.push('RELATIONAL ALIGNMENT ENGINE — COMMITMENT LOG');
  lines.push('='.repeat(48));
  lines.push(`Signed: ${new Date(session.agreement?.signedAt || Date.now()).toLocaleDateString()}`);
  lines.push(`Review by: ${reviewDate}`);
  lines.push('');

  if (resolved.length > 0) {
    lines.push('RESOLVED AGREEMENTS');
    lines.push('-'.repeat(24));
    resolved.forEach(d => {
      const p3 = session.domains[d.id].pass3;
      lines.push(`${d.label} (${d.category})`);
      lines.push(`  Agreed: X:${p3.agreedX} Z:${p3.agreedZ}`);
      if (p3.notes) lines.push(`  Notes: ${p3.notes}`);
    });
    lines.push('');
  }

  if (unresolved.length > 0) {
    lines.push('ACKNOWLEDGED — PENDING RESOLUTION');
    lines.push('-'.repeat(24));
    unresolved.forEach(d => {
      lines.push(`${d.label} — revisit by ${reviewDate}`);
    });
    lines.push('');
  }

  const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `rae-commitment-log-${new Date().toISOString().split('T')[0]}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

function bindNavEvents(wrap) {
  wrap.querySelectorAll('[data-nav]').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.nav;
      if (target === 'dashboard') navigate('dashboard');
      else if (target === 'survey') navigate('survey', { currentPass: state.currentPass || 1 });
      else if (target === 'connect') navigate('connect');
    });
  });
}
