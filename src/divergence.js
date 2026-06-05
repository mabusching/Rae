/**
 * divergence.js — Vector distance calculations and gap analysis
 * Computes perceptual gap, aspirational gap, personal drift, agreement delta
 */

import { DOMAINS } from './domains.js';

/**
 * Euclidean distance between two (x, y) or (x, z) points
 */
function distance2D(a, b) {
  if (!a || !b) return null;
  return Math.sqrt(Math.pow(a[0] - b[0], 2) + Math.pow(a[1] - b[1], 2));
}

/**
 * Euclidean distance between two (x, y, z) points
 */
function distance3D(a, b) {
  if (!a || !b) return null;
  return Math.sqrt(
    Math.pow(a[0] - b[0], 2) +
    Math.pow(a[1] - b[1], 2) +
    Math.pow(a[2] - b[2], 2)
  );
}

/**
 * Normalize distance to 0-1 scale
 * Max distance in 3D 1-5 space is sqrt(3 * 16) ≈ 6.93
 */
function normalize(dist, dims = 2) {
  if (dist === null) return null;
  const max = dims === 3 ? Math.sqrt(3 * 16) : Math.sqrt(2 * 16);
  return Math.min(dist / max, 1);
}

/**
 * Compute all divergence vectors for a session with both partners' data
 *
 * mySession: the local partner's session
 * theirSession: the remote partner's session (received via WebRTC)
 *
 * Returns per-domain analysis plus aggregate scores
 */
export function computeDivergence(mySession, theirSession) {
  const results = {};
  let totalPerceptual = 0;
  let totalAspirational = 0;
  let totalDrift = 0;
  let countPerceptual = 0;
  let countAspirational = 0;
  let countDrift = 0;

  DOMAINS.forEach(domain => {
    const myDomain = mySession.domains[domain.id];
    const theirDomain = theirSession?.domains[domain.id];

    const analysis = {
      domainId: domain.id,
      perceptualGap: null,    // Distance between pass1 X values
      perceptualGapFull: null, // Distance in (X,Y) space
      aspirationalGap: null,   // Distance between pass2 X values
      aspirationalGapFull: null, // Distance in (X,Z) space
      personalDrift: null,     // My pass1 X vs my pass2 X
      exclusivityConflict: null, // Z binary mismatch
      alignmentScore: null,    // 0-1, higher is more aligned
    };

    // ── PERCEPTUAL GAP (Pass 1 comparison) ──────────────────────────────────
    if (myDomain?.pass1 && theirDomain?.pass1) {
      const myP1 = myDomain.pass1;
      const theirP1 = theirDomain.pass1;

      analysis.perceptualGap = Math.abs(myP1.x - theirP1.x);
      analysis.perceptualGapFull = distance2D(
        [myP1.x, myP1.y],
        [theirP1.x, theirP1.y]
      );

      totalPerceptual += analysis.perceptualGapFull;
      countPerceptual++;
    }

    // ── ASPIRATIONAL GAP (Pass 2 comparison) ────────────────────────────────
    if (myDomain?.pass2 && theirDomain?.pass2) {
      const myP2 = myDomain.pass2;
      const theirP2 = theirDomain.pass2;

      analysis.aspirationalGap = Math.abs(myP2.x - theirP2.x);

      // Z scale: use 1 if binary is 'yes' (fully exclusive), else scale value
      const myZ = myP2.zBinary === 'yes' ? 5 : (myP2.zScale || 3);
      const theirZ = theirP2.zBinary === 'yes' ? 5 : (theirP2.zScale || 3);

      analysis.aspirationalGapFull = distance2D(
        [myP2.x, myZ],
        [theirP2.x, theirZ]
      );

      // Flag exclusivity conflicts — one wants exclusive, other doesn't
      if (myP2.zBinary === 'yes' && theirP2.zBinary === 'no') {
        analysis.exclusivityConflict = { mine: 'exclusive', theirs: 'open' };
      } else if (myP2.zBinary === 'no' && theirP2.zBinary === 'yes') {
        analysis.exclusivityConflict = { mine: 'open', theirs: 'exclusive' };
      }

      totalAspirational += analysis.aspirationalGapFull;
      countAspirational++;
    }

    // ── PERSONAL DRIFT (My pass1 vs my pass2) ───────────────────────────────
    if (myDomain?.pass1 && myDomain?.pass2) {
      analysis.personalDrift = Math.abs(myDomain.pass1.x - myDomain.pass2.x);
      totalDrift += analysis.personalDrift;
      countDrift++;
    }

    // ── ALIGNMENT SCORE ──────────────────────────────────────────────────────
    if (analysis.aspirationalGapFull !== null) {
      analysis.alignmentScore = 1 - normalize(analysis.aspirationalGapFull, 2);
    } else if (analysis.perceptualGapFull !== null) {
      analysis.alignmentScore = 1 - normalize(analysis.perceptualGapFull, 2);
    }

    results[domain.id] = analysis;
  });

  // ── AGGREGATE SCORES ───────────────────────────────────────────────────────
  const aggregate = {
    meanPerceptualGap: countPerceptual > 0 ? totalPerceptual / countPerceptual : null,
    meanAspirationalGap: countAspirational > 0 ? totalAspirational / countAspirational : null,
    meanPersonalDrift: countDrift > 0 ? totalDrift / countDrift : null,
    overallAlignment: null,
    exclusivityConflicts: [],
    highDivergenceDomains: [],
    strongAlignmentDomains: [],
  };

  // Overall alignment percentage (0-100)
  if (aggregate.meanAspirationalGap !== null) {
    aggregate.overallAlignment = Math.round(
      (1 - normalize(aggregate.meanAspirationalGap, 2)) * 100
    );
  }

  // Flag domains
  Object.entries(results).forEach(([domainId, analysis]) => {
    if (analysis.exclusivityConflict) {
      aggregate.exclusivityConflicts.push(domainId);
    }
    if (analysis.aspirationalGap !== null && analysis.aspirationalGap >= 2) {
      aggregate.highDivergenceDomains.push(domainId);
    }
    if (analysis.alignmentScore !== null && analysis.alignmentScore >= 0.85) {
      aggregate.strongAlignmentDomains.push(domainId);
    }
  });

  return { domains: results, aggregate };
}

/**
 * Severity label for a gap value (0-4 scale for single axis)
 */
export function gapSeverity(gap) {
  if (gap === null) return 'unknown';
  if (gap === 0) return 'aligned';
  if (gap <= 1) return 'minor';
  if (gap <= 2) return 'moderate';
  return 'significant';
}

export function gapColor(gap) {
  const s = gapSeverity(gap);
  return {
    aligned: '#4BAF7D',
    minor: '#E8B84B',
    moderate: '#E8873D',
    significant: '#E85D5D',
    unknown: '#666',
  }[s];
}

/**
 * Sort domains by divergence severity (most divergent first)
 */
export function sortByDivergence(divergenceResults) {
  return Object.entries(divergenceResults.domains)
    .sort((a, b) => {
      const gapA = a[1].aspirationalGap ?? a[1].perceptualGap ?? 0;
      const gapB = b[1].aspirationalGap ?? b[1].perceptualGap ?? 0;
      return gapB - gapA;
    })
    .map(([domainId, analysis]) => ({ domainId, ...analysis }));
}
