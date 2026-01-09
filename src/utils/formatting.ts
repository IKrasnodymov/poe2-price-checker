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
  // Extended stats (v2)
  p10?: number;       // 10th percentile (cheap listings)
  p25?: number;       // 25th percentile (lower quartile)
  p75?: number;       // 75th percentile (upper quartile)
  p90?: number;       // 90th percentile (expensive listings)
  stdDev?: number;    // Standard deviation
  volatility?: "low" | "medium" | "high";  // Price volatility indicator
}

export interface Listing {
  amount?: number | null;
  currency?: string;
}

/**
 * Calculate percentile value from sorted array
 */
function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  if (sortedValues.length === 1) return sortedValues[0];

  const index = (p / 100) * (sortedValues.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);

  if (lower === upper) return sortedValues[lower];

  const fraction = index - lower;
  return sortedValues[lower] + fraction * (sortedValues[upper] - sortedValues[lower]);
}

/**
 * Calculate standard deviation
 */
function standardDeviation(values: number[], mean: number): number {
  if (values.length < 2) return 0;

  const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
  const avgSquaredDiff = squaredDiffs.reduce((sum, v) => sum + v, 0) / values.length;
  return Math.sqrt(avgSquaredDiff);
}

/**
 * Determine price volatility based on coefficient of variation
 */
function getVolatility(stdDev: number, mean: number): "low" | "medium" | "high" {
  if (mean === 0) return "low";
  const cv = stdDev / mean;  // Coefficient of variation
  if (cv < 0.25) return "low";      // < 25% variation
  if (cv < 0.50) return "medium";   // 25-50% variation
  return "high";                     // > 50% variation
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

  // Calculate extended stats
  const p10 = percentile(values, 10);
  const p25 = percentile(values, 25);
  const p75 = percentile(values, 75);
  const p90 = percentile(values, 90);
  const stdDev = standardDeviation(values, average);
  const volatility = getVolatility(stdDev, average);

  return {
    min, max, median, average, currency: dominant, count: values.length,
    p10, p25, p75, p90, stdDev, volatility
  };
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
