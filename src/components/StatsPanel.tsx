// src/components/StatsPanel.tsx
// Market insights and statistics panel

import { FC, useState, useEffect } from "react";
import { PanelSection, PanelSectionRow, Spinner } from "@decky/ui";
import { call } from "@decky/api";
import { FaChartLine, FaFire, FaTrophy, FaArrowLeft } from "react-icons/fa";
import {
  HotPattern,
  HotPatternsResult,
  PriceTrendsResult,
  QualityCorrelationResult
} from "../lib/types";

interface MarketInsights {
  success: boolean;
  error?: string;
  total_records: number;
  hot_mods?: Array<{
    category: string;
    avg_price: number;
    count: number;
  }>;
  item_class_stats?: Array<{
    item_class: string;
    avg_price: number;
    avg_quality: number;
    count: number;
  }>;
  top_items?: Array<{
    item_class: string;
    base_type: string;
    price: number;
    currency: string;
    quality: number;
  }>;
}

interface LearningStats {
  success: boolean;
  total_records: number;
  item_classes: number;
  classes: Record<string, {
    count: number;
    avg_price: number;
    median_price: number;
    min_price: number;
    max_price: number;
  }>;
}

interface StatsPanelProps {
  onBack: () => void;
}

// Tier distribution bar component
const TierDistributionBar: FC<{ distribution: Record<string, number> }> = ({ distribution }) => {
  const total = Object.values(distribution).reduce((a, b) => a + b, 0);
  if (total === 0) return null;

  const colors: Record<string, string> = {
    "T1": "#40c057",
    "T2": "#69db7c",
    "T3": "#fab005",
    "T4": "#fcc419",
    "T5+": "#868e96"
  };

  return (
    <div style={{ display: "flex", height: 4, borderRadius: 2, overflow: "hidden", marginTop: 4 }}>
      {Object.entries(distribution).map(([tier, count]) => (
        count > 0 && (
          <div
            key={tier}
            style={{
              width: `${(count / total) * 100}%`,
              background: colors[tier] || "#666",
            }}
            title={`${tier}: ${count}`}
          />
        )
      ))}
    </div>
  );
};

// Category icon helper
const getCategoryIcon = (category: string | null): string => {
  const icons: Record<string, string> = {
    life: "❤️",
    resistance: "🛡️",
    damage: "⚔️",
    critical: "💥",
    speed: "⚡",
    attribute: "💪",
    defence: "🔰",
    defense: "🔰",
    mana: "💧",
    accuracy: "🎯",
    gem: "💎",
    caster: "✨",
    attack: "🗡️",
    flask: "🧪",
  };
  return icons[category?.toLowerCase() || ""] || "📊";
};

export const StatsPanel: FC<StatsPanelProps> = ({ onBack }) => {
  const [insights, setInsights] = useState<MarketInsights | null>(null);
  const [learningStats, setLearningStats] = useState<LearningStats | null>(null);
  const [hotPatterns, setHotPatterns] = useState<HotPatternsResult | null>(null);
  const [priceTrends, setPriceTrends] = useState<PriceTrendsResult | null>(null);
  const [qualityCorrelation, setQualityCorrelation] = useState<QualityCorrelationResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmRefresh, setConfirmRefresh] = useState(false);

  useEffect(() => {
    loadStats();
  }, []);

  // Reset confirmation after 3 seconds
  useEffect(() => {
    if (confirmRefresh) {
      const timer = setTimeout(() => setConfirmRefresh(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [confirmRefresh]);

  const loadStats = async () => {
    setLoading(true);
    try {
      const [insightsResult, statsResult, patternsResult, trendsResult, correlationResult] = await Promise.all([
        call<[], MarketInsights>("get_market_insights"),
        call<[], LearningStats>("get_learning_stats"),
        call<[number], HotPatternsResult>("get_hot_patterns", 10),
        call<[number], PriceTrendsResult>("get_price_trends", 7),
        call<[], QualityCorrelationResult>("get_quality_correlation"),
      ]);
      setInsights(insightsResult);
      setLearningStats(statsResult);
      setHotPatterns(patternsResult);
      setPriceTrends(trendsResult);
      setQualityCorrelation(correlationResult);
    } catch (e) {
      console.error("Failed to load stats:", e);
    }
    setLoading(false);
  };

  // Category name formatting
  const formatCategory = (cat: string): string => {
    const names: Record<string, string> = {
      life: "❤️ Life",
      resistance: "🛡️ Resistance",
      damage: "⚔️ Damage",
      critical: "💥 Critical",
      speed: "⚡ Speed",
      attribute: "💪 Attributes",
      defense: "🔰 Defense",
      mana: "💧 Mana",
      accuracy: "🎯 Accuracy",
    };
    return names[cat] || cat.charAt(0).toUpperCase() + cat.slice(1);
  };

  if (loading) {
    return (
      <PanelSection title="Market Insights">
        <PanelSectionRow>
          <div style={{ display: "flex", justifyContent: "center", padding: 20 }}>
            <Spinner />
          </div>
        </PanelSectionRow>
      </PanelSection>
    );
  }

  return (
    <div style={{ padding: "0 16px" }}>
      {/* Header with back button */}
      <div
        onClick={onBack}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "12px 0",
          cursor: "pointer",
          color: "#ffd700",
        }}
      >
        <FaArrowLeft size={14} />
        <span style={{ fontSize: 14, fontWeight: "bold" }}>Market Insights</span>
      </div>

      {/* Stats summary */}
      <div style={{
        background: "rgba(255,255,255,0.05)",
        borderRadius: 8,
        padding: 12,
        marginBottom: 12,
      }}>
        <div style={{ fontSize: 11, color: "#888", marginBottom: 8 }}>
          <FaChartLine style={{ marginRight: 6 }} />
          Learning Data
        </div>
        <div style={{ display: "flex", justifyContent: "space-around" }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 20, fontWeight: "bold", color: "#ffd700" }}>
              {learningStats?.total_records || 0}
            </div>
            <div style={{ fontSize: 9, color: "#666" }}>Records</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 20, fontWeight: "bold", color: "#4dabf7" }}>
              {learningStats?.item_classes || 0}
            </div>
            <div style={{ fontSize: 9, color: "#666" }}>Item Types</div>
          </div>
        </div>
      </div>

      {/* Not enough data message */}
      {!insights?.success && (
        <div style={{
          background: "rgba(255,165,0,0.1)",
          border: "1px solid rgba(255,165,0,0.3)",
          borderRadius: 8,
          padding: 12,
          marginBottom: 12,
          textAlign: "center",
        }}>
          <div style={{ color: "#ffa500", fontSize: 12, marginBottom: 4 }}>
            {insights?.error || "Need more data"}
          </div>
          <div style={{ color: "#888", fontSize: 10 }}>
            Scan more items to build statistics
          </div>
        </div>
      )}

      {/* Hot Modifiers Section - Specific Patterns with Full Stats */}
      {hotPatterns?.success && hotPatterns.patterns && hotPatterns.patterns.length > 0 && (
        <div style={{
          background: "rgba(255,100,100,0.1)",
          border: "1px solid rgba(255,100,100,0.3)",
          borderRadius: 8,
          padding: 12,
          marginBottom: 12,
        }}>
          <div style={{
            fontSize: 11,
            color: "#ff6b6b",
            marginBottom: 8,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}>
            <FaFire />
            Hot Modifiers ({hotPatterns.total_patterns} total)
          </div>
          {hotPatterns.patterns.slice(0, 10).map((pat, i) => (
            <div
              key={pat.pattern}
              style={{
                padding: "6px 0",
                borderBottom: i < 9 ? "1px solid rgba(255,255,255,0.05)" : "none",
              }}
            >
              {/* Pattern name with category icon and price */}
              <div style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}>
                <span style={{ fontSize: 11, color: "#ddd" }}>
                  {getCategoryIcon(pat.category)} {pat.display_name}
                </span>
                <span style={{ fontSize: 12, color: "#ffd700", fontWeight: "bold" }}>
                  {pat.median_price}ex
                </span>
              </div>
              {/* Stats row: count, price range, avg tier */}
              <div style={{
                display: "flex",
                gap: 8,
                fontSize: 9,
                color: "#666",
                marginTop: 2,
              }}>
                <span>{pat.count}×</span>
                <span>{pat.min_price}-{pat.max_price}ex</span>
                {pat.avg_tier && <span>T{pat.avg_tier}</span>}
              </div>
              {/* Tier distribution bar */}
              <TierDistributionBar distribution={pat.tier_distribution} />
            </div>
          ))}
        </div>
      )}

      {/* Fallback: Legacy Hot Mod Categories (if no patterns available) */}
      {(!hotPatterns?.success || !hotPatterns.patterns?.length) && insights?.success && insights.hot_mods && insights.hot_mods.length > 0 && (
        <div style={{
          background: "rgba(255,100,100,0.1)",
          border: "1px solid rgba(255,100,100,0.3)",
          borderRadius: 8,
          padding: 12,
          marginBottom: 12,
        }}>
          <div style={{
            fontSize: 11,
            color: "#ff6b6b",
            marginBottom: 8,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}>
            <FaFire />
            Hot Mod Categories
          </div>
          {insights.hot_mods.slice(0, 5).map((mod, i) => (
            <div
              key={mod.category}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "4px 0",
                borderBottom: i < 4 ? "1px solid rgba(255,255,255,0.05)" : "none",
              }}
            >
              <span style={{ fontSize: 11, color: "#ddd" }}>
                {formatCategory(mod.category)}
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 10, color: "#666" }}>
                  {mod.count}×
                </span>
                <span style={{ fontSize: 12, color: "#ffd700", fontWeight: "bold" }}>
                  {mod.avg_price}ex
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Item Class Stats */}
      {insights?.success && insights.item_class_stats && insights.item_class_stats.length > 0 && (
        <div style={{
          background: "rgba(100,200,100,0.1)",
          border: "1px solid rgba(100,200,100,0.3)",
          borderRadius: 8,
          padding: 12,
          marginBottom: 12,
        }}>
          <div style={{
            fontSize: 11,
            color: "#69db7c",
            marginBottom: 8,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}>
            <FaTrophy />
            Item Class Prices
          </div>
          {insights.item_class_stats.slice(0, 5).map((cls, i) => (
            <div
              key={cls.item_class}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "4px 0",
                borderBottom: i < 4 ? "1px solid rgba(255,255,255,0.05)" : "none",
              }}
            >
              <span style={{ fontSize: 11, color: "#ddd" }}>
                {cls.item_class}
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 9, color: "#666" }}>
                  Q{cls.avg_quality}
                </span>
                <span style={{ fontSize: 12, color: "#ffd700", fontWeight: "bold" }}>
                  {cls.avg_price}ex
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Price Trends Section */}
      {priceTrends?.success && priceTrends.trends && priceTrends.trends.length > 0 && (
        <div style={{
          background: "rgba(75,192,192,0.1)",
          border: "1px solid rgba(75,192,192,0.3)",
          borderRadius: 8,
          padding: 12,
          marginBottom: 12,
        }}>
          <div style={{
            fontSize: 11,
            color: "#4bc0c0",
            marginBottom: 8,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}>
            <FaChartLine />
            Price Trends ({priceTrends.period_days}d)
          </div>
          {priceTrends.trends.slice(0, 5).map((trend, i) => (
            <div
              key={trend.item_class}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "4px 0",
                borderBottom: i < 4 ? "1px solid rgba(255,255,255,0.05)" : "none",
              }}
            >
              <span style={{ fontSize: 11, color: "#ddd" }}>
                {trend.item_class}
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{
                  fontSize: 10,
                  color: trend.trend === "up" ? "#40c057" : trend.trend === "down" ? "#ff6b6b" : "#888",
                  fontWeight: "bold",
                }}>
                  {trend.trend === "up" ? "▲" : trend.trend === "down" ? "▼" : "—"}
                  {Math.abs(trend.change_percent)}%
                </span>
                <span style={{ fontSize: 12, color: "#ffd700", fontWeight: "bold" }}>
                  {trend.current_median}ex
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Quality-Price Correlation Section */}
      {qualityCorrelation?.success && qualityCorrelation.correlations && qualityCorrelation.correlations.length > 0 && (
        <div style={{
          background: "rgba(153,102,255,0.1)",
          border: "1px solid rgba(153,102,255,0.3)",
          borderRadius: 8,
          padding: 12,
          marginBottom: 12,
        }}>
          <div style={{
            fontSize: 11,
            color: "#9966ff",
            marginBottom: 8,
          }}>
            Quality vs Price
          </div>
          {qualityCorrelation.correlations.slice(0, 5).map((corr, i) => (
            <div
              key={corr.item_class}
              style={{
                padding: "4px 0",
                borderBottom: i < 4 ? "1px solid rgba(255,255,255,0.05)" : "none",
              }}
            >
              <div style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}>
                <span style={{ fontSize: 11, color: "#ddd" }}>
                  {corr.item_class}
                </span>
                <span style={{
                  fontSize: 10,
                  color: corr.correlation > 0.5 ? "#40c057" :
                         corr.correlation < 0.2 ? "#868e96" : "#fab005",
                  fontWeight: "bold",
                }}>
                  r={corr.correlation}
                </span>
              </div>
              {/* Quality bucket prices */}
              <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
                {Object.entries(corr.bucket_medians).map(([bucket, median]) => (
                  <div key={bucket} style={{ flex: 1, textAlign: "center" }}>
                    <div style={{ fontSize: 8, color: "#666" }}>{bucket}</div>
                    <div style={{ fontSize: 9, color: "#ffd700" }}>{median}ex</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Top Items */}
      {insights?.success && insights.top_items && insights.top_items.length > 0 && (
        <div style={{
          background: "rgba(100,100,255,0.1)",
          border: "1px solid rgba(100,100,255,0.3)",
          borderRadius: 8,
          padding: 12,
          marginBottom: 12,
        }}>
          <div style={{
            fontSize: 11,
            color: "#748ffc",
            marginBottom: 8,
          }}>
            🏆 Top Scanned Items
          </div>
          {insights.top_items.map((item, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "4px 0",
                borderBottom: i < insights.top_items!.length - 1 ? "1px solid rgba(255,255,255,0.05)" : "none",
              }}
            >
              <div>
                <div style={{ fontSize: 11, color: "#ddd" }}>
                  {item.base_type}
                </div>
                <div style={{ fontSize: 9, color: "#666" }}>
                  {item.item_class} • Q{item.quality}
                </div>
              </div>
              <span style={{ fontSize: 14, color: "#ffd700", fontWeight: "bold" }}>
                {item.price} {item.currency?.toLowerCase() === "divine" ? "div" : item.currency?.toLowerCase() === "exalted" ? "ex" : item.currency || "ex"}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Refresh button with confirmation */}
      <div
        onClick={() => {
          if (confirmRefresh) {
            setConfirmRefresh(false);
            loadStats();
          } else {
            setConfirmRefresh(true);
          }
        }}
        style={{
          marginTop: 12,
          padding: "10px 16px",
          background: confirmRefresh ? "rgba(255,100,100,0.2)" : "rgba(255,215,0,0.15)",
          border: `1px solid ${confirmRefresh ? "rgba(255,100,100,0.4)" : "rgba(255,215,0,0.3)"}`,
          borderRadius: 8,
          textAlign: "center",
          cursor: "pointer",
          color: confirmRefresh ? "#ff6b6b" : "#ffd700",
          fontSize: 12,
        }}
      >
        {confirmRefresh ? "Tap again to confirm" : "Refresh Stats"}
      </div>
    </div>
  );
};

export default StatsPanel;
