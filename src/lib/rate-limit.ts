type RateLimitBucket = {
  count: number;
  resetAt: number;
};

type RateLimitOptions = {
  limit: number;
  windowMs: number;
};

type RateLimitResult = {
  limited: boolean;
  remaining: number;
  retryAfter: number;
};

type RateLimitStorage = {
  consume(key: string, options: RateLimitOptions): Promise<RateLimitResult>;
};

const globalForRateLimit = globalThis as typeof globalThis & {
  __waveRateLimitStore?: Map<string, RateLimitBucket>;
};

const store =
  globalForRateLimit.__waveRateLimitStore ??
  new Map<string, RateLimitBucket>();

if (!globalForRateLimit.__waveRateLimitStore) {
  globalForRateLimit.__waveRateLimitStore = store;
}

function pruneExpired(now: number) {
  if (store.size < 10_000) return;

  for (const [key, bucket] of store.entries()) {
    if (bucket.resetAt <= now) {
      store.delete(key);
    }
  }
}

export function getClientIp(req: Request) {
  const forwarded = req.headers.get("x-forwarded-for");
  const firstForwarded = forwarded?.split(",")[0]?.trim();

  return (
    firstForwarded ||
    req.headers.get("x-real-ip")?.trim() ||
    req.headers.get("cf-connecting-ip")?.trim() ||
    "unknown"
  );
}

const memoryStorage: RateLimitStorage = {
  async consume(key, options) {
    const now = Date.now();
    pruneExpired(now);

    const current = store.get(key);
    if (!current || current.resetAt <= now) {
      store.set(key, {
        count: 1,
        resetAt: now + options.windowMs,
      });

      return {
        limited: false,
        remaining: Math.max(0, options.limit - 1),
        retryAfter: 0,
      };
    }

    if (current.count >= options.limit) {
      return {
        limited: true,
        remaining: 0,
        retryAfter: Math.ceil((current.resetAt - now) / 1000),
      };
    }

    current.count += 1;
    store.set(key, current);

    return {
      limited: false,
      remaining: Math.max(0, options.limit - current.count),
      retryAfter: 0,
    };
  },
};

function getUpstashConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();

  if (!url || !token) return null;
  return { url, token };
}

async function runUpstashCommand(
  config: { url: string; token: string },
  command: unknown[]
) {
  const res = await fetch(config.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`UPSTASH_HTTP_${res.status}`);
  }

  const payload = (await res.json()) as { result?: unknown; error?: string };
  if (payload.error) {
    throw new Error(payload.error);
  }

  return payload.result;
}

const redisStorage: RateLimitStorage = {
  async consume(key, options) {
    const config = getUpstashConfig();
    if (!config) return memoryStorage.consume(key, options);

    try {
      const namespacedKey = `rate-limit:${key}`;
      const count = Number(
        await runUpstashCommand(config, ["INCR", namespacedKey])
      );

      if (!Number.isFinite(count) || count < 1) {
        throw new Error("UPSTASH_INVALID_INCR_RESULT");
      }

      if (count === 1) {
        await runUpstashCommand(config, [
          "PEXPIRE",
          namespacedKey,
          options.windowMs,
        ]);
      }

      const ttlMs = Number(await runUpstashCommand(config, ["PTTL", namespacedKey]));
      const retryAfter = ttlMs > 0 ? Math.ceil(ttlMs / 1000) : 0;

      return {
        limited: count > options.limit,
        remaining: Math.max(0, options.limit - count),
        retryAfter,
      };
    } catch (error) {
      console.warn("RATE_LIMIT_REDIS_FALLBACK", {
        error: error instanceof Error ? error.message : String(error),
      });
      return memoryStorage.consume(key, options);
    }
  },
};

export async function consumeRateLimit(
  key: string,
  options: RateLimitOptions
) {
  return redisStorage.consume(key, options);
}
