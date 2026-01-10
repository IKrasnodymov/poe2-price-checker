# backend/rate_limiter.py
# Rate limiting classes for Trade API requests

import asyncio
import time
from typing import Optional, Dict, List
from dataclasses import dataclass


@dataclass
class RateLimitTier:
    """Represents a single rate limit tier from X-Rate-Limit headers"""
    max_requests: int      # e.g., 5
    period_seconds: int    # e.g., 5
    timeout_seconds: int   # e.g., 10


@dataclass
class RateLimitState:
    """Represents current state of a rate limit tier"""
    current_requests: int   # e.g., 2
    period_seconds: int     # e.g., 5
    timeout_remaining: int  # e.g., 0


class AdaptiveRateLimiter:
    """
    Adaptive rate limiter that parses and respects X-Rate-Limit headers.

    PoE API header format:
    - X-Rate-Limit-Policy: trade-search-request-limit
    - X-Rate-Limit-Rules: Ip,Account
    - X-Rate-Limit-Ip: 5:5:10,10:10:30,15:10:300  (requests:period:timeout)
    - X-Rate-Limit-Ip-State: 2:5:0,2:10:0,2:10:0

    Thread-safe: Uses asyncio.Lock to protect concurrent access to shared state.
    """

    def __init__(self, policy_name: str, default_interval: float = 2.5):
        self.policy_name = policy_name
        self.default_interval = default_interval
        self.last_request = 0.0

        # Parsed rate limit state
        self.rate_limits: Dict[str, List[RateLimitTier]] = {}  # rule -> tiers
        self.rate_states: Dict[str, List[RateLimitState]] = {}  # rule -> states

        # Dynamic interval based on current state
        self.current_interval = default_interval

        # Backoff state
        self.consecutive_429s = 0
        self.backoff_until = 0.0

        # Lock for thread-safe access to shared state
        self._lock: Optional[asyncio.Lock] = None

    def _get_lock(self) -> asyncio.Lock:
        """Lazy initialization of lock to ensure it's created in the right event loop."""
        if self._lock is None:
            self._lock = asyncio.Lock()
        return self._lock

    def parse_headers(self, headers: Dict[str, str]) -> None:
        """Parse X-Rate-Limit headers from API response"""
        # Get rules list (e.g., "Ip,Account")
        rules_header = headers.get('X-Rate-Limit-Rules', '')
        if not rules_header:
            return

        rules = [r.strip() for r in rules_header.split(',') if r.strip()]

        for rule in rules:
            # Parse limit tiers: "5:5:10,10:10:30,15:10:300"
            limit_header = headers.get(f'X-Rate-Limit-{rule}', '')
            state_header = headers.get(f'X-Rate-Limit-{rule}-State', '')

            if limit_header:
                self.rate_limits[rule] = self._parse_limit_tiers(limit_header)
            if state_header:
                self.rate_states[rule] = self._parse_state_tiers(state_header)

        # Update current interval based on state
        self._update_interval()

    def _parse_limit_tiers(self, header: str) -> List[RateLimitTier]:
        """Parse '5:5:10,10:10:30,15:10:300' into list of tiers"""
        tiers = []
        for tier_str in header.split(','):
            parts = tier_str.strip().split(':')
            if len(parts) == 3:
                try:
                    tiers.append(RateLimitTier(
                        max_requests=int(parts[0]),
                        period_seconds=int(parts[1]),
                        timeout_seconds=int(parts[2])
                    ))
                except ValueError:
                    pass
        return tiers

    def _parse_state_tiers(self, header: str) -> List[RateLimitState]:
        """Parse '2:5:0,2:10:0,2:10:0' into list of states"""
        states = []
        for state_str in header.split(','):
            parts = state_str.strip().split(':')
            if len(parts) == 3:
                try:
                    states.append(RateLimitState(
                        current_requests=int(parts[0]),
                        period_seconds=int(parts[1]),
                        timeout_remaining=int(parts[2])
                    ))
                except ValueError:
                    pass
        return states

    def _update_interval(self) -> None:
        """Calculate optimal interval based on current state"""
        if not self.rate_limits or not self.rate_states:
            return

        min_safe_interval = self.default_interval

        for rule, limits in self.rate_limits.items():
            states = self.rate_states.get(rule, [])

            for i, limit in enumerate(limits):
                if i >= len(states):
                    continue

                state = states[i]

                # Check if we're in timeout
                if state.timeout_remaining > 0:
                    min_safe_interval = max(min_safe_interval, float(state.timeout_remaining))
                    continue

                # Calculate headroom
                if limit.max_requests > 0:
                    remaining_requests = limit.max_requests - state.current_requests
                    usage_percent = state.current_requests / limit.max_requests

                    # Adaptive slowdown based on usage
                    if usage_percent > 0.8:  # >80% used - slow down significantly
                        if remaining_requests > 0:
                            safe_interval = limit.period_seconds / remaining_requests
                            min_safe_interval = max(min_safe_interval, safe_interval * 1.5)
                    elif usage_percent > 0.5:  # >50% used - slight slowdown
                        if remaining_requests > 0:
                            safe_interval = limit.period_seconds / remaining_requests
                            min_safe_interval = max(min_safe_interval, safe_interval)

        self.current_interval = min_safe_interval

    async def wait(self) -> None:
        """
        Wait appropriate time before next request.

        Thread-safe: Uses lock to serialize access, ensuring only one request
        proceeds at a time through the rate limiting logic.
        """
        # Acquire lock to serialize requests - this ensures proper ordering
        # and prevents race conditions when multiple coroutines call wait()
        async with self._get_lock():
            now = time.time()

            # Calculate total wait time needed
            sleep_time = 0.0

            # Check backoff from 429
            if now < self.backoff_until:
                sleep_time = self.backoff_until - now

            # Standard rate limiting (after backoff)
            elapsed = (now + sleep_time) - self.last_request
            if elapsed < self.current_interval:
                sleep_time += self.current_interval - elapsed

            # Sleep if needed (while holding lock to maintain ordering)
            if sleep_time > 0:
                await asyncio.sleep(sleep_time)

            # Update last request time
            self.last_request = time.time()

    def handle_429(self, retry_after: Optional[int] = None) -> float:
        """Handle 429 response with exponential backoff. Returns wait time."""
        self.consecutive_429s += 1

        if retry_after and retry_after > 0:
            wait_time = float(retry_after)
        else:
            # Exponential backoff: 5, 10, 20, 40... capped at 120 seconds
            wait_time = min(5.0 * (2 ** (self.consecutive_429s - 1)), 120.0)

        self.backoff_until = time.time() + wait_time
        # Also increase interval for future requests
        self.current_interval = max(self.current_interval * 1.5, 5.0)

        return wait_time

    def handle_success(self) -> None:
        """Reset backoff state on successful request"""
        if self.consecutive_429s > 0:
            self.consecutive_429s = 0
            # Gradually decrease interval back to default
            self.current_interval = max(self.current_interval * 0.9, self.default_interval)
