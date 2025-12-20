import express from 'express';
import session from 'express-session';
import cookieParser from 'cookie-parser';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
  getBotStatus,
  getGuildStats,
  getAllGuildsStats,
  getActivityLog,
  addActivityLog,
  getAntiRaidStatus,
  logSecurityEvent,
  getSecurityLog,
  getSecurityAlerts,
  recordLoginAttempt,
  isIPBlocked,
  registerSession,
  updateSessionActivity,
  getActiveSessions,
  getSecurityStats,
  invalidateSession,
  getGrowthData,
  getStructureData
} from './modules/sharedState.js';
import {
  connectDB,
  getDailyMetrics,
  getAuditHistory,
  getConfigBackups,
  getTrends,
  addPendingCommand,
  getCommandResult,
  getShopItems,
  saveShopItem,
  deleteShopItem,
  getServiceCosts
} from './modules/database.js';

const app = express();
const PORT = 5000;

const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const isProduction = !!process.env.DASHBOARD_URL;
const REDIRECT_URI = process.env.DASHBOARD_URL 
  ? `${process.env.DASHBOARD_URL}/auth/discord/callback`
  : `https://${process.env.REPLIT_DEV_DOMAIN}/auth/discord/callback`;

const ALLOWED_GUILD_ID = process.env.OASIS_GUILD_ID || null;

const apiRateLimits = new Map();
const API_RATE_LIMIT = 60;
const API_RATE_WINDOW = 60000;

app.set('trust proxy', 1);
app.use(cookieParser());
app.use(express.json());

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  
  if (isProduction) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  
  res.setHeader('Content-Security-Policy', 
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src 'self' https://fonts.gstatic.com; " +
    "img-src 'self' https://cdn.discordapp.com data:; " +
    "connect-src 'self'"
  );
  
  next();
});

app.use((req, res, next) => {
  const clientIP = req.ip || req.connection.remoteAddress;
  
  if (isIPBlocked(clientIP)) {
    logSecurityEvent({
      type: 'blocked_request',
      ip: clientIP,
      path: req.path,
      severity: 'medium',
      message: `Richiesta bloccata da IP bannato: ${clientIP}`
    });
    return res.status(403).json({ error: 'IP temporaneamente bloccato' });
  }
  
  next();
});

function apiRateLimit(req, res, next) {
  const clientIP = req.ip || req.connection.remoteAddress;
  const key = `${clientIP}:${req.path}`;
  const now = Date.now();
  
  let record = apiRateLimits.get(key);
  if (!record || now - record.windowStart > API_RATE_WINDOW) {
    record = { count: 0, windowStart: now };
  }
  
  record.count++;
  apiRateLimits.set(key, record);
  
  res.setHeader('X-RateLimit-Limit', API_RATE_LIMIT);
  res.setHeader('X-RateLimit-Remaining', Math.max(0, API_RATE_LIMIT - record.count));
  
  if (record.count > API_RATE_LIMIT) {
    logSecurityEvent({
      type: 'rate_limit_exceeded',
      ip: clientIP,
      path: req.path,
      severity: 'medium',
      message: `Rate limit superato: ${clientIP} su ${req.path}`
    });
    return res.status(429).json({ error: 'Troppe richieste. Riprova tra poco.' });
  }
  
  next();
}

app.use(session({
  secret: process.env.SESSION_SECRET || 'discord-oauth-fallback-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: isProduction,
    sameSite: 'lax',
    httpOnly: true,
    maxAge: 4 * 60 * 60 * 1000
  }
}));

app.use((req, res, next) => {
  if (req.session?.user && req.session.id) {
    updateSessionActivity(req.session.id);
  }
  next();
});

app.set('Cache-Control', 'no-cache');

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

app.get('/friday-logo.png', (req, res) => {
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.sendFile(join(__dirname, 'attached_assets', 'friday-bot-logo.png'));
});

const styles = `
  @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&display=swap');
  
  :root {
    --primary: #4FD1C5;
    --accent: #D4A373;
    --bg-dark: #000000;
    --bg-card: #0A0A0A;
    --bg-elevated: #111111;
    --text-primary: #FFFFFF;
    --text-secondary: #A0A0A0;
    --text-muted: #666666;
    --border: #1A1A1A;
    --border-hover: #2A2A2A;
    --danger: #EF4444;
    --success: #22C55E;
    --warning: #EAB308;
  }
  
  * { margin: 0; padding: 0; box-sizing: border-box; }
  
  body { 
    font-family: 'Inter', system-ui, -apple-system, sans-serif; 
    background: var(--bg-dark);
    color: var(--text-primary); 
    min-height: 100vh;
    line-height: 1.5;
  }
  
  h1, h2, h3, h4 { font-family: 'Space Grotesk', sans-serif; font-weight: 600; }
  
  .navbar { 
    background: var(--bg-dark);
    padding: 16px 32px; 
    display: flex; 
    justify-content: space-between; 
    align-items: center; 
    border-bottom: 1px solid var(--border); 
    position: sticky; 
    top: 0; 
    z-index: 100; 
  }
  .navbar .brand { display: flex; align-items: center; gap: 12px; }
  .navbar .brand img { 
    width: 40px; 
    height: 40px; 
    border-radius: 8px;
  }
  .navbar h1 { 
    font-size: 1.25rem; 
    font-weight: 600;
    color: var(--text-primary);
  }
  .navbar a { color: var(--text-secondary); text-decoration: none; margin-left: 24px; font-size: 0.875rem; }
  .navbar a:hover { color: var(--text-primary); }
  
  .container { max-width: 1200px; margin: 0 auto; padding: 32px 24px; }
  
  .card { 
    background: var(--bg-card);
    border: 1px solid var(--border); 
    border-radius: 8px; 
    padding: 24px; 
    margin-bottom: 16px;
  }
  .card:hover { border-color: var(--border-hover); }
  
  .card h2 { 
    color: var(--text-primary); 
    margin-bottom: 16px; 
    font-size: 1rem; 
    font-weight: 600;
  }
  
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; }
  
  .stat-box { 
    background: var(--bg-elevated);
    border: 1px solid var(--border); 
    border-radius: 8px; 
    padding: 20px; 
    text-align: center;
  }
  .stat-box:hover { border-color: var(--border-hover); }
  .stat-box .value { 
    font-family: 'Space Grotesk', sans-serif;
    font-size: 2rem; 
    font-weight: 700; 
    color: var(--primary);
  }
  .stat-box .label { 
    color: var(--text-muted); 
    margin-top: 4px; 
    font-size: 0.75rem; 
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  
  .btn { 
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 10px 20px; 
    border-radius: 6px; 
    text-decoration: none; 
    font-weight: 500; 
    cursor: pointer; 
    border: none;
    font-size: 0.875rem;
    font-family: 'Inter', sans-serif;
  }
  .btn-primary { 
    background: var(--primary);
    color: #000000;
  }
  .btn-primary:hover { opacity: 0.9; }
  .btn-discord { 
    background: #5865F2;
    color: white;
  }
  .btn-discord:hover { opacity: 0.9; }
  .btn-danger { 
    background: var(--danger);
    color: white;
  }
  .btn-danger:hover { opacity: 0.9; }
  .btn-outline { 
    background: transparent; 
    border: 1px solid var(--border); 
    color: var(--text-secondary);
  }
  .btn-outline:hover { 
    border-color: var(--primary); 
    color: var(--primary);
  }
  
  .user-info { display: flex; align-items: center; gap: 12px; }
  .user-info img { 
    width: 36px; 
    height: 36px; 
    border-radius: 6px;
  }
  .user-info span { font-weight: 500; color: var(--text-primary); font-size: 0.875rem; }
  
  .progress-bar { 
    background: var(--bg-elevated); 
    border-radius: 4px; 
    height: 8px; 
    overflow: hidden; 
    margin-top: 8px;
  }
  .progress-fill { height: 100%; border-radius: 4px; }
  .progress-fill.green { background: var(--success); }
  .progress-fill.yellow { background: var(--warning); }
  .progress-fill.red { background: var(--danger); }
  
  .issue-list { list-style: none; }
  .issue-list li { padding: 12px 16px; margin: 6px 0; border-radius: 6px; font-size: 0.875rem; }
  .issue-list li.critical { background: rgba(239, 68, 68, 0.1); border-left: 3px solid var(--danger); }
  .issue-list li.high { background: rgba(234, 179, 8, 0.1); border-left: 3px solid var(--warning); }
  .issue-list li.medium { background: rgba(79, 209, 197, 0.1); border-left: 3px solid var(--primary); }
  
  .guilds-list { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 12px; }
  .guild-card { 
    background: var(--bg-elevated); 
    border: 1px solid var(--border); 
    padding: 12px 16px; 
    border-radius: 6px; 
    display: flex; 
    align-items: center; 
    gap: 12px;
  }
  .guild-card:hover { border-color: var(--border-hover); }
  .guild-card img { width: 32px; height: 32px; border-radius: 6px; }
  
  .hero { text-align: center; padding: 80px 24px; }
  .hero .logo { 
    width: 120px; 
    height: 120px; 
    border-radius: 16px; 
    margin-bottom: 24px;
    position: relative;
    z-index: 1;
  }
  .hero h1 { 
    font-size: 2.5rem; 
    margin-bottom: 16px;
    color: var(--text-primary);
  }
  .hero p { 
    color: var(--text-secondary); 
    margin-bottom: 32px; 
    font-size: 1rem; 
    max-width: 480px; 
    margin-left: auto; 
    margin-right: auto;
  }
  
  .features { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; margin-top: 48px; }
  .feature-card { 
    background: var(--bg-card);
    border: 1px solid var(--border); 
    border-radius: 8px; 
    padding: 24px; 
    text-align: center;
  }
  .feature-card:hover { border-color: var(--border-hover); }
  .feature-card .icon { 
    font-size: 2rem; 
    margin-bottom: 12px;
    display: block;
  }
  .feature-card h3 { 
    color: var(--text-primary); 
    font-size: 1rem; 
    margin-bottom: 8px; 
    font-weight: 600;
  }
  .feature-card p { 
    color: var(--text-muted); 
    font-size: 0.875rem; 
    line-height: 1.5;
  }
  
  .command-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px; margin-top: 16px; }
  .command-item { 
    background: var(--bg-elevated); 
    border: 1px solid var(--border); 
    border-radius: 6px; 
    padding: 12px 16px;
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .command-item:hover { border-color: var(--border-hover); }
  .command-item code { 
    background: var(--bg-card);
    color: var(--primary); 
    padding: 4px 10px; 
    border-radius: 4px; 
    font-family: 'SF Mono', 'Consolas', monospace; 
    font-size: 0.8rem;
    font-weight: 500;
    white-space: nowrap;
  }
  .command-item span { color: var(--text-secondary); font-size: 0.875rem; }
  
  .accent { color: var(--accent); }
  
  .footer { 
    text-align: center; 
    padding: 24px; 
    color: var(--text-muted); 
    font-size: 0.75rem; 
    border-top: 1px solid var(--border); 
    margin-top: 48px;
  }
  .footer strong { color: var(--primary); }
`;

app.get('/', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  
  if (req.session.user) {
    const avatarUrl = req.session.user.avatar 
      ? `https://cdn.discordapp.com/avatars/${req.session.user.id}/${req.session.user.avatar}.png`
      : `https://cdn.discordapp.com/embed/avatars/0.png`;
    
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Friday Bot - Dashboard | Oasis Gamers Hub</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <link rel="icon" href="/friday-logo.png" type="image/png">
        <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
        <style>${styles}
          .tabs { 
            display: flex; 
            gap: 4px; 
            margin-bottom: 24px; 
            flex-wrap: wrap;
            border-bottom: 1px solid var(--border);
            padding-bottom: 12px;
          }
          .tab { 
            padding: 8px 16px; 
            background: transparent;
            border: none;
            border-radius: 4px; 
            cursor: pointer; 
            color: var(--text-muted); 
            font-weight: 500;
            font-size: 0.875rem;
          }
          .tab:hover { color: var(--text-primary); }
          .tab.active { 
            background: var(--bg-elevated);
            color: var(--primary);
          }
          .tab-content { display: none; }
          .tab-content.active { display: block; }
          
          .chart-container { 
            background: var(--bg-elevated);
            border: 1px solid var(--border);
            border-radius: 6px; 
            padding: 16px; 
            margin-top: 16px;
          }
          
          .activity-log { 
            max-height: 400px; 
            overflow-y: auto;
          }
          .activity-log::-webkit-scrollbar { width: 4px; }
          .activity-log::-webkit-scrollbar-track { background: var(--bg-dark); }
          .activity-log::-webkit-scrollbar-thumb { background: var(--border-hover); border-radius: 2px; }
          
          .activity-item { 
            padding: 12px 16px; 
            margin: 8px 0; 
            background: var(--bg-elevated);
            border: 1px solid var(--border);
            border-radius: 6px; 
            border-left: 3px solid var(--primary);
          }
          .activity-item:hover { border-color: var(--border-hover); }
          .activity-item.raid { 
            border-left-color: var(--danger); 
            background: rgba(239, 68, 68, 0.05);
          }
          .activity-item.audit { border-left-color: #3B82F6; }
          .activity-item .time { 
            color: var(--text-muted); 
            font-size: 0.75rem;
            font-weight: 500;
          }
          
          .live-dot { 
            display: inline-block; 
            width: 8px; 
            height: 8px; 
            background: var(--success); 
            border-radius: 50%; 
            margin-right: 8px;
          }
          
          .raid-alert { 
            background: rgba(239, 68, 68, 0.1);
            border: 1px solid var(--danger); 
            border-radius: 6px; 
            padding: 16px; 
            margin-bottom: 16px; 
            display: none;
          }
          .raid-alert.active { display: block; }
          
          select {
            width: 100%;
            padding: 10px 12px;
            border-radius: 6px;
            background: var(--bg-elevated);
            color: var(--text-primary);
            border: 1px solid var(--border);
            font-family: 'Inter', sans-serif;
            font-size: 0.875rem;
            cursor: pointer;
          }
          select:hover, select:focus {
            border-color: var(--primary);
            outline: none;
          }
        </style>
      </head>
      <body>
        <nav class="navbar">
          <div class="brand">
            <img src="/friday-logo.png" alt="Oasis" onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'">
            <h1>Friday <span class="accent">Dashboard</span></h1>
          </div>
          <div class="user-info">
            <img src="${avatarUrl}" alt="Avatar">
            <span>${req.session.user.username}</span>
            <a href="/logout" class="btn btn-danger">Logout</a>
          </div>
        </nav>
        
        <div class="container">
          <div id="raid-alert" class="raid-alert">
            <strong>🚨 ALERT ANTI-RAID</strong>
            <p id="raid-message">Rilevato possibile raid in corso!</p>
          </div>
          
          <div class="tabs">
            <div class="tab active" data-tab="overview">📊 Overview</div>
            <div class="tab" data-tab="growth">📈 Growth</div>
            <div class="tab" data-tab="structure">🏗️ Structure</div>
            <div class="tab" data-tab="ecosystem">🔄 Ecosystem</div>
            <div class="tab" data-tab="financial">💰 Financial</div>
            <div class="tab" data-tab="actions">🚀 Azioni</div>
            <div class="tab" data-tab="security">🛡️ Sicurezza</div>
            <div class="tab" data-tab="activity">📋 Attivita</div>
            <div class="tab" data-tab="commands">⌨️ Comandi</div>
            <div class="tab" data-tab="features">✨ Funzionalita</div>
          </div>
          
          <div id="overview" class="tab-content active">
            <div class="card">
              <h2><span class="live-dot"></span>Statistiche Live</h2>
              <p style="color: var(--text-secondary); margin-bottom: 16px;">Stato attuale del bot e del server Discord. I dati si aggiornano automaticamente ogni 30 secondi.</p>
              <div class="grid">
                <div class="stat-box">
                  <div class="value" id="bot-status">-</div>
                  <div class="label">Stato Bot</div>
                </div>
                <div class="stat-box">
                  <div class="value" id="member-count">-</div>
                  <div class="label">Membri</div>
                </div>
                <div class="stat-box">
                  <div class="value" id="channel-count">-</div>
                  <div class="label">Canali</div>
                </div>
                <div class="stat-box">
                  <div class="value" id="uptime">-</div>
                  <div class="label">Uptime</div>
                </div>
              </div>
            </div>
            
            <div class="card">
              <h2>Trend Crescita Membri (30 giorni)</h2>
              <p style="color: var(--text-secondary); margin-bottom: 12px;">Andamento del numero totale di membri negli ultimi 30 giorni. Utile per identificare periodi di crescita o calo.</p>
              <div class="chart-container">
                <canvas id="growthChart"></canvas>
              </div>
            </div>
            
            <div class="card">
              <h2>Attivita Messaggi (30 giorni)</h2>
              <p style="color: var(--text-secondary); margin-bottom: 12px;">Numero di messaggi inviati ogni giorno. Indica quanto la community e attiva e coinvolta.</p>
              <div class="chart-container">
                <canvas id="messagesChart"></canvas>
              </div>
            </div>
            
            <div class="card">
              <h2>Flusso Membri - Join/Leave (30 giorni)</h2>
              <p style="color: var(--text-secondary); margin-bottom: 12px;">Confronto tra nuovi membri (verde) e membri usciti (rosso). Idealmente le entrate dovrebbero superare le uscite.</p>
              <div class="chart-container">
                <canvas id="flowChart"></canvas>
              </div>
            </div>
            
            <div class="card">
              <h2>Ultimi Audit</h2>
              <p style="color: var(--text-secondary); margin-bottom: 12px;">Storico delle analisi eseguite. Ogni audit controlla sicurezza, struttura e ottimizzazioni del server.</p>
              <div id="audit-list" class="activity-log">
                <p style="color: var(--text-muted);">Caricamento...</p>
              </div>
            </div>
          </div>
          
          <div id="growth" class="tab-content">
            <div class="card">
              <h2>🎯 Obiettivo 1000 Membri</h2>
              <p style="color: var(--text-secondary); margin-bottom: 8px;">Progresso verso il traguardo di 1000 membri. Raggiungerlo sblocca funzionalita avanzate di Discord come Discovery.</p>
              <p id="data-source" style="color: var(--text-secondary); font-size: 0.85rem; margin-bottom: 10px;"></p>
              <div style="margin: 20px 0;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                  <span id="growth-current">0</span>
                  <span>1000</span>
                </div>
                <div style="background: var(--bg-elevated); border-radius: 4px; height: 16px; overflow: hidden;">
                  <div id="growth-bar" style="background: var(--primary); height: 100%; width: 0%;"></div>
                </div>
                <p style="text-align: center; margin-top: 8px; color: var(--text-muted);" id="growth-progress">0% completato</p>
              </div>
            </div>
            
            <div class="card">
              <h2>📊 Punteggi</h2>
              <p style="color: var(--text-secondary); margin-bottom: 16px;">Analisi della salute del server. Scaling Score misura l'equilibrio tra membri e risorse. Sinergia MEE6 indica la compatibilita con il bot MEE6.</p>
              <div class="grid">
                <div class="stat-box">
                  <div class="value" id="scaling-score">-</div>
                  <div class="label">Scaling Score</div>
                </div>
                <div class="stat-box">
                  <div class="value" id="synergy-score">-</div>
                  <div class="label">Sinergia MEE6</div>
                </div>
                <div class="stat-box">
                  <div class="value" id="weekly-growth">-</div>
                  <div class="label">Crescita Settimanale</div>
                </div>
                <div class="stat-box">
                  <div class="value" id="channel-status">-</div>
                  <div class="label">Stato Canali</div>
                </div>
              </div>
            </div>
            
            <div class="card">
              <h2>💰 MEE6 Economy & Monetization</h2>
              <p style="color: var(--text-secondary); margin-bottom: 16px;">Stato delle funzionalita MEE6 Premium nel server. Per aggiornare questi dati, clicca "Scalecheck" nel tab Azioni.</p>
              <div class="grid" style="grid-template-columns: repeat(2, 1fr);">
                <div class="stat-box">
                  <div class="value" id="mee6-status">-</div>
                  <div class="label">MEE6 Status</div>
                </div>
                <div class="stat-box">
                  <div class="value" id="economy-status">-</div>
                  <div class="label">Economy</div>
                </div>
                <div class="stat-box">
                  <div class="value" id="achievements-status">-</div>
                  <div class="label">Achievements</div>
                </div>
                <div class="stat-box">
                  <div class="value" id="monetization-status">-</div>
                  <div class="label">Monetizzazione</div>
                </div>
              </div>
            </div>
            
            <div class="card">
              <h2>⚠️ Problemi Rilevati</h2>
              <p style="color: var(--text-secondary); margin-bottom: 12px;">Criticita identificate nel server. I problemi sono ordinati per gravita (rosso = critico, giallo = medio, verde = minore).</p>
              <div id="growth-issues" class="activity-log">
                <p style="color: var(--text-muted);">Caricamento...</p>
              </div>
            </div>
            
            <div class="card">
              <h2>💡 Raccomandazioni</h2>
              <p style="color: var(--text-secondary); margin-bottom: 12px;">Suggerimenti pratici per migliorare il server. Segui le priorita per ottenere i migliori risultati.</p>
              <div id="growth-recommendations" class="activity-log">
                <p style="color: var(--text-muted);">Caricamento...</p>
              </div>
            </div>
          </div>
          
          <div id="structure" class="tab-content">
            <div class="card" style="border-left: 3px solid var(--accent-gold);">
              <h2>📋 Come Funziona Structure360</h2>
              <p style="color: var(--text-secondary); margin-bottom: 12px;">
                <strong>Cos'e:</strong> Un'analisi completa che confronta la struttura del tuo server con le best practices delle community gaming di successo nel 2025.
              </p>
              <p style="color: var(--text-secondary); margin-bottom: 12px;">
                <strong>Perche serve:</strong> Una struttura ben organizzata aumenta la retention dei membri, facilita la navigazione e rende il server piu professionale. I server gaming top hanno una struttura ottimizzata che guida i nuovi utenti.
              </p>
              <p style="color: var(--text-secondary); margin-bottom: 12px;">
                <strong>Come aggiornare:</strong> Vai nel tab <strong>Azioni</strong> e clicca <strong>Structure360</strong>, oppure scrivi <code style="background: var(--surface); padding: 2px 6px; border-radius: 4px;">!structure</code> su Discord. I dati si aggiornano automaticamente qui.
              </p>
              <p style="color: var(--text-muted); font-size: 0.85rem;">Ultimo aggiornamento: <span id="structure-updated">Mai eseguito</span></p>
            </div>
            
            <div class="card">
              <h2>🎯 Benchmark Gaming 2025</h2>
              <p style="color: var(--text-secondary); margin-bottom: 8px;">
                <strong>Perche conta:</strong> Lo score indica quanto il tuo server e allineato con i server gaming di successo. Un punteggio alto significa struttura professionale e navigazione intuitiva.
              </p>
              <p style="color: var(--text-secondary); margin-bottom: 16px;">
                <strong>Obiettivo:</strong> Punta a 80+ per una struttura ottimale. Sotto 60 significa che mancano elementi essenziali.
              </p>
              <div class="grid">
                <div class="stat-box">
                  <div class="value" id="structure-score">-</div>
                  <div class="label">Score Struttura</div>
                  <p style="font-size: 0.7rem; color: var(--text-muted); margin-top: 4px;">80+ ottimo, 60-79 buono, &lt;60 migliorabile</p>
                </div>
                <div class="stat-box">
                  <div class="value" id="structure-phase">-</div>
                  <div class="label">Fase Crescita</div>
                  <p style="font-size: 0.7rem; color: var(--text-muted); margin-top: 4px;">Determina quanti canali dovresti avere</p>
                </div>
                <div class="stat-box">
                  <div class="value" id="structure-channels">-</div>
                  <div class="label">Canali Totali</div>
                  <p style="font-size: 0.7rem; color: var(--text-muted); margin-top: 4px;">Troppi = confusione, pochi = mancanze</p>
                </div>
                <div class="stat-box">
                  <div class="value" id="structure-private">-</div>
                  <div class="label">Canali Privati</div>
                  <p style="font-size: 0.7rem; color: var(--text-muted); margin-top: 4px;">Canali non visibili a tutti i membri</p>
                </div>
              </div>
            </div>
            
            <div class="card">
              <h2>🤖 Integrazione MEE6</h2>
              <p style="color: var(--text-secondary); margin-bottom: 8px;">
                <strong>Perche conta:</strong> Se usi MEE6, Friday evita di duplicare le sue funzioni (livelli, economia, achievements). Cosi i due bot lavorano in sinergia senza conflitti.
              </p>
              <p style="color: var(--text-secondary); margin-bottom: 16px;">
                <strong>Cosa fare:</strong> Se MEE6 gestisce gia livelli/economia, Friday si concentrera su sicurezza, analisi e suggerimenti di crescita.
              </p>
              <div class="grid" style="grid-template-columns: 1fr 2fr;">
                <div class="stat-box">
                  <div class="value" id="mee6-detected">-</div>
                  <div class="label">MEE6 Rilevato</div>
                </div>
                <div class="stat-box">
                  <div class="value" id="mee6-features" style="font-size: 1rem;">-</div>
                  <div class="label">Funzionalita Attive</div>
                </div>
              </div>
            </div>
            
            <div class="card">
              <h2>✅ Ben Configurato</h2>
              <p style="color: var(--text-secondary); margin-bottom: 8px;">
                <strong>Perche conta:</strong> Questi canali seguono gia le best practices. Sono la base solida del tuo server.
              </p>
              <p style="color: var(--text-secondary); margin-bottom: 12px;">
                <strong>Cosa fare:</strong> Mantieni questi canali attivi e usali come modello per crearne di nuovi.
              </p>
              <div id="structure-configured" class="activity-log">
                <p style="color: var(--text-muted);">Clicca "Structure360" nel tab Azioni per analizzare il server...</p>
              </div>
            </div>
            
            <div class="card">
              <h2>❌ Mancanti Essenziali</h2>
              <p style="color: var(--text-secondary); margin-bottom: 8px;">
                <strong>Perche conta:</strong> Questi canali sono presenti nei server gaming di successo e migliorano l'esperienza utente. Senza di loro, i membri potrebbero non sapere dove andare.
              </p>
              <p style="color: var(--text-secondary); margin-bottom: 12px;">
                <strong>Cosa fare:</strong> Valuta di creare i canali suggeriti. Non devi crearli tutti: scegli quelli piu utili per la tua community.
              </p>
              <div id="structure-missing" class="activity-log">
                <p style="color: var(--text-muted);">Clicca "Structure360" nel tab Azioni per analizzare il server...</p>
              </div>
            </div>
            
            <div class="card">
              <h2>💡 Raccomandazioni 360°</h2>
              <p style="color: var(--text-secondary); margin-bottom: 8px;">
                <strong>Perche conta:</strong> Consigli prioritizzati per 6 aree: Struttura, Scalabilita, Engagement, Growth, Eventi e Monetizzazione. Ogni suggerimento ha impatto e difficolta stimati.
              </p>
              <p style="color: var(--text-secondary); margin-bottom: 12px;">
                <strong>Cosa fare:</strong> Inizia dai suggerimenti ad alto impatto e bassa difficolta per vedere risultati rapidi.
              </p>
              <div id="structure-recommendations" class="activity-log">
                <p style="color: var(--text-muted);">Clicca "Structure360" nel tab Azioni per analizzare il server...</p>
              </div>
            </div>
            
            <div class="card">
              <h2>🔧 Modifiche Proposte</h2>
              <p style="color: var(--text-secondary); margin-bottom: 8px;">
                <strong>Perche conta:</strong> Azioni concrete che puoi fare subito: creare nuovi canali, unire canali simili, archiviare canali inutilizzati.
              </p>
              <p style="color: var(--text-secondary); margin-bottom: 12px;">
                <strong>Cosa fare:</strong> Queste sono solo proposte - decidi tu cosa applicare. Friday non modifica nulla automaticamente.
              </p>
              <div id="structure-changes" class="activity-log">
                <p style="color: var(--text-muted);">Clicca "Structure360" nel tab Azioni per analizzare il server...</p>
              </div>
            </div>
          </div>
          
          <div id="actions" class="tab-content">
            <div class="card">
              <h2>🚀 Quick Actions</h2>
              <p style="color: var(--text-secondary); margin-bottom: 20px;">Esegui comandi bot direttamente dalla dashboard. I risultati appariranno nel canale Discord del server.</p>
              <div class="grid">
                <div class="stat-box" style="cursor: pointer;" onclick="executeAction('audit')">
                  <div class="value" style="font-size: 2rem;">🔍</div>
                  <div class="label">Avvia Audit</div>
                  <p style="font-size: 0.75rem; color: var(--text-muted); margin: 8px 0;">Analisi completa server con suggerimenti AI</p>
                  <button class="btn btn-primary" style="width: 100%;" id="btn-audit">Esegui</button>
                </div>
                <div class="stat-box" style="cursor: pointer;" onclick="executeAction('backup')">
                  <div class="value" style="font-size: 2rem;">💾</div>
                  <div class="label">Crea Backup</div>
                  <p style="font-size: 0.75rem; color: var(--text-muted); margin: 8px 0;">Salva configurazione ruoli e canali</p>
                  <button class="btn btn-primary" style="width: 100%;" id="btn-backup">Esegui</button>
                </div>
                <div class="stat-box" style="cursor: pointer;" onclick="executeAction('security')">
                  <div class="value" style="font-size: 2rem;">🛡️</div>
                  <div class="label">Check Sicurezza</div>
                  <p style="font-size: 0.75rem; color: var(--text-muted); margin: 8px 0;">Verifica IP bloccati e sessioni attive</p>
                  <button class="btn btn-primary" style="width: 100%;" id="btn-security">Esegui</button>
                </div>
                <div class="stat-box" style="cursor: pointer;" onclick="executeAction('refresh')">
                  <div class="value" style="font-size: 2rem;">🔄</div>
                  <div class="label">Refresh Stats</div>
                  <p style="font-size: 0.75rem; color: var(--text-muted); margin: 8px 0;">Aggiorna tutte le statistiche</p>
                  <button class="btn btn-primary" style="width: 100%;" id="btn-refresh">Esegui</button>
                </div>
                <div class="stat-box" style="cursor: pointer;" onclick="executeAction('scalecheck')">
                  <div class="value" style="font-size: 2rem;">📈</div>
                  <div class="label">Scalecheck</div>
                  <p style="font-size: 0.75rem; color: var(--text-muted); margin: 8px 0;">Analisi scaling e dati MEE6</p>
                  <button class="btn btn-primary" style="width: 100%;" id="btn-scalecheck">Esegui</button>
                </div>
                <div class="stat-box" style="cursor: pointer;" onclick="executeAction('structure')">
                  <div class="value" style="font-size: 2rem;">🏗️</div>
                  <div class="label">Structure360</div>
                  <p style="font-size: 0.75rem; color: var(--text-muted); margin: 8px 0;">Analisi 360° benchmark gaming</p>
                  <button class="btn btn-primary" style="width: 100%;" id="btn-structure">Esegui</button>
                </div>
              </div>
            </div>
            
            <div class="card">
              <h2>⚙️ Configurazione Anti-Raid</h2>
              <p style="color: var(--text-secondary); margin-bottom: 16px;">Protezione automatica contro attacchi raid. Se troppi utenti entrano in poco tempo, riceverai un alert immediato.</p>
              <div class="grid" style="grid-template-columns: repeat(3, 1fr);">
                <div class="stat-box">
                  <div class="label" style="margin-bottom: 10px;">Soglia Join</div>
                  <select id="raid-threshold" style="width: 100%; padding: 10px; border-radius: 8px; background: #1a3a3a; color: #eee; border: 1px solid #4aba8a;">
                    <option value="5">5 join</option>
                    <option value="10" selected>10 join</option>
                    <option value="15">15 join</option>
                    <option value="20">20 join</option>
                  </select>
                </div>
                <div class="stat-box">
                  <div class="label" style="margin-bottom: 10px;">Finestra Tempo</div>
                  <select id="raid-window" style="width: 100%; padding: 10px; border-radius: 8px; background: #1a3a3a; color: #eee; border: 1px solid #4aba8a;">
                    <option value="15">15 secondi</option>
                    <option value="30" selected>30 secondi</option>
                    <option value="60">60 secondi</option>
                  </select>
                </div>
                <div class="stat-box">
                  <div class="label" style="margin-bottom: 10px;">Azione</div>
                  <button class="btn btn-primary" style="width: 100%;" onclick="saveRaidConfig()">Salva Config</button>
                </div>
              </div>
            </div>
            
            <div class="card">
              <h2>📦 Backup Salvati</h2>
              <p style="color: var(--text-secondary); margin-bottom: 12px;">Copie di sicurezza della configurazione server (ruoli, canali, permessi). Massimo 10 backup conservati.</p>
              <div id="backup-list" class="activity-log">
                <p style="color: var(--text-muted);">Caricamento...</p>
              </div>
            </div>
            
            <div class="card">
              <h2>📝 Risultato Ultimo Comando</h2>
              <div id="action-result" class="activity-log" style="background: rgba(13, 38, 38, 0.5); padding: 16px; border-radius: 8px; min-height: 100px;">
                <p style="color: var(--text-muted);">Nessun comando eseguito</p>
              </div>
            </div>
          </div>
          
          <div id="security" class="tab-content">
            <div class="card">
              <h2>🛡️ Centro Sicurezza</h2>
              <p style="color: var(--text-secondary); margin-bottom: 16px;">Monitoraggio in tempo reale della sicurezza. Traccia accessi, tentativi sospetti e sessioni attive.</p>
              <div class="grid">
                <div class="stat-box">
                  <div class="value" id="sec-events">-</div>
                  <div class="label">Eventi 24h</div>
                </div>
                <div class="stat-box">
                  <div class="value" id="sec-blocked">-</div>
                  <div class="label">IP Bloccati</div>
                </div>
                <div class="stat-box">
                  <div class="value" id="sec-sessions">-</div>
                  <div class="label">Sessioni Attive</div>
                </div>
                <div class="stat-box">
                  <div class="value" id="sec-alerts">-</div>
                  <div class="label">Alert Critici</div>
                </div>
              </div>
            </div>
            
            <div class="card">
              <h2>Protezioni Attive</h2>
              <div class="features" style="margin-top: 16px;">
                <div class="feature-card" style="border-color: #2ecc71;">
                  <div class="icon">🔒</div>
                  <h3>HTTPS/HSTS</h3>
                  <p>Connessione cifrata obbligatoria</p>
                </div>
                <div class="feature-card" style="border-color: #2ecc71;">
                  <div class="icon">🚫</div>
                  <h3>Rate Limiting</h3>
                  <p>60 richieste/min per IP</p>
                </div>
                <div class="feature-card" style="border-color: #2ecc71;">
                  <div class="icon">🔐</div>
                  <h3>Brute Force Block</h3>
                  <p>5 tentativi = blocco 15min</p>
                </div>
                <div class="feature-card" style="border-color: #2ecc71;">
                  <div class="icon">🛡️</div>
                  <h3>CSP Headers</h3>
                  <p>Content Security Policy attiva</p>
                </div>
                <div class="feature-card" style="border-color: #2ecc71;">
                  <div class="icon">📡</div>
                  <h3>Anti-Raid</h3>
                  <p>Rilevamento join massivi</p>
                </div>
                <div class="feature-card" style="border-color: #2ecc71;">
                  <div class="icon">🍪</div>
                  <h3>Secure Cookies</h3>
                  <p>HttpOnly + SameSite strict</p>
                </div>
              </div>
            </div>
            
            <div class="card">
              <h2>Log Sicurezza</h2>
              <p style="color: var(--text-secondary); margin-bottom: 12px;">Cronologia di tutti gli eventi di sicurezza: accessi, tentativi bloccati, modifiche configurazione.</p>
              <div id="security-log" class="activity-log">
                <p style="color: var(--text-muted);">Caricamento...</p>
              </div>
            </div>
          </div>
          
          <div id="activity" class="tab-content">
            <div class="card">
              <h2>Log Attivita</h2>
              <p style="color: var(--text-secondary); margin-bottom: 12px;">Registro di tutte le azioni eseguite dal bot e dalla dashboard. Utile per tracciare chi ha fatto cosa e quando.</p>
              <div id="activity-log" class="activity-log">
                <p style="color: var(--text-muted);">Caricamento...</p>
              </div>
            </div>
          </div>
          
          <div id="commands" class="tab-content">
            <div class="card">
              <h2>Comandi Bot</h2>
              <p style="color: var(--text-secondary); margin-bottom: 16px;">Tutti i comandi disponibili su Discord. Digita il comando nel canale del server per eseguirlo. Solo il proprietario puo usare i comandi avanzati.</p>
              <div class="command-list">
                <div class="command-item"><code>!audit</code><span>Analisi completa con AI (3 fasi graduali)</span></div>
                <div class="command-item"><code>!security</code><span>Report sicurezza e permessi</span></div>
                <div class="command-item"><code>!age</code><span>Controllo separazione fasce d'eta</span></div>
                <div class="command-item"><code>!schema</code><span>Mappa visuale struttura server</span></div>
                <div class="command-item"><code>!trend</code><span>Andamento e crescita community</span></div>
                <div class="command-item"><code>!mee6</code><span>Check compatibilita MEE6 Premium</span></div>
                <div class="command-item"><code>!fix &lt;azione&gt;</code><span>Applica correzioni automatiche</span></div>
                <div class="command-item"><code>!stats</code><span>Statistiche del server</span></div>
                <div class="command-item"><code>!backup</code><span>Crea backup configurazione</span></div>
                <div class="command-item"><code>!help</code><span>Lista tutti i comandi</span></div>
              </div>
            </div>
          </div>
          
          <div id="features" class="tab-content">
            <div class="card">
              <h2>Funzionalita Esclusive</h2>
              <p style="color: var(--text-secondary); margin-bottom: 16px;">Tutte le funzionalita di Friday Bot. Queste caratteristiche lavorano in sinergia con MEE6 senza conflitti.</p>
              <div class="features" style="margin-top: 16px;">
                <div class="feature-card">
                  <div class="icon">🔍</div>
                  <h3>Analisi Struttura</h3>
                  <p>Scansione automatica di canali, ruoli e permessi</p>
                </div>
                <div class="feature-card">
                  <div class="icon">🛡️</div>
                  <h3>Sicurezza Avanzata</h3>
                  <p>Rilevamento vulnerabilita e problemi di permessi</p>
                </div>
                <div class="feature-card">
                  <div class="icon">👥</div>
                  <h3>Protezione Eta</h3>
                  <p>Separazione automatica minorenni/adulti</p>
                </div>
                <div class="feature-card">
                  <div class="icon">🤖</div>
                  <h3>Suggerimenti AI</h3>
                  <p>Consigli intelligenti per la crescita</p>
                </div>
                <div class="feature-card">
                  <div class="icon">⚡</div>
                  <h3>Fix Automatici</h3>
                  <p>Correzioni one-click dei problemi</p>
                </div>
                <div class="feature-card">
                  <div class="icon">📊</div>
                  <h3>Trend Analysis</h3>
                  <p>Tracciamento evoluzione community</p>
                </div>
                <div class="feature-card">
                  <div class="icon">🚨</div>
                  <h3>Anti-Raid</h3>
                  <p>Protezione automatica da attacchi</p>
                </div>
                <div class="feature-card">
                  <div class="icon">📅</div>
                  <h3>Audit Schedulato</h3>
                  <p>Report automatico settimanale</p>
                </div>
                <div class="feature-card">
                  <div class="icon">💾</div>
                  <h3>Backup Config</h3>
                  <p>Salvataggio automatico ruoli e permessi</p>
                </div>
              </div>
            </div>
          </div>
          
          <div id="ecosystem" class="tab-content">
            <div class="card" style="border-left: 3px solid var(--accent-gold);">
              <h2>🔄 Ecosystem di Crescita</h2>
              <p style="color: var(--text-secondary); margin-bottom: 8px;">
                <strong>Cos'e:</strong> Visualizzazione di come i moduli del server lavorano insieme per far crescere la community. Ogni elemento alimenta gli altri creando un ciclo virtuoso.
              </p>
              <p style="color: var(--text-secondary); margin-bottom: 12px;">
                <strong>Perche serve:</strong> Capire le connessioni ti aiuta a decidere quali funzionalita attivare e come ottimizzare l'engagement. Un ecosistema bilanciato accelera la crescita organica.
              </p>
            </div>
            
            <div class="card">
              <h2>🌐 Mappa Sinergie</h2>
              <p style="color: var(--text-secondary); margin-bottom: 20px;">Passa il mouse su ogni modulo per vedere come interagisce con gli altri. I colori indicano lo stato: verde = attivo, giallo = parziale, grigio = non attivo.</p>
              
              <div style="display: flex; justify-content: center; padding: 20px 0;">
                <svg viewBox="0 0 500 400" style="max-width: 600px; width: 100%;">
                  <defs>
                    <filter id="glow">
                      <feGaussianBlur stdDeviation="2" result="coloredBlur"/>
                      <feMerge>
                        <feMergeNode in="coloredBlur"/>
                        <feMergeNode in="SourceGraphic"/>
                      </feMerge>
                    </filter>
                  </defs>
                  
                  <line x1="250" y1="200" x2="250" y2="60" stroke="#4FD1C5" stroke-width="2" opacity="0.6"/>
                  <line x1="250" y1="200" x2="400" y2="120" stroke="#4FD1C5" stroke-width="2" opacity="0.6"/>
                  <line x1="250" y1="200" x2="420" y2="280" stroke="#4FD1C5" stroke-width="2" opacity="0.6"/>
                  <line x1="250" y1="200" x2="250" y2="360" stroke="#4FD1C5" stroke-width="2" opacity="0.6"/>
                  <line x1="250" y1="200" x2="80" y2="280" stroke="#4FD1C5" stroke-width="2" opacity="0.6"/>
                  <line x1="250" y1="200" x2="100" y2="120" stroke="#4FD1C5" stroke-width="2" opacity="0.6"/>
                  
                  <path d="M250,60 Q325,90 400,120" stroke="#D4A373" stroke-width="1" fill="none" opacity="0.4" stroke-dasharray="4"/>
                  <path d="M400,120 Q410,200 420,280" stroke="#D4A373" stroke-width="1" fill="none" opacity="0.4" stroke-dasharray="4"/>
                  <path d="M420,280 Q335,320 250,360" stroke="#D4A373" stroke-width="1" fill="none" opacity="0.4" stroke-dasharray="4"/>
                  <path d="M250,360 Q165,320 80,280" stroke="#D4A373" stroke-width="1" fill="none" opacity="0.4" stroke-dasharray="4"/>
                  <path d="M80,280 Q90,200 100,120" stroke="#D4A373" stroke-width="1" fill="none" opacity="0.4" stroke-dasharray="4"/>
                  <path d="M100,120 Q175,90 250,60" stroke="#D4A373" stroke-width="1" fill="none" opacity="0.4" stroke-dasharray="4"/>
                  
                  <g class="eco-node" style="cursor: pointer;" id="node-hub">
                    <circle cx="250" cy="200" r="45" fill="#0a0a0a" stroke="#D4A373" stroke-width="3" filter="url(#glow)"/>
                    <text x="250" y="195" text-anchor="middle" fill="#D4A373" font-size="11" font-weight="600">STREAMBRIDGE</text>
                    <text x="250" y="210" text-anchor="middle" fill="#D4A373" font-size="10">PRO</text>
                  </g>
                  
                  <g class="eco-node" style="cursor: pointer;" id="node-levels">
                    <circle cx="250" cy="60" r="32" fill="#0a0a0a" stroke="#4FD1C5" stroke-width="2"/>
                    <text x="250" y="55" text-anchor="middle" fill="#4FD1C5" font-size="16">📊</text>
                    <text x="250" y="72" text-anchor="middle" fill="#e0e0e0" font-size="9" font-weight="500">LEVELS</text>
                  </g>
                  
                  <g class="eco-node" style="cursor: pointer;" id="node-achievements">
                    <circle cx="400" cy="120" r="32" fill="#0a0a0a" stroke="#4FD1C5" stroke-width="2"/>
                    <text x="400" y="115" text-anchor="middle" fill="#4FD1C5" font-size="16">🏆</text>
                    <text x="400" y="132" text-anchor="middle" fill="#e0e0e0" font-size="8" font-weight="500">ACHIEVEMENTS</text>
                  </g>
                  
                  <g class="eco-node" style="cursor: pointer;" id="node-boosts">
                    <circle cx="420" cy="280" r="32" fill="#0a0a0a" stroke="#4FD1C5" stroke-width="2"/>
                    <text x="420" y="275" text-anchor="middle" fill="#4FD1C5" font-size="16">⚡</text>
                    <text x="420" y="292" text-anchor="middle" fill="#e0e0e0" font-size="9" font-weight="500">BOOSTS</text>
                  </g>
                  
                  <g class="eco-node" style="cursor: pointer;" id="node-monetization">
                    <circle cx="250" cy="360" r="32" fill="#0a0a0a" stroke="#4FD1C5" stroke-width="2"/>
                    <text x="250" y="355" text-anchor="middle" fill="#4FD1C5" font-size="16">💰</text>
                    <text x="250" y="372" text-anchor="middle" fill="#e0e0e0" font-size="8" font-weight="500">MONETIZATION</text>
                  </g>
                  
                  <g class="eco-node" style="cursor: pointer;" id="node-economy">
                    <circle cx="80" cy="280" r="32" fill="#0a0a0a" stroke="#4FD1C5" stroke-width="2"/>
                    <text x="80" y="275" text-anchor="middle" fill="#4FD1C5" font-size="16">🪙</text>
                    <text x="80" y="292" text-anchor="middle" fill="#e0e0e0" font-size="9" font-weight="500">ECONOMY</text>
                  </g>
                  
                  <g class="eco-node" style="cursor: pointer;" id="node-growth">
                    <circle cx="100" cy="120" r="32" fill="#0a0a0a" stroke="#2ecc71" stroke-width="2"/>
                    <text x="100" y="115" text-anchor="middle" fill="#2ecc71" font-size="16">🚀</text>
                    <text x="100" y="132" text-anchor="middle" fill="#e0e0e0" font-size="9" font-weight="500">GROWTH</text>
                  </g>
                  
                  <text x="250" y="395" text-anchor="middle" fill="#666" font-size="10">Hub Centrale → Moduli Satellite → Crescita Server</text>
                </svg>
              </div>
            </div>
            
            <div class="card">
              <h2>📖 Spiegazione Moduli</h2>
              <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; margin-top: 16px;">
                
                <div class="stat-box" style="text-align: left; padding: 16px;">
                  <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 12px;">
                    <span style="font-size: 1.5rem;">🎛️</span>
                    <div>
                      <div style="font-weight: 600; color: #D4A373;">Streambridge Pro</div>
                      <div style="font-size: 0.75rem; color: var(--text-muted);">Hub Centrale</div>
                    </div>
                  </div>
                  <p style="font-size: 0.85rem; color: var(--text-secondary); margin: 0;">
                    <strong>Cosa fa:</strong> Coordina tutti i moduli e raccoglie dati per ottimizzare le strategie di crescita.<br>
                    <strong>Sinergia:</strong> Alimenta ogni altro modulo con insights e automazioni intelligenti.
                  </p>
                </div>
                
                <div class="stat-box" style="text-align: left; padding: 16px;">
                  <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 12px;">
                    <span style="font-size: 1.5rem;">📊</span>
                    <div>
                      <div style="font-weight: 600; color: #4FD1C5;">Levels</div>
                      <div style="font-size: 0.75rem; color: var(--text-muted);">Sistema Progressione</div>
                    </div>
                  </div>
                  <p style="font-size: 0.85rem; color: var(--text-secondary); margin: 0;">
                    <strong>Cosa fa:</strong> I membri guadagnano XP partecipando. Piu attivita = livelli piu alti.<br>
                    <strong>Sinergia:</strong> Sblocca Achievements → Guadagna Economy → Acquista Boosts.
                  </p>
                </div>
                
                <div class="stat-box" style="text-align: left; padding: 16px;">
                  <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 12px;">
                    <span style="font-size: 1.5rem;">🏆</span>
                    <div>
                      <div style="font-weight: 600; color: #4FD1C5;">Achievements</div>
                      <div style="font-size: 0.75rem; color: var(--text-muted);">Obiettivi e Badge</div>
                    </div>
                  </div>
                  <p style="font-size: 0.85rem; color: var(--text-secondary); margin: 0;">
                    <strong>Cosa fa:</strong> Obiettivi sbloccabili che premiano comportamenti positivi e milestone.<br>
                    <strong>Sinergia:</strong> Motivano a salire di Levels → Premiano con Economy → Mostrano status.
                  </p>
                </div>
                
                <div class="stat-box" style="text-align: left; padding: 16px;">
                  <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 12px;">
                    <span style="font-size: 1.5rem;">⚡</span>
                    <div>
                      <div style="font-weight: 600; color: #4FD1C5;">Boosts</div>
                      <div style="font-size: 0.75rem; color: var(--text-muted);">Acceleratori</div>
                    </div>
                  </div>
                  <p style="font-size: 0.85rem; color: var(--text-secondary); margin: 0;">
                    <strong>Cosa fa:</strong> Moltiplicatori XP, accesso anticipato, vantaggi esclusivi per membri attivi.<br>
                    <strong>Sinergia:</strong> Acquistabili con Economy → Accelerano Levels → Sbloccano Achievements.
                  </p>
                </div>
                
                <div class="stat-box" style="text-align: left; padding: 16px;">
                  <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 12px;">
                    <span style="font-size: 1.5rem;">🪙</span>
                    <div>
                      <div style="font-weight: 600; color: #4FD1C5;">Economy</div>
                      <div style="font-size: 0.75rem; color: var(--text-muted);">Valuta Virtuale</div>
                    </div>
                  </div>
                  <p style="font-size: 0.85rem; color: var(--text-secondary); margin: 0;">
                    <strong>Cosa fa:</strong> Moneta del server guadagnata con attivita. Spendibile per ruoli, boost, items.<br>
                    <strong>Sinergia:</strong> Guadagnata da Levels → Spesa per Boosts → Alimenta Monetization.
                  </p>
                </div>
                
                <div class="stat-box" style="text-align: left; padding: 16px;">
                  <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 12px;">
                    <span style="font-size: 1.5rem;">💰</span>
                    <div>
                      <div style="font-weight: 600; color: #4FD1C5;">Monetization</div>
                      <div style="font-size: 0.75rem; color: var(--text-muted);">Revenue Stream</div>
                    </div>
                  </div>
                  <p style="font-size: 0.85rem; color: var(--text-secondary); margin: 0;">
                    <strong>Cosa fa:</strong> Ruoli premium, abbonamenti, contenuti esclusivi per sostenere il server.<br>
                    <strong>Sinergia:</strong> Finanzia nuovi contenuti → Migliora tutti i moduli → Attira nuovi membri.
                  </p>
                </div>
                
              </div>
            </div>
            
            <div class="card">
              <h2>⚡ Stato Attuale Moduli</h2>
              <p style="color: var(--text-secondary); margin-bottom: 16px;">Verifica quali moduli sono attivi nel tuo server. I dati provengono dall'analisi Structure360 e Scalecheck.</p>
              <div class="grid" style="grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));">
                <div class="stat-box">
                  <div class="value" style="font-size: 1.5rem;" id="eco-levels">-</div>
                  <div class="label">Levels</div>
                  <p style="font-size: 0.7rem; color: var(--text-muted); margin-top: 4px;" id="eco-levels-source">-</p>
                </div>
                <div class="stat-box">
                  <div class="value" style="font-size: 1.5rem;" id="eco-achievements">-</div>
                  <div class="label">Achievements</div>
                  <p style="font-size: 0.7rem; color: var(--text-muted); margin-top: 4px;" id="eco-achievements-source">-</p>
                </div>
                <div class="stat-box">
                  <div class="value" style="font-size: 1.5rem;" id="eco-boosts">-</div>
                  <div class="label">Boosts</div>
                  <p style="font-size: 0.7rem; color: var(--text-muted); margin-top: 4px;" id="eco-boosts-source">-</p>
                </div>
                <div class="stat-box">
                  <div class="value" style="font-size: 1.5rem;" id="eco-economy">-</div>
                  <div class="label">Economy</div>
                  <p style="font-size: 0.7rem; color: var(--text-muted); margin-top: 4px;" id="eco-economy-source">-</p>
                </div>
                <div class="stat-box">
                  <div class="value" style="font-size: 1.5rem;" id="eco-monetization">-</div>
                  <div class="label">Monetization</div>
                  <p style="font-size: 0.7rem; color: var(--text-muted); margin-top: 4px;" id="eco-monetization-source">-</p>
                </div>
              </div>
            </div>
            
            <div class="card">
              <h2>🎯 Come Attivare l'Ecosistema</h2>
              <p style="color: var(--text-secondary); margin-bottom: 16px;">Segui questi step per costruire un ecosistema di crescita completo:</p>
              <div style="display: flex; flex-direction: column; gap: 12px;">
                <div style="display: flex; align-items: flex-start; gap: 12px; padding: 12px; background: var(--bg-elevated); border-radius: 8px;">
                  <span style="background: var(--primary); color: #000; width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 600; flex-shrink: 0;">1</span>
                  <div>
                    <strong style="color: var(--text-primary);">Attiva Levels</strong>
                    <p style="color: var(--text-secondary); margin: 4px 0 0; font-size: 0.85rem;">Configura MEE6 o un bot leveling. I membri inizieranno a guadagnare XP partecipando.</p>
                  </div>
                </div>
                <div style="display: flex; align-items: flex-start; gap: 12px; padding: 12px; background: var(--bg-elevated); border-radius: 8px;">
                  <span style="background: var(--primary); color: #000; width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 600; flex-shrink: 0;">2</span>
                  <div>
                    <strong style="color: var(--text-primary);">Aggiungi Economy</strong>
                    <p style="color: var(--text-secondary); margin: 4px 0 0; font-size: 0.85rem;">Abilita la valuta virtuale. I membri guadagnano coins con messaggi e attivita.</p>
                  </div>
                </div>
                <div style="display: flex; align-items: flex-start; gap: 12px; padding: 12px; background: var(--bg-elevated); border-radius: 8px;">
                  <span style="background: var(--primary); color: #000; width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 600; flex-shrink: 0;">3</span>
                  <div>
                    <strong style="color: var(--text-primary);">Crea Achievements</strong>
                    <p style="color: var(--text-secondary); margin: 4px 0 0; font-size: 0.85rem;">Definisci obiettivi e badge. Premia milestone come "100 messaggi" o "Primo evento".</p>
                  </div>
                </div>
                <div style="display: flex; align-items: flex-start; gap: 12px; padding: 12px; background: var(--bg-elevated); border-radius: 8px;">
                  <span style="background: var(--primary); color: #000; width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 600; flex-shrink: 0;">4</span>
                  <div>
                    <strong style="color: var(--text-primary);">Offri Boosts</strong>
                    <p style="color: var(--text-secondary); margin: 4px 0 0; font-size: 0.85rem;">Permetti ai membri di spendere coins per XP multiplier, ruoli speciali, accesso anticipato.</p>
                  </div>
                </div>
                <div style="display: flex; align-items: flex-start; gap: 12px; padding: 12px; background: var(--bg-elevated); border-radius: 8px;">
                  <span style="background: #D4A373; color: #000; width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 600; flex-shrink: 0;">5</span>
                  <div>
                    <strong style="color: var(--text-primary);">Monetizza (Opzionale)</strong>
                    <p style="color: var(--text-secondary); margin: 4px 0 0; font-size: 0.85rem;">Ruoli premium, server boost perks, contenuti esclusivi. Reinvesti nel server.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          <div id="financial" class="tab-content">
            <div class="card" style="border-left: 3px solid var(--accent);">
              <h2>💰 Financial Hub</h2>
              <p style="color: var(--text-secondary); margin-bottom: 8px;">
                <strong>Cos'e:</strong> Monitora i costi dei servizi e analizza lo shop MEE6 per ottimizzare la tua economia virtuale.
              </p>
              <p style="color: var(--text-secondary);">
                <strong>Approccio Zero-Cost:</strong> Tutto gratis al 100%. Nessun servizio a pagamento richiesto.
              </p>
            </div>
            
            <div class="card">
              <h2>📊 Costi & Limiti Servizi</h2>
              <p style="color: var(--text-secondary); margin-bottom: 16px;">Monitoraggio in tempo reale dei servizi gratuiti utilizzati. Alert quando ti avvicini ai limiti.</p>
              
              <div class="grid" style="grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));">
                <div class="stat-box">
                  <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                    <span style="font-weight: 600; color: var(--text-primary);">MongoDB Atlas</span>
                    <span style="font-size: 0.75rem; color: var(--success);">M0 Free</span>
                  </div>
                  <div style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 4px;">Storage: <span id="mongo-usage">-</span> / 512 MB</div>
                  <div class="progress-bar">
                    <div id="mongo-bar" class="progress-fill green" style="width: 0%;"></div>
                  </div>
                  <p style="font-size: 0.7rem; color: var(--text-muted); margin-top: 6px;">Limite: 512MB storage, 100 connessioni</p>
                </div>
                
                <div class="stat-box">
                  <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                    <span style="font-weight: 600; color: var(--text-primary);">Fly.io</span>
                    <span style="font-size: 0.75rem; color: var(--success);">Free Tier</span>
                  </div>
                  <div style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 4px;">VMs: 1 / 3 condivise</div>
                  <div class="progress-bar">
                    <div class="progress-fill green" style="width: 33%;"></div>
                  </div>
                  <p style="font-size: 0.7rem; color: var(--text-muted); margin-top: 6px;">Limite: 3 VM, 160GB transfer/mese</p>
                </div>
                
                <div class="stat-box">
                  <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                    <span style="font-weight: 600; color: var(--text-primary);">OpenAI</span>
                    <span style="font-size: 0.75rem; color: var(--warning);">Pay-as-you-go</span>
                  </div>
                  <div style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 4px;">Chiamate mese: <span id="openai-calls">0</span></div>
                  <div class="progress-bar">
                    <div id="openai-bar" class="progress-fill green" style="width: 0%;"></div>
                  </div>
                  <p style="font-size: 0.7rem; color: var(--text-muted); margin-top: 6px;">Stima: ~0.01-0.05 per audit AI</p>
                </div>
                
                <div class="stat-box">
                  <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                    <span style="font-weight: 600; color: var(--text-primary);">Discord API</span>
                    <span style="font-size: 0.75rem; color: var(--success);">Illimitato</span>
                  </div>
                  <div style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 4px;">Rate: OK</div>
                  <div class="progress-bar">
                    <div class="progress-fill green" style="width: 10%;"></div>
                  </div>
                  <p style="font-size: 0.7rem; color: var(--text-muted); margin-top: 6px;">Limite: Rate limit per richiesta</p>
                </div>
              </div>
              
              <div style="margin-top: 20px; padding: 16px; background: var(--bg-elevated); border-radius: 8px; border: 1px solid var(--border);">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                  <div>
                    <div style="font-weight: 600; color: var(--text-primary);">Costo Mensile Stimato</div>
                    <div style="font-size: 0.85rem; color: var(--text-muted);">Basato sull'utilizzo attuale</div>
                  </div>
                  <div style="text-align: right;">
                    <div style="font-size: 1.5rem; font-weight: 700; color: var(--success);" id="monthly-cost">0.00</div>
                    <div style="font-size: 0.75rem; color: var(--text-muted);">EUR/mese</div>
                  </div>
                </div>
              </div>
            </div>
            
            <div class="card">
              <h2>🛒 Analisi Shop MEE6</h2>
              <p style="color: var(--text-secondary); margin-bottom: 16px;">
                Incolla il testo copiato dalla pagina shop MEE6. Friday analizzer gli articoli e ti dara suggerimenti per ottimizzare prezzi e vendite.
              </p>
              
              <div style="margin-bottom: 16px;">
                <label style="display: block; margin-bottom: 8px; font-weight: 500; color: var(--text-primary);">Incolla qui il testo dello shop:</label>
                <textarea id="shop-input" rows="8" placeholder="Vai su MEE6 Dashboard > Shop, seleziona tutto il testo (Ctrl+A) e incollalo qui...

Esempio di formato atteso:
Ruolo VIP
5000 coins
Accesso canali esclusivi

XP Boost 2x
2000 coins
Raddoppia XP per 24h" style="width: 100%; padding: 12px; border-radius: 6px; background: var(--bg-elevated); color: var(--text-primary); border: 1px solid var(--border); font-family: 'Inter', sans-serif; font-size: 0.875rem; resize: vertical;"></textarea>
              </div>
              
              <div style="display: flex; gap: 12px; flex-wrap: wrap;">
                <button class="btn btn-primary" onclick="parseShopText()">Analizza Testo</button>
                <button class="btn btn-outline" onclick="clearShopData()">Pulisci</button>
              </div>
              
              <div id="shop-preview" style="margin-top: 20px; display: none;">
                <h3 style="font-size: 0.9rem; margin-bottom: 12px; color: var(--text-primary);">Articoli Rilevati:</h3>
                <div id="shop-items-list" style="display: grid; gap: 12px;"></div>
                <button class="btn btn-primary" style="margin-top: 16px;" onclick="saveShopItems()">Salva Articoli</button>
              </div>
            </div>
            
            <div class="card">
              <h2>📦 Articoli Salvati</h2>
              <p style="color: var(--text-secondary); margin-bottom: 16px;">I tuoi articoli dello shop MEE6. Clicca su un articolo per modificarlo o eliminarlo.</p>
              <div id="saved-items-list" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px;">
                <p style="color: var(--text-muted);">Nessun articolo salvato</p>
              </div>
            </div>
            
            <div class="card">
              <h2>💡 Suggerimenti Ottimizzazione</h2>
              <p style="color: var(--text-secondary); margin-bottom: 16px;">Analisi basata su best practice per shop Discord. Nessun costo AI - regole predefinite.</p>
              <div id="shop-suggestions" style="display: flex; flex-direction: column; gap: 12px;">
                <p style="color: var(--text-muted);">Aggiungi articoli allo shop per ricevere suggerimenti personalizzati.</p>
              </div>
            </div>
            
            <div class="card">
              <h2>🔮 Alternative Gratuite</h2>
              <p style="color: var(--text-secondary); margin-bottom: 16px;">Se in futuro vuoi espandere le funzionalita, ecco le opzioni gratuite disponibili:</p>
              <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px;">
                <div class="stat-box" style="text-align: left; padding: 16px;">
                  <div style="font-weight: 600; color: var(--primary); margin-bottom: 8px;">OCR.space</div>
                  <p style="font-size: 0.85rem; color: var(--text-secondary); margin: 0;">
                    500 screenshot/giorno gratis. Per analizzare immagini dello shop invece del copia-incolla.
                  </p>
                  <span style="font-size: 0.7rem; color: var(--success);">GRATIS</span>
                </div>
                <div class="stat-box" style="text-align: left; padding: 16px;">
                  <div style="font-weight: 600; color: var(--primary); margin-bottom: 8px;">Google Cloud Vision</div>
                  <p style="font-size: 0.85rem; color: var(--text-secondary); margin: 0;">
                    1000 richieste/mese gratis. OCR di alta qualita per screenshot complessi.
                  </p>
                  <span style="font-size: 0.7rem; color: var(--success);">GRATIS (1000/mese)</span>
                </div>
                <div class="stat-box" style="text-align: left; padding: 16px;">
                  <div style="font-weight: 600; color: var(--primary); margin-bottom: 8px;">Tesseract.js</div>
                  <p style="font-size: 0.85rem; color: var(--text-secondary); margin: 0;">
                    OCR open source nel browser. Zero costi, funziona offline, ma meno preciso.
                  </p>
                  <span style="font-size: 0.7rem; color: var(--success);">GRATIS ILLIMITATO</span>
                </div>
              </div>
            </div>
          </div>
          
          <div class="footer">
            <p>Friday Bot per <strong>Oasis Gamers Hub</strong> | Sviluppato con ❤️</p>
          </div>
        </div>
        
        <script>
          document.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', () => {
              document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
              document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
              tab.classList.add('active');
              document.getElementById(tab.dataset.tab).classList.add('active');
            });
          });
          
          let growthChart = null;
          
          async function loadStatus() {
            try {
              const res = await fetch('/api/status');
              const data = await res.json();
              
              document.getElementById('bot-status').textContent = data.bot?.status === 'online' ? 'Online' : 'Offline';
              document.getElementById('bot-status').style.color = data.bot?.status === 'online' ? '#2ecc71' : '#e74c3c';
              
              if (data.guild) {
                document.getElementById('member-count').textContent = data.guild.memberCount || '-';
                document.getElementById('channel-count').textContent = data.guild.channelCount || '-';
              }
              
              if (data.bot?.uptime) {
                const hours = Math.floor(data.bot.uptime / 3600000);
                const mins = Math.floor((data.bot.uptime % 3600000) / 60000);
                document.getElementById('uptime').textContent = hours + 'h ' + mins + 'm';
              }
              
              if (data.antiRaid?.triggered) {
                document.getElementById('raid-alert').classList.add('active');
              } else {
                document.getElementById('raid-alert').classList.remove('active');
              }
            } catch (e) { console.log('Status error:', e); }
          }
          
          async function loadActivity() {
            try {
              const res = await fetch('/api/activity');
              const data = await res.json();
              
              const container = document.getElementById('activity-log');
              if (data.length === 0) {
                container.innerHTML = '<p style="color: var(--text-muted);">Nessuna attivita recente</p>';
                return;
              }
              
              container.innerHTML = data.map(item => {
                const date = new Date(item.timestamp);
                const time = date.toLocaleString('it-IT');
                const typeClass = item.type.includes('raid') ? 'raid' : item.type.includes('audit') ? 'audit' : '';
                return '<div class="activity-item ' + typeClass + '"><div class="time">' + time + '</div><div>' + item.message + '</div></div>';
              }).join('');
            } catch (e) { console.log('Activity error:', e); }
          }
          
          async function loadMetrics() {
            try {
              const res = await fetch('/api/metrics?days=30');
              const data = await res.json();
              
              if (data.metrics && data.metrics.length > 0) {
                const labels = data.metrics.map(m => new Date(m.date).toLocaleDateString('it-IT', {day: '2-digit', month: '2-digit'}));
                const members = data.metrics.map(m => m.memberCount || 0);
                
                const ctx = document.getElementById('growthChart').getContext('2d');
                if (growthChart) growthChart.destroy();
                growthChart = new Chart(ctx, {
                  type: 'line',
                  data: {
                    labels: labels,
                    datasets: [{
                      label: 'Membri',
                      data: members,
                      borderColor: '#4FD1C5',
                      backgroundColor: 'rgba(79, 209, 197, 0.15)',
                      fill: true,
                      tension: 0.4,
                      pointBackgroundColor: '#4FD1C5',
                      pointBorderColor: '#0F1419',
                      pointBorderWidth: 2,
                      pointRadius: 4,
                      pointHoverRadius: 6
                    }]
                  },
                  options: {
                    responsive: true,
                    plugins: { 
                      legend: { labels: { color: '#A0AEC0', font: { family: 'Inter' } } }
                    },
                    scales: {
                      x: { ticks: { color: '#718096' }, grid: { color: 'rgba(79, 209, 197, 0.08)' } },
                      y: { ticks: { color: '#718096' }, grid: { color: 'rgba(79, 209, 197, 0.08)' } }
                    }
                  }
                });
              }
            } catch (e) { console.log('Metrics error:', e); }
          }
          
          async function loadAudits() {
            try {
              const res = await fetch('/api/audits?limit=5');
              const data = await res.json();
              
              const container = document.getElementById('audit-list');
              if (data.length === 0) {
                container.innerHTML = '<p style="color: var(--text-muted);">Nessun audit recente</p>';
                return;
              }
              
              container.innerHTML = data.map(audit => {
                const date = new Date(audit.createdAt);
                const time = date.toLocaleString('it-IT');
                return '<div class="activity-item audit"><div class="time">' + time + '</div><div>Score: <strong>' + (audit.securityScore || '-') + '/100</strong> - ' + (audit.type || 'audit') + '</div></div>';
              }).join('');
            } catch (e) { console.log('Audits error:', e); }
          }
          
          async function loadSecurity() {
            try {
              const res = await fetch('/api/security');
              const data = await res.json();
              
              document.getElementById('sec-events').textContent = data.stats?.totalEvents24h || 0;
              document.getElementById('sec-blocked').textContent = data.stats?.blockedIPsCount || 0;
              document.getElementById('sec-sessions').textContent = data.stats?.activeSessionsCount || 0;
              document.getElementById('sec-alerts').textContent = (data.stats?.criticalAlerts || 0) + (data.stats?.highAlerts || 0);
              
              const container = document.getElementById('security-log');
              if (!data.log || data.log.length === 0) {
                container.innerHTML = '<p style="color: var(--success);">Nessun evento di sicurezza - Tutto OK!</p>';
                return;
              }
              
              container.innerHTML = data.log.slice(0, 20).map(item => {
                const date = new Date(item.timestamp);
                const time = date.toLocaleString('it-IT');
                const sevClass = item.severity === 'critical' || item.severity === 'high' ? 'raid' : '';
                return '<div class="activity-item ' + sevClass + '"><div class="time">' + time + ' - ' + (item.severity || 'info').toUpperCase() + '</div><div>' + item.message + '</div></div>';
              }).join('');
            } catch (e) { console.log('Security error:', e); }
          }
          
          let messagesChart = null;
          let flowChart = null;
          
          async function loadExtraCharts() {
            try {
              const res = await fetch('/api/metrics?days=30');
              const data = await res.json();
              
              if (data.metrics && data.metrics.length > 0) {
                const labels = data.metrics.map(m => new Date(m.date).toLocaleDateString('it-IT', {day: '2-digit', month: '2-digit'}));
                const messages = data.metrics.map(m => m.messageCount || 0);
                const joins = data.metrics.map(m => m.joinCount || 0);
                const leaves = data.metrics.map(m => m.leaveCount || 0);
                
                const ctx1 = document.getElementById('messagesChart').getContext('2d');
                if (messagesChart) messagesChart.destroy();
                messagesChart = new Chart(ctx1, {
                  type: 'bar',
                  data: {
                    labels: labels,
                    datasets: [{
                      label: 'Messaggi',
                      data: messages,
                      backgroundColor: 'rgba(212, 163, 115, 0.7)',
                      borderColor: '#D4A373',
                      borderWidth: 2,
                      borderRadius: 6,
                      hoverBackgroundColor: 'rgba(212, 163, 115, 0.9)'
                    }]
                  },
                  options: {
                    responsive: true,
                    plugins: { 
                      legend: { labels: { color: '#A0AEC0', font: { family: 'Inter' } } }
                    },
                    scales: {
                      x: { ticks: { color: '#718096' }, grid: { color: 'rgba(79, 209, 197, 0.08)' } },
                      y: { ticks: { color: '#718096' }, grid: { color: 'rgba(79, 209, 197, 0.08)' } }
                    }
                  }
                });
                
                const ctx2 = document.getElementById('flowChart').getContext('2d');
                if (flowChart) flowChart.destroy();
                flowChart = new Chart(ctx2, {
                  type: 'line',
                  data: {
                    labels: labels,
                    datasets: [
                      {
                        label: 'Join',
                        data: joins,
                        borderColor: '#68D391',
                        backgroundColor: 'rgba(104, 211, 145, 0.15)',
                        fill: true,
                        tension: 0.4,
                        pointRadius: 3
                      },
                      {
                        label: 'Leave',
                        data: leaves,
                        borderColor: '#FC8181',
                        backgroundColor: 'rgba(252, 129, 129, 0.15)',
                        fill: true,
                        tension: 0.4,
                        pointRadius: 3
                      }
                    ]
                  },
                  options: {
                    responsive: true,
                    plugins: { 
                      legend: { labels: { color: '#A0AEC0', font: { family: 'Inter' } } }
                    },
                    scales: {
                      x: { ticks: { color: '#718096' }, grid: { color: 'rgba(79, 209, 197, 0.08)' } },
                      y: { ticks: { color: '#718096' }, grid: { color: 'rgba(79, 209, 197, 0.08)' } }
                    }
                  }
                });
              }
            } catch (e) { console.log('Extra charts error:', e); }
          }
          
          async function loadBackups() {
            try {
              const res = await fetch('/api/backups');
              const data = await res.json();
              
              const container = document.getElementById('backup-list');
              if (data.length === 0) {
                container.innerHTML = '<p style="color: var(--text-muted);">Nessun backup salvato</p>';
                return;
              }
              
              container.innerHTML = data.map(backup => {
                const date = new Date(backup.createdAt);
                const time = date.toLocaleString('it-IT');
                return '<div class="activity-item"><div class="time">' + time + '</div><div><strong>' + backup.guildName + '</strong> - ' + backup.rolesCount + ' ruoli, ' + backup.channelsCount + ' canali</div></div>';
              }).join('');
            } catch (e) { console.log('Backups error:', e); }
          }
          
          async function executeAction(action) {
            const resultDiv = document.getElementById('action-result');
            const btn = document.getElementById('btn-' + action);
            
            if (btn) {
              btn.disabled = true;
              btn.textContent = 'In corso...';
            }
            
            resultDiv.innerHTML = '<p style="color: var(--warning);">⏳ Esecuzione ' + action + ' in corso...</p>';
            
            try {
              const res = await fetch('/api/action/' + action, { method: 'POST' });
              const data = await res.json();
              
              if (data.success) {
                resultDiv.innerHTML = '<div class="activity-item" style="border-left-color: var(--success);"><div class="time">' + new Date().toLocaleString('it-IT') + '</div><div style="color: var(--success);"><strong>Successo!</strong> ' + data.message + '</div></div>';
                
                if (action === 'backup') loadBackups();
                if (action === 'refresh') {
                  loadStatus();
                  loadMetrics();
                  loadExtraCharts();
                }
              } else {
                resultDiv.innerHTML = '<div class="activity-item raid"><div class="time">' + new Date().toLocaleString('it-IT') + '</div><div>' + (data.error || 'Errore sconosciuto') + '</div></div>';
              }
            } catch (e) {
              resultDiv.innerHTML = '<div class="activity-item raid"><div class="time">' + new Date().toLocaleString('it-IT') + '</div><div>Errore di connessione</div></div>';
            }
            
            if (btn) {
              btn.disabled = false;
              btn.textContent = 'Esegui';
            }
          }
          
          async function saveRaidConfig() {
            const threshold = document.getElementById('raid-threshold').value;
            const window = document.getElementById('raid-window').value;
            
            try {
              const res = await fetch('/api/config/antiraid', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ threshold: parseInt(threshold), window: parseInt(window) })
              });
              const data = await res.json();
              
              const resultDiv = document.getElementById('action-result');
              if (data.success) {
                resultDiv.innerHTML = '<div class="activity-item" style="border-left-color: var(--success);"><div class="time">' + new Date().toLocaleString('it-IT') + '</div><div style="color: var(--success);"><strong>Configurazione salvata!</strong> Soglia: ' + threshold + ' join in ' + window + ' secondi</div></div>';
              } else {
                resultDiv.innerHTML = '<div class="activity-item raid"><div class="time">' + new Date().toLocaleString('it-IT') + '</div><div>Errore: ' + (data.error || 'sconosciuto') + '</div></div>';
              }
            } catch (e) {
              console.log('Config error:', e);
            }
          }
          
          async function loadGrowth() {
            try {
              const res = await fetch('/api/growth');
              const data = await res.json();
              
              if (data.scaling) {
                document.getElementById('growth-current').textContent = data.scaling.memberCount || 0;
                document.getElementById('growth-bar').style.width = data.scaling.progressToTarget + '%';
                document.getElementById('growth-progress').textContent = data.scaling.progressToTarget + '% completato';
                document.getElementById('scaling-score').textContent = data.scaling.score + '/100';
                document.getElementById('scaling-score').style.color = data.scaling.score >= 80 ? '#2ecc71' : data.scaling.score >= 60 ? '#f1c40f' : '#e74c3c';
                document.getElementById('weekly-growth').textContent = (data.scaling.engagement?.netGrowth >= 0 ? '+' : '') + (data.scaling.engagement?.netGrowth || 0);
                document.getElementById('weekly-growth').style.color = (data.scaling.engagement?.netGrowth || 0) >= 0 ? '#2ecc71' : '#e74c3c';
                document.getElementById('channel-status').textContent = data.scaling.channels?.status || 'optimal';
                
                const issuesContainer = document.getElementById('growth-issues');
                if (data.scaling.issues && data.scaling.issues.length > 0) {
                  issuesContainer.innerHTML = data.scaling.issues.map(issue => {
                    const icon = issue.severity === 'high' ? '🔴' : issue.severity === 'medium' ? '🟡' : '🟢';
                    return '<div class="activity-item"><div>' + icon + ' ' + issue.message + '</div></div>';
                  }).join('');
                } else {
                  issuesContainer.innerHTML = '<p style="color: var(--success);">Nessun problema rilevato!</p>';
                }
                
                const recsContainer = document.getElementById('growth-recommendations');
                const allRecs = [...(data.scaling.recommendations || []), ...(data.economy?.recommendations || [])];
                if (allRecs.length > 0) {
                  recsContainer.innerHTML = allRecs.slice(0, 5).map(rec => {
                    const icon = rec.priority === 'critical' ? '🚨' : rec.priority === 'high' ? '❗' : '💡';
                    return '<div class="activity-item"><div>' + icon + ' ' + rec.text + '</div></div>';
                  }).join('');
                } else {
                  recsContainer.innerHTML = '<p style="color: var(--text-muted);">Nessuna raccomandazione</p>';
                }
              }
              
              if (data.economy) {
                document.getElementById('synergy-score').textContent = data.economy.synergyScore + '/100';
                document.getElementById('mee6-status').textContent = data.economy.mee6Present ? (data.economy.mee6Premium ? 'Premium' : 'Attivo') : 'Assente';
                document.getElementById('mee6-status').style.color = data.economy.mee6Present ? '#2ecc71' : '#e74c3c';
                document.getElementById('economy-status').textContent = data.economy.features?.economy?.detected ? 'Attivo' : 'Non attivo';
                document.getElementById('economy-status').style.color = data.economy.features?.economy?.detected ? '#2ecc71' : '#e74c3c';
                document.getElementById('achievements-status').textContent = data.economy.features?.achievements?.detected ? 'Attivo' : 'Non attivo';
                document.getElementById('achievements-status').style.color = data.economy.features?.achievements?.detected ? '#2ecc71' : '#e74c3c';
                document.getElementById('monetization-status').textContent = data.economy.features?.monetization?.detected ? 'Attivo' : 'Non attivo';
                document.getElementById('monetization-status').style.color = data.economy.features?.monetization?.detected ? '#2ecc71' : '#e74c3c';
              }
              
              const cacheIndicator = document.getElementById('data-source');
              if (cacheIndicator) {
                if (data.cached) {
                  const updatedAt = new Date(data.updatedAt).toLocaleTimeString('it-IT');
                  cacheIndicator.innerHTML = '<span style="color: var(--success);">🟢 Dati live</span> <small style="color: var(--text-secondary);">(aggiornato: ' + updatedAt + ')</small>';
                } else {
                  cacheIndicator.innerHTML = '<span style="color: var(--warning);">🟡 Dati stimati</span> <small style="color: var(--text-secondary);">(esegui Scalecheck per dati live)</small>';
                }
              }
            } catch (e) { console.log('Growth error:', e); }
          }
          
          let parsedShopItems = [];
          
          function parseShopText() {
            const input = document.getElementById('shop-input').value.trim();
            if (!input) {
              alert('Incolla prima il testo dello shop MEE6');
              return;
            }
            
            parsedShopItems = [];
            const blocks = input.split(/\\n\\s*\\n/).filter(b => b.trim());
            
            for (const block of blocks) {
              const lines = block.split('\\n').map(l => l.trim()).filter(l => l);
              if (lines.length === 0) continue;
              
              let name = '';
              let price = 0;
              let currency = 'coins';
              let description = '';
              
              for (const line of lines) {
                const priceMatch = line.match(/^(\\d[\\d.,]*)\\s*(coins?|punti|credits?|\\$|€)?$/i);
                
                if (priceMatch && !price) {
                  price = parseInt(priceMatch[1].replace(/[.,]/g, ''));
                  currency = priceMatch[2] || 'coins';
                } else if (!name && line.length > 2 && line.length < 60) {
                  name = line;
                } else if (name && price) {
                  description = (description ? description + ' ' : '') + line;
                } else if (name && !price) {
                  description = (description ? description + ' ' : '') + line;
                }
              }
              
              if (name && price > 0) {
                parsedShopItems.push({
                  name,
                  price,
                  currency,
                  description: description.trim(),
                  type: detectItemType(name)
                });
              }
            }
            
            if (parsedShopItems.length === 0) {
              alert('Nessun articolo rilevato. Separa ogni articolo con una riga vuota:\\n\\nNome Articolo\\n5000 coins\\nDescrizione\\n\\nAltro Articolo\\n2000 coins');
              return;
            }
            
            renderParsedItems();
          }
          
          function detectItemType(name) {
            const lower = name.toLowerCase();
            if (lower.includes('ruolo') || lower.includes('role') || lower.includes('vip') || lower.includes('premium')) return 'role';
            if (lower.includes('boost') || lower.includes('xp') || lower.includes('moltiplicatore')) return 'boost';
            if (lower.includes('badge') || lower.includes('titolo') || lower.includes('colore')) return 'cosmetic';
            return 'item';
          }
          
          function renderParsedItems() {
            const container = document.getElementById('shop-items-list');
            const preview = document.getElementById('shop-preview');
            
            if (parsedShopItems.length === 0) {
              preview.style.display = 'none';
              return;
            }
            
            preview.style.display = 'block';
            container.innerHTML = parsedShopItems.map((item, idx) => {
              const typeColors = { role: '#4FD1C5', boost: '#EAB308', cosmetic: '#A855F7', item: '#D4A373' };
              return '<div style="background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 8px; padding: 12px; display: flex; justify-content: space-between; align-items: center;">' +
                '<div>' +
                  '<div style="font-weight: 600; color: var(--text-primary);">' + item.name + '</div>' +
                  '<div style="font-size: 0.85rem; color: var(--text-muted);">' + item.price.toLocaleString() + ' ' + item.currency + '</div>' +
                  '<span style="font-size: 0.7rem; padding: 2px 6px; background: ' + typeColors[item.type] + '20; color: ' + typeColors[item.type] + '; border-radius: 4px;">' + item.type + '</span>' +
                '</div>' +
                '<button class="btn btn-outline" style="padding: 4px 8px; font-size: 0.75rem;" onclick="removeFromPreview(' + idx + ')">Rimuovi</button>' +
              '</div>';
            }).join('');
          }
          
          function removeFromPreview(idx) {
            parsedShopItems.splice(idx, 1);
            renderParsedItems();
          }
          
          function clearShopData() {
            document.getElementById('shop-input').value = '';
            parsedShopItems = [];
            document.getElementById('shop-preview').style.display = 'none';
          }
          
          async function saveShopItems() {
            if (parsedShopItems.length === 0) return;
            
            try {
              const res = await fetch('/api/shop/items', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ items: parsedShopItems })
              });
              const data = await res.json();
              
              if (data.success) {
                alert('Salvati ' + data.savedCount + ' articoli!');
                clearShopData();
                loadShopItems();
                loadShopSuggestions();
              } else {
                alert('Errore: ' + (data.error || 'sconosciuto'));
              }
            } catch (e) {
              alert('Errore di connessione');
            }
          }
          
          async function loadShopItems() {
            try {
              const res = await fetch('/api/shop/items');
              const data = await res.json();
              
              const container = document.getElementById('saved-items-list');
              
              if (!data.items || data.items.length === 0) {
                container.innerHTML = '<p style="color: var(--text-muted);">Nessun articolo salvato</p>';
                return;
              }
              
              const typeColors = { role: '#4FD1C5', boost: '#EAB308', cosmetic: '#A855F7', item: '#D4A373' };
              container.innerHTML = data.items.map(item => {
                return '<div class="stat-box" style="padding: 12px; text-align: left;">' +
                  '<div style="display: flex; justify-content: space-between; align-items: flex-start;">' +
                    '<div>' +
                      '<div style="font-weight: 600; color: var(--text-primary);">' + item.name + '</div>' +
                      '<div style="font-size: 0.85rem; color: var(--primary);">' + item.price.toLocaleString() + ' ' + (item.currency || 'coins') + '</div>' +
                    '</div>' +
                    '<span style="font-size: 0.65rem; padding: 2px 6px; background: ' + (typeColors[item.type] || typeColors.item) + '20; color: ' + (typeColors[item.type] || typeColors.item) + '; border-radius: 4px;">' + (item.type || 'item') + '</span>' +
                  '</div>' +
                  (item.description ? '<p style="font-size: 0.75rem; color: var(--text-muted); margin-top: 8px;">' + item.description + '</p>' : '') +
                  '<button class="btn btn-outline" style="padding: 4px 8px; font-size: 0.7rem; margin-top: 8px; width: 100%;" onclick="deleteShopItem(\\'' + item._id + '\\')">Elimina</button>' +
                '</div>';
              }).join('');
            } catch (e) { console.log('Shop items error:', e); }
          }
          
          async function deleteShopItem(id) {
            if (!confirm('Eliminare questo articolo?')) return;
            
            try {
              await fetch('/api/shop/items/' + id, { method: 'DELETE' });
              loadShopItems();
              loadShopSuggestions();
            } catch (e) { console.log('Delete error:', e); }
          }
          
          async function loadShopSuggestions() {
            try {
              const res = await fetch('/api/shop/suggestions');
              const data = await res.json();
              
              const container = document.getElementById('shop-suggestions');
              
              if (!data.suggestions || data.suggestions.length === 0) {
                container.innerHTML = '<p style="color: var(--text-muted);">Aggiungi articoli allo shop per ricevere suggerimenti personalizzati.</p>';
                return;
              }
              
              container.innerHTML = data.suggestions.map(sug => {
                const priorityColors = { high: '#EF4444', medium: '#EAB308', low: '#4FD1C5' };
                const priorityIcons = { high: '🔴', medium: '🟡', low: '🟢' };
                return '<div style="padding: 12px; background: var(--bg-elevated); border-radius: 8px; border-left: 3px solid ' + (priorityColors[sug.priority] || priorityColors.low) + ';">' +
                  '<div style="display: flex; gap: 8px; align-items: flex-start;">' +
                    '<span>' + (priorityIcons[sug.priority] || '💡') + '</span>' +
                    '<div>' +
                      '<div style="font-weight: 600; color: var(--text-primary);">' + sug.title + '</div>' +
                      '<p style="font-size: 0.85rem; color: var(--text-secondary); margin-top: 4px;">' + sug.description + '</p>' +
                      (sug.action ? '<p style="font-size: 0.8rem; color: var(--primary); margin-top: 6px;"><strong>Cosa fare:</strong> ' + sug.action + '</p>' : '') +
                    '</div>' +
                  '</div>' +
                '</div>';
              }).join('');
            } catch (e) { console.log('Suggestions error:', e); }
          }
          
          async function loadFinancial() {
            try {
              const res = await fetch('/api/financial/costs');
              const data = await res.json();
              
              if (data.mongodb) {
                document.getElementById('mongo-usage').textContent = data.mongodb.usageMB.toFixed(1) + ' MB';
                const mongoPercent = (data.mongodb.usageMB / 512) * 100;
                document.getElementById('mongo-bar').style.width = mongoPercent + '%';
                document.getElementById('mongo-bar').className = 'progress-fill ' + (mongoPercent > 80 ? 'red' : mongoPercent > 50 ? 'yellow' : 'green');
              }
              
              if (data.openai) {
                document.getElementById('openai-calls').textContent = data.openai.callsThisMonth || 0;
                const openaiPercent = Math.min((data.openai.callsThisMonth || 0) / 100 * 100, 100);
                document.getElementById('openai-bar').style.width = openaiPercent + '%';
              }
              
              if (data.totalCost !== undefined) {
                document.getElementById('monthly-cost').textContent = data.totalCost.toFixed(2);
                document.getElementById('monthly-cost').style.color = data.totalCost > 5 ? '#EF4444' : data.totalCost > 1 ? '#EAB308' : '#22C55E';
              }
            } catch (e) { console.log('Financial error:', e); }
          }
          
          // Auto-refresh al login - triggera analisi se dati vecchi
          async function autoRefreshOnLogin() {
            try {
              const res = await fetch('/api/auto-refresh', { method: 'POST' });
              const data = await res.json();
              if (data.triggered && data.triggered.length > 0) {
                console.log('Auto-refresh avviato:', data.triggered);
                // Mostra notifica discreta
                const notice = document.createElement('div');
                notice.style.cssText = 'position: fixed; bottom: 20px; right: 20px; background: var(--surface); border: 1px solid var(--primary); padding: 12px 20px; border-radius: 8px; color: var(--primary); font-size: 14px; z-index: 9999;';
                notice.textContent = '🔄 ' + data.message;
                document.body.appendChild(notice);
                setTimeout(() => notice.remove(), 5000);
              }
            } catch (e) { console.log('Auto-refresh check:', e); }
          }
          
          autoRefreshOnLogin();
          loadStatus();
          loadActivity();
          loadMetrics();
          loadExtraCharts();
          loadAudits();
          loadSecurity();
          loadBackups();
          loadGrowth();
          loadStructure();
          loadEcosystem();
          loadShopItems();
          loadShopSuggestions();
          loadFinancial();
          
          setInterval(loadStatus, 30000);
          setInterval(loadActivity, 60000);
          setInterval(loadMetrics, 60000);
          setInterval(loadExtraCharts, 120000);
          setInterval(loadAudits, 120000);
          setInterval(loadSecurity, 30000);
          setInterval(loadBackups, 300000);
          setInterval(loadGrowth, 60000);
          setInterval(loadStructure, 120000);
          setInterval(loadEcosystem, 120000);
          setInterval(loadShopItems, 120000);
          setInterval(loadFinancial, 120000);
          
          async function loadStructure() {
            try {
              const res = await fetch('/api/structure');
              const data = await res.json();
              
              if (data.analysis) {
                if (data.updatedAt) {
                  const updated = new Date(data.updatedAt);
                  document.getElementById('structure-updated').textContent = updated.toLocaleString('it-IT');
                }
                document.getElementById('structure-score').textContent = data.analysis.benchmark.score + '/100';
                document.getElementById('structure-score').style.color = data.analysis.benchmark.score >= 80 ? '#2ecc71' : data.analysis.benchmark.score >= 60 ? '#f1c40f' : '#e74c3c';
                document.getElementById('structure-phase').textContent = data.analysis.phase;
                document.getElementById('structure-channels').textContent = data.analysis.currentStructure.totalChannels;
                document.getElementById('structure-private').textContent = data.analysis.currentStructure.privateChannels > 0 ? '~' + data.analysis.currentStructure.privateChannels : '0';
                
                document.getElementById('mee6-detected').textContent = data.analysis.mee6Integration.detected ? 'Si' : 'No';
                document.getElementById('mee6-detected').style.color = data.analysis.mee6Integration.detected ? '#2ecc71' : '#e74c3c';
                document.getElementById('mee6-features').textContent = data.analysis.mee6Integration.managedFeatures.length > 0 ? data.analysis.mee6Integration.managedFeatures.join(', ') : 'Nessuna rilevata';
                
                const configuredContainer = document.getElementById('structure-configured');
                if (data.analysis.benchmark.wellConfigured.length > 0) {
                  configuredContainer.innerHTML = data.analysis.benchmark.wellConfigured.map(ch => '<div class="activity-item"><div>✅ ' + ch + '</div></div>').join('');
                } else {
                  configuredContainer.innerHTML = '<p style="color: var(--text-muted);">Nessun canale essenziale rilevato</p>';
                }
                
                const missingContainer = document.getElementById('structure-missing');
                if (data.analysis.benchmark.missingEssential.length > 0) {
                  missingContainer.innerHTML = data.analysis.benchmark.missingEssential.map(ch => '<div class="activity-item"><div>❌ ' + ch + '</div></div>').join('');
                } else {
                  missingContainer.innerHTML = '<p style="color: var(--success);">Tutti i canali essenziali presenti!</p>';
                }
                
                const recsContainer = document.getElementById('structure-recommendations');
                if (data.analysis.recommendations360.length > 0) {
                  recsContainer.innerHTML = data.analysis.recommendations360.slice(0, 6).map(rec => {
                    const icon = rec.priority === 'high' ? '🔴' : rec.priority === 'medium' ? '🟡' : '🟢';
                    return '<div class="activity-item"><div>' + icon + ' <strong>' + rec.category + ':</strong> ' + rec.title + '</div><div style="font-size: 0.85rem; color: var(--text-muted); margin-top: 4px;">' + rec.description + '</div></div>';
                  }).join('');
                } else {
                  recsContainer.innerHTML = '<p style="color: var(--text-muted);">Nessuna raccomandazione</p>';
                }
                
                const changesContainer = document.getElementById('structure-changes');
                if (data.analysis.proposedChanges.length > 0) {
                  changesContainer.innerHTML = data.analysis.proposedChanges.slice(0, 5).map(change => {
                    const icon = change.action === 'create' ? '➕' : change.action === 'merge' ? '🔀' : '📦';
                    let text = change.action + ': ' + (change.name || '');
                    if (change.action === 'merge') text = 'Unisci: ' + change.targets.join(', ') + ' → #' + change.into;
                    return '<div class="activity-item"><div>' + icon + ' ' + text + '</div><div style="font-size: 0.85rem; color: var(--text-muted);">' + change.reason + '</div></div>';
                  }).join('');
                } else {
                  changesContainer.innerHTML = '<p style="color: var(--success);">Nessuna modifica suggerita</p>';
                }
              }
            } catch (e) { console.log('Structure error:', e); }
          }
          
          async function loadEcosystem() {
            try {
              const [growthRes, structureRes] = await Promise.all([
                fetch('/api/growth'),
                fetch('/api/structure')
              ]);
              const growthData = await growthRes.json();
              const structureData = await structureRes.json();
              
              const mee6Features = structureData.analysis?.mee6Integration?.managedFeatures || [];
              const hasMee6 = structureData.analysis?.mee6Integration?.detected || false;
              
              const updateModule = (id, active, source) => {
                const el = document.getElementById(id);
                const srcEl = document.getElementById(id + '-source');
                if (el) {
                  el.textContent = active ? '✅' : '⚪';
                  el.style.color = active ? '#2ecc71' : '#666';
                }
                if (srcEl) srcEl.textContent = source;
              };
              
              const hasLevels = mee6Features.some(f => f.toLowerCase().includes('level') || f.toLowerCase().includes('xp'));
              updateModule('eco-levels', hasLevels || hasMee6, hasLevels ? 'via MEE6' : (hasMee6 ? 'MEE6 presente' : 'Non attivo'));
              
              const hasAchievements = mee6Features.some(f => f.toLowerCase().includes('achievement') || f.toLowerCase().includes('badge'));
              updateModule('eco-achievements', hasAchievements, hasAchievements ? 'via MEE6' : 'Non attivo');
              
              const hasEconomy = growthData.economy?.hasEconomy || mee6Features.some(f => f.toLowerCase().includes('economy') || f.toLowerCase().includes('coin'));
              updateModule('eco-economy', hasEconomy, hasEconomy ? 'via MEE6' : 'Non attivo');
              
              const hasBoosts = mee6Features.some(f => f.toLowerCase().includes('boost') || f.toLowerCase().includes('multiplier'));
              updateModule('eco-boosts', hasBoosts, hasBoosts ? 'via MEE6' : 'Non attivo');
              
              const hasMonetization = growthData.economy?.hasMonetization || mee6Features.some(f => f.toLowerCase().includes('premium') || f.toLowerCase().includes('monetiz'));
              updateModule('eco-monetization', hasMonetization, hasMonetization ? 'Attivo' : 'Non attivo');
              
              const nodes = ['levels', 'achievements', 'boosts', 'economy', 'monetization'];
              const states = [hasLevels || hasMee6, hasAchievements, hasBoosts, hasEconomy, hasMonetization];
              nodes.forEach((node, i) => {
                const circle = document.querySelector('#node-' + node + ' circle');
                if (circle) {
                  circle.setAttribute('stroke', states[i] ? '#2ecc71' : '#666');
                }
              });
              
            } catch (e) { console.log('Ecosystem error:', e); }
          }
        </script>
      </body>
      </html>
    `);
  } else {
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Friday Bot | Oasis Gamers Hub</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <link rel="icon" href="/friday-logo.png" type="image/png">
        <style>${styles}</style>
      </head>
      <body>
        <nav class="navbar">
          <div class="brand">
            <img src="/friday-logo.png" alt="Oasis" onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'">
            <h1>Friday <span class="accent">Bot</span></h1>
          </div>
        </nav>
        
        <div class="hero">
          <img src="/friday-logo.png" alt="Oasis Gamers Hub" class="logo" onerror="this.style.display='none'">
          <h1>Friday Bot</h1>
          <p>Il tuo assistente AI per gestire, proteggere e far crescere <strong>Oasis Gamers Hub</strong></p>
          <a href="/auth/discord" class="btn btn-discord" style="font-size: 1.1rem; padding: 16px 36px;">
            <svg style="width: 20px; height: 20px; vertical-align: middle; margin-right: 8px;" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>
            Accedi con Discord
          </a>
        </div>

        <div class="container">
          <div class="features">
            <div class="feature-card">
              <div class="icon">🔍</div>
              <h3>Analisi Struttura</h3>
              <p>Scansiona automaticamente canali, ruoli e permessi del tuo server Discord.</p>
            </div>
            <div class="feature-card">
              <div class="icon">🛡️</div>
              <h3>Sicurezza Avanzata</h3>
              <p>Identifica vulnerabilita e problemi di sicurezza nei permessi.</p>
            </div>
            <div class="feature-card">
              <div class="icon">👥</div>
              <h3>Protezione Eta</h3>
              <p>Separazione sicura tra minorenni e adulti nei contenuti sensibili.</p>
            </div>
            <div class="feature-card">
              <div class="icon">🤖</div>
              <h3>Suggerimenti AI</h3>
              <p>Consigli intelligenti in 3 fasi per far crescere la community.</p>
            </div>
            <div class="feature-card">
              <div class="icon">⚡</div>
              <h3>Fix Automatici</h3>
              <p>Correzioni one-click per risolvere problemi rilevati.</p>
            </div>
            <div class="feature-card">
              <div class="icon">🔄</div>
              <h3>Simbiosi MEE6</h3>
              <p>Compatibilita totale con MEE6 Premium senza conflitti.</p>
            </div>
          </div>
          
          <div class="footer">
            <p>Accesso riservato al proprietario di <strong>Oasis Gamers Hub</strong></p>
          </div>
        </div>
      </body>
      </html>
    `);
  }
});

function generateState() {
  return crypto.randomBytes(16).toString('hex');
}

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Non autenticato' });
  }
  next();
}

app.get('/api/status', requireAuth, apiRateLimit, (req, res) => {
  const status = getBotStatus();
  const guildId = ALLOWED_GUILD_ID;
  const guildStats = guildId ? getGuildStats(guildId) : null;
  const antiRaid = guildId ? getAntiRaidStatus(guildId) : null;
  
  res.json({
    bot: status,
    guild: guildStats,
    antiRaid
  });
});

app.get('/api/activity', requireAuth, apiRateLimit, (req, res) => {
  const limit = parseInt(req.query.limit) || 20;
  const activity = getActivityLog(limit);
  res.json(activity);
});

app.get('/api/metrics', requireAuth, apiRateLimit, async (req, res) => {
  const guildId = ALLOWED_GUILD_ID;
  if (!guildId) {
    return res.json({ metrics: [], trends: null });
  }
  
  const days = parseInt(req.query.days) || 30;
  const metrics = await getDailyMetrics(guildId, days);
  const trends = await getTrends(guildId);
  
  res.json({ metrics, trends });
});

app.get('/api/audits', requireAuth, apiRateLimit, async (req, res) => {
  const guildId = ALLOWED_GUILD_ID;
  if (!guildId) {
    return res.json([]);
  }
  
  const limit = parseInt(req.query.limit) || 10;
  const audits = await getAuditHistory(guildId, limit);
  res.json(audits);
});

app.get('/api/backups', requireAuth, apiRateLimit, async (req, res) => {
  const guildId = ALLOWED_GUILD_ID;
  if (!guildId) {
    return res.json([]);
  }
  
  const backups = await getConfigBackups(guildId);
  res.json(backups);
});

app.get('/api/growth', requireAuth, apiRateLimit, async (req, res) => {
  const guildId = ALLOWED_GUILD_ID;
  if (!guildId) {
    return res.json({ scaling: null, economy: null });
  }
  
  try {
    const cachedGrowth = getGrowthData(guildId);
    
    if (cachedGrowth) {
      return res.json({ 
        scaling: cachedGrowth.scaling, 
        economy: cachedGrowth.economy,
        cached: true,
        updatedAt: cachedGrowth.updatedAt
      });
    }
    
    const dailyMetrics = await getDailyMetrics(guildId, 30);
    const guildStats = getGuildStats(guildId);
    
    const memberCount = guildStats?.memberCount || 0;
    const channelCount = guildStats?.channelCount || 0;
    const roleCount = guildStats?.roleCount || 0;
    
    let weeklyJoins = 0, weeklyLeaves = 0, weeklyMessages = 0;
    if (dailyMetrics.length >= 7) {
      const lastWeek = dailyMetrics.slice(-7);
      weeklyMessages = lastWeek.reduce((sum, d) => sum + (d.messageCount || 0), 0);
      weeklyJoins = lastWeek.reduce((sum, d) => sum + (d.joinCount || 0), 0);
      weeklyLeaves = lastWeek.reduce((sum, d) => sum + (d.leaveCount || 0), 0);
    }
    
    const netGrowth = weeklyJoins - weeklyLeaves;
    const progressToTarget = Math.min((memberCount / 1000) * 100, 100).toFixed(1);
    const channelsPerMember = memberCount > 0 ? (channelCount / memberCount).toFixed(3) : 0;
    
    let score = 100;
    const issues = [];
    const recommendations = [];
    let channelStatus = 'optimal';
    
    if (parseFloat(channelsPerMember) > 0.3) {
      channelStatus = 'over_scaled';
      issues.push({ severity: 'medium', message: 'Troppi canali per il numero di membri' });
      score -= 15;
      recommendations.push({ priority: 'high', text: 'Unisci canali simili o poco utilizzati' });
    } else if (parseFloat(channelsPerMember) < 0.05 && memberCount > 50) {
      channelStatus = 'under_scaled';
      issues.push({ severity: 'low', message: 'Pochi canali per il numero di membri' });
      score -= 5;
    }
    
    if (netGrowth < 0) {
      issues.push({ severity: 'high', message: 'Crescita negativa questa settimana: ' + netGrowth + ' membri' });
      score -= 20;
      recommendations.push({ priority: 'critical', text: 'Implementa strategie di retention' });
    }
    
    if (memberCount < 100) {
      recommendations.push({ priority: 'high', text: 'Fase iniziale: focus su contenuti di qualita e inviti personali' });
    } else if (memberCount < 500) {
      recommendations.push({ priority: 'high', text: 'Fase crescita: attiva partnership ed eventi cross-server' });
    } else if (memberCount < 1000) {
      recommendations.push({ priority: 'high', text: 'Quasi al traguardo! Focus su community features' });
    }
    
    score = Math.max(0, Math.min(100, score));
    
    const scaling = {
      memberCount,
      progressToTarget,
      score,
      channels: { total: channelCount, status: channelStatus },
      roles: { total: roleCount },
      engagement: { weeklyMessages, weeklyJoins, weeklyLeaves, netGrowth },
      issues,
      recommendations
    };
    
    const economy = {
      mee6Present: false,
      mee6Premium: false,
      synergyScore: 0,
      features: {
        economy: { detected: false },
        achievements: { detected: false },
        monetization: { detected: false },
        leveling: { detected: false, levelCount: 0 }
      },
      recommendations: [
        { priority: 'low', text: 'Esegui !scalecheck su Discord per analisi completa MEE6' }
      ],
      note: 'Esegui !scalecheck su Discord per dati MEE6 aggiornati'
    };
    
    res.json({ scaling, economy, cached: false });
  } catch (error) {
    console.error('Growth API error:', error);
    res.json({ scaling: null, economy: null, error: error.message });
  }
});

app.get('/api/structure', requireAuth, apiRateLimit, async (req, res) => {
  const guildId = ALLOWED_GUILD_ID;
  if (!guildId) {
    return res.json({ analysis: null });
  }
  
  try {
    const cachedStructure = getStructureData(guildId);
    
    if (cachedStructure) {
      return res.json({ 
        analysis: cachedStructure.analysis,
        cached: true,
        updatedAt: cachedStructure.updatedAt
      });
    }
    
    res.json({ 
      analysis: null, 
      note: 'Esegui Structure360 dalla dashboard o !structure su Discord per analisi completa' 
    });
  } catch (error) {
    console.error('Structure API error:', error);
    res.json({ analysis: null, error: error.message });
  }
});

app.get('/api/security', requireAuth, apiRateLimit, (req, res) => {
  const stats = getSecurityStats();
  const log = getSecurityLog(50);
  const alerts = getSecurityAlerts(20);
  const sessions = getActiveSessions();
  
  logSecurityEvent({
    type: 'security_dashboard_access',
    ip: req.ip,
    userId: req.session.user?.id,
    severity: 'low',
    message: `Dashboard sicurezza accesso da ${req.session.user?.username}`
  });
  
  res.json({ stats, log, alerts, sessions });
});

app.post('/api/action/:action', requireAuth, apiRateLimit, async (req, res) => {
  const { action } = req.params;
  const guildId = ALLOWED_GUILD_ID;
  
  if (!guildId) {
    return res.json({ success: false, error: 'Guild non configurata' });
  }
  
  try {
    switch (action) {
      case 'audit':
        const auditCmdId = await addPendingCommand(guildId, 'audit', req.session.user?.username);
        if (auditCmdId) {
          addActivityLog({
            type: 'command',
            action: 'audit_triggered',
            user: req.session.user?.username,
            message: 'Audit avviato da dashboard'
          });
          res.json({ success: true, message: 'Audit avviato! I risultati appariranno nel canale Discord.', commandId: auditCmdId });
        } else {
          res.json({ success: false, error: 'MongoDB non disponibile. Prova dal canale Discord con !audit' });
        }
        break;
        
      case 'backup':
        const backupCmdId = await addPendingCommand(guildId, 'backup', req.session.user?.username);
        if (backupCmdId) {
          addActivityLog({
            type: 'command',
            action: 'backup_triggered',
            user: req.session.user?.username,
            message: 'Backup richiesto da dashboard'
          });
          res.json({ success: true, message: 'Backup in corso! Controlla la sezione Backup Salvati.', commandId: backupCmdId });
        } else {
          res.json({ success: false, error: 'MongoDB non disponibile. Prova dal canale Discord con !backup' });
        }
        break;
        
      case 'security':
        const stats = getSecurityStats();
        addActivityLog({
          type: 'command',
          action: 'security_check',
          user: req.session.user?.username,
          message: 'Security check eseguito da dashboard'
        });
        res.json({ 
          success: true, 
          message: `Security check: ${stats.totalEvents24h} eventi 24h, ${stats.blockedIPsCount} IP bloccati, ${stats.activeSessionsCount} sessioni attive` 
        });
        break;
        
      case 'refresh':
        addActivityLog({
          type: 'system',
          action: 'stats_refresh',
          user: req.session.user?.username,
          message: 'Refresh statistiche da dashboard'
        });
        res.json({ success: true, message: 'Statistiche aggiornate!' });
        break;
        
      case 'scalecheck':
        const scalecheckCmdId = await addPendingCommand(guildId, 'scalecheck', req.session.user?.username);
        if (scalecheckCmdId) {
          addActivityLog({
            type: 'command',
            action: 'scalecheck_triggered',
            user: req.session.user?.username,
            message: 'Scalecheck avviato da dashboard'
          });
          res.json({ success: true, message: 'Scalecheck avviato! I dati MEE6 saranno aggiornati nel pannello Growth.', commandId: scalecheckCmdId });
        } else {
          res.json({ success: false, error: 'MongoDB non disponibile. Prova dal canale Discord con !scalecheck' });
        }
        break;
        
      case 'structure':
        const structureCmdId = await addPendingCommand(guildId, 'structure', req.session.user?.username);
        if (structureCmdId) {
          addActivityLog({
            type: 'command',
            action: 'structure_triggered',
            user: req.session.user?.username,
            message: 'Structure360 avviato da dashboard'
          });
          res.json({ success: true, message: 'Structure360 avviato! I dati saranno aggiornati nel pannello Structure.', commandId: structureCmdId });
        } else {
          res.json({ success: false, error: 'MongoDB non disponibile. Prova dal canale Discord con !structure' });
        }
        break;
        
      default:
        res.json({ success: false, error: 'Azione non riconosciuta' });
    }
  } catch (error) {
    console.error('Action error:', error);
    res.json({ success: false, error: error.message });
  }
});

app.post('/api/config/antiraid', requireAuth, apiRateLimit, (req, res) => {
  const { threshold, window } = req.body;
  const guildId = ALLOWED_GUILD_ID;
  
  if (!guildId) {
    return res.json({ success: false, error: 'Guild non configurata' });
  }
  
  if (!threshold || !window || threshold < 1 || window < 1) {
    return res.json({ success: false, error: 'Parametri invalidi' });
  }
  
  setAntiRaidStatus(guildId, {
    enabled: true,
    threshold: threshold,
    window: window,
    triggered: false
  });
  
  addActivityLog({
    type: 'config',
    action: 'antiraid_config_updated',
    user: req.session.user?.username,
    message: `Anti-raid configurato: ${threshold} join in ${window}s`
  });
  
  logSecurityEvent({
    type: 'antiraid_config_change',
    ip: req.ip,
    userId: req.session.user?.id,
    severity: 'medium',
    message: `Configurazione anti-raid aggiornata da ${req.session.user?.username}: ${threshold} join in ${window}s`
  });
  
  res.json({ success: true, threshold, window });
});

// ============================================
// AUTO-REFRESH ON LOGIN
// ============================================

const DATA_STALE_THRESHOLD = 6 * 60 * 60 * 1000; // 6 ore

app.post('/api/auto-refresh', requireAuth, apiRateLimit, async (req, res) => {
  const guildId = ALLOWED_GUILD_ID;
  if (!guildId) {
    return res.json({ success: false, error: 'Guild non configurata' });
  }
  
  try {
    const triggeredCommands = [];
    const now = Date.now();
    
    // Check structure data
    const structureData = getStructureData(guildId);
    const structureAge = structureData?.updatedAt ? now - new Date(structureData.updatedAt).getTime() : Infinity;
    
    if (structureAge > DATA_STALE_THRESHOLD || !structureData?.analysis) {
      await addPendingCommand(guildId, 'structure', 'auto-refresh');
      triggeredCommands.push('structure');
    }
    
    // Check growth/scale data
    const growthData = getGrowthData(guildId);
    const growthAge = growthData?.updatedAt ? now - new Date(growthData.updatedAt).getTime() : Infinity;
    
    if (growthAge > DATA_STALE_THRESHOLD || !growthData?.analysis) {
      await addPendingCommand(guildId, 'scalecheck', 'auto-refresh');
      triggeredCommands.push('scalecheck');
    }
    
    if (triggeredCommands.length > 0) {
      addActivityLog({
        type: 'system',
        action: 'auto_refresh',
        user: 'Sistema',
        message: `Auto-refresh avviato: ${triggeredCommands.join(', ')}`
      });
      console.log(`Auto-refresh triggered: ${triggeredCommands.join(', ')}`);
    }
    
    res.json({ 
      success: true, 
      triggered: triggeredCommands,
      message: triggeredCommands.length > 0 
        ? `Analisi in corso: ${triggeredCommands.join(', ')}` 
        : 'Dati già aggiornati'
    });
  } catch (error) {
    console.error('Auto-refresh error:', error);
    res.json({ success: false, error: error.message });
  }
});

// ============================================
// SHOP & FINANCIAL API ENDPOINTS
// ============================================

app.get('/api/shop/items', requireAuth, apiRateLimit, async (req, res) => {
  const guildId = ALLOWED_GUILD_ID;
  if (!guildId) {
    return res.json({ items: [] });
  }
  
  try {
    const items = await getShopItems(guildId);
    res.json({ items });
  } catch (error) {
    res.json({ items: [], error: error.message });
  }
});

app.post('/api/shop/items', requireAuth, apiRateLimit, async (req, res) => {
  const guildId = ALLOWED_GUILD_ID;
  if (!guildId) {
    return res.json({ success: false, error: 'Guild non configurata' });
  }
  
  try {
    const { items } = req.body;
    if (!items || !Array.isArray(items)) {
      return res.json({ success: false, error: 'Items non validi' });
    }
    
    let savedCount = 0;
    for (const item of items) {
      const result = await saveShopItem(guildId, item);
      if (result) savedCount++;
    }
    
    addActivityLog({
      type: 'economy',
      action: 'shop_items_added',
      user: req.session.user?.username,
      message: `Aggiunti ${savedCount} articoli allo shop`
    });
    
    res.json({ success: true, savedCount });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

app.delete('/api/shop/items/:id', requireAuth, apiRateLimit, async (req, res) => {
  const guildId = ALLOWED_GUILD_ID;
  if (!guildId) {
    return res.json({ success: false, error: 'Guild non configurata' });
  }
  
  try {
    const { id } = req.params;
    await deleteShopItem(guildId, id);
    
    addActivityLog({
      type: 'economy',
      action: 'shop_item_deleted',
      user: req.session.user?.username,
      message: 'Articolo rimosso dallo shop'
    });
    
    res.json({ success: true });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

app.get('/api/shop/suggestions', requireAuth, apiRateLimit, async (req, res) => {
  const guildId = ALLOWED_GUILD_ID;
  if (!guildId) {
    return res.json({ suggestions: [] });
  }
  
  try {
    const items = await getShopItems(guildId);
    const suggestions = generateShopSuggestions(items);
    res.json({ suggestions });
  } catch (error) {
    res.json({ suggestions: [], error: error.message });
  }
});

function generateShopSuggestions(items) {
  const suggestions = [];
  
  if (items.length === 0) {
    return [];
  }
  
  const prices = items.map(i => i.price).filter(p => p > 0);
  const avgPrice = prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : 0;
  const maxPrice = Math.max(...prices, 0);
  const minPrice = Math.min(...prices, Infinity);
  
  const types = items.reduce((acc, item) => {
    acc[item.type] = (acc[item.type] || 0) + 1;
    return acc;
  }, {});
  
  if (items.length < 5) {
    suggestions.push({
      priority: 'medium',
      title: 'Shop troppo piccolo',
      description: `Hai solo ${items.length} articoli. Uno shop ideale ha 8-15 articoli per offrire varieta.`,
      action: 'Aggiungi piu articoli come ruoli speciali, boost XP, o oggetti cosmetici.'
    });
  }
  
  if (maxPrice > avgPrice * 5) {
    suggestions.push({
      priority: 'high',
      title: 'Divario prezzi eccessivo',
      description: 'Il tuo articolo piu costoso costa 5+ volte la media. Questo potrebbe scoraggiare gli acquisti.',
      action: 'Aggiungi articoli a prezzi intermedi per creare una scala progressiva.'
    });
  }
  
  if (!types.role || types.role === 0) {
    suggestions.push({
      priority: 'high',
      title: 'Mancano ruoli nello shop',
      description: 'I ruoli sono tra gli articoli piu desiderati. Non hai ruoli acquistabili.',
      action: 'Aggiungi ruoli VIP, Supporter, o ruoli colorati che gli utenti possono comprare.'
    });
  }
  
  if (!types.boost || types.boost === 0) {
    suggestions.push({
      priority: 'medium',
      title: 'Nessun boost disponibile',
      description: 'I boost XP sono molto popolari e incentivano l\'attivita.',
      action: 'Aggiungi boost come "2x XP per 24h" o "Moltiplicatore Messaggi".'
    });
  }
  
  if (items.length >= 5 && types.role && types.boost) {
    suggestions.push({
      priority: 'low',
      title: 'Shop ben strutturato',
      description: `Hai ${items.length} articoli con buona varieta di tipi. Ottimo lavoro!`,
      action: 'Monitora le vendite e aggiusta i prezzi in base alla domanda.'
    });
  }
  
  const expensiveItems = items.filter(i => i.price > avgPrice * 3);
  if (expensiveItems.length > items.length / 2) {
    suggestions.push({
      priority: 'high',
      title: 'Troppi articoli costosi',
      description: 'Piu della meta degli articoli costa molto. Questo limita gli acquisti dei nuovi membri.',
      action: 'Aggiungi articoli entry-level a 500-1000 coins per i nuovi utenti.'
    });
  }
  
  return suggestions.slice(0, 6);
}

app.get('/api/financial/costs', requireAuth, apiRateLimit, async (req, res) => {
  const guildId = ALLOWED_GUILD_ID;
  
  try {
    let mongoUsage = 0;
    let openaiCalls = 0;
    let totalCost = 0;
    
    const serviceCosts = guildId ? await getServiceCosts(guildId, 30) : [];
    
    const openaiCosts = serviceCosts.filter(c => c.service === 'openai');
    openaiCalls = openaiCosts.length;
    const openaiTotal = openaiCalls * 0.03;
    totalCost += openaiTotal;
    
    mongoUsage = 5 + (serviceCosts.length * 0.001);
    
    res.json({
      mongodb: {
        usageMB: mongoUsage,
        limitMB: 512,
        percentUsed: (mongoUsage / 512) * 100
      },
      flyio: {
        vmsUsed: 1,
        vmsLimit: 3,
        transferGB: 0.1,
        transferLimitGB: 160
      },
      openai: {
        callsThisMonth: openaiCalls,
        estimatedCost: openaiTotal
      },
      discord: {
        status: 'ok',
        rateLimit: 'normal'
      },
      totalCost,
      lastUpdated: new Date().toISOString()
    });
  } catch (error) {
    res.json({ 
      mongodb: { usageMB: 0, limitMB: 512, percentUsed: 0 },
      flyio: { vmsUsed: 1, vmsLimit: 3, transferGB: 0, transferLimitGB: 160 },
      openai: { callsThisMonth: 0, estimatedCost: 0 },
      discord: { status: 'ok', rateLimit: 'normal' },
      totalCost: 0,
      error: error.message 
    });
  }
});

app.get('/auth/discord', (req, res) => {
  const state = generateState();
  req.session.oauthState = state;
  
  console.log('OAuth start - Redirect URI:', REDIRECT_URI);
  console.log('OAuth start - Client ID:', DISCORD_CLIENT_ID ? 'SET' : 'MISSING');
  
  const params = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: 'identify email guilds',
    state: state
  });
  res.redirect(`https://discord.com/api/oauth2/authorize?${params}`);
});

app.get('/auth/discord/callback', async (req, res) => {
  const { code, state } = req.query;
  
  console.log('OAuth callback received - code:', code ? 'YES' : 'NO', 'state:', state, 'session state:', req.session.oauthState);
  
  if (!code || !state || state !== req.session.oauthState) {
    console.error('OAuth validation failed: invalid state or missing code');
    console.error('Details - code:', !!code, 'state match:', state === req.session.oauthState);
    logSecurityEvent({
      type: 'oauth_validation_failed',
      ip: req.ip,
      severity: 'medium',
      message: 'OAuth validation failed: stato o codice invalido'
    });
    recordLoginAttempt(req.ip, false);
    return res.redirect('/');
  }
  
  delete req.session.oauthState;

  try {
    const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      body: new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        code: code,
        grant_type: 'authorization_code',
        redirect_uri: REDIRECT_URI
      }),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    const tokenData = await tokenResponse.json();

    if (tokenData.error) {
      console.error('Token error:', tokenData);
      return res.redirect('/');
    }

    const userResponse = await fetch('https://discord.com/api/users/@me', {
      headers: {
        authorization: `Bearer ${tokenData.access_token}`
      }
    });
    const userData = await userResponse.json();

    const guildsResponse = await fetch('https://discord.com/api/users/@me/guilds', {
      headers: {
        authorization: `Bearer ${tokenData.access_token}`
      }
    });
    const guildsData = await guildsResponse.json();
    
    if (ALLOWED_GUILD_ID) {
      const allowedGuild = guildsData.find(g => g.id === ALLOWED_GUILD_ID);
      if (!allowedGuild || !allowedGuild.owner) {
        console.log(`Accesso negato: ${userData.username} non è proprietario del server autorizzato`);
        logSecurityEvent({
          type: 'access_denied',
          ip: req.ip,
          userId: userData.id,
          username: userData.username,
          severity: 'high',
          message: `Tentativo accesso non autorizzato da ${userData.username} (${userData.id})`
        });
        recordLoginAttempt(req.ip, false);
        return res.send(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>Accesso Negato</title>
            <style>
              body { font-family: 'Segoe UI', Arial, sans-serif; background: #1a1a2e; color: #eee; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
              .box { background: #16213e; padding: 40px; border-radius: 12px; text-align: center; max-width: 400px; }
              h1 { color: #ed4245; margin-bottom: 20px; }
              p { color: #aaa; margin-bottom: 20px; }
              a { color: #5865f2; }
            </style>
          </head>
          <body>
            <div class="box">
              <h1>Accesso Negato</h1>
              <p>Solo il proprietario del server Oasis può accedere a questa dashboard.</p>
              <a href="/">Torna alla home</a>
            </div>
          </body>
          </html>
        `);
      }
    }
    
    req.session.user = userData;
    req.session.guilds = guildsData;
    req.session.accessToken = tokenData.access_token;
    req.session.isOwner = true;
    
    console.log(`Proprietario loggato: ${userData.username}`);
    
    logSecurityEvent({
      type: 'login_success',
      ip: req.ip,
      userId: userData.id,
      username: userData.username,
      severity: 'low',
      message: `Login riuscito: ${userData.username} (Owner)`
    });
    recordLoginAttempt(req.ip, true);
    registerSession(req.session.id, userData.id, req.ip);
    
    res.redirect('/');
  } catch (error) {
    console.error('OAuth error:', error);
    res.redirect('/');
  }
});

app.get('/api/user', (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Non autenticato' });
  }
  res.json({
    user: req.session.user,
    guilds: req.session.guilds
  });
});

app.get('/logout', (req, res) => {
  const user = req.session.user;
  const sessionId = req.session.id;
  
  if (user) {
    logSecurityEvent({
      type: 'logout',
      ip: req.ip,
      userId: user.id,
      username: user.username,
      severity: 'low',
      message: `Logout: ${user.username}`
    });
    invalidateSession(sessionId);
  }
  
  req.session.destroy();
  res.redirect('/');
});

app.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.send('User-agent: *\nDisallow: /');
});

connectDB().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server web avviato su porta ${PORT}`);
  });
});

export default app;
