// src/components/ItemDisplay.tsx
// Item information display component

import { FC } from "react";
import {
  PanelSection,
  PanelSectionRow,
} from "@decky/ui";
import {
  FaSkull,
  FaGem,
  FaShieldAlt,
  FaBolt,
  FaFire,
  FaSnowflake,
  FaMagic,
} from "react-icons/fa";
import { ParsedItem } from "../lib/types";
import { getItemDisplayName } from "../lib/itemParser";
import { RARITY_COLORS } from "../styles/constants";

interface ItemDisplayProps {
  item: ParsedItem;
}

// Element icon component
const ElementIcon: FC<{ type: string }> = ({ type }) => {
  switch (type.toLowerCase()) {
    case "fire": return <FaFire style={{ color: "#ff6b35" }} />;
    case "cold": return <FaSnowflake style={{ color: "#6bc5ff" }} />;
    case "lightning": return <FaBolt style={{ color: "#ffd700" }} />;
    default: return <FaMagic style={{ color: "#b366ff" }} />;
  }
};

export const ItemDisplay: FC<ItemDisplayProps> = ({ item }) => {
  const rarityColor = RARITY_COLORS[item.rarity] || "#fff";

  // Format sockets display
  const formatSockets = () => {
    if (!item.sockets) return null;
    return item.sockets;
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

export default ItemDisplay;
