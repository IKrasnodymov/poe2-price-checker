// src/components/PriceCheckContent.tsx
// Main price check content component

import { FC, useState, useEffect, useCallback, useMemo } from "react";
import { Spinner } from "@decky/ui";
import { call } from "@decky/api";
import { FaExclamationTriangle, FaSync } from "react-icons/fa";

import {
  ParsedItem,
  PluginSettings,
  ClipboardResult,
  ItemModifier,
  TieredSearchResult,
  ScanHistoryRecord,
  ScanHistoryResult,
  ModPattern,
} from "../lib/types";
import { parseItemText, getAllModifiers } from "../lib/itemParser";
import { formatPrice, matchModifier, getModifierPriority, normalizeModifierText } from "../utils/modifierMatcher";
import { calculatePriceStats } from "../utils/formatting";
import { RARITY_COLORS, ERROR_CONTAINER } from "../styles/constants";

import { SettingsPanel } from "./SettingsPanel";
import { HistoryPanel } from "./HistoryPanel";
import { PriceDynamicsPanel } from "./PriceDynamicsPanel";
import { ItemDisplay } from "./ItemDisplay";
import { ActionMenu } from "./ActionMenu";
import { ModifierFilterItem } from "./ModifierFilterItem";
import { TieredPriceDisplay } from "./TieredPriceDisplay";
import { RatingBadge } from "./TierBadge";
import { StatsPanel } from "./StatsPanel";
import { loadModifierTierData, isTierDataLoaded, ModifierTierData } from "../data/modifierTiers";
import { evaluateItem, ItemEvaluation } from "../utils/itemEvaluator";

interface RateLimitStatus {
  rate_limited: boolean;
  remaining_seconds?: number;
  until?: string;
}

export const PriceCheckContent: FC = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parsedItem, setParsedItem] = useState<ParsedItem | null>(null);
  const [tieredResult, setTieredResult] = useState<TieredSearchResult | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [selectedHistoryItem, setSelectedHistoryItem] = useState<ScanHistoryRecord | null>(null);
  const [cameFromCache, setCameFromCache] = useState(false);
  const [settingsDir, setSettingsDir] = useState<string>("");
  const [modifiers, setModifiers] = useState<ItemModifier[]>([]);
  const [autoChecked, setAutoChecked] = useState(false);
  const [rateLimitStatus, setRateLimitStatus] = useState<RateLimitStatus | null>(null);
  const [settings, setSettings] = useState<PluginSettings>({
    league: "Fate of the Vaal",
    useTradeApi: true,
    usePoe2Scout: true,
    autoCheckOnOpen: true,
    poesessid: "",
  });

  // Load settings, settingsDir, and tier data on mount
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
    const loadTierData = async () => {
      try {
        if (!isTierDataLoaded()) {
          // Load tier data from backend
          const result = await call<[], { success: boolean; data?: ModifierTierData; error?: string }>(
            "get_modifier_tier_data"
          );
          if (result.success && result.data) {
            loadModifierTierData(result.data);
            console.log("Loaded modifier tier data:", result.data.modifiers?.length || 0, "modifiers");
          } else {
            console.warn("No tier data available:", result.error);
          }
        }
      } catch (e) {
        console.error("Failed to load tier data:", e);
      }
    };
    loadSettings();
    loadSettingsDir();
    loadTierData();
  }, []);

  // Check rate limit status periodically
  useEffect(() => {
    const checkRateLimit = async () => {
      try {
        const status = await call<[], RateLimitStatus>("get_rate_limit_status");
        setRateLimitStatus(status);
      } catch (e) {
        console.error("Failed to check rate limit:", e);
      }
    };
    checkRateLimit();
    const interval = setInterval(checkRateLimit, 5000); // Check every 5 seconds
    return () => clearInterval(interval);
  }, []);

  // Compute item evaluation when we have a parsed item
  const itemEvaluation = useMemo<ItemEvaluation | null>(() => {
    if (!parsedItem) return null;
    if (!isTierDataLoaded()) return null;
    // Only evaluate rare items (they have explicit mods that matter)
    if (parsedItem.rarity !== "Rare" && parsedItem.rarity !== "Magic") return null;
    return evaluateItem(parsedItem);
  }, [parsedItem]);

  /**
   * Progressive search - searches through tiers for best results
   */
  const progressiveSearch = useCallback(async (
    item: ParsedItem,
    mods: ItemModifier[]
  ) => {
    const enabledMods = mods.filter((m) => m.enabled);
    const modTexts = enabledMods.map((m) => m.text);
    const statIdsResult = await call<[string[]], { success: boolean; stat_ids: Record<string, string> }>(
      "get_stat_ids_for_mods",
      modTexts
    );

    const modsWithIds = enabledMods
      .filter((m) => statIdsResult.stat_ids[m.text])
      .map((m) => ({
        id: statIdsResult.stat_ids[m.text],
        text: m.text,
        min: m.minValue,
        enabled: true,
        priority: getModifierPriority(m.text),
      }));

    const result = await call<
      [string | null, string | null, string, typeof modsWithIds, number | null, number | null, number | null, number | null, number | null, number | null, number | null, number | null, number | null, number | null, number | null, number | null, number | null, number | null, boolean | null],
      TieredSearchResult
    >(
      "progressive_search",
      item.rarity === "Unique" ? item.name : null,
      item.basetype,
      item.rarity,
      modsWithIds,
      item.itemLevel || null,
      item.socketCount || null,
      item.linkedSockets || null,
      item.dps || null,           // pDPS
      item.elemDps || null,       // eDPS
      item.gemLevel || null,      // Gem level
      // New filters
      item.quality || null,       // Quality
      item.armour || null,        // Armour
      item.evasion || null,       // Evasion
      item.energyShield || null,  // Energy Shield
      item.block || null,         // Block
      item.spirit || null,        // Spirit
      item.attackSpeed || null,   // Attack Speed
      item.criticalChance || null,// Crit Chance
      item.corrupted || null      // Corrupted
    );

    setTieredResult(result);

    // Save to price and scan history if we have results
    if (result.success && result.tiers.length > 0) {
      const tierWithMostListings = result.tiers.reduce((best, tier) => {
        const tierCount = tier.listings?.length || 0;
        const bestCount = best?.listings?.length || 0;
        return tierCount > bestCount ? tier : best;
      }, result.tiers[0]);

      if (tierWithMostListings?.listings?.length > 0) {
        const stats = calculatePriceStats(tierWithMostListings.listings);
        if (stats) {
          await call<[string, string, string, number, number, string], { success: boolean }>(
            "add_price_record",
            item.name,
            item.basetype,
            item.rarity,
            stats.median,
            stats.count,
            stats.currency
          );

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
              stats.min,
              stats.max,
              stats.median,
              stats.currency,
              tierWithMostListings.tier <= 1 ? "trade" : "trade",
              iconUrl,
              result.stopped_at_tier,
              tierWithMostListings.listings.length
            );

            // Save price learning data for all scans to build statistics
            if (isTierDataLoaded()) {
              try {
                const itemEval = evaluateItem(item);

                // Extract detailed modifier patterns with tier info
                const modPatterns: ModPattern[] = itemEval.modifierBreakdown
                  .filter(m => m.category)
                  .map(m => {
                    // Extract primary numeric value from modifier text
                    const numMatch = m.text.match(/(\d+(?:\.\d+)?)/);
                    const value = numMatch ? parseFloat(numMatch[1]) : undefined;

                    return {
                      pattern: normalizeModifierText(m.text),
                      tier: m.tier,
                      category: m.category as string,
                      value: value,
                    };
                  });

                // Keep legacy categories for backwards compatibility
                const modCategories = modPatterns.map(m => m.category);

                await call<
                  [string, string, number, string[], ModPattern[], number, string, number],
                  { success: boolean }
                >(
                  "add_price_learning_record",
                  item.itemClass,
                  item.basetype,
                  itemEval.overallScore,
                  modCategories,
                  modPatterns,
                  stats.median,
                  stats.currency,
                  result.stopped_at_tier
                );
              } catch (e) {
                console.error("Failed to save price learning:", e);
              }
            }
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
    setTieredResult(null);
    setModifiers([]);

    try {
      const clipboardResult = await call<[], ClipboardResult>("read_clipboard");

      if (!clipboardResult.success) {
        setError(clipboardResult.error || "Failed to read clipboard");
        setIsLoading(false);
        return;
      }

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
            100
          );
          if (historyResult.success && historyResult.records?.length > 0) {
            const itemKey = item.rarity === "Unique" ? item.name.toLowerCase() : item.basetype.toLowerCase();
            const cached = historyResult.records.find((h: ScanHistoryRecord) =>
              (h.rarity === "Unique" ? h.itemName.toLowerCase() === itemKey : h.basetype.toLowerCase() === itemKey)
            );
            if (cached) {
              setSelectedHistoryItem(cached);
              setShowHistory(true);
              setCameFromCache(true);
              setIsLoading(false);
              return;
            }
          }
        } catch (e) {
          console.log("History check failed, continuing with search:", e);
        }
      }

      const allMods = getAllModifiers(item);
      const matchedMods = allMods.map((mod) => {
        const match = matchModifier(mod.text);
        return {
          ...mod,
          tradeId: match.tradeId || undefined,
        };
      });
      setModifiers(matchedMods);

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
      const copyResult = await call<[], { success: boolean; method?: string; error?: string }>(
        "simulate_copy"
      );

      if (!copyResult.success) {
        setError(copyResult.error || "Failed to simulate Ctrl+C. Make sure cursor is on an item.");
        setIsLoading(false);
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 100));
      setIsLoading(false);
      await checkPrice(true);
    } catch (e) {
      setError(`Copy error: ${e}`);
      setIsLoading(false);
    }
  }, [checkPrice]);

  // Auto-check on mount
  useEffect(() => {
    if (autoChecked) return;
    if (!settings.autoCheckOnOpen) return;

    setAutoChecked(true);

    const timer = setTimeout(async () => {
      try {
        const clipboardResult = await call<[], ClipboardResult>("read_clipboard");
        if (!clipboardResult.success || !clipboardResult.text) return;

        const item = parseItemText(clipboardResult.text);
        if (!item) return;

        const historyResult = await call<[number | null], ScanHistoryResult>(
          "get_scan_history",
          100
        );
        if (historyResult.success && historyResult.records?.length > 0) {
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

        setParsedItem(item);
      } catch (e) {
        console.error("Auto-check failed:", e);
      }
    }, 500);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleModifier = (index: number) => {
    const newMods = [...modifiers];
    newMods[index] = { ...newMods[index], enabled: !newMods[index].enabled };
    setModifiers(newMods);
  };

  const reSearch = useCallback(async () => {
    if (!parsedItem) return;

    setIsLoading(true);
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

  // Stats panel
  if (showStats) {
    return <StatsPanel onBack={() => setShowStats(false)} />;
  }

  // Settings panel
  if (showSettings) {
    return <SettingsPanel onBack={() => setShowSettings(false)} />;
  }

  return (
    <>
      {/* Quick Price Summary */}
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
          <div style={{
            fontSize: 20,
            fontWeight: "bold",
            color: "#ffd700",
            textShadow: "0 0 10px rgba(255,215,0,0.3)",
            textAlign: "center",
            marginBottom: 6,
          }}>
            {(() => {
              const tierWithListings = tieredResult.tiers.find(t => t.listings && t.listings.length > 0);
              if (!tierWithListings) return "No price";

              const stats = calculatePriceStats(tierWithListings.listings);
              if (stats) {
                if (stats.min === stats.max) {
                  return formatPrice(stats.min, stats.currency);
                }
                return `${formatPrice(stats.min, stats.currency)} — ${formatPrice(stats.max, stats.currency)}`;
              }
              return "No price";
            })()}
          </div>

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

          <div style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
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
            {/* Item quality indicator */}
            {itemEvaluation && (
              <>
                <span>•</span>
                <RatingBadge rating={itemEvaluation.rating} score={itemEvaluation.overallScore} />
              </>
            )}
          </div>
        </div>
      )}

      <ActionMenu
        onPasteAndCheck={copyAndCheck}
        onShowHistory={() => setShowHistory(true)}
        onShowSettings={() => setShowSettings(true)}
        onShowStats={() => setShowStats(true)}
        isLoading={isLoading}
        isRateLimited={rateLimitStatus?.rate_limited}
      />

      {/* Rate Limit Warning */}
      {rateLimitStatus?.rate_limited && (
        <div style={{
          background: "rgba(255, 100, 100, 0.15)",
          border: "1px solid rgba(255, 100, 100, 0.4)",
          borderRadius: 8,
          padding: "10px 12px",
          margin: "8px 16px",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}>
          <span style={{ fontSize: 18 }}>⏳</span>
          <div>
            <div style={{ color: "#ff6b6b", fontSize: 12, fontWeight: "bold" }}>
              Rate Limited
            </div>
            <div style={{ color: "#aaa", fontSize: 11 }}>
              Trade API blocked. Try again at {rateLimitStatus.until}
            </div>
          </div>
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div style={ERROR_CONTAINER}>
          <FaExclamationTriangle style={{ marginTop: 2, flexShrink: 0, color: "#ff6b6b" }} />
          <span style={{ color: "#ff6b6b", fontSize: 12 }}>{error}</span>
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

      {parsedItem && <ItemDisplay item={parsedItem} />}

      {/* Quick Search Button */}
      {parsedItem && !tieredResult && !isLoading && modifiers.length === 0 && (
        <div
          onClick={() => checkPrice(true)}
          style={{
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
          }}
        >
          <FaSync style={{ color: "#ffd700", fontSize: 14 }} />
          <span style={{ color: "#ffd700", fontWeight: "bold", fontSize: 14 }}>
            Find Price
          </span>
        </div>
      )}

      {/* Modifier Filters */}
      {modifiers.length > 0 && (
        <div style={{ margin: "8px 16px" }}>
          <div style={{
            background: "linear-gradient(135deg, rgba(100,100,100,0.3) 0%, rgba(60,60,60,0.2) 100%)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: "8px 8px 0 0",
            padding: "8px 12px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}>
            <span style={{ color: "#ddd", fontSize: 12 }}>
              Modifiers ({modifiers.filter(m => m.enabled).length}/{modifiers.length})
            </span>
            <div style={{ display: "flex", gap: 8 }}>
              <span
                onClick={() => setModifiers(modifiers.map(m => ({ ...m, enabled: true })))}
                style={{
                  fontSize: 10,
                  color: "#4dabf7",
                  cursor: "pointer",
                  padding: "2px 6px",
                  borderRadius: 3,
                  background: "rgba(77,171,247,0.1)",
                }}
              >
                All
              </span>
              <span
                onClick={() => setModifiers(modifiers.map(m => ({ ...m, enabled: false })))}
                style={{
                  fontSize: 10,
                  color: "#868e96",
                  cursor: "pointer",
                  padding: "2px 6px",
                  borderRadius: 3,
                  background: "rgba(134,142,150,0.1)",
                }}
              >
                Reset
              </span>
            </div>
          </div>

          <div style={{
            background: "rgba(30,30,30,0.9)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderTop: "none",
            maxHeight: 200,
            overflowY: "auto",
          }}>
            {(() => {
              const modifierIndex = new Map(modifiers.map((m, i) => [m, i]));
              const implicits = modifiers.filter(m => m.type === "implicit");
              const explicits = modifiers.filter(m => m.type === "explicit");
              const crafted = modifiers.filter(m => m.type === "crafted");

              return (
                <>
                  {implicits.map((mod) => (
                    <ModifierFilterItem
                      key={modifierIndex.get(mod)!}
                      modifier={mod}
                      index={modifierIndex.get(mod)!}
                      onToggle={toggleModifier}
                    />
                  ))}
                  {implicits.length > 0 && explicits.length > 0 && (
                    <div style={{ borderTop: "1px solid rgba(255,255,255,0.05)", margin: "0" }} />
                  )}
                  {explicits.map((mod) => (
                    <ModifierFilterItem
                      key={modifierIndex.get(mod)!}
                      modifier={mod}
                      index={modifierIndex.get(mod)!}
                      onToggle={toggleModifier}
                    />
                  ))}
                  {crafted.length > 0 && (
                    <div style={{ borderTop: "1px solid rgba(255,255,255,0.05)", margin: "0" }} />
                  )}
                  {crafted.map((mod) => (
                    <ModifierFilterItem
                      key={modifierIndex.get(mod)!}
                      modifier={mod}
                      index={modifierIndex.get(mod)!}
                      onToggle={toggleModifier}
                    />
                  ))}
                </>
              );
            })()}
          </div>

          <div
            onClick={(isLoading || rateLimitStatus?.rate_limited) ? undefined : reSearch}
            style={{
              background: rateLimitStatus?.rate_limited
                ? "linear-gradient(135deg, rgba(255,100,100,0.2) 0%, rgba(255,80,80,0.1) 100%)"
                : "linear-gradient(135deg, rgba(255,215,0,0.2) 0%, rgba(255,180,0,0.1) 100%)",
              border: `1px solid ${rateLimitStatus?.rate_limited ? "rgba(255,100,100,0.3)" : "rgba(255,215,0,0.3)"}`,
              borderTop: "none",
              borderRadius: "0 0 8px 8px",
              padding: "10px 12px",
              cursor: (isLoading || rateLimitStatus?.rate_limited) ? "not-allowed" : "pointer",
              opacity: (isLoading || rateLimitStatus?.rate_limited) ? 0.5 : 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
            }}
          >
            <FaSync style={{ color: rateLimitStatus?.rate_limited ? "#ff6b6b" : "#ffd700" }} />
            <span style={{ color: rateLimitStatus?.rate_limited ? "#ff6b6b" : "#ffd700", fontWeight: "bold", fontSize: 12 }}>
              {rateLimitStatus?.rate_limited ? "Rate Limited" : `Search (${modifiers.filter(m => m.enabled).length} filters)`}
            </span>
          </div>
        </div>
      )}

      {tieredResult && <TieredPriceDisplay result={tieredResult} item={parsedItem} itemEvaluation={itemEvaluation} />}
    </>
  );
};

export default PriceCheckContent;
