const sharedState = {
  botStatus: 'offline',
  botStartTime: null,
  guilds: new Map(),
  activityLog: [],
  scheduledTasks: [],
  antiRaidStatus: new Map()
};

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

export default sharedState;
