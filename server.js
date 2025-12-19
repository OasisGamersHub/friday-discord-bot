import express from 'express';
import session from 'express-session';
import cookieParser from 'cookie-parser';
import crypto from 'crypto';

const app = express();
const PORT = 5000;

const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const isProduction = !!process.env.DASHBOARD_URL;
const REDIRECT_URI = process.env.DASHBOARD_URL 
  ? `${process.env.DASHBOARD_URL}/auth/discord/callback`
  : `https://${process.env.REPLIT_DEV_DOMAIN}/auth/discord/callback`;

const ALLOWED_GUILD_ID = process.env.OASIS_GUILD_ID || null;

app.set('trust proxy', 1);
app.use(cookieParser());
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'discord-oauth-fallback-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: isProduction,
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000 
  }
}));

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
        <style>${styles}</style>
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
          <div class="card">
            <h2>Benvenuto, ${req.session.user.username}!</h2>
            <p style="color: #8fa8a8; margin-bottom: 24px; line-height: 1.6;">Gestisci <strong style="color: #4aba8a;">Oasis Gamers Hub</strong> con strumenti avanzati di analisi, sicurezza e intelligenza artificiale.</p>
            
            <div class="grid">
              <div class="stat-box">
                <div class="value">Friday</div>
                <div class="label">Bot Connesso</div>
              </div>
              <div class="stat-box">
                <div class="value" style="color: #2ecc71;">Online</div>
                <div class="label">Stato Bot</div>
              </div>
              <div class="stat-box">
                <div class="value">10</div>
                <div class="label">Comandi Disponibili</div>
              </div>
            </div>
          </div>

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
              <div class="command-item"><code>!info</code><span>Informazioni server</span></div>
              <div class="command-item"><code>!help</code><span>Lista tutti i comandi</span></div>
            </div>
          </div>

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
            </div>
          </div>
          
          <div class="footer">
            <p>Friday Bot per <strong>Oasis Gamers Hub</strong> | Sviluppato con ❤️</p>
          </div>
        </div>
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
