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
import { useState, useEffect, useCallback, FC } from "react";
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
  FaMagic,
  FaHistory,
  FaArrowUp,
  FaArrowDown,
  FaMinus,
  FaTrash,
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
  TieredSearchResult,
  SearchTier,
  ScanHistoryRecord,
  ScanHistoryResult,
  PriceDynamicsResult,
  PriceDynamicsEntry,
} from "./lib/types";
import { parseItemText, getItemDisplayName, getAllModifiers } from "./lib/itemParser";
import { formatPrice, getBestPrice, matchModifier, getModifierPriority } from "./utils/modifierMatcher";

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
    usePoe2Scout: true,
    autoCheckOnOpen: true,
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
            label="Use poe2scout"
            description="For unique items and currency prices"
            checked={settings.usePoe2Scout}
            onChange={(v) => updateSetting("usePoe2Scout", v)}
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

        <PanelSectionRow>
          <ToggleField
            label="Auto-check on open"
            description="Automatically check clipboard when plugin opens"
            checked={settings.autoCheckOnOpen}
            onChange={(v) => updateSetting("autoCheckOnOpen", v)}
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
// HISTORY PANEL COMPONENT
// =========================================================================

interface HistoryPanelProps {
  onBack: () => void;
  onSelectItem: (record: ScanHistoryRecord) => void;
  settingsDir: string;
}

const HistoryPanel: FC<HistoryPanelProps> = ({ onBack, onSelectItem, settingsDir }) => {
  const [history, setHistory] = useState<ScanHistoryRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadHistory();
  }, []);

  const loadHistory = async () => {
    setIsLoading(true);
    try {
      const result = await call<[number | null], ScanHistoryResult>(
        "get_scan_history",
        null
      );
      if (result.success && result.records) {
        setHistory(result.records);
      } else {
        setError(result.error || "Failed to load history");
      }
    } catch (e) {
      setError(`Error: ${e}`);
    } finally {
      setIsLoading(false);
    }
  };

  const clearHistory = async () => {
    try {
      await call<[], { success: boolean }>("clear_scan_history");
      setHistory([]);
    } catch (e) {
      console.error("Failed to clear history:", e);
    }
  };

  const formatTimeAgo = (timestamp: number): string => {
    const seconds = Math.floor(Date.now() / 1000 - timestamp);
    if (seconds < 60) return "just now";
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  };

  const getRarityColor = (rarity: string): string => {
    return RARITY_COLORS[rarity] || "#fff";
  };

  if (isLoading) {
    return (
      <PanelSection title="Scan History">
        <PanelSectionRow>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Spinner />
            <span>Loading history...</span>
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

      <PanelSection title={`Scan History (${history.length})`}>
        {error && (
          <PanelSectionRow>
            <div style={{ color: "#ff6b6b", padding: 8 }}>{error}</div>
          </PanelSectionRow>
        )}

        {history.length === 0 ? (
          <PanelSectionRow>
            <div style={{ padding: 8, color: "#888" }}>
              No items scanned yet. Copy an item with Ctrl+C and check its price.
            </div>
          </PanelSectionRow>
        ) : (
          <>
            {history.map((record) => (
              <PanelSectionRow key={record.id}>
                <div
                  onClick={() => onSelectItem(record)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "8px 4px",
                    cursor: "pointer",
                    borderRadius: 4,
                    width: "100%",
                  }}
                >
                  {/* Item Icon - use CDN URL directly (file:// doesn't work in Decky webview) */}
                  {record.iconUrl ? (
                    <img
                      src={record.iconUrl}
                      alt=""
                      style={{
                        maxWidth: 40,
                        maxHeight: 40,
                        width: "auto",
                        height: "auto",
                        borderRadius: 4,
                        background: "rgba(0,0,0,0.3)",
                        padding: 2,
                      }}
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        width: 40,
                        height: 40,
                        background: "rgba(255,255,255,0.1)",
                        borderRadius: 4,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      <FaCoins size={14} style={{ color: "#666" }} />
                    </div>
                  )}

                  {/* Item Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        color: getRarityColor(record.rarity),
                        fontWeight: "bold",
                        fontSize: 12,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {record.itemName || record.basetype}
                    </div>
                    <div style={{ fontSize: 10, color: "#666" }}>
                      {formatTimeAgo(record.timestamp)}
                    </div>
                  </div>

                  {/* Price */}
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div
                      style={{
                        color: "#ffd700",
                        fontWeight: "bold",
                        fontSize: 13,
                      }}
                    >
                      {formatPrice(
                        record.priceData.medianPrice,
                        record.priceData.currency
                      )}
                    </div>
                    <div style={{ fontSize: 9, color: "#666" }}>
                      {record.listingsCount} listings
                    </div>
                  </div>
                </div>
              </PanelSectionRow>
            ))}

            {/* Clear History Button */}
            <PanelSectionRow>
              <ButtonItem
                layout="below"
                onClick={clearHistory}
              >
                <FaTrash style={{ marginRight: 8 }} />
                Clear History
              </ButtonItem>
            </PanelSectionRow>
          </>
        )}
      </PanelSection>
    </>
  );
};

// =========================================================================
// PRICE DYNAMICS PANEL COMPONENT
// =========================================================================

interface PriceDynamicsPanelProps {
  record: ScanHistoryRecord;
  onBack: () => void;
  settingsDir: string;
  onRescan?: () => void;  // Optional: show Rescan button when provided
  backLabel?: string;     // Optional: customize back button label
}

const PriceDynamicsPanel: FC<PriceDynamicsPanelProps> = ({ record, onBack, settingsDir, onRescan, backLabel }) => {
  const [dynamics, setDynamics] = useState<PriceDynamicsEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [priceChange24h, setPriceChange24h] = useState<number | null>(null);
  const [priceChangePercent24h, setPriceChangePercent24h] = useState<number | null>(null);

  useEffect(() => {
    loadDynamics();
  }, [record]);

  const loadDynamics = async () => {
    setIsLoading(true);
    try {
      const result = await call<[string, string, string], PriceDynamicsResult>(
        "get_price_dynamics",
        record.itemName,
        record.basetype,
        record.rarity
      );
      if (result.success) {
        setDynamics(result.dynamics);
        setPriceChange24h(result.priceChange24h ?? null);
        setPriceChangePercent24h(result.priceChangePercent24h ?? null);
      }
    } catch (e) {
      console.error("Failed to load dynamics:", e);
    } finally {
      setIsLoading(false);
    }
  };

  const formatTimeAgo = (timestamp: number): string => {
    const seconds = Math.floor(Date.now() / 1000 - timestamp);
    if (seconds < 60) return "just now";
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  };

  const TrendIcon: FC<{ trend?: string }> = ({ trend }) => {
    if (trend === "up") return <FaArrowUp style={{ color: "#40c057" }} />;
    if (trend === "down") return <FaArrowDown style={{ color: "#ff6b6b" }} />;
    return <FaMinus style={{ color: "#868e96" }} />;
  };

  const rarityColor = RARITY_COLORS[record.rarity] || "#fff";

  return (
    <>
      <PanelSection>
        <PanelSectionRow>
          <ButtonItem layout="below" onClick={onBack}>
            <FaArrowLeft style={{ marginRight: 8 }} />
            {backLabel || "Back to History"}
          </ButtonItem>
        </PanelSectionRow>
        {onRescan && (
          <PanelSectionRow>
            <ButtonItem layout="below" onClick={onRescan}>
              <FaSync style={{ marginRight: 8 }} />
              Rescan Item
            </ButtonItem>
          </PanelSectionRow>
        )}
      </PanelSection>

      {/* Item Header with Icon */}
      <PanelSection title="Item Details">
        <PanelSectionRow>
          <div style={{ padding: 8, display: "flex", gap: 12, alignItems: "flex-start" }}>
            {/* Icon - use CDN URL directly */}
            {record.iconUrl && (
              <img
                src={record.iconUrl}
                alt=""
                style={{
                  maxWidth: 56,
                  maxHeight: 56,
                  width: "auto",
                  height: "auto",
                  borderRadius: 4,
                  background: "rgba(0,0,0,0.3)",
                  padding: 4,
                }}
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            )}
            {/* Info */}
            <div style={{ flex: 1 }}>
              <div
                style={{
                  color: rarityColor,
                  fontWeight: "bold",
                  fontSize: 14,
                  marginBottom: 4,
                }}
              >
                {record.itemName || record.basetype}
              </div>
              {record.itemName && record.basetype && record.itemName !== record.basetype && (
                <div style={{ color: "#888", fontSize: 11 }}>{record.basetype}</div>
              )}
              <div
                style={{
                  display: "flex",
                  gap: 12,
                  marginTop: 8,
                  fontSize: 11,
                  color: "#aaa",
                }}
              >
                {record.itemLevel && <span>iLvl {record.itemLevel}</span>}
                {record.quality && <span>Q{record.quality}%</span>}
                {record.corrupted && (
                  <span style={{ color: "#d20000" }}>Corrupted</span>
                )}
              </div>
            </div>
          </div>
        </PanelSectionRow>
      </PanelSection>

      {/* Current Price */}
      <PanelSection title="Current Price">
        <PanelSectionRow>
          <div style={{ padding: 8 }}>
            <div
              style={{
                fontSize: 24,
                fontWeight: "bold",
                color: "#ffd700",
                textAlign: "center",
              }}
            >
              {formatPrice(
                record.priceData.medianPrice,
                record.priceData.currency
              )}
            </div>
            {priceChange24h !== null && priceChangePercent24h !== null && (
              <div
                style={{
                  textAlign: "center",
                  marginTop: 8,
                  fontSize: 12,
                  color:
                    priceChangePercent24h > 0
                      ? "#40c057"
                      : priceChangePercent24h < 0
                      ? "#ff6b6b"
                      : "#888",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 4,
                }}
              >
                {priceChangePercent24h > 0 ? (
                  <FaArrowUp />
                ) : priceChangePercent24h < 0 ? (
                  <FaArrowDown />
                ) : null}
                <span>
                  {priceChangePercent24h > 0 ? "+" : ""}
                  {priceChangePercent24h}% (24h)
                </span>
              </div>
            )}
          </div>
        </PanelSectionRow>
      </PanelSection>

      {/* Price History */}
      <PanelSection title={`Price History (${dynamics.length})`}>
        {isLoading ? (
          <PanelSectionRow>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Spinner />
              <span>Loading...</span>
            </div>
          </PanelSectionRow>
        ) : dynamics.length === 0 ? (
          <PanelSectionRow>
            <div style={{ padding: 8, color: "#888" }}>
              No price history available yet.
            </div>
          </PanelSectionRow>
        ) : (
          dynamics
            .slice()
            .reverse()
            .slice(0, 10)
            .map((entry, i) => (
              <PanelSectionRow key={i}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "6px 8px",
                    width: "100%",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <TrendIcon trend={entry.trend} />
                    <span style={{ color: "#ffd700", fontWeight: "bold" }}>
                      {formatPrice(entry.price, entry.currency)}
                    </span>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    {entry.changePercent !== undefined && (
                      <span
                        style={{
                          fontSize: 10,
                          color:
                            entry.changePercent > 0
                              ? "#40c057"
                              : entry.changePercent < 0
                              ? "#ff6b6b"
                              : "#888",
                          marginRight: 8,
                        }}
                      >
                        {entry.changePercent > 0 ? "+" : ""}
                        {entry.changePercent}%
                      </span>
                    )}
                    <span style={{ fontSize: 10, color: "#666" }}>
                      {formatTimeAgo(entry.timestamp)}
                    </span>
                  </div>
                </div>
              </PanelSectionRow>
            ))
        )}
      </PanelSection>

      {/* Modifiers Summary */}
      {(record.implicitMods.length > 0 ||
        record.explicitMods.length > 0 ||
        record.craftedMods.length > 0) && (
        <PanelSection title="Modifiers">
          <PanelSectionRow>
            <div style={{ padding: 8, fontSize: 10, color: "#aaa" }}>
              {record.implicitMods.map((mod, i) => (
                <div key={`imp-${i}`} style={{ color: "#88f", marginBottom: 2 }}>
                  {mod}
                </div>
              ))}
              {record.explicitMods.map((mod, i) => (
                <div key={`exp-${i}`} style={{ marginBottom: 2 }}>
                  {mod}
                </div>
              ))}
              {record.craftedMods.map((mod, i) => (
                <div key={`cra-${i}`} style={{ color: "#b8f", marginBottom: 2 }}>
                  {mod}
                </div>
              ))}
            </div>
          </PanelSectionRow>
        </PanelSection>
      )}
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

  // poe2scout result
  if (priceResult.source === "poe2scout" && priceResult.price) {
    const bestPrice = getBestPrice(priceResult.price);

    return (
      <PanelSection title="Price (poe2scout)">
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
// TIERED PRICE DISPLAY COMPONENT
// =========================================================================

interface TieredPriceDisplayProps {
  result: TieredSearchResult;
  item?: ParsedItem | null;
}

const TieredPriceDisplay: FC<TieredPriceDisplayProps> = ({ result, item }) => {
  const [expandedTiers, setExpandedTiers] = useState<Set<number>>(new Set([1]));

  // Helper to format indexed time
  const formatIndexedTime = (indexed: string): string => {
    try {
      const date = new Date(indexed);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMs / 3600000);
      const diffDays = Math.floor(diffMs / 86400000);

      if (diffMins < 1) return "now";
      if (diffMins < 60) return `${diffMins}m`;
      if (diffHours < 24) return `${diffHours}h`;
      return `${diffDays}d`;
    } catch {
      return "";
    }
  };

  // Calculate price stats for a tier
  const getTierStats = (tier: SearchTier) => {
    if (!tier.listings || tier.listings.length === 0) {
      return null;
    }

    const byCurrency: Record<string, number[]> = {};
    tier.listings.forEach((l) => {
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
    if (values.length === 0) return null;

    values.sort((a, b) => a - b);
    const min = values[0];
    const max = values[values.length - 1];
    const mid = Math.floor(values.length / 2);
    const median = values.length % 2 !== 0
      ? values[mid]
      : (values[mid - 1] + values[mid]) / 2;

    return { min, max, median, currency: dominant, count: values.length };
  };

  // Get tier color based on tier number
  const getTierColor = (tierNum: number) => {
    if (tierNum === 0) return "#40c057"; // Green - exact 100% match
    if (tierNum === 1) return "#ffd700"; // Gold - 80% match
    if (tierNum === 2) return "#4dabf7"; // Blue - core mods
    return "#868e96"; // Gray - base only
  };

  const getTierLabel = (tierNum: number) => {
    if (tierNum === 0) return "ТОЧНОЕ";
    if (tierNum === 1) return "ВАША ВЕЩЬ";
    if (tierNum === 2) return "ПОХОЖИЕ";
    return "БАЗА";
  };

  const toggleTier = (tierNum: number) => {
    const newExpanded = new Set(expandedTiers);
    if (newExpanded.has(tierNum)) {
      newExpanded.delete(tierNum);
    } else {
      newExpanded.add(tierNum);
    }
    setExpandedTiers(newExpanded);
  };

  // Find first tier with results for auto-expand
  useEffect(() => {
    const firstWithResults = result.tiers.find(t => t.total > 0);
    if (firstWithResults) {
      setExpandedTiers(new Set([firstWithResults.tier]));
    }
  }, [result]);

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

      {/* Tiered results */}
      {result.tiers.map((tier) => {
        const stats = getTierStats(tier);
        const tierColor = getTierColor(tier.tier);
        const isExpanded = expandedTiers.has(tier.tier);

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
                      {tier.total} listings
                    </div>
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
                        {listing.indexed && formatIndexedTime(listing.indexed)}
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

// =========================================================================
// MAIN PRICE CHECK CONTENT
// =========================================================================

const PriceCheckContent: FC = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parsedItem, setParsedItem] = useState<ParsedItem | null>(null);
  const [priceResult, setPriceResult] = useState<PriceResult | null>(null);
  const [tieredResult, setTieredResult] = useState<TieredSearchResult | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [selectedHistoryItem, setSelectedHistoryItem] = useState<ScanHistoryRecord | null>(null);
  const [cameFromCache, setCameFromCache] = useState(false);  // Track if showing cached result
  const [settingsDir, setSettingsDir] = useState<string>("");
  const [modifiers, setModifiers] = useState<ItemModifier[]>([]);
  const [autoChecked, setAutoChecked] = useState(false);
  const [settings, setSettings] = useState<PluginSettings>({ league: "Fate of the Vaal", useTradeApi: true, usePoe2Scout: true, autoCheckOnOpen: true, poesessid: "" });

  // Load settings and settingsDir on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const result = await call<[], PluginSettings>("get_settings");
        setSettings(result);
      } catch (e) {
        console.error("Failed to load settings:", e);
      }
    };
    const loadSettingsDir = async () => {
      try {
        const result = await call<[], { success: boolean; path: string }>("get_settings_dir");
        if (result.success) {
          setSettingsDir(result.path);
        }
      } catch (e) {
        console.error("Failed to load settings dir:", e);
      }
    };
    loadSettings();
    loadSettingsDir();
  }, []);


  /**
   * Progressive search - searches through tiers for best results
   */
  const progressiveSearch = useCallback(async (
    item: ParsedItem,
    mods: ItemModifier[]
  ) => {
    // Get enabled modifiers with priorities
    const enabledMods = mods.filter((m) => m.enabled);

    // Get stat IDs from backend for all enabled mods
    const modTexts = enabledMods.map((m) => m.text);
    const statIdsResult = await call<[string[]], { success: boolean; stat_ids: Record<string, string> }>(
      "get_stat_ids_for_mods",
      modTexts
    );

    // Build mod list with resolved stat IDs and priorities
    const modsWithIds = enabledMods
      .filter((m) => statIdsResult.stat_ids[m.text])
      .map((m) => ({
        id: statIdsResult.stat_ids[m.text],
        text: m.text,
        min: m.minValue,
        enabled: true,
        priority: getModifierPriority(m.text),
      }));

    // Call progressive_search
    const result = await call<
      [string | null, string | null, string, typeof modsWithIds, number | null],
      TieredSearchResult
    >(
      "progressive_search",
      item.rarity === "Unique" ? item.name : null,
      item.basetype,
      item.rarity,
      modsWithIds,
      item.itemLevel || null
    );

    setTieredResult(result);

    // Also save to price history and scan history if we have results
    if (result.success && result.tiers.length > 0) {
      const firstTierWithListings = result.tiers.find(t => t.listings && t.listings.length > 0);
      if (firstTierWithListings && firstTierWithListings.listings.length > 0) {
        // Group by currency
        const byCurrency: Record<string, number[]> = {};
        firstTierWithListings.listings.forEach((l) => {
          if (l.amount != null && l.amount > 0 && l.currency) {
            const curr = l.currency.toLowerCase();
            if (!byCurrency[curr]) byCurrency[curr] = [];
            byCurrency[curr].push(l.amount);
          }
        });

        // Find dominant currency
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
          const min = values[0];
          const max = values[values.length - 1];
          const mid = Math.floor(values.length / 2);
          const median = values.length % 2 !== 0
            ? values[mid]
            : (values[mid - 1] + values[mid]) / 2;

          // Save to price history (existing behavior)
          await call<[string, string, string, number, number, string], { success: boolean }>(
            "add_price_record",
            item.name,
            item.basetype,
            item.rarity,
            median,
            values.length,
            dominantCurrency
          );

          // Save to scan history (new feature)
          // Get icon from poe2scout (for uniques) or trade API (for rares)
          const iconUrl = result.poe2scout_price?.icon || result.trade_icon || null;
          try {
            await call<
              [
                string, string, string, string, number | null, number | null,
                boolean, string[], string[], string[],
                number, number, number, string, string,
                string | null, number, number
              ],
              { success: boolean; id: string }
            >(
              "add_scan_record",
              item.name,
              item.basetype,
              item.rarity,
              item.itemClass,
              item.itemLevel || null,
              item.quality || null,
              item.corrupted || false,
              item.implicitMods.map((m) => m.text),
              item.explicitMods.map((m) => m.text),
              item.craftedMods.map((m) => m.text),
              min,
              max,
              median,
              dominantCurrency,
              firstTierWithListings.tier <= 1 ? "trade" : "trade",
              iconUrl,
              result.stopped_at_tier,
              firstTierWithListings.listings.length
            );
          } catch (e) {
            console.error("Failed to save scan record:", e);
          }
        }
      }
    }
  }, []);

  /**
   * Read clipboard and parse item
   */
  const checkPrice = useCallback(async (forceSearch = false) => {
    setIsLoading(true);
    setError(null);
    setParsedItem(null);
    setPriceResult(null);
    setTieredResult(null);
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

      // Check if item is already in scan history (skip search if found)
      if (!forceSearch) {
        try {
          const historyResult = await call<[number | null], ScanHistoryResult>(
            "get_scan_history",
            100  // Load last 100 entries to search
          );
          if (historyResult.success && historyResult.records && historyResult.records.length > 0) {
            const itemKey = item.rarity === "Unique" ? item.name.toLowerCase() : item.basetype.toLowerCase();
            const cached = historyResult.records.find((h: ScanHistoryRecord) =>
              (h.rarity === "Unique" ? h.itemName.toLowerCase() === itemKey : h.basetype.toLowerCase() === itemKey)
            );
            if (cached) {
              // Show cached result - need to set showHistory to display the panel
              setSelectedHistoryItem(cached);
              setShowHistory(true);
              setCameFromCache(true);  // Mark that we came from cache check
              setIsLoading(false);
              return;
            }
          }
        } catch (e) {
          // If history check fails, continue with normal search
          console.log("History check failed, continuing with search:", e);
        }
      }

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

      // Use progressive search for tiered results
      await progressiveSearch(item, matchedMods);
    } catch (e) {
      setError(`Error: ${e}`);
    } finally {
      setIsLoading(false);
    }
  }, [progressiveSearch]);

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

      // Now check the clipboard - force new search since user manually triggered
      setIsLoading(false);
      await checkPrice(true);  // forceSearch = true for manual Copy & Check
    } catch (e) {
      setError(`Copy error: ${e}`);
      setIsLoading(false);
    }
  }, [checkPrice]);

  // Auto-check on mount - run once after initial render
  useEffect(() => {
    if (autoChecked) return;
    if (!settings.autoCheckOnOpen) return;

    // Mark as checked immediately to prevent re-runs
    setAutoChecked(true);

    // Delay to ensure all hooks are ready
    const timer = setTimeout(async () => {
      // Inline the checkPrice logic to avoid dependency issues
      try {
        const clipboardResult = await call<[], ClipboardResult>("read_clipboard");
        if (!clipboardResult.success || !clipboardResult.text) return;

        const item = parseItemText(clipboardResult.text);
        if (!item) return;

        // Check history first
        const historyResult = await call<[number | null], ScanHistoryResult>(
          "get_scan_history",
          100
        );
        if (historyResult.success && historyResult.records && historyResult.records.length > 0) {
          const itemKey = item.rarity === "Unique" ? item.name.toLowerCase() : item.basetype.toLowerCase();
          const cached = historyResult.records.find((h: ScanHistoryRecord) =>
            (h.rarity === "Unique" ? h.itemName.toLowerCase() === itemKey : h.basetype.toLowerCase() === itemKey)
          );
          if (cached) {
            setSelectedHistoryItem(cached);
            setShowHistory(true);
            setCameFromCache(true);
            return;
          }
        }

        // Not in cache - trigger manual check (user will need to click button)
        setParsedItem(item);
      } catch (e) {
        console.error("Auto-check failed:", e);
      }
    }, 500);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    setTieredResult(null);

    try {
      await progressiveSearch(parsedItem, modifiers);
    } catch (e) {
      setError(`Search error: ${e}`);
    } finally {
      setIsLoading(false);
    }
  }, [parsedItem, modifiers, progressiveSearch]);

  // History panels
  if (showHistory) {
    if (selectedHistoryItem) {
      // Different behavior if came from cache check vs history panel
      const handleBack = cameFromCache
        ? () => { setSelectedHistoryItem(null); setShowHistory(false); setCameFromCache(false); }
        : () => setSelectedHistoryItem(null);

      const handleRescan = cameFromCache
        ? () => { setSelectedHistoryItem(null); setShowHistory(false); setCameFromCache(false); checkPrice(true); }
        : undefined;

      return (
        <PriceDynamicsPanel
          record={selectedHistoryItem}
          onBack={handleBack}
          settingsDir={settingsDir}
          onRescan={handleRescan}
          backLabel={cameFromCache ? "Back to Main" : "Back to History"}
        />
      );
    }
    return (
      <HistoryPanel
        onBack={() => setShowHistory(false)}
        onSelectItem={(record) => { setSelectedHistoryItem(record); setCameFromCache(false); }}
        settingsDir={settingsDir}
      />
    );
  }

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
          <ButtonItem layout="below" onClick={() => checkPrice()} disabled={isLoading}>
            <FaClipboard style={{ marginRight: 8 }} />
            Check Clipboard Only
          </ButtonItem>
        </PanelSectionRow>

        <PanelSectionRow>
          <ButtonItem layout="below" onClick={() => setShowHistory(true)}>
            <FaHistory style={{ marginRight: 8 }} />
            Scan History
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
      {parsedItem && tieredResult && tieredResult.success && tieredResult.tiers.length > 0 && (
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
          {/* Price from best tier */}
          <div style={{
            fontSize: 20,
            fontWeight: "bold",
            color: "#ffd700",
            textShadow: "0 0 10px rgba(255,215,0,0.3)",
            textAlign: "center",
            marginBottom: 6,
          }}>
            {(() => {
              // Find first tier with listings
              const tierWithListings = tieredResult.tiers.find(t => t.listings && t.listings.length > 0);
              if (!tierWithListings) return "No price";

              const byCurrency: Record<string, number[]> = {};
              tierWithListings.listings.forEach((l) => {
                if (l.amount != null && l.amount > 0 && l.currency) {
                  const curr = l.currency.toLowerCase();
                  if (!byCurrency[curr]) byCurrency[curr] = [];
                  byCurrency[curr].push(l.amount);
                }
              });

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

          {/* Secondary info row - show tier info */}
          <div style={{
            display: "flex",
            justifyContent: "center",
            gap: 12,
            fontSize: 10,
            color: "#666"
          }}>
            <span>
              {tieredResult.tiers.length} tier{tieredResult.tiers.length > 1 ? "s" : ""} searched
            </span>
            <span>•</span>
            <span>
              {tieredResult.tiers.reduce((sum, t) => sum + t.total, 0)} total listings
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

      {/* Tiered Price Results */}
      {tieredResult && <TieredPriceDisplay result={tieredResult} item={parsedItem} />}
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
