/**
 * domains.js — 18-domain taxonomy with question definitions
 * Foundation / Architecture / Edges
 */

export const CATEGORIES = {
  foundation: { id: 'foundation', label: 'Foundation', color: '#E85D5D', description: 'The structural baseline of daily life and operational mechanics.' },
  architecture: { id: 'architecture', label: 'Architecture', color: '#E8B84B', description: 'Organizational principles governing emotional, material, and financial space.' },
  edges: { id: 'edges', label: 'Edges', color: '#4BAF7D', description: 'Sensitive boundaries governing physical mechanics, intimacy, and consent.' },
};

// Universal Z-axis binary statement — same across all 18 domains
export const Z_BINARY_STATEMENT = 'This domain exists only within this relationship.';

// Slider endpoint labels when domain is not unique (zBinary = 'no')
export const Z_CONCENTRATED = 'Concentrated';  // this relationship is primary
export const Z_DISPERSED    = 'Dispersed';      // distributed across connections

export const DOMAINS = [
  // ── FOUNDATION ──────────────────────────────────────────────────────────────
  {
    id: 'friendship',
    label: 'Friendship',
    category: 'foundation',
    emoji: '🤝',
    pronoun: 'we',
    pass1Question: 'We actively enjoy each other\'s company beyond obligation.',
    pass2Question: 'We would actively seek each other\'s company beyond obligation.',
    intentionalityQuestion: 'The quality of our friendship is something we\'ve consciously invested in, not just what remained.',
    nullable: false,
  },
  {
    id: 'communication',
    label: 'Communication',
    category: 'foundation',
    emoji: '💬',
    pronoun: 'we',
    pass1Question: 'We actually reach each other — understanding and being understood, not just exchanging information.',
    pass2Question: 'We would reach each other — with full understanding in both directions.',
    intentionalityQuestion: 'How we communicate is something we\'ve deliberately shaped, not inherited from habit.',
    nullable: false,
  },
  {
    id: 'domestic',
    label: 'Domestic',
    category: 'foundation',
    emoji: '🏠',
    pronoun: 'we',
    pass1Question: 'We\'ve found a way to share physical space and daily rhythm that works.',
    pass2Question: 'We would have a shared physical life that genuinely works for both of us.',
    intentionalityQuestion: 'Our domestic arrangements are the result of deliberate design, not whoever filled the vacuum.',
    nullable: false,
  },
  {
    id: 'cocaregiving',
    label: 'Co-Caregiving',
    category: 'foundation',
    emoji: '🌱',
    pronoun: 'we',
    pass1Question: 'We are aligned and functional in our shared caregiving — whether that\'s children, dependents, or each other.',
    pass2Question: 'We would be genuinely aligned on caregiving — current, future, or potential.',
    intentionalityQuestion: 'Our approach to caregiving is something we\'ve explicitly discussed and agreed on.',
    nullable: true,
    nullableLabel: 'Not currently applicable',
  },
  {
    id: 'lifepartner',
    label: 'Life Partner',
    category: 'foundation',
    emoji: '🔭',
    pronoun: 'i',
    pass1Question: 'I feel like my future is genuinely shared with this person.',
    pass2Question: 'I would feel my future is genuinely shared with this person.',
    intentionalityQuestion: 'The level of life integration between us is something I\'ve chosen, not fallen into.',
    nullable: false,
  },
  {
    id: 'collaborating',
    label: 'Collaborating',
    category: 'foundation',
    emoji: '⚙️',
    pronoun: 'we',
    pass1Question: 'We function well as a unit when something real needs doing.',
    pass2Question: 'We would function well as a unit under pressure or when stakes are real.',
    intentionalityQuestion: 'How we operate together on real problems is something we\'ve consciously developed.',
    nullable: false,
  },

  // ── ARCHITECTURE ────────────────────────────────────────────────────────────
  {
    id: 'emotionalintimacy',
    label: 'Emotional Intimacy',
    category: 'architecture',
    emoji: '🫀',
    pronoun: 'i',
    pass1Question: 'I feel genuinely known by this person right now.',
    pass2Question: 'I would feel genuinely known — the unperformed version of myself.',
    intentionalityQuestion: 'The depth of our emotional intimacy is something we\'ve cultivated deliberately.',
    nullable: false,
  },
  {
    id: 'emotionalsupport',
    label: 'Emotional Support',
    category: 'architecture',
    emoji: '🤲',
    pronoun: 'i',
    pass1Question: 'I feel reliably held by this relationship when I need it.',
    pass2Question: 'I would feel reliably held — this relationship would be a dependable source of support.',
    intentionalityQuestion: 'How we support each other emotionally is something we\'ve explicitly shaped.',
    nullable: false,
  },
  {
    id: 'socialpartners',
    label: 'Social Partners',
    category: 'architecture',
    emoji: '🌐',
    pronoun: 'we',
    pass1Question: 'We navigate the world together — each other\'s people, shared contexts — without friction.',
    pass2Question: 'We would move through the world together in a way that feels natural and mutual.',
    intentionalityQuestion: 'How we show up socially as a unit is something we\'ve talked about and agreed on.',
    nullable: false,
  },
  {
    id: 'finances',
    label: 'Finances',
    category: 'architecture',
    emoji: '💰',
    pronoun: 'we',
    pass1Question: 'We have a functional shared economic life right now.',
    pass2Question: 'We would have a shared economic life that works and reflects both our values.',
    intentionalityQuestion: 'Our financial arrangements are the result of deliberate agreement, not whoever earned more or paid first.',
    nullable: false,
  },
  {
    id: 'caretaking',
    label: 'Caretaking',
    category: 'architecture',
    emoji: '🩹',
    pronoun: 'i',
    pass1Question: 'I trust this person to show up when things get genuinely hard.',
    pass2Question: 'I would trust this person to show up for illness, crisis, or personal difficulty.',
    intentionalityQuestion: 'We\'ve explicitly talked about what we expect from each other when things get hard.',
    nullable: false,
  },
  {
    id: 'business',
    label: 'Business',
    category: 'architecture',
    emoji: '📋',
    pronoun: 'we',
    pass1Question: 'We are functional partners when real-world stakes are involved — joint ventures, property, or professional collaboration.',
    pass2Question: 'We would be functional economic or professional partners when stakes are real.',
    intentionalityQuestion: 'Any joint economic or professional collaboration between us is something we\'ve explicitly structured.',
    nullable: true,
    nullableLabel: 'No joint economic activity',
  },

  // ── EDGES ────────────────────────────────────────────────────────────────────
  {
    id: 'romance',
    label: 'Romance',
    category: 'edges',
    emoji: '✨',
    pronoun: 'i',
    pass1Question: 'I feel romantic energy flowing between us — pursuit, attention, and being seen.',
    pass2Question: 'I would feel romantic energy flowing — active pursuit, not just presence.',
    intentionalityQuestion: 'The romantic dimension of this relationship is something we actively maintain, not assume.',
    nullable: false,
    edgesLocked: true,
  },
  {
    id: 'physicality',
    label: 'Physicality',
    category: 'edges',
    emoji: '🫂',
    pronoun: 'i',
    pass1Question: 'I feel physically comfortable and close with this person — proximity, body language, casual presence.',
    pass2Question: 'I would feel physically at ease and close with this person.',
    intentionalityQuestion: 'How we occupy physical space together is something we\'ve been conscious about.',
    nullable: false,
    edgesLocked: true,
  },
  {
    id: 'touch',
    label: 'Touch',
    category: 'edges',
    emoji: '🤍',
    pronoun: 'i',
    pass1Question: 'My need for physical affection is being met in this relationship.',
    pass2Question: 'My need for physical affection would be genuinely met.',
    intentionalityQuestion: 'How affection is expressed between us is something we\'ve talked about and shaped.',
    nullable: false,
    edgesLocked: true,
  },
  {
    id: 'sex',
    label: 'Sex',
    category: 'edges',
    emoji: '🔥',
    pronoun: 'i',
    pass1Question: 'My sexual connection with this person reflects what I actually want right now.',
    pass2Question: 'My sexual connection with this person would reflect what I genuinely want.',
    intentionalityQuestion: 'Our sexual dynamic is something we\'ve explicitly shaped together — not assumed.',
    nullable: false,
    edgesLocked: true,
  },
  {
    id: 'kink',
    label: 'Kink',
    category: 'edges',
    emoji: '🗝️',
    pronoun: 'i',
    pass1Question: 'I can bring my full range of interest and curiosity into this relationship.',
    pass2Question: 'I would be able to bring my full range of interest and curiosity here.',
    intentionalityQuestion: 'What we explore together is the result of explicit conversation and consent.',
    nullable: false,
    edgesLocked: true,
  },
  {
    id: 'powerdynamic',
    label: 'Power Dynamic',
    category: 'edges',
    emoji: '⚖️',
    pronoun: 'i',
    pass1Question: 'I feel clear and at ease with how authority moves between us.',
    pass2Question: 'I would feel clear and at ease with the authority structure between us.',
    intentionalityQuestion: 'The power structure in this relationship is something we\'ve explicitly named and chosen.',
    nullable: false,
    edgesLocked: true,
  },
];

// ── LOOKUPS ───────────────────────────────────────────────────────────────────

export const DOMAIN_MAP = Object.fromEntries(DOMAINS.map(d => [d.id, d]));

export function getDomainsByCategory(categoryId) {
  return DOMAINS.filter(d => d.category === categoryId);
}

export function getCategory(categoryId) {
  return CATEGORIES[categoryId];
}

export function isEdgesDomain(domainId) {
  return DOMAIN_MAP[domainId]?.edgesLocked === true;
}

// ── COORDINATE LABELS ─────────────────────────────────────────────────────────

export const X_LABELS = {
  1: 'Barely present',
  2: 'Underdeveloped',
  3: 'Functional',
  4: 'Strong',
  5: 'Central & abundant',
};

export const Y_LABELS = {
  1: 'Entirely inherited',
  2: 'Mostly default',
  3: 'Partly conscious',
  4: 'Largely designed',
  5: 'Explicitly designed',
};

export const Z_LABELS = {
  1: 'Fully open — others have equal standing',
  2: 'Mostly open — others have significant standing',
  3: 'Shared primary — we are first among equals',
  4: 'Mostly bounded — others have minor standing',
  5: 'Fully exclusive — this belongs to us alone',
};
