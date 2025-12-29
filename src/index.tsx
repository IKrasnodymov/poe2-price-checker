// src/index.tsx - PoE2 Price Checker Decky Plugin

import {
  definePlugin,
  PanelSection,
  PanelSectionRow,
  ButtonItem,
  DropdownItem,
  ToggleField,
  TextField,
  Spinner,
  staticClasses,
} from "@decky/ui";
import { call } from "@decky/api";
import { useState, useEffect, useCallback, FC, useRef } from "react";
import {
  FaCoins,
  FaCog,
  FaSync,
  FaClipboard,
  FaArrowLeft,
  FaExclamationTriangle,
  FaGem,
  FaSkull,
  FaCopy,
  FaShieldAlt,
  FaBolt,
  FaFire,
  FaSnowflake,
  FaMagic
} from "react-icons/fa";

import {
  ParsedItem,
  PluginSettings,
  PriceResult,
  League,
  TradeListing,
  ClipboardResult,
  TradeSearchResult,
  TradeListingsResult,
  LeaguesResult,
  ItemModifier,
  PriceHistoryRecord,
  PriceHistoryResult,
} from "./lib/types";
import { parseItemText, getPoeNinjaItemType, getItemDisplayName, getAllModifiers } from "./lib/itemParser";
import { formatPrice, getBestPrice, matchModifier } from "./utils/modifierMatcher";

// =========================================================================
// STYLE CONSTANTS
// =========================================================================

const RARITY_COLORS: Record<string, string> = {
  Normal: "#c8c8c8",
  Magic: "#8888ff",
  Rare: "#ffff77",
  Unique: "#af6025",
  Currency: "#aa9e82",
  Gem: "#1ba29b",
  DivinationCard: "#0ebaff",
};

// =========================================================================
// SETTINGS PANEL COMPONENT
// =========================================================================

interface SettingsPanelProps {
  onBack: () => void;
}

// Default leagues fallback
const DEFAULT_LEAGUES: League[] = [
  { id: "Fate of the Vaal", text: "Fate of the Vaal" },
  { id: "HC Fate of the Vaal", text: "HC Fate of the Vaal" },
  { id: "Standard", text: "Standard" },
  { id: "Hardcore", text: "Hardcore" },
];

const SettingsPanel: FC<SettingsPanelProps> = ({ onBack }) => {
  const [settings, setSettings] = useState<PluginSettings>({
    league: "Fate of the Vaal",
    useTradeApi: true,
    usePoeNinja: true,
    poesessid: "",
  });
  const [leagues, setLeagues] = useState<League[]>(DEFAULT_LEAGUES);
  const [isLoading, setIsLoading] = useState(true);
  const [debugInfo, setDebugInfo] = useState<string>("");
  const [showDebug, setShowDebug] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const settingsResult = await call<[], PluginSettings>("get_settings");
      setSettings(settingsResult);

      try {
        const leaguesResult = await call<[], LeaguesResult>("get_available_leagues");
        if (leaguesResult.success && leaguesResult.leagues.length > 0) {
          setLeagues(leaguesResult.leagues);
        }
      } catch {
        // Keep default leagues
      }
    } catch (e) {
      console.error("Failed to load settings:", e);
      setDebugInfo(`Settings error: ${e}`);
    } finally {
      setIsLoading(false);
    }
  };

  const loadDebugInfo = async () => {
    try {
      const [logsResult, clipboardTest] = await Promise.all([
        call<[number], { success: boolean; logs: string; path: string }>("get_logs", 30),
        call<[], Record<string, unknown>>("test_clipboard"),
      ]);

      let info = "=== CLIPBOARD TEST ===\n";
      info += JSON.stringify(clipboardTest, null, 2);
      info += "\n\n=== RECENT LOGS ===\n";
      info += logsResult.logs || "No logs";
      info += `\n\nLog path: ${logsResult.path}`;

      setDebugInfo(info);
    } catch (e) {
      setDebugInfo(`Debug error: ${e}`);
    }
  };

  const updateSetting = async <K extends keyof PluginSettings>(
    key: K,
    value: PluginSettings[K]
  ) => {
    const newSettings = { ...settings, [key]: value };
    setSettings(newSettings);
    await call<[Partial<PluginSettings>], unknown>("update_settings", { [key]: value });
  };

  if (isLoading) {
    return (
      <PanelSection title="Settings">
        <PanelSectionRow>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Spinner />
            <span>Loading...</span>
          </div>
        </PanelSectionRow>
      </PanelSection>
    );
  }

  return (
    <>
      <PanelSection>
        <PanelSectionRow>
          <ButtonItem layout="below" onClick={onBack}>
            <FaArrowLeft style={{ marginRight: 8 }} />
            Back to Price Check
          </ButtonItem>
        </PanelSectionRow>
      </PanelSection>

      <PanelSection title="League">
        <PanelSectionRow>
          <DropdownItem
            label="Active League"
            rgOptions={leagues.map((l) => ({
              data: l.id,
              label: l.text,
            }))}
            selectedOption={settings.league}
            onChange={(option) => updateSetting("league", option.data as string)}
          />
        </PanelSectionRow>
      </PanelSection>

      <PanelSection title="Data Sources">
        <PanelSectionRow>
          <ToggleField
            label="Use poe.ninja"
            description="For unique items and currency prices"
            checked={settings.usePoeNinja}
            onChange={(v) => updateSetting("usePoeNinja", v)}
          />
        </PanelSectionRow>

        <PanelSectionRow>
          <ToggleField
            label="Use Trade API"
            description="For rare/magic item searches"
            checked={settings.useTradeApi}
            onChange={(v) => updateSetting("useTradeApi", v)}
          />
        </PanelSectionRow>
      </PanelSection>

      <PanelSection title="Authentication (Optional)">
        <PanelSectionRow>
          <TextField
            label="POESESSID"
            description="For accessing private listings (optional)"
            value={settings.poesessid}
            onChange={(e) => updateSetting("poesessid", e.target.value)}
          />
        </PanelSectionRow>
      </PanelSection>

      <PanelSection title="Как пользоваться">
        <PanelSectionRow>
          <div style={{ padding: 8, fontSize: 11, color: "#888" }}>
            1. Наведи курсор на предмет в PoE2
            <br />
            2. Нажми Ctrl+C (скопировать)
            <br />
            3. Открой Decky (...) → цена покажется автоматически
            <br />
            <br />
            <span style={{ color: "#0ff" }}>
              Совет: Настрой заднюю кнопку (L4/R4) на Ctrl+C в Steam Input
            </span>
          </div>
        </PanelSectionRow>
      </PanelSection>

      <PanelSection title="Debug">
        <PanelSectionRow>
          <ButtonItem
            layout="below"
            onClick={() => {
              if (!showDebug) {
                loadDebugInfo();
              }
              setShowDebug(!showDebug);
            }}
          >
            {showDebug ? "Hide Debug Info" : "Show Debug Info"}
          </ButtonItem>
        </PanelSectionRow>

        {showDebug && (
          <>
            <PanelSectionRow>
              <ButtonItem
                layout="below"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(debugInfo);
                  } catch {
                    // Fallback: call backend to copy
                    await call<[string], void>("copy_to_clipboard", debugInfo);
                  }
                }}
              >
                <FaClipboard style={{ marginRight: 8 }} />
                Copy Debug Info
              </ButtonItem>
            </PanelSectionRow>
            <PanelSectionRow>
              <div
                style={{
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
                }}
              >
                {debugInfo || "Loading..."}
              </div>
            </PanelSectionRow>
          </>
        )}
      </PanelSection>
    </>
  );
};

// =========================================================================
// ITEM DISPLAY COMPONENT
// =========================================================================

interface ItemDisplayProps {
  item: ParsedItem;
}

const ItemDisplay: FC<ItemDisplayProps> = ({ item }) => {
  const rarityColor = RARITY_COLORS[item.rarity] || "#fff";

  // Format sockets display
  const formatSockets = () => {
    if (!item.sockets) return null;
    return item.sockets;
  };

  // Get element icon
  const ElementIcon: FC<{ type: string }> = ({ type }) => {
    switch (type.toLowerCase()) {
      case "fire": return <FaFire style={{ color: "#ff6b35" }} />;
      case "cold": return <FaSnowflake style={{ color: "#6bc5ff" }} />;
      case "lightning": return <FaBolt style={{ color: "#ffd700" }} />;
      default: return <FaMagic style={{ color: "#b366ff" }} />;
    }
  };

  return (
    <PanelSection title="Item">
      <PanelSectionRow>
        <div style={{ padding: 8, maxWidth: "100%", overflow: "hidden" }}>
          {/* Item Class */}
          {item.itemClass && (
            <div style={{ fontSize: 10, color: "#666", marginBottom: 4 }}>
              {item.itemClass}
            </div>
          )}

          {/* Item Name */}
          <div
            style={{
              fontWeight: "bold",
              fontSize: 14,
              color: rarityColor,
              textShadow: "0 1px 2px rgba(0,0,0,0.5)",
              wordBreak: "break-word",
            }}
          >
            {getItemDisplayName(item)}
          </div>

          {/* Base Type (for rares/uniques) */}
          {item.name && item.basetype && item.name !== item.basetype && (
            <div style={{ color: "#aaa", fontSize: 11, marginTop: 2, wordBreak: "break-word" }}>
              {item.basetype}
            </div>
          )}

          {/* Special flags */}
          <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
            {item.corrupted && (
              <span style={{
                color: "#d20000",
                fontSize: 11,
                fontWeight: "bold",
                display: "flex",
                alignItems: "center",
                gap: 3
              }}>
                <FaSkull size={10} /> Corrupted
              </span>
            )}
            {item.mirrored && (
              <span style={{ color: "#6cf", fontSize: 11, fontWeight: "bold" }}>
                ◇ Mirrored
              </span>
            )}
            {item.unidentified && (
              <span style={{ color: "#888", fontSize: 11, fontWeight: "bold" }}>
                Unidentified
              </span>
            )}
          </div>

          {/* Main stats row */}
          <div style={{
            display: "flex",
            gap: 12,
            marginTop: 8,
            fontSize: 12,
            color: "#aaa",
            flexWrap: "wrap"
          }}>
            {item.itemLevel && (
              <span style={{ color: "#ffd700" }}>
                <strong>iLvl</strong> {item.itemLevel}
              </span>
            )}
            {item.levelRequired && (
              <span>
                <strong>Req</strong> Lv{item.levelRequired}
              </span>
            )}
            {item.quality && item.quality > 0 && (
              <span style={{ color: "#88f" }}>
                <strong>Q</strong> {item.quality}%
              </span>
            )}
          </div>

          {/* Sockets */}
          {item.sockets && (
            <div style={{
              marginTop: 6,
              fontSize: 12,
              color: "#aaa",
              display: "flex",
              alignItems: "center",
              gap: 6
            }}>
              <FaGem size={11} style={{ color: "#8f8" }} />
              <span>{formatSockets()}</span>
              {item.linkedSockets && item.linkedSockets > 1 && (
                <span style={{ color: "#ffd700", fontSize: 11 }}>
                  ({item.linkedSockets}L)
                </span>
              )}
            </div>
          )}

          {/* Defense stats */}
          {(item.armour || item.evasion || item.energyShield) && (
            <div style={{
              marginTop: 8,
              padding: 6,
              backgroundColor: "rgba(255,255,255,0.05)",
              borderRadius: 4,
              display: "flex",
              gap: 12,
              fontSize: 12,
              flexWrap: "wrap"
            }}>
              {item.armour && (
                <span style={{ color: "#c8a060" }}>
                  <FaShieldAlt size={10} /> AR {item.armour}
                </span>
              )}
              {item.evasion && (
                <span style={{ color: "#7cb342" }}>
                  EV {item.evasion}
                </span>
              )}
              {item.energyShield && (
                <span style={{ color: "#42a5f5" }}>
                  ES {item.energyShield}
                </span>
              )}
            </div>
          )}

          {/* Weapon stats */}
          {(item.physicalDamage || item.dps || item.attackSpeed) && (
            <div style={{
              marginTop: 8,
              padding: 6,
              backgroundColor: "rgba(255,255,255,0.05)",
              borderRadius: 4
            }}>
              {/* Physical Damage */}
              {item.physicalDamage && (
                <div style={{ fontSize: 12, color: "#ccc", marginBottom: 4 }}>
                  <strong>Physical:</strong> {item.physicalDamage.min}-{item.physicalDamage.max}
                </div>
              )}

              {/* Elemental Damage */}
              {item.elementalDamage && item.elementalDamage.length > 0 && (
                <div style={{ fontSize: 12, marginBottom: 4 }}>
                  {item.elementalDamage.map((elem, i) => (
                    <span key={i} style={{
                      marginRight: 8,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4
                    }}>
                      <ElementIcon type={elem.type} />
                      {elem.min}-{elem.max}
                    </span>
                  ))}
                </div>
              )}

              {/* APS, Crit, DPS */}
              <div style={{ display: "flex", gap: 12, fontSize: 11, color: "#888" }}>
                {item.attackSpeed && <span>APS: {item.attackSpeed}</span>}
                {item.criticalChance && <span>Crit: {item.criticalChance}%</span>}
                {item.dps && (
                  <span style={{ color: "#ffd700", fontWeight: "bold" }}>
                    DPS: {item.dps}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Gem specific */}
          {item.rarity === "Gem" && (
            <div style={{
              marginTop: 8,
              padding: 6,
              backgroundColor: "rgba(27,162,155,0.1)",
              borderRadius: 4,
              display: "flex",
              gap: 12,
              fontSize: 12
            }}>
              {item.gemLevel && (
                <span style={{ color: "#1ba29b" }}>
                  <strong>Level</strong> {item.gemLevel}
                </span>
              )}
              {item.gemQuality && item.gemQuality > 0 && (
                <span style={{ color: "#1ba29b" }}>
                  <strong>Quality</strong> {item.gemQuality}%
                </span>
              )}
            </div>
          )}

          {/* Stack size for currency */}
          {item.stackSize && (
            <div style={{ marginTop: 6, fontSize: 11, color: "#888" }}>
              Stack: {item.stackSize.current}/{item.stackSize.max}
            </div>
          )}
        </div>
      </PanelSectionRow>
    </PanelSection>
  );
};

// =========================================================================
// MODIFIER FILTER COMPONENT
// =========================================================================

interface ModifierFilterProps {
  modifier: ItemModifier;
  index: number;
  onToggle: (index: number) => void;
  onValueChange: (index: number, min?: number, max?: number) => void;
}

// Type badge colors
const MOD_TYPE_COLORS: Record<string, { bg: string; text: string }> = {
  implicit: { bg: "rgba(100,100,255,0.2)", text: "#88f" },
  explicit: { bg: "rgba(255,255,255,0.05)", text: "#aaa" },
  crafted: { bg: "rgba(180,140,255,0.2)", text: "#b8f" },
  enchant: { bg: "rgba(180,230,255,0.2)", text: "#8ef" },
};

const ModifierFilter: FC<ModifierFilterProps> = ({
  modifier,
  index,
  onToggle,
}) => {
  const typeColor = MOD_TYPE_COLORS[modifier.type] || MOD_TYPE_COLORS.explicit;

  // Split text to highlight numeric values
  const parts = modifier.text.split(/(\+?-?\d+(?:\.\d+)?%?)/g);

  return (
    <PanelSectionRow>
      <div style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 6,
        padding: "4px 0",
        width: "100%",
        maxWidth: "100%",
        overflow: "hidden",
      }}>
        {/* Toggle checkbox */}
        <input
          type="checkbox"
          checked={modifier.enabled}
          onChange={() => onToggle(index)}
          style={{
            marginTop: 2,
            accentColor: "#ffd700",
            cursor: "pointer",
            flexShrink: 0,
          }}
        />

        {/* Modifier content */}
        <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
          {/* Type badge */}
          <span style={{
            fontSize: 8,
            padding: "1px 3px",
            borderRadius: 2,
            backgroundColor: typeColor.bg,
            color: typeColor.text,
            marginRight: 4,
            textTransform: "uppercase",
          }}>
            {modifier.type.substring(0, 3)}
          </span>

          {/* Modifier text with highlighted values */}
          <span style={{
            fontSize: 11,
            color: modifier.enabled ? "#ddd" : "#666",
            wordBreak: "break-word",
            lineHeight: 1.3,
          }}>
            {parts.map((part, i) =>
              /\+?-?\d+(?:\.\d+)?%?/.test(part) ? (
                <span key={i} style={{ color: "#ffd700", fontWeight: "bold" }}>
                  {part}
                </span>
              ) : (
                <span key={i}>{part}</span>
              )
            )}
          </span>

          {/* Tier info if available */}
          {modifier.tier && (
            <span style={{
              fontSize: 9,
              color: "#666",
              marginLeft: 4
            }}>
              T{modifier.tier}
            </span>
          )}
        </div>
      </div>
    </PanelSectionRow>
  );
};

// =========================================================================
// PRICE DISPLAY COMPONENT
// =========================================================================

interface PriceDisplayProps {
  priceResult: PriceResult;
  item?: ParsedItem | null;
}

const PriceDisplay: FC<PriceDisplayProps> = ({ priceResult, item }) => {
  const [priceHistory, setPriceHistory] = useState<PriceHistoryRecord[]>([]);

  useEffect(() => {
    const loadHistory = async () => {
      if (!item) return;
      try {
        const result = await call<[string, string, string], PriceHistoryResult>(
          "get_price_history",
          item.name,
          item.basetype,
          item.rarity
        );
        if (result.success && result.records.length > 0) {
          setPriceHistory(result.records);
        }
      } catch (e) {
        console.error("Failed to load price history:", e);
      }
    };
    loadHistory();
  }, [item]);

  // Helper to format relative time from unix timestamp
  const formatTimeAgo = (timestamp: number): string => {
    const seconds = Math.floor(Date.now() / 1000 - timestamp);
    if (seconds < 60) return "just now";
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  };

  // Helper to format indexed time from ISO string
  const formatIndexedTime = (indexed: string): string => {
    try {
      const date = new Date(indexed);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMs / 3600000);
      const diffDays = Math.floor(diffMs / 86400000);

      if (diffMins < 1) return "just now";
      if (diffMins < 60) return `${diffMins}m ago`;
      if (diffHours < 24) return `${diffHours}h ago`;
      if (diffDays < 7) return `${diffDays}d ago`;
      return `${Math.floor(diffDays / 7)}w ago`;
    } catch {
      return indexed;
    }
  };
  if (!priceResult.success) {
    return (
      <PanelSection title="Price">
        <PanelSectionRow>
          <div style={{ color: "#ff6b6b", padding: 8 }}>
            {priceResult.error || "Price check failed"}
          </div>
        </PanelSectionRow>
      </PanelSection>
    );
  }

  // poe.ninja result
  if (priceResult.source === "poe.ninja" && priceResult.price) {
    const bestPrice = getBestPrice(priceResult.price);

    return (
      <PanelSection title="Price (poe.ninja)">
        <PanelSectionRow>
          <div style={{ padding: 8 }}>
            <div style={{ fontSize: 20, fontWeight: "bold", color: "#ffd700" }}>
              {bestPrice ? formatPrice(bestPrice.amount, bestPrice.currency) : "N/A"}
            </div>
            <div style={{ fontSize: 12, color: "#888", marginTop: 4 }}>
              {priceResult.listingsCount || priceResult.confidence === "high"
                ? `${priceResult.listingsCount || "Many"} listings`
                : "Few listings"}
              {" - "}
              {priceResult.confidence} confidence
            </div>
          </div>
        </PanelSectionRow>
      </PanelSection>
    );
  }

  // Trade API listings
  if (priceResult.source === "trade" && priceResult.listings) {
    const listings = priceResult.listings;

    if (listings.length === 0) {
      return (
        <PanelSection title="Trade Results">
          <PanelSectionRow>
            <div style={{ padding: 8, color: "#888" }}>
              No listings found. Try adjusting filters.
            </div>
          </PanelSectionRow>
        </PanelSection>
      );
    }

    // Group listings by currency and calculate stats for each
    const byCurrency: Record<string, number[]> = {};
    listings.forEach((l) => {
      if (l.amount != null && l.amount > 0 && l.currency) {
        const curr = l.currency.toLowerCase();
        if (!byCurrency[curr]) byCurrency[curr] = [];
        byCurrency[curr].push(l.amount);
      }
    });

    // Calculate stats per currency
    const currencyStats: Array<{
      currency: string;
      min: number;
      max: number;
      median: number;
      count: number;
    }> = [];

    Object.entries(byCurrency).forEach(([currency, values]) => {
      values.sort((a, b) => a - b);
      const mid = Math.floor(values.length / 2);
      const median = values.length % 2 !== 0
        ? values[mid]
        : (values[mid - 1] + values[mid]) / 2;

      currencyStats.push({
        currency,
        min: values[0],
        max: values[values.length - 1],
        median,
        count: values.length
      });
    });

    // Sort by count (most common currency first)
    currencyStats.sort((a, b) => b.count - a.count);

    return (
      <>
        {/* Price Summary by Currency */}
        {currencyStats.length > 0 && (
          <PanelSection title={`Price Summary (${listings.length} total)`}>
            {currencyStats.map((stats) => (
              <PanelSectionRow key={stats.currency}>
                <div style={{ padding: 8 }}>
                  <div style={{ fontSize: 16, fontWeight: "bold", color: "#ffd700" }}>
                    {stats.min === stats.max
                      ? formatPrice(stats.min, stats.currency)
                      : `${formatPrice(stats.min, stats.currency)} - ${formatPrice(stats.max, stats.currency)}`
                    }
                  </div>
                  <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>
                    Median: {formatPrice(stats.median, stats.currency)} • {stats.count} listings
                  </div>
                </div>
              </PanelSectionRow>
            ))}
          </PanelSection>
        )}

        {/* Individual listings (first 10) */}
        <PanelSection title={`Listings (${listings.length} found)`}>
          {listings.slice(0, 10).map((listing, i) => (
            <PanelSectionRow key={i}>
              <div style={{ padding: 6, width: "100%" }}>
                <div style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 4
                }}>
                  <span style={{ color: "#ffd700", fontWeight: "bold", fontSize: 14 }}>
                    {formatPrice(listing.amount, listing.currency)}
                  </span>
                  {listing.whisper && (
                    <button
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(listing.whisper);
                        } catch {
                          await call<[string], void>("copy_to_clipboard", listing.whisper);
                        }
                      }}
                      style={{
                        background: "rgba(255,215,0,0.1)",
                        border: "1px solid #ffd70044",
                        borderRadius: 4,
                        padding: "2px 6px",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                        color: "#ffd700",
                        fontSize: 10
                      }}
                    >
                      <FaCopy size={10} />
                      Whisper
                    </button>
                  )}
                </div>
                <div style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 10,
                  color: "#666"
                }}>
                  <span>{listing.account}</span>
                  {listing.indexed && (
                    <span>{formatIndexedTime(listing.indexed)}</span>
                  )}
                </div>
              </div>
            </PanelSectionRow>
          ))}
        </PanelSection>

        {/* Price History */}
        {priceHistory.length > 1 && (
          <PanelSection title={`Price History (${priceHistory.length})`}>
            <PanelSectionRow>
              <div style={{ padding: 8 }}>
                {priceHistory.slice(-5).reverse().map((record, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      marginBottom: 4,
                      fontSize: 12,
                    }}
                  >
                    <span style={{ color: "#ffd700" }}>
                      {formatPrice(record.median_price, record.currency || "chaos")}
                    </span>
                    <span style={{ color: "#666" }}>
                      {formatTimeAgo(record.timestamp)} ({record.listing_count})
                    </span>
                  </div>
                ))}
              </div>
            </PanelSectionRow>
          </PanelSection>
        )}
      </>
    );
  }

  return null;
};

// =========================================================================
// MAIN PRICE CHECK CONTENT
// =========================================================================

const PriceCheckContent: FC = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parsedItem, setParsedItem] = useState<ParsedItem | null>(null);
  const [priceResult, setPriceResult] = useState<PriceResult | null>(null);
  // Dual-source: separate results for poe.ninja and Trade API
  const [ninjaResult, setNinjaResult] = useState<PriceResult | null>(null);
  const [tradeResult, setTradeResult] = useState<PriceResult | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [modifiers, setModifiers] = useState<ItemModifier[]>([]);
  const [autoChecked, setAutoChecked] = useState(false);
  const [settings, setSettings] = useState<PluginSettings>({ league: "Fate of the Vaal", useTradeApi: true, usePoeNinja: true, poesessid: "" });
  const checkPriceRef = useRef<(() => Promise<void>) | null>(null);

  // Load settings on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const result = await call<[], PluginSettings>("get_settings");
        setSettings(result);
      } catch (e) {
        console.error("Failed to load settings:", e);
      }
    };
    loadSettings();
  }, []);

  // Auto-check clipboard when plugin is opened (with delay to let refs initialize)
  useEffect(() => {
    if (autoChecked) return;

    const timer = setTimeout(() => {
      if (checkPriceRef.current) {
        setAutoChecked(true);
        checkPriceRef.current();
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [autoChecked]);

  /**
   * Search trade API for item
   */
  const searchTradeApi = useCallback(async (
    item: ParsedItem,
    mods: ItemModifier[]
  ) => {
    // Get enabled modifiers
    const enabledMods = mods.filter((m) => m.enabled);

    // Get stat IDs from backend for all enabled mods
    const modTexts = enabledMods.map((m) => m.text);
    const statIdsResult = await call<[string[]], { success: boolean; stat_ids: Record<string, string> }>(
      "get_stat_ids_for_mods",
      modTexts
    );

    // Build mod list with resolved stat IDs
    const modsWithIds = enabledMods
      .filter((m) => statIdsResult.stat_ids[m.text])
      .map((m) => ({
        id: statIdsResult.stat_ids[m.text],
        min: m.minValue,
        enabled: true,
      }));

    const query = await call<
      [string | null, string | null, typeof modsWithIds, Record<string, unknown>],
      Record<string, unknown>
    >(
      "build_trade_query",
      item.rarity === "Unique" ? item.name : null,
      item.basetype,
      modsWithIds,
      { ilvl_min: item.itemLevel }
    );

    const searchResult = await call<[Record<string, unknown>], TradeSearchResult>(
      "search_trade_api",
      query
    );

    if (!searchResult.success) {
      setPriceResult({
        success: false,
        source: "trade",
        error: searchResult.error || "Trade API search failed",
      });
      return;
    }

    if (searchResult.total === 0 || !searchResult.result?.length) {
      setPriceResult({
        success: true,
        source: "trade",
        listings: [],
      });
      return;
    }

    // Fetch listings
    const listingsResult = await call<[string[], string], TradeListingsResult>(
      "fetch_trade_listings",
      searchResult.result,
      searchResult.id!
    );

    if (listingsResult.success) {
      setPriceResult({
        success: true,
        source: "trade",
        listings: listingsResult.listings,
      });

      // Save median price to history (use dominant currency)
      if (listingsResult.listings.length > 0) {
        // Group by currency
        const byCurrency: Record<string, number[]> = {};
        listingsResult.listings.forEach((l) => {
          if (l.amount != null && l.amount > 0 && l.currency) {
            const curr = l.currency.toLowerCase();
            if (!byCurrency[curr]) byCurrency[curr] = [];
            byCurrency[curr].push(l.amount);
          }
        });

        // Find dominant currency (most listings)
        let dominantCurrency = "chaos";
        let maxCount = 0;
        Object.entries(byCurrency).forEach(([curr, vals]) => {
          if (vals.length > maxCount) {
            maxCount = vals.length;
            dominantCurrency = curr;
          }
        });

        const values = byCurrency[dominantCurrency] || [];
        if (values.length > 0) {
          values.sort((a, b) => a - b);
          const mid = Math.floor(values.length / 2);
          const median = values.length % 2 !== 0
            ? values[mid]
            : (values[mid - 1] + values[mid]) / 2;

          // Save to history with currency
          await call<[string, string, string, number, number, string], { success: boolean }>(
            "add_price_record",
            item.name,
            item.basetype,
            item.rarity,
            median,
            values.length,
            dominantCurrency
          );
        }
      }
    } else {
      setPriceResult({
        success: false,
        source: "trade",
        error: listingsResult.error,
      });
    }
  }, []);

  /**
   * Read clipboard and parse item
   */
  const checkPrice = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setParsedItem(null);
    setPriceResult(null);
    setModifiers([]);

    try {
      // Read clipboard from backend
      const clipboardResult = await call<[], ClipboardResult>("read_clipboard");

      if (!clipboardResult.success) {
        setError(clipboardResult.error || "Failed to read clipboard");
        setIsLoading(false);
        return;
      }

      // Parse item text
      const item = parseItemText(clipboardResult.text!);
      if (!item) {
        setError("Could not parse item data from clipboard. Make sure you copied an item with Ctrl+C.");
        setIsLoading(false);
        return;
      }

      setParsedItem(item);

      // Get all modifiers and try to match them
      const allMods = getAllModifiers(item);
      const matchedMods = allMods.map((mod) => {
        const match = matchModifier(mod.text);
        return {
          ...mod,
          tradeId: match.tradeId || undefined,
        };
      });
      setModifiers(matchedMods);

      // Always use Trade API for real-time prices with buyout only
      await searchTradeApi(item, matchedMods);
    } catch (e) {
      setError(`Error: ${e}`);
    } finally {
      setIsLoading(false);
    }
  }, [searchTradeApi]);

  /**
   * Simulate Ctrl+C and then check price
   */
  const copyAndCheck = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      // First, simulate Ctrl+C to copy item from game
      const copyResult = await call<[], { success: boolean; method?: string; error?: string }>(
        "simulate_copy"
      );

      if (!copyResult.success) {
        setError(copyResult.error || "Failed to simulate Ctrl+C. Make sure cursor is on an item.");
        setIsLoading(false);
        return;
      }

      // Small delay to ensure clipboard is updated
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Now check the clipboard
      setIsLoading(false);
      await checkPrice();
    } catch (e) {
      setError(`Copy error: ${e}`);
      setIsLoading(false);
    }
  }, [checkPrice]);

  // Update ref for auto-check
  useEffect(() => {
    checkPriceRef.current = checkPrice;
  }, [checkPrice]);

  /**
   * Toggle modifier for filtering
   */
  const toggleModifier = (index: number) => {
    const newMods = [...modifiers];
    newMods[index] = { ...newMods[index], enabled: !newMods[index].enabled };
    setModifiers(newMods);
  };

  /**
   * Re-search with current filters
   */
  const reSearch = useCallback(async () => {
    if (!parsedItem) return;

    setIsLoading(true);
    setPriceResult(null);

    try {
      await searchTradeApi(parsedItem, modifiers);
    } catch (e) {
      setError(`Search error: ${e}`);
    } finally {
      setIsLoading(false);
    }
  }, [parsedItem, modifiers, searchTradeApi]);

  // Settings panel
  if (showSettings) {
    return <SettingsPanel onBack={() => setShowSettings(false)} />;
  }

  return (
    <>
      {/* Action Buttons */}
      <PanelSection title="PoE2 Price Checker">
        <PanelSectionRow>
          <ButtonItem layout="below" onClick={copyAndCheck} disabled={isLoading}>
            {isLoading ? (
              <>
                <Spinner style={{ marginRight: 8, width: 16, height: 16 }} />
                Checking...
              </>
            ) : (
              <>
                <FaCoins style={{ marginRight: 8 }} />
                Copy & Check Price
              </>
            )}
          </ButtonItem>
        </PanelSectionRow>

        <PanelSectionRow>
          <ButtonItem layout="below" onClick={checkPrice} disabled={isLoading}>
            <FaClipboard style={{ marginRight: 8 }} />
            Check Clipboard Only
          </ButtonItem>
        </PanelSectionRow>

        <PanelSectionRow>
          <ButtonItem layout="below" onClick={() => setShowSettings(true)}>
            <FaCog style={{ marginRight: 8 }} />
            Settings
          </ButtonItem>
        </PanelSectionRow>
      </PanelSection>

      {/* Error Display */}
      {error && (
        <PanelSection title="Error">
          <PanelSectionRow>
            <div
              style={{
                color: "#ff6b6b",
                padding: 8,
                display: "flex",
                alignItems: "flex-start",
                gap: 8,
              }}
            >
              <FaExclamationTriangle style={{ marginTop: 2, flexShrink: 0 }} />
              <span>{error}</span>
            </div>
          </PanelSectionRow>
        </PanelSection>
      )}

      {/* Quick Price Summary - показываем сразу вверху */}
      {parsedItem && priceResult && priceResult.success && (
        <div style={{
          background: "linear-gradient(135deg, rgba(255,215,0,0.15) 0%, rgba(255,180,0,0.05) 100%)",
          border: "1px solid rgba(255,215,0,0.3)",
          borderRadius: 8,
          padding: "10px 12px",
          margin: "8px 16px",
          boxSizing: "border-box",
          maxWidth: "100%",
          overflow: "hidden",
        }}>
          {/* Price - крупно по центру */}
          <div style={{
            fontSize: 20,
            fontWeight: "bold",
            color: "#ffd700",
            textShadow: "0 0 10px rgba(255,215,0,0.3)",
            textAlign: "center",
            marginBottom: 6,
          }}>
            {(() => {
              // poe.ninja price
              if (priceResult.source === "poe.ninja" && priceResult.price) {
                const best = getBestPrice(priceResult.price);
                return best ? formatPrice(best.amount, best.currency) : "N/A";
              }
              // Trade API - show min-max range
              if (priceResult.source === "trade" && priceResult.listings && priceResult.listings.length > 0) {
                const byCurrency: Record<string, number[]> = {};
                priceResult.listings.forEach((l) => {
                  if (l.amount != null && l.amount > 0 && l.currency) {
                    const curr = l.currency.toLowerCase();
                    if (!byCurrency[curr]) byCurrency[curr] = [];
                    byCurrency[curr].push(l.amount);
                  }
                });

                // Find dominant currency
                let dominant = "chaos";
                let maxCount = 0;
                Object.entries(byCurrency).forEach(([curr, vals]) => {
                  if (vals.length > maxCount) {
                    maxCount = vals.length;
                    dominant = curr;
                  }
                });

                const values = byCurrency[dominant] || [];
                if (values.length > 0) {
                  values.sort((a, b) => a - b);
                  const min = values[0];
                  const max = values[values.length - 1];
                  if (min === max) {
                    return formatPrice(min, dominant);
                  }
                  return `${formatPrice(min, dominant)} — ${formatPrice(max, dominant)}`;
                }
              }
              return "No price";
            })()}
          </div>

          {/* Item name */}
          <div style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            color: RARITY_COLORS[parsedItem.rarity] || "#fff",
            fontWeight: "bold",
            fontSize: 12,
            textAlign: "center",
            marginBottom: 4,
          }}>
            {parsedItem.name || parsedItem.basetype}
          </div>

          {/* Secondary info row */}
          <div style={{
            display: "flex",
            justifyContent: "center",
            gap: 12,
            fontSize: 10,
            color: "#666"
          }}>
            <span>{priceResult.source === "poe.ninja" ? "poe.ninja" : "Trade"}</span>
            <span>•</span>
            <span>
              {priceResult.source === "trade" && priceResult.listings
                ? `${priceResult.listings.length} listings`
                : priceResult.listingsCount
                  ? `${priceResult.listingsCount} listings`
                  : priceResult.confidence || ""
              }
            </span>
          </div>
        </div>
      )}

      {/* Loading indicator */}
      {isLoading && parsedItem && (
        <div style={{
          background: "rgba(255,255,255,0.05)",
          borderRadius: 8,
          padding: 12,
          margin: "8px 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8
        }}>
          <Spinner style={{ width: 16, height: 16 }} />
          <span style={{ color: "#888" }}>Searching...</span>
        </div>
      )}

      {/* Parsed Item Display */}
      {parsedItem && <ItemDisplay item={parsedItem} />}

      {/* Modifier Filters */}
      {modifiers.length > 0 && (
        <PanelSection title={`Modifiers (${modifiers.filter(m => m.enabled).length}/${modifiers.length} selected)`}>
          {/* Group modifiers by type */}
          {(() => {
            const implicits = modifiers.filter((m, i) => m.type === "implicit").map((m, i) => ({ mod: m, idx: modifiers.indexOf(m) }));
            const explicits = modifiers.filter((m, i) => m.type === "explicit").map((m, i) => ({ mod: m, idx: modifiers.indexOf(m) }));
            const crafted = modifiers.filter((m, i) => m.type === "crafted").map((m, i) => ({ mod: m, idx: modifiers.indexOf(m) }));

            return (
              <>
                {implicits.map(({ mod, idx }) => (
                  <ModifierFilter
                    key={idx}
                    modifier={mod}
                    index={idx}
                    onToggle={toggleModifier}
                    onValueChange={() => {}}
                  />
                ))}
                {implicits.length > 0 && explicits.length > 0 && (
                  <div style={{ borderTop: "1px solid #333", margin: "4px 0" }} />
                )}
                {explicits.map(({ mod, idx }) => (
                  <ModifierFilter
                    key={idx}
                    modifier={mod}
                    index={idx}
                    onToggle={toggleModifier}
                    onValueChange={() => {}}
                  />
                ))}
                {crafted.length > 0 && (
                  <div style={{ borderTop: "1px solid #333", margin: "4px 0" }} />
                )}
                {crafted.map(({ mod, idx }) => (
                  <ModifierFilter
                    key={idx}
                    modifier={mod}
                    index={idx}
                    onToggle={toggleModifier}
                    onValueChange={() => {}}
                  />
                ))}
              </>
            );
          })()}

          <PanelSectionRow>
            <div style={{ display: "flex", gap: 8, width: "100%" }}>
              <button
                onClick={() => {
                  const newMods = modifiers.map(m => ({ ...m, enabled: true }));
                  setModifiers(newMods);
                }}
                style={{
                  flex: 1,
                  padding: "8px 12px",
                  background: "rgba(255,255,255,0.1)",
                  border: "1px solid #444",
                  borderRadius: 4,
                  color: "#fff",
                  cursor: "pointer",
                  fontSize: 12
                }}
              >
                Select All
              </button>
              <button
                onClick={() => {
                  const newMods = modifiers.map(m => ({ ...m, enabled: false }));
                  setModifiers(newMods);
                }}
                style={{
                  flex: 1,
                  padding: "8px 12px",
                  background: "rgba(255,255,255,0.1)",
                  border: "1px solid #444",
                  borderRadius: 4,
                  color: "#fff",
                  cursor: "pointer",
                  fontSize: 12
                }}
              >
                Clear All
              </button>
            </div>
          </PanelSectionRow>

          <PanelSectionRow>
            <ButtonItem layout="below" onClick={reSearch} disabled={isLoading}>
              <FaSync style={{ marginRight: 8 }} />
              Search with {modifiers.filter(m => m.enabled).length} Filters
            </ButtonItem>
          </PanelSectionRow>
        </PanelSection>
      )}

      {/* Price Results */}
      {priceResult && <PriceDisplay priceResult={priceResult} item={parsedItem} />}
    </>
  );
};

// =========================================================================
// PLUGIN DEFINITION
// =========================================================================

export default definePlugin(() => {
  return {
    name: "PoE2 Price Checker",
    titleView: (
      <div className={staticClasses.Title}>PoE2 Price Checker</div>
    ),
    content: <PriceCheckContent />,
    icon: <FaCoins />,
    onDismount: () => {
      // Cleanup if needed
    },
  };
});
