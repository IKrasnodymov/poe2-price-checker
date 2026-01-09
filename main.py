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
from backend import (
    AdaptiveRateLimiter,
    SearchResultCache,
    ClipboardManager,
    PriceAnalytics,
    PriceLearningStore,
    ScanHistoryStore,
    PriceHistoryStore,
    StatCacheStore,
    SettingsStore,
)


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
    STAT_CACHE_FILE = "stat_cache.json"  # Cached stat IDs from Trade API

    # Price learning data - collected from exact matches to improve estimates
    # Structure: {item_class: [{quality_score, mods, price, currency, timestamp}]}
    price_learning: Dict[str, List[Dict[str, Any]]] = None  # type: ignore
    MAX_LEARNING_RECORDS_PER_CLASS = 100  # Keep last 100 records per item class
    PRICE_LEARNING_VERSION = 2  # Version for data schema (increment to reset old data)

    # poe2scout.com cache - loaded once at startup
    poe2scout_cache: Dict[str, Any] = None  # type: ignore  # {items: {name: data}, currency: {apiId: data}}
    poe2scout_divine_price: float = 100.0  # Divine price in exalted from /api/leagues

    # Rate limit tracking - when rate limited, stores the expiry timestamp
    rate_limit_until: float = 0.0  # Unix timestamp when rate limit expires

    # Debug: store last fetched listings for debugging
    last_debug_listings: List[Dict[str, Any]] = None  # type: ignore

    # New module instances (initialized in _main)
    clipboard_manager: ClipboardManager = None  # type: ignore
    price_analytics: PriceAnalytics = None  # type: ignore
    price_learning_store: PriceLearningStore = None  # type: ignore
    scan_history_store: ScanHistoryStore = None  # type: ignore
    price_history_store: PriceHistoryStore = None  # type: ignore
    stat_cache_store: StatCacheStore = None  # type: ignore

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

        # Initialize new backend modules
        def _decky_logger(msg: str) -> None:
            decky.logger.info(msg)

        settings_dir = decky.DECKY_PLUGIN_SETTINGS_DIR

        Plugin.clipboard_manager = ClipboardManager(logger=_decky_logger)
        Plugin.price_analytics = PriceAnalytics(logger=_decky_logger)
        Plugin.price_learning_store = PriceLearningStore(settings_dir, logger=_decky_logger)
        Plugin.scan_history_store = ScanHistoryStore(settings_dir, logger=_decky_logger)
        Plugin.price_history_store = PriceHistoryStore(settings_dir, logger=_decky_logger)
        Plugin.stat_cache_store = StatCacheStore(settings_dir, logger=_decky_logger)

        decky.logger.info("Backend modules initialized")

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

        # Load price learning data
        Plugin.price_learning = {}
        try:
            await Plugin.load_price_learning(self)
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
    # CLIPBOARD OPERATIONS (delegated to ClipboardManager)
    # =========================================================================

    async def read_clipboard(self) -> Dict[str, Any]:
        """Read item text from clipboard - delegated to ClipboardManager"""
        import decky
        decky.logger.info("read_clipboard method called")
        return await Plugin.clipboard_manager.read_clipboard()

    def _is_poe_item(self, text: str) -> bool:
        """Check if text appears to be a PoE2 item - delegated to ClipboardManager"""
        return ClipboardManager.is_poe_item(text)

    # Legacy compatibility - keep the original validation logic
    @staticmethod
    def _is_poe_item_static(text: str) -> bool:
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

    def get_stat_cache_path(self) -> str:
        """Get path to stat cache file"""
        import decky
        return os.path.join(decky.DECKY_PLUGIN_SETTINGS_DIR, Plugin.STAT_CACHE_FILE)

    async def load_stat_cache_from_disk(self) -> bool:
        """Load stat cache from store. Returns True if loaded successfully."""
        import decky
        Plugin.stat_cache_store.load()
        Plugin.stat_cache = Plugin.stat_cache_store.get_cache()
        count = len(Plugin.stat_cache)
        decky.logger.info(f"Loaded {count} stat IDs from disk cache")
        return count > 0

    async def save_stat_cache_to_disk(self) -> bool:
        """Save stat cache to store. Returns True if saved successfully."""
        import decky
        success = Plugin.stat_cache_store.set_cache(Plugin.stat_cache)
        decky.logger.info(f"Saved {len(Plugin.stat_cache)} stat IDs to disk cache")
        return success

    async def load_stat_ids_from_api(self) -> bool:
        """Load stat IDs from Trade API. Returns True if loaded successfully."""
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

                new_cache = {}
                count = 0
                for group in data.get("result", []):
                    for entry in group.get("entries", []):
                        stat_id = entry.get("id", "")
                        text = entry.get("text", "")

                        if stat_id and text:
                            import re
                            normalized = re.sub(r'\d+(?:\.\d+)?', '#', text)
                            normalized = normalized.replace('+', '').strip().lower()
                            new_cache[normalized] = stat_id
                            count += 1

                Plugin.stat_cache = new_cache
                decky.logger.info(f"Loaded {count} stat IDs from API")

                # Save to disk for next time
                await Plugin.save_stat_cache_to_disk(self)
                return True

        except Exception as e:
            decky.logger.error(f"Failed to load stat IDs from API: {e}")
            import traceback
            decky.logger.error(traceback.format_exc())
            return False

    async def load_stat_ids(self) -> None:
        """Load stat IDs: first from disk cache, then try to update from API"""
        import decky

        # First, try to load from disk cache
        has_cache = await Plugin.load_stat_cache_from_disk(self)

        # Then try to update from API
        api_success = await Plugin.load_stat_ids_from_api(self)

        if not api_success and not has_cache:
            decky.logger.warning("No stat IDs available - modifiers won't match!")
        elif not api_success and has_cache:
            decky.logger.info("Using cached stat IDs (API unavailable)")

    async def reload_stat_ids(self) -> Dict[str, Any]:
        """Force reload stat IDs from API. Called from UI."""
        import decky
        decky.logger.info("Manual reload of stat IDs requested")

        success = await Plugin.load_stat_ids_from_api(self)
        count = len(Plugin.stat_cache) if Plugin.stat_cache else 0

        return {
            "success": success,
            "count": count,
            "message": f"Loaded {count} stat IDs" if success else "Failed to load stat IDs from API"
        }

    async def get_stat_cache_status(self) -> Dict[str, Any]:
        """Get status of stat cache for UI display"""
        import decky
        count = len(Plugin.stat_cache) if Plugin.stat_cache else 0
        cache_path = Plugin.get_stat_cache_path(self)

        # Check if disk cache exists
        disk_cache_exists = os.path.exists(cache_path)
        disk_cache_time = None
        if disk_cache_exists:
            try:
                with open(cache_path, "r") as f:
                    data = json.load(f)
                    disk_cache_time = data.get("timestamp")
            except Exception:
                pass

        return {
            "success": True,
            "loaded": count > 0,
            "count": count,
            "diskCacheExists": disk_cache_exists,
            "diskCacheTimestamp": disk_cache_time
        }

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
        """Load price history from store"""
        import decky
        Plugin.price_history = Plugin.price_history_store.load()
        decky.logger.info(f"Loaded {len(Plugin.price_history)} items from price history")

    async def save_price_history(self) -> None:
        """Save price history to store"""
        import decky
        Plugin.price_history_store.data = Plugin.price_history
        Plugin.price_history_store.save()
        decky.logger.info(f"Saved {len(Plugin.price_history)} items to price history")

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
        """Load scan history from store"""
        import decky
        data = Plugin.scan_history_store.load()
        Plugin.scan_history = data if isinstance(data, list) else []
        decky.logger.info(f"Loaded {len(Plugin.scan_history)} scan history records")

    async def save_scan_history(self) -> None:
        """Save scan history to store"""
        import decky
        Plugin.scan_history_store._data = Plugin.scan_history
        Plugin.scan_history_store._loaded = True
        Plugin.scan_history_store.save()
        decky.logger.info(f"Saved {len(Plugin.scan_history)} scan history records")

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

    # =========================================================================
    # PRICE LEARNING (Collecting data for better estimates)
    # =========================================================================

    def _get_price_learning_path(self) -> str:
        """Get path to price learning data file"""
        import decky
        return os.path.join(decky.DECKY_PLUGIN_SETTINGS_DIR, "price_learning.json")

    async def load_price_learning(self) -> None:
        """Load price learning data from store (handles versioning automatically)"""
        import decky
        Plugin.price_learning = Plugin.price_learning_store.load()
        total = Plugin.price_learning_store.get_total_count()
        decky.logger.info(f"Loaded price learning data: {total} records")

    async def save_price_learning(self) -> None:
        """Save price learning data to store"""
        import decky
        Plugin.price_learning_store._data = Plugin.price_learning
        Plugin.price_learning_store._loaded = True
        Plugin.price_learning_store.save()
        total = sum(len(v) for v in Plugin.price_learning.values() if isinstance(v, list))
        decky.logger.info(f"Saved price learning data: {total} records")

    async def add_price_learning_record(
        self,
        item_class: str,
        base_type: str,
        quality_score: int,
        mod_categories: List[str],
        mod_patterns: List[Dict[str, Any]],
        price: float,
        currency: str,
        search_tier: int,
        ilvl: Optional[int] = None,
        rarity: Optional[str] = None,
        socket_count: Optional[int] = None,
        total_dps: Optional[float] = None,
        listings_count: int = 0,
        # New v3 fields for expanded data capture
        armour: Optional[int] = None,
        evasion: Optional[int] = None,
        energy_shield: Optional[int] = None,
        block: Optional[int] = None,
        spirit: Optional[int] = None,
        pdps: Optional[float] = None,
        edps: Optional[float] = None,
        linked_sockets: Optional[int] = None,
        implicit_patterns: Optional[List[Dict[str, Any]]] = None,
        corrupted: bool = False
    ) -> Dict[str, Any]:
        """
        Add a price learning record for all scans.
        This helps build statistics and price estimates.

        mod_patterns: List of detailed modifier patterns with tier info
            [{pattern: str, tier: int|None, category: str, value: int|None}]

        v2 fields:
            ilvl: Item level
            rarity: "unique" | "rare" | "magic" | "normal"
            socket_count: Number of sockets
            total_dps: Total DPS for weapons
            listings_count: Number of listings found (confidence indicator)

        v3 fields (expanded data capture):
            armour: Armour value for armor pieces
            evasion: Evasion value for armor pieces
            energy_shield: Energy shield value for armor pieces
            block: Block chance % for shields
            spirit: Spirit value
            pdps: Physical DPS for weapons
            edps: Elemental DPS for weapons
            linked_sockets: Number of linked sockets
            implicit_patterns: Implicit modifier patterns (same format as mod_patterns)
            corrupted: Whether item is corrupted
        """
        import decky

        # Normalize item class
        item_class_key = item_class.lower().replace(" ", "_")

        # Store price in original currency (no conversion needed)
        record = {
            "timestamp": int(time.time()),
            "base_type": base_type,
            "quality_score": quality_score,
            "mod_categories": mod_categories,
            "mod_patterns": mod_patterns,
            "price": price,
            "currency": currency,
            "search_tier": search_tier,
            "ilvl": ilvl,
            "rarity": rarity,
            "socket_count": socket_count,
            "total_dps": total_dps,
            "listings_count": listings_count,
            # v3 fields
            "armour": armour,
            "evasion": evasion,
            "energy_shield": energy_shield,
            "block": block,
            "spirit": spirit,
            "pdps": pdps,
            "edps": edps,
            "linked_sockets": linked_sockets,
            "implicit_patterns": implicit_patterns or [],
            "corrupted": corrupted
        }

        # Add to learning data
        if item_class_key not in Plugin.price_learning:
            Plugin.price_learning[item_class_key] = []

        Plugin.price_learning[item_class_key].insert(0, record)

        # Trim to max size
        if len(Plugin.price_learning[item_class_key]) > Plugin.MAX_LEARNING_RECORDS_PER_CLASS:
            Plugin.price_learning[item_class_key] = Plugin.price_learning[item_class_key][:Plugin.MAX_LEARNING_RECORDS_PER_CLASS]

        # Save to file
        await Plugin.save_price_learning(self)

        decky.logger.info(f"Added price learning: {item_class} @ {quality_score}q = {price:.1f} {currency}")
        return {"success": True}

    async def get_price_estimate(
        self,
        item_class: str,
        quality_score: int
    ) -> Dict[str, Any]:
        """
        Get estimated price based on learned data.
        Returns estimate if we have enough data, otherwise returns null.
        """
        import decky

        item_class_key = item_class.lower().replace(" ", "_")
        records = Plugin.price_learning.get(item_class_key, [])

        if len(records) < 5:
            return {"success": False, "reason": "Not enough data", "count": len(records)}

        # Find records with similar quality score (±15 points)
        similar = [r for r in records if abs(r["quality_score"] - quality_score) <= 15]

        if len(similar) < 3:
            # Fall back to all records for this class
            similar = records

        # Helper to normalize price to exalted equivalent
        def normalize_price(r):
            raw_price = r.get("price", r.get("price_exalted", 0))
            currency = r.get("currency", r.get("original_currency", "exalted"))
            if currency.lower() in ["divine", "divine-orb", "div"]:
                return raw_price * 0.5
            elif currency.lower() in ["chaos", "chaos-orb"]:
                return raw_price / 100.0
            return raw_price

        # Calculate price statistics
        prices = [normalize_price(r) for r in similar]
        avg_price = sum(prices) / len(prices)
        min_price = min(prices)
        max_price = max(prices)

        decky.logger.info(f"Price estimate for {item_class} @ {quality_score}q: {avg_price:.1f}ex (from {len(similar)} records)")

        return {
            "success": True,
            "min": min_price,
            "max": max_price,
            "average": avg_price,
            "currency": "exalted",
            "sample_count": len(similar),
            "total_records": len(records)
        }

    async def get_market_insights(self) -> Dict[str, Any]:
        """Get market insights - delegated to PriceAnalytics"""
        import decky
        decky.logger.info("get_market_insights called")
        records_by_class = Plugin._get_learning_records_by_class()
        return Plugin.price_analytics.get_market_insights(records_by_class)

    async def get_hot_patterns(self, limit: int = 15) -> Dict[str, Any]:
        """Get hot modifier patterns - delegated to PriceAnalytics"""
        import decky
        decky.logger.info(f"get_hot_patterns called (limit={limit})")
        records_by_class = Plugin._get_learning_records_by_class()
        return Plugin.price_analytics.get_hot_patterns(records_by_class, limit)

    @staticmethod
    def _get_learning_records_by_class() -> Dict[str, List[Dict[str, Any]]]:
        """Extract learning records by class, excluding version field"""
        result = {}
        for key, value in (Plugin.price_learning or {}).items():
            if not key.startswith("_") and isinstance(value, list):
                result[key] = value
        return result

    @staticmethod
    def _normalize_price_to_exalted(price: float, currency: str) -> float:
        """Normalize any currency to exalted equivalent"""
        currency = currency.lower() if currency else "exalted"
        if currency in ["divine", "divine-orb", "div"]:
            return price * 0.5
        elif currency in ["chaos", "chaos-orb", "c"]:
            return price / 100.0
        return price

    @staticmethod
    def _calculate_median(values: List[float]) -> float:
        """Calculate median of a list of values"""
        if not values:
            return 0.0
        sorted_vals = sorted(values)
        n = len(sorted_vals)
        if n % 2 == 1:
            return sorted_vals[n // 2]
        return (sorted_vals[n // 2 - 1] + sorted_vals[n // 2]) / 2

    @staticmethod
    def _calculate_confidence_weight(record: Dict[str, Any]) -> float:
        """
        Calculate confidence weight for a record.
        Higher weight = more reliable data point.
        """
        weight = 1.0

        # Search tier weighting (exact match = highest confidence)
        search_tier = record.get("search_tier", 3)
        tier_weights = {0: 1.5, 1: 1.2, 2: 0.9, 3: 0.6}
        weight *= tier_weights.get(search_tier, 0.5)

        # Listings count weighting (more listings = more confidence)
        listings = record.get("listings_count", 1)
        if listings >= 10:
            weight *= 1.3
        elif listings >= 5:
            weight *= 1.1
        elif listings <= 2:
            weight *= 0.7

        return weight

    async def get_learning_stats(self) -> Dict[str, Any]:
        """Get learning statistics - delegated to PriceAnalytics"""
        import decky
        decky.logger.info("get_learning_stats called")
        records_by_class = Plugin._get_learning_records_by_class()
        return Plugin.price_analytics.get_learning_stats(records_by_class)

    async def get_price_trends(self, days: int = 7) -> Dict[str, Any]:
        """Get price trends - delegated to PriceAnalytics"""
        import decky
        decky.logger.info(f"get_price_trends called (days={days})")
        records_by_class = Plugin._get_learning_records_by_class()
        return Plugin.price_analytics.get_price_trends(records_by_class, days)

    async def get_quality_correlation(self) -> Dict[str, Any]:
        """Get quality-price correlation - delegated to PriceAnalytics"""
        import decky
        decky.logger.info("get_quality_correlation called")
        records_by_class = Plugin._get_learning_records_by_class()
        return Plugin.price_analytics.get_quality_correlation(records_by_class)

    async def get_price_dynamics(
        self,
        item_name: str,
        basetype: str,
        rarity: str
    ) -> Dict[str, Any]:
        """Get price dynamics - delegated to PriceAnalytics"""
        import decky
        decky.logger.info(f"get_price_dynamics called: {item_name}, {basetype}, {rarity}")
        return Plugin.price_analytics.get_price_dynamics(
            Plugin.scan_history or [],
            Plugin.price_history or {},
            item_name,
            basetype,
            rarity
        )

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
                Plugin.rate_limit_until = time.time() + wait_time
                decky.logger.warning(f"Rate limited (429). Backing off for {wait_time:.1f}s until {time.strftime('%H:%M:%S', time.localtime(Plugin.rate_limit_until))}")
                return {
                    "success": False,
                    "error": f"Rate limited. Try again at {time.strftime('%H:%M', time.localtime(Plugin.rate_limit_until))}",
                    "retry_after": wait_time,
                    "rate_limited": True
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
                        account_data = listing.get("account", {})
                        account = account_data.get("name", "Unknown")

                        # Extract character name for /hideout command
                        character = account_data.get("lastCharacterName", "")

                        # Extract online status
                        online_data = account_data.get("online")
                        online_status = None
                        if online_data:
                            online_status = online_data.get("status") if isinstance(online_data, dict) else online_data

                        all_listings.append({
                            "amount": amount,
                            "currency": currency,
                            "account": account,
                            "character": character,
                            "online": online_status,
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
                    Plugin.rate_limit_until = time.time() + wait_time
                    decky.logger.warning(f"Fetch rate limited (429). Backing off for {wait_time:.1f}s until {time.strftime('%H:%M:%S', time.localtime(Plugin.rate_limit_until))}")
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

        # Helper function to convert price to chaos for sorting
        def get_chaos_value(listing):
            amount = listing.get("amount", 0) or 0
            currency = listing.get("currency", "chaos")
            if currency:
                currency = currency.lower()
            rate = Plugin.currency_rates.get(currency, 1.0)
            return amount * rate

        # Add chaosValue to each listing for frontend use
        for lst in all_listings:
            lst["chaosValue"] = get_chaos_value(lst)

        # Sort by chaos value (proper price comparison across currencies)
        all_listings.sort(key=get_chaos_value)

        # Store first 5 listings for debug
        Plugin.last_debug_listings = all_listings[:5] if all_listings else []

        # Log first 3 after sorting with chaos values
        for i, lst in enumerate(all_listings[:3]):
            decky.logger.info(f"Listing {i+1}: {lst.get('amount')} {lst.get('currency')} (~{lst.get('chaosValue', 0):.1f}c)")

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
        item_level: Optional[int] = None,
        socket_count: Optional[int] = None,
        linked_sockets: Optional[int] = None,
        pdps: Optional[float] = None,
        edps: Optional[float] = None,
        gem_level: Optional[int] = None,
        # New filters
        quality: Optional[int] = None,
        armour: Optional[int] = None,
        evasion: Optional[int] = None,
        energy_shield: Optional[int] = None,
        block: Optional[int] = None,
        spirit: Optional[int] = None,
        attack_speed: Optional[float] = None,
        crit_chance: Optional[float] = None,
        corrupted: Optional[bool] = None,
        rarity: Optional[str] = None
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

        # Add rarity filter for unique items
        if rarity == "Unique":
            if "type_filters" not in query["query"]["filters"]:
                query["query"]["filters"]["type_filters"] = {"filters": {}}
            query["query"]["filters"]["type_filters"]["filters"]["rarity"] = {"option": "unique"}
            decky.logger.info("Added rarity filter: unique")

        # Add item level filter (type_filters, not misc_filters)
        if item_level and item_level > 1:
            min_ilvl = max(1, item_level - 10)
            if "type_filters" not in query["query"]["filters"]:
                query["query"]["filters"]["type_filters"] = {"filters": {}}
            query["query"]["filters"]["type_filters"]["filters"]["ilvl"] = {"min": min_ilvl}

        # Add rune_sockets filter for items with sockets (equipment_filters)
        if socket_count and socket_count >= 2:
            min_sockets = max(1, socket_count - 1)  # Flexible: allow 1 less socket
            if "equipment_filters" not in query["query"]["filters"]:
                query["query"]["filters"]["equipment_filters"] = {"filters": {}}
            query["query"]["filters"]["equipment_filters"]["filters"]["rune_sockets"] = {"min": min_sockets}
            decky.logger.info(f"Socket filter: min {min_sockets} rune sockets")

        # Add DPS filters for weapons (equipment_filters)
        if pdps and pdps > 0:
            min_pdps = int(pdps * 0.7)  # 70% of item's pDPS
            if "equipment_filters" not in query["query"]["filters"]:
                query["query"]["filters"]["equipment_filters"] = {"filters": {}}
            query["query"]["filters"]["equipment_filters"]["filters"]["pdps"] = {"min": min_pdps}
            decky.logger.info(f"pDPS filter: min {min_pdps}")

        if edps and edps > 0:
            min_edps = int(edps * 0.7)  # 70% of item's eDPS
            if "equipment_filters" not in query["query"]["filters"]:
                query["query"]["filters"]["equipment_filters"] = {"filters": {}}
            query["query"]["filters"]["equipment_filters"]["filters"]["edps"] = {"min": min_edps}
            decky.logger.info(f"eDPS filter: min {min_edps}")

        # Add gem level filter (misc_filters)
        if gem_level and gem_level > 1:
            if "misc_filters" not in query["query"]["filters"]:
                query["query"]["filters"]["misc_filters"] = {"filters": {}}
            query["query"]["filters"]["misc_filters"]["filters"]["gem_level"] = {"min": gem_level}
            decky.logger.info(f"Gem level filter: min {gem_level}")

        # Add corrupted filter (misc_filters)
        if corrupted is not None:
            if "misc_filters" not in query["query"]["filters"]:
                query["query"]["filters"]["misc_filters"] = {"filters": {}}
            query["query"]["filters"]["misc_filters"]["filters"]["corrupted"] = {"option": str(corrupted).lower()}
            decky.logger.info(f"Corrupted filter: {corrupted}")

        # Add quality filter (type_filters) - for weapons/armour with quality > 0
        if quality and quality > 0:
            min_quality = max(0, quality - 5)  # Allow 5% less quality
            if "type_filters" not in query["query"]["filters"]:
                query["query"]["filters"]["type_filters"] = {"filters": {}}
            query["query"]["filters"]["type_filters"]["filters"]["quality"] = {"min": min_quality}
            decky.logger.info(f"Quality filter: min {min_quality}")

        # Add defence filters (equipment_filters)
        if armour and armour > 50:
            min_ar = int(armour * 0.7)  # 70% of item's armour
            if "equipment_filters" not in query["query"]["filters"]:
                query["query"]["filters"]["equipment_filters"] = {"filters": {}}
            query["query"]["filters"]["equipment_filters"]["filters"]["ar"] = {"min": min_ar}
            decky.logger.info(f"Armour filter: min {min_ar}")

        if evasion and evasion > 50:
            min_ev = int(evasion * 0.7)  # 70% of item's evasion
            if "equipment_filters" not in query["query"]["filters"]:
                query["query"]["filters"]["equipment_filters"] = {"filters": {}}
            query["query"]["filters"]["equipment_filters"]["filters"]["ev"] = {"min": min_ev}
            decky.logger.info(f"Evasion filter: min {min_ev}")

        if energy_shield and energy_shield > 30:
            min_es = int(energy_shield * 0.7)  # 70% of item's ES
            if "equipment_filters" not in query["query"]["filters"]:
                query["query"]["filters"]["equipment_filters"] = {"filters": {}}
            query["query"]["filters"]["equipment_filters"]["filters"]["es"] = {"min": min_es}
            decky.logger.info(f"Energy Shield filter: min {min_es}")

        if block and block > 10:
            min_block = int(block * 0.7)  # 70% of item's block
            if "equipment_filters" not in query["query"]["filters"]:
                query["query"]["filters"]["equipment_filters"] = {"filters": {}}
            query["query"]["filters"]["equipment_filters"]["filters"]["block"] = {"min": min_block}
            decky.logger.info(f"Block filter: min {min_block}")

        if spirit and spirit > 10:
            min_spirit = int(spirit * 0.7)  # 70% of item's spirit
            if "equipment_filters" not in query["query"]["filters"]:
                query["query"]["filters"]["equipment_filters"] = {"filters": {}}
            query["query"]["filters"]["equipment_filters"]["filters"]["spirit"] = {"min": min_spirit}
            decky.logger.info(f"Spirit filter: min {min_spirit}")

        # Add weapon stat filters (equipment_filters)
        if attack_speed and attack_speed > 1.0:
            min_aps = round(attack_speed * 0.9, 2)  # 90% of item's APS
            if "equipment_filters" not in query["query"]["filters"]:
                query["query"]["filters"]["equipment_filters"] = {"filters": {}}
            query["query"]["filters"]["equipment_filters"]["filters"]["aps"] = {"min": min_aps}
            decky.logger.info(f"Attack Speed filter: min {min_aps}")

        if crit_chance and crit_chance > 5.0:
            min_crit = round(crit_chance * 0.8, 1)  # 80% of item's crit
            if "equipment_filters" not in query["query"]["filters"]:
                query["query"]["filters"]["equipment_filters"] = {"filters": {}}
            query["query"]["filters"]["equipment_filters"]["filters"]["crit"] = {"min": min_crit}
            decky.logger.info(f"Crit Chance filter: min {min_crit}")

        # Tier-specific logic
        # Skip modifier filters for unique items (they have fixed mods, search by name only)
        if rarity == "Unique":
            decky.logger.info(f"Unique item: skipping modifier filters, search by name only")
            return query

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
        item_level: Optional[int] = None,
        socket_count: Optional[int] = None,
        linked_sockets: Optional[int] = None,
        pdps: Optional[float] = None,
        edps: Optional[float] = None,
        gem_level: Optional[int] = None,
        # New filters
        quality: Optional[int] = None,
        armour: Optional[int] = None,
        evasion: Optional[int] = None,
        energy_shield: Optional[int] = None,
        block: Optional[int] = None,
        spirit: Optional[int] = None,
        attack_speed: Optional[float] = None,
        crit_chance: Optional[float] = None,
        corrupted: Optional[bool] = None
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
        - Full equipment filtering (armour, evasion, ES, block, spirit)
        - DPS filtering for weapons (pdps, edps)
        - Weapon stats (attack speed, crit chance)
        - Quality and corrupted filters
        - Gem level filtering for gems
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

        # For currency, get quick price from poe2scout (uniques now use Trade API like other items)
        decky.logger.info(f"poe2scout check: rarity={rarity}, item_name={item_name}")
        if rarity == "Currency" and item_name:
            try:
                decky.logger.info(f"poe2scout lookup: {item_name}")
                scout_result = await Plugin.get_poe2scout_price(self, item_name, rarity)
                if scout_result.get("success"):
                    result["poe2scout_price"] = scout_result
                    decky.logger.info(f"poe2scout price: {scout_result.get('price', {}).get('exalted')} exalted")
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
                    self, tier, search_name, search_type, modifiers, item_level,
                    socket_count, linked_sockets, pdps, edps, gem_level,
                    quality, armour, evasion, energy_shield, block, spirit,
                    attack_speed, crit_chance, corrupted, rarity
                )

                # For unique items, only run tier 0 (they don't use modifier filters)
                if rarity == "Unique" and tier > 0:
                    decky.logger.info(f"Skipping tier {tier} for unique items: search by name only")
                    continue

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

    async def get_rate_limit_status(self) -> Dict[str, Any]:
        """Check if we're currently rate limited"""
        import time
        now = time.time()
        if Plugin.rate_limit_until > now:
            remaining = int(Plugin.rate_limit_until - now)
            return {
                "rate_limited": True,
                "remaining_seconds": remaining,
                "until": time.strftime('%H:%M', time.localtime(Plugin.rate_limit_until))
            }
        return {"rate_limited": False}

    async def get_settings(self) -> Dict[str, Any]:
        """Return current settings"""
        import decky
        decky.logger.info("get_settings called")
        return self.settings

    async def get_modifier_tier_data(self) -> Dict[str, Any]:
        """Load and return modifier tier data from JSON file"""
        import decky
        import json

        try:
            tier_data_path = os.path.join(os.path.dirname(__file__), "data", "modifier_tiers.json")

            if not os.path.exists(tier_data_path):
                decky.logger.warning(f"Tier data file not found: {tier_data_path}")
                return {"success": False, "error": "Tier data file not found"}

            with open(tier_data_path, "r", encoding="utf-8") as f:
                data = json.load(f)

            decky.logger.info(f"Loaded tier data: {len(data.get('modifiers', []))} modifiers")
            return {"success": True, "data": data}

        except Exception as e:
            decky.logger.error(f"Error loading tier data: {e}")
            return {"success": False, "error": str(e)}

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
        """Test clipboard access - delegated to ClipboardManager"""
        import decky
        decky.logger.info("test_clipboard method called")
        return await Plugin.clipboard_manager.test_clipboard()

    async def log_debug(self, message: str) -> None:
        """Log debug message from frontend"""
        import decky
        decky.logger.info(f"[Frontend Debug] {message}")

    async def copy_to_clipboard(self, text: str) -> Dict[str, Any]:
        """Copy text to clipboard - delegated to ClipboardManager"""
        import decky
        decky.logger.info(f"copy_to_clipboard called ({len(text)} chars)")
        return await Plugin.clipboard_manager.copy_to_clipboard(text)

    async def paste_to_game_chat(self, text: str, send: bool = False) -> Dict[str, Any]:
        """Paste text into game chat - delegated to ClipboardManager"""
        import decky
        decky.logger.info(f"paste_to_game_chat called: {text[:50]}...")
        return await Plugin.clipboard_manager.paste_to_game_chat(text, send)

    async def simulate_copy(self) -> Dict[str, Any]:
        """Simulate Ctrl+C keypress - delegated to ClipboardManager"""
        import decky
        decky.logger.info("simulate_copy method called")
        return await Plugin.clipboard_manager.simulate_copy()
