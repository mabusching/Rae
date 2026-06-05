/**
 * onboarding.js — PIN setup, identity creation, unlock flow
 */

import {
  deriveKeyFromPIN,
  generateKeypair,
  exportPublicKey,
  hashPublicKey,
} from '../crypto.js';
import {
  saveKeyMeta,
  loadKeyMeta,
  saveIdentity,
  loadIdentity,
  setEncryptionKey,
  saveKeypair,
  loadAndActivateKeypair,
  loadAllRelationships,
} from '../storage.js';
import { generateIdenticon, svgToDataURL, shortFingerprint } from '../identity.js';
import { state, navigate, toast } from './app.js';

export async function renderOnboarding() {
  const wrap = document.createElement('div');
  wrap.className = 'page';

  const step = state.step || 'setup';

  if (step === 'unlock') {
    wrap.appendChild(renderUnlockStep());
  } else {
    wrap.appendChild(renderSetupStep());
  }

  return wrap;
}

// ── SETUP (first launch) ──────────────────────────────────────────────────────

function renderSetupStep() {
  const div = document.createElement('div');
  div.className = 'stack stack-xl fade-in';
  div.style.paddingTop = '3rem';

  div.innerHTML = `
    <div class="text-center stack stack-md">
      <div class="display display-lg" style="font-size:2.5rem;">Relational<br>Alignment<br>Engine</div>
      <p style="font-family:var(--font-serif);font-style:italic;color:var(--text-muted);font-size:0.9rem;line-height:1.6;max-width:300px;margin:0 auto;">
        A private tool for mapping, designing, and maintaining the structure of your relationships.
      </p>
    </div>

    <div class="card" style="margin-top:1rem;">
      <div class="stack stack-lg">
        <div>
          <div class="label" style="margin-bottom:0.75rem;">Your alias</div>
          <input
            type="text"
            class="input"
            id="alias-input"
            placeholder="How you want to appear to partners"
            maxlength="32"
            autocomplete="off"
            autocorrect="off"
          />
          <p style="font-size:0.72rem;color:var(--text-muted);margin-top:0.4rem;font-family:var(--font-mono);">
            Not linked to any account. Stored only on this device.
          </p>
        </div>

        <div>
          <div class="label" style="margin-bottom:0.75rem;">Create PIN</div>
          <input
            type="password"
            class="input input-pin"
            id="pin-input"
            placeholder="••••"
            maxlength="6"
            inputmode="numeric"
            pattern="[0-9]*"
          />
          <p style="font-size:0.72rem;color:var(--text-muted);margin-top:0.4rem;font-family:var(--font-mono);">
            4–6 digits. Derives your local encryption key. Cannot be recovered if lost.
          </p>
        </div>

        <div>
          <div class="label" style="margin-bottom:0.75rem;">Confirm PIN</div>
          <input
            type="password"
            class="input input-pin"
            id="pin-confirm"
            placeholder="••••"
            maxlength="6"
            inputmode="numeric"
            pattern="[0-9]*"
          />
        </div>

        <div id="setup-error" style="display:none;" class="badge badge-danger"></div>

        <button class="btn btn-primary btn-full btn-lg" id="setup-btn">
          Initialize Identity
        </button>
      </div>
    </div>

    <p style="text-align:center;font-family:var(--font-mono);font-size:0.65rem;color:var(--text-muted);line-height:1.6;">
      All data is encrypted locally. No accounts, no servers, no cloud.
    </p>
  `;

  // Wire up
  setTimeout(() => {
    const btn = div.querySelector('#setup-btn');
    const aliasInput = div.querySelector('#alias-input');
    const pinInput = div.querySelector('#pin-input');
    const pinConfirm = div.querySelector('#pin-confirm');
    const errorEl = div.querySelector('#setup-error');

    function showError(msg) {
      errorEl.textContent = msg;
      errorEl.style.display = 'inline-flex';
    }
    function clearError() {
      errorEl.style.display = 'none';
    }

    btn.addEventListener('click', async () => {
      clearError();
      const alias = aliasInput.value.trim();
      const pin = pinInput.value;
      const confirm = pinConfirm.value;

      if (!alias) return showError('Alias required');
      if (pin.length < 4) return showError('PIN must be at least 4 digits');
      if (!/^\d+$/.test(pin)) return showError('PIN must be numeric');
      if (pin !== confirm) return showError('PINs do not match');

      btn.disabled = true;
      btn.textContent = 'Generating keys...';

      try {
        await setupIdentity(alias, pin);
      } catch (e) {
        showError('Setup failed: ' + e.message);
        btn.disabled = false;
        btn.textContent = 'Initialize Identity';
      }
    });

    [pinInput, pinConfirm].forEach(el => {
      el.addEventListener('keydown', e => {
        if (e.key === 'Enter') btn.click();
      });
    });
  }, 0);

  return div;
}

async function setupIdentity(alias, pin) {
  // Derive encryption key
  const { key, salt } = await deriveKeyFromPIN(pin);
  await saveKeyMeta(salt);
  setEncryptionKey(key);

  // Generate keypair
  const keypair = await generateKeypair();
  const publicKeyB64 = await exportPublicKey(keypair.publicKey);
  const keyHash = await hashPublicKey(publicKeyB64);
  const identiconSVG = generateIdenticon(keyHash);
  const identiconURL = svgToDataURL(identiconSVG);

  const identity = {
    alias,
    publicKey: publicKeyB64,
    keyHash,
    identicon: identiconURL,
    createdAt: Date.now(),
  };

  await saveIdentity(identity);

  // Persist the keypair directly in IDB via structured clone.
  // The private key is non-exportable and never appears as raw bytes.
  // It will be reloaded on every subsequent PIN unlock automatically.
  await saveKeypair(keypair);

  state.identity = identity;
  state.relationships = [];

  // Show identity confirmation
  await showIdentityConfirmation(identity, keypair);
}

async function showIdentityConfirmation(identity, keypair) {
  const app = document.getElementById('app');
  const wrap = document.createElement('div');
  wrap.className = 'page';
  wrap.style.paddingTop = '3rem';

  wrap.innerHTML = `
    <div class="stack stack-xl fade-in text-center">
      <div>
        <img
          src="${identity.identicon}"
          alt="Your identicon"
          class="identicon"
          style="width:80px;height:80px;margin:0 auto 1rem;"
        />
        <div class="display display-md">${identity.alias}</div>
        <div class="mono" style="margin-top:0.5rem;color:var(--text-muted);">
          ${shortFingerprint(identity.keyHash)}
        </div>
      </div>

      <div class="card-ghost text-center">
        <div class="label" style="margin-bottom:0.5rem;">Your identity is ready</div>
        <p style="font-size:0.82rem;color:var(--text-muted);line-height:1.6;">
          Your identicon is a visual fingerprint of your encrypted public key.
          Your partner will see this when you connect. It cannot be forged.
        </p>
      </div>

      <button class="btn btn-primary btn-full btn-lg" id="continue-btn">
        Enter
      </button>
    </div>
  `;

  app.innerHTML = '';
  app.appendChild(wrap);

  wrap.querySelector('#continue-btn').addEventListener('click', async () => {
    await navigate('dashboard');
  });
}

// ── UNLOCK (returning user) ───────────────────────────────────────────────────

function renderUnlockStep() {
  const div = document.createElement('div');
  div.className = 'page';
  div.style.paddingTop = '4rem';

  div.innerHTML = `
    <div class="stack stack-xl fade-in">
      <div class="text-center">
        <div class="display display-md" style="margin-bottom:0.5rem;">Welcome back</div>
        <p style="font-family:var(--font-mono);font-size:0.72rem;color:var(--text-muted);">
          Enter your PIN to unlock
        </p>
      </div>

      <div class="card">
        <div class="stack stack-md">
          <div>
            <div class="label" style="margin-bottom:0.75rem;">PIN</div>
            <input
              type="password"
              class="input input-pin"
              id="unlock-pin"
              placeholder="••••"
              maxlength="6"
              inputmode="numeric"
              pattern="[0-9]*"
              autofocus
            />
          </div>

          <div id="unlock-error" style="display:none;" class="badge badge-danger"></div>

          <button class="btn btn-primary btn-full" id="unlock-btn">
            Unlock
          </button>
        </div>
      </div>
    </div>
  `;

  setTimeout(() => {
    const btn = div.querySelector('#unlock-btn');
    const pinInput = div.querySelector('#unlock-pin');
    const errorEl = div.querySelector('#unlock-error');

    btn.addEventListener('click', async () => {
      const pin = pinInput.value;
      if (pin.length < 4) {
        errorEl.textContent = 'Enter your PIN';
        errorEl.style.display = 'inline-flex';
        return;
      }

      btn.disabled = true;
      btn.textContent = 'Unlocking...';

      try {
        const salt = await loadKeyMeta();
        const { key } = await deriveKeyFromPIN(pin, salt);
        setEncryptionKey(key);

        // Verify by trying to load identity
        const identity = await loadIdentity();
        if (!identity) throw new Error('Could not decrypt');

        // Reload the persisted keypair into memory so P2P crypto works
        const keypair = await loadAndActivateKeypair();
        if (!keypair) throw new Error('Keypair not found — storage may be corrupted');

        state.identity = identity;
        state.relationships = await loadAllRelationships();
        await navigate('dashboard');
      } catch (e) {
        errorEl.textContent = 'Incorrect PIN';
        errorEl.style.display = 'inline-flex';
        btn.disabled = false;
        btn.textContent = 'Unlock';
        pinInput.value = '';
        pinInput.focus();
      }
    });

    pinInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') btn.click();
    });
  }, 0);

  return div;
}
