const auditCache = new Map();
const rateLimits = new Map();

const AUDIT_CACHE_TTL = 6 * 60 * 60 * 1000;
const RATE_LIMIT_AUDIT = 10 * 60 * 1000;
const RATE_LIMIT_MEE6 = 5 * 60 * 1000;
const RATE_LIMIT_TESTI = 10 * 60 * 1000;

export function getCachedAudit(guildId) {
  const cached = auditCache.get(guildId);
  if (!cached) return null;
  
  if (Date.now() - cached.timestamp > AUDIT_CACHE_TTL) {
    auditCache.delete(guildId);
    return null;
  }
  
  return cached.data;
}

export function setCachedAudit(guildId, data) {
  auditCache.set(guildId, {
    data,
    timestamp: Date.now()
  });
}

export function invalidateAuditCache(guildId) {
  auditCache.delete(guildId);
}

export function checkRateLimit(guildId, command) {
  const key = `${guildId}:${command}`;
  const lastUsed = rateLimits.get(key);
  
  const limits = {
    'audit': RATE_LIMIT_AUDIT,
    'mee6': RATE_LIMIT_MEE6,
    'security': RATE_LIMIT_MEE6,
    'schema': RATE_LIMIT_MEE6,
    'testi': RATE_LIMIT_TESTI,
    'scalecheck': RATE_LIMIT_MEE6
  };
  
  const limit = limits[command] || 60000;
  
  if (lastUsed && Date.now() - lastUsed < limit) {
    const remaining = Math.ceil((limit - (Date.now() - lastUsed)) / 1000);
    return { allowed: false, remaining };
  }
  
  rateLimits.set(key, Date.now());
  return { allowed: true };
}

export function getCacheStats() {
  return {
    auditCacheSize: auditCache.size,
    rateLimitsSize: rateLimits.size
  };
}

setInterval(() => {
  const now = Date.now();
  
  for (const [key, cached] of auditCache) {
    if (now - cached.timestamp > AUDIT_CACHE_TTL) {
      auditCache.delete(key);
    }
  }
  
  for (const [key, timestamp] of rateLimits) {
    if (now - timestamp > 60 * 60 * 1000) {
      rateLimits.delete(key);
    }
  }
}, 30 * 60 * 1000);
