// src/utils/modifierMatcher.ts - Modifier text to Trade API stat ID mapping
//
// NOTE: PoE2 uses different stat IDs than PoE1. The hardcoded IDs below are
// patterns for text matching. For actual Trade API searches, the backend
// should fetch stat IDs dynamically from /api/trade2/data/stats endpoint
// or use text-based search queries.

interface ModifierPattern {
  pattern: RegExp;
  textPattern: string; // Normalized text pattern for API matching
  type: "explicit" | "implicit" | "crafted";
  category: string;
}

// Common modifier patterns for PoE2
// These patterns help normalize modifier text for Trade API queries
// The Trade API supports text-based matching via stat filters
const MODIFIER_PATTERNS: ModifierPattern[] = [
  // Life
  {
    pattern: /^\+?(\d+) to maximum Life$/i,
    textPattern: "# to maximum Life",
    type: "explicit",
    category: "life",
  },
  {
    pattern: /^(\d+)% increased maximum Life$/i,
    textPattern: "#% increased maximum Life",
    type: "explicit",
    category: "life",
  },
  {
    pattern: /^Regenerate ([\d.]+) Life per second$/i,
    textPattern: "Regenerate # Life per second",
    type: "explicit",
    category: "life",
  },

  // Mana
  {
    pattern: /^\+?(\d+) to maximum Mana$/i,
    textPattern: "# to maximum Mana",
    type: "explicit",
    category: "mana",
  },
  {
    pattern: /^(\d+)% increased maximum Mana$/i,
    textPattern: "#% increased maximum Mana",
    type: "explicit",
    category: "mana",
  },

  // Resistances
  {
    pattern: /^\+?(\d+)% to Fire Resistance$/i,
    textPattern: "#% to Fire Resistance",
    type: "explicit",
    category: "resistance",
  },
  {
    pattern: /^\+?(\d+)% to Cold Resistance$/i,
    textPattern: "#% to Cold Resistance",
    type: "explicit",
    category: "resistance",
  },
  {
    pattern: /^\+?(\d+)% to Lightning Resistance$/i,
    textPattern: "#% to Lightning Resistance",
    type: "explicit",
    category: "resistance",
  },
  {
    pattern: /^\+?(\d+)% to Chaos Resistance$/i,
    textPattern: "#% to Chaos Resistance",
    type: "explicit",
    category: "resistance",
  },
  {
    pattern: /^\+?(\d+)% to all Elemental Resistances$/i,
    textPattern: "#% to all Elemental Resistances",
    type: "explicit",
    category: "resistance",
  },

  // Defenses - Flat
  {
    pattern: /^\+?(\d+) to Armour$/i,
    textPattern: "# to Armour",
    type: "explicit",
    category: "defence",
  },
  {
    pattern: /^\+?(\d+) to Evasion Rating$/i,
    textPattern: "# to Evasion Rating",
    type: "explicit",
    category: "defence",
  },
  {
    pattern: /^\+?(\d+) to maximum Energy Shield$/i,
    textPattern: "# to maximum Energy Shield",
    type: "explicit",
    category: "defence",
  },

  // Defenses - Increased
  {
    pattern: /^(\d+)% increased Armour$/i,
    textPattern: "#% increased Armour",
    type: "explicit",
    category: "defence",
  },
  {
    pattern: /^(\d+)% increased Evasion Rating$/i,
    textPattern: "#% increased Evasion Rating",
    type: "explicit",
    category: "defence",
  },
  {
    pattern: /^(\d+)% increased Energy Shield$/i,
    textPattern: "#% increased Energy Shield",
    type: "explicit",
    category: "defence",
  },
  {
    pattern: /^(\d+)% increased Armour and Evasion$/i,
    textPattern: "#% increased Armour and Evasion",
    type: "explicit",
    category: "defence",
  },

  // Damage - Physical
  {
    pattern: /^Adds (\d+) to (\d+) Physical Damage$/i,
    textPattern: "Adds # to # Physical Damage",
    type: "explicit",
    category: "damage",
  },
  {
    pattern: /^(\d+)% increased Physical Damage$/i,
    textPattern: "#% increased Physical Damage",
    type: "explicit",
    category: "damage",
  },

  // Damage - Elemental
  {
    pattern: /^Adds (\d+) to (\d+) Fire Damage$/i,
    textPattern: "Adds # to # Fire Damage",
    type: "explicit",
    category: "damage",
  },
  {
    pattern: /^Adds (\d+) to (\d+) Cold Damage$/i,
    textPattern: "Adds # to # Cold Damage",
    type: "explicit",
    category: "damage",
  },
  {
    pattern: /^Adds (\d+) to (\d+) Lightning Damage$/i,
    textPattern: "Adds # to # Lightning Damage",
    type: "explicit",
    category: "damage",
  },

  // Attack modifiers
  {
    pattern: /^(\d+)% increased Attack Speed$/i,
    textPattern: "#% increased Attack Speed",
    type: "explicit",
    category: "attack",
  },
  {
    pattern: /^(\d+)% increased Critical Hit Chance$/i,
    textPattern: "#% increased Critical Hit Chance",
    type: "explicit",
    category: "critical",
  },
  {
    pattern: /^\+?(\d+)% to Critical Hit Multiplier$/i,
    textPattern: "#% to Critical Hit Multiplier",
    type: "explicit",
    category: "critical",
  },
  {
    pattern: /^(\d+)% increased Accuracy Rating$/i,
    textPattern: "#% increased Accuracy Rating",
    type: "explicit",
    category: "attack",
  },

  // Cast Speed
  {
    pattern: /^(\d+)% increased Cast Speed$/i,
    textPattern: "#% increased Cast Speed",
    type: "explicit",
    category: "caster",
  },

  // Attributes
  {
    pattern: /^\+?(\d+) to Strength$/i,
    textPattern: "# to Strength",
    type: "explicit",
    category: "attribute",
  },
  {
    pattern: /^\+?(\d+) to Dexterity$/i,
    textPattern: "# to Dexterity",
    type: "explicit",
    category: "attribute",
  },
  {
    pattern: /^\+?(\d+) to Intelligence$/i,
    textPattern: "# to Intelligence",
    type: "explicit",
    category: "attribute",
  },
  {
    pattern: /^\+?(\d+) to all Attributes$/i,
    textPattern: "# to all Attributes",
    type: "explicit",
    category: "attribute",
  },

  // Movement
  {
    pattern: /^(\d+)% increased Movement Speed$/i,
    textPattern: "#% increased Movement Speed",
    type: "explicit",
    category: "speed",
  },

  // Flask
  {
    pattern: /^(\d+)% increased Flask Effect Duration$/i,
    textPattern: "#% increased Flask Effect Duration",
    type: "explicit",
    category: "flask",
  },
  {
    pattern: /^(\d+)% increased Flask Charges gained$/i,
    textPattern: "#% increased Flask Charges gained",
    type: "explicit",
    category: "flask",
  },

  // Skill gems/skills (PoE2 uses "Skills" instead of "Gems")
  {
    pattern: /^\+?(\d+) to Level of all .*? Skills$/i,
    textPattern: "# to Level of all Skills",
    type: "explicit",
    category: "gem",
  },
  {
    pattern: /^\+?(\d+) to Level of all .*? Gems$/i,
    textPattern: "# to Level of all Gems",
    type: "explicit",
    category: "gem",
  },
  {
    pattern: /^\+?(\d+)% to Quality of all Skill Gems$/i,
    textPattern: "#% to Quality of all Skill Gems",
    type: "explicit",
    category: "gem",
  },

  // PoE2 specific - Spell Damage
  {
    pattern: /^(\d+)% increased Spell Damage$/i,
    textPattern: "#% increased Spell Damage",
    type: "explicit",
    category: "caster",
  },
  {
    pattern: /^(\d+)% increased Lightning Damage$/i,
    textPattern: "#% increased Lightning Damage",
    type: "explicit",
    category: "damage",
  },
  {
    pattern: /^(\d+)% increased Fire Damage$/i,
    textPattern: "#% increased Fire Damage",
    type: "explicit",
    category: "damage",
  },
  {
    pattern: /^(\d+)% increased Cold Damage$/i,
    textPattern: "#% increased Cold Damage",
    type: "explicit",
    category: "damage",
  },
];

// Cache for stat IDs fetched from the API
let statIdCache: Map<string, string> | null = null;

/**
 * Normalize modifier text for matching
 * Replaces numbers with # to create a pattern
 */
export function normalizeModifierText(text: string): string {
  return text
    .trim()
    .replace(/\+?(\d+(?:\.\d+)?)/g, "#")
    .replace(/\s+/g, " ");
}

/**
 * Match modifier text to find its pattern and extract values
 */
export function matchModifier(text: string): {
  tradeId: string | null;
  textPattern: string | null;
  values: number[];
  category: string | null;
} {
  const cleanText = text.trim();

  for (const pattern of MODIFIER_PATTERNS) {
    const match = cleanText.match(pattern.pattern);
    if (match) {
      const values = match.slice(1).map((v) => parseFloat(v)).filter((v) => !isNaN(v));

      // Try to get cached stat ID, or use text pattern for API search
      const normalizedText = normalizeModifierText(cleanText);
      const cachedId = statIdCache?.get(normalizedText);

      return {
        tradeId: cachedId || null,
        textPattern: pattern.textPattern,
        values,
        category: pattern.category,
      };
    }
  }

  // No pattern match - extract values anyway for potential fuzzy matching
  const values: number[] = [];
  const numPattern = /(\d+(?:\.\d+)?)/g;
  let numMatch;
  while ((numMatch = numPattern.exec(cleanText)) !== null) {
    values.push(parseFloat(numMatch[1]));
  }

  return {
    tradeId: null,
    textPattern: normalizeModifierText(cleanText),
    values,
    category: null,
  };
}

/**
 * Set the stat ID cache (called after fetching from API)
 */
export function setStatIdCache(cache: Map<string, string>): void {
  statIdCache = cache;
}

/**
 * Build modifier filter for Trade API query
 * Can work with either stat ID or text pattern
 */
export function buildModifierFilter(
  modifier: {
    tradeId?: string | null;
    textPattern?: string | null;
    values: number[];
  },
  options: {
    minPercent?: number;
    exact?: boolean;
  } = {}
): {
  id?: string;
  value?: { min?: number; max?: number };
} | null {
  // If we have a stat ID, use it directly
  if (modifier.tradeId) {
    const filter: { id: string; value?: { min?: number; max?: number } } = {
      id: modifier.tradeId,
    };

    if (modifier.values.length > 0 && !options.exact) {
      const primary = modifier.values[0];
      const minPercent = options.minPercent || 0.8;
      filter.value = {
        min: Math.floor(primary * minPercent),
      };
    } else if (modifier.values.length > 0 && options.exact) {
      filter.value = {
        min: modifier.values[0],
        max: modifier.values[0],
      };
    }

    return filter;
  }

  // Without stat ID, return null - the backend should handle text-based search
  return null;
}

/**
 * Try to match all modifiers in an item and assign trade IDs
 */
export function matchAllModifiers(
  modifiers: Array<{ text: string; values: number[] }>
): Array<{
  text: string;
  values: number[];
  tradeId: string | null;
  textPattern: string | null;
  category: string | null;
}> {
  return modifiers.map((mod) => {
    const result = matchModifier(mod.text);
    return {
      ...mod,
      tradeId: result.tradeId,
      textPattern: result.textPattern,
      category: result.category,
    };
  });
}

/**
 * Format price for display
 */
export function formatPrice(
  amount: number | undefined,
  currency: string
): string {
  if (amount === undefined || amount === null) {
    return "N/A";
  }

  // Format currency names - PoE2 uses different orbs
  const currencyNames: Record<string, string> = {
    // PoE2 currency
    gold: "gold",
    exalted: "ex",
    divine: "div",
    chaos: "c",
    // API response formats
    "exalted-orb": "ex",
    "divine-orb": "div",
    "chaos-orb": "c",
    "regal-orb": "regal",
    "vaal-orb": "vaal",
  };

  const shortName = currencyNames[currency.toLowerCase()] || currency;

  if (amount >= 1000) {
    return `${(amount / 1000).toFixed(1)}k ${shortName}`;
  }

  if (amount >= 1) {
    return `${Math.round(amount)} ${shortName}`;
  }

  return `${amount.toFixed(2)} ${shortName}`;
}

/**
 * Get the best price to display from price data
 */
export function getBestPrice(price: {
  chaos?: number;
  exalted?: number;
  divine?: number;
  gold?: number;
}): { amount: number; currency: string } | null {
  // PoE2 price hierarchy: Divine > Exalted > Chaos > Gold
  if (price.divine && price.divine >= 1) {
    return { amount: price.divine, currency: "divine" };
  }
  if (price.exalted && price.exalted >= 1) {
    return { amount: price.exalted, currency: "exalted" };
  }
  if (price.chaos) {
    return { amount: price.chaos, currency: "chaos" };
  }
  if (price.gold) {
    return { amount: price.gold, currency: "gold" };
  }
  return null;
}
