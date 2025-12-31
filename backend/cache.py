# backend/cache.py
# Search result cache for Trade API

import hashlib
import time
from typing import Optional, Dict, Any, List
from dataclasses import dataclass
from collections import OrderedDict


@dataclass
class CachedSearchResult:
    """Cached search result with timestamp"""
    timestamp: float
    result: Dict[str, Any]


class SearchResultCache:
    """
    Cache for Trade API search results to avoid redundant queries.

    Caches by: item base type + rarity + modifier hash
    - Time-based expiration (5 minutes default)
    - LRU eviction (max 100 entries for Steam Deck memory)
    """

    def __init__(self, max_entries: int = 100, ttl_seconds: int = 300):
        self.max_entries = max_entries
        self.ttl_seconds = ttl_seconds
        self.cache: OrderedDict[str, CachedSearchResult] = OrderedDict()

    def _make_key(
        self,
        item_name: Optional[str],
        base_type: Optional[str],
        rarity: str,
        modifiers: List[Dict]
    ) -> str:
        """Create cache key from search parameters"""
        # Sort modifiers for consistent hashing
        mod_ids = sorted([str(m.get('id', '')) for m in modifiers if m.get('enabled', True)])
        mod_hash = hashlib.md5(','.join(mod_ids).encode()).hexdigest()[:8]

        key_parts = [
            rarity or '',
            item_name or '',
            base_type or '',
            mod_hash
        ]
        return '|'.join(key_parts).lower()

    def get(
        self,
        item_name: Optional[str],
        base_type: Optional[str],
        rarity: str,
        modifiers: List[Dict]
    ) -> Optional[CachedSearchResult]:
        """Get cached result if valid"""
        key = self._make_key(item_name, base_type, rarity, modifiers)

        if key not in self.cache:
            return None

        entry = self.cache[key]

        # Check TTL
        if time.time() - entry.timestamp > self.ttl_seconds:
            del self.cache[key]
            return None

        # Move to end (LRU)
        self.cache.move_to_end(key)
        return entry

    def put(
        self,
        item_name: Optional[str],
        base_type: Optional[str],
        rarity: str,
        modifiers: List[Dict],
        result: Dict[str, Any]
    ) -> None:
        """Store result in cache"""
        key = self._make_key(item_name, base_type, rarity, modifiers)

        # Remove oldest if at capacity
        while len(self.cache) >= self.max_entries:
            self.cache.popitem(last=False)

        self.cache[key] = CachedSearchResult(
            timestamp=time.time(),
            result=result
        )

    def invalidate(
        self,
        item_name: Optional[str] = None,
        base_type: Optional[str] = None
    ) -> int:
        """Invalidate cache entries matching criteria. Returns count of removed entries."""
        if not item_name and not base_type:
            count = len(self.cache)
            self.cache.clear()
            return count

        keys_to_remove = []
        for key in self.cache:
            parts = key.split('|')
            if len(parts) >= 3:
                cached_name = parts[1]
                cached_base = parts[2]
                if (item_name and item_name.lower() in cached_name) or \
                   (base_type and base_type.lower() in cached_base):
                    keys_to_remove.append(key)

        for key in keys_to_remove:
            del self.cache[key]

        return len(keys_to_remove)

    def stats(self) -> Dict[str, Any]:
        """Get cache statistics"""
        now = time.time()
        valid_entries = sum(
            1 for entry in self.cache.values()
            if now - entry.timestamp <= self.ttl_seconds
        )
        return {
            "total_entries": len(self.cache),
            "valid_entries": valid_entries,
            "max_entries": self.max_entries,
            "ttl_seconds": self.ttl_seconds
        }
