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
    return db;
  } catch (error) {
    console.error('Errore connessione MongoDB:', error.message);
    return null;
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

export async function closeDB() {
  if (client) {
    await client.close();
    console.log('Disconnesso da MongoDB');
  }
}
