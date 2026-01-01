// src/utils/itemEvaluator.ts - Item quality evaluation using tier data
//
// Evaluates items based on their modifier tiers and provides:
// - Overall quality score (0-100)
// - Rating (trash/okay/good/great/excellent)
// - Per-modifier tier breakdown
// - "Good Item" quick indicator

import { ParsedItem, ItemModifier } from "../lib/types";
import {
  matchModifierToTier,
  TierMatchResult,
  getTierColor,
  getTierLabel,
  ModifierCategory,
} from "../data/modifierTiers";

// =========================================================================
// TYPES
// =========================================================================

export type ItemRating = "trash" | "okay" | "good" | "great" | "excellent";

export interface ModifierEvaluation {
  text: string;
  tier: number | null;          // null if no tier data available
  totalTiers: number;
  tierLabel: string;            // e.g., "T1", "T2"
  tierColor: string;            // CSS color
  rollPercent: number;          // 0-100, how good is the roll within tier
  score: number;                // 0-100 contribution to overall score
  category: ModifierCategory | null;
  notes: string[];              // Additional notes/tips
}

export interface ItemEvaluation {
  overallScore: number;         // 0-100 overall quality
  rating: ItemRating;           // Quick rating label
  goodIndicator: boolean;       // true if item is "good" or better
  modifierBreakdown: ModifierEvaluation[];
  suggestions: string[];        // Tips for the user
  summary: string;              // Brief summary text
}

// =========================================================================
// CATEGORY WEIGHTS
// =========================================================================

// How much each category contributes to overall score
// Higher weight = more important for item valuation
const CATEGORY_WEIGHTS: Record<ModifierCategory | "other", number> = {
  life: 1.2,           // Life is always valuable
  resistance: 1.0,     // Resistances are important
  damage: 1.1,         // Damage mods are valuable on weapons
  critical: 1.15,      // Crit mods are valuable
  speed: 1.25,         // Movement/attack speed very valuable
  attribute: 0.8,      // Attributes are okay
  defense: 0.9,        // Defense mods are decent
  mana: 0.7,           // Mana is less critical
  accuracy: 0.75,      // Accuracy is situational
  other: 0.6,          // Unknown mods get lower weight
};

// Bonus for specific valuable mods
const VALUABLE_MOD_PATTERNS = [
  { pattern: /movement speed/i, bonus: 15 },
  { pattern: /all elemental resist/i, bonus: 20 },
  { pattern: /critical.*multiplier/i, bonus: 10 },
  { pattern: /maximum life.*%/i, bonus: 10 },
  { pattern: /level.*skill/i, bonus: 15 },
];

// =========================================================================
// EVALUATION FUNCTIONS
// =========================================================================

/**
 * Evaluate a single modifier and return its tier info
 */
export function evaluateModifier(modifier: ItemModifier): ModifierEvaluation {
  const tierResult = matchModifierToTier(modifier.text);

  if (!tierResult) {
    // No tier data available for this modifier
    return {
      text: modifier.text,
      tier: null,
      totalTiers: 0,
      tierLabel: "?",
      tierColor: "#868e96", // Gray
      rollPercent: 0,
      score: 30, // Base score for unknown mods
      category: null,
      notes: ["No tier data available"],
    };
  }

  const { matchedTier, totalTiers, tierPercent, rollPercent, modifier: modData } = tierResult;

  // Calculate score based on tier and roll
  // T1 perfect roll = 100, T1 min roll = 85, T2 perfect = 80, etc.
  const tierScore = tierPercent; // 100 for T1, lower for worse tiers
  const rollBonus = (rollPercent / 100) * 15; // Up to 15 bonus for perfect roll
  let score = tierScore * 0.85 + rollBonus;

  // Apply category weight
  const weight = CATEGORY_WEIGHTS[modData.category] || CATEGORY_WEIGHTS.other;
  score *= weight;

  // Apply valuable mod bonus
  for (const { pattern, bonus } of VALUABLE_MOD_PATTERNS) {
    if (pattern.test(modifier.text)) {
      score += bonus;
      break;
    }
  }

  // Cap at 100
  score = Math.min(100, Math.round(score));

  // Generate notes
  const notes: string[] = [];

  if (matchedTier === 1 && rollPercent >= 80) {
    notes.push("Excellent roll!");
  } else if (matchedTier === 1) {
    notes.push("Top tier");
  } else if (matchedTier === 2) {
    notes.push("Very good tier");
  } else if (matchedTier >= totalTiers - 1) {
    notes.push("Low tier - consider upgrading");
  }

  if (rollPercent >= 90) {
    notes.push("High roll");
  } else if (rollPercent <= 20 && matchedTier <= 2) {
    notes.push("Low roll for tier");
  }

  return {
    text: modifier.text,
    tier: matchedTier,
    totalTiers,
    tierLabel: getTierLabel(matchedTier),
    tierColor: getTierColor(matchedTier, totalTiers),
    rollPercent,
    score,
    category: modData.category,
    notes,
  };
}

/**
 * Evaluate all modifiers on an item
 */
export function evaluateItem(item: ParsedItem): ItemEvaluation {
  // Combine all modifiers
  const allMods = [
    ...item.implicitMods,
    ...item.explicitMods,
    ...item.craftedMods,
  ];

  // Evaluate each modifier
  const modifierBreakdown = allMods.map(evaluateModifier);

  // Calculate overall score
  let totalScore = 0;
  let evalCount = 0;

  for (const evalResult of modifierBreakdown) {
    if (evalResult.tier !== null) {
      totalScore += evalResult.score;
      evalCount++;
    }
  }

  // If we evaluated any mods, calculate average; otherwise use 30 as base
  const overallScore = evalCount > 0
    ? Math.round(totalScore / evalCount)
    : 30;

  // Bonus for having many good mods
  const goodModCount = modifierBreakdown.filter(m => m.tier !== null && m.tier <= 3).length;
  const adjustedScore = Math.min(100, overallScore + (goodModCount > 3 ? 5 : 0));

  // Determine rating
  let rating: ItemRating;
  if (adjustedScore >= 85) {
    rating = "excellent";
  } else if (adjustedScore >= 70) {
    rating = "great";
  } else if (adjustedScore >= 55) {
    rating = "good";
  } else if (adjustedScore >= 40) {
    rating = "okay";
  } else {
    rating = "trash";
  }

  // Good indicator (green checkmark worthy)
  const goodIndicator = adjustedScore >= 65 || goodModCount >= 3;

  // Generate suggestions
  const suggestions: string[] = [];

  // Check for empty affix slots
  const explicitCount = item.explicitMods.length;
  const maxAffixes = 6; // Rare items can have up to 6 explicit mods
  if (item.rarity === "Rare" && explicitCount < maxAffixes) {
    suggestions.push(`Item has ${maxAffixes - explicitCount} empty affix slot(s)`);
  }

  // Check for bad tiers
  const badTierMods = modifierBreakdown.filter(m => m.tier !== null && m.tier >= 5);
  if (badTierMods.length > 0) {
    suggestions.push(`${badTierMods.length} mod(s) have low tiers (T5+)`);
  }

  // Check for low rolls on good tiers
  const lowRollMods = modifierBreakdown.filter(
    m => m.tier !== null && m.tier <= 3 && m.rollPercent < 30
  );
  if (lowRollMods.length > 0) {
    suggestions.push(`${lowRollMods.length} good tier mod(s) have low rolls`);
  }

  // Generate summary
  let summary: string;
  if (rating === "excellent") {
    summary = "Excellent item with top-tier rolls";
  } else if (rating === "great") {
    summary = "Great item with solid modifiers";
  } else if (rating === "good") {
    summary = "Good item, usable for most builds";
  } else if (rating === "okay") {
    summary = "Decent item, may need upgrades";
  } else {
    summary = "Low quality, consider replacement";
  }

  return {
    overallScore: adjustedScore,
    rating,
    goodIndicator,
    modifierBreakdown,
    suggestions,
    summary,
  };
}

// =========================================================================
// UTILITY FUNCTIONS
// =========================================================================

/**
 * Get CSS color for rating
 */
export function getRatingColor(rating: ItemRating): string {
  const colors: Record<ItemRating, string> = {
    excellent: "#40c057", // Green
    great: "#69db7c",     // Light green
    good: "#fab005",      // Yellow
    okay: "#ff922b",      // Orange
    trash: "#868e96",     // Gray
  };
  return colors[rating];
}

/**
 * Get rating label for display
 */
export function getRatingLabel(rating: ItemRating): string {
  const labels: Record<ItemRating, string> = {
    excellent: "Excellent",
    great: "Great",
    good: "Good",
    okay: "Okay",
    trash: "Low",
  };
  return labels[rating];
}

/**
 * Format score for display
 */
export function formatScore(score: number): string {
  return `${Math.round(score)}`;
}

/**
 * Quick check if item is worth keeping/selling
 */
export function isItemWorthKeeping(item: ParsedItem): boolean {
  const evaluation = evaluateItem(item);
  return evaluation.goodIndicator;
}

/**
 * Get a quick tier summary string
 * e.g., "T1 T2 T3 T5" for the modifiers
 */
export function getQuickTierSummary(item: ParsedItem): string {
  const evaluation = evaluateItem(item);
  const tiers = evaluation.modifierBreakdown
    .filter(m => m.tier !== null)
    .map(m => m.tierLabel)
    .join(" ");

  return tiers || "No tier data";
}

// =========================================================================
// PRICE ESTIMATION
// =========================================================================

export interface PriceEstimate {
  minPrice: number;
  maxPrice: number;
  currency: string;
  confidence: "high" | "medium" | "low";
  reason: string;
  basedOn: string;
}

/**
 * Multiplier ranges based on item rating
 * [minMultiplier, maxMultiplier]
 * More conservative - base price already includes decent items
 */
const RATING_MULTIPLIERS: Record<ItemRating, [number, number]> = {
  excellent: [1.5, 3.0],   // T1 mods, high rolls - premium over base
  great: [1.2, 2.0],       // T2 mods, good rolls
  good: [1.0, 1.5],        // T3-T4 mods, around base price
  okay: [0.8, 1.2],        // Mixed tiers - might be below average
  trash: [0.5, 0.9],       // Low tier mods - worth less than base
};

/**
 * Estimate item price based on base price and item quality
 *
 * @param basePrice - Price from base-only search (Tier 3)
 * @param baseCurrency - Currency of base price
 * @param baseListingCount - Number of listings for base price
 * @param evaluation - Item quality evaluation
 * @returns Price estimate with range and confidence
 */
export function estimatePrice(
  basePrice: number,
  baseCurrency: string,
  baseListingCount: number,
  evaluation: ItemEvaluation
): PriceEstimate {
  const [minMult, maxMult] = RATING_MULTIPLIERS[evaluation.rating];

  // Adjust multipliers based on specific mod tiers
  let adjustedMinMult = minMult;
  let adjustedMaxMult = maxMult;

  // Count T1 and T2 mods for additional adjustment (conservative)
  const t1Count = evaluation.modifierBreakdown.filter(m => m.tier === 1).length;
  const t2Count = evaluation.modifierBreakdown.filter(m => m.tier === 2).length;

  // T1 mods add modest premium
  if (t1Count >= 2) {
    adjustedMinMult *= 1.15;
    adjustedMaxMult *= 1.25;
  } else if (t1Count === 1) {
    adjustedMinMult *= 1.05;
    adjustedMaxMult *= 1.1;
  }

  // T2 mods add small premium
  if (t2Count >= 2) {
    adjustedMinMult *= 1.05;
    adjustedMaxMult *= 1.1;
  }

  // Calculate price range
  const minPrice = Math.round(basePrice * adjustedMinMult * 10) / 10;
  const maxPrice = Math.round(basePrice * adjustedMaxMult * 10) / 10;

  // Determine confidence based on listing count and tier data
  let confidence: "high" | "medium" | "low";
  const modsWithTiers = evaluation.modifierBreakdown.filter(m => m.tier !== null).length;

  if (baseListingCount >= 10 && modsWithTiers >= 3) {
    confidence = "high";
  } else if (baseListingCount >= 5 || modsWithTiers >= 2) {
    confidence = "medium";
  } else {
    confidence = "low";
  }

  // Build reason string
  const tierSummary = evaluation.modifierBreakdown
    .filter(m => m.tier !== null)
    .slice(0, 3)
    .map(m => m.tierLabel)
    .join(" ");

  const reason = `${evaluation.rating} item` +
    (t1Count > 0 ? ` with ${t1Count}×T1` : "") +
    (t2Count > 0 ? ` ${t2Count}×T2` : "") +
    (tierSummary ? ` (${tierSummary}...)` : "");

  const basedOn = `${baseListingCount} base listings`;

  return {
    minPrice,
    maxPrice,
    currency: baseCurrency,
    confidence,
    reason,
    basedOn,
  };
}
