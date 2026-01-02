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
import { ItemEvaluation } from "../utils/itemEvaluator";

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
                {tier.listings.slice(0, 5).map((listing, i) => (
                  <div
                    key={i}
                    style={{
                      padding: "6px 12px",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      borderBottom: i < Math.min(tier.listings.length - 1, 4) ? "1px solid rgba(255,255,255,0.05)" : "none",
                    }}
                  >
                    <span style={{ fontSize: 13, color: "#ffd700", fontWeight: "bold" }}>
                      {formatPrice(listing.amount, listing.currency)}
                    </span>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 10, color: "#666" }}>
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
                ))}
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
