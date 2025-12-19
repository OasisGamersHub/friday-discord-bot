import { Client, GatewayIntentBits } from 'discord.js';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

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

console.log('Avvio del bot Discord...');
client.login(process.env.DISCORD_BOT_TOKEN);
