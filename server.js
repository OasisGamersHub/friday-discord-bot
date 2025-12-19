import express from 'express';
import session from 'express-session';
import cookieParser from 'cookie-parser';

const app = express();
const PORT = 5000;

const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const REDIRECT_URI = `https://${process.env.REPLIT_DEV_DOMAIN}/auth/discord/callback`;

app.use(cookieParser());
app.use(session({
  secret: process.env.SESSION_SECRET || 'discord-oauth-fallback-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

app.get('/', (req, res) => {
  if (req.session.user) {
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Discord Community Bot</title>
        <style>
          body { font-family: Arial, sans-serif; background: #36393f; color: white; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
          .container { text-align: center; background: #2f3136; padding: 40px; border-radius: 10px; }
          .avatar { width: 100px; height: 100px; border-radius: 50%; margin-bottom: 20px; }
          .username { font-size: 24px; margin-bottom: 10px; }
          .logout { background: #ed4245; color: white; border: none; padding: 10px 20px; border-radius: 5px; cursor: pointer; text-decoration: none; display: inline-block; margin-top: 20px; }
          .logout:hover { background: #c73e41; }
        </style>
      </head>
      <body>
        <div class="container">
          <img src="https://cdn.discordapp.com/avatars/${req.session.user.id}/${req.session.user.avatar}.png" class="avatar" alt="Avatar">
          <div class="username">Benvenuto, ${req.session.user.username}!</div>
          <div>Email: ${req.session.user.email || 'Non disponibile'}</div>
          <a href="/logout" class="logout">Logout</a>
        </div>
      </body>
      </html>
    `);
  } else {
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Discord Community Bot - Login</title>
        <style>
          body { font-family: Arial, sans-serif; background: #36393f; color: white; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
          .container { text-align: center; background: #2f3136; padding: 40px; border-radius: 10px; }
          h1 { margin-bottom: 30px; }
          .login-btn { background: #5865f2; color: white; border: none; padding: 15px 30px; border-radius: 5px; cursor: pointer; text-decoration: none; font-size: 16px; display: inline-block; }
          .login-btn:hover { background: #4752c4; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Discord Community Bot</h1>
          <a href="/auth/discord" class="login-btn">Login con Discord</a>
        </div>
      </body>
      </html>
    `);
  }
});

app.get('/auth/discord', (req, res) => {
  const params = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: 'identify email guilds'
  });
  res.redirect(`https://discord.com/api/oauth2/authorize?${params}`);
});

app.get('/auth/discord/callback', async (req, res) => {
  const { code } = req.query;
  
  if (!code) {
    return res.redirect('/');
  }

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
    
    req.session.user = userData;
    req.session.accessToken = tokenData.access_token;
    
    console.log(`Utente loggato: ${userData.username}#${userData.discriminator}`);
    
    res.redirect('/');
  } catch (error) {
    console.error('OAuth error:', error);
    res.redirect('/');
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server web avviato su porta ${PORT}`);
});

export default app;
