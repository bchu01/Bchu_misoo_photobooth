/**
 * Token-bucket rate limiting for the room entry points.
 *
 * Room codes are short, so unlimited join attempts would make guessing a live
 * room practical. Buckets are keyed per client address and swept lazily.
 */

import { RATE_LIMITS, type RateLimitedEvent } from '@bchu/shared';

interface Bucket {
  tokens: number;
  lastRefillAt: number;
}

export interface RateLimitRule {
  tokens: number;
  refillPerMinute: number;
}

export interface RateLimiterOptions {
  now?: () => number;
  /** Overrides the shared defaults; used by tests and per-deployment tuning. */
  limits?: Record<RateLimitedEvent, RateLimitRule>;
}

const BUCKET_TTL_MS = 10 * 60 * 1000;

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private lastSweepAt = 0;
  private readonly now: () => number;
  private readonly limits: Record<RateLimitedEvent, RateLimitRule>;

  constructor(options: RateLimiterOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.limits = options.limits ?? RATE_LIMITS;
  }

  /** Returns false when the caller has exhausted its allowance. */
  consume(key: string, event: RateLimitedEvent): boolean {
    const limit = this.limits[event];
    const now = this.now();
    this.sweep(now);

    const bucketKey = `${event}:${key}`;
    const bucket = this.buckets.get(bucketKey) ?? { tokens: limit.tokens, lastRefillAt: now };

    const elapsedMinutes = (now - bucket.lastRefillAt) / 60_000;
    if (elapsedMinutes > 0) {
      bucket.tokens = Math.min(limit.tokens, bucket.tokens + elapsedMinutes * limit.refillPerMinute);
      bucket.lastRefillAt = now;
    }

    if (bucket.tokens < 1) {
      this.buckets.set(bucketKey, bucket);
      return false;
    }

    bucket.tokens -= 1;
    this.buckets.set(bucketKey, bucket);
    return true;
  }

  private sweep(now: number): void {
    if (now - this.lastSweepAt < BUCKET_TTL_MS) return;
    this.lastSweepAt = now;
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.lastRefillAt > BUCKET_TTL_MS) this.buckets.delete(key);
    }
  }
}
