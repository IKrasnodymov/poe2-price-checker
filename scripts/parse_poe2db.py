#!/usr/bin/env python3
"""
Parser for poe2db.tw modifier data.
Extracts tier information for item modifiers and saves to JSON.

Usage:
    python3 scripts/parse_poe2db.py

Output:
    data/modifier_tiers.json
"""

import json
import re
import time
from pathlib import Path
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass, asdict, field
from datetime import datetime

try:
    import requests
    from bs4 import BeautifulSoup
except ImportError:
    print("Installing required packages...")
    import subprocess
    import sys
    subprocess.check_call([sys.executable, "-m", "pip", "install", "requests", "beautifulsoup4"])
    import requests
    from bs4 import BeautifulSoup


@dataclass
class ModifierTier:
    """Single tier of a modifier"""
    tier: int  # 1 = best (highest ilvl)
    name: str  # e.g., "of Tzteosh"
    ilvl: int  # Required item level
    min_value: float
    max_value: float


@dataclass
class Modifier:
    """Complete modifier with all tiers"""
    id: str  # e.g., "explicit.strength"
    name: str  # e.g., "Strength"
    text_pattern: str  # e.g., "+# to Strength"
    item_classes: List[str] = field(default_factory=list)
    tiers: List[Dict] = field(default_factory=list)  # List of tier dicts
    category: str = "other"
    is_prefix: bool = False
    tags: List[str] = field(default_factory=list)


# Item type pages to parse
ITEM_PAGES = {
    # Armor
    "Body Armour (Str)": "Body_Armours_str",
    "Body Armour (Dex)": "Body_Armours_dex",
    "Body Armour (Int)": "Body_Armours_int",
    "Body Armour (Str/Dex)": "Body_Armours_str_dex",
    "Body Armour (Str/Int)": "Body_Armours_str_int",
    "Body Armour (Dex/Int)": "Body_Armours_dex_int",
    "Helmet (Str)": "Helmets_str",
    "Helmet (Dex)": "Helmets_dex",
    "Helmet (Int)": "Helmets_int",
    "Gloves (Str)": "Gloves_str",
    "Gloves (Dex)": "Gloves_dex",
    "Gloves (Int)": "Gloves_int",
    "Boots (Str)": "Boots_str",
    "Boots (Dex)": "Boots_dex",
    "Boots (Int)": "Boots_int",
    # Accessories
    "Amulet": "Amulets",
    "Ring": "Rings",
    "Belt": "Belts",
    # Weapons
    "Claw": "Claws",
    "Dagger": "Daggers",
    "Wand": "Wands",
    "One Hand Sword": "One_Hand_Swords",
    "Two Hand Sword": "Two_Hand_Swords",
    "One Hand Axe": "One_Hand_Axes",
    "Two Hand Axe": "Two_Hand_Axes",
    "One Hand Mace": "One_Hand_Maces",
    "Two Hand Mace": "Two_Hand_Maces",
    "Sceptre": "Sceptres",
    "Spear": "Spears",
    "Flail": "Flails",
    "Bow": "Bows",
    "Staff": "Staves",
    "Crossbow": "Crossbows",
    # Off-hand
    "Quiver": "Quivers",
    "Shield (Str)": "Shields_str",
    "Shield (Dex)": "Shields_dex",
    "Shield (Int)": "Shields_int",
    "Focus": "Foci",
}

# Category detection patterns
CATEGORY_PATTERNS = {
    "life": ["life", "maximum life"],
    "mana": ["mana", "maximum mana"],
    "resistance": ["resistance", "resist"],
    "attribute": ["strength", "dexterity", "intelligence"],
    "defense": ["armour", "evasion", "energy shield", "ward"],
    "damage": ["damage", "adds"],
    "critical": ["critical"],
    "speed": ["speed", "attack speed", "cast speed", "movement speed"],
    "accuracy": ["accuracy"],
}


def detect_category(family_name: str, tags: List[str]) -> str:
    """Detect modifier category from family name and tags"""
    name_lower = family_name.lower()

    for category, patterns in CATEGORY_PATTERNS.items():
        for pattern in patterns:
            if pattern in name_lower:
                return category

    # Check tags
    for tag in tags:
        tag_lower = tag.lower()
        if "resist" in tag_lower:
            return "resistance"
        if "life" in tag_lower:
            return "life"
        if "damage" in tag_lower:
            return "damage"
        if "attribute" in tag_lower:
            return "attribute"
        if "defence" in tag_lower or "defense" in tag_lower:
            return "defense"
        if "speed" in tag_lower:
            return "speed"

    return "other"


def parse_value_range(html_str: str) -> Tuple[float, float, str]:
    """Parse value range from HTML string like '<span class='mod-value'>+(5—8)</span> to Strength'
    Returns (min_value, max_value, text_pattern)
    """
    # Remove HTML tags for cleaner parsing
    text = re.sub(r'<[^>]+>', '', html_str)
    text = text.strip()

    # Find value range: +(5—8), (15—26)%, etc.
    range_match = re.search(r'[+\-]?\(?\s*(\d+(?:\.\d+)?)\s*[—–-]\s*(\d+(?:\.\d+)?)\s*\)?', text)
    if range_match:
        min_val = float(range_match.group(1))
        max_val = float(range_match.group(2))
        # Create pattern by replacing range with #
        pattern = re.sub(r'[+\-]?\(?\s*\d+(?:\.\d+)?\s*[—–-]\s*\d+(?:\.\d+)?\s*\)?', '#', text)
        # Clean up pattern
        pattern = re.sub(r'\s+', ' ', pattern).strip()
        return min_val, max_val, pattern

    # Single value: +10, 15%
    single_match = re.search(r'[+\-]?(\d+(?:\.\d+)?)', text)
    if single_match:
        val = float(single_match.group(1))
        pattern = re.sub(r'[+\-]?\d+(?:\.\d+)?', '#', text, count=1)
        pattern = re.sub(r'\s+', ' ', pattern).strip()
        return val, val, pattern

    return 0, 0, text


def extract_tags(mod_no: List[str]) -> List[str]:
    """Extract tags from mod_no HTML badges"""
    tags = []
    for html in mod_no:
        # Extract data-tag attribute
        match = re.search(r'data-tag="([^"]+)"', html)
        if match:
            tags.append(match.group(1))
        else:
            # Fallback: extract text content
            text = re.sub(r'<[^>]+>', '', html).strip().lower()
            if text:
                tags.append(text)
    return tags


def fetch_page_json(page_slug: str, timeout: int = 60) -> Optional[Dict]:
    """Fetch page and extract ModsView JSON data"""
    url = f"https://poe2db.tw/us/{page_slug}"
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) PoE2-Price-Checker/1.0"
    }

    try:
        response = requests.get(url, headers=headers, timeout=timeout)
        response.raise_for_status()
        text = response.text

        # Find ModsView JSON
        idx = text.find('new ModsView(')
        if idx == -1:
            return None

        start = idx + len('new ModsView(')

        # Find matching closing brace
        depth = 0
        in_string = False
        escape_next = False
        end = -1

        for i in range(start, min(start + 1000000, len(text))):
            c = text[i]

            if escape_next:
                escape_next = False
                continue

            if c == '\\':
                escape_next = True
                continue

            if c == '"':
                in_string = not in_string
                continue

            if in_string:
                continue

            if c == '{':
                depth += 1
            elif c == '}':
                depth -= 1
                if depth == 0:
                    end = i + 1
                    break

        if end == -1:
            return None

        json_str = text[start:end]
        return json.loads(json_str)

    except Exception as e:
        print(f"  Error fetching {url}: {e}")
        return None


def parse_modifiers_from_json(data: Dict, item_class: str) -> List[Modifier]:
    """Parse modifiers from ModsView JSON data"""
    modifiers: Dict[str, Modifier] = {}  # key = family name

    # Get normal modifiers (base item mods)
    normal = data.get('normal', [])
    if not normal:
        return []

    # Group entries by ModFamilyList
    families: Dict[str, List[Dict]] = {}

    for entry in normal:
        family_list = entry.get('ModFamilyList', [])
        if not family_list:
            continue

        family_key = tuple(sorted(family_list))
        if family_key not in families:
            families[family_key] = []
        families[family_key].append(entry)

    # Process each family
    for family_key, entries in families.items():
        family_name = ', '.join(family_key)

        # Sort by Level (ilvl) to determine tier order
        entries.sort(key=lambda x: int(x.get('Level', '0')))

        # Determine if prefix or suffix (ModGenerationTypeID: 1=prefix, 2=suffix)
        gen_type = entries[0].get('ModGenerationTypeID', '2')
        is_prefix = gen_type == '1'

        # Extract tags from first entry
        mod_no = entries[0].get('mod_no', [])
        tags = extract_tags(mod_no)

        # Build tiers (reverse order so highest ilvl = T1)
        tiers = []
        total_tiers = len(entries)

        for i, entry in enumerate(reversed(entries)):
            tier_num = i + 1  # T1 = highest ilvl

            name = entry.get('Name', '')
            ilvl = int(entry.get('Level', '1'))
            str_html = entry.get('str', '')

            min_val, max_val, pattern = parse_value_range(str_html)

            tiers.append({
                'tier': tier_num,
                'name': name,
                'ilvl': ilvl,
                'min': min_val,
                'max': max_val
            })

        # Use pattern from best tier (T1)
        best_entry = entries[-1]  # Last entry has highest ilvl
        _, _, text_pattern = parse_value_range(best_entry.get('str', ''))

        # Detect category
        category = detect_category(family_name, tags)

        # Create modifier ID
        mod_id = f"explicit.{family_name.lower().replace(' ', '_').replace(',', '')}"

        modifier = Modifier(
            id=mod_id,
            name=family_name,
            text_pattern=text_pattern,
            item_classes=[item_class],
            tiers=tiers,
            category=category,
            is_prefix=is_prefix,
            tags=tags
        )

        modifiers[family_name] = modifier

    return list(modifiers.values())


def merge_modifiers(all_modifiers: List[Modifier]) -> List[Modifier]:
    """Merge modifiers that appear on multiple item types"""
    merged: Dict[str, Modifier] = {}

    for mod in all_modifiers:
        key = (mod.name, mod.is_prefix)

        if key in merged:
            existing = merged[key]
            for item_class in mod.item_classes:
                if item_class not in existing.item_classes:
                    existing.item_classes.append(item_class)
        else:
            merged[key] = mod

    return list(merged.values())


def main():
    """Main entry point"""
    print("PoE2DB Modifier Parser")
    print("=" * 50)

    all_modifiers = []

    # Parse each item type page
    for item_class, page_slug in ITEM_PAGES.items():
        print(f"Fetching {item_class}...")

        data = fetch_page_json(page_slug)
        if not data:
            print(f"  Failed to fetch data")
            continue

        modifiers = parse_modifiers_from_json(data, item_class)
        print(f"  Found {len(modifiers)} modifier families")

        all_modifiers.extend(modifiers)
        time.sleep(1.5)  # Rate limiting

    # Merge modifiers
    merged = merge_modifiers(all_modifiers)
    print(f"\nTotal unique modifiers: {len(merged)}")

    # Prepare output
    output = {
        "modifiers": [],
        "version": "0.1.0",
        "lastUpdated": datetime.now().isoformat(),
        "source": "poe2db.tw"
    }

    for mod in merged:
        output["modifiers"].append({
            "id": mod.id,
            "name": mod.name,
            "textPattern": mod.text_pattern,
            "itemClasses": mod.item_classes,
            "tiers": mod.tiers,
            "category": mod.category,
            "isPrefix": mod.is_prefix,
            "tags": mod.tags
        })

    # Save to file
    output_path = Path(__file__).parent.parent / "data" / "modifier_tiers.json"
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    print(f"\nSaved to {output_path}")

    # Print summary by category
    print("\nModifiers by category:")
    categories = {}
    for mod in merged:
        cat = mod.category
        categories[cat] = categories.get(cat, 0) + 1

    for cat, count in sorted(categories.items(), key=lambda x: -x[1]):
        print(f"  {cat}: {count}")

    # Show sample modifier
    if merged:
        print("\nSample modifier:")
        sample = merged[0]
        print(f"  Name: {sample.name}")
        print(f"  Pattern: {sample.text_pattern}")
        print(f"  Category: {sample.category}")
        print(f"  Prefix: {sample.is_prefix}")
        print(f"  Tiers: {len(sample.tiers)}")
        if sample.tiers:
            print(f"  T1: ilvl {sample.tiers[0]['ilvl']}, value {sample.tiers[0]['min']}-{sample.tiers[0]['max']}")


if __name__ == "__main__":
    main()
