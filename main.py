# main.py - PoE2 Price Checker Decky Plugin Backend
# NOTE: decky must be imported inside methods, not at module level!

import asyncio
import json
import os
import time
from typing import Optional, Dict, Any, List
import urllib.request
import urllib.error
import urllib.parse
import ssl


class RateLimiter:
    """Simple rate limiter for API requests"""

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
    trade_limiter: RateLimiter = None  # type: ignore
    ninja_limiter: RateLimiter = None  # type: ignore
    ssl_context = None
    stat_cache: Dict[str, str] = None  # type: ignore  # text pattern -> stat ID
    currency_rates: Dict[str, float] = None  # type: ignore  # currency -> chaos value
    price_history: Dict[str, List[Dict[str, Any]]] = None  # type: ignore  # item_key -> [price records]

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
            "usePoeNinja": True,
            "poesessid": "",
        }
        Plugin.trade_limiter = RateLimiter(min_interval=2.5)  # 2.5s between requests to avoid 429
        Plugin.ninja_limiter = RateLimiter(min_interval=0.5)
        Plugin.stat_cache = {}
        Plugin.currency_rates = {
            # Default rates (will be updated from poe.ninja)
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
        # Use unverified SSL context (SteamOS may lack proper CA certs)
        Plugin.ssl_context = ssl.create_default_context()
        Plugin.ssl_context.check_hostname = False
        Plugin.ssl_context.verify_mode = ssl.CERT_NONE

        # Load stat IDs from Trade API
        try:
            await Plugin.load_stat_ids(self)
        except Exception as e:
            decky.logger.error(f"Failed to load stat IDs: {e}")

        # Load currency rates from poe.ninja
        try:
            await Plugin.load_currency_rates(self)
        except Exception as e:
            decky.logger.error(f"Failed to load currency rates: {e}")

        # Load price history
        Plugin.price_history = {}
        try:
            await Plugin.load_price_history(self)
        except Exception as e:
            decky.logger.error(f"Failed to load price history: {e}")

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
            settings_path = os.path.join(decky.DECKY_PLUGIN_SETTINGS_DIR, "settings.json")
            os.makedirs(os.path.dirname(settings_path), exist_ok=True)
            with open(settings_path, "w") as f:
                json.dump(self.settings, f, indent=2)
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

    async def load_currency_rates(self) -> None:
        """Load currency exchange rates from poe.ninja"""
        import decky
        decky.logger.info("Loading currency rates from poe.ninja...")

        league = self.settings.get("league", "Fate of the Vaal")
        league_encoded = urllib.parse.quote(league, safe='')
        url = f"https://poe.ninja/api/data/currencyoverview?league=poe2%2F{league_encoded}&type=Currency"

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

                for item in data.get("lines", []):
                    name = item.get("currencyTypeName", "").lower()
                    chaos_value = item.get("chaosEquivalent", 0)

                    if chaos_value > 0:
                        # Map currency names to our keys
                        if "exalted" in name:
                            Plugin.currency_rates["exalted"] = chaos_value
                            Plugin.currency_rates["exalted-orb"] = chaos_value
                        elif "divine" in name:
                            Plugin.currency_rates["divine"] = chaos_value
                            Plugin.currency_rates["divine-orb"] = chaos_value
                        elif "regal" in name:
                            Plugin.currency_rates["regal"] = chaos_value
                            Plugin.currency_rates["regal-orb"] = chaos_value
                        elif "alchemy" in name or "alch" in name:
                            Plugin.currency_rates["alch"] = chaos_value
                            Plugin.currency_rates["alchemy-orb"] = chaos_value

                decky.logger.info(f"Currency rates loaded: exalted={Plugin.currency_rates.get('exalted', 'N/A')}c, divine={Plugin.currency_rates.get('divine', 'N/A')}c")

        except Exception as e:
            decky.logger.error(f"Failed to load currency rates: {e}")
            import traceback
            decky.logger.error(traceback.format_exc())

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

        decky.logger.info(f"Added price record for {key}: {median_price:.1f} {currency}")
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
    # POE.NINJA API
    # =========================================================================

    async def fetch_poe_ninja(self, item_type: str, item_name: str) -> Dict[str, Any]:
        """
        Fetch price data from poe.ninja API

        item_type: Currency, UniqueWeapon, UniqueArmour, SkillGem, etc.
        item_name: Name of the item to search
        """
        import decky
        if not self.settings.get("usePoeNinja", True):
            return {"success": False, "error": "poe.ninja disabled in settings"}

        await self.ninja_limiter.wait()

        league = self.settings.get("league", "Standard")

        # Determine endpoint type
        currency_types = ["Currency", "Fragment"]
        if item_type in currency_types:
            endpoint = "currencyoverview"
        else:
            endpoint = "itemoverview"

        # Build URL for PoE2
        # Note: poe.ninja uses "poe2" prefix for PoE2 data
        base_url = f"https://poe.ninja/api/data/{endpoint}"
        league_encoded = urllib.parse.quote(league, safe='')
        params = f"?league=poe2%2F{league_encoded}&type={item_type}"
        url = base_url + params

        decky.logger.info(f"Fetching poe.ninja: {url}")

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

                # Search for matching item
                lines = data.get("lines", [])

                # Try exact match first
                for item in lines:
                    name = item.get("name", "") or item.get("currencyTypeName", "")
                    if name.lower() == item_name.lower():
                        return Plugin._format_ninja_result(self, item)

                # Try partial match
                item_name_lower = item_name.lower()
                for item in lines:
                    name = item.get("name", "") or item.get("currencyTypeName", "")
                    if item_name_lower in name.lower():
                        return Plugin._format_ninja_result(self, item)

                return {
                    "success": False,
                    "source": "poe.ninja",
                    "error": f"Item '{item_name}' not found on poe.ninja"
                }

        except urllib.error.HTTPError as e:
            decky.logger.error(f"poe.ninja HTTP error: {e.code}")
            return {
                "success": False,
                "source": "poe.ninja",
                "error": f"HTTP Error: {e.code}"
            }
        except urllib.error.URLError as e:
            decky.logger.error(f"poe.ninja URL error: {e.reason}")
            return {
                "success": False,
                "source": "poe.ninja",
                "error": f"Connection error: {e.reason}"
            }
        except Exception as e:
            decky.logger.error(f"poe.ninja error: {e}")
            return {
                "success": False,
                "source": "poe.ninja",
                "error": str(e)
            }

    def _format_ninja_result(self, item: Dict[str, Any]) -> Dict[str, Any]:
        """Format poe.ninja item data into standardized result"""
        chaos_value = item.get("chaosValue") or item.get("chaosEquivalent")
        exalted_value = item.get("exaltedValue")
        divine_value = item.get("divineValue")

        return {
            "success": True,
            "source": "poe.ninja",
            "price": {
                "chaos": chaos_value,
                "exalted": exalted_value,
                "divine": divine_value,
            },
            "confidence": "high" if item.get("count", 0) > 10 else "low",
            "listings": item.get("count", 0),
            "icon": item.get("icon"),
            "error": None
        }

    # =========================================================================
    # OFFICIAL TRADE API
    # =========================================================================

    async def search_trade_api(self, query: Dict[str, Any]) -> Dict[str, Any]:
        """
        Search the official PoE2 Trade API

        query: Trade API search query object
        """
        import decky
        if not self.settings.get("useTradeApi", True):
            return {"success": False, "error": "Trade API disabled in settings"}

        await self.trade_limiter.wait()

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

            # Add POESESSID if configured
            poesessid = self.settings.get("poesessid", "")
            if poesessid:
                req.add_header("Cookie", f"POESESSID={poesessid}")

            with urllib.request.urlopen(req, timeout=15, context=self.ssl_context) as response:
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
                return {
                    "success": False,
                    "error": "Rate limited. Please wait a moment and try again."
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
                except:
                    pass

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
        query_id: str
    ) -> Dict[str, Any]:
        """
        Fetch detailed listings from Trade API in batches

        result_ids: List of item IDs from search
        query_id: Query ID from search response
        """
        import decky
        if not result_ids:
            return {"success": False, "error": "No results to fetch", "listings": []}

        # Fetch all IDs
        ids_to_fetch = result_ids
        total_to_fetch = len(ids_to_fetch)

        decky.logger.info(f"Fetching {total_to_fetch} listings in batches of 10")

        all_listings = []
        batch_size = 10  # API limit

        poesessid = self.settings.get("poesessid", "")

        # Fetch in batches of 10
        for batch_start in range(0, total_to_fetch, batch_size):
            batch_ids = ids_to_fetch[batch_start:batch_start + batch_size]

            if not batch_ids:
                break

            await self.trade_limiter.wait()

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

                if poesessid:
                    req.add_header("Cookie", f"POESESSID={poesessid}")

                with urllib.request.urlopen(req, timeout=15, context=self.ssl_context) as response:
                    result = json.loads(response.read().decode())

                    for item in result.get("result", []):
                        if not item:
                            continue
                        listing = item.get("listing", {})
                        price = listing.get("price", {})
                        amount = price.get("amount")
                        currency = price.get("currency")
                        account = listing.get("account", {}).get("name", "Unknown")

                        # Convert to chaos equivalent for proper comparison
                        chaos_value = Plugin.convert_to_chaos(self, amount, currency) if amount else 0

                        all_listings.append({
                            "amount": amount,
                            "currency": currency,
                            "chaosValue": chaos_value,  # Normalized price
                            "account": account,
                            "whisper": listing.get("whisper", ""),
                            "indexed": listing.get("indexed", ""),
                        })

            except urllib.error.HTTPError as e:
                decky.logger.error(f"Trade API fetch error (batch {batch_num}): {e}")
                # Continue with other batches if one fails
                continue
            except Exception as e:
                decky.logger.error(f"Trade API fetch error (batch {batch_num}): {e}")
                continue

        decky.logger.info(f"Total fetched: {len(all_listings)} listings")

        # Sort by chaos value for accurate price ordering
        all_listings.sort(key=lambda x: x.get("chaosValue", 0))

        return {
            "success": True,
            "listings": all_listings,
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
        """Update and save settings"""
        import decky
        self.settings.update(new_settings)
        # Save settings inline
        try:
            settings_path = os.path.join(decky.DECKY_PLUGIN_SETTINGS_DIR, "settings.json")
            os.makedirs(os.path.dirname(settings_path), exist_ok=True)
            with open(settings_path, "w") as f:
                json.dump(self.settings, f, indent=2)
        except Exception as e:
            decky.logger.error(f"Failed to save settings: {e}")
        return {"success": True, "settings": self.settings}

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
