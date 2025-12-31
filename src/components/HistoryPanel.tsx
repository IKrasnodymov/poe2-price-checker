// src/components/HistoryPanel.tsx
// Scan history panel component

import { FC, useState, useEffect } from "react";
import {
  PanelSection,
  PanelSectionRow,
  ButtonItem,
  Spinner,
} from "@decky/ui";
import { call } from "@decky/api";
import { FaArrowLeft, FaTrash, FaCoins } from "react-icons/fa";
import { ScanHistoryRecord, ScanHistoryResult } from "../lib/types";
import { formatPrice } from "../utils/modifierMatcher";
import { formatTimeAgo } from "../utils/formatting";
import { RARITY_COLORS, LOADING_CONTAINER } from "../styles/constants";

interface HistoryPanelProps {
  onBack: () => void;
  onSelectItem: (record: ScanHistoryRecord) => void;
  settingsDir: string;
}

export const HistoryPanel: FC<HistoryPanelProps> = ({ onBack, onSelectItem }) => {
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

  const getRarityColor = (rarity: string): string => {
    return RARITY_COLORS[rarity] || "#fff";
  };

  if (isLoading) {
    return (
      <PanelSection title="Scan History">
        <PanelSectionRow>
          <div style={LOADING_CONTAINER}>
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

export default HistoryPanel;
