import express from 'express';
import session from 'express-session';
import cookieParser from 'cookie-parser';
import crypto from 'crypto';

const app = express();
const PORT = 5000;

const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const REDIRECT_URI = process.env.DASHBOARD_URL 
  ? `${process.env.DASHBOARD_URL}/auth/discord/callback`
  : `https://${process.env.REPLIT_DEV_DOMAIN}/auth/discord/callback`;

const ALLOWED_GUILD_ID = process.env.OASIS_GUILD_ID || null;

app.use(cookieParser());
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'discord-oauth-fallback-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

app.set('Cache-Control', 'no-cache');

const styles = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; background: #1a1a2e; color: #eee; min-height: 100vh; }
  .navbar { background: #16213e; padding: 15px 30px; display: flex; justify-content: space-between; align-items: center; }
  .navbar h1 { color: #5865f2; font-size: 1.5rem; }
  .navbar a { color: #eee; text-decoration: none; margin-left: 20px; }
  .navbar a:hover { color: #5865f2; }
  .container { max-width: 1200px; margin: 0 auto; padding: 30px; }
  .card { background: #16213e; border-radius: 12px; padding: 25px; margin-bottom: 20px; }
  .card h2 { color: #5865f2; margin-bottom: 15px; font-size: 1.3rem; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px; }
  .stat-box { background: #0f3460; border-radius: 10px; padding: 20px; text-align: center; }
  .stat-box .value { font-size: 2.5rem; font-weight: bold; color: #5865f2; }
  .stat-box .label { color: #aaa; margin-top: 5px; }
  .btn { display: inline-block; padding: 12px 25px; border-radius: 8px; text-decoration: none; font-weight: 600; cursor: pointer; border: none; }
  .btn-primary { background: #5865f2; color: white; }
  .btn-primary:hover { background: #4752c4; }
  .btn-danger { background: #ed4245; color: white; }
  .btn-danger:hover { background: #c73e41; }
  .user-info { display: flex; align-items: center; gap: 15px; }
  .user-info img { width: 50px; height: 50px; border-radius: 50%; }
  .progress-bar { background: #0f3460; border-radius: 10px; height: 20px; overflow: hidden; margin-top: 10px; }
  .progress-fill { height: 100%; transition: width 0.3s; }
  .progress-fill.green { background: #2ecc71; }
  .progress-fill.yellow { background: #f1c40f; }
  .progress-fill.red { background: #e74c3c; }
  .issue-list { list-style: none; }
  .issue-list li { padding: 10px; margin: 5px 0; border-radius: 5px; }
  .issue-list li.critical { background: rgba(231, 76, 60, 0.2); border-left: 4px solid #e74c3c; }
  .issue-list li.high { background: rgba(241, 196, 15, 0.2); border-left: 4px solid #f1c40f; }
  .issue-list li.medium { background: rgba(52, 152, 219, 0.2); border-left: 4px solid #3498db; }
  .guilds-list { display: flex; flex-wrap: wrap; gap: 15px; margin-top: 15px; }
  .guild-card { background: #0f3460; padding: 15px; border-radius: 10px; display: flex; align-items: center; gap: 10px; }
  .guild-card img { width: 40px; height: 40px; border-radius: 50%; }
  .hero { text-align: center; padding: 60px 20px; }
  .hero h1 { font-size: 2.5rem; margin-bottom: 20px; }
  .hero p { color: #aaa; margin-bottom: 30px; font-size: 1.1rem; }
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
        <title>Discord Community Bot - Dashboard</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>${styles}</style>
      </head>
      <body>
        <nav class="navbar">
          <h1>Community Bot Dashboard</h1>
          <div class="user-info">
            <img src="${avatarUrl}" alt="Avatar">
            <span>${req.session.user.username}</span>
            <a href="/logout" class="btn btn-danger">Logout</a>
          </div>
        </nav>
        
        <div class="container">
          <div class="card">
            <h2>Benvenuto, ${req.session.user.username}!</h2>
            <p style="color: #aaa; margin-bottom: 20px;">Gestisci il tuo server Discord community con strumenti avanzati di analisi e sicurezza.</p>
            
            <div class="grid">
              <div class="stat-box">
                <div class="value">Friday</div>
                <div class="label">Bot Connesso</div>
              </div>
              <div class="stat-box">
                <div class="value">Online</div>
                <div class="label">Stato Bot</div>
              </div>
              <div class="stat-box">
                <div class="value">9</div>
                <div class="label">Comandi Disponibili</div>
              </div>
            </div>
          </div>

          <div class="card">
            <h2>Comandi Bot</h2>
            <div class="grid">
              <div class="stat-box">
                <div class="value">!audit</div>
                <div class="label">Analisi completa con AI (3 fasi)</div>
              </div>
              <div class="stat-box">
                <div class="value">!security</div>
                <div class="label">Report sicurezza e permessi</div>
              </div>
              <div class="stat-box">
                <div class="value">!age</div>
                <div class="label">Controllo separazione fasce d'eta</div>
              </div>
              <div class="stat-box">
                <div class="value">!schema</div>
                <div class="label">Mappa struttura server</div>
              </div>
              <div class="stat-box">
                <div class="value">!trend</div>
                <div class="label">Andamento e crescita community</div>
              </div>
              <div class="stat-box">
                <div class="value">!fix</div>
                <div class="label">Applica correzioni automatiche</div>
              </div>
              <div class="stat-box">
                <div class="value">!stats</div>
                <div class="label">Statistiche del server</div>
              </div>
              <div class="stat-box">
                <div class="value">!help</div>
                <div class="label">Lista tutti i comandi</div>
              </div>
            </div>
          </div>

          <div class="card">
            <h2>Funzionalita</h2>
            <ul style="list-style: none; line-height: 2;">
              <li>Analisi struttura server (canali, ruoli, permessi)</li>
              <li>Controllo sicurezza e rilevamento problemi</li>
              <li>Separazione automatica fasce d'eta (minorenni/adulti)</li>
              <li>Suggerimenti AI per migliorare la community</li>
              <li>Azioni automatiche per correggere problemi</li>
              <li>Statistiche crescita e engagement</li>
              <li>Best practices per community scalabili</li>
            </ul>
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
        <title>Discord Community Bot</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>${styles}</style>
      </head>
      <body>
        <nav class="navbar">
          <h1>Community Bot</h1>
        </nav>
        
        <div class="hero">
          <h1>Discord Community Bot</h1>
          <p>Analizza, proteggi e fai crescere la tua community Discord con intelligenza artificiale</p>
          <a href="/auth/discord" class="btn btn-primary">Login con Discord</a>
        </div>

        <div class="container">
          <div class="grid">
            <div class="card">
              <h2>Analisi Struttura</h2>
              <p style="color: #aaa;">Scansiona automaticamente canali, ruoli e permessi del tuo server.</p>
            </div>
            <div class="card">
              <h2>Sicurezza Avanzata</h2>
              <p style="color: #aaa;">Identifica vulnerabilita e problemi di sicurezza nei permessi.</p>
            </div>
            <div class="card">
              <h2>Protezione Eta</h2>
              <p style="color: #aaa;">Assicura che minorenni e adulti non accedano agli stessi contenuti sensibili.</p>
            </div>
            <div class="card">
              <h2>Suggerimenti AI</h2>
              <p style="color: #aaa;">Ricevi consigli intelligenti per far crescere la tua community.</p>
            </div>
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
