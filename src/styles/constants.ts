// src/styles/constants.ts
// Shared style constants for consistent UI

export const RARITY_COLORS: Record<string, string> = {
  Normal: "#c8c8c8",
  Magic: "#8888ff",
  Rare: "#ffff77",
  Unique: "#af6025",
  Currency: "#aa9e82",
  Gem: "#1ba29b",
  DivinationCard: "#0ebaff",
};

export const MOD_TYPE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  implicit: { bg: "rgba(100,100,255,0.15)", text: "#88f", border: "rgba(100,100,255,0.3)" },
  explicit: { bg: "rgba(255,255,255,0.05)", text: "#aaa", border: "rgba(255,255,255,0.1)" },
  crafted: { bg: "rgba(180,140,255,0.15)", text: "#b8f", border: "rgba(180,140,255,0.3)" },
  enchant: { bg: "rgba(180,230,255,0.15)", text: "#8ef", border: "rgba(180,230,255,0.3)" },
};

export const TIER_COLORS = {
  exact: "#40c057",    // Green - exact 100% match
  yourItem: "#ffd700", // Gold - 80% match
  similar: "#4dabf7",  // Blue - core mods
  base: "#868e96",     // Gray - base only
};

export const SEMANTIC_COLORS = {
  success: "#40c057",
  error: "#ff6b6b",
  warning: "#ffd700",
  info: "#4dabf7",
  muted: "#868e96",
  price: "#ffd700",
  corrupted: "#d20000",
  mirrored: "#6cf",
};

// Freshness colors for listing age
export const FRESHNESS_COLORS = {
  fresh: "#51cf66",      // Green - < 2 hours
  normal: "#666",        // Gray - 2-24 hours
  stale: "#f59f00",      // Orange - 24-72 hours
  very_stale: "#ff6b6b", // Red - > 72 hours
};

// Confidence badge colors
export const CONFIDENCE_COLORS = {
  high: { bg: "rgba(64, 192, 87, 0.2)", text: "#40c057" },
  medium: { bg: "rgba(250, 176, 5, 0.2)", text: "#fab005" },
  low: { bg: "rgba(134, 142, 150, 0.2)", text: "#868e96" },
};

// Volatility badge colors
export const VOLATILITY_COLORS = {
  low: { bg: "rgba(64, 192, 87, 0.2)", text: "#40c057" },
  medium: { bg: "rgba(250, 176, 5, 0.2)", text: "#fab005" },
  high: { bg: "rgba(255, 100, 100, 0.2)", text: "#ff6b6b" },
};

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
};

// Common flex layouts
export const FLEX_CENTER: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

export const FLEX_BETWEEN: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
};

export const FLEX_START: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
};

// Common panel styles
export const PANEL_BACKGROUND = "rgba(30,30,30,0.9)";
export const PANEL_BORDER = "1px solid rgba(255,255,255,0.1)";
export const PANEL_RADIUS = 8;

// Debug panel styles
export const DEBUG_STYLES: React.CSSProperties = {
  backgroundColor: "#1a1a1a",
  padding: 8,
  borderRadius: 4,
  fontSize: 10,
  fontFamily: "monospace",
  whiteSpace: "pre-wrap",
  wordBreak: "break-all",
  maxHeight: 300,
  overflow: "auto",
  color: "#0f0",
};

// Loading spinner container
export const LOADING_CONTAINER: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
};

// Error container
export const ERROR_CONTAINER: React.CSSProperties = {
  background: "rgba(255,100,100,0.1)",
  border: "1px solid rgba(255,100,100,0.3)",
  borderRadius: 8,
  padding: "10px 12px",
  margin: "8px 16px",
  display: "flex",
  alignItems: "flex-start",
  gap: 8,
};

// Price display styles
export const PRICE_STYLES = {
  large: {
    fontSize: 20,
    fontWeight: "bold" as const,
    color: "#ffd700",
    textShadow: "0 0 10px rgba(255,215,0,0.3)",
  },
  medium: {
    fontSize: 16,
    fontWeight: "bold" as const,
    color: "#ffd700",
  },
  small: {
    fontSize: 13,
    fontWeight: "bold" as const,
    color: "#ffd700",
  },
};

// Button styles
export const BUTTON_STYLES = {
  primary: {
    background: "rgba(255,215,0,0.1)",
    border: "1px solid rgba(255,215,0,0.3)",
    borderRadius: 4,
    padding: "8px 12px",
    cursor: "pointer",
    color: "#ffd700",
  } as React.CSSProperties,
  secondary: {
    background: "rgba(77,171,247,0.1)",
    border: "1px solid rgba(77,171,247,0.3)",
    borderRadius: 4,
    padding: "8px 12px",
    cursor: "pointer",
    color: "#4dabf7",
  } as React.CSSProperties,
  ghost: {
    background: "transparent",
    border: "none",
    padding: "8px 12px",
    cursor: "pointer",
    color: "#888",
  } as React.CSSProperties,
  small: {
    background: "rgba(255,215,0,0.15)",
    border: "1px solid rgba(255,215,0,0.3)",
    borderRadius: 4,
    padding: "2px 6px",
    cursor: "pointer",
    color: "#ffd700",
    fontSize: 9,
  } as React.CSSProperties,
};

// Item card styles
export const ITEM_CARD_STYLES: React.CSSProperties = {
  padding: 8,
  maxWidth: "100%",
  overflow: "hidden",
};

// Stat row styles
export const STAT_ROW_STYLES: React.CSSProperties = {
  display: "flex",
  gap: 12,
  marginTop: 8,
  fontSize: 12,
  color: "#aaa",
  flexWrap: "wrap",
};

// ============================================
// Card styles for different contexts
// ============================================

// Helper to create gradient card style
const createGradientCard = (
  color: string,
  opacity1: number = 0.15,
  opacity2: number = 0.05
): React.CSSProperties => ({
  background: `linear-gradient(135deg, ${color}${Math.round(opacity1 * 255).toString(16).padStart(2, '0')} 0%, ${color}${Math.round(opacity2 * 255).toString(16).padStart(2, '0')} 100%)`,
  border: `1px solid ${color}4d`,
  borderRadius: 6,
  padding: "10px 12px",
  margin: "8px 16px",
});

// Pre-built card styles
export const CARD_STYLES = {
  // Gold/price card (main results)
  gold: {
    background: "linear-gradient(135deg, rgba(255,215,0,0.15) 0%, rgba(255,180,0,0.05) 100%)",
    border: "1px solid rgba(255,215,0,0.3)",
    borderRadius: 8,
    padding: "10px 12px",
    margin: "8px 16px",
    boxSizing: "border-box" as const,
    maxWidth: "100%",
    overflow: "hidden",
  } as React.CSSProperties,

  // Blue card (poe2scout, info)
  blue: {
    background: "rgba(30, 144, 255, 0.1)",
    border: "1px solid rgba(30, 144, 255, 0.3)",
    borderRadius: 6,
    padding: "8px 12px",
    margin: "8px 16px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  } as React.CSSProperties,

  // Similar items card (cornflower blue)
  similar: {
    background: "linear-gradient(135deg, rgba(100, 149, 237, 0.15) 0%, rgba(70, 130, 180, 0.1) 100%)",
    border: "1px solid rgba(100, 149, 237, 0.4)",
    borderRadius: 6,
    padding: "10px 12px",
    margin: "8px 16px",
  } as React.CSSProperties,

  // Base items card (gray)
  base: {
    background: "linear-gradient(135deg, rgba(128, 128, 128, 0.15) 0%, rgba(105, 105, 105, 0.1) 100%)",
    border: "1px solid rgba(128, 128, 128, 0.4)",
    borderRadius: 6,
    padding: "10px 12px",
    margin: "8px 16px",
  } as React.CSSProperties,

  // Green card (success, quality adjusted)
  green: {
    background: "linear-gradient(135deg, rgba(64, 192, 87, 0.15) 0%, rgba(40, 167, 69, 0.1) 100%)",
    border: "1px solid rgba(64, 192, 87, 0.4)",
    borderRadius: 6,
    padding: "10px 12px",
    margin: "8px 16px",
  } as React.CSSProperties,

  // Error/warning card (red)
  error: {
    background: "rgba(255, 100, 100, 0.15)",
    border: "1px solid rgba(255, 100, 100, 0.4)",
    borderRadius: 8,
    padding: "10px 12px",
    margin: "8px 16px",
    display: "flex",
    alignItems: "center",
    gap: 10,
    position: "relative" as const,
    overflow: "hidden",
  } as React.CSSProperties,

  // Neutral/loading card
  neutral: {
    background: "rgba(255,255,255,0.05)",
    borderRadius: 8,
    padding: 12,
    margin: "8px 16px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  } as React.CSSProperties,
};

// ============================================
// Tier-specific styles for search results
// ============================================

export const getTierCardStyle = (tierNum: number): React.CSSProperties => {
  const tierColor = tierNum === 0 ? TIER_COLORS.exact
    : tierNum === 1 ? TIER_COLORS.yourItem
    : tierNum === 2 ? TIER_COLORS.similar
    : TIER_COLORS.base;

  return {
    margin: "8px 16px",
    border: `1px solid ${tierColor}33`,
    borderRadius: 8,
    overflow: "hidden",
  };
};

export const getTierHeaderStyle = (tierNum: number): React.CSSProperties => {
  const tierColor = tierNum === 0 ? TIER_COLORS.exact
    : tierNum === 1 ? TIER_COLORS.yourItem
    : tierNum === 2 ? TIER_COLORS.similar
    : TIER_COLORS.base;

  return {
    background: `linear-gradient(135deg, ${tierColor}22 0%, ${tierColor}11 100%)`,
    padding: "10px 12px",
    cursor: "pointer",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  };
};

// ============================================
// Badge styles
// ============================================

export const BADGE_STYLES = {
  // Small pill badge
  pill: {
    fontSize: 9,
    padding: "1px 4px",
    borderRadius: 3,
  } as React.CSSProperties,

  // Tag badge
  tag: {
    fontSize: 10,
    padding: "2px 6px",
    borderRadius: 3,
    cursor: "pointer",
  } as React.CSSProperties,
};

// Helper to create colored badge
export const getColoredBadge = (
  bgColor: string,
  textColor: string
): React.CSSProperties => ({
  ...BADGE_STYLES.pill,
  backgroundColor: bgColor,
  color: textColor,
});

// ============================================
// Listing styles
// ============================================

export const LISTING_STYLES = {
  container: {
    background: "rgba(0,0,0,0.2)",
    padding: "8px 0",
  } as React.CSSProperties,

  row: {
    padding: "6px 12px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  } as React.CSSProperties,

  rowBorder: {
    borderBottom: "1px solid rgba(255,255,255,0.05)",
  } as React.CSSProperties,

  priceDistribution: {
    padding: "6px 12px",
    marginBottom: 4,
    borderBottom: "1px solid rgba(255,255,255,0.1)",
    fontSize: 9,
    color: "#888",
  } as React.CSSProperties,

  onlineIndicator: (status: "online" | "afk"): React.CSSProperties => ({
    width: 6,
    height: 6,
    borderRadius: "50%",
    backgroundColor: status === "afk" ? "#f59f00" : "#51cf66",
    flexShrink: 0,
  }),

  moreIndicator: {
    padding: "6px 12px",
    fontSize: 10,
    color: "#666",
    textAlign: "center" as const,
  } as React.CSSProperties,
};

// ============================================
// Modifier filter panel styles
// ============================================

export const FILTER_PANEL_STYLES = {
  header: {
    background: "linear-gradient(135deg, rgba(100,100,100,0.3) 0%, rgba(60,60,60,0.2) 100%)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: "8px 8px 0 0",
    padding: "8px 12px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  } as React.CSSProperties,

  content: {
    background: "rgba(30,30,30,0.9)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderTop: "none",
    maxHeight: 200,
    overflowY: "auto" as const,
  } as React.CSSProperties,

  footer: (disabled: boolean, isRateLimited: boolean): React.CSSProperties => ({
    background: isRateLimited
      ? "linear-gradient(135deg, rgba(255,100,100,0.2) 0%, rgba(255,80,80,0.1) 100%)"
      : "linear-gradient(135deg, rgba(255,215,0,0.2) 0%, rgba(255,180,0,0.1) 100%)",
    border: `1px solid ${isRateLimited ? "rgba(255,100,100,0.3)" : "rgba(255,215,0,0.3)"}`,
    borderTop: "none",
    borderRadius: "0 0 8px 8px",
    padding: "10px 12px",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  }),

  divider: {
    borderTop: "1px solid rgba(255,255,255,0.05)",
    margin: 0,
  } as React.CSSProperties,
};

// ============================================
// Quick action button style
// ============================================

export const QUICK_ACTION_STYLE: React.CSSProperties = {
  background: "linear-gradient(135deg, rgba(255,215,0,0.25) 0%, rgba(255,180,0,0.15) 100%)",
  border: "1px solid rgba(255,215,0,0.4)",
  borderRadius: 8,
  padding: "12px 16px",
  margin: "8px 16px",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 10,
};

// ============================================
// Text styles
// ============================================

export const TEXT_STYLES = {
  label: {
    fontSize: 10,
    fontWeight: "bold" as const,
    marginBottom: 2,
  } as React.CSSProperties,

  description: {
    fontSize: 11,
    color: "#888",
  } as React.CSSProperties,

  muted: {
    fontSize: 9,
    color: "#888",
    marginTop: 4,
  } as React.CSSProperties,

  truncate: {
    overflow: "hidden" as const,
    textOverflow: "ellipsis" as const,
    whiteSpace: "nowrap" as const,
  } as React.CSSProperties,
};
