// src/components/ModifierFilterItem.tsx
// Compact modifier filter row component with tier evaluation

import { FC, useMemo } from "react";
import { ItemModifier } from "../lib/types";
import { MOD_TYPE_COLORS } from "../styles/constants";
import { TierBadge } from "./TierBadge";
import { evaluateModifier, ModifierEvaluation } from "../utils/itemEvaluator";
import { isTierDataLoaded, validateModifierText, ModifierValidation } from "../data/modifierTiers";

interface ModifierFilterProps {
  modifier: ItemModifier;
  index: number;
  onToggle: (index: number) => void;
  tierEval?: ModifierEvaluation;  // Pre-computed tier evaluation (optional)
  itemClass?: string;  // Item class for mod validation (optional)
}

export const ModifierFilterItem: FC<ModifierFilterProps> = ({
  modifier,
  index,
  onToggle,
  tierEval,
  itemClass,
}) => {
  const typeColor = MOD_TYPE_COLORS[modifier.type] || MOD_TYPE_COLORS.explicit;

  // Compute tier evaluation if not provided and tier data is loaded
  const evaluation = useMemo(() => {
    if (tierEval) return tierEval;
    if (!isTierDataLoaded()) return null;
    return evaluateModifier(modifier);
  }, [modifier, tierEval]);

  // Validate modifier against item class
  const validation = useMemo<ModifierValidation | null>(() => {
    if (!itemClass || !isTierDataLoaded()) return null;
    return validateModifierText(modifier.text, itemClass);
  }, [modifier.text, itemClass]);

  // Split text to highlight numeric values
  const parts = modifier.text.split(/(\+?-?\d+(?:\.\d+)?%?)/g);

  return (
    <div
      onClick={() => onToggle(index)}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        padding: "6px 10px",
        cursor: "pointer",
        background: modifier.enabled ? typeColor.bg : "transparent",
        borderLeft: `2px solid ${modifier.enabled ? typeColor.border : "transparent"}`,
        transition: "all 0.15s ease",
      }}
    >
      {/* Toggle checkbox */}
      <input
        type="checkbox"
        checked={modifier.enabled}
        onChange={(e) => {
          e.stopPropagation();
          onToggle(index);
        }}
        onClick={(e) => e.stopPropagation()}
        style={{
          marginTop: 2,
          width: 16,
          height: 16,
          accentColor: "#ffd700",
          cursor: "pointer",
          flexShrink: 0,
        }}
      />

      {/* Modifier content */}
      <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
        {/* Modifier text with highlighted values */}
        <span style={{
          fontSize: 11,
          color: modifier.enabled ? "#ddd" : "#666",
          wordBreak: "break-word",
          lineHeight: 1.4,
        }}>
          {parts.map((part, i) =>
            /\+?-?\d+(?:\.\d+)?%?/.test(part) ? (
              <span key={i} style={{ color: modifier.enabled ? "#ffd700" : "#997a00", fontWeight: "bold" }}>
                {part}
              </span>
            ) : (
              <span key={i}>{part}</span>
            )
          )}
        </span>
      </div>

      {/* Type badge + Tier on the right */}
      <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
        {/* Invalid mod warning */}
        {validation && !validation.isValid && (
          <span
            title={validation.warning || "This modifier may not appear on this item type"}
            style={{
              fontSize: 10,
              color: "#ff6b6b",
              cursor: "help",
            }}
          >
            ⚠
          </span>
        )}

        {/* Tier badge - from evaluation or fallback to modifier.tier */}
        {evaluation && evaluation.tier !== null ? (
          <TierBadge
            tier={evaluation.tier}
            totalTiers={evaluation.totalTiers}
            rollPercent={evaluation.rollPercent}
            compact
          />
        ) : modifier.tier ? (
          <span style={{ fontSize: 9, color: "#666" }}>
            T{modifier.tier}
          </span>
        ) : null}

        {/* Mod type badge */}
        <span style={{
          fontSize: 8,
          padding: "2px 4px",
          borderRadius: 3,
          backgroundColor: typeColor.bg,
          color: typeColor.text,
          textTransform: "uppercase",
          fontWeight: "bold",
        }}>
          {modifier.type.substring(0, 3)}
        </span>
      </div>
    </div>
  );
};

export default ModifierFilterItem;
