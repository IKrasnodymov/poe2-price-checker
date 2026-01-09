# backend/persistence.py
# Data persistence layer for PoE2 Price Checker
#
# Handles file I/O for various data stores:
# - Settings (settings.json)
# - Price history (price_history.json)
# - Scan history (scan_history.json)
# - Price learning (price_learning.json)
# - Stat cache (stat_cache.json)

import json
import os
import time
from typing import Dict, Any, List, Optional, Callable


class DataStore:
    """
    Generic data store with JSON persistence.

    Features:
    - Auto-save on write (optional)
    - In-memory caching
    - Versioning for schema migrations
    """

    def __init__(
        self,
        filepath: str,
        default_data: Any = None,
        version: int = 1,
        logger: Optional[Callable[[str], None]] = None
    ):
        self.filepath = filepath
        self.default_data = default_data if default_data is not None else {}
        self.version = version
        self._logger = logger
        self._data: Any = None
        self._loaded = False

    def _log(self, message: str) -> None:
        if self._logger:
            self._logger(f"[DataStore:{os.path.basename(self.filepath)}] {message}")

    def load(self) -> Any:
        """Load data from file or return default"""
        if self._loaded:
            return self._data

        if os.path.exists(self.filepath):
            try:
                with open(self.filepath, "r", encoding="utf-8") as f:
                    data = json.load(f)

                # Check version if data has versioning
                if isinstance(data, dict) and "_version" in data:
                    stored_version = data.get("_version", 1)
                    if stored_version < self.version:
                        self._log(f"Data version {stored_version} < {self.version}, resetting")
                        self._data = self._init_default()
                    else:
                        self._data = data
                else:
                    self._data = data

                self._loaded = True
                self._log(f"Loaded from {self.filepath}")
                return self._data

            except json.JSONDecodeError as e:
                self._log(f"JSON decode error: {e}")
            except Exception as e:
                self._log(f"Load error: {e}")

        self._data = self._init_default()
        self._loaded = True
        return self._data

    def _init_default(self) -> Any:
        """Initialize with default data"""
        if isinstance(self.default_data, dict):
            data = self.default_data.copy()
            data["_version"] = self.version
            return data
        return self.default_data

    def save(self) -> bool:
        """Save data to file"""
        if self._data is None:
            return False

        try:
            os.makedirs(os.path.dirname(self.filepath), exist_ok=True)

            # Add version if dict
            if isinstance(self._data, dict):
                self._data["_version"] = self.version

            with open(self.filepath, "w", encoding="utf-8") as f:
                json.dump(self._data, f, indent=2)

            self._log(f"Saved to {self.filepath}")
            return True

        except Exception as e:
            self._log(f"Save error: {e}")
            return False

    @property
    def data(self) -> Any:
        """Get data (loads if not already loaded)"""
        if not self._loaded:
            self.load()
        return self._data

    @data.setter
    def data(self, value: Any) -> None:
        """Set data"""
        self._data = value
        self._loaded = True


class PriceHistoryStore(DataStore):
    """Store for price history records"""

    def __init__(self, settings_dir: str, logger: Optional[Callable[[str], None]] = None):
        super().__init__(
            filepath=os.path.join(settings_dir, "price_history.json"),
            default_data={},
            version=1,
            logger=logger
        )
        self.max_records_per_item = 100

    def add_record(
        self,
        item_key: str,
        median_price: float,
        currency: str,
        listing_count: int
    ) -> bool:
        """Add a price record for an item"""
        data = self.data

        if item_key not in data:
            data[item_key] = []

        record = {
            "timestamp": int(time.time()),
            "median_price": median_price,
            "currency": currency,
            "listing_count": listing_count
        }

        data[item_key].insert(0, record)

        # Trim to max size
        if len(data[item_key]) > self.max_records_per_item:
            data[item_key] = data[item_key][:self.max_records_per_item]

        return self.save()

    def get_records(self, item_key: str) -> List[Dict[str, Any]]:
        """Get price records for an item"""
        return self.data.get(item_key, [])

    def clear(self) -> bool:
        """Clear all history"""
        self._data = {}
        return self.save()


class ScanHistoryStore(DataStore):
    """Store for full scan records with icon caching"""

    def __init__(
        self,
        settings_dir: str,
        logger: Optional[Callable[[str], None]] = None,
        max_records: int = 50
    ):
        super().__init__(
            filepath=os.path.join(settings_dir, "scan_history.json"),
            default_data=[],
            version=1,
            logger=logger
        )
        self.settings_dir = settings_dir
        self.icon_cache_dir = os.path.join(settings_dir, "icons")
        self.max_records = max_records

    def add_record(self, record: Dict[str, Any]) -> str:
        """Add a scan record and return its ID"""
        import uuid

        data = self.data
        if not isinstance(data, list):
            data = []
            self._data = data

        # Generate unique ID
        record_id = f"{int(time.time())}-{uuid.uuid4().hex[:8]}"
        record["id"] = record_id
        record["timestamp"] = int(time.time())

        # Add to beginning (newest first)
        data.insert(0, record)

        # Trim and cleanup old icons
        if len(data) > self.max_records:
            removed = data[self.max_records:]
            self._data = data[:self.max_records]
            self._cleanup_icons(removed)

        self.save()
        return record_id

    def _cleanup_icons(self, removed_records: List[Dict[str, Any]]) -> None:
        """Remove cached icons for removed records"""
        for record in removed_records:
            icon_path = record.get("localIconPath")
            if icon_path:
                full_path = os.path.join(self.settings_dir, icon_path)
                try:
                    if os.path.exists(full_path):
                        os.remove(full_path)
                        self._log(f"Removed old icon: {icon_path}")
                except Exception as e:
                    self._log(f"Failed to remove icon: {e}")

    def get_records(self, limit: Optional[int] = None) -> List[Dict[str, Any]]:
        """Get scan records"""
        data = self.data
        if not isinstance(data, list):
            return []
        return data[:limit] if limit else data

    def get_record(self, record_id: str) -> Optional[Dict[str, Any]]:
        """Get a specific record by ID"""
        for record in self.data or []:
            if record.get("id") == record_id:
                return record
        return None

    def clear(self) -> bool:
        """Clear all history and cached icons"""
        import shutil

        # Remove icon cache directory
        try:
            if os.path.exists(self.icon_cache_dir):
                shutil.rmtree(self.icon_cache_dir)
                os.makedirs(self.icon_cache_dir, exist_ok=True)
        except Exception as e:
            self._log(f"Failed to clear icon cache: {e}")

        self._data = []
        return self.save()


class PriceLearningStore(DataStore):
    """Store for price learning data with versioned schema"""

    CURRENT_VERSION = 3  # v3 includes defense stats, pdps/edps, implicit patterns

    def __init__(
        self,
        settings_dir: str,
        logger: Optional[Callable[[str], None]] = None,
        max_records_per_class: int = 100
    ):
        super().__init__(
            filepath=os.path.join(settings_dir, "price_learning.json"),
            default_data={},
            version=self.CURRENT_VERSION,
            logger=logger
        )
        self.max_records_per_class = max_records_per_class

    def add_record(self, item_class: str, record: Dict[str, Any]) -> bool:
        """Add a learning record for an item class"""
        data = self.data
        item_class_key = item_class.lower().replace(" ", "_")

        if item_class_key not in data:
            data[item_class_key] = []

        # Add timestamp if not present
        if "timestamp" not in record:
            record["timestamp"] = int(time.time())

        data[item_class_key].insert(0, record)

        # Trim to max size
        if len(data[item_class_key]) > self.max_records_per_class:
            data[item_class_key] = data[item_class_key][:self.max_records_per_class]

        return self.save()

    def get_records(self, item_class: str) -> List[Dict[str, Any]]:
        """Get records for an item class"""
        item_class_key = item_class.lower().replace(" ", "_")
        return self.data.get(item_class_key, [])

    def get_all_records(self) -> Dict[str, List[Dict[str, Any]]]:
        """Get all records grouped by item class"""
        result = {}
        for key, value in self.data.items():
            if not key.startswith("_") and isinstance(value, list):
                result[key] = value
        return result

    def get_total_count(self) -> int:
        """Get total number of records across all classes"""
        return sum(
            len(v) for v in self.data.values()
            if isinstance(v, list)
        )


class StatCacheStore(DataStore):
    """Store for Trade API stat ID cache"""

    def __init__(self, settings_dir: str, logger: Optional[Callable[[str], None]] = None):
        super().__init__(
            filepath=os.path.join(settings_dir, "stat_cache.json"),
            default_data={"cache": {}, "timestamp": 0, "count": 0},
            version=1,
            logger=logger
        )

    def get_cache(self) -> Dict[str, str]:
        """Get the stat ID cache"""
        return self.data.get("cache", {})

    def set_cache(self, cache: Dict[str, str]) -> bool:
        """Set the stat ID cache"""
        self._data = {
            "cache": cache,
            "timestamp": int(time.time()),
            "count": len(cache)
        }
        return self.save()

    def get_stat_id(self, normalized_text: str) -> Optional[str]:
        """Get stat ID for normalized text"""
        return self.get_cache().get(normalized_text)

    def set_stat_id(self, normalized_text: str, stat_id: str) -> None:
        """Set a stat ID mapping"""
        cache = self.get_cache()
        cache[normalized_text] = stat_id
        self.set_cache(cache)


class SettingsStore(DataStore):
    """Store for plugin settings"""

    DEFAULT_SETTINGS = {
        "league": "Fate of the Vaal",
        "useTradeApi": True,
        "poesessid": "",
        "autoCheck": True,
        "defaultSearchTiers": [0, 1, 2, 3]
    }

    def __init__(self, settings_dir: str, logger: Optional[Callable[[str], None]] = None):
        super().__init__(
            filepath=os.path.join(settings_dir, "settings.json"),
            default_data=self.DEFAULT_SETTINGS.copy(),
            version=1,
            logger=logger
        )

    def get(self, key: str, default: Any = None) -> Any:
        """Get a setting value"""
        return self.data.get(key, default)

    def set(self, key: str, value: Any) -> bool:
        """Set a setting value"""
        self.data[key] = value
        return self.save()

    def update(self, settings: Dict[str, Any]) -> bool:
        """Update multiple settings"""
        for key, value in settings.items():
            self.data[key] = value
        return self.save()
