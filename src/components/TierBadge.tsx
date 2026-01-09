// src/components/TierBadge.tsx
// Visual badge showing modifier tier (T1, T2, etc.)

import { FC } from "react";
import { getTierColor, getTierLabel } from "../data/modifierTiers";

interface TierBadgeProps {
  tier: number;
  totalTiers: number;
  rollPercent?: number;  // 0-100, how good is the roll within tier
  compact?: boolean;     // Smaller version for inline use
  showTooltip?: boolean; // Show tooltip on hover (not supported in Decky)
}

/**
 * TierBadge - Shows modifier tier with color coding
 *
 * Colors:
 * - T1-T2: Green (excellent)
 * - T3-T4: Yellow (good)
 * - T5+: Gray (lower tiers)
 */
export const TierBadge: FC<TierBadgeProps> = ({
  tier,
  totalTiers,
  rollPercent,
  compact = false,
}) => {
  const color = getTierColor(tier, totalTiers);
  const label = getTierLabel(tier);

  // Dim the badge slightly for lower tiers
  const opacity = tier <= 2 ? 1 : tier <= 4 ? 0.9 : 0.7;

  // Add a subtle glow for T1
  const glowStyle = tier === 1 ? {
    boxShadow: `0 0 4px ${color}`,
  } : {};

  if (compact) {
    // Compact version: just "T1" text
    return (
      <span
        style={{
          fontSize: 9,
          fontWeight: "bold",
          color,
          opacity,
        }}
      >
        {label}
      </span>
    );
  }

  // Full badge version
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 2,
        padding: "2px 5px",
        borderRadius: 3,
        backgroundColor: `${color}20`, // 20% opacity background
        border: `1px solid ${color}40`,
        fontSize: 9,
        fontWeight: "bold",
        color,
        opacity,
        ...glowStyle,
      }}
    >
      {label}
      {/* Roll quality indicator for T1-T2 */}
      {rollPercent !== undefined && tier <= 2 && rollPercent >= 80 && (
        <span style={{ fontSize: 8 }}>★</span>
      )}
    </span>
  );
};

// =========================================================================
// RATING BADGE
// =========================================================================

interface RatingBadgeProps {
  rating: "trash" | "okay" | "good" | "great" | "excellent";
  score?: number;
}

/**
 * RatingBadge - Shows overall item rating with text label
 */
export const RatingBadge: FC<RatingBadgeProps> = ({ rating }) => {
  const colors: Record<string, string> = {
    excellent: "#40c057",
    great: "#69db7c",
    good: "#fab005",
    okay: "#ff922b",
    trash: "#868e96",
  };

  // Text labels with optional star for good+ items
  const labels: Record<string, string> = {
    excellent: "★ Top",
    great: "★ Great",
    good: "Good",
    okay: "Mid",
    trash: "Low",
  };

  const color = colors[rating] || colors.okay;

  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: "bold",
        color,
        padding: "1px 4px",
        borderRadius: 3,
        backgroundColor: `${color}20`,
      }}
    >
      {labels[rating]}
    </span>
  );
};

// =========================================================================
// GOOD ITEM INDICATOR
// =========================================================================

interface GoodItemIndicatorProps {
  isGood: boolean;
  size?: "small" | "medium" | "large";
}

/**
 * GoodItemIndicator - Shows checkmark if item is good
 */
export const GoodItemIndicator: FC<GoodItemIndicatorProps> = ({
  isGood,
  size = "medium",
}) => {
  if (!isGood) return null;

  const sizes = {
    small: { font: 12, padding: "2px 4px" },
    medium: { font: 14, padding: "4px 8px" },
    large: { font: 16, padding: "6px 12px" },
  };

  const { font, padding } = sizes[size];

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding,
        borderRadius: 4,
        backgroundColor: "rgba(64, 192, 87, 0.2)",
        border: "1px solid #40c057",
        color: "#40c057",
        fontSize: font,
        fontWeight: "bold",
      }}
    >
      ✓ Good Item
    </span>
  );
};

// =========================================================================
// TIER SUMMARY
// =========================================================================

interface TierSummaryProps {
  tiers: Array<{ tier: number | null; totalTiers: number }>;
}

/**
 * TierSummary - Shows all tiers in a row (e.g., T1 T2 T3 T5)
 */
export const TierSummary: FC<TierSummaryProps> = ({ tiers }) => {
  const validTiers = tiers.filter(t => t.tier !== null);

  if (validTiers.length === 0) {
    return (
      <span style={{ fontSize: 10, color: "#666" }}>
        No tier data
      </span>
    );
  }

  return (
    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
      {validTiers.map((t, i) => (
        <TierBadge
          key={i}
          tier={t.tier!}
          totalTiers={t.totalTiers}
          compact
        />
      ))}
    </div>
  );
};

// =========================================================================
// CONFIDENCE BADGE
// =========================================================================

type ConfidenceLevel = "high" | "medium" | "low";

interface ConfidenceBadgeProps {
  searchTier: number;  // Which tier found results (0-3)
  listingsCount: number;
  compact?: boolean;
}

/**
 * Get confidence level based on search tier and listings count
 * - High: Tier 0-1 with 5+ listings (exact/similar match with good sample)
 * - Medium: Tier 2 with 5+ listings OR Tier 0-1 with <5 listings
 * - Low: Tier 3 (base only) OR any tier with <3 listings
 */
export const getConfidenceLevel = (searchTier: number, listingsCount: number): ConfidenceLevel => {
  if (listingsCount < 3) return "low";
  if (searchTier <= 1 && listingsCount >= 5) return "high";
  if (searchTier <= 1 || (searchTier === 2 && listingsCount >= 5)) return "medium";
  return "low";
};

/**
 * ConfidenceBadge - Shows price confidence based on search quality
 */
export const ConfidenceBadge: FC<ConfidenceBadgeProps> = ({
  searchTier,
  listingsCount,
  compact = false,
}) => {
  const level = getConfidenceLevel(searchTier, listingsCount);

  const config: Record<ConfidenceLevel, { color: string; label: string; icon: string }> = {
    high: { color: "#40c057", label: "High Confidence", icon: "◉" },
    medium: { color: "#fab005", label: "Medium Confidence", icon: "◎" },
    low: { color: "#868e96", label: "Low Confidence", icon: "○" },
  };

  const { color, label, icon } = config[level];

  if (compact) {
    return (
      <span
        style={{
          fontSize: 9,
          fontWeight: "bold",
          color,
          display: "inline-flex",
          alignItems: "center",
          gap: 2,
        }}
        title={label}
      >
        {icon} {level.charAt(0).toUpperCase() + level.slice(1)}
      </span>
    );
  }

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 6px",
        borderRadius: 4,
        backgroundColor: `${color}20`,
        border: `1px solid ${color}40`,
        fontSize: 10,
        fontWeight: "bold",
        color,
      }}
    >
      {icon} {label}
    </span>
  );
};

// =========================================================================
// SEARCH INFO BADGE
// =========================================================================

interface SearchInfoBadgeProps {
  stoppedAtTier: number;
  totalSearches: number;
}

const TIER_NAMES: Record<number, string> = {
  0: "Exact Match",
  1: "Your Item (80%)",
  2: "Similar Items",
  3: "Base Type Only",
};

/**
 * SearchInfoBadge - Shows which tier found results and how many searches were made
 */
export const SearchInfoBadge: FC<SearchInfoBadgeProps> = ({
  stoppedAtTier,
  totalSearches,
}) => {
  const tierName = TIER_NAMES[stoppedAtTier] || `Tier ${stoppedAtTier}`;

  // Color based on tier - better tiers are greener
  const tierColors: Record<number, string> = {
    0: "#40c057",  // Green - exact
    1: "#69db7c",  // Light green - your item
    2: "#fab005",  // Yellow - similar
    3: "#868e96",  // Gray - base only
  };

  const color = tierColors[stoppedAtTier] || tierColors[3];

  return (
    <span
      style={{
        fontSize: 9,
        color: "#888",
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
      }}
    >
      Found at{" "}
      <span style={{ color, fontWeight: "bold" }}>{tierName}</span>
      {totalSearches > 1 && (
        <span style={{ color: "#666" }}>({totalSearches} searches)</span>
      )}
    </span>
  );
};

export default TierBadge;
