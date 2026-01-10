// src/components/TieredPriceDisplay.tsx
// Tiered price display component for showing search results

import { FC, useState, useEffect, useMemo } from "react";
import {
  PanelSection,
  PanelSectionRow,
} from "@decky/ui";
import { call } from "@decky/api";
import { FaCopy, FaArrowUp, FaArrowDown, FaMinus } from "react-icons/fa";
import { ParsedItem, TieredSearchResult, SearchTier } from "../lib/types";
import { formatPrice, getBestPrice } from "../utils/modifierMatcher";
import { formatIndexedTimeCompact, calculatePriceStats, calculateStatsByCurrency, PriceStats } from "../utils/formatting";
import {
  TIER_COLORS,
  FRESHNESS_COLORS,
  CONFIDENCE_COLORS,
  VOLATILITY_COLORS,
  CARD_STYLES,
  LISTING_STYLES,
  BADGE_STYLES,
  PRICE_STYLES,
  TEXT_STYLES,
  FLEX_BETWEEN,
  getTierCardStyle,
  getTierHeaderStyle,
  BUTTON_STYLES,
} from "../styles/constants";
import { ItemEvaluation, estimatePrice, PriceEstimate } from "../utils/itemEvaluator";

interface TieredPriceDisplayProps {
  result: TieredSearchResult;
  item?: ParsedItem | null;
  itemEvaluation?: ItemEvaluation | null;
}

// Get tier color based on tier number
const getTierColor = (tierNum: number): string => {
  if (tierNum === 0) return TIER_COLORS.exact;    // Green - exact 100% match
  if (tierNum === 1) return TIER_COLORS.yourItem; // Gold - 80% match
  if (tierNum === 2) return TIER_COLORS.similar;  // Blue - core mods
  return TIER_COLORS.base; // Gray - base only
};

const getTierLabel = (tierNum: number): string => {
  if (tierNum === 0) return "EXACT";
  if (tierNum === 1) return "YOUR ITEM";
  if (tierNum === 2) return "SIMILAR";
  return "BASE";
};

// Calculate price stats for a tier (returns main stats and all currency breakdowns)
interface TierStatsResult {
  main: PriceStats | null;
  byCurrency: PriceStats[];
}

const getTierStats = (tier: SearchTier): TierStatsResult => {
  if (!tier.listings || tier.listings.length === 0) {
    return { main: null, byCurrency: [] };
  }
  return {
    main: calculatePriceStats(tier.listings),
    byCurrency: calculateStatsByCurrency(tier.listings),
  };
};

// Listing freshness analysis
type ListingFreshness = "fresh" | "normal" | "stale" | "very_stale";

interface FreshnessInfo {
  freshness: ListingFreshness;
  hoursAgo: number;
  warning?: string;
}

/**
 * Analyze listing freshness based on indexed timestamp
 * - Fresh: < 2 hours (likely still available)
 * - Normal: 2-24 hours
 * - Stale: 24-72 hours (might be overpriced or unavailable)
 * - Very stale: > 72 hours (likely price-fixed or forgotten)
 */
const getListingFreshness = (indexed: string): FreshnessInfo => {
  try {
    const date = new Date(indexed);
    const now = new Date();
    const hoursAgo = (now.getTime() - date.getTime()) / (1000 * 60 * 60);

    if (hoursAgo < 2) {
      return { freshness: "fresh", hoursAgo };
    } else if (hoursAgo < 24) {
      return { freshness: "normal", hoursAgo };
    } else if (hoursAgo < 72) {
      return { freshness: "stale", hoursAgo, warning: "Listed over a day ago" };
    } else {
      return { freshness: "very_stale", hoursAgo, warning: "Old listing - may be price-fixed" };
    }
  } catch {
    return { freshness: "normal", hoursAgo: 0 };
  }
};

const getFreshnessColor = (freshness: ListingFreshness): string => {
  return FRESHNESS_COLORS[freshness] || FRESHNESS_COLORS.normal;
};

// Price trend indicator component
interface TrendIndicatorProps {
  trend: "up" | "down" | "stable" | "unknown";
  changePercent?: number;
  size?: "small" | "medium";
}

const TrendIndicator: FC<TrendIndicatorProps> = ({ trend, changePercent, size = "small" }) => {
  const iconSize = size === "small" ? 10 : 14;

  const getStyle = (): React.CSSProperties => {
    const base = {
      display: "inline-flex",
      alignItems: "center",
      gap: 3,
      fontSize: size === "small" ? 10 : 12,
      padding: "2px 5px",
      borderRadius: 3,
    };

    switch (trend) {
      case "up":
        return {
          ...base,
          color: "#ff6b6b",
          backgroundColor: "rgba(255, 107, 107, 0.15)",
        };
      case "down":
        return {
          ...base,
          color: "#51cf66",
          backgroundColor: "rgba(81, 207, 102, 0.15)",
        };
      case "stable":
        return {
          ...base,
          color: "#888",
          backgroundColor: "rgba(136, 136, 136, 0.15)",
        };
      default:
        return base;
    }
  };

  if (trend === "unknown") return null;

  return (
    <span style={getStyle()}>
      {trend === "up" && <FaArrowUp size={iconSize} />}
      {trend === "down" && <FaArrowDown size={iconSize} />}
      {trend === "stable" && <FaMinus size={iconSize} />}
      {changePercent !== undefined && Math.abs(changePercent) > 0.5 && (
        <span>{changePercent > 0 ? "+" : ""}{changePercent.toFixed(1)}%</span>
      )}
    </span>
  );
};

// Analyze price volatility from listings
const analyzePriceVolatility = (listings: { chaosValue?: number }[]): {
  volatility: "low" | "medium" | "high";
  spreadPercent: number;
} => {
  if (!listings || listings.length < 2) {
    return { volatility: "low", spreadPercent: 0 };
  }

  const values = listings
    .map(l => l.chaosValue || 0)
    .filter(v => v > 0)
    .sort((a, b) => a - b);

  if (values.length < 2) {
    return { volatility: "low", spreadPercent: 0 };
  }

  const min = values[0];
  const max = values[values.length - 1];
  const spreadPercent = min > 0 ? ((max - min) / min) * 100 : 0;

  if (spreadPercent > 100) return { volatility: "high", spreadPercent };
  if (spreadPercent > 50) return { volatility: "medium", spreadPercent };
  return { volatility: "low", spreadPercent };
};

export const TieredPriceDisplay: FC<TieredPriceDisplayProps> = ({ result, itemEvaluation }) => {
  const [expandedTiers, setExpandedTiers] = useState<Set<number>>(new Set([1]));

  // Calculate simple price estimate from Similar tier (no complex multipliers)
  const priceEstimate = useMemo<{
    min: number;
    max: number;
    median: number;
    currency: string;
    source: "similar" | "base";
    count: number;
    rating?: string;
  } | null>(() => {
    // Only show estimate if we don't have exact matches (tier 0 or 1)
    const hasExactMatch = result.tiers.some(t => (t.tier === 0 || t.tier === 1) && t.total > 0);
    if (hasExactMatch) return null;

    // Prefer Tier 2 (SIMILAR) - already filtered by top mods
    const similarTier = result.tiers.find(t => t.tier === 2 && t.total > 0);
    const baseTier = result.tiers.find(t => t.tier === 3 && t.total > 0);

    const referenceTier = similarTier || baseTier;
    if (!referenceTier || !referenceTier.listings || referenceTier.listings.length === 0) {
      return null;
    }

    const stats = calculatePriceStats(referenceTier.listings);
    if (!stats) return null;

    return {
      min: stats.min,
      max: stats.max,
      median: stats.median,
      currency: stats.currency,
      source: similarTier ? "similar" : "base",
      count: referenceTier.total,
      rating: itemEvaluation?.rating,
    };
  }, [result, itemEvaluation]);

  // Quality-adjusted price estimate using evaluation data
  const qualityAdjustedEstimate = useMemo<PriceEstimate | null>(() => {
    // Only calculate if we have evaluation and no exact match
    if (!itemEvaluation) return null;

    const hasExactMatch = result.tiers.some(t => (t.tier === 0 || t.tier === 1) && t.total > 0);
    if (hasExactMatch) return null;

    // Need base tier (tier 3) data for quality adjustment
    const baseTier = result.tiers.find(t => t.tier === 3 && t.total > 0);
    if (!baseTier || !baseTier.listings || baseTier.listings.length === 0) return null;

    const stats = calculatePriceStats(baseTier.listings);
    if (!stats) return null;

    // Use median price as base
    return estimatePrice(
      stats.median,
      stats.currency,
      baseTier.total,
      itemEvaluation
    );
  }, [result, itemEvaluation]);

  // Find first tier with results for auto-expand
  useEffect(() => {
    const firstWithResults = result.tiers.find(t => t.total > 0);
    if (firstWithResults) {
      setExpandedTiers(new Set([firstWithResults.tier]));
    }
  }, [result]);

  const toggleTier = (tierNum: number) => {
    const newExpanded = new Set(expandedTiers);
    if (newExpanded.has(tierNum)) {
      newExpanded.delete(tierNum);
    } else {
      newExpanded.add(tierNum);
    }
    setExpandedTiers(newExpanded);
  };

  if (!result.success && result.error) {
    return (
      <PanelSection title="Search Error">
        <PanelSectionRow>
          <div style={{ color: "#ff6b6b", padding: 8 }}>
            {result.error}
          </div>
        </PanelSectionRow>
      </PanelSection>
    );
  }

  return (
    <>
      {/* poe2scout quick result (if available) */}
      {result.poe2scout_price?.success && result.poe2scout_price.price && (
        <div style={CARD_STYLES.blue}>
          <span style={TEXT_STYLES.description}>poe2scout</span>
          <span style={{ fontSize: 14, fontWeight: "bold", color: "#4dabf7" }}>
            {(() => {
              const best = getBestPrice(result.poe2scout_price!.price!);
              return best ? formatPrice(best.amount, best.currency) : "N/A";
            })()}
          </span>
        </div>
      )}

      {/* Price Estimate (when no exact match - show Similar tier prices directly) */}
      {priceEstimate && (
        <div style={priceEstimate.source === "similar" ? CARD_STYLES.similar : CARD_STYLES.base}>
          <div style={{ ...FLEX_BETWEEN, marginBottom: 4 }}>
            <span style={{
              ...TEXT_STYLES.label,
              color: priceEstimate.source === "similar" ? "#6495ed" : "#888",
            }}>
              {priceEstimate.source === "similar" ? "SIMILAR ITEMS" : "BASE ITEMS"}
            </span>
            {priceEstimate.rating && (
              <span style={{
                ...BADGE_STYLES.pill,
                backgroundColor: "rgba(255, 165, 0, 0.2)",
                color: "#ffa500",
              }}>
                Your: {priceEstimate.rating}
              </span>
            )}
          </div>
          <div style={{
            ...PRICE_STYLES.medium,
            color: priceEstimate.source === "similar" ? "#6495ed" : "#aaa"
          }}>
            {formatPrice(priceEstimate.min, priceEstimate.currency)}
            {priceEstimate.min !== priceEstimate.max && (
              <span> — {formatPrice(priceEstimate.max, priceEstimate.currency)}</span>
            )}
          </div>
          <div style={TEXT_STYLES.muted}>
            Median: {formatPrice(priceEstimate.median, priceEstimate.currency)} • {priceEstimate.count} listings
          </div>
        </div>
      )}

      {/* Quality-Adjusted Price Estimate */}
      {qualityAdjustedEstimate && (
        <div style={CARD_STYLES.green}>
          <div style={{ ...FLEX_BETWEEN, marginBottom: 4 }}>
            <span style={{ ...TEXT_STYLES.label, color: "#40c057" }}>
              EXPECTED FOR YOUR ITEM
            </span>
            <span style={{
              ...BADGE_STYLES.pill,
              backgroundColor: CONFIDENCE_COLORS[qualityAdjustedEstimate.confidence].bg,
              color: CONFIDENCE_COLORS[qualityAdjustedEstimate.confidence].text,
            }}>
              {qualityAdjustedEstimate.confidence} conf.
            </span>
          </div>
          <div style={{ fontSize: 18, fontWeight: "bold", color: "#40c057" }}>
            {formatPrice(qualityAdjustedEstimate.minPrice, qualityAdjustedEstimate.currency)}
            {qualityAdjustedEstimate.minPrice !== qualityAdjustedEstimate.maxPrice && (
              <span> — {formatPrice(qualityAdjustedEstimate.maxPrice, qualityAdjustedEstimate.currency)}</span>
            )}
          </div>
          <div style={TEXT_STYLES.muted}>
            {qualityAdjustedEstimate.reason} • {qualityAdjustedEstimate.basedOn}
          </div>
        </div>
      )}

      {/* Tiered results */}
      {result.tiers.map((tier) => {
        const { main: stats, byCurrency } = getTierStats(tier);
        const tierColor = getTierColor(tier.tier);
        const isExpanded = expandedTiers.has(tier.tier);
        // Check if there are multiple currencies
        const hasMultipleCurrencies = byCurrency.length > 1;

        return (
          <div key={tier.tier} style={getTierCardStyle(tier.tier)}>
            {/* Tier Header - clickable */}
            <div onClick={() => toggleTier(tier.tier)} style={getTierHeaderStyle(tier.tier)}>
              <div>
                <div style={{ fontSize: 10, color: tierColor, fontWeight: "bold", marginBottom: 2 }}>
                  {getTierLabel(tier.tier)}
                </div>
                <div style={{ fontSize: 11, color: "#888" }}>
                  {tier.description}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                {stats ? (
                  <>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6 }}>
                      <span style={{ fontSize: 16, fontWeight: "bold", color: tierColor }}>
                        {stats.min === stats.max
                          ? formatPrice(stats.min, stats.currency)
                          : `${formatPrice(stats.min, stats.currency)} — ${formatPrice(stats.max, stats.currency)}`
                        }
                      </span>
                      {/* Volatility indicator based on spread */}
                      {(() => {
                        const { volatility, spreadPercent } = analyzePriceVolatility(tier.listings);
                        if (volatility === "high") {
                          return (
                            <TrendIndicator
                              trend="up"
                              changePercent={spreadPercent}
                              size="small"
                            />
                          );
                        }
                        return null;
                      })()}
                    </div>
                    <div style={{ fontSize: 10, color: "#666" }}>
                      Med: {formatPrice(stats.median, stats.currency)} • Avg: {formatPrice(stats.average, stats.currency)} • {tier.total} listings
                    </div>
                    {/* Show other currencies if available */}
                    {hasMultipleCurrencies && (
                      <div style={{ fontSize: 9, color: "#555", marginTop: 2 }}>
                        {byCurrency
                          .filter(c => c.currency !== stats.currency)
                          .slice(0, 2)
                          .map((c, i) => (
                            <span key={c.currency}>
                              {i > 0 && " • "}
                              {formatPrice(c.median, c.currency)} ({c.count})
                            </span>
                          ))}
                      </div>
                    )}
                  </>
                ) : (
                  <div style={{ fontSize: 12, color: "#666" }}>
                    {tier.total === 0 ? "No listings" : "..."}
                  </div>
                )}
              </div>
            </div>

            {/* Expanded content */}
            {isExpanded && tier.listings && tier.listings.length > 0 && (
              <div style={LISTING_STYLES.container}>
                {/* Price distribution info */}
                {stats && stats.p25 !== undefined && tier.listings.length >= 5 && (
                  <div style={LISTING_STYLES.priceDistribution}>
                    <div style={{ ...FLEX_BETWEEN, marginBottom: 2 }}>
                      <span>Price Distribution:</span>
                      {stats.volatility && (
                        <span style={{
                          ...BADGE_STYLES.pill,
                          fontSize: 8,
                          backgroundColor: VOLATILITY_COLORS[stats.volatility].bg,
                          color: VOLATILITY_COLORS[stats.volatility].text,
                        }}>
                          {stats.volatility} volatility
                        </span>
                      )}
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <span title="10th percentile - cheapest 10%">
                        P10: {formatPrice(stats.p10!, stats.currency)}
                      </span>
                      <span title="25th percentile - lower quartile">
                        P25: {formatPrice(stats.p25!, stats.currency)}
                      </span>
                      <span title="75th percentile - upper quartile">
                        P75: {formatPrice(stats.p75!, stats.currency)}
                      </span>
                      <span title="90th percentile - most expensive 10%">
                        P90: {formatPrice(stats.p90!, stats.currency)}
                      </span>
                    </div>
                  </div>
                )}

                {tier.listings.slice(0, 5).map((listing, i) => {
                  const freshness = listing.indexed ? getListingFreshness(listing.indexed) : null;
                  const isStale = freshness && (freshness.freshness === "stale" || freshness.freshness === "very_stale");
                  const hasBorder = i < Math.min(tier.listings.length - 1, 4);

                  return (
                    <div
                      key={i}
                      style={{
                        ...LISTING_STYLES.row,
                        ...(hasBorder ? LISTING_STYLES.rowBorder : {}),
                        opacity: isStale ? 0.75 : 1,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        {/* Online status indicator */}
                        {listing.online && (
                          <span
                            title={listing.online === "afk" ? "AFK" : "Online"}
                            style={LISTING_STYLES.onlineIndicator(listing.online as "online" | "afk")}
                          />
                        )}
                        <span style={PRICE_STYLES.small}>
                          {formatPrice(listing.amount, listing.currency)}
                        </span>
                        {/* Stale warning icon */}
                        {freshness?.freshness === "very_stale" && (
                          <span title={freshness.warning} style={{ fontSize: 10, color: "#ff6b6b" }}>
                            ⚠
                          </span>
                        )}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {/* Character name for /hideout */}
                        {listing.character && (
                          <span style={{ ...TEXT_STYLES.truncate, fontSize: 9, color: "#888", maxWidth: 60 }}>
                            {listing.character}
                          </span>
                        )}
                        {/* Time with freshness color */}
                        <span
                          style={{
                            fontSize: 10,
                            color: freshness ? getFreshnessColor(freshness.freshness) : "#666",
                          }}
                          title={freshness?.warning}
                        >
                          {listing.indexed && formatIndexedTimeCompact(listing.indexed)}
                        </span>
                        {listing.whisper && (
                          <button
                            onClick={async (e: React.MouseEvent<HTMLButtonElement>) => {
                              e.stopPropagation();
                              try {
                                await navigator.clipboard.writeText(listing.whisper);
                              } catch {
                                await call<[string], void>("copy_to_clipboard", listing.whisper);
                              }
                            }}
                            style={BUTTON_STYLES.small}
                          >
                            <FaCopy size={8} />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
                {tier.listings.length > 5 && (
                  <div style={LISTING_STYLES.moreIndicator}>
                    +{tier.listings.length - 5} more
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* No results at all */}
      {result.tiers.length === 0 && !result.poe2scout_price?.success && (
        <PanelSection title="No Results">
          <PanelSectionRow>
            <div style={{ padding: 8, color: "#888" }}>
              No listings found. Try different modifiers.
            </div>
          </PanelSectionRow>
        </PanelSection>
      )}
    </>
  );
};

export default TieredPriceDisplay;
