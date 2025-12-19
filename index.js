import { Client, GatewayIntentBits } from 'discord.js';

let connectionSettings = null;

async function getAccessToken() {
  if (connectionSettings && connectionSettings.settings.expires_at && new Date(connectionSettings.settings.expires_at).getTime() > Date.now()) {
    return connectionSettings.settings.access_token;
  }
  
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY 
    ? 'repl ' + process.env.REPL_IDENTITY 
    : process.env.WEB_REPL_RENEWAL 
    ? 'depl ' + process.env.WEB_REPL_RENEWAL 
    : null;

  if (!xReplitToken) {
    throw new Error('X_REPLIT_TOKEN not found for repl/depl');
  }

  connectionSettings = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=discord',
    {
      headers: {
        'Accept': 'application/json',
        'X_REPLIT_TOKEN': xReplitToken
      }
    }
  ).then(res => res.json()).then(data => data.items?.[0]);

  const accessToken = connectionSettings?.settings?.access_token || connectionSettings.settings?.oauth?.credentials?.access_token;

  if (!connectionSettings || !accessToken) {
    throw new Error('Discord not connected');
  }
  return accessToken;
}

async function getDiscordClient() {
  const token = await getAccessToken();

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMembers
    ]
  });

  await client.login(token);
  return client;
}

async function main() {
  console.log('Avvio del bot Discord...');
  
  try {
    const client = await getDiscordClient();
    
    client.once('ready', () => {
      console.log(`Bot connesso come ${client.user.tag}!`);
      console.log(`Presente in ${client.guilds.cache.size} server`);
    });

    client.on('messageCreate', async (message) => {
      if (message.author.bot) return;
      
      if (message.content === '!ping') {
        await message.reply('Pong! 🏓');
      }
      
      if (message.content === '!info') {
        await message.reply(`Server: ${message.guild.name}\nMembri: ${message.guild.memberCount}`);
      }
    });

  } catch (error) {
    console.error('Errore durante l\'avvio del bot:', error);
    process.exit(1);
  }
}

main();
