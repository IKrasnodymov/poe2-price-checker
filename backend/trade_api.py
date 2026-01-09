# backend/trade_api.py
# Trade API client for PoE2 official trade site
#
# NOTE: This module is designed for use within Decky Loader.
# The `decky` module must be imported inside methods, not at module level.

import json
import ssl
import time
import urllib.request
import urllib.error
import urllib.parse
from typing import Optional, Dict, Any, List, Tuple

from .rate_limiter import AdaptiveRateLimiter


class TradeAPIClient:
    """
    Client for the official PoE2 Trade API.

    Handles:
    - Search queries with progressive relaxation
    - Listing fetches with batch processing
    - Rate limiting with adaptive backoff
    - Stat ID resolution and caching
    """

    # Trade API endpoints
    BASE_URL = "https://www.pathofexile.com/api/trade2"

    # Modifier priority tiers for search optimization
    PRIORITY_PATTERNS = {
        # Tier 1 (90-100): Most valuable mods
        "all elemental resistances": 100,
        "+#% to all elemental resistances": 100,
        "maximum life": 95,
        "increased maximum life": 95,
        "movement speed": 92,
        "to maximum life": 90,

        # Tier 2 (80-89): Very valuable
        "critical strike multiplier": 88,
        "global critical strike multiplier": 88,
        "level of all": 85,
        "+# to level of all": 85,
        "adds # to # physical damage": 82,
        "to maximum mana": 80,

        # Tier 3 (65-79): Good mods
        "to fire resistance": 78,
        "to cold resistance": 78,
        "to lightning resistance": 78,
        "to chaos resistance": 75,
        "attack speed": 72,
        "increased attack speed": 72,
        "cast speed": 70,
        "critical strike chance": 68,
        "increased critical strike chance": 68,

        # Tier 4 (50-64): Decent mods
        "adds # to # fire damage": 62,
        "adds # to # cold damage": 62,
        "adds # to # lightning damage": 62,
        "to strength": 55,
        "to dexterity": 55,
        "to intelligence": 55,
        "to all attributes": 60,
        "increased mana": 52,
        "mana regeneration": 50,

        # Tier 5 (30-49): Lower priority
        "to armour": 45,
        "to evasion": 45,
        "to energy shield": 48,
        "increased armour": 42,
        "increased evasion": 42,
        "accuracy": 35,
        "increased accuracy": 35,
        "block": 38,
        "stun": 32,
    }

    def __init__(
        self,
        search_limiter: AdaptiveRateLimiter,
        fetch_limiter: AdaptiveRateLimiter,
        ssl_context: ssl.SSLContext,
        league: str = "Standard",
        poesessid: str = ""
    ):
        self.search_limiter = search_limiter
        self.fetch_limiter = fetch_limiter
        self.ssl_context = ssl_context
        self.league = league
        self.poesessid = poesessid

        # Stat ID cache: normalized text -> stat ID
        self.stat_cache: Dict[str, str] = {}

        # Debug: last fetched listings
        self.last_debug_listings: List[Dict[str, Any]] = []

    def set_league(self, league: str) -> None:
        """Update the current league"""
        self.league = league

    def set_poesessid(self, poesessid: str) -> None:
        """Update the POESESSID (for authenticated requests)"""
        self.poesessid = poesessid

    # =========================================================================
    # STAT ID MANAGEMENT
    # =========================================================================

    def normalize_modifier_text(self, text: str) -> str:
        """Normalize modifier text for matching"""
        import re
        normalized = text.lower().strip()
        normalized = re.sub(r'[+\-]?\d+(?:\.\d+)?%?', '#', normalized)
        normalized = re.sub(r'\s+', ' ', normalized)
        return normalized

    def find_stat_id(self, modifier_text: str) -> Optional[str]:
        """Find stat ID for a modifier text"""
        if not self.stat_cache:
            return None

        normalized = self.normalize_modifier_text(modifier_text)

        # Try exact match
        if normalized in self.stat_cache:
            return self.stat_cache[normalized]

        # Try partial match
        for pattern, stat_id in self.stat_cache.items():
            if pattern in normalized or normalized in pattern:
                return stat_id

        return None

    def score_modifier_priority(self, modifier_text: str) -> int:
        """
        Score a modifier's priority for tiered searches.
        Higher score = higher priority = searched first.
        """
        text_lower = modifier_text.lower()

        for pattern, score in self.PRIORITY_PATTERNS.items():
            if pattern in text_lower:
                return score

        # Default score for unknown mods
        return 25

    async def load_stat_ids_from_api(self) -> bool:
        """Load stat IDs from Trade API"""
        import decky

        url = f"{self.BASE_URL}/data/stats"

        try:
            req = urllib.request.Request(
                url,
                headers={
                    "User-Agent": "PoE2-Price-Checker-Decky/1.0",
                    "Accept": "application/json"
                }
            )

            with urllib.request.urlopen(req, timeout=15, context=self.ssl_context) as response:
                data = json.loads(response.read().decode())

                for group in data.get("result", []):
                    for entry in group.get("entries", []):
                        stat_id = entry.get("id")
                        stat_text = entry.get("text", "")

                        if stat_id and stat_text:
                            normalized = self.normalize_modifier_text(stat_text)
                            self.stat_cache[normalized] = stat_id

                decky.logger.info(f"Loaded {len(self.stat_cache)} stat IDs from API")
                return True

        except Exception as e:
            decky.logger.error(f"Failed to load stat IDs: {e}")
            return False

    def get_stat_ids_for_mods(self, modifiers: List[str]) -> Dict[str, Optional[str]]:
        """Get stat IDs for a list of modifier texts"""
        result = {}
        for mod_text in modifiers:
            result[mod_text] = self.find_stat_id(mod_text)
        return result

    # =========================================================================
    # SEARCH API
    # =========================================================================

    async def search(self, query: Dict[str, Any]) -> Dict[str, Any]:
        """
        Execute a search query against the Trade API.

        Returns:
            {success: bool, id?: str, total?: int, result?: List[str], error?: str}
        """
        import decky

        url = f"{self.BASE_URL}/search/poe2/{urllib.parse.quote(self.league)}"

        try:
            await self.search_limiter.wait()

            req_data = json.dumps(query).encode("utf-8")
            req = urllib.request.Request(
                url,
                data=req_data,
                headers={
                    "User-Agent": "PoE2-Price-Checker-Decky/1.0",
                    "Content-Type": "application/json",
                    "Accept": "application/json"
                },
                method="POST"
            )

            if self.poesessid:
                req.add_header("Cookie", f"POESESSID={self.poesessid}")

            with urllib.request.urlopen(req, timeout=15, context=self.ssl_context) as response:
                headers = {k: v for k, v in response.headers.items()}
                self.search_limiter.parse_headers(headers)
                self.search_limiter.handle_success()

                result = json.loads(response.read().decode())
                return {
                    "success": True,
                    "id": result.get("id"),
                    "total": result.get("total", 0),
                    "result": result.get("result", [])
                }

        except urllib.error.HTTPError as e:
            if e.code == 429:
                retry_after = None
                try:
                    retry_after = int(e.headers.get('Retry-After', 0))
                except (ValueError, TypeError):
                    pass
                wait_time = self.search_limiter.handle_429(retry_after)
                decky.logger.warning(f"Rate limited, waiting {wait_time:.1f}s")
                return {"success": False, "error": f"Rate limited ({wait_time:.0f}s)", "rate_limited": True}
            else:
                decky.logger.error(f"Trade API search error: {e.code}")
                return {"success": False, "error": f"HTTP {e.code}"}

        except Exception as e:
            decky.logger.error(f"Trade API search exception: {e}")
            return {"success": False, "error": str(e)}

    async def fetch_listings(
        self,
        result_ids: List[str],
        query_id: str,
        limit: Optional[int] = None
    ) -> Dict[str, Any]:
        """
        Fetch detailed listings from Trade API in batches.

        Returns:
            {success: bool, listings: List[Dict], icon?: str, error?: str}
        """
        import decky

        if not result_ids:
            return {"success": False, "error": "No results to fetch", "listings": []}

        ids_to_fetch = result_ids[:limit] if limit else result_ids
        total_to_fetch = len(ids_to_fetch)

        all_listings = []
        first_item_icon = None
        batch_size = 10

        for batch_start in range(0, total_to_fetch, batch_size):
            batch_ids = ids_to_fetch[batch_start:batch_start + batch_size]
            if not batch_ids:
                break

            await self.fetch_limiter.wait()

            ids_param = ",".join(batch_ids)
            url = f"{self.BASE_URL}/fetch/{ids_param}?query={query_id}"

            try:
                req = urllib.request.Request(
                    url,
                    headers={
                        "User-Agent": "PoE2-Price-Checker-Decky/1.0",
                        "Accept": "application/json"
                    }
                )

                if self.poesessid:
                    req.add_header("Cookie", f"POESESSID={self.poesessid}")

                with urllib.request.urlopen(req, timeout=15, context=self.ssl_context) as response:
                    headers = {k: v for k, v in response.headers.items()}
                    self.fetch_limiter.parse_headers(headers)
                    self.fetch_limiter.handle_success()

                    result = json.loads(response.read().decode())

                    for item in result.get("result", []):
                        if not item:
                            continue

                        # Extract icon from first item
                        if first_item_icon is None:
                            item_data = item.get("item", {})
                            first_item_icon = item_data.get("icon")

                        listing = item.get("listing", {})
                        price = listing.get("price", {})
                        account_data = listing.get("account", {})

                        # Extract online status
                        online_data = account_data.get("online")
                        online_status = None
                        if online_data:
                            online_status = online_data.get("status") if isinstance(online_data, dict) else online_data

                        all_listings.append({
                            "amount": price.get("amount"),
                            "currency": price.get("currency"),
                            "account": account_data.get("name", "Unknown"),
                            "character": account_data.get("lastCharacterName", ""),
                            "online": online_status,
                            "whisper": listing.get("whisper", ""),
                            "indexed": listing.get("indexed", ""),
                        })

            except urllib.error.HTTPError as e:
                if e.code == 429:
                    retry_after = None
                    try:
                        retry_after = int(e.headers.get('Retry-After', 0))
                    except (ValueError, TypeError):
                        pass
                    self.fetch_limiter.handle_429(retry_after)
                    decky.logger.warning(f"Rate limited during fetch")
                    break
                else:
                    decky.logger.error(f"Trade API fetch error: {e.code}")
                    break

            except Exception as e:
                decky.logger.error(f"Trade API fetch exception: {e}")
                break

        # Store for debugging
        self.last_debug_listings = all_listings[:5]

        return {
            "success": len(all_listings) > 0,
            "listings": all_listings,
            "icon": first_item_icon,
            "error": None if all_listings else "No listings fetched"
        }

    # =========================================================================
    # QUERY BUILDING
    # =========================================================================

    def build_query(
        self,
        item_name: Optional[str] = None,
        base_type: Optional[str] = None,
        rarity: str = "any",
        modifiers: Optional[List[Dict[str, Any]]] = None,
        item_level: Optional[int] = None,
        socket_count: Optional[int] = None,
        linked_sockets: Optional[int] = None,
        pdps: Optional[float] = None,
        edps: Optional[float] = None,
        quality: Optional[int] = None,
        armour: Optional[int] = None,
        evasion: Optional[int] = None,
        energy_shield: Optional[int] = None,
        block: Optional[int] = None,
        spirit: Optional[int] = None,
        attack_speed: Optional[float] = None,
        crit_chance: Optional[float] = None,
        corrupted: Optional[bool] = None,
        gem_level: Optional[int] = None
    ) -> Dict[str, Any]:
        """Build a Trade API query from parameters"""

        query: Dict[str, Any] = {
            "query": {
                "status": {"option": "online"},
                "stats": [{"type": "and", "filters": []}]
            },
            "sort": {"price": "asc"}
        }

        # Item name (for uniques)
        if item_name:
            query["query"]["name"] = item_name

        # Base type
        if base_type:
            query["query"]["type"] = base_type

        # Rarity filter
        if rarity and rarity.lower() != "any":
            rarity_map = {
                "unique": "unique",
                "rare": "rare",
                "magic": "magic",
                "normal": "normal",
                "currency": "currency",
                "gem": "gem"
            }
            if rarity.lower() in rarity_map:
                query["query"]["filters"] = query["query"].get("filters", {})
                query["query"]["filters"]["type_filters"] = {
                    "filters": {"rarity": {"option": rarity_map[rarity.lower()]}}
                }

        # Initialize filters
        filters = query["query"].get("filters", {})

        # Type filters (ilvl, quality)
        type_filters = filters.get("type_filters", {"filters": {}})
        if item_level and item_level > 1:
            type_filters["filters"]["ilvl"] = {"min": item_level - 10}
        if quality and quality > 0:
            type_filters["filters"]["quality"] = {"min": max(0, quality - 5)}
        if type_filters["filters"]:
            filters["type_filters"] = type_filters

        # Equipment filters (defense, weapon stats)
        equip_filters: Dict[str, Any] = {"filters": {}}

        if armour and armour > 50:
            equip_filters["filters"]["ar"] = {"min": int(armour * 0.7)}
        if evasion and evasion > 50:
            equip_filters["filters"]["ev"] = {"min": int(evasion * 0.7)}
        if energy_shield and energy_shield > 30:
            equip_filters["filters"]["es"] = {"min": int(energy_shield * 0.7)}
        if block and block > 10:
            equip_filters["filters"]["block"] = {"min": int(block * 0.7)}
        if spirit and spirit > 10:
            equip_filters["filters"]["spirit"] = {"min": int(spirit * 0.7)}
        if pdps and pdps > 0:
            equip_filters["filters"]["pdps"] = {"min": int(pdps * 0.7)}
        if edps and edps > 0:
            equip_filters["filters"]["edps"] = {"min": int(edps * 0.7)}
        if attack_speed and attack_speed > 1.0:
            equip_filters["filters"]["aps"] = {"min": round(attack_speed * 0.9, 2)}
        if crit_chance and crit_chance > 5:
            equip_filters["filters"]["crit"] = {"min": round(crit_chance * 0.8, 1)}
        if socket_count and socket_count >= 2:
            equip_filters["filters"]["rune_sockets"] = {"min": socket_count - 1}

        if equip_filters["filters"]:
            filters["equipment_filters"] = equip_filters

        # Misc filters (gem level, corrupted)
        misc_filters: Dict[str, Any] = {"filters": {}}
        if gem_level and gem_level > 1:
            misc_filters["filters"]["gem_level"] = {"min": gem_level}
        if corrupted is not None:
            misc_filters["filters"]["corrupted"] = {"option": corrupted}

        if misc_filters["filters"]:
            filters["misc_filters"] = misc_filters

        # Trade filters
        filters["trade_filters"] = {"filters": {"sale_type": {"option": "priced"}}}

        query["query"]["filters"] = filters

        # Stat filters (modifiers)
        if modifiers:
            stat_filters = []
            for mod in modifiers:
                if not mod.get("enabled", True):
                    continue

                stat_id = mod.get("id")
                if not stat_id:
                    stat_id = self.find_stat_id(mod.get("text", ""))

                if stat_id:
                    stat_filter: Dict[str, Any] = {"id": stat_id}
                    if mod.get("min") is not None:
                        stat_filter["value"] = {"min": mod["min"]}
                    stat_filters.append(stat_filter)

            if stat_filters:
                query["query"]["stats"][0]["filters"] = stat_filters

        return query

    async def get_available_leagues(self) -> Dict[str, Any]:
        """Fetch available leagues from the Trade API"""
        import decky

        url = f"{self.BASE_URL}/data/leagues"

        try:
            req = urllib.request.Request(
                url,
                headers={
                    "User-Agent": "PoE2-Price-Checker-Decky/1.0",
                    "Accept": "application/json"
                }
            )

            with urllib.request.urlopen(req, timeout=10, context=self.ssl_context) as response:
                data = json.loads(response.read().decode())
                leagues = []
                for league in data.get("result", []):
                    leagues.append({
                        "id": league.get("id", ""),
                        "text": league.get("text", league.get("id", ""))
                    })
                return {"success": True, "leagues": leagues}

        except Exception as e:
            decky.logger.error(f"Failed to fetch leagues: {e}")
            return {
                "success": False,
                "error": str(e),
                "leagues": [
                    {"id": "Standard", "text": "Standard"},
                    {"id": "Fate of the Vaal", "text": "Fate of the Vaal"}
                ]
            }
