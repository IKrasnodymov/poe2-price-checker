# main.py - PoE2 Price Checker Decky Plugin Backend
# NOTE: decky must be imported inside methods, not at module level!

import asyncio
import json
import os
import sys
import time
from typing import Optional, Dict, Any, List, Tuple
import urllib.request
import urllib.error
import urllib.parse
import ssl

# Add plugin directory to path for backend module imports
# This is needed because Decky sandboxes the plugin
_plugin_dir = os.path.dirname(os.path.abspath(__file__))
if _plugin_dir not in sys.path:
    sys.path.insert(0, _plugin_dir)

# Import from backend modules (these can be at module level since they don't use decky)
from backend import AdaptiveRateLimiter, SearchResultCache


# Keep simple RateLimiter for backward compatibility
class RateLimiter:
    """Simple rate limiter for API requests (legacy)"""

    def __init__(self, min_interval: float = 1.0):
        self.min_interval = min_interval
        self.last_request = 0.0

    async def wait(self) -> None:
        now = time.time()
        elapsed = now - self.last_request
        if elapsed < self.min_interval:
            await asyncio.sleep(self.min_interval - elapsed)
        self.last_request = time.time()


class Plugin:
    """PoE2 Price Checker Decky Plugin Backend"""

    # Class-level attributes (workaround for Decky bug #509)
    # Decky doesn't properly instantiate Plugin class, so we use class attributes
    settings: Dict[str, Any] = None  # type: ignore

    # Adaptive rate limiters for Trade API (separate for search/fetch)
    search_limiter: AdaptiveRateLimiter = None  # type: ignore
    fetch_limiter: AdaptiveRateLimiter = None  # type: ignore
    poe2scout_limiter: RateLimiter = None  # type: ignore  # poe2scout uses simple limiter

    # Search result cache to avoid redundant API calls
    search_cache: SearchResultCache = None  # type: ignore

    ssl_context = None
    stat_cache: Dict[str, str] = None  # type: ignore  # text pattern -> stat ID
    currency_rates: Dict[str, float] = None  # type: ignore  # currency -> chaos value
    price_history: Dict[str, List[Dict[str, Any]]] = None  # type: ignore  # item_key -> [price records]
    scan_history: List[Dict[str, Any]] = None  # type: ignore  # List of scan records
    MAX_SCAN_HISTORY = 50  # Keep last 50 scanned items
    ICON_CACHE_DIR = "icon_cache"  # Subdirectory for cached icons

    # poe2scout.com cache - loaded once at startup
    poe2scout_cache: Dict[str, Any] = None  # type: ignore  # {items: {name: data}, currency: {apiId: data}}
    poe2scout_divine_price: float = 100.0  # Divine price in exalted from /api/leagues

    # Debug: store last fetched listings for debugging
    last_debug_listings: List[Dict[str, Any]] = None  # type: ignore

    # =========================================================================
    # LIFECYCLE METHODS
    # =========================================================================

    async def _main(self) -> None:
        """Plugin initialization"""
        import decky
        decky.logger.info("PoE2 Price Checker initializing...")

        # Initialize class attributes (workaround for Decky not instantiating Plugin)
        Plugin.settings = {
            "league": "Fate of the Vaal",
            "useTradeApi": True,
            "usePoe2Scout": True,
            "poesessid": "",
            # Rate limiting settings
            "search_min_interval": 3.0,  # Conservative default for search
            "fetch_min_interval": 1.0,   # Fetch can be faster
            "max_retries": 2,            # Max retries on 429
            "cache_ttl_seconds": 300,    # 5 minutes cache TTL
        }

        # Adaptive rate limiters (separate for search/fetch - they have different API limits)
        Plugin.search_limiter = AdaptiveRateLimiter(
            policy_name='trade-search',
            default_interval=Plugin.settings["search_min_interval"]
        )
        Plugin.fetch_limiter = AdaptiveRateLimiter(
            policy_name='trade-fetch',
            default_interval=Plugin.settings["fetch_min_interval"]
        )
        Plugin.poe2scout_limiter = RateLimiter(min_interval=1.0)  # 1s between poe2scout requests

        # Search result cache to reduce redundant API calls
        Plugin.search_cache = SearchResultCache(
            max_entries=100,
            ttl_seconds=Plugin.settings["cache_ttl_seconds"]
        )
        Plugin.stat_cache = {}
        Plugin.currency_rates = {
            # Default rates (will be updated from poe2scout)
            "chaos": 1.0,
            "chaos-orb": 1.0,
            "exalted": 50.0,  # 1 exalted = ~50 chaos
            "exalted-orb": 50.0,
            "divine": 150.0,  # 1 divine = ~150 chaos
            "divine-orb": 150.0,
            "gold": 0.001,  # 1000 gold = 1 chaos
            "regal": 0.5,  # rough estimate
            "regal-orb": 0.5,
            "alch": 0.1,
            "alchemy-orb": 0.1,
        }
        Plugin.poe2scout_cache = {"items": {}, "currency": {}}
        # Use unverified SSL context (SteamOS may lack proper CA certs)
        Plugin.ssl_context = ssl.create_default_context()
        Plugin.ssl_context.check_hostname = False
        Plugin.ssl_context.verify_mode = ssl.CERT_NONE

        # Load stat IDs from Trade API
        try:
            await Plugin.load_stat_ids(self)
        except Exception as e:
            decky.logger.error(f"Failed to load stat IDs: {e}")

        # Load poe2scout cache (items + currency rates)
        try:
            await Plugin.load_poe2scout_cache(self)
        except Exception as e:
            decky.logger.error(f"Failed to load poe2scout cache: {e}")

        # Load price history
        Plugin.price_history = {}
        Plugin.last_debug_listings = []
        try:
            await Plugin.load_price_history(self)
        except Exception as e:
            decky.logger.error(f"Failed to load price history: {e}")

        # Load scan history
        Plugin.scan_history = []
        try:
            await Plugin.load_scan_history(self)
        except Exception as e:
            decky.logger.error(f"Failed to load scan history: {e}")

        # Ensure icon cache directory exists
        try:
            icon_cache_path = os.path.join(decky.DECKY_PLUGIN_SETTINGS_DIR, Plugin.ICON_CACHE_DIR)
            os.makedirs(icon_cache_path, exist_ok=True)
        except Exception as e:
            decky.logger.error(f"Failed to create icon cache dir: {e}")

        # Load settings
        try:
            settings_path = os.path.join(decky.DECKY_PLUGIN_SETTINGS_DIR, "settings.json")
            if os.path.exists(settings_path):
                with open(settings_path, "r") as f:
                    loaded = json.load(f)
                    self.settings.update(loaded)
                decky.logger.info("Settings loaded successfully")
        except Exception as e:
            decky.logger.error(f"Failed to load settings: {e}")

        decky.logger.info("PoE2 Price Checker initialized successfully")

    async def _unload(self) -> None:
        """Plugin cleanup on disable"""
        import decky
        decky.logger.info("PoE2 Price Checker unloading...")
        # Save settings inline
        try:
            if Plugin.settings is None:
                decky.logger.warning("Settings not initialized, skipping save")
                return

            settings_path = os.path.join(decky.DECKY_PLUGIN_SETTINGS_DIR, "settings.json")
            os.makedirs(os.path.dirname(settings_path), exist_ok=True)

            # SECURITY: Exclude empty poesessid from saved file
            settings_to_save = dict(self.settings)
            if not settings_to_save.get("poesessid"):
                settings_to_save.pop("poesessid", None)

            with open(settings_path, "w") as f:
                json.dump(settings_to_save, f, indent=2)
            decky.logger.info("Settings saved successfully")
        except Exception as e:
            decky.logger.error(f"Failed to save settings: {e}")

    async def _uninstall(self) -> None:
        """Plugin cleanup on uninstall"""
        import decky
        decky.logger.info("PoE2 Price Checker uninstalling...")

    # =========================================================================
    # CLIPBOARD OPERATIONS
    # =========================================================================

    async def read_clipboard(self) -> Dict[str, Any]:
        """
        Read item text from clipboard using multiple methods
        Tries wl-paste, xclip, xsel in order
        Uses async subprocess to avoid blocking the event loop
        """
        import decky
        decky.logger.info("read_clipboard method called")

        try:
            clipboard_tools = [
                ["wl-paste", "-n"],
                ["xclip", "-selection", "clipboard", "-o"],
                ["xsel", "--clipboard", "--output"],
            ]

            last_error = "No clipboard tool available"

            for tool_cmd in clipboard_tools:
                try:
                    decky.logger.info(f"Trying clipboard tool: {tool_cmd[0]}")

                    # Set up environment for Steam Deck Gaming Mode
                    env = os.environ.copy()
                    if "WAYLAND_DISPLAY" not in env:
                        env["WAYLAND_DISPLAY"] = "wayland-1"
                    if "XDG_RUNTIME_DIR" not in env:
                        env["XDG_RUNTIME_DIR"] = "/run/user/1000"
                    if "DISPLAY" not in env:
                        env["DISPLAY"] = ":0"  # XWayland display for games

                    # Use async subprocess to avoid blocking the event loop
                    proc = await asyncio.create_subprocess_exec(
                        *tool_cmd,
                        stdout=asyncio.subprocess.PIPE,
                        stderr=asyncio.subprocess.PIPE,
                        env=env
                    )

                    try:
                        stdout, stderr = await asyncio.wait_for(
                            proc.communicate(),
                            timeout=5.0
                        )
                    except asyncio.TimeoutError:
                        proc.kill()
                        await proc.wait()
                        last_error = "Clipboard read timed out"
                        decky.logger.warning(last_error)
                        continue

                    if proc.returncode == 0:
                        clipboard_text = stdout.decode("utf-8", errors="replace")

                        # Validate it looks like PoE2 item text
                        if Plugin._is_poe_item(self, clipboard_text):
                            decky.logger.info(f"Read PoE item from clipboard ({len(clipboard_text)} chars)")
                            return {
                                "success": True,
                                "text": clipboard_text,
                                "error": None
                            }
                        else:
                            return {
                                "success": False,
                                "text": clipboard_text[:100] if clipboard_text else None,
                                "error": "Clipboard does not contain PoE2 item data. Hover over an item in PoE2 and press Ctrl+C (or your assigned button)."
                            }
                    else:
                        stderr_text = stderr.decode("utf-8", errors="replace").strip()
                        last_error = stderr_text if stderr_text else f"{tool_cmd[0]} failed"
                        decky.logger.warning(f"{tool_cmd[0]} failed: {last_error}")
                        continue

                except FileNotFoundError:
                    decky.logger.warning(f"{tool_cmd[0]} not found, trying next")
                    continue
                except Exception as e:
                    last_error = str(e)
                    decky.logger.error(f"Clipboard error with {tool_cmd[0]}: {e}")
                    continue

            # All tools failed
            return {
                "success": False,
                "text": None,
                "error": f"Could not read clipboard: {last_error}"
            }
        except Exception as e:
            decky.logger.error(f"read_clipboard unexpected error: {e}")
            import traceback
            decky.logger.error(traceback.format_exc())
            return {"success": False, "text": None, "error": f"Unexpected error: {e}"}

    def _is_poe_item(self, text: str) -> bool:
        """Check if text appears to be a PoE2 item"""
        if not text:
            return False

        lines = text.strip().split("\n")
        if len(lines) < 3:
            return False

        # PoE items typically start with "Item Class:" or "Rarity:"
        first_lines = "\n".join(lines[:5]).lower()
        return (
            "item class:" in first_lines or
            "rarity:" in first_lines or
            "--------" in text  # Section separator
        )

    # =========================================================================
    # STAT ID LOADING
    # =========================================================================

    async def load_stat_ids(self) -> None:
        """Load stat IDs from Trade API for modifier matching"""
        import decky
        decky.logger.info("Loading stat IDs from Trade API...")

        url = "https://www.pathofexile.com/api/trade2/data/stats"

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

                count = 0
                for group in data.get("result", []):
                    for entry in group.get("entries", []):
                        stat_id = entry.get("id", "")
                        text = entry.get("text", "")

                        if stat_id and text:
                            # Normalize text: replace numbers with #
                            import re
                            normalized = re.sub(r'\d+(?:\.\d+)?', '#', text)
                            normalized = normalized.replace('+', '').strip().lower()
                            Plugin.stat_cache[normalized] = stat_id
                            count += 1

                decky.logger.info(f"Loaded {count} stat IDs")

        except Exception as e:
            decky.logger.error(f"Failed to load stat IDs: {e}")
            import traceback
            decky.logger.error(traceback.format_exc())

    def find_stat_id(self, modifier_text: str) -> Optional[str]:
        """Find stat ID for a modifier text"""
        import re
        # Normalize the modifier text
        normalized = re.sub(r'\d+(?:\.\d+)?', '#', modifier_text)
        normalized = normalized.replace('+', '').strip().lower()

        # Try exact match
        if normalized in self.stat_cache:
            return self.stat_cache[normalized]

        # Try partial match
        for pattern, stat_id in self.stat_cache.items():
            if normalized in pattern or pattern in normalized:
                return stat_id

        return None

    def score_modifier_priority(self, modifier_text: str) -> int:
        """
        Score a modifier's importance for pricing (higher = more valuable).
        Used for selecting top mods in tiered search.
        """
        text = modifier_text.lower()

        # Tier 1: Most valuable mods (90-100)
        if "all elemental resist" in text or "all resistance" in text:
            return 100
        if "maximum life" in text and "%" in text:
            return 95
        if "movement speed" in text:
            return 90

        # Tier 2: Very valuable (80-89)
        if "critical" in text and "multiplier" in text:
            return 85
        if "level" in text and "skill" in text:
            return 82
        if "maximum life" in text:
            return 80

        # Tier 3: Good mods (65-79)
        if any(res in text for res in ["fire resist", "cold resist", "lightning resist", "chaos resist"]):
            return 75
        if "attack speed" in text:
            return 70
        if "cast speed" in text:
            return 70
        if "critical" in text and "chance" in text:
            return 68

        # Tier 4: Decent mods (50-64)
        if "physical damage" in text:
            return 62
        if any(attr in text for attr in ["strength", "dexterity", "intelligence"]):
            return 55
        if "mana" in text:
            return 52

        # Tier 5: Lower priority (30-49)
        if any(def_ in text for def_ in ["armour", "evasion", "energy shield"]):
            return 45
        if "accuracy" in text:
            return 40

        # Default
        return 30

    async def load_poe2scout_cache(self) -> None:
        """Load currency rates from poe2scout.com (items loaded on-demand)"""
        import decky
        decky.logger.info("Loading poe2scout currency rates...")

        league = self.settings.get("league", "Fate of the Vaal")

        # Only load leagues to get divine/exalted price ratio
        try:
            leagues_url = "https://poe2scout.com/api/leagues"
            req = urllib.request.Request(
                leagues_url,
                headers={
                    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
                    "Accept": "application/json"
                }
            )
            with urllib.request.urlopen(req, timeout=15, context=self.ssl_context) as response:
                leagues_data = json.loads(response.read().decode())
                for lg in leagues_data:
                    if lg.get("value") == league:
                        Plugin.poe2scout_divine_price = lg.get("divinePrice", 100.0)
                        chaos_divine = lg.get("chaosDivinePrice", 50.0)
                        # Update currency rates based on poe2scout data
                        Plugin.currency_rates["divine"] = chaos_divine
                        Plugin.currency_rates["divine-orb"] = chaos_divine
                        if Plugin.poe2scout_divine_price > 0:
                            exalt_rate = chaos_divine / Plugin.poe2scout_divine_price
                            Plugin.currency_rates["exalted"] = exalt_rate
                            Plugin.currency_rates["exalted-orb"] = exalt_rate
                        decky.logger.info(f"poe2scout rates: divine={chaos_divine}c, exalted={exalt_rate:.2f}c")
                        break
        except Exception as e:
            decky.logger.error(f"Failed to load poe2scout rates: {e}")

    async def fetch_poe2scout_item(self, item_name: str, category: str = "weapon") -> Dict[str, Any]:
        """Fetch item from poe2scout by name (on-demand, with caching)"""
        import decky

        # Check cache first
        name_lower = item_name.lower()
        if name_lower in Plugin.poe2scout_cache.get("items", {}):
            decky.logger.info(f"poe2scout cache hit: {item_name}")
            return Plugin.poe2scout_cache["items"][name_lower]

        league = self.settings.get("league", "Fate of the Vaal")
        league_encoded = urllib.parse.quote(league, safe='')
        search_encoded = urllib.parse.quote(item_name, safe='')

        # Search all unique categories
        categories = ["weapon", "armour", "accessory", "flask", "jewel"]

        for cat in categories:
            try:
                url = f"https://poe2scout.com/api/items/unique/{cat}?league={league_encoded}&search={search_encoded}"
                req = urllib.request.Request(
                    url,
                    headers={
                        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
                        "Accept": "application/json"
                    }
                )
                with urllib.request.urlopen(req, timeout=10, context=self.ssl_context) as response:
                    data = json.loads(response.read().decode())
                    items = data.get("items", [])

                    for item in items:
                        if item.get("name", "").lower() == name_lower:
                            # Cache it
                            Plugin.poe2scout_cache["items"][name_lower] = item
                            decky.logger.info(f"poe2scout found: {item_name} in {cat}")
                            return item

            except Exception as e:
                decky.logger.warning(f"poe2scout search failed ({cat}): {e}")
                continue

        decky.logger.info(f"poe2scout: {item_name} not found")
        return None

    async def get_poe2scout_price(self, item_name: str, rarity: str = "Unique") -> Dict[str, Any]:
        """
        Get item price from poe2scout (cache or on-demand fetch).
        Returns price in chaos (converted from exalted).
        """
        import decky

        if not self.settings.get("usePoe2Scout", True):
            return {"success": False, "error": "poe2scout disabled in settings"}

        name_lower = item_name.lower().strip() if item_name else ""

        # Try to find in items cache first
        if rarity == "Unique":
            if name_lower in Plugin.poe2scout_cache.get("items", {}):
                decky.logger.info(f"poe2scout cache hit: {item_name}")
                item = Plugin.poe2scout_cache["items"][name_lower]
                return Plugin._format_poe2scout_result(self, item)

            # Not in cache - fetch on demand
            item = await Plugin.fetch_poe2scout_item(self, item_name)
            if item:
                return Plugin._format_poe2scout_result(self, item)

        # Try currency cache (currency is rare, keep simple)
        for api_id, item_data in Plugin.poe2scout_cache.get("currency", {}).items():
            item_text = item_data.get("text", "").lower()
            if name_lower in item_text or item_text in name_lower:
                return Plugin._format_poe2scout_result(self, item_data)

        return {
            "success": False,
            "source": "poe2scout",
            "error": f"Item '{item_name}' not found on poe2scout"
        }

    def _format_poe2scout_result(self, item: Dict[str, Any]) -> Dict[str, Any]:
        """Format poe2scout item data into standardized result"""
        # poe2scout returns currentPrice in exalted by default
        price_exalted = item.get("currentPrice", 0) or 0

        # Convert to chaos
        exalt_rate = Plugin.currency_rates.get("exalted", 1.0)
        price_chaos = price_exalted * exalt_rate

        # Get quantity from latest price log
        price_logs = item.get("priceLogs", [])
        quantity = 0
        for log in price_logs:
            if log and log.get("quantity"):
                quantity = log["quantity"]
                break

        return {
            "success": True,
            "source": "poe2scout",
            "price": {
                "chaos": price_chaos,
                "exalted": price_exalted,
                "divine": price_exalted / Plugin.poe2scout_divine_price if Plugin.poe2scout_divine_price > 0 else 0,
            },
            "confidence": "high" if quantity >= 10 else "low",
            "listings": quantity,
            "icon": item.get("iconUrl"),
            "error": None
        }

    def convert_to_chaos(self, amount: float, currency: str) -> float:
        """Convert any currency amount to chaos equivalent"""
        if amount is None:
            return 0.0
        currency_lower = currency.lower() if currency else "chaos"
        rate = self.currency_rates.get(currency_lower, 1.0)
        return amount * rate

    async def get_currency_rates(self) -> Dict[str, Any]:
        """Return current currency rates"""
        return {"success": True, "rates": self.currency_rates}

    async def get_debug_listings(self) -> Dict[str, Any]:
        """Return last fetched listings for debugging"""
        return {"success": True, "listings": Plugin.last_debug_listings or []}

    # =========================================================================
    # PRICE HISTORY (LOCAL CACHE)
    # =========================================================================

    def _get_history_path(self) -> str:
        """Get path to price history file"""
        import decky
        return os.path.join(decky.DECKY_PLUGIN_SETTINGS_DIR, "price_history.json")

    async def load_price_history(self) -> None:
        """Load price history from file"""
        import decky
        history_path = self._get_history_path()

        if os.path.exists(history_path):
            try:
                with open(history_path, "r") as f:
                    Plugin.price_history = json.load(f)
                decky.logger.info(f"Loaded {len(Plugin.price_history)} items from price history")
            except Exception as e:
                decky.logger.error(f"Failed to load price history: {e}")
                Plugin.price_history = {}
        else:
            Plugin.price_history = {}
            decky.logger.info("No price history file found, starting fresh")

    async def save_price_history(self) -> None:
        """Save price history to file"""
        import decky
        history_path = self._get_history_path()

        try:
            os.makedirs(os.path.dirname(history_path), exist_ok=True)
            with open(history_path, "w") as f:
                json.dump(Plugin.price_history, f, indent=2)
            decky.logger.info(f"Saved {len(Plugin.price_history)} items to price history")
        except Exception as e:
            decky.logger.error(f"Failed to save price history: {e}")

    def _make_item_key(self, item_name: str, base_type: str, rarity: str) -> str:
        """Create a unique key for an item based on name/type"""
        # For uniques: use name
        # For rares: use base type
        # This groups similar items together
        if rarity == "Unique" and item_name:
            return f"unique:{item_name.lower()}"
        elif base_type:
            return f"base:{base_type.lower()}"
        else:
            return f"item:{item_name.lower()}"

    async def add_price_record(
        self,
        item_name: str,
        base_type: str,
        rarity: str,
        median_price: float,
        listing_count: int,
        currency: str = "chaos"
    ) -> Dict[str, Any]:
        """Add a price record to history"""
        import decky

        key = self._make_item_key(item_name, base_type, rarity)
        timestamp = int(time.time())

        record = {
            "timestamp": timestamp,
            "median_price": median_price,
            "currency": currency,
            "listing_count": listing_count,
            "item_name": item_name,
            "base_type": base_type
        }

        if key not in Plugin.price_history:
            Plugin.price_history[key] = []

        # Keep last 100 records per item
        Plugin.price_history[key].append(record)
        Plugin.price_history[key] = Plugin.price_history[key][-100:]

        # Save to file
        await self.save_price_history()

        decky.logger.info(f"Added price record for {key}: {median_price:.1f} {currency} (received currency={currency})")
        return {"success": True}

    async def get_price_history(
        self,
        item_name: str,
        base_type: str,
        rarity: str
    ) -> Dict[str, Any]:
        """Get price history for an item"""
        key = self._make_item_key(item_name, base_type, rarity)

        records = Plugin.price_history.get(key, [])

        return {
            "success": True,
            "key": key,
            "records": records,
            "count": len(records)
        }

    async def get_all_price_history(self) -> Dict[str, Any]:
        """Get all price history data"""
        total_records = sum(len(records) for records in Plugin.price_history.values())
        return {
            "success": True,
            "items": len(Plugin.price_history),
            "total_records": total_records,
            "data": Plugin.price_history
        }

    async def clear_price_history(self) -> Dict[str, Any]:
        """Clear all price history"""
        import decky
        Plugin.price_history = {}
        await self.save_price_history()
        decky.logger.info("Price history cleared")
        return {"success": True}

    # =========================================================================
    # SCAN HISTORY (FULL ITEM RECORDS)
    # =========================================================================

    def _get_scan_history_path(self) -> str:
        """Get path to scan history file"""
        import decky
        return os.path.join(decky.DECKY_PLUGIN_SETTINGS_DIR, "scan_history.json")

    def _get_icon_cache_path(self) -> str:
        """Get path to icon cache directory"""
        import decky
        return os.path.join(decky.DECKY_PLUGIN_SETTINGS_DIR, Plugin.ICON_CACHE_DIR)

    async def load_scan_history(self) -> None:
        """Load scan history from file"""
        import decky
        history_path = Plugin._get_scan_history_path(self)

        if os.path.exists(history_path):
            try:
                with open(history_path, "r") as f:
                    Plugin.scan_history = json.load(f)
                decky.logger.info(f"Loaded {len(Plugin.scan_history)} scan history records")
            except Exception as e:
                decky.logger.error(f"Failed to load scan history: {e}")
                Plugin.scan_history = []
        else:
            Plugin.scan_history = []
            decky.logger.info("No scan history file found, starting fresh")

    async def save_scan_history(self) -> None:
        """Save scan history to file"""
        import decky
        history_path = Plugin._get_scan_history_path(self)

        try:
            os.makedirs(os.path.dirname(history_path), exist_ok=True)
            with open(history_path, "w") as f:
                json.dump(Plugin.scan_history, f, indent=2)
            decky.logger.info(f"Saved {len(Plugin.scan_history)} scan history records")
        except Exception as e:
            decky.logger.error(f"Failed to save scan history: {e}")

    async def download_icon(self, icon_url: str, record_id: str) -> Optional[str]:
        """Download icon from URL and cache locally"""
        import decky

        if not icon_url:
            return None

        try:
            # Determine file extension from URL
            ext = ".png"
            if ".jpg" in icon_url or ".jpeg" in icon_url:
                ext = ".jpg"
            elif ".webp" in icon_url:
                ext = ".webp"

            # Create local path
            filename = f"{record_id}{ext}"
            icon_cache_path = Plugin._get_icon_cache_path(self)
            os.makedirs(icon_cache_path, exist_ok=True)

            relative_path = os.path.join(Plugin.ICON_CACHE_DIR, filename)
            full_path = os.path.join(icon_cache_path, filename)

            # Download with urllib
            req = urllib.request.Request(
                icon_url,
                headers={
                    "User-Agent": "PoE2-Price-Checker-Decky/1.0",
                    "Accept": "image/*"
                }
            )

            with urllib.request.urlopen(req, timeout=10, context=Plugin.ssl_context) as response:
                with open(full_path, "wb") as f:
                    f.write(response.read())

            decky.logger.info(f"Downloaded icon to {relative_path}")
            return relative_path

        except Exception as e:
            decky.logger.warning(f"Failed to download icon from {icon_url}: {e}")
            return None

    async def add_scan_record(
        self,
        item_name: str,
        basetype: str,
        rarity: str,
        item_class: str,
        item_level: Optional[int],
        quality: Optional[int],
        corrupted: bool,
        implicit_mods: List[str],
        explicit_mods: List[str],
        crafted_mods: List[str],
        min_price: float,
        max_price: float,
        median_price: float,
        currency: str,
        source: str,
        icon_url: Optional[str],
        search_tier: int,
        listings_count: int
    ) -> Dict[str, Any]:
        """Add a new scan record to history"""
        import decky
        import uuid

        # Generate unique ID
        record_id = f"{int(time.time())}-{uuid.uuid4().hex[:8]}"

        # Download icon if URL provided
        local_icon_path = None
        if icon_url:
            try:
                local_icon_path = await Plugin.download_icon(self, icon_url, record_id)
            except Exception as e:
                decky.logger.warning(f"Failed to download icon: {e}")

        record = {
            "id": record_id,
            "timestamp": int(time.time()),
            "itemName": item_name,
            "basetype": basetype,
            "rarity": rarity,
            "itemClass": item_class,
            "itemLevel": item_level,
            "quality": quality,
            "corrupted": corrupted,
            "implicitMods": implicit_mods,
            "explicitMods": explicit_mods,
            "craftedMods": crafted_mods,
            "priceData": {
                "minPrice": min_price,
                "maxPrice": max_price,
                "medianPrice": median_price,
                "currency": currency,
                "source": source
            },
            "iconUrl": icon_url,
            "localIconPath": local_icon_path,
            "searchTier": search_tier,
            "listingsCount": listings_count
        }

        # Add to beginning of list (newest first)
        Plugin.scan_history.insert(0, record)

        # Trim to max size and clean up old icons
        if len(Plugin.scan_history) > Plugin.MAX_SCAN_HISTORY:
            removed = Plugin.scan_history[Plugin.MAX_SCAN_HISTORY:]
            Plugin.scan_history = Plugin.scan_history[:Plugin.MAX_SCAN_HISTORY]

            # Clean up icons for removed records
            for old_record in removed:
                if old_record.get("localIconPath"):
                    try:
                        icon_path = os.path.join(
                            decky.DECKY_PLUGIN_SETTINGS_DIR,
                            old_record["localIconPath"]
                        )
                        if os.path.exists(icon_path):
                            os.remove(icon_path)
                            decky.logger.info(f"Removed old icon: {old_record['localIconPath']}")
                    except Exception as e:
                        decky.logger.warning(f"Failed to remove old icon: {e}")

        # Save to file
        await Plugin.save_scan_history(self)

        decky.logger.info(f"Added scan record: {item_name} ({median_price} {currency})")
        return {"success": True, "id": record_id}

    async def get_scan_history(self, limit: Optional[int] = None) -> Dict[str, Any]:
        """Get scan history records"""
        import decky
        records = Plugin.scan_history or []
        if limit:
            records = records[:limit]

        decky.logger.info(f"get_scan_history called, returning {len(records)} records")
        return {
            "success": True,
            "records": records,
            "count": len(records)
        }

    async def get_scan_record(self, record_id: str) -> Dict[str, Any]:
        """Get a specific scan record by ID"""
        for record in Plugin.scan_history or []:
            if record.get("id") == record_id:
                return {"success": True, "record": record}

        return {"success": False, "error": "Record not found"}

    async def clear_scan_history(self) -> Dict[str, Any]:
        """Clear all scan history and cached icons"""
        import decky
        import shutil

        # Remove all cached icons
        icon_cache_path = Plugin._get_icon_cache_path(self)
        try:
            if os.path.exists(icon_cache_path):
                shutil.rmtree(icon_cache_path)
                os.makedirs(icon_cache_path, exist_ok=True)
                decky.logger.info("Icon cache cleared")
        except Exception as e:
            decky.logger.warning(f"Failed to clear icon cache: {e}")

        Plugin.scan_history = []
        await Plugin.save_scan_history(self)

        decky.logger.info("Scan history cleared")
        return {"success": True}

    async def get_price_dynamics(
        self,
        item_name: str,
        basetype: str,
        rarity: str
    ) -> Dict[str, Any]:
        """Get price dynamics for an item from scan history and price history"""
        import decky

        dynamics = []

        # Find matching records from scan history
        for record in Plugin.scan_history or []:
            # Match by name for uniques, basetype for others
            if rarity == "Unique":
                if record.get("itemName", "").lower() == item_name.lower():
                    price_data = record.get("priceData", {})
                    dynamics.append({
                        "timestamp": record.get("timestamp"),
                        "price": price_data.get("medianPrice", 0),
                        "currency": price_data.get("currency", "chaos"),
                        "source": "scan"
                    })
            else:
                if record.get("basetype", "").lower() == basetype.lower():
                    price_data = record.get("priceData", {})
                    dynamics.append({
                        "timestamp": record.get("timestamp"),
                        "price": price_data.get("medianPrice", 0),
                        "currency": price_data.get("currency", "chaos"),
                        "source": "scan"
                    })

        # Also check price_history for older records
        key = Plugin._make_item_key(self, item_name, basetype, rarity)
        historical = Plugin.price_history.get(key, []) if Plugin.price_history else []

        for record in historical:
            dynamics.append({
                "timestamp": record.get("timestamp"),
                "price": record.get("median_price", 0),
                "currency": record.get("currency", "chaos"),
                "source": "history"
            })

        # Remove duplicates (same timestamp)
        seen_timestamps = set()
        unique_dynamics = []
        for d in dynamics:
            ts = d.get("timestamp")
            if ts not in seen_timestamps:
                seen_timestamps.add(ts)
                unique_dynamics.append(d)
        dynamics = unique_dynamics

        # Sort by timestamp (oldest first)
        dynamics.sort(key=lambda x: x.get("timestamp", 0))

        # Calculate changes
        for i in range(len(dynamics)):
            if i > 0:
                prev_price = dynamics[i - 1]["price"]
                curr_price = dynamics[i]["price"]

                if prev_price > 0:
                    change = curr_price - prev_price
                    change_percent = (change / prev_price) * 100

                    dynamics[i]["change"] = round(change, 2)
                    dynamics[i]["changePercent"] = round(change_percent, 1)

                    if change_percent > 5:
                        dynamics[i]["trend"] = "up"
                    elif change_percent < -5:
                        dynamics[i]["trend"] = "down"
                    else:
                        dynamics[i]["trend"] = "stable"

        # Calculate 24h change
        now = int(time.time())
        day_ago = now - 86400

        recent = [d for d in dynamics if d["timestamp"] >= day_ago]
        current_price = dynamics[-1]["price"] if dynamics else None

        price_change_24h = None
        price_change_percent_24h = None

        if len(recent) >= 2:
            oldest = recent[0]["price"]
            newest = recent[-1]["price"]
            if oldest > 0:
                price_change_24h = round(newest - oldest, 2)
                price_change_percent_24h = round((price_change_24h / oldest) * 100, 1)

        return {
            "success": True,
            "itemKey": key,
            "dynamics": dynamics,
            "currentPrice": current_price,
            "priceChange24h": price_change_24h,
            "priceChangePercent24h": price_change_percent_24h
        }

    async def get_settings_dir(self) -> Dict[str, Any]:
        """Return the plugin settings directory path"""
        import decky
        return {"success": True, "path": decky.DECKY_PLUGIN_SETTINGS_DIR}

    async def get_stat_ids_for_mods(self, modifiers: List[str]) -> Dict[str, Any]:
        """Get stat IDs for a list of modifier texts"""
        import decky
        results = {}
        matched = 0

        for mod_text in modifiers:
            stat_id = Plugin.find_stat_id(self, mod_text)
            if stat_id:
                results[mod_text] = stat_id
                matched += 1
                decky.logger.info(f"Matched: '{mod_text}' -> {stat_id}")
            else:
                decky.logger.warning(f"No stat ID for: '{mod_text}'")

        decky.logger.info(f"Matched {matched}/{len(modifiers)} modifiers")
        return {"success": True, "stat_ids": results, "matched": matched, "total": len(modifiers)}

    # =========================================================================
    # OFFICIAL TRADE API
    # =========================================================================

    async def search_trade_api(self, query: Dict[str, Any]) -> Dict[str, Any]:
        """
        Search the official PoE2 Trade API with adaptive rate limiting.

        query: Trade API search query object
        """
        import decky
        if not self.settings.get("useTradeApi", True):
            return {"success": False, "error": "Trade API disabled in settings"}

        # Use adaptive search limiter
        await self.search_limiter.wait()

        league = self.settings.get("league", "Standard")
        league_encoded = urllib.parse.quote(league, safe='')
        base_url = f"https://www.pathofexile.com/api/trade2/search/poe2/{league_encoded}"

        decky.logger.info(f"Searching Trade API: {league}")
        decky.logger.info(f"Query: {json.dumps(query, indent=2)}")

        try:
            # Prepare request
            data = json.dumps(query).encode("utf-8")
            req = urllib.request.Request(
                base_url,
                data=data,
                headers={
                    "Content-Type": "application/json",
                    "User-Agent": "PoE2-Price-Checker-Decky/1.0",
                    "Accept": "application/json"
                },
                method="POST"
            )

            # Add POESESSID if configured (SECURITY NOTE: Cookie stored in settings.json)
            # Warning: POESESSID grants account access - handle with care
            poesessid = self.settings.get("poesessid", "")
            if poesessid:
                req.add_header("Cookie", f"POESESSID={poesessid}")
                # Don't log the actual session ID for security
                decky.logger.debug("Using POESESSID for authenticated request")

            with urllib.request.urlopen(req, timeout=15, context=self.ssl_context) as response:
                # Parse rate limit headers for adaptive limiting
                headers = {k: v for k, v in response.headers.items()}
                self.search_limiter.parse_headers(headers)
                self.search_limiter.handle_success()

                result = json.loads(response.read().decode())

                total = result.get("total", 0)
                result_ids = result.get("result", [])
                decky.logger.info(f"Trade search: {total} total results, {len(result_ids)} IDs returned")

                return {
                    "success": True,
                    "id": result.get("id"),
                    "total": total,
                    "result": result_ids,  # All result IDs (API returns max ~100)
                    "error": None
                }

        except urllib.error.HTTPError as e:
            error_body = ""
            try:
                error_body = e.read().decode()
            except Exception:
                pass

            decky.logger.error(f"Trade API HTTP error: {e.code} - {error_body}")

            if e.code == 429:
                # Parse Retry-After header and handle with adaptive limiter
                retry_after = None
                try:
                    retry_after = int(e.headers.get('Retry-After', 0))
                except (ValueError, TypeError):
                    pass
                wait_time = self.search_limiter.handle_429(retry_after)
                decky.logger.warning(f"Rate limited (429). Backing off for {wait_time:.1f}s")
                return {
                    "success": False,
                    "error": f"Rate limited. Waiting {wait_time:.0f}s before retry.",
                    "retry_after": wait_time
                }

            if e.code == 400:
                # Parse error message from response
                try:
                    error_json = json.loads(error_body)
                    error_msg = error_json.get("error", {}).get("message", "Bad request")
                    if "Unknown item base type" in error_msg:
                        return {
                            "success": False,
                            "error": f"Unknown item type. This item may be currency, a quest item, or not tradeable."
                        }
                    return {
                        "success": False,
                        "error": f"Trade API: {error_msg}"
                    }
                except (json.JSONDecodeError, KeyError, ValueError):
                    pass  # Error response format not parseable

            return {
                "success": False,
                "error": f"Trade API Error {e.code}: {error_body[:100] if error_body else 'Unknown error'}"
            }
        except Exception as e:
            decky.logger.error(f"Trade API search error: {e}")
            return {
                "success": False,
                "error": str(e)
            }

    async def fetch_trade_listings(
        self,
        result_ids: List[str],
        query_id: str,
        limit: Optional[int] = None
    ) -> Dict[str, Any]:
        """
        Fetch detailed listings from Trade API in batches with adaptive rate limiting.

        result_ids: List of item IDs from search
        query_id: Query ID from search response
        limit: Maximum number of listings to fetch (None = all)
        """
        import decky
        if not result_ids:
            return {"success": False, "error": "No results to fetch", "listings": []}

        # Apply limit if specified
        ids_to_fetch = result_ids[:limit] if limit else result_ids
        total_to_fetch = len(ids_to_fetch)

        decky.logger.info(f"Fetching {total_to_fetch} listings in batches of 10")

        all_listings = []
        first_item_icon = None  # Extract icon from first item
        batch_size = 10  # API limit

        poesessid = self.settings.get("poesessid", "")

        # Fetch in batches of 10
        for batch_start in range(0, total_to_fetch, batch_size):
            batch_ids = ids_to_fetch[batch_start:batch_start + batch_size]

            if not batch_ids:
                break

            # Use adaptive fetch limiter
            await self.fetch_limiter.wait()

            ids_param = ",".join(batch_ids)
            url = f"https://www.pathofexile.com/api/trade2/fetch/{ids_param}?query={query_id}"

            batch_num = (batch_start // batch_size) + 1
            total_batches = (total_to_fetch + batch_size - 1) // batch_size
            decky.logger.info(f"Fetching batch {batch_num}/{total_batches} ({len(batch_ids)} items)")

            try:
                req = urllib.request.Request(
                    url,
                    headers={
                        "User-Agent": "PoE2-Price-Checker-Decky/1.0",
                        "Accept": "application/json"
                    }
                )

                # SECURITY: Don't log POESESSID - grants account access
                if poesessid:
                    req.add_header("Cookie", f"POESESSID={poesessid}")

                with urllib.request.urlopen(req, timeout=15, context=self.ssl_context) as response:
                    # Parse rate limit headers for adaptive limiting
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
                        amount = price.get("amount")
                        currency = price.get("currency")
                        account = listing.get("account", {}).get("name", "Unknown")

                        all_listings.append({
                            "amount": amount,
                            "currency": currency,
                            "account": account,
                            "whisper": listing.get("whisper", ""),
                            "indexed": listing.get("indexed", ""),
                        })

            except urllib.error.HTTPError as e:
                decky.logger.error(f"Trade API fetch error (batch {batch_num}): {e.code}")
                if e.code == 429:
                    # Handle rate limit with adaptive backoff
                    retry_after = None
                    try:
                        retry_after = int(e.headers.get('Retry-After', 0))
                    except (ValueError, TypeError):
                        pass
                    wait_time = self.fetch_limiter.handle_429(retry_after)
                    decky.logger.warning(f"Fetch rate limited (429). Backing off for {wait_time:.1f}s")
                    # Wait and retry this batch once
                    await asyncio.sleep(wait_time)
                    # Retry this batch
                    try:
                        await self.fetch_limiter.wait()
                        with urllib.request.urlopen(req, timeout=15, context=self.ssl_context) as response:
                            result = json.loads(response.read().decode())
                            for item in result.get("result", []):
                                if not item:
                                    continue
                                if first_item_icon is None:
                                    first_item_icon = item.get("item", {}).get("icon")
                                listing = item.get("listing", {})
                                price = listing.get("price", {})
                                all_listings.append({
                                    "amount": price.get("amount"),
                                    "currency": price.get("currency"),
                                    "account": listing.get("account", {}).get("name", "Unknown"),
                                    "whisper": listing.get("whisper", ""),
                                    "indexed": listing.get("indexed", ""),
                                })
                            self.fetch_limiter.handle_success()
                    except Exception as retry_e:
                        decky.logger.error(f"Retry failed: {retry_e}")
                else:
                    # Continue with other batches if one fails
                    continue
            except Exception as e:
                decky.logger.error(f"Trade API fetch error (batch {batch_num}): {e}")
                continue

        decky.logger.info(f"Total fetched: {len(all_listings)} listings")

        # Count currencies
        currency_counts = {}
        for lst in all_listings:
            curr = lst.get('currency', 'unknown')
            currency_counts[curr] = currency_counts.get(curr, 0) + 1
        decky.logger.info(f"Currency breakdown: {currency_counts}")

        # Sort by amount (simple, no currency conversion)
        all_listings.sort(key=lambda x: x.get("amount", 0) or 0)

        # Store first 5 listings for debug
        Plugin.last_debug_listings = all_listings[:5] if all_listings else []

        # Log first 3 after sorting
        for i, lst in enumerate(all_listings[:3]):
            decky.logger.info(f"Listing {i+1}: {lst.get('amount')} {lst.get('currency')}")

        return {
            "success": True,
            "listings": all_listings,
            "icon": first_item_icon,
            "error": None
        }

    async def build_trade_query(
        self,
        item_name: Optional[str],
        base_type: Optional[str],
        modifiers: List[Dict[str, Any]],
        filters: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Build a Trade API query from parsed item data

        modifiers: List of {id, min, max, enabled} objects
        filters: Additional filters like item level, sockets, etc.
        """
        query = {
            "query": {
                "status": {"option": "any"},  # Include offline sellers for more results
                "stats": [{"type": "count", "filters": [], "value": {"min": 3}}],  # Match at least 3 mods
                "filters": {
                    "trade_filters": {
                        "filters": {
                            "sale_type": {"option": "priced"}  # Only buyout (exact price)
                        }
                    }
                }
            },
            "sort": {"price": "asc"}
        }

        # Add item name/type
        if item_name:
            query["query"]["name"] = item_name
        if base_type:
            query["query"]["type"] = base_type

        # Add enabled modifiers (with relaxed min values for better matching)
        for mod in modifiers:
            if mod.get("enabled", False) and mod.get("id"):
                stat_filter = {"id": mod["id"]}

                # Use 80% of min value for reasonable matching (not too strict, not too loose)
                if mod.get("min") is not None:
                    relaxed_min = int(mod["min"] * 0.8)
                    if relaxed_min > 0:
                        stat_filter["value"] = {"min": relaxed_min}

                query["query"]["stats"][0]["filters"].append(stat_filter)

        # Add misc filters (merge with existing trade_filters)
        if filters:
            if filters.get("ilvl_min"):
                query["query"]["filters"]["misc_filters"] = {
                    "filters": {
                        "ilvl": {"min": filters["ilvl_min"]}
                    }
                }

            if filters.get("corrupted") is not None:
                query["query"]["filters"].setdefault("misc_filters", {"filters": {}})
                query["query"]["filters"]["misc_filters"]["filters"]["corrupted"] = {
                    "option": "true" if filters["corrupted"] else "false"
                }

        return query

    async def build_tiered_query(
        self,
        tier: int,
        item_name: Optional[str],
        base_type: Optional[str],
        modifiers: List[Dict[str, Any]],
        item_level: Optional[int] = None
    ) -> Dict[str, Any]:
        """
        Build Trade API query for a specific search tier.

        Tier 1: All mods, 80% values (exact match)
        Tier 2: Top 3 mods, 50% values (core mods)
        Tier 3: Base type only + ilvl (base only)
        """
        import decky

        query = {
            "query": {
                "status": {"option": "any"},
                "filters": {
                    "trade_filters": {
                        "filters": {
                            "sale_type": {"option": "priced"}
                        }
                    }
                }
            },
            "sort": {"price": "asc"}
        }

        # Add item name/type
        if item_name:
            query["query"]["name"] = item_name
        if base_type:
            query["query"]["type"] = base_type

        # Add item level filter for all tiers
        if item_level and item_level > 1:
            # Use item level range: -10 to current
            min_ilvl = max(1, item_level - 10)
            query["query"]["filters"]["misc_filters"] = {
                "filters": {
                    "ilvl": {"min": min_ilvl}
                }
            }

        # Tier-specific logic
        if tier == 0:
            # Exact match: all mods, 100% values (no relaxation)
            if modifiers:
                enabled_mods = [m for m in modifiers if m.get("enabled") and m.get("id")]
                if enabled_mods:
                    stat_filters = []
                    for mod in enabled_mods:
                        stat_filter = {"id": mod["id"]}
                        if mod.get("min") is not None and mod["min"] > 0:
                            stat_filter["value"] = {"min": mod["min"]}
                        stat_filters.append(stat_filter)

                    # Require ALL mods to match
                    query["query"]["stats"] = [{
                        "type": "count",
                        "filters": stat_filters,
                        "value": {"min": len(stat_filters)}
                    }]
                    decky.logger.info(f"Tier 0: {len(stat_filters)} mods, 100% values, require ALL")

        elif tier == 1:
            # Relaxed match: all mods, 80% values
            if modifiers:
                enabled_mods = [m for m in modifiers if m.get("enabled") and m.get("id")]
                if enabled_mods:
                    stat_filters = []
                    for mod in enabled_mods:
                        stat_filter = {"id": mod["id"]}
                        if mod.get("min") is not None:
                            relaxed_min = int(mod["min"] * 0.8)
                            if relaxed_min > 0:
                                stat_filter["value"] = {"min": relaxed_min}
                        stat_filters.append(stat_filter)

                    # Require matching most mods
                    min_count = max(1, len(stat_filters) - 1)
                    query["query"]["stats"] = [{
                        "type": "count",
                        "filters": stat_filters,
                        "value": {"min": min_count}
                    }]
                    decky.logger.info(f"Tier 1: {len(stat_filters)} mods, 80% values, require {min_count}")

        elif tier == 2:
            # Core mods: top 3 by priority, 50% values
            if modifiers:
                enabled_mods = [m for m in modifiers if m.get("enabled") and m.get("id")]
                if enabled_mods:
                    # Sort by priority and take top 3
                    for mod in enabled_mods:
                        mod["priority"] = Plugin.score_modifier_priority(self, mod.get("text", ""))
                    sorted_mods = sorted(enabled_mods, key=lambda x: x.get("priority", 0), reverse=True)
                    top_mods = sorted_mods[:3]

                    stat_filters = []
                    for mod in top_mods:
                        stat_filter = {"id": mod["id"]}
                        if mod.get("min") is not None:
                            relaxed_min = int(mod["min"] * 0.5)  # 50% relaxation
                            if relaxed_min > 0:
                                stat_filter["value"] = {"min": relaxed_min}
                        stat_filters.append(stat_filter)

                    if stat_filters:
                        # Require at least 2 of top 3 mods
                        min_count = min(2, len(stat_filters))
                        query["query"]["stats"] = [{
                            "type": "count",
                            "filters": stat_filters,
                            "value": {"min": min_count}
                        }]
                        mod_names = [m.get("text", "")[:30] for m in top_mods]
                        decky.logger.info(f"Tier 2: top {len(top_mods)} mods: {mod_names}")

        elif tier == 3:
            # Base only: no modifiers, just type + ilvl
            # Already handled above - no stats filter needed
            decky.logger.info(f"Tier 3: base only - {base_type}")

        return query

    async def progressive_search(
        self,
        item_name: Optional[str],
        base_type: Optional[str],
        rarity: str,
        modifiers: List[Dict[str, Any]],
        item_level: Optional[int] = None
    ) -> Dict[str, Any]:
        """
        Progressive tiered search with smart early stopping, caching, and retry logic.

        Searches through tiers:
        - Tier 0: Exact match (all mods, 100% values)
        - Tier 1: Similar (all mods, 80% values)
        - Tier 2: Core mods (top 3 mods, 50% values)
        - Tier 3: Base only (just base type + ilvl)

        Features:
        - Caches results to avoid redundant API calls
        - Retries on 429 rate limit errors
        - Stops early if enough results found
        - Uses poe2scout for uniques/currency
        """
        import decky
        decky.logger.info(f"Progressive search: {item_name or base_type}, {len(modifiers)} mods")

        result = {
            "success": True,
            "tiers": [],
            "poe2scout_price": None,
            "trade_icon": None,  # Icon from Trade API
            "stopped_at_tier": 0,
            "total_searches": 0,
            "from_cache": False,
            "error": None
        }

        # Check cache first
        cached = self.search_cache.get(item_name, base_type, rarity, modifiers)
        if cached:
            decky.logger.info("Using cached search result")
            result["tiers"] = cached.result.get("tiers", [])
            result["trade_icon"] = cached.result.get("trade_icon")
            result["poe2scout_price"] = cached.result.get("poe2scout_price")
            result["stopped_at_tier"] = cached.result.get("stopped_at_tier", 0)
            result["from_cache"] = True
            return result

        # Tier names and descriptions
        tier_info = {
            0: {"name": "Exact Match", "description": "All mods, 100% values"},
            1: {"name": "Similar", "description": "All mods, 80% values"},
            2: {"name": "Core Mods", "description": "Top 3 mods, 50% values"},
            3: {"name": "Base Only", "description": f"{base_type or 'Any'} ilvl {item_level or 'any'}+"}
        }

        # Fetch limits per tier (reduced for speed optimization)
        fetch_limits = {0: 10, 1: 10, 2: 10, 3: 15}

        # Early stop threshold
        early_stop_count = 5

        # Max retries for rate limiting
        max_retries = self.settings.get("max_retries", 2)

        # For uniques and currency, get quick price from poe2scout (on-demand)
        decky.logger.info(f"poe2scout check: rarity={rarity}, item_name={item_name}")
        if rarity in ("Unique", "Currency") and item_name:
            try:
                decky.logger.info(f"poe2scout lookup: {item_name}")
                scout_result = await Plugin.get_poe2scout_price(self, item_name, rarity)
                if scout_result.get("success"):
                    result["poe2scout_price"] = scout_result
                    decky.logger.info(f"poe2scout price: {scout_result.get('price', {}).get('exalted')} exalted")

                    # For uniques with high-confidence poe2scout data, skip Trade API
                    listings_count = scout_result.get("listings", 0)
                    if rarity == "Unique" and listings_count >= 10:
                        decky.logger.info(f"Using poe2scout only for unique (high confidence: {listings_count} listings)")
                        # Cache this result
                        self.search_cache.put(item_name, base_type, rarity, modifiers, result)
                        return result
                else:
                    decky.logger.info(f"poe2scout no result: {scout_result.get('error')}")
            except Exception as e:
                decky.logger.warning(f"poe2scout lookup failed: {e}")

        # Determine which item identifier to use for Trade API
        # For uniques: use name
        # For rares: use base_type
        # For magic: don't use type (contains affixes like "Plate Belt of the Starfish")
        search_name = item_name if rarity == "Unique" else None
        search_type = None if rarity == "Magic" else base_type

        # Progressive tier search
        total_found = 0
        for tier in [0, 1, 2, 3]:
            try:
                # Build query for this tier
                query = await Plugin.build_tiered_query(
                    self, tier, search_name, search_type, modifiers, item_level
                )

                # Skip tier 0, 1, 2 if no modifiers
                if tier < 3 and not modifiers:
                    decky.logger.info(f"Skipping tier {tier}: no modifiers")
                    continue

                # Skip tier 3 for magic items (we don't have clean base type)
                if tier == 3 and rarity == "Magic":
                    decky.logger.info(f"Skipping tier 3 for magic items: base type contains affixes")
                    continue

                # Search with retry logic
                search_result = None
                for attempt in range(max_retries + 1):
                    search_result = await Plugin.search_trade_api(self, query)
                    result["total_searches"] += 1

                    if search_result.get("success"):
                        break

                    # Check if rate limited
                    if "rate limit" in search_result.get("error", "").lower():
                        retry_after = search_result.get("retry_after", 5)
                        if attempt < max_retries:
                            decky.logger.info(f"Tier {tier} rate limited, retry {attempt + 1}/{max_retries} after {retry_after:.0f}s")
                            await asyncio.sleep(retry_after)
                        else:
                            decky.logger.warning(f"Tier {tier} exhausted retries, moving to next tier")
                    else:
                        # Non-retriable error
                        break

                if not search_result or not search_result.get("success"):
                    decky.logger.warning(f"Tier {tier} search failed: {search_result.get('error') if search_result else 'No result'}")
                    continue

                tier_total = search_result.get("total", 0)
                result_ids = search_result.get("result", [])

                # Fetch listings (with limit)
                listings = []
                if result_ids:
                    fetch_result = await Plugin.fetch_trade_listings(
                        self,
                        result_ids,
                        search_result.get("id", ""),
                        limit=fetch_limits.get(tier, 10)
                    )
                    if fetch_result.get("success"):
                        listings = fetch_result.get("listings", [])
                        # Store icon from first tier with results
                        if result["trade_icon"] is None and fetch_result.get("icon"):
                            result["trade_icon"] = fetch_result.get("icon")
                            decky.logger.info(f"Got trade icon: {result['trade_icon'][:50]}...")

                # Add tier result
                tier_result = {
                    "tier": tier,
                    "name": tier_info[tier]["name"],
                    "description": tier_info[tier]["description"],
                    "total": tier_total,
                    "listings": listings,
                    "fetched": len(listings)
                }
                result["tiers"].append(tier_result)
                result["stopped_at_tier"] = tier

                total_found += tier_total
                decky.logger.info(f"Tier {tier}: {tier_total} total, {len(listings)} fetched")

                # Early stop if we have enough results
                if tier_total >= early_stop_count:
                    decky.logger.info(f"Early stop at tier {tier}: {tier_total} >= {early_stop_count}")
                    break

            except Exception as e:
                decky.logger.error(f"Tier {tier} error: {e}")
                import traceback
                decky.logger.error(traceback.format_exc())
                continue

        # If no tiers found anything
        if not result["tiers"]:
            result["error"] = "No listings found in any tier"

        # Cache the result (even if empty, to avoid repeated failed searches)
        if result["tiers"] or result["poe2scout_price"]:
            self.search_cache.put(item_name, base_type, rarity, modifiers, result)

        decky.logger.info(f"Progressive search complete: {len(result['tiers'])} tiers, {result['total_searches']} searches")
        return result

    # =========================================================================
    # SETTINGS MANAGEMENT
    # =========================================================================

    async def ping(self) -> Dict[str, Any]:
        """Simple test method"""
        import decky
        decky.logger.info("ping called!")
        return {"success": True, "message": "pong"}

    async def get_settings(self) -> Dict[str, Any]:
        """Return current settings"""
        import decky
        decky.logger.info("get_settings called")
        return self.settings

    async def update_settings(self, new_settings: Dict[str, Any]) -> Dict[str, Any]:
        """Update and save settings with validation"""
        import decky

        # Settings schema with types and constraints
        SETTINGS_SCHEMA = {
            "league": {"type": str, "required": False},
            "useTradeApi": {"type": bool, "required": False},
            "usePoe2Scout": {"type": bool, "required": False},
            "autoCheckOnOpen": {"type": bool, "required": False},
            "poesessid": {"type": str, "required": False, "max_length": 64},
            "search_min_interval": {"type": (int, float), "required": False, "min": 0.5, "max": 60.0},
            "fetch_min_interval": {"type": (int, float), "required": False, "min": 0.1, "max": 60.0},
            "max_retries": {"type": int, "required": False, "min": 0, "max": 10},
            "cache_ttl_seconds": {"type": int, "required": False, "min": 60, "max": 3600},
        }

        # Validate each setting
        validated = {}
        errors = []
        for key, value in new_settings.items():
            if key not in SETTINGS_SCHEMA:
                decky.logger.warning(f"Unknown setting key: {key}")
                continue

            schema = SETTINGS_SCHEMA[key]
            expected_type = schema["type"]

            # Type check
            if not isinstance(value, expected_type):
                errors.append(f"Invalid type for {key}: expected {expected_type}, got {type(value)}")
                continue

            # String length check
            if isinstance(value, str) and "max_length" in schema:
                if len(value) > schema["max_length"]:
                    errors.append(f"{key} exceeds max length of {schema['max_length']}")
                    continue

            # Numeric range check
            if isinstance(value, (int, float)):
                if "min" in schema and value < schema["min"]:
                    errors.append(f"{key} must be >= {schema['min']}")
                    continue
                if "max" in schema and value > schema["max"]:
                    errors.append(f"{key} must be <= {schema['max']}")
                    continue

            validated[key] = value

        if errors:
            decky.logger.warning(f"Settings validation errors: {errors}")

        # Apply validated settings
        if validated:
            self.settings.update(validated)
            # Save settings inline
            try:
                settings_path = os.path.join(decky.DECKY_PLUGIN_SETTINGS_DIR, "settings.json")
                os.makedirs(os.path.dirname(settings_path), exist_ok=True)

                # SECURITY: Create a copy for saving that excludes empty poesessid
                # to avoid creating the field in settings.json unnecessarily
                settings_to_save = dict(self.settings)
                if not settings_to_save.get("poesessid"):
                    settings_to_save.pop("poesessid", None)

                with open(settings_path, "w") as f:
                    json.dump(settings_to_save, f, indent=2)
            except Exception as e:
                decky.logger.error(f"Failed to save settings: {e}")
                return {"success": False, "error": f"Failed to save: {e}"}

        return {"success": True, "settings": self.settings, "validation_errors": errors if errors else None}

    async def get_available_leagues(self) -> Dict[str, Any]:
        """Fetch available leagues from Trade API"""
        import decky
        # Default leagues for PoE2
        default_leagues = [
            {"id": "Fate of the Vaal", "text": "Fate of the Vaal"},
            {"id": "HC Fate of the Vaal", "text": "HC Fate of the Vaal"},
            {"id": "Standard", "text": "Standard"},
            {"id": "Hardcore", "text": "Hardcore"}
        ]

        url = "https://www.pathofexile.com/api/trade2/data/leagues"

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

                # Filter for PoE2 leagues
                leagues = []
                for league in data.get("result", []):
                    # PoE2 leagues have realm "poe2" or contain "poe2" in id
                    if league.get("realm") == "poe2" or "poe2" in league.get("id", "").lower():
                        leagues.append({
                            "id": league["id"].replace("poe2/", ""),
                            "text": league.get("text", league["id"])
                        })

                # Add defaults if no leagues found
                if not leagues:
                    leagues = default_leagues

                return {"success": True, "leagues": leagues}

        except Exception as e:
            decky.logger.error(f"Failed to fetch leagues: {e}")
            return {
                "success": True,
                "leagues": default_leagues
            }


    # =========================================================================
    # DEBUG / LOGS
    # =========================================================================

    async def get_logs(self, lines: int = 50) -> Dict[str, Any]:
        """Get recent log entries for debugging"""
        import decky
        try:
            log_path = decky.DECKY_PLUGIN_LOG
            if os.path.exists(log_path):
                with open(log_path, "r") as f:
                    all_lines = f.readlines()
                    recent = all_lines[-lines:] if len(all_lines) > lines else all_lines
                    return {
                        "success": True,
                        "logs": "".join(recent),
                        "path": log_path
                    }
            else:
                return {
                    "success": False,
                    "logs": f"Log file not found at {log_path}",
                    "path": log_path
                }
        except Exception as e:
            return {
                "success": False,
                "logs": f"Error reading logs: {e}",
                "path": ""
            }

    async def test_clipboard(self) -> Dict[str, Any]:
        """Test clipboard access and return debug info"""
        import decky
        decky.logger.info("test_clipboard method called")

        try:
            import shutil

            debug_info = {
                "wl_paste_available": shutil.which("wl-paste") is not None,
                "xclip_available": shutil.which("xclip") is not None,
                "xsel_available": shutil.which("xsel") is not None,
                "xdotool_available": shutil.which("xdotool") is not None,
                "ydotool_available": shutil.which("ydotool") is not None,
                "wayland_display": os.environ.get("WAYLAND_DISPLAY", "not set"),
                "display": os.environ.get("DISPLAY", "not set"),
                "xdg_session_type": os.environ.get("XDG_SESSION_TYPE", "not set"),
            }

            # Try to read clipboard
            result = await Plugin.read_clipboard(self)
            debug_info["clipboard_result"] = result

            return debug_info
        except Exception as e:
            decky.logger.error(f"test_clipboard unexpected error: {e}")
            import traceback
            decky.logger.error(traceback.format_exc())
            return {"error": f"Unexpected error: {e}"}

    async def log_debug(self, message: str) -> None:
        """Log debug message from frontend"""
        import decky
        decky.logger.info(f"[Frontend Debug] {message}")

    async def copy_to_clipboard(self, text: str) -> Dict[str, Any]:
        """Copy text to clipboard"""
        import decky
        decky.logger.info(f"copy_to_clipboard called ({len(text)} chars)")

        try:
            env = os.environ.copy()
            env["DISPLAY"] = ":0"
            env["XDG_RUNTIME_DIR"] = "/run/user/1000"

            # Try xclip
            proc = await asyncio.create_subprocess_exec(
                "xclip", "-selection", "clipboard",
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=env
            )
            await proc.communicate(input=text.encode("utf-8"))

            if proc.returncode == 0:
                return {"success": True}

            return {"success": False, "error": "xclip failed"}
        except Exception as e:
            decky.logger.error(f"copy_to_clipboard error: {e}")
            return {"success": False, "error": str(e)}

    async def paste_to_game_chat(self, text: str, send: bool = False) -> Dict[str, Any]:
        """
        Paste text into game chat.
        1. Copy text to clipboard
        2. Wait a moment for Decky menu to close
        3. Simulate Enter (open chat)
        4. Simulate Ctrl+V (paste)
        5. Optionally simulate Enter again (send)
        """
        import decky
        decky.logger.info(f"paste_to_game_chat called: {text[:50]}...")

        try:
            env = os.environ.copy()
            env["DISPLAY"] = ":0"
            env["XDG_RUNTIME_DIR"] = "/run/user/1000"

            # Step 1: Copy text to clipboard
            proc = await asyncio.create_subprocess_exec(
                "xclip", "-selection", "clipboard",
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=env
            )
            await proc.communicate(input=text.encode("utf-8"))

            if proc.returncode != 0:
                return {"success": False, "error": "Failed to copy to clipboard"}

            decky.logger.info("Text copied to clipboard")

            # Step 2: Wait for Decky menu to close and game to regain focus
            await asyncio.sleep(0.5)

            # Step 3: Simulate Enter to open chat
            proc = await asyncio.create_subprocess_exec(
                "xdotool", "key", "Return",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=env
            )
            await asyncio.wait_for(proc.communicate(), timeout=3.0)
            decky.logger.info("Sent Enter to open chat")

            await asyncio.sleep(0.1)

            # Step 4: Simulate Ctrl+V to paste
            proc = await asyncio.create_subprocess_exec(
                "xdotool", "key", "ctrl+v",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=env
            )
            await asyncio.wait_for(proc.communicate(), timeout=3.0)
            decky.logger.info("Sent Ctrl+V to paste")

            # Step 5: Optionally send the message
            if send:
                await asyncio.sleep(0.1)
                proc = await asyncio.create_subprocess_exec(
                    "xdotool", "key", "Return",
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    env=env
                )
                await asyncio.wait_for(proc.communicate(), timeout=3.0)
                decky.logger.info("Sent Enter to send message")

            return {"success": True}

        except Exception as e:
            decky.logger.error(f"paste_to_game_chat error: {e}")
            import traceback
            decky.logger.error(traceback.format_exc())
            return {"success": False, "error": str(e)}

    async def simulate_copy(self) -> Dict[str, Any]:
        """
        Simulate Ctrl+C keypress to copy item from game.
        Tries ydotool (Wayland) first, then xdotool (X11).
        """
        import decky
        decky.logger.info("simulate_copy method called")

        try:
            # Set up environment for Steam Deck Gaming Mode
            env = os.environ.copy()
            if "WAYLAND_DISPLAY" not in env:
                env["WAYLAND_DISPLAY"] = "wayland-1"
            if "DISPLAY" not in env:
                env["DISPLAY"] = ":0"
            if "XDG_RUNTIME_DIR" not in env:
                env["XDG_RUNTIME_DIR"] = "/run/user/1000"

            # Try ydotool first (works on Wayland/Steam Deck)
            try:
                decky.logger.info("Trying ydotool for Ctrl+C simulation")
                proc = await asyncio.create_subprocess_exec(
                    "ydotool", "key", "29:1", "46:1", "46:0", "29:0",  # Ctrl down, C down, C up, Ctrl up
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    env=env
                )
                stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=3.0)

                if proc.returncode == 0:
                    # Wait a moment for clipboard to update
                    await asyncio.sleep(0.2)
                    decky.logger.info("ydotool Ctrl+C successful")
                    return {"success": True, "method": "ydotool"}
                else:
                    decky.logger.warning(f"ydotool failed: {stderr.decode()}")
            except FileNotFoundError:
                decky.logger.warning("ydotool not found")
            except Exception as e:
                decky.logger.warning(f"ydotool error: {e}")

            # Try xdotool (works on X11/XWayland)
            try:
                decky.logger.info("Trying xdotool for Ctrl+C simulation")
                proc = await asyncio.create_subprocess_exec(
                    "xdotool", "key", "ctrl+c",
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    env=env
                )
                stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=3.0)

                if proc.returncode == 0:
                    await asyncio.sleep(0.2)
                    decky.logger.info("xdotool Ctrl+C successful")
                    return {"success": True, "method": "xdotool"}
                else:
                    decky.logger.warning(f"xdotool failed: {stderr.decode()}")
            except FileNotFoundError:
                decky.logger.warning("xdotool not found")
            except Exception as e:
                decky.logger.warning(f"xdotool error: {e}")

            # Try wtype (Wayland native)
            try:
                decky.logger.info("Trying wtype for Ctrl+C simulation")
                proc = await asyncio.create_subprocess_exec(
                    "wtype", "-M", "ctrl", "-P", "c", "-p", "c", "-m", "ctrl",
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    env=env
                )
                stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=3.0)

                if proc.returncode == 0:
                    await asyncio.sleep(0.2)
                    decky.logger.info("wtype Ctrl+C successful")
                    return {"success": True, "method": "wtype"}
                else:
                    decky.logger.warning(f"wtype failed: {stderr.decode()}")
            except FileNotFoundError:
                decky.logger.warning("wtype not found")
            except Exception as e:
                decky.logger.warning(f"wtype error: {e}")

            return {
                "success": False,
                "error": "No tool available to simulate Ctrl+C. Install ydotool: sudo pacman -S ydotool"
            }
        except Exception as e:
            decky.logger.error(f"simulate_copy unexpected error: {e}")
            import traceback
            decky.logger.error(traceback.format_exc())
            return {"success": False, "error": f"Unexpected error: {e}"}
