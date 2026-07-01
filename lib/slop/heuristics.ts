import { verdictForScore, type SlopSegment } from './types';

/**
 * Local AI-generated-text heuristic — the always-available "small analysis
 * function" (no network, sends nothing off-device).
 *
 * It is deliberately lightweight and transparent: a set of surface signals
 * that correlate with LLM prose, each contributing points, plus human-signal
 * adjustments (contractions, first person) that reduce the score — mirroring
 * sloptotal's stated scoring principles. This is a heuristic, not a classifier;
 * it exists so the feature works with no endpoint, and as a fast pre-filter.
 */

interface Signal {
  reason: string;
  points: number;
  /** True if the signal is present in `text`. */
  test: (text: string, lower: string) => boolean;
}

// Phrases and constructions that show up disproportionately in LLM output.
const CLICHE_PHRASES = [
  'delve into',
  'in the realm of',
  'navigating the complexities',
  'navigate the complexities',
  "in today's fast-paced world",
  "in today's digital age",
  'it is important to note',
  "it's important to note",
  'it is worth noting',
  'a testament to',
  'plays a crucial role',
  'plays a pivotal role',
  'plays a vital role',
  'when it comes to',
  'unlock the potential',
  'unlock the power',
  'a rich tapestry',
  'the ever-evolving',
  'ever-changing landscape',
  'at the end of the day',
  'need to consider',
  'foster a sense',
  'gain a deeper understanding',
  'shed light on',
  'underscore the importance',
  'pave the way',
];

const TRANSITION_WORDS = [
  'furthermore',
  'moreover',
  'additionally',
  'consequently',
  'nevertheless',
  'nonetheless',
  'in conclusion',
  'in summary',
  'ultimately',
  'notably',
];

const AI_BUZZWORDS = [
  'leverage',
  'seamless',
  'seamlessly',
  'robust',
  'holistic',
  'synergy',
  'elevate',
  'empower',
  'cutting-edge',
  'game-changer',
  'game-changing',
  'top-notch',
  'unparalleled',
  'multifaceted',
];

const CONTRACTIONS = /\b(?:i'm|you're|we're|they're|don't|can't|won't|didn't|isn't|it's|that's|there's|i've|we've|you'll|i'll)\b/gi;
const FIRST_PERSON = /\b(?:i|me|my|mine|we|us|our)\b/gi;

function countMatches(re: RegExp, text: string): number {
  const m = text.match(re);
  return m ? m.length : 0;
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// Boolean signals (present/absent). Density-based ones are scored separately
// in scoreTextLocally so that a *concentration* of clichés/buzzwords — the real
// tell — accumulates rather than firing once.
const SIGNALS: Signal[] = [
  {
    reason: 'Explicit AI self-reference',
    points: 60,
    test: (_t, l) =>
      /\bas an ai (language )?model\b/.test(l) ||
      /\bi (cannot|can't) (provide|browse|access)\b/.test(l),
  },
  {
    reason: '"Not only… but also" construction',
    points: 10,
    test: (_t, l) => /\bnot only\b[^.?!]*\bbut also\b/.test(l),
  },
  {
    reason: 'Rule-of-three triads',
    points: 8,
    test: (t) => /\b\w+,\s+\w+,\s+and\s+\w+\b/.test(t) && /,\s+\w+,\s+and\b/.test(t),
  },
  {
    reason: 'Heavy em-dash usage',
    points: 8,
    test: (t) => countMatches(/—|\s-\s/g, t) >= 3,
  },
  {
    reason: 'Uniform, long sentences',
    points: 12,
    test: (t) => {
      const sents = splitSentences(t);
      if (sents.length < 4) return false;
      const lens = sents.map((s) => s.split(/\s+/).length);
      const mean = lens.reduce((a, b) => a + b, 0) / lens.length;
      if (mean < 16) return false;
      const variance =
        lens.reduce((a, b) => a + (b - mean) ** 2, 0) / lens.length;
      // Low variance (very even cadence) + long average is LLM-like.
      return Math.sqrt(variance) < 5;
    },
  },
];

export interface LocalScore {
  score: number; // 0–100
  reasons: string[];
}

/** Score a single block of text locally. Longer text → more confident signal. */
export function scoreTextLocally(text: string): LocalScore {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();
  const words = trimmed.split(/\s+/).filter(Boolean).length;
  if (words < 20) return { score: 0, reasons: [] };

  let score = 0;
  const reasons: string[] = [];

  // Density-based signals: count hits, weight per hit, cap the contribution.
  const clicheHits = CLICHE_PHRASES.filter((p) => lower.includes(p)).length;
  if (clicheHits > 0) {
    score += Math.min(45, clicheHits * 15);
    reasons.push(`LLM cliché phrasing (${clicheHits})`);
  }
  const buzzHits = AI_BUZZWORDS.filter((w) => lower.includes(w)).length;
  if (buzzHits >= 2) {
    score += Math.min(21, buzzHits * 7);
    reasons.push(`Marketing / buzzword density (${buzzHits})`);
  }
  const transitionHits = TRANSITION_WORDS.filter((w) => lower.includes(w)).length;
  if (transitionHits >= 2) {
    score += Math.min(20, 8 + (transitionHits - 2) * 4);
    reasons.push(`Formal transition scaffolding (${transitionHits})`);
  }

  // Boolean signals.
  for (const sig of SIGNALS) {
    if (sig.test(trimmed, lower)) {
      score += sig.points;
      reasons.push(sig.reason);
    }
  }

  // Human-signal adjustments (reduce score), per sloptotal's principle.
  const contractionRate = (countMatches(CONTRACTIONS, lower) / words) * 100;
  const firstPersonRate = (countMatches(FIRST_PERSON, lower) / words) * 100;
  if (contractionRate > 1.5) {
    score -= 12;
    reasons.push('Human signal: frequent contractions');
  }
  if (firstPersonRate > 3) {
    score -= 10;
    reasons.push('Human signal: strong first-person voice');
  }

  // Short blocks can't be confident — damp toward uncertain.
  if (words < 60) score = Math.min(score, 55);

  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, reasons };
}

/** Confidence bucket mirroring sloptotal's length-based confidence. */
export function localConfidence(charCount: number): string {
  if (charCount < 150) return 'low';
  if (charCount < 300) return 'medium';
  return 'high';
}

/** Convenience: produce a full SlopSegment from an id + text using the local heuristic. */
export function localSegment(id: string, text: string): SlopSegment {
  const { score, reasons } = scoreTextLocally(text);
  return {
    id,
    textPreview: text.slice(0, 200),
    charCount: text.length,
    score,
    verdict: verdictForScore(score),
    confidence: localConfidence(text.length),
    source: 'local',
    reasons,
  };
}
