/**
 * identity.js — Identicon generation and profile utilities
 * Generates deterministic visual hash from public key
 */

/**
 * Generate a deterministic identicon SVG from a hex hash string
 * Uses a 5x5 grid with horizontal symmetry, colored by hash
 */
export function generateIdenticon(hexHash, size = 80) {
  const hash = hexHash.padEnd(32, '0');

  // Extract color from first 6 hex chars
  const hue = parseInt(hash.slice(0, 2), 16) / 255 * 360;
  const sat = 40 + (parseInt(hash.slice(2, 4), 16) / 255 * 30); // 40-70%
  const light = 45 + (parseInt(hash.slice(4, 6), 16) / 255 * 15); // 45-60%

  const fg = `hsl(${hue.toFixed(0)}, ${sat.toFixed(0)}%, ${light.toFixed(0)}%)`;
  const bg = '#1A1612';

  // Build 5x5 grid — only need 3 columns, mirror for symmetry
  const cells = [];
  let byteIndex = 6;
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 3; col++) {
      const byteVal = parseInt(hash.slice(byteIndex, byteIndex + 2), 16);
      byteIndex = (byteIndex + 2) % (hash.length - 1);
      cells.push({ row, col, filled: byteVal % 2 === 1 });
    }
  }

  const cellSize = size / 5;
  const padding = cellSize * 0.5;
  const innerSize = cellSize - padding;

  let rects = '';
  cells.forEach(({ row, col, filled }) => {
    if (!filled) return;
    // Left side
    const x1 = col * cellSize + padding / 2;
    const y1 = row * cellSize + padding / 2;
    rects += `<rect x="${x1.toFixed(1)}" y="${y1.toFixed(1)}" width="${innerSize.toFixed(1)}" height="${innerSize.toFixed(1)}" rx="1" fill="${fg}"/>`;
    // Mirror right side (skip center column)
    if (col < 2) {
      const mirrorCol = 4 - col;
      const x2 = mirrorCol * cellSize + padding / 2;
      rects += `<rect x="${x2.toFixed(1)}" y="${y1.toFixed(1)}" width="${innerSize.toFixed(1)}" height="${innerSize.toFixed(1)}" rx="1" fill="${fg}"/>`;
    }
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${size * 0.15}" fill="${bg}"/>
  ${rects}
</svg>`;
}

/**
 * Convert SVG string to data URL for use in img src
 */
export function svgToDataURL(svg) {
  return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
}

/**
 * Generate a short fingerprint display string from a hash
 * e.g. "a3f2 · 8b1c · 4d7e"
 */
export function shortFingerprint(hexHash) {
  const h = hexHash.slice(0, 12);
  return `${h.slice(0, 4)} · ${h.slice(4, 8)} · ${h.slice(8, 12)}`;
}
