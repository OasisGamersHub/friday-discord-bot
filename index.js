import { Client, GatewayIntentBits, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { 
  analyzeServerStructure, 
  checkAgeSeparation, 
  getSecurityReport, 
  getAIRecommendations,
  executeAction,
  formatReport 
} from './modules/serverAnalyzer.js';
import { connectDB, saveServerStats, getServerStats, saveAuditLog } from './modules/database.js';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

const serverStats = new Map();

client.once('ready', async () => {
  console.log(`Bot connesso come ${client.user.tag}!`);
  console.log(`Presente in ${client.guilds.cache.size} server`);
  
  await connectDB();
  
  for (const guild of client.guilds.cache.values()) {
    const savedStats = await getServerStats(guild.id);
    serverStats.set(guild.id, {
      joinHistory: savedStats?.joinHistory || [],
      messageCount: savedStats?.messageCount || 0,
      activeChannels: new Map(Object.entries(savedStats?.activeChannels || {}))
    });
  }
});

client.on('guildMemberAdd', member => {
  const stats = serverStats.get(member.guild.id);
  if (stats) {
    stats.joinHistory.push({ timestamp: Date.now(), memberId: member.id });
  }
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  
  const stats = serverStats.get(message.guild?.id);
  if (stats) {
    stats.messageCount++;
    const channelCount = stats.activeChannels.get(message.channel.id) || 0;
    stats.activeChannels.set(message.channel.id, channelCount + 1);
  }

  const prefix = '!';
  if (!message.content.startsWith(prefix)) return;

  const args = message.content.slice(prefix.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  if (command === 'ping') {
    await message.reply('Pong! 🏓');
  }

  if (command === 'info') {
    await message.reply(`Server: ${message.guild.name}\nMembri: ${message.guild.memberCount}`);
  }

  if (command === 'audit') {
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return message.reply('❌ Serve il permesso Amministratore per usare questo comando.');
    }

    const loadingMsg = await message.reply('🔍 Analisi del server in corso...');
    
    try {
      const report = await getSecurityReport(message.guild);
      const aiRecommendations = await getAIRecommendations(report, message.guild);
      
      const formattedReport = formatReport(report, aiRecommendations);
      
      if (formattedReport.length > 2000) {
        const chunks = formattedReport.match(/[\s\S]{1,1900}/g);
        await loadingMsg.edit(chunks[0]);
        for (let i = 1; i < chunks.length; i++) {
          await message.channel.send(chunks[i]);
        }
      } else {
        await loadingMsg.edit(formattedReport);
      }
      
      global.lastAuditReport = { report, aiRecommendations, guildId: message.guild.id };
      
      await saveAuditLog(message.guild.id, { 
        score: report.score, 
        issues: report.securityIssues.length,
        ageSeparation: report.ageSeparation.configured 
      });
      
    } catch (error) {
      console.error('Audit error:', error);
      await loadingMsg.edit('❌ Errore durante l\'analisi. Riprova più tardi.');
    }
  }

  if (command === 'security') {
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return message.reply('❌ Serve il permesso Amministratore.');
    }

    const report = await getSecurityReport(message.guild);
    
    const embed = new EmbedBuilder()
      .setTitle('🔒 Report Sicurezza')
      .setColor(report.score >= 80 ? '#2ecc71' : report.score >= 50 ? '#f1c40f' : '#e74c3c')
      .addFields(
        { name: 'Punteggio', value: `${report.score}/100`, inline: true },
        { name: 'Problemi', value: `${report.securityIssues.length}`, inline: true },
        { name: 'Separazione Età', value: report.ageSeparation.configured ? '✅ Configurata' : '❌ Non configurata', inline: true }
      );

    if (report.securityIssues.length > 0) {
      embed.addFields({
        name: '⚠️ Problemi Rilevati',
        value: report.securityIssues.slice(0, 5).map(i => `• ${i.message}`).join('\n')
      });
    }

    await message.reply({ embeds: [embed] });
  }

  if (command === 'age') {
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return message.reply('❌ Serve il permesso Amministratore.');
    }

    const ageReport = await checkAgeSeparation(message.guild);
    
    const embed = new EmbedBuilder()
      .setTitle('👥 Separazione Fasce d\'Età')
      .setColor(ageReport.issues.length === 0 ? '#2ecc71' : '#e74c3c');

    if (ageReport.configured) {
      embed.addFields(
        { name: 'Ruoli Minorenni', value: ageReport.minorRoles.join(', ') || 'Nessuno', inline: true },
        { name: 'Ruoli Adulti', value: ageReport.adultRoles.join(', ') || 'Nessuno', inline: true }
      );
    } else {
      embed.setDescription('⚠️ La separazione per età non è configurata.\nUsa `!fix createAgeRoles` per creare i ruoli automaticamente.');
    }

    if (ageReport.issues.length > 0) {
      embed.addFields({
        name: '🔴 Problemi Critici',
        value: ageReport.issues.map(i => `• ${i.message}`).join('\n')
      });
    }

    if (ageReport.recommendations.length > 0) {
      embed.addFields({
        name: '💡 Raccomandazioni',
        value: ageReport.recommendations.map(r => `• ${r.message}`).join('\n')
      });
    }

    await message.reply({ embeds: [embed] });
  }

  if (command === 'fix') {
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return message.reply('❌ Serve il permesso Amministratore.');
    }

    const action = args[0];
    const channelId = args[1];

    if (!action) {
      return message.reply(`**Azioni disponibili:**
\`!fix createAgeRoles\` - Crea ruoli Under18 e Over18
\`!fix blockMinorsFromNSFW <channelId>\` - Blocca minorenni da canale NSFW
\`!fix increaseVerification\` - Aumenta livello verifica
\`!fix disableEveryoneInvites\` - Disabilita inviti per @everyone`);
    }

    const loadingMsg = await message.reply(`⏳ Esecuzione: ${action}...`);
    
    const result = await executeAction(message.guild, action, { channelId });
    
    if (result.success) {
      await loadingMsg.edit(`✅ ${result.message}`);
    } else {
      await loadingMsg.edit(`❌ ${result.message}`);
    }
  }

  if (command === 'stats') {
    const stats = serverStats.get(message.guild.id);
    
    const recentJoins = stats?.joinHistory.filter(j => 
      Date.now() - j.timestamp < 7 * 24 * 60 * 60 * 1000
    ).length || 0;

    const topChannels = stats?.activeChannels 
      ? [...stats.activeChannels.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([id, count]) => `<#${id}>: ${count} messaggi`)
      : [];

    const embed = new EmbedBuilder()
      .setTitle('📈 Statistiche Server')
      .setColor('#3498db')
      .addFields(
        { name: 'Membri Totali', value: `${message.guild.memberCount}`, inline: true },
        { name: 'Nuovi (7gg)', value: `${recentJoins}`, inline: true },
        { name: 'Messaggi Sessione', value: `${stats?.messageCount || 0}`, inline: true }
      );

    if (topChannels.length > 0) {
      embed.addFields({
        name: '🔥 Canali Più Attivi',
        value: topChannels.join('\n')
      });
    }

    await message.reply({ embeds: [embed] });
  }

  if (command === 'help') {
    const embed = new EmbedBuilder()
      .setTitle('📋 Comandi Disponibili')
      .setColor('#5865f2')
      .addFields(
        { name: '!ping', value: 'Test connessione', inline: true },
        { name: '!info', value: 'Info server', inline: true },
        { name: '!stats', value: 'Statistiche', inline: true },
        { name: '!audit', value: 'Analisi completa con AI', inline: true },
        { name: '!security', value: 'Report sicurezza', inline: true },
        { name: '!age', value: 'Controllo separazione età', inline: true },
        { name: '!fix <azione>', value: 'Applica correzioni', inline: true }
      )
      .setFooter({ text: 'Usa !fix senza argomenti per vedere le azioni disponibili' });

    await message.reply({ embeds: [embed] });
  }
});

export { client, serverStats };

console.log('Avvio del bot Discord...');
client.login(process.env.DISCORD_BOT_TOKEN);
