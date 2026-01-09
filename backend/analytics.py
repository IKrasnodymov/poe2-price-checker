# backend/analytics.py
# Price analytics and market insights for PoE2 Price Checker
#
# Provides:
# - Price normalization across currencies
# - Statistical calculations (median, percentiles, std dev)
# - Confidence scoring for records
# - Price trend analysis
# - Quality-price correlation
# - Hot modifier pattern detection

import time
from collections import defaultdict
from typing import Dict, Any, List, Optional, Tuple, Callable


class PriceAnalytics:
    """
    Analytics engine for price data.

    Processes price learning data to provide:
    - Price estimates based on item quality
    - Market insights (hot mods, class stats)
    - Price trends over time
    - Quality-price correlation analysis
    """

    # Approximate currency ratios (PoE2)
    CURRENCY_RATIOS = {
        "divine": 0.5,        # 1 divine ≈ 0.5 exalted
        "divine-orb": 0.5,
        "div": 0.5,
        "chaos": 0.01,        # 1 chaos ≈ 0.01 exalted
        "chaos-orb": 0.01,
        "c": 0.01,
        "exalted": 1.0,
        "exalted-orb": 1.0,
        "ex": 1.0,
    }

    def __init__(self, logger: Optional[Callable[[str], None]] = None):
        self._logger = logger

    def _log(self, message: str) -> None:
        if self._logger:
            self._logger(f"[Analytics] {message}")

    # =========================================================================
    # STATISTICAL HELPERS
    # =========================================================================

    @staticmethod
    def normalize_price(price: float, currency: str) -> float:
        """Normalize any currency to exalted equivalent"""
        currency = (currency or "exalted").lower()
        ratio = PriceAnalytics.CURRENCY_RATIOS.get(currency, 1.0)
        return price * ratio

    @staticmethod
    def calculate_median(values: List[float]) -> float:
        """Calculate median of a list of values"""
        if not values:
            return 0.0
        sorted_vals = sorted(values)
        n = len(sorted_vals)
        if n % 2 == 1:
            return sorted_vals[n // 2]
        return (sorted_vals[n // 2 - 1] + sorted_vals[n // 2]) / 2

    @staticmethod
    def calculate_percentile(values: List[float], p: float) -> float:
        """Calculate percentile (0-100) of sorted values"""
        if not values:
            return 0.0
        sorted_vals = sorted(values)
        n = len(sorted_vals)
        idx = (p / 100) * (n - 1)
        lower = int(idx)
        upper = min(lower + 1, n - 1)
        weight = idx - lower
        return sorted_vals[lower] * (1 - weight) + sorted_vals[upper] * weight

    @staticmethod
    def calculate_std_dev(values: List[float], mean: Optional[float] = None) -> float:
        """Calculate standard deviation"""
        if len(values) < 2:
            return 0.0
        if mean is None:
            mean = sum(values) / len(values)
        variance = sum((x - mean) ** 2 for x in values) / len(values)
        return variance ** 0.5

    @staticmethod
    def calculate_confidence_weight(record: Dict[str, Any]) -> float:
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

    # =========================================================================
    # PRICE ESTIMATION
    # =========================================================================

    def get_price_estimate(
        self,
        records: List[Dict[str, Any]],
        quality_score: int,
        quality_tolerance: int = 15
    ) -> Optional[Dict[str, Any]]:
        """
        Estimate price based on similar quality items.

        Args:
            records: Price learning records for an item class
            quality_score: Target quality score
            quality_tolerance: How much quality deviation to allow

        Returns:
            Estimate dict or None if insufficient data
        """
        if len(records) < 5:
            return None

        # Find records with similar quality
        similar = [r for r in records
                   if abs(r.get("quality_score", 0) - quality_score) <= quality_tolerance]

        if len(similar) < 3:
            similar = records  # Fall back to all records

        # Normalize prices
        prices = [
            self.normalize_price(r.get("price", 0), r.get("currency", "exalted"))
            for r in similar
        ]

        return {
            "min": min(prices),
            "max": max(prices),
            "median": self.calculate_median(prices),
            "average": sum(prices) / len(prices),
            "currency": "exalted",
            "sample_count": len(similar),
            "total_records": len(records)
        }

    # =========================================================================
    # HOT PATTERNS ANALYSIS
    # =========================================================================

    def get_hot_patterns(
        self,
        records_by_class: Dict[str, List[Dict[str, Any]]],
        limit: int = 15
    ) -> Dict[str, Any]:
        """
        Analyze modifier patterns that appear in valuable items.

        Returns specific patterns with price and tier statistics.
        """
        if not records_by_class:
            return {"success": False, "error": "No data", "patterns": []}

        pattern_stats: Dict[str, Dict[str, Any]] = defaultdict(lambda: {
            "prices": [],
            "weighted_prices": [],
            "tiers": [],
            "category": None,
            "count": 0
        })

        total_records = 0

        for item_class, records in records_by_class.items():
            if not isinstance(records, list):
                continue

            for record in records:
                total_records += 1
                mod_patterns = record.get("mod_patterns", [])
                price = self.normalize_price(
                    record.get("price", 0),
                    record.get("currency", "exalted")
                )
                weight = self.calculate_confidence_weight(record)

                for mp in mod_patterns:
                    pattern = mp.get("pattern", "")
                    if not pattern:
                        continue

                    pattern_stats[pattern]["prices"].append(price)
                    pattern_stats[pattern]["weighted_prices"].append((price, weight))

                    tier = mp.get("tier")
                    if tier is not None:
                        pattern_stats[pattern]["tiers"].append(tier)

                    if mp.get("category"):
                        pattern_stats[pattern]["category"] = mp.get("category")

                    pattern_stats[pattern]["count"] += 1

                # Fallback for old records without mod_patterns
                if not mod_patterns and record.get("mod_categories"):
                    for cat in record.get("mod_categories", []):
                        fallback_pattern = f"[{cat}]"
                        pattern_stats[fallback_pattern]["prices"].append(price)
                        pattern_stats[fallback_pattern]["weighted_prices"].append((price, weight))
                        pattern_stats[fallback_pattern]["category"] = cat
                        pattern_stats[fallback_pattern]["count"] += 1

        if total_records < 5:
            return {
                "success": False,
                "error": f"Need 5+ records (have {total_records})",
                "patterns": []
            }

        hot_patterns = []
        for pattern, stats in pattern_stats.items():
            if stats["count"] < 2:
                continue

            prices = stats["prices"]
            tiers = [t for t in stats["tiers"] if t and t > 0]

            median_price = self.calculate_median(prices)

            # Tier distribution
            tier_dist = {"T1": 0, "T2": 0, "T3": 0, "T4": 0, "T5+": 0}
            for t in tiers:
                if t == 1:
                    tier_dist["T1"] += 1
                elif t == 2:
                    tier_dist["T2"] += 1
                elif t == 3:
                    tier_dist["T3"] += 1
                elif t == 4:
                    tier_dist["T4"] += 1
                else:
                    tier_dist["T5+"] += 1

            # Format display name
            display_name = pattern.replace("#", "X")
            if display_name.startswith("X ") or display_name.startswith("X%"):
                display_name = "+" + display_name

            hot_patterns.append({
                "pattern": pattern,
                "display_name": display_name,
                "category": stats["category"],
                "count": stats["count"],
                "median_price": round(median_price, 1),
                "avg_price": round(sum(prices) / len(prices), 1),
                "min_price": round(min(prices), 1),
                "max_price": round(max(prices), 1),
                "tier_distribution": tier_dist,
                "avg_tier": round(sum(tiers) / len(tiers), 1) if tiers else None
            })

        # Sort by popularity × value
        hot_patterns.sort(key=lambda x: x["count"] * x["median_price"], reverse=True)

        return {
            "success": True,
            "patterns": hot_patterns[:limit],
            "total_patterns": len(hot_patterns)
        }

    # =========================================================================
    # MARKET INSIGHTS
    # =========================================================================

    def get_market_insights(
        self,
        records_by_class: Dict[str, List[Dict[str, Any]]]
    ) -> Dict[str, Any]:
        """
        Analyze collected data for market insights.

        Returns:
        - Hot mod categories
        - Item class statistics
        - Top value items
        """
        if not records_by_class:
            return {"success": False, "error": "No data collected", "total_records": 0}

        total_records = sum(len(v) for v in records_by_class.values() if isinstance(v, list))
        if total_records < 5:
            return {
                "success": False,
                "error": f"Need more data (have {total_records}, need 5+)",
                "total_records": total_records
            }

        mod_category_stats: Dict[str, Dict] = defaultdict(
            lambda: {"total_price": 0.0, "count": 0}
        )
        item_class_stats: Dict[str, Dict] = defaultdict(
            lambda: {"total_price": 0.0, "count": 0, "avg_quality": 0.0}
        )

        all_records = []

        for item_class, records in records_by_class.items():
            if not isinstance(records, list):
                continue

            for record in records:
                price = self.normalize_price(
                    record.get("price", 0),
                    record.get("currency", "exalted")
                )
                quality = record.get("quality_score", 50)
                categories = record.get("mod_categories", [])

                # Track item class stats
                item_class_stats[item_class]["total_price"] += price
                item_class_stats[item_class]["count"] += 1
                item_class_stats[item_class]["avg_quality"] += quality

                # Track mod category stats
                for cat in categories:
                    mod_category_stats[cat]["total_price"] += price
                    mod_category_stats[cat]["count"] += 1

                # Collect for top items
                all_records.append({
                    "item_class": item_class.replace("_", " ").title(),
                    "base_type": record.get("base_type", "Unknown"),
                    "price": record.get("price", 0),
                    "currency": record.get("currency", "exalted"),
                    "sort_price": price,
                    "quality": quality,
                    "timestamp": record.get("timestamp", 0)
                })

        # Calculate hot mods
        hot_mods = []
        for cat, stats in mod_category_stats.items():
            if stats["count"] >= 2:
                avg_price = stats["total_price"] / stats["count"]
                hot_mods.append({
                    "category": cat,
                    "avg_price": round(avg_price, 1),
                    "count": stats["count"]
                })
        hot_mods.sort(key=lambda x: x["avg_price"], reverse=True)

        # Calculate class stats
        class_stats = []
        for item_class, stats in item_class_stats.items():
            if stats["count"] >= 1:
                avg_price = stats["total_price"] / stats["count"]
                avg_quality = stats["avg_quality"] / stats["count"]
                class_stats.append({
                    "item_class": item_class.replace("_", " ").title(),
                    "avg_price": round(avg_price, 1),
                    "avg_quality": round(avg_quality),
                    "count": stats["count"]
                })
        class_stats.sort(key=lambda x: x["avg_price"], reverse=True)

        # Top items
        all_records.sort(key=lambda x: x["sort_price"], reverse=True)
        top_items = all_records[:5]

        return {
            "success": True,
            "total_records": total_records,
            "hot_mods": hot_mods[:10],
            "item_class_stats": class_stats[:10],
            "top_items": top_items,
            "last_updated": int(time.time())
        }

    # =========================================================================
    # PRICE TRENDS
    # =========================================================================

    def get_price_trends(
        self,
        records_by_class: Dict[str, List[Dict[str, Any]]],
        days: int = 7
    ) -> Dict[str, Any]:
        """
        Analyze price trends over time.

        Returns daily medians and trend direction for each item class.
        """
        if not records_by_class:
            return {"success": False, "error": "No data", "trends": []}

        now = int(time.time())
        day_seconds = 86400
        cutoff = now - (days * day_seconds)

        class_daily_prices: Dict[str, Dict[int, List[float]]] = defaultdict(
            lambda: defaultdict(list)
        )

        for item_class, records in records_by_class.items():
            if not isinstance(records, list):
                continue

            for record in records:
                ts = record.get("timestamp", 0)
                if ts < cutoff:
                    continue

                price = self.normalize_price(
                    record.get("price", 0),
                    record.get("currency", "exalted")
                )

                day_index = (now - ts) // day_seconds
                class_daily_prices[item_class][day_index].append(price)

        trends = []
        for item_class, daily_data in class_daily_prices.items():
            if not daily_data:
                continue

            daily_medians = []
            for day_idx in range(days):
                prices = daily_data.get(day_idx, [])
                if prices:
                    median = self.calculate_median(prices)
                    daily_medians.append({
                        "day": day_idx,
                        "median": round(median, 1),
                        "count": len(prices)
                    })

            if len(daily_medians) < 2:
                continue

            # Calculate trend
            recent_prices = [d["median"] for d in daily_medians if d["day"] <= 2]
            older_prices = [d["median"] for d in daily_medians if d["day"] > 2]

            if recent_prices and older_prices:
                recent_avg = sum(recent_prices) / len(recent_prices)
                older_avg = sum(older_prices) / len(older_prices)
                change_percent = ((recent_avg - older_avg) / older_avg * 100) if older_avg > 0 else 0

                if change_percent > 10:
                    trend_direction = "up"
                elif change_percent < -10:
                    trend_direction = "down"
                else:
                    trend_direction = "stable"
            else:
                change_percent = 0
                trend_direction = "unknown"

            trends.append({
                "item_class": item_class.replace("_", " ").title(),
                "daily_data": daily_medians,
                "trend": trend_direction,
                "change_percent": round(change_percent, 1),
                "current_median": daily_medians[0]["median"] if daily_medians else 0
            })

        trends.sort(key=lambda x: abs(x["change_percent"]), reverse=True)

        return {
            "success": True,
            "trends": trends[:10],
            "period_days": days
        }

    # =========================================================================
    # QUALITY CORRELATION
    # =========================================================================

    def get_quality_correlation(
        self,
        records_by_class: Dict[str, List[Dict[str, Any]]]
    ) -> Dict[str, Any]:
        """
        Analyze correlation between quality scores and prices.

        Returns Pearson correlation and price buckets by quality range.
        """
        if not records_by_class:
            return {"success": False, "error": "No data", "correlations": []}

        class_data: Dict[str, List[Dict]] = defaultdict(list)

        for item_class, records in records_by_class.items():
            if not isinstance(records, list):
                continue

            for record in records:
                quality = record.get("quality_score", 0)
                price = self.normalize_price(
                    record.get("price", 0),
                    record.get("currency", "exalted")
                )
                class_data[item_class].append({
                    "quality": quality,
                    "price": price,
                    "ilvl": record.get("ilvl"),
                    "search_tier": record.get("search_tier", 3)
                })

        correlations = []
        for item_class, data_points in class_data.items():
            if len(data_points) < 5:
                continue

            qualities = [d["quality"] for d in data_points]
            prices = [d["price"] for d in data_points]

            n = len(qualities)
            mean_q = sum(qualities) / n
            mean_p = sum(prices) / n

            # Pearson correlation
            numerator = sum((q - mean_q) * (p - mean_p) for q, p in zip(qualities, prices))
            denom_q = sum((q - mean_q) ** 2 for q in qualities) ** 0.5
            denom_p = sum((p - mean_p) ** 2 for p in prices) ** 0.5

            if denom_q > 0 and denom_p > 0:
                correlation = numerator / (denom_q * denom_p)
            else:
                correlation = 0

            # Quality buckets
            buckets: Dict[str, List[float]] = {
                "0-25": [], "26-50": [], "51-75": [], "76-100": []
            }
            for d in data_points:
                q = d["quality"]
                if q <= 25:
                    buckets["0-25"].append(d["price"])
                elif q <= 50:
                    buckets["26-50"].append(d["price"])
                elif q <= 75:
                    buckets["51-75"].append(d["price"])
                else:
                    buckets["76-100"].append(d["price"])

            bucket_medians = {}
            for bucket, prices_list in buckets.items():
                if prices_list:
                    bucket_medians[bucket] = round(self.calculate_median(prices_list), 1)

            correlations.append({
                "item_class": item_class.replace("_", " ").title(),
                "correlation": round(correlation, 2),
                "sample_size": len(data_points),
                "bucket_medians": bucket_medians
            })

        correlations.sort(key=lambda x: abs(x["correlation"]), reverse=True)

        return {
            "success": True,
            "correlations": correlations[:10]
        }

    # =========================================================================
    # PRICE DYNAMICS
    # =========================================================================

    def get_price_dynamics(
        self,
        scan_history: List[Dict[str, Any]],
        price_history: Dict[str, List[Dict[str, Any]]],
        item_name: str,
        basetype: str,
        rarity: str
    ) -> Dict[str, Any]:
        """
        Get price dynamics for a specific item.

        Combines scan history and price history for trend analysis.
        """
        dynamics = []

        # From scan history
        for record in scan_history or []:
            if rarity == "Unique":
                if record.get("itemName", "").lower() != item_name.lower():
                    continue
            else:
                if record.get("basetype", "").lower() != basetype.lower():
                    continue

            price_data = record.get("priceData", {})
            dynamics.append({
                "timestamp": record.get("timestamp"),
                "price": price_data.get("medianPrice", 0),
                "currency": price_data.get("currency", "chaos"),
                "source": "scan"
            })

        # From price history
        item_key = f"{rarity}_{item_name}_{basetype}".lower()
        for record in price_history.get(item_key, []):
            dynamics.append({
                "timestamp": record.get("timestamp"),
                "price": record.get("median_price", 0),
                "currency": record.get("currency", "chaos"),
                "source": "history"
            })

        # Remove duplicates
        seen_timestamps = set()
        unique_dynamics = []
        for d in dynamics:
            ts = d.get("timestamp")
            if ts not in seen_timestamps:
                seen_timestamps.add(ts)
                unique_dynamics.append(d)
        dynamics = unique_dynamics

        # Sort by timestamp
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

        # 24h change
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
            "itemKey": item_key,
            "dynamics": dynamics,
            "currentPrice": current_price,
            "priceChange24h": price_change_24h,
            "priceChangePercent24h": price_change_percent_24h
        }

    # =========================================================================
    # LEARNING STATISTICS
    # =========================================================================

    def get_learning_stats(
        self,
        records_by_class: Dict[str, List[Dict[str, Any]]]
    ) -> Dict[str, Any]:
        """Get summary statistics for learning data"""
        if not records_by_class:
            return {
                "success": True,
                "total_records": 0,
                "item_classes": 0,
                "classes": {}
            }

        total = sum(len(v) for v in records_by_class.values() if isinstance(v, list))
        classes = {}

        for item_class, records in records_by_class.items():
            if not isinstance(records, list) or not records:
                continue

            prices = [
                self.normalize_price(r.get("price", 0), r.get("currency", "exalted"))
                for r in records
            ]
            median_price = self.calculate_median(prices)

            classes[item_class] = {
                "count": len(records),
                "avg_price": round(sum(prices) / len(prices), 1) if prices else 0,
                "median_price": round(median_price, 1),
                "min_price": round(min(prices), 1) if prices else 0,
                "max_price": round(max(prices), 1) if prices else 0
            }

        return {
            "success": True,
            "total_records": total,
            "item_classes": len(classes),
            "classes": classes
        }
