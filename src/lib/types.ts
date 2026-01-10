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
  strRequired?: number;
  dexRequired?: number;
  intRequired?: number;

  // Sockets
  sockets?: string;
  socketCount?: number;
  linkedSockets?: number;

  // Defense stats
  armour?: number;
  evasion?: number;
  energyShield?: number;
  block?: number;
  spirit?: number;

  // Weapon stats
  physicalDamage?: { min: number; max: number };
  elementalDamage?: { type: string; min: number; max: number }[];
  attackSpeed?: number;
  criticalChance?: number;
  weaponRange?: number;
  dps?: number;         // Physical DPS
  elemDps?: number;     // Elemental DPS
  totalDps?: number;    // Total DPS (physical + elemental)

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
  source: "poe2scout" | "trade";
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
  online?: string | null;  // Online status: "online", "afk", or null if offline
  whisper: string;
  indexed: string;  // ISO timestamp when listing was created
}

// =========================================================================
// SETTINGS TYPES
// =========================================================================

export interface PluginSettings {
  league: string;
  useTradeApi: boolean;
  usePoe2Scout: boolean;
  autoCheckOnOpen: boolean;
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

export interface Poe2ScoutResult {
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
  poe2scout_price?: Poe2ScoutResult;
  trade_icon?: string;  // Icon URL from Trade API
  stopped_at_tier: number;
  total_searches: number;
  error?: string;
}

export interface ModifierWithPriority extends ItemModifier {
  priority?: number;
}

// =========================================================================
// SCAN HISTORY TYPES
// =========================================================================

export interface ScanPriceData {
  minPrice: number;
  maxPrice: number;
  medianPrice: number;
  currency: string;
  source: "trade" | "poe2scout";
}

export interface ScanHistoryRecord {
  id: string;
  timestamp: number;
  itemName: string;
  basetype: string;
  rarity: ItemRarity;
  itemClass: string;
  itemLevel?: number;
  quality?: number;
  corrupted?: boolean;
  implicitMods: string[];
  explicitMods: string[];
  craftedMods: string[];
  priceData: ScanPriceData;
  iconUrl?: string;
  localIconPath?: string;
  searchTier: number;
  listingsCount: number;
}

export interface ScanHistoryResult {
  success: boolean;
  records?: ScanHistoryRecord[];
  count?: number;
  error?: string;
}

// =========================================================================
// PRICE LEARNING TYPES
// =========================================================================

/**
 * Detailed modifier pattern for statistics tracking.
 * Stores specific patterns like "# to maximum Life" instead of generic "life".
 */
export interface ModPattern {
  pattern: string;      // Normalized pattern, e.g., "# to maximum Life"
  tier: number | null;  // Tier number (1-5+), null if unknown
  category: string;     // Generic category for grouping
  value?: number;       // Primary numeric value extracted from modifier
}

/**
 * Hot pattern statistics from price learning data.
 */
export interface HotPattern {
  pattern: string;
  display_name: string;
  category: string;
  count: number;
  median_price: number;  // More robust than avg
  avg_price: number;
  min_price: number;
  max_price: number;
  tier_distribution: {
    T1: number;
    T2: number;
    T3: number;
    T4: number;
    "T5+": number;
  };
  avg_tier: number | null;
}

export interface HotPatternsResult {
  success: boolean;
  patterns?: HotPattern[];
  total_patterns?: number;
  error?: string;
}

/**
 * Price learning record with extended fields (v2).
 */
export interface PriceLearningRecord {
  timestamp: number;
  base_type: string;
  quality_score: number;
  mod_categories: string[];
  mod_patterns: ModPattern[];
  price: number;
  currency: string;
  search_tier: number;
  // V2 fields
  ilvl?: number;
  rarity?: string;
  socket_count?: number;
  total_dps?: number;
  listings_count: number;
}

// =========================================================================
// PRICE TRENDS TYPES
// =========================================================================

export interface DailyMedian {
  day: number;       // 0 = today, 1 = yesterday, etc.
  median: number;    // Median price in exalted
  count: number;     // Number of records
}

export interface PriceTrend {
  item_class: string;
  daily_data: DailyMedian[];
  trend: "up" | "down" | "stable" | "unknown";
  change_percent: number;
  current_median: number;
}

export interface PriceTrendsResult {
  success: boolean;
  trends?: PriceTrend[];
  period_days?: number;
  error?: string;
}

// =========================================================================
// QUALITY CORRELATION TYPES
// =========================================================================

export interface QualityCorrelation {
  item_class: string;
  correlation: number;       // Pearson coefficient (-1 to 1)
  sample_size: number;
  bucket_medians: Record<string, number>;  // e.g., {"0-25": 0.5, "26-50": 1.2, ...}
}

export interface QualityCorrelationResult {
  success: boolean;
  correlations?: QualityCorrelation[];
  error?: string;
}

export interface PriceDynamicsEntry {
  timestamp: number;
  price: number;
  currency: string;
  change?: number;
  changePercent?: number;
  trend?: "up" | "down" | "stable";
}

export interface PriceDynamicsResult {
  success: boolean;
  itemKey: string;
  dynamics: PriceDynamicsEntry[];
  currentPrice?: number;
  priceChange24h?: number;
  priceChangePercent24h?: number;
  error?: string;
}
