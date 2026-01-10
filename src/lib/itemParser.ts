// src/lib/itemParser.ts - PoE2 item text parser

import { ParsedItem, ItemRarity, ItemModifier } from "./types";

const SECTION_SEPARATOR = "--------";

/**
 * Parse PoE2 item text from clipboard into structured data
 */
export function parseItemText(text: string): ParsedItem | null {
  if (!text || text.trim().length === 0) {
    return null;
  }

  const lines = text.trim().split("\n").map((l) => l.trim());
  const sections = splitIntoSections(lines);

  if (sections.length === 0) {
    return null;
  }

  // Initialize result
  const item: ParsedItem = {
    raw: text,
    itemClass: "",
    rarity: "Normal",
    name: "",
    basetype: "",
    implicitMods: [],
    explicitMods: [],
    craftedMods: [],
  };

  // Parse first section (contains rarity and name)
  parseHeaderSection(sections[0], item);

  // Track parsing state
  let foundItemLevel = false;

  // Parse remaining sections
  for (let i = 1; i < sections.length; i++) {
    const section = sections[i];
    const result = parseSection(section, item, foundItemLevel);
    if (result === "itemlevel") {
      foundItemLevel = true;
    }
  }

  // Calculate DPS for weapons
  calculateDPS(item);

  return item;
}

/**
 * Split item text into sections by separator
 */
function splitIntoSections(lines: string[]): string[][] {
  const sections: string[][] = [];
  let currentSection: string[] = [];

  for (const line of lines) {
    if (line === SECTION_SEPARATOR) {
      if (currentSection.length > 0) {
        sections.push(currentSection);
        currentSection = [];
      }
    } else if (line.length > 0) {
      currentSection.push(line);
    }
  }

  if (currentSection.length > 0) {
    sections.push(currentSection);
  }

  return sections;
}

/**
 * Parse the header section containing item class, rarity, name
 */
function parseHeaderSection(lines: string[], item: ParsedItem): void {
  for (const line of lines) {
    if (line.startsWith("Item Class:")) {
      item.itemClass = line.replace("Item Class:", "").trim();
    } else if (line.startsWith("Rarity:")) {
      const rarityText = line.replace("Rarity:", "").trim();
      item.rarity = parseRarity(rarityText);
    } else if (!line.includes(":")) {
      // Lines without colon are name/basetype
      if (!item.name) {
        item.name = line;
      } else if (!item.basetype) {
        item.basetype = line;
      }
    }
  }

  // For non-rare/unique items, name might be the basetype
  if (item.name && !item.basetype) {
    item.basetype = item.name;
    if (item.rarity === "Normal" || item.rarity === "Magic") {
      item.name = "";
    }
  }
}

/**
 * Parse a section of the item text
 */
function parseSection(
  lines: string[],
  item: ParsedItem,
  foundItemLevel: boolean
): string | void {
  const firstLine = lines[0];

  // Requirements section
  if (firstLine === "Requirements:") {
    parseRequirements(lines.slice(1), item);
    return;
  }

  // Item Level
  if (firstLine.startsWith("Item Level:")) {
    const match = firstLine.match(/Item Level:\s*(\d+)/);
    if (match) {
      item.itemLevel = parseInt(match[1]);
    }
    return "itemlevel";
  }

  // Quality
  if (firstLine.startsWith("Quality:")) {
    const match = firstLine.match(/Quality:\s*\+?(\d+)%/);
    if (match) {
      item.quality = parseInt(match[1]);
    }
    return;
  }

  // Sockets
  if (firstLine.startsWith("Sockets:")) {
    item.sockets = firstLine.replace("Sockets:", "").trim();
    parseSocketInfo(item.sockets, item);
    return;
  }

  // Stack Size (currency)
  if (firstLine.startsWith("Stack Size:")) {
    const match = firstLine.match(/Stack Size:\s*(\d+)\/(\d+)/);
    if (match) {
      item.stackSize = {
        current: parseInt(match[1]),
        max: parseInt(match[2]),
      };
    }
    return;
  }

  // Level (gems) - may have multiple lines with Level and Quality
  if (firstLine.startsWith("Level:") && item.rarity === "Gem") {
    const match = firstLine.match(/Level:\s*(\d+)/);
    if (match) {
      item.gemLevel = parseInt(match[1]);
    }
    // Check other lines in this section for Quality
    for (const line of lines) {
      const qualMatch = line.match(/Quality:\s*\+?(\d+)%/);
      if (qualMatch) {
        item.gemQuality = parseInt(qualMatch[1]);
      }
    }
    return;
  }

  // Check for special flags
  if (lines.length === 1) {
    if (firstLine === "Corrupted") {
      item.corrupted = true;
      return;
    }
    if (firstLine === "Mirrored") {
      item.mirrored = true;
      return;
    }
    if (firstLine === "Unidentified") {
      item.unidentified = true;
      return;
    }
  }

  // Check for properties (armour, evasion, damage, etc.)
  if (isPropertiesSection(lines)) {
    parseProperties(lines, item);
    return;
  }

  // Check if any line contains "(implicit)" marker
  const hasImplicitMarker = lines.some((line) => line.includes("(implicit)"));

  // Otherwise, treat as modifiers
  if (hasImplicitMarker) {
    // This section contains implicit mods (marked explicitly)
    parseModifiers(lines, item, "implicit");
    return "implicits";
  } else if (!foundItemLevel) {
    // Before item level section - likely properties, not modifiers
    // Skip these as they should have been caught by isPropertiesSection
    return;
  } else if (item.implicitMods.length === 0 && item.explicitMods.length === 0) {
    // First modifier section after item level
    // Check if it looks like implicits (usually short section, 1-3 mods)
    // In PoE2, implicits are often in a separate section right after item level
    // If all lines look like single mods without "(crafted)", treat as implicits
    const looksLikeImplicits =
      lines.length <= 3 &&
      lines.every((l) => !l.includes("(crafted)") && isModifierLine(l));

    if (looksLikeImplicits) {
      parseModifiers(lines, item, "implicit");
      return "implicits";
    } else {
      // Likely explicits (or item has no implicits)
      parseModifiers(lines, item, "explicit");
    }
  } else {
    // Subsequent modifier sections are explicit
    parseModifiers(lines, item, "explicit");
  }
}

/**
 * Check if a line looks like a modifier
 */
function isModifierLine(line: string): boolean {
  // Modifiers typically have numbers or specific patterns
  // Exclude flavor text (in quotes)
  if (line.startsWith('"') && line.endsWith('"')) {
    return false;
  }
  // Check for common modifier patterns
  return (
    /^[+-]?\d/.test(line) || // Starts with number
    /\+\d/.test(line) ||     // Contains +number
    /%/.test(line) ||        // Contains percentage
    /increased|reduced|more|less|adds/i.test(line) // Contains modifier keywords
  );
}

/**
 * Parse rarity string to enum
 */
function parseRarity(text: string): ItemRarity {
  const rarityMap: Record<string, ItemRarity> = {
    Normal: "Normal",
    Magic: "Magic",
    Rare: "Rare",
    Unique: "Unique",
    Currency: "Currency",
    Gem: "Gem",
    "Divination Card": "DivinationCard",
  };

  return rarityMap[text] || "Normal";
}

/**
 * Parse requirements section
 */
function parseRequirements(lines: string[], item: ParsedItem): void {
  for (const line of lines) {
    // Level: 62
    if (line.startsWith("Level:")) {
      const match = line.match(/Level:\s*(\d+)/);
      if (match) {
        item.levelRequired = parseInt(match[1]);
      }
    }
    // Str: 155 or Str (unmet): 155
    if (line.startsWith("Str")) {
      const match = line.match(/Str(?:\s*\(unmet\))?:\s*(\d+)/);
      if (match) {
        item.strRequired = parseInt(match[1]);
      }
    }
    // Dex: 100 or Dex (unmet): 100
    if (line.startsWith("Dex")) {
      const match = line.match(/Dex(?:\s*\(unmet\))?:\s*(\d+)/);
      if (match) {
        item.dexRequired = parseInt(match[1]);
      }
    }
    // Int: 100 or Int (unmet): 100
    if (line.startsWith("Int")) {
      const match = line.match(/Int(?:\s*\(unmet\))?:\s*(\d+)/);
      if (match) {
        item.intRequired = parseInt(match[1]);
      }
    }
  }
}

/**
 * Parse socket string into count and links
 */
function parseSocketInfo(sockets: string, item: ParsedItem): void {
  const socketGroups = sockets.split(" ");
  let totalCount = 0;
  let maxLinked = 0;

  for (const group of socketGroups) {
    const socketsInGroup = group.split("-");
    totalCount += socketsInGroup.length;
    maxLinked = Math.max(maxLinked, socketsInGroup.length);
  }

  item.socketCount = totalCount;
  item.linkedSockets = maxLinked;
}

/**
 * Check if section contains properties (not modifiers)
 */
function isPropertiesSection(lines: string[]): boolean {
  const propertyPatterns = [
    /^(Physical Damage|Elemental Damage|Chaos Damage):/,
    /^(Armour|Evasion Rating|Energy Shield):/,
    /^(Critical Hit Chance|Attacks per Second):/,
    /^(Weapon Range|Level|Mana Cost):/,
  ];

  return lines.some((line) =>
    propertyPatterns.some((pattern) => pattern.test(line))
  );
}

/**
 * Parse properties section
 */
function parseProperties(lines: string[], item: ParsedItem): void {
  for (const line of lines) {
    // Physical Damage: 45-89
    const physMatch = line.match(/Physical Damage:\s*(\d+)-(\d+)/);
    if (physMatch) {
      item.physicalDamage = {
        min: parseInt(physMatch[1]),
        max: parseInt(physMatch[2]),
      };
      continue;
    }

    // Elemental Damage: 45-89 (combined elemental shown on some items)
    const elemMatch = line.match(/Elemental Damage:\s*(\d+)-(\d+)/);
    if (elemMatch) {
      if (!item.elementalDamage) item.elementalDamage = [];
      item.elementalDamage.push({
        type: "elemental",
        min: parseInt(elemMatch[1]),
        max: parseInt(elemMatch[2]),
      });
      continue;
    }

    // Fire Damage: 10-20
    const fireMatch = line.match(/Fire Damage:\s*(\d+)-(\d+)/);
    if (fireMatch) {
      if (!item.elementalDamage) item.elementalDamage = [];
      item.elementalDamage.push({
        type: "fire",
        min: parseInt(fireMatch[1]),
        max: parseInt(fireMatch[2]),
      });
      continue;
    }

    // Cold Damage: 15-25
    const coldMatch = line.match(/Cold Damage:\s*(\d+)-(\d+)/);
    if (coldMatch) {
      if (!item.elementalDamage) item.elementalDamage = [];
      item.elementalDamage.push({
        type: "cold",
        min: parseInt(coldMatch[1]),
        max: parseInt(coldMatch[2]),
      });
      continue;
    }

    // Lightning Damage: 1-50
    const lightningMatch = line.match(/Lightning Damage:\s*(\d+)-(\d+)/);
    if (lightningMatch) {
      if (!item.elementalDamage) item.elementalDamage = [];
      item.elementalDamage.push({
        type: "lightning",
        min: parseInt(lightningMatch[1]),
        max: parseInt(lightningMatch[2]),
      });
      continue;
    }

    // Chaos Damage: 20-30
    const chaosMatch = line.match(/Chaos Damage:\s*(\d+)-(\d+)/);
    if (chaosMatch) {
      if (!item.elementalDamage) item.elementalDamage = [];
      item.elementalDamage.push({
        type: "chaos",
        min: parseInt(chaosMatch[1]),
        max: parseInt(chaosMatch[2]),
      });
      continue;
    }

    // Armour: 457
    const armourMatch = line.match(/Armour:\s*(\d+)/);
    if (armourMatch) {
      item.armour = parseInt(armourMatch[1]);
      continue;
    }

    // Evasion Rating: 727
    const evasionMatch = line.match(/Evasion Rating:\s*(\d+)/);
    if (evasionMatch) {
      item.evasion = parseInt(evasionMatch[1]);
      continue;
    }

    // Energy Shield: 89
    const esMatch = line.match(/Energy Shield:\s*(\d+)/);
    if (esMatch) {
      item.energyShield = parseInt(esMatch[1]);
      continue;
    }

    // Block: 15% or Chance to Block: 15%
    const blockMatch = line.match(/(?:Chance to )?Block:\s*(\d+)%/);
    if (blockMatch) {
      item.block = parseInt(blockMatch[1]);
      continue;
    }

    // Spirit: 100
    const spiritMatch = line.match(/Spirit:\s*(\d+)/);
    if (spiritMatch) {
      item.spirit = parseInt(spiritMatch[1]);
      continue;
    }

    // Attacks per Second: 1.45
    const apsMatch = line.match(/Attacks per Second:\s*([\d.]+)/);
    if (apsMatch) {
      item.attackSpeed = parseFloat(apsMatch[1]);
      continue;
    }

    // Critical Hit Chance: 6.5%
    const critMatch = line.match(/Critical Hit Chance:\s*([\d.]+)%/);
    if (critMatch) {
      item.criticalChance = parseFloat(critMatch[1]);
      continue;
    }

    // Weapon Range: 13
    const rangeMatch = line.match(/Weapon Range:\s*([\d.]+)/);
    if (rangeMatch) {
      item.weaponRange = parseFloat(rangeMatch[1]);
      continue;
    }
  }
}

/**
 * Parse modifiers section
 */
function parseModifiers(
  lines: string[],
  item: ParsedItem,
  defaultType: "implicit" | "explicit"
): void {
  for (const line of lines) {
    // Skip flavor text
    if (line.startsWith('"') && line.endsWith('"')) {
      continue;
    }

    // Check for crafted mod indicator
    const isCrafted = line.includes("(crafted)");
    const cleanLine = line.replace("(crafted)", "").trim();

    // Skip empty lines
    if (!cleanLine) {
      continue;
    }

    // Extract values from modifier text
    const values = extractModifierValues(cleanLine);

    const modifier: ItemModifier = {
      text: cleanLine,
      type: isCrafted ? "crafted" : defaultType,
      values: values,
      enabled: true,
    };

    // Store actual values (relaxation applied in backend)
    if (values.length > 0) {
      modifier.minValue = values[0];  // Actual value - backend will apply relaxation
      modifier.maxValue = undefined;  // No max by default
    }

    // Add to appropriate list
    if (isCrafted) {
      item.craftedMods.push(modifier);
    } else if (defaultType === "implicit") {
      item.implicitMods.push(modifier);
    } else {
      item.explicitMods.push(modifier);
    }
  }
}

/**
 * Extract numeric values from modifier text
 */
function extractModifierValues(text: string): number[] {
  const values: number[] = [];

  // Match patterns like: +83, -5, 9%, 45-89, (10-15)
  const patterns = [
    /([+-]?\d+(?:\.\d+)?)/g, // Simple numbers
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const value = parseFloat(match[1]);
      if (!isNaN(value)) {
        values.push(value);
      }
    }
  }

  return values;
}

/**
 * Calculate DPS for weapons (physical, elemental, and total)
 */
function calculateDPS(item: ParsedItem): void {
  if (!item.attackSpeed) {
    return;
  }

  // Calculate physical DPS
  let physDps = 0;
  if (item.physicalDamage) {
    const avgPhys = (item.physicalDamage.min + item.physicalDamage.max) / 2;
    physDps = avgPhys * item.attackSpeed;
    item.dps = Math.round(physDps * 10) / 10;
  }

  // Calculate elemental DPS (sum of all elemental damage types)
  let elemDps = 0;
  if (item.elementalDamage && item.elementalDamage.length > 0) {
    for (const elem of item.elementalDamage) {
      const avgElem = (elem.min + elem.max) / 2;
      elemDps += avgElem * item.attackSpeed;
    }
    item.elemDps = Math.round(elemDps * 10) / 10;
  }

  // Calculate total DPS
  if (physDps > 0 || elemDps > 0) {
    item.totalDps = Math.round((physDps + elemDps) * 10) / 10;
  }
}

/**
 * Determine the poe2scout category based on parsed item
 * Categories: weapon, armour, accessory, flask, jewel, map, sanctum, currency, etc.
 */
export function getPoe2ScoutCategory(item: ParsedItem): string | null {
  // Only use poe2scout for uniques and currency
  if (item.rarity === "Unique") {
    return getUniqueCategoryForPoe2Scout(item.itemClass);
  }

  if (item.rarity === "Currency" || item.itemClass === "Currency" ||
      item.itemClass === "Stackable Currency") {
    return "currency";
  }

  // poe2scout doesn't have good data for these yet
  // if (item.rarity === "DivinationCard" || item.itemClass === "Divination Cards") {
  //   return "divination";
  // }

  // if (item.rarity === "Gem" || item.itemClass.includes("Gem")) {
  //   return "uncutgems";
  // }

  return null;
}

/**
 * Get poe2scout category for unique items by item class
 * poe2scout categories: weapon, armour, accessory, flask, jewel, map, sanctum
 */
function getUniqueCategoryForPoe2Scout(itemClass: string): string {
  const classMap: Record<string, string> = {
    // Armour
    "Body Armours": "armour",
    Helmets: "armour",
    Gloves: "armour",
    Boots: "armour",
    Shields: "armour",

    // Weapons
    "One Hand Swords": "weapon",
    "Two Hand Swords": "weapon",
    "One Hand Axes": "weapon",
    "Two Hand Axes": "weapon",
    "One Hand Maces": "weapon",
    "Two Hand Maces": "weapon",
    Bows: "weapon",
    Crossbows: "weapon",
    Staves: "weapon",
    Wands: "weapon",
    Daggers: "weapon",
    Claws: "weapon",
    Sceptres: "weapon",
    Quarterstaves: "weapon",

    // Accessories
    Amulets: "accessory",
    Rings: "accessory",
    Belts: "accessory",

    // Other
    Jewels: "jewel",
    Flasks: "flask",
    Maps: "map",
  };

  return classMap[itemClass] || "armour";
}

/**
 * Get display name for item
 */
export function getItemDisplayName(item: ParsedItem): string {
  if (item.rarity === "Unique" && item.name) {
    return item.name;
  }
  if (item.rarity === "Rare" && item.name) {
    return `${item.name} (${item.basetype})`;
  }
  return item.basetype || item.name;
}

/**
 * Get all modifiers from item for filtering
 */
export function getAllModifiers(item: ParsedItem): ItemModifier[] {
  return [
    ...item.implicitMods,
    ...item.explicitMods,
    ...item.craftedMods,
  ];
}
