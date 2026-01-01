// src/components/ActionMenu.tsx
// Collapsible action menu component

import { FC, useState } from "react";
import {
  FaBars,
  FaChevronDown,
  FaClipboardCheck,
  FaHistory,
  FaCog,
  FaChartLine,
} from "react-icons/fa";

interface ActionMenuProps {
  onPasteAndCheck: () => void;
  onShowHistory: () => void;
  onShowSettings: () => void;
  onShowStats: () => void;
  isLoading: boolean;
  isRateLimited?: boolean;
}

export const ActionMenu: FC<ActionMenuProps> = ({
  onPasteAndCheck,
  onShowHistory,
  onShowSettings,
  onShowStats,
  isLoading,
  isRateLimited = false,
}) => {
  const [expanded, setExpanded] = useState(false);
  const isDisabled = isLoading || isRateLimited;

  const handlePasteAndCheck = () => {
    if (isDisabled) return;
    setExpanded(false); // Collapse menu after action
    onPasteAndCheck();
  };

  return (
    <div style={{ margin: "8px 16px" }}>
      {/* Header - always visible */}
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          background: "linear-gradient(135deg, rgba(100,100,100,0.3) 0%, rgba(60,60,60,0.2) 100%)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: expanded ? "8px 8px 0 0" : 8,
          padding: "10px 12px",
          cursor: "pointer",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 8, color: "#ddd" }}>
          <FaBars />
          Menu
        </span>
        <span
          style={{
            transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.2s",
            color: "#888",
          }}
        >
          <FaChevronDown />
        </span>
      </div>

      {/* Expandable content */}
      {expanded && (
        <div
          style={{
            background: "rgba(30,30,30,0.9)",
            borderRadius: "0 0 8px 8px",
            padding: 8,
            border: "1px solid rgba(255,255,255,0.1)",
            borderTop: "none",
          }}
        >
          {/* Paste and Check - main action */}
          <div
            onClick={isDisabled ? undefined : handlePasteAndCheck}
            style={{
              padding: "10px 12px",
              borderRadius: 4,
              cursor: isDisabled ? "not-allowed" : "pointer",
              opacity: isDisabled ? 0.5 : 1,
              display: "flex",
              alignItems: "center",
              gap: 8,
              background: isRateLimited ? "rgba(255,100,100,0.1)" : "rgba(255,215,0,0.1)",
              marginBottom: 4,
            }}
          >
            <FaClipboardCheck style={{ color: isRateLimited ? "#ff6b6b" : "#ffd700" }} />
            <span style={{ color: "#fff" }}>Paste and Check</span>
          </div>

          {/* Scan History */}
          <div
            onClick={onShowHistory}
            style={{
              padding: "10px 12px",
              borderRadius: 4,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 4,
            }}
          >
            <FaHistory style={{ color: "#4dabf7" }} />
            <span style={{ color: "#ddd" }}>Scan History</span>
          </div>

          {/* Market Stats */}
          <div
            onClick={onShowStats}
            style={{
              padding: "10px 12px",
              borderRadius: 4,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 4,
            }}
          >
            <FaChartLine style={{ color: "#69db7c" }} />
            <span style={{ color: "#ddd" }}>Market Stats</span>
          </div>

          {/* Settings */}
          <div
            onClick={onShowSettings}
            style={{
              padding: "10px 12px",
              borderRadius: 4,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <FaCog style={{ color: "#868e96" }} />
            <span style={{ color: "#ddd" }}>Settings</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default ActionMenu;
