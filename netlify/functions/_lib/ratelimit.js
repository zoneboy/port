// Best-effort login rate limiting. If Upstash env vars are absent, this
// becomes a no-op so the app still deploys without Upstash.
let redis = null;
async function getRedis() {
  if (redis !== null) return redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) { redis = false; return false; }
  try {
    const { Redis } = await import('@upstash/redis');
    redis = new Redis({ url, token });
  } catch {
    redis = false;
  }
  return redis;
}

// Returns true if the caller is allowed, false if rate limited.
// 10 attempts per 10 minutes per key.
export async function allowLogin(key) {
  const r = await getRedis();
  if (!r) return true;
  const bucket = `login:${key}`;
  const count = await r.incr(bucket);
  if (count === 1) await r.expire(bucket, 600);
  return count <= 10;
}
