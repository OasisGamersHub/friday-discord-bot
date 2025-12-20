import crypto from 'crypto';

const sharedState = {
  botStatus: 'offline',
  botStartTime: null,
  guilds: new Map(),
  activityLog: [],
  scheduledTasks: [],
  antiRaidStatus: new Map(),
  securityLog: [],
  loginAttempts: new Map(),
  blockedIPs: new Map(),
  activeSessions: new Map(),
  securityAlerts: [],
  growthData: new Map()
};

export function logSecurityEvent(event) {
  const entry = {
    ...event,
    timestamp: Date.now(),
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  };
  sharedState.securityLog.unshift(entry);
  if (sharedState.securityLog.length > 500) {
    sharedState.securityLog.pop();
  }
  
  if (event.severity === 'high' || event.severity === 'critical') {
    sharedState.securityAlerts.unshift(entry);
    if (sharedState.securityAlerts.length > 50) {
      sharedState.securityAlerts.pop();
    }
  }
  return entry;
}

export function getSecurityLog(limit = 50) {
  return sharedState.securityLog.slice(0, limit);
}

export function getSecurityAlerts(limit = 20) {
  return sharedState.securityAlerts.slice(0, limit);
}

export function recordLoginAttempt(ip, success) {
  const attempts = sharedState.loginAttempts.get(ip) || { count: 0, lastAttempt: 0, blocked: false };
  
  if (success) {
    sharedState.loginAttempts.delete(ip);
    return { blocked: false };
  }
  
  attempts.count++;
  attempts.lastAttempt = Date.now();
  
  if (attempts.count >= 5) {
    attempts.blocked = true;
    attempts.blockedUntil = Date.now() + (15 * 60 * 1000);
    sharedState.blockedIPs.set(ip, attempts.blockedUntil);
    
    logSecurityEvent({
      type: 'brute_force_blocked',
      ip,
      severity: 'high',
      message: `IP ${ip} bloccato per troppi tentativi di login falliti`
    });
  }
  
  sharedState.loginAttempts.set(ip, attempts);
  return attempts;
}

export function isIPBlocked(ip) {
  const blockedUntil = sharedState.blockedIPs.get(ip);
  if (!blockedUntil) return false;
  
  if (Date.now() > blockedUntil) {
    sharedState.blockedIPs.delete(ip);
    sharedState.loginAttempts.delete(ip);
    return false;
  }
  return true;
}

export function registerSession(sessionId, userId, ip) {
  sharedState.activeSessions.set(sessionId, {
    userId,
    ip,
    createdAt: Date.now(),
    lastActivity: Date.now()
  });
}

export function updateSessionActivity(sessionId) {
  const session = sharedState.activeSessions.get(sessionId);
  if (session) {
    session.lastActivity = Date.now();
  }
}

export function getActiveSessions() {
  const sessions = [];
  for (const [id, data] of sharedState.activeSessions) {
    sessions.push({ id: id.slice(0, 8) + '...', ...data });
  }
  return sessions;
}

export function invalidateSession(sessionId) {
  return sharedState.activeSessions.delete(sessionId);
}

export function getSecurityStats() {
  const now = Date.now();
  const last24h = now - (24 * 60 * 60 * 1000);
  
  const recentEvents = sharedState.securityLog.filter(e => e.timestamp > last24h);
  const blockedIPs = Array.from(sharedState.blockedIPs.entries()).filter(([_, until]) => until > now);
  
  return {
    totalEvents24h: recentEvents.length,
    blockedIPsCount: blockedIPs.length,
    activeSessionsCount: sharedState.activeSessions.size,
    criticalAlerts: recentEvents.filter(e => e.severity === 'critical').length,
    highAlerts: recentEvents.filter(e => e.severity === 'high').length,
    loginFailures: recentEvents.filter(e => e.type === 'login_failed').length,
    successfulLogins: recentEvents.filter(e => e.type === 'login_success').length
  };
}

export function setBotOnline() {
  sharedState.botStatus = 'online';
  sharedState.botStartTime = Date.now();
}

export function setBotOffline() {
  sharedState.botStatus = 'offline';
}

export function updateGuildStats(guildId, stats) {
  sharedState.guilds.set(guildId, {
    ...sharedState.guilds.get(guildId),
    ...stats,
    lastUpdate: Date.now()
  });
}

export function getGuildStats(guildId) {
  return sharedState.guilds.get(guildId) || null;
}

export function getAllGuildsStats() {
  const result = {};
  for (const [id, stats] of sharedState.guilds) {
    result[id] = stats;
  }
  return result;
}

export function addActivityLog(entry) {
  sharedState.activityLog.unshift({
    ...entry,
    timestamp: Date.now()
  });
  if (sharedState.activityLog.length > 100) {
    sharedState.activityLog.pop();
  }
}

export function getActivityLog(limit = 20) {
  return sharedState.activityLog.slice(0, limit);
}

export function getBotUptime() {
  if (!sharedState.botStartTime) return 0;
  return Date.now() - sharedState.botStartTime;
}

export function getBotStatus() {
  return {
    status: sharedState.botStatus,
    uptime: getBotUptime(),
    startTime: sharedState.botStartTime
  };
}

export function setAntiRaidStatus(guildId, status) {
  sharedState.antiRaidStatus.set(guildId, {
    ...status,
    updatedAt: Date.now()
  });
}

export function getAntiRaidStatus(guildId) {
  return sharedState.antiRaidStatus.get(guildId) || { enabled: false, triggered: false };
}

export function addScheduledTask(task) {
  sharedState.scheduledTasks.push(task);
}

export function getScheduledTasks() {
  return sharedState.scheduledTasks;
}

export function removeScheduledTask(taskId) {
  const index = sharedState.scheduledTasks.findIndex(t => t.id === taskId);
  if (index > -1) {
    sharedState.scheduledTasks.splice(index, 1);
    return true;
  }
  return false;
}

export function setGrowthData(guildId, scaling, economy) {
  sharedState.growthData.set(guildId, {
    scaling,
    economy,
    updatedAt: Date.now()
  });
}

export function getGrowthData(guildId) {
  const data = sharedState.growthData.get(guildId);
  if (!data) return null;
  
  if (Date.now() - data.updatedAt > 10 * 60 * 1000) {
    return null;
  }
  return data;
}

export function setStructureData(guildId, analysis) {
  if (!sharedState.structureData) {
    sharedState.structureData = new Map();
  }
  sharedState.structureData.set(guildId, {
    analysis,
    updatedAt: Date.now()
  });
}

export function getStructureData(guildId) {
  if (!sharedState.structureData) return null;
  const data = sharedState.structureData.get(guildId);
  if (!data) return null;
  
  if (Date.now() - data.updatedAt > 30 * 60 * 1000) {
    return null;
  }
  return data;
}

export default sharedState;
