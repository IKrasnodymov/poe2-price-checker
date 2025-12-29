// src/lib/types.ts - Type definitions for PoE2 Price Checker

// =========================================================================
// ITEM PARSING TYPES
// =========================================================================

export type ItemRarity =
  | "Normal"
  | "Magic"
  | "Rare"
  | "Unique"
  | "Currency"
  | "Gem"
  | "DivinationCard";

export interface ParsedItem {
  raw: string;
  itemClass: string;
  rarity: ItemRarity;
  name: string;
  basetype: string;

  // Properties
  quality?: number;
  itemLevel?: number;
  levelRequired?: number;

  // Sockets
  sockets?: string;
  socketCount?: number;
  linkedSockets?: number;

  // Defense stats
  armour?: number;
  evasion?: number;
  energyShield?: number;

  // Weapon stats
  physicalDamage?: { min: number; max: number };
  elementalDamage?: { type: string; min: number; max: number }[];
  attackSpeed?: number;
  criticalChance?: number;
  dps?: number;

  // Modifiers
  implicitMods: ItemModifier[];
  explicitMods: ItemModifier[];
  craftedMods: ItemModifier[];

  // Special flags
  corrupted?: boolean;
  mirrored?: boolean;
  unidentified?: boolean;

  // Gem specific
  gemLevel?: number;
  gemQuality?: number;

  // Stack info (for currency)
  stackSize?: { current: number; max: number };
}

export interface ItemModifier {
  text: string;
  type: "implicit" | "explicit" | "crafted" | "enchant";
  tier?: string;
  values: number[];
  tradeId?: string;
  enabled: boolean;
  minValue?: number;
  maxValue?: number;
}

// =========================================================================
// PRICE RESULT TYPES
// =========================================================================

export interface PriceResult {
  success: boolean;
  source: "poe.ninja" | "trade";
  price?: {
    chaos?: number;
    exalted?: number;
    divine?: number;
  };
  confidence?: "high" | "low";
  listings?: TradeListing[];
  listingsCount?: number;
  icon?: string;
  error?: string;
}

export interface TradeListing {
  amount: number;
  currency: string;
  chaosValue?: number;  // Normalized price in chaos
  account: string;
  character?: string;  // Character name for /hideout command
  whisper: string;
  indexed: string;
}

// =========================================================================
// SETTINGS TYPES
// =========================================================================

export interface PluginSettings {
  league: string;
  useTradeApi: boolean;
  usePoeNinja: boolean;
  poesessid: string;
}

export interface League {
  id: string;
  text: string;
}

// =========================================================================
// API RESPONSE TYPES
// =========================================================================

export interface ClipboardResult {
  success: boolean;
  text?: string;
  error?: string;
}

export interface TradeSearchResult {
  success: boolean;
  id?: string;
  total?: number;
  result?: string[];
  error?: string;
}

export interface TradeListingsResult {
  success: boolean;
  listings: TradeListing[];
  error?: string;
}

export interface PoeNinjaResult {
  success: boolean;
  source: string;
  price?: {
    chaos?: number;
    exalted?: number;
    divine?: number;
  };
  confidence?: string;
  listings?: number;
  icon?: string;
  error?: string;
}

export interface LeaguesResult {
  success: boolean;
  leagues: League[];
  error?: string;
}

// =========================================================================
// TRADE QUERY TYPES
// =========================================================================

export interface TradeQuery {
  query: {
    status: { option: string };
    name?: string;
    type?: string;
    stats: Array<{
      type: string;
      filters: Array<{
        id: string;
        value?: { min?: number; max?: number };
      }>;
    }>;
    filters?: Record<string, unknown>;
  };
  sort: { price: string };
}

export interface ModifierFilter {
  id: string;
  min?: number;
  max?: number;
  enabled: boolean;
}

// =========================================================================
// PRICE HISTORY TYPES
// =========================================================================

export interface PriceHistoryRecord {
  timestamp: number;
  median_price: number;
  currency: string;
  listing_count: number;
  item_name: string;
  base_type: string;
}

export interface PriceHistoryResult {
  success: boolean;
  key: string;
  records: PriceHistoryRecord[];
  count: number;
}

// =========================================================================
// TIERED SEARCH TYPES
// =========================================================================

export interface SearchTier {
  tier: number;
  name: string;
  description: string;
  total: number;
  listings: TradeListing[];
  fetched: number;
}

export interface TieredSearchResult {
  success: boolean;
  tiers: SearchTier[];
  ninja_price?: PoeNinjaResult;
  stopped_at_tier: number;
  total_searches: number;
  error?: string;
}

export interface ModifierWithPriority extends ItemModifier {
  priority?: number;
}
