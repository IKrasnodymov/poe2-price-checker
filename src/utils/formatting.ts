// src/utils/formatting.ts
// Shared formatting utilities

/**
 * Format a Unix timestamp into a human-readable relative time string
 */
export function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor(Date.now() / 1000 - timestamp);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

/**
 * Format an ISO date string into a human-readable relative time
 */
export function formatIndexedTime(indexed: string): string {
  try {
    const date = new Date(indexed);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return `${Math.floor(diffDays / 7)}w ago`;
  } catch {
    return indexed;
  }
}

/**
 * Format an ISO date string into a compact relative time (for listings)
 */
export function formatIndexedTimeCompact(indexed: string): string {
  try {
    const date = new Date(indexed);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "now";
    if (diffMins < 60) return `${diffMins}m`;
    if (diffHours < 24) return `${diffHours}h`;
    return `${diffDays}d`;
  } catch {
    return "";
  }
}

/**
 * Calculate price statistics from a list of listings
 */
export interface PriceStats {
  min: number;
  max: number;
  median: number;
  average: number;
  currency: string;
  count: number;
}

export interface Listing {
  amount?: number | null;
  currency?: string;
}

export function calculatePriceStats(listings: Listing[]): PriceStats | null {
  const byCurrency: Record<string, number[]> = {};

  listings.forEach((l) => {
    if (l.amount != null && l.amount > 0 && l.currency) {
      const curr = l.currency.toLowerCase();
      if (!byCurrency[curr]) byCurrency[curr] = [];
      byCurrency[curr].push(l.amount);
    }
  });

  // Find dominant currency
  let dominant = "chaos";
  let maxCount = 0;
  Object.entries(byCurrency).forEach(([curr, vals]) => {
    if (vals.length > maxCount) {
      maxCount = vals.length;
      dominant = curr;
    }
  });

  const values = byCurrency[dominant] || [];
  if (values.length === 0) return null;

  values.sort((a, b) => a - b);
  const min = values[0];
  const max = values[values.length - 1];
  const mid = Math.floor(values.length / 2);
  const median = values.length % 2 !== 0
    ? values[mid]
    : (values[mid - 1] + values[mid]) / 2;
  const average = values.reduce((sum, v) => sum + v, 0) / values.length;

  return { min, max, median, average, currency: dominant, count: values.length };
}

/**
 * Group listings by currency and calculate stats for each
 */
export function calculateStatsByCurrency(listings: Listing[]): PriceStats[] {
  const byCurrency: Record<string, number[]> = {};

  listings.forEach((l) => {
    if (l.amount != null && l.amount > 0 && l.currency) {
      const curr = l.currency.toLowerCase();
      if (!byCurrency[curr]) byCurrency[curr] = [];
      byCurrency[curr].push(l.amount);
    }
  });

  const stats: PriceStats[] = [];

  Object.entries(byCurrency).forEach(([currency, values]) => {
    values.sort((a, b) => a - b);
    const mid = Math.floor(values.length / 2);
    const median = values.length % 2 !== 0
      ? values[mid]
      : (values[mid - 1] + values[mid]) / 2;
    const average = values.reduce((sum, v) => sum + v, 0) / values.length;

    stats.push({
      currency,
      min: values[0],
      max: values[values.length - 1],
      median,
      average,
      count: values.length,
    });
  });

  // Sort by count (most common currency first)
  stats.sort((a, b) => b.count - a.count);

  return stats;
}
