// src/components/TieredPriceDisplay.tsx
// Tiered price display component for showing search results

import { FC, useState, useEffect, useMemo } from "react";
import {
  PanelSection,
  PanelSectionRow,
} from "@decky/ui";
import { call } from "@decky/api";
import { FaCopy } from "react-icons/fa";
import { ParsedItem, TieredSearchResult, SearchTier } from "../lib/types";
import { formatPrice, getBestPrice } from "../utils/modifierMatcher";
import { formatIndexedTimeCompact, calculatePriceStats, calculateStatsByCurrency, PriceStats } from "../utils/formatting";
import { TIER_COLORS } from "../styles/constants";
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
  switch (freshness) {
    case "fresh": return "#51cf66";      // Green
    case "normal": return "#666";         // Gray
    case "stale": return "#f59f00";       // Orange
    case "very_stale": return "#ff6b6b";  // Red
    default: return "#666";
  }
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
        <div style={{
          background: "rgba(30, 144, 255, 0.1)",
          border: "1px solid rgba(30, 144, 255, 0.3)",
          borderRadius: 6,
          padding: "8px 12px",
          margin: "8px 16px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}>
          <span style={{ fontSize: 11, color: "#888" }}>poe2scout</span>
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
        <div style={{
          background: priceEstimate.source === "similar"
            ? "linear-gradient(135deg, rgba(100, 149, 237, 0.15) 0%, rgba(70, 130, 180, 0.1) 100%)"
            : "linear-gradient(135deg, rgba(128, 128, 128, 0.15) 0%, rgba(105, 105, 105, 0.1) 100%)",
          border: `1px solid ${priceEstimate.source === "similar" ? "rgba(100, 149, 237, 0.4)" : "rgba(128, 128, 128, 0.4)"}`,
          borderRadius: 6,
          padding: "10px 12px",
          margin: "8px 16px",
        }}>
          <div style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 4,
          }}>
            <span style={{
              fontSize: 10,
              color: priceEstimate.source === "similar" ? "#6495ed" : "#888",
              fontWeight: "bold"
            }}>
              {priceEstimate.source === "similar" ? "SIMILAR ITEMS" : "BASE ITEMS"}
            </span>
            {priceEstimate.rating && (
              <span style={{
                fontSize: 9,
                padding: "1px 4px",
                borderRadius: 3,
                backgroundColor: "rgba(255, 165, 0, 0.2)",
                color: "#ffa500",
              }}>
                Your: {priceEstimate.rating}
              </span>
            )}
          </div>
          <div style={{
            fontSize: 16,
            fontWeight: "bold",
            color: priceEstimate.source === "similar" ? "#6495ed" : "#aaa"
          }}>
            {formatPrice(priceEstimate.min, priceEstimate.currency)}
            {priceEstimate.min !== priceEstimate.max && (
              <span> — {formatPrice(priceEstimate.max, priceEstimate.currency)}</span>
            )}
          </div>
          <div style={{ fontSize: 9, color: "#888", marginTop: 4 }}>
            Median: {formatPrice(priceEstimate.median, priceEstimate.currency)} • {priceEstimate.count} listings
          </div>
        </div>
      )}

      {/* Quality-Adjusted Price Estimate */}
      {qualityAdjustedEstimate && (
        <div style={{
          background: "linear-gradient(135deg, rgba(64, 192, 87, 0.15) 0%, rgba(40, 167, 69, 0.1) 100%)",
          border: "1px solid rgba(64, 192, 87, 0.4)",
          borderRadius: 6,
          padding: "10px 12px",
          margin: "8px 16px",
        }}>
          <div style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 4,
          }}>
            <span style={{
              fontSize: 10,
              color: "#40c057",
              fontWeight: "bold"
            }}>
              EXPECTED FOR YOUR ITEM
            </span>
            <span style={{
              fontSize: 9,
              padding: "1px 4px",
              borderRadius: 3,
              backgroundColor: qualityAdjustedEstimate.confidence === "high"
                ? "rgba(64, 192, 87, 0.2)"
                : qualityAdjustedEstimate.confidence === "medium"
                  ? "rgba(250, 176, 5, 0.2)"
                  : "rgba(134, 142, 150, 0.2)",
              color: qualityAdjustedEstimate.confidence === "high"
                ? "#40c057"
                : qualityAdjustedEstimate.confidence === "medium"
                  ? "#fab005"
                  : "#868e96",
            }}>
              {qualityAdjustedEstimate.confidence} conf.
            </span>
          </div>
          <div style={{
            fontSize: 18,
            fontWeight: "bold",
            color: "#40c057"
          }}>
            {formatPrice(qualityAdjustedEstimate.minPrice, qualityAdjustedEstimate.currency)}
            {qualityAdjustedEstimate.minPrice !== qualityAdjustedEstimate.maxPrice && (
              <span> — {formatPrice(qualityAdjustedEstimate.maxPrice, qualityAdjustedEstimate.currency)}</span>
            )}
          </div>
          <div style={{ fontSize: 9, color: "#888", marginTop: 4 }}>
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
          <div
            key={tier.tier}
            style={{
              margin: "8px 16px",
              border: `1px solid ${tierColor}33`,
              borderRadius: 8,
              overflow: "hidden",
            }}
          >
            {/* Tier Header - clickable */}
            <div
              onClick={() => toggleTier(tier.tier)}
              style={{
                background: `linear-gradient(135deg, ${tierColor}22 0%, ${tierColor}11 100%)`,
                padding: "10px 12px",
                cursor: "pointer",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
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
                    <div style={{ fontSize: 16, fontWeight: "bold", color: tierColor }}>
                      {stats.min === stats.max
                        ? formatPrice(stats.min, stats.currency)
                        : `${formatPrice(stats.min, stats.currency)} — ${formatPrice(stats.max, stats.currency)}`
                      }
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
              <div style={{ background: "rgba(0,0,0,0.2)", padding: "8px 0" }}>
                {/* Price distribution info */}
                {stats && stats.p25 !== undefined && tier.listings.length >= 5 && (
                  <div style={{
                    padding: "6px 12px",
                    marginBottom: 4,
                    borderBottom: "1px solid rgba(255,255,255,0.1)",
                    fontSize: 9,
                    color: "#888",
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
                      <span>Price Distribution:</span>
                      {stats.volatility && (
                        <span style={{
                          padding: "1px 4px",
                          borderRadius: 3,
                          fontSize: 8,
                          backgroundColor: stats.volatility === "low"
                            ? "rgba(64, 192, 87, 0.2)"
                            : stats.volatility === "medium"
                              ? "rgba(250, 176, 5, 0.2)"
                              : "rgba(255, 100, 100, 0.2)",
                          color: stats.volatility === "low"
                            ? "#40c057"
                            : stats.volatility === "medium"
                              ? "#fab005"
                              : "#ff6b6b",
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

                  return (
                    <div
                      key={i}
                      style={{
                        padding: "6px 12px",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        borderBottom: i < Math.min(tier.listings.length - 1, 4) ? "1px solid rgba(255,255,255,0.05)" : "none",
                        // Slightly dim stale listings
                        opacity: isStale ? 0.75 : 1,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        {/* Online status indicator */}
                        {listing.online && (
                          <span
                            title={listing.online === "afk" ? "AFK" : "Online"}
                            style={{
                              width: 6,
                              height: 6,
                              borderRadius: "50%",
                              backgroundColor: listing.online === "afk" ? "#f59f00" : "#51cf66",
                              flexShrink: 0,
                            }}
                          />
                        )}
                        <span style={{ fontSize: 13, color: "#ffd700", fontWeight: "bold" }}>
                          {formatPrice(listing.amount, listing.currency)}
                        </span>
                        {/* Stale warning icon */}
                        {freshness?.freshness === "very_stale" && (
                          <span
                            title={freshness.warning}
                            style={{ fontSize: 10, color: "#ff6b6b" }}
                          >
                            ⚠
                          </span>
                        )}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {/* Character name for /hideout */}
                        {listing.character && (
                          <span style={{ fontSize: 9, color: "#888", maxWidth: 60, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
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
                            onClick={async (e) => {
                              e.stopPropagation();
                              try {
                                await navigator.clipboard.writeText(listing.whisper);
                              } catch {
                                await call<[string], void>("copy_to_clipboard", listing.whisper);
                              }
                            }}
                            style={{
                              background: "rgba(255,215,0,0.15)",
                              border: "1px solid rgba(255,215,0,0.3)",
                              borderRadius: 4,
                              padding: "2px 6px",
                              cursor: "pointer",
                              color: "#ffd700",
                              fontSize: 9,
                            }}
                          >
                            <FaCopy size={8} />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
                {tier.listings.length > 5 && (
                  <div style={{ padding: "6px 12px", fontSize: 10, color: "#666", textAlign: "center" }}>
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
