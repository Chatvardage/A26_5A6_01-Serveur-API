import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { GatewayConfigService } from './gateway-config.service';

export const MAX_RATE_LIMIT_BUCKETS = 10_000;

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
}

@Injectable()
export class AuthRateLimitService implements OnModuleDestroy {
  private readonly buckets = new Map<string, RateLimitBucket>();
  private readonly cleanupTimer: ReturnType<typeof setInterval>;

  constructor(private readonly config: GatewayConfigService) {
    this.cleanupTimer = setInterval(
      () => this.cleanupExpiredBuckets(),
      Math.max(1000, this.config.authRateLimitWindowMs),
    );
    this.cleanupTimer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.cleanupTimer);
  }

  consume(key: string, now = Date.now()): RateLimitResult {
    const existing = this.buckets.get(key);
    const windowMs = this.config.authRateLimitWindowMs;
    const limit = this.config.authRateLimitMax;

    if (existing === undefined && this.buckets.size >= MAX_RATE_LIMIT_BUCKETS) {
      this.cleanupExpiredBuckets(now);
      if (this.buckets.size >= MAX_RATE_LIMIT_BUCKETS) {
        // Ne pas évincer un compteur actif : changer d'adresse ne réinitialise
        // pas la protection, et la mémoire reste bornée sous forte charge.
        return {
          allowed: false,
          limit,
          remaining: 0,
          resetAt: now + windowMs,
          retryAfterSeconds: Math.max(1, Math.ceil(windowMs / 1000)),
        };
      }
    }

    const bucket =
      existing === undefined || existing.resetAt <= now
        ? { count: 0, resetAt: now + windowMs }
        : existing;

    if (bucket.count >= limit) {
      this.buckets.set(key, bucket);
      return {
        allowed: false,
        limit,
        remaining: 0,
        resetAt: bucket.resetAt,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((bucket.resetAt - now) / 1000),
        ),
      };
    }

    bucket.count += 1;
    this.buckets.set(key, bucket);

    return {
      allowed: true,
      limit,
      remaining: Math.max(0, limit - bucket.count),
      resetAt: bucket.resetAt,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }

  private cleanupExpiredBuckets(now = Date.now()): void {
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) {
        this.buckets.delete(key);
      }
    }
  }
}
