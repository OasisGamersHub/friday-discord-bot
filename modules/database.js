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

// Sistema coda comandi per comunicazione dashboard-bot
export async function addPendingCommand(guildId, command, user) {
  if (!db) return null;
  
  try {
    const result = await db.collection('pendingCommands').insertOne({
      guildId,
      command,
      requestedBy: user,
      status: 'pending',
      createdAt: new Date()
    });
    return result.insertedId.toString();
  } catch (error) {
    console.error('Errore aggiunta comando:', error.message);
    return null;
  }
}

export async function getPendingCommands(guildId) {
  if (!db) return [];
  
  try {
    return await db.collection('pendingCommands')
      .find({ guildId, status: 'pending' })
      .sort({ createdAt: 1 })
      .toArray();
  } catch (error) {
    console.error('Errore lettura comandi pendenti:', error.message);
    return [];
  }
}

export async function updateCommandStatus(commandId, status, result = null) {
  if (!db) return false;
  
  try {
    const { ObjectId } = await import('mongodb');
    await db.collection('pendingCommands').updateOne(
      { _id: new ObjectId(commandId) },
      { 
        $set: { 
          status, 
          result,
          completedAt: new Date() 
        } 
      }
    );
    return true;
  } catch (error) {
    console.error('Errore aggiornamento comando:', error.message);
    return false;
  }
}

export async function getCommandResult(commandId) {
  if (!db) return null;
  
  try {
    const { ObjectId } = await import('mongodb');
    return await db.collection('pendingCommands').findOne({ _id: new ObjectId(commandId) });
  } catch (error) {
    console.error('Errore lettura risultato comando:', error.message);
    return null;
  }
}

export async function cleanOldCommands() {
  if (!db) return;
  
  try {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    await db.collection('pendingCommands').deleteMany({
      createdAt: { $lt: oneHourAgo }
    });
  } catch (error) {
    console.error('Errore pulizia comandi vecchi:', error.message);
  }
}

// ============================================
// ECONOMY & SHOP DATA (Scalable Architecture)
// ============================================
// Collections:
// - economyConfig: configurazione economia del server
// - shopItems: articoli dello shop (inseriti manualmente o via API)
// - serviceCosts: costi servizi esterni (OpenAI, MongoDB, Fly.io)
// - economyAnalysis: analisi e suggerimenti generati
// Future: transactions, memberProfiles, achievements

export async function saveEconomyConfig(guildId, config) {
  if (!db) return false;
  
  try {
    await db.collection('economyConfig').updateOne(
      { guildId },
      { 
        $set: { 
          ...config, 
          updatedAt: new Date(),
          source: config.source || 'manual' // manual, mee6_export, api
        } 
      },
      { upsert: true }
    );
    return true;
  } catch (error) {
    console.error('Errore salvataggio config economy:', error.message);
    return false;
  }
}

export async function getEconomyConfig(guildId) {
  if (!db) return null;
  
  try {
    return await db.collection('economyConfig').findOne({ guildId });
  } catch (error) {
    console.error('Errore lettura config economy:', error.message);
    return null;
  }
}

export async function saveShopItem(guildId, item) {
  if (!db) return null;
  
  try {
    const { ObjectId } = await import('mongodb');
    const itemId = item._id ? new ObjectId(item._id) : new ObjectId();
    
    await db.collection('shopItems').updateOne(
      { _id: itemId, guildId },
      { 
        $set: { 
          guildId,
          name: item.name,
          type: item.type, // role, boost, item, cosmetic
          price: item.price,
          currency: item.currency || 'coins',
          description: item.description || '',
          salesCount: item.salesCount || 0,
          isActive: item.isActive !== false,
          metadata: item.metadata || {},
          source: item.source || 'manual',
          updatedAt: new Date()
        },
        $setOnInsert: { createdAt: new Date() }
      },
      { upsert: true }
    );
    return itemId.toString();
  } catch (error) {
    console.error('Errore salvataggio shop item:', error.message);
    return null;
  }
}

export async function getShopItems(guildId) {
  if (!db) return [];
  
  try {
    return await db.collection('shopItems')
      .find({ guildId })
      .sort({ type: 1, price: 1 })
      .toArray();
  } catch (error) {
    console.error('Errore lettura shop items:', error.message);
    return [];
  }
}

export async function deleteShopItem(guildId, itemId) {
  if (!db) return false;
  
  try {
    const { ObjectId } = await import('mongodb');
    await db.collection('shopItems').deleteOne({ 
      _id: new ObjectId(itemId), 
      guildId 
    });
    return true;
  } catch (error) {
    console.error('Errore eliminazione shop item:', error.message);
    return false;
  }
}

export async function saveServiceCost(guildId, cost) {
  if (!db) return false;
  
  try {
    await db.collection('serviceCosts').insertOne({
      guildId,
      service: cost.service, // openai, mongodb, flyio, discord_nitro
      amount: cost.amount,
      currency: cost.currency || 'EUR',
      period: cost.period, // monthly, usage
      date: cost.date || new Date(),
      notes: cost.notes || '',
      source: cost.source || 'manual',
      createdAt: new Date()
    });
    return true;
  } catch (error) {
    console.error('Errore salvataggio costo servizio:', error.message);
    return false;
  }
}

export async function getServiceCosts(guildId, days = 30) {
  if (!db) return [];
  
  try {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    return await db.collection('serviceCosts')
      .find({ guildId, date: { $gte: since } })
      .sort({ date: -1 })
      .toArray();
  } catch (error) {
    console.error('Errore lettura costi servizi:', error.message);
    return [];
  }
}

export async function saveEconomyAnalysis(guildId, analysis) {
  if (!db) return false;
  
  try {
    await db.collection('economyAnalysis').insertOne({
      guildId,
      ...analysis,
      createdAt: new Date()
    });
    
    // Keep only last 10 analyses
    const count = await db.collection('economyAnalysis').countDocuments({ guildId });
    if (count > 10) {
      const oldest = await db.collection('economyAnalysis')
        .find({ guildId })
        .sort({ createdAt: 1 })
        .limit(count - 10)
        .toArray();
      const idsToDelete = oldest.map(a => a._id);
      await db.collection('economyAnalysis').deleteMany({ _id: { $in: idsToDelete } });
    }
    
    return true;
  } catch (error) {
    console.error('Errore salvataggio analisi economy:', error.message);
    return false;
  }
}

export async function getLatestEconomyAnalysis(guildId) {
  if (!db) return null;
  
  try {
    return await db.collection('economyAnalysis')
      .findOne({ guildId }, { sort: { createdAt: -1 } });
  } catch (error) {
    console.error('Errore lettura analisi economy:', error.message);
    return null;
  }
}
