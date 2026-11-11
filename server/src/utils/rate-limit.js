'use strict';

/**
 * Fixed-window rate limiter kept in process memory.
 * Buckets are keyed by route identity plus the authenticated admin, never by
 * the raw path or a client-supplied header. With several processes each one
 * counts separately (documented in the README).
 */

/**
 * Creates a limiter.
 * @param {{ max: number, windowMs: number, maxKeys?: number }} options - Limit.
 * @returns {{ hit: (key: string, now?: number) => { allowed: boolean, retryAfterMs: number }, reset: () => void }} Limiter.
 */
const createRateLimiter = ({ max, windowMs, maxKeys = 10000 }) => {
  const buckets = new Map();
  return {
    hit(key, now = Date.now()) {
      let bucket = buckets.get(key);
      if (!bucket || bucket.resetAt <= now) {
        if (buckets.size >= maxKeys) {
          for (const [bucketKey, value] of buckets) if (value.resetAt <= now) buckets.delete(bucketKey);
          if (buckets.size >= maxKeys) buckets.delete(buckets.keys().next().value);
        }
        bucket = { count: 0, resetAt: now + windowMs };
        buckets.set(key, bucket);
      }
      bucket.count += 1;
      return { allowed: bucket.count <= max, retryAfterMs: Math.max(0, bucket.resetAt - now) };
    },
    reset() {
      buckets.clear();
    },
  };
};

module.exports = { createRateLimiter };
