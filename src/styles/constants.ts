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
  },
  secondary: {
    background: "rgba(77,171,247,0.1)",
    border: "1px solid rgba(77,171,247,0.3)",
    borderRadius: 4,
    padding: "8px 12px",
    cursor: "pointer",
    color: "#4dabf7",
  },
  ghost: {
    background: "transparent",
    border: "none",
    padding: "8px 12px",
    cursor: "pointer",
    color: "#888",
  },
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
