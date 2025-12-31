// src/components/PriceDynamicsPanel.tsx
// Price dynamics panel for viewing item price history

import { FC, useState, useEffect } from "react";
import {
  PanelSection,
  PanelSectionRow,
  ButtonItem,
  Spinner,
} from "@decky/ui";
import { call } from "@decky/api";
import {
  FaArrowLeft,
  FaSync,
  FaArrowUp,
  FaArrowDown,
  FaMinus,
} from "react-icons/fa";
import { ScanHistoryRecord, PriceDynamicsResult, PriceDynamicsEntry } from "../lib/types";
import { formatPrice } from "../utils/modifierMatcher";
import { formatTimeAgo } from "../utils/formatting";
import { RARITY_COLORS, LOADING_CONTAINER } from "../styles/constants";

interface PriceDynamicsPanelProps {
  record: ScanHistoryRecord;
  onBack: () => void;
  settingsDir: string;
  onRescan?: () => void;  // Optional: show Rescan button when provided
  backLabel?: string;     // Optional: customize back button label
}

// Trend icon component
const TrendIcon: FC<{ trend?: string }> = ({ trend }) => {
  if (trend === "up") return <FaArrowUp style={{ color: "#40c057" }} />;
  if (trend === "down") return <FaArrowDown style={{ color: "#ff6b6b" }} />;
  return <FaMinus style={{ color: "#868e96" }} />;
};

export const PriceDynamicsPanel: FC<PriceDynamicsPanelProps> = ({
  record,
  onBack,
  onRescan,
  backLabel,
}) => {
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
            <div style={LOADING_CONTAINER}>
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

export default PriceDynamicsPanel;
