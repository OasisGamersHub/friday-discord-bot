import express from 'express';
import session from 'express-session';
import cookieParser from 'cookie-parser';
import crypto from 'crypto';
import {
  getBotStatus,
  getGuildStats,
  getAllGuildsStats,
  getActivityLog,
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
  invalidateSession
} from './modules/sharedState.js';
import {
  getDailyMetrics,
  getAuditHistory,
  getConfigBackups,
  getTrends,
  addPendingCommand,
  getCommandResult
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

const styles = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Inter', 'Segoe UI', Arial, sans-serif; background: linear-gradient(135deg, #0d2626 0%, #1a3a3a 50%, #0d2626 100%); color: #eee; min-height: 100vh; }
  .navbar { background: rgba(13, 38, 38, 0.95); backdrop-filter: blur(10px); padding: 15px 30px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(46, 204, 113, 0.2); position: sticky; top: 0; z-index: 100; }
  .navbar .brand { display: flex; align-items: center; gap: 12px; }
  .navbar .brand img { width: 45px; height: 45px; border-radius: 50%; }
  .navbar h1 { color: #4aba8a; font-size: 1.4rem; font-weight: 700; }
  .navbar a { color: #eee; text-decoration: none; margin-left: 20px; transition: color 0.2s; }
  .navbar a:hover { color: #4aba8a; }
  .container { max-width: 1200px; margin: 0 auto; padding: 30px; }
  .card { background: linear-gradient(145deg, rgba(26, 58, 58, 0.9), rgba(13, 38, 38, 0.95)); border: 1px solid rgba(46, 204, 113, 0.15); border-radius: 16px; padding: 28px; margin-bottom: 24px; backdrop-filter: blur(5px); transition: transform 0.2s, box-shadow 0.2s; }
  .card:hover { transform: translateY(-2px); box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3); }
  .card h2 { color: #4aba8a; margin-bottom: 15px; font-size: 1.2rem; font-weight: 600; display: flex; align-items: center; gap: 10px; }
  .card h2::before { content: ''; width: 4px; height: 20px; background: linear-gradient(180deg, #e67e22, #4aba8a); border-radius: 2px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 24px; }
  .stat-box { background: linear-gradient(145deg, rgba(46, 204, 113, 0.1), rgba(26, 58, 58, 0.8)); border: 1px solid rgba(46, 204, 113, 0.2); border-radius: 14px; padding: 24px; text-align: center; transition: all 0.3s; }
  .stat-box:hover { border-color: #e67e22; transform: scale(1.02); }
  .stat-box .value { font-size: 2.2rem; font-weight: 700; background: linear-gradient(135deg, #4aba8a, #2ecc71); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
  .stat-box .label { color: #8fa8a8; margin-top: 8px; font-size: 0.9rem; font-weight: 500; }
  .btn { display: inline-block; padding: 14px 28px; border-radius: 10px; text-decoration: none; font-weight: 600; cursor: pointer; border: none; transition: all 0.3s; font-size: 0.95rem; }
  .btn-primary { background: linear-gradient(135deg, #2ecc71, #27ae60); color: white; box-shadow: 0 4px 15px rgba(46, 204, 113, 0.3); }
  .btn-primary:hover { background: linear-gradient(135deg, #27ae60, #219a52); transform: translateY(-2px); box-shadow: 0 6px 20px rgba(46, 204, 113, 0.4); }
  .btn-discord { background: linear-gradient(135deg, #5865f2, #4752c4); color: white; box-shadow: 0 4px 15px rgba(88, 101, 242, 0.3); }
  .btn-discord:hover { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(88, 101, 242, 0.4); }
  .btn-danger { background: linear-gradient(135deg, #e74c3c, #c0392b); color: white; }
  .btn-danger:hover { transform: translateY(-2px); }
  .btn-outline { background: transparent; border: 2px solid #4aba8a; color: #4aba8a; }
  .btn-outline:hover { background: #4aba8a; color: #0d2626; }
  .user-info { display: flex; align-items: center; gap: 15px; }
  .user-info img { width: 45px; height: 45px; border-radius: 50%; border: 2px solid #4aba8a; }
  .user-info span { font-weight: 500; }
  .progress-bar { background: rgba(26, 58, 58, 0.8); border-radius: 10px; height: 12px; overflow: hidden; margin-top: 12px; }
  .progress-fill { height: 100%; transition: width 0.5s ease-out; border-radius: 10px; }
  .progress-fill.green { background: linear-gradient(90deg, #27ae60, #2ecc71); }
  .progress-fill.yellow { background: linear-gradient(90deg, #f39c12, #f1c40f); }
  .progress-fill.red { background: linear-gradient(90deg, #c0392b, #e74c3c); }
  .issue-list { list-style: none; }
  .issue-list li { padding: 14px 16px; margin: 8px 0; border-radius: 10px; font-size: 0.95rem; }
  .issue-list li.critical { background: rgba(231, 76, 60, 0.15); border-left: 4px solid #e74c3c; }
  .issue-list li.high { background: rgba(241, 196, 15, 0.15); border-left: 4px solid #f1c40f; }
  .issue-list li.medium { background: rgba(46, 204, 113, 0.15); border-left: 4px solid #2ecc71; }
  .guilds-list { display: flex; flex-wrap: wrap; gap: 15px; margin-top: 15px; }
  .guild-card { background: rgba(26, 58, 58, 0.6); border: 1px solid rgba(46, 204, 113, 0.2); padding: 15px 20px; border-radius: 12px; display: flex; align-items: center; gap: 12px; transition: all 0.2s; }
  .guild-card:hover { border-color: #e67e22; }
  .guild-card img { width: 40px; height: 40px; border-radius: 50%; }
  .hero { text-align: center; padding: 80px 20px; position: relative; }
  .hero::before { content: ''; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 400px; height: 400px; background: radial-gradient(circle, rgba(46, 204, 113, 0.1) 0%, transparent 70%); pointer-events: none; }
  .hero .logo { width: 120px; height: 120px; border-radius: 50%; margin-bottom: 24px; border: 3px solid #4aba8a; box-shadow: 0 0 40px rgba(46, 204, 113, 0.3); }
  .hero h1 { font-size: 2.8rem; margin-bottom: 16px; background: linear-gradient(135deg, #4aba8a, #e67e22); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; font-weight: 700; }
  .hero p { color: #8fa8a8; margin-bottom: 32px; font-size: 1.15rem; max-width: 500px; margin-left: auto; margin-right: auto; line-height: 1.6; }
  .features { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin-top: 50px; }
  .feature-card { background: linear-gradient(145deg, rgba(26, 58, 58, 0.7), rgba(13, 38, 38, 0.9)); border: 1px solid rgba(46, 204, 113, 0.1); border-radius: 14px; padding: 24px; text-align: center; transition: all 0.3s; }
  .feature-card:hover { border-color: #e67e22; transform: translateY(-4px); }
  .feature-card .icon { font-size: 2.5rem; margin-bottom: 16px; }
  .feature-card h3 { color: #4aba8a; font-size: 1.1rem; margin-bottom: 10px; font-weight: 600; }
  .feature-card p { color: #8fa8a8; font-size: 0.9rem; line-height: 1.5; }
  .command-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px; margin-top: 20px; }
  .command-item { background: rgba(26, 58, 58, 0.5); border: 1px solid rgba(46, 204, 113, 0.1); border-radius: 10px; padding: 16px; transition: all 0.2s; }
  .command-item:hover { border-color: #4aba8a; }
  .command-item code { background: rgba(46, 204, 113, 0.2); color: #4aba8a; padding: 4px 10px; border-radius: 6px; font-family: 'Consolas', monospace; font-size: 0.95rem; }
  .command-item span { color: #8fa8a8; margin-left: 12px; font-size: 0.9rem; }
  .accent { color: #e67e22; }
  .footer { text-align: center; padding: 30px; color: #5a7a7a; font-size: 0.85rem; border-top: 1px solid rgba(46, 204, 113, 0.1); margin-top: 40px; }
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
        <link rel="icon" href="https://cdn.discordapp.com/icons/1435348267268313090/a_icon.png" type="image/png">
        <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
        <style>${styles}
          .tabs { display: flex; gap: 10px; margin-bottom: 20px; flex-wrap: wrap; }
          .tab { padding: 10px 20px; background: rgba(26, 58, 58, 0.6); border: 1px solid rgba(46, 204, 113, 0.2); border-radius: 8px; cursor: pointer; color: #8fa8a8; transition: all 0.2s; }
          .tab:hover, .tab.active { background: rgba(46, 204, 113, 0.2); border-color: #4aba8a; color: #4aba8a; }
          .tab-content { display: none; }
          .tab-content.active { display: block; }
          .chart-container { background: rgba(13, 38, 38, 0.5); border-radius: 12px; padding: 20px; margin-top: 16px; }
          .activity-log { max-height: 400px; overflow-y: auto; }
          .activity-item { padding: 12px; margin: 8px 0; background: rgba(26, 58, 58, 0.5); border-radius: 8px; border-left: 3px solid #4aba8a; }
          .activity-item.raid { border-left-color: #e74c3c; background: rgba(231, 76, 60, 0.1); }
          .activity-item.audit { border-left-color: #3498db; }
          .activity-item .time { color: #5a7a7a; font-size: 0.8rem; }
          .live-dot { display: inline-block; width: 8px; height: 8px; background: #2ecc71; border-radius: 50%; margin-right: 8px; animation: pulse 2s infinite; }
          @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
          .raid-alert { background: rgba(231, 76, 60, 0.2); border: 1px solid #e74c3c; border-radius: 10px; padding: 16px; margin-bottom: 20px; display: none; }
          .raid-alert.active { display: block; }
        </style>
      </head>
      <body>
        <nav class="navbar">
          <div class="brand">
            <img src="https://cdn.discordapp.com/icons/1435348267268313090/a_icon.png" alt="Oasis" onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'">
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
            <div class="tab" data-tab="actions">🚀 Azioni</div>
            <div class="tab" data-tab="security">🛡️ Sicurezza</div>
            <div class="tab" data-tab="activity">📋 Attivita</div>
            <div class="tab" data-tab="commands">⌨️ Comandi</div>
            <div class="tab" data-tab="features">✨ Funzionalita</div>
          </div>
          
          <div id="overview" class="tab-content active">
            <div class="card">
              <h2><span class="live-dot"></span>Statistiche Live</h2>
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
              <div class="chart-container">
                <canvas id="growthChart"></canvas>
              </div>
            </div>
            
            <div class="card">
              <h2>Attivita Messaggi (30 giorni)</h2>
              <div class="chart-container">
                <canvas id="messagesChart"></canvas>
              </div>
            </div>
            
            <div class="card">
              <h2>Flusso Membri - Join/Leave (30 giorni)</h2>
              <div class="chart-container">
                <canvas id="flowChart"></canvas>
              </div>
            </div>
            
            <div class="card">
              <h2>Ultimi Audit</h2>
              <div id="audit-list" class="activity-log">
                <p style="color: #5a7a7a;">Caricamento...</p>
              </div>
            </div>
          </div>
          
          <div id="actions" class="tab-content">
            <div class="card">
              <h2>🚀 Quick Actions</h2>
              <p style="color: #8fa8a8; margin-bottom: 20px;">Esegui comandi bot direttamente dalla dashboard</p>
              <div class="grid">
                <div class="stat-box" style="cursor: pointer;" onclick="executeAction('audit')">
                  <div class="value" style="font-size: 2rem;">🔍</div>
                  <div class="label">Avvia Audit</div>
                  <button class="btn btn-primary" style="margin-top: 12px; width: 100%;" id="btn-audit">Esegui</button>
                </div>
                <div class="stat-box" style="cursor: pointer;" onclick="executeAction('backup')">
                  <div class="value" style="font-size: 2rem;">💾</div>
                  <div class="label">Crea Backup</div>
                  <button class="btn btn-primary" style="margin-top: 12px; width: 100%;" id="btn-backup">Esegui</button>
                </div>
                <div class="stat-box" style="cursor: pointer;" onclick="executeAction('security')">
                  <div class="value" style="font-size: 2rem;">🛡️</div>
                  <div class="label">Check Sicurezza</div>
                  <button class="btn btn-primary" style="margin-top: 12px; width: 100%;" id="btn-security">Esegui</button>
                </div>
                <div class="stat-box" style="cursor: pointer;" onclick="executeAction('refresh')">
                  <div class="value" style="font-size: 2rem;">🔄</div>
                  <div class="label">Refresh Stats</div>
                  <button class="btn btn-primary" style="margin-top: 12px; width: 100%;" id="btn-refresh">Esegui</button>
                </div>
              </div>
            </div>
            
            <div class="card">
              <h2>⚙️ Configurazione Anti-Raid</h2>
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
              <div id="backup-list" class="activity-log">
                <p style="color: #5a7a7a;">Caricamento...</p>
              </div>
            </div>
            
            <div class="card">
              <h2>📝 Risultato Ultimo Comando</h2>
              <div id="action-result" class="activity-log" style="background: rgba(13, 38, 38, 0.5); padding: 16px; border-radius: 8px; min-height: 100px;">
                <p style="color: #5a7a7a;">Nessun comando eseguito</p>
              </div>
            </div>
          </div>
          
          <div id="security" class="tab-content">
            <div class="card">
              <h2>🛡️ Centro Sicurezza</h2>
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
              <div id="security-log" class="activity-log">
                <p style="color: #5a7a7a;">Caricamento...</p>
              </div>
            </div>
          </div>
          
          <div id="activity" class="tab-content">
            <div class="card">
              <h2>Log Attivita</h2>
              <div id="activity-log" class="activity-log">
                <p style="color: #5a7a7a;">Caricamento...</p>
              </div>
            </div>
          </div>
          
          <div id="commands" class="tab-content">
            <div class="card">
              <h2>Comandi Bot</h2>
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
                container.innerHTML = '<p style="color: #5a7a7a;">Nessuna attivita recente</p>';
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
                      borderColor: '#4aba8a',
                      backgroundColor: 'rgba(74, 186, 138, 0.1)',
                      fill: true,
                      tension: 0.3
                    }]
                  },
                  options: {
                    responsive: true,
                    plugins: { legend: { labels: { color: '#8fa8a8' } } },
                    scales: {
                      x: { ticks: { color: '#5a7a7a' }, grid: { color: 'rgba(46, 204, 113, 0.1)' } },
                      y: { ticks: { color: '#5a7a7a' }, grid: { color: 'rgba(46, 204, 113, 0.1)' } }
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
                container.innerHTML = '<p style="color: #5a7a7a;">Nessun audit recente</p>';
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
                container.innerHTML = '<p style="color: #2ecc71;">Nessun evento di sicurezza - Tutto OK!</p>';
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
                      backgroundColor: 'rgba(230, 126, 34, 0.6)',
                      borderColor: '#e67e22',
                      borderWidth: 1
                    }]
                  },
                  options: {
                    responsive: true,
                    plugins: { legend: { labels: { color: '#8fa8a8' } } },
                    scales: {
                      x: { ticks: { color: '#5a7a7a' }, grid: { color: 'rgba(46, 204, 113, 0.1)' } },
                      y: { ticks: { color: '#5a7a7a' }, grid: { color: 'rgba(46, 204, 113, 0.1)' } }
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
                        borderColor: '#2ecc71',
                        backgroundColor: 'rgba(46, 204, 113, 0.1)',
                        fill: true,
                        tension: 0.3
                      },
                      {
                        label: 'Leave',
                        data: leaves,
                        borderColor: '#e74c3c',
                        backgroundColor: 'rgba(231, 76, 60, 0.1)',
                        fill: true,
                        tension: 0.3
                      }
                    ]
                  },
                  options: {
                    responsive: true,
                    plugins: { legend: { labels: { color: '#8fa8a8' } } },
                    scales: {
                      x: { ticks: { color: '#5a7a7a' }, grid: { color: 'rgba(46, 204, 113, 0.1)' } },
                      y: { ticks: { color: '#5a7a7a' }, grid: { color: 'rgba(46, 204, 113, 0.1)' } }
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
                container.innerHTML = '<p style="color: #5a7a7a;">Nessun backup salvato</p>';
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
            
            resultDiv.innerHTML = '<p style="color: #f1c40f;">⏳ Esecuzione ' + action + ' in corso...</p>';
            
            try {
              const res = await fetch('/api/action/' + action, { method: 'POST' });
              const data = await res.json();
              
              if (data.success) {
                resultDiv.innerHTML = '<div class="activity-item" style="border-left-color: #2ecc71;"><div class="time">' + new Date().toLocaleString('it-IT') + '</div><div style="color: #2ecc71;"><strong>Successo!</strong> ' + data.message + '</div></div>';
                
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
                resultDiv.innerHTML = '<div class="activity-item" style="border-left-color: #2ecc71;"><div class="time">' + new Date().toLocaleString('it-IT') + '</div><div style="color: #2ecc71;"><strong>Configurazione salvata!</strong> Soglia: ' + threshold + ' join in ' + window + ' secondi</div></div>';
              } else {
                resultDiv.innerHTML = '<div class="activity-item raid"><div class="time">' + new Date().toLocaleString('it-IT') + '</div><div>Errore: ' + (data.error || 'sconosciuto') + '</div></div>';
              }
            } catch (e) {
              console.log('Config error:', e);
            }
          }
          
          loadStatus();
          loadActivity();
          loadMetrics();
          loadExtraCharts();
          loadAudits();
          loadSecurity();
          loadBackups();
          
          setInterval(loadStatus, 30000);
          setInterval(loadActivity, 60000);
          setInterval(loadSecurity, 30000);
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
        <link rel="icon" href="https://cdn.discordapp.com/icons/1435348267268313090/a_icon.png" type="image/png">
        <style>${styles}</style>
      </head>
      <body>
        <nav class="navbar">
          <div class="brand">
            <img src="https://cdn.discordapp.com/icons/1435348267268313090/a_icon.png" alt="Oasis" onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'">
            <h1>Friday <span class="accent">Bot</span></h1>
          </div>
        </nav>
        
        <div class="hero">
          <img src="https://cdn.discordapp.com/icons/1435348267268313090/a_icon.png" alt="Oasis Gamers Hub" class="logo" onerror="this.style.display='none'">
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

app.get('/auth/discord', (req, res) => {
  const state = generateState();
  req.session.oauthState = state;
  
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
  
  if (!code || !state || state !== req.session.oauthState) {
    console.error('OAuth validation failed: invalid state or missing code');
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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server web avviato su porta ${PORT}`);
});

export default app;
