// src/components/StatsPanel.tsx
// Market insights and statistics panel

import { FC, useState, useEffect } from "react";
import { PanelSection, PanelSectionRow, Spinner } from "@decky/ui";
import { call } from "@decky/api";
import { FaChartLine, FaFire, FaTrophy, FaArrowLeft } from "react-icons/fa";

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
    min_price: number;
    max_price: number;
  }>;
}

interface StatsPanelProps {
  onBack: () => void;
}

export const StatsPanel: FC<StatsPanelProps> = ({ onBack }) => {
  const [insights, setInsights] = useState<MarketInsights | null>(null);
  const [learningStats, setLearningStats] = useState<LearningStats | null>(null);
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
      const [insightsResult, statsResult] = await Promise.all([
        call<[], MarketInsights>("get_market_insights"),
        call<[], LearningStats>("get_learning_stats"),
      ]);
      setInsights(insightsResult);
      setLearningStats(statsResult);
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
            Scan more items with exact matches (Tier 0-1) to build statistics
          </div>
        </div>
      )}

      {/* Hot Mods Section */}
      {insights?.success && insights.hot_mods && insights.hot_mods.length > 0 && (
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

      {/* Top Items */}
      {insights?.success && insights.top_items && insights.top_items.length > 0 && (
        <div style={{
          background: "rgba(100,100,255,0.1)",
          border: "1px solid rgba(100,100,255,0.3)",
          borderRadius: 8,
          padding: 12,
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
