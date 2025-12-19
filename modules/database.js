import { MongoClient } from 'mongodb';

let client = null;
let db = null;

export async function connectDB() {
  const uri = process.env.MONGODB_URI;
  
  if (!uri) {
    console.log('MongoDB non configurato - usando storage in-memory');
    return null;
  }
  
  try {
    client = new MongoClient(uri);
    await client.connect();
    db = client.db('fridaybot');
    console.log('Connesso a MongoDB');
    
    await setupTTLIndexes();
    
    return db;
  } catch (error) {
    console.error('Errore connessione MongoDB:', error.message);
    return null;
  }
}

async function setupTTLIndexes() {
  if (!db) return;
  
  try {
    await db.collection('auditLogs').createIndex(
      { createdAt: 1 },
      { expireAfterSeconds: 30 * 24 * 60 * 60 }
    );
    
    await db.collection('dailyMetrics').createIndex(
      { date: 1 },
      { expireAfterSeconds: 90 * 24 * 60 * 60 }
    );
    
    await db.collection('serverSnapshots').createIndex(
      { createdAt: 1 },
      { expireAfterSeconds: 30 * 24 * 60 * 60 }
    );
    
    console.log('TTL indexes configurati');
  } catch (error) {
    console.log('TTL indexes già esistenti o errore:', error.message);
  }
}

export async function saveServerStats(guildId, stats) {
  if (!db) return false;
  
  try {
    await db.collection('serverStats').updateOne(
      { guildId },
      { $set: { ...stats, updatedAt: new Date() } },
      { upsert: true }
    );
    return true;
  } catch (error) {
    console.error('Errore salvataggio stats:', error.message);
    return false;
  }
}

export async function getServerStats(guildId) {
  if (!db) return null;
  
  try {
    return await db.collection('serverStats').findOne({ guildId });
  } catch (error) {
    console.error('Errore lettura stats:', error.message);
    return null;
  }
}

export async function saveAuditLog(guildId, auditData) {
  if (!db) return false;
  
  try {
    await db.collection('auditLogs').insertOne({
      guildId,
      ...auditData,
      createdAt: new Date()
    });
    return true;
  } catch (error) {
    console.error('Errore salvataggio audit:', error.message);
    return false;
  }
}

export async function getAuditHistory(guildId, limit = 10) {
  if (!db) return [];
  
  try {
    return await db.collection('auditLogs')
      .find({ guildId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();
  } catch (error) {
    console.error('Errore lettura audit:', error.message);
    return [];
  }
}

export async function saveServerSnapshot(guildId, snapshot) {
  if (!db) return false;
  
  try {
    await db.collection('serverSnapshots').insertOne({
      guildId,
      ...snapshot,
      createdAt: new Date()
    });
    
    const count = await db.collection('serverSnapshots').countDocuments({ guildId });
    if (count > 30) {
      const oldest = await db.collection('serverSnapshots')
        .find({ guildId })
        .sort({ createdAt: 1 })
        .limit(count - 30)
        .toArray();
      
      if (oldest.length > 0) {
        await db.collection('serverSnapshots').deleteMany({
          _id: { $in: oldest.map(s => s._id) }
        });
      }
    }
    return true;
  } catch (error) {
    console.error('Errore salvataggio snapshot:', error.message);
    return false;
  }
}

export async function getServerSnapshots(guildId, limit = 10) {
  if (!db) return [];
  
  try {
    return await db.collection('serverSnapshots')
      .find({ guildId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();
  } catch (error) {
    console.error('Errore lettura snapshots:', error.message);
    return [];
  }
}

export async function saveDailyMetrics(guildId, metrics) {
  if (!db) return false;
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  try {
    await db.collection('dailyMetrics').updateOne(
      { guildId, date: today },
      { 
        $set: { ...metrics, date: today, updatedAt: new Date() },
        $setOnInsert: { createdAt: new Date() }
      },
      { upsert: true }
    );
    return true;
  } catch (error) {
    console.error('Errore salvataggio metriche:', error.message);
    return false;
  }
}

export async function getDailyMetrics(guildId, days = 30) {
  if (!db) return [];
  
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  startDate.setHours(0, 0, 0, 0);
  
  try {
    return await db.collection('dailyMetrics')
      .find({ guildId, date: { $gte: startDate } })
      .sort({ date: 1 })
      .toArray();
  } catch (error) {
    console.error('Errore lettura metriche:', error.message);
    return [];
  }
}

export async function getTodayMetrics(guildId) {
  if (!db) return null;
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  try {
    return await db.collection('dailyMetrics').findOne({ guildId, date: today });
  } catch (error) {
    console.error('Errore lettura metriche di oggi:', error.message);
    return null;
  }
}

export async function getTrends(guildId) {
  if (!db) return null;
  
  try {
    const metrics = await getDailyMetrics(guildId, 14);
    if (metrics.length < 2) return null;
    
    const recent = metrics.slice(-7);
    const previous = metrics.slice(0, 7);
    
    const avgRecent = {
      members: recent.reduce((sum, m) => sum + (m.memberCount || 0), 0) / recent.length,
      messages: recent.reduce((sum, m) => sum + (m.messageCount || 0), 0) / recent.length
    };
    
    const avgPrevious = {
      members: previous.reduce((sum, m) => sum + (m.memberCount || 0), 0) / previous.length,
      messages: previous.reduce((sum, m) => sum + (m.messageCount || 0), 0) / previous.length
    };
    
    return {
      memberTrend: avgPrevious.members > 0 ? ((avgRecent.members - avgPrevious.members) / avgPrevious.members * 100).toFixed(1) : 0,
      messageTrend: avgPrevious.messages > 0 ? ((avgRecent.messages - avgPrevious.messages) / avgPrevious.messages * 100).toFixed(1) : 0,
      dataPoints: metrics.length
    };
  } catch (error) {
    console.error('Errore calcolo trends:', error.message);
    return null;
  }
}

export async function saveConfigBackup(guildId, config) {
  if (!db) return false;
  
  try {
    await db.collection('configBackups').insertOne({
      guildId,
      ...config,
      createdAt: new Date()
    });
    
    const count = await db.collection('configBackups').countDocuments({ guildId });
    if (count > 10) {
      const oldest = await db.collection('configBackups')
        .find({ guildId })
        .sort({ createdAt: 1 })
        .limit(count - 10)
        .toArray();
      
      if (oldest.length > 0) {
        await db.collection('configBackups').deleteMany({
          _id: { $in: oldest.map(s => s._id) }
        });
      }
    }
    return true;
  } catch (error) {
    console.error('Errore salvataggio backup:', error.message);
    return false;
  }
}

export async function getConfigBackups(guildId, limit = 10) {
  if (!db) return [];
  
  try {
    return await db.collection('configBackups')
      .find({ guildId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();
  } catch (error) {
    console.error('Errore lettura backups:', error.message);
    return [];
  }
}

export async function getLatestBackup(guildId) {
  if (!db) return null;
  
  try {
    return await db.collection('configBackups')
      .findOne({ guildId }, { sort: { createdAt: -1 } });
  } catch (error) {
    console.error('Errore lettura ultimo backup:', error.message);
    return null;
  }
}

export async function closeDB() {
  if (client) {
    await client.close();
    console.log('Disconnesso da MongoDB');
  }
}
