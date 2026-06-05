# Relational Alignment Engine (RAE)

A privacy-first, serverless tool for mapping and maintaining relationship structure.
Built on relationship anarchy principles. No accounts, no cloud, no tracking.

---

## Architecture

```
All data: encrypted in browser IndexedDB (AES-GCM, PBKDF2-derived key)
Transport: direct WebRTC P2P via QR calling card handshake
Discovery: room QR hash → ephemeral relay → WebRTC cutover (Phase 2)
Distribution: static PWA via GitHub Pages, installed via QR code
```

## The Three-Pass Framework

**Pass 1 — Current State**
Each partner independently rates 18 domains on:
- X: Quality/Quantity (1–5) — how present is this domain right now
- Y: Intentionality (1–5) — how consciously designed vs. inherited by default

**Pass 2 — Aspirational Design**
Each partner independently designs their ideal for each domain:
- X: Desired presence (1–5) — where you want this domain to be
- Z binary: Exclusive to this relationship? (Yes / No / Nuanced)
- Z scale: If not exclusive, how much outside standing? (1–5)
Y is implicitly 5 — the act of designing it is the intentionality.

**Pass 3 — Agreement & Timeline**
Both partners present. Reviews divergence vectors, negotiates agreed coordinates,
logs commitments with a mandatory review date.

## The 18 Domains

**Foundation** (operational baseline)
Friendship · Communication · Domestic · Co-Caregiving · Life Partner · Collaborating

**Architecture** (organizational principles)
Emotional Intimacy · Emotional Support · Social Partners · Finances · Caretaking · Business

**Edges** (consent-gated, mutual unlock required)
Romance · Physicality · Touch · Sex · Kink · Power Dynamic

## Deployment (GitHub Pages)

```bash
# 1. Fork or clone this repo
git clone https://github.com/yourusername/rae

# 2. Push to GitHub
git push origin main

# 3. Enable GitHub Pages in repo settings → Pages → Deploy from main branch /root

# 4. Your PWA is live at https://yourusername.github.io/rae
#    Generate an install QR pointing to this URL
```

## Local Development

No build step required. Pure ES modules.

```bash
# Serve locally (required for ES modules — can't open index.html directly)
npx serve .
# or
python3 -m http.server 8080
```

Then open `http://localhost:8080`

## Security Model

- **PIN → PBKDF2 (310,000 iterations) → AES-GCM-256** for local storage encryption
- **ECDH P-256 keypair** generated on first launch, private key non-exportable
- **Shared key derived** from ECDH for P2P payload encryption
- **Private key never leaves device** — QR only contains public key + WebRTC SDP
- **Disconnect button** deletes active keys, rotates to new public identity, signals peer to scrub cache

## Icons

Add your own icons at:
- `icons/icon-192.png` (192×192)
- `icons/icon-512.png` (512×512)

The app works without them but PWA install experience degrades.

## Phase Roadmap

**Phase 1 (current):** Core engine, local storage, 3-pass audit, QR P2P transport
**Phase 2:** Date mode, blind Z-axis matching, single photo layer
**Phase 3:** Biometric unlock (WebAuthn), Nostr relay room hubs, data portability, expansion packs

---

Built for people who take relationship design seriously.
No corporate oversight. No data extraction. No engagement loops.
