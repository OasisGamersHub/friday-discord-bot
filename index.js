import { Client, GatewayIntentBits, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { 
  analyzeServerStructure, 
  checkAgeSeparation, 
  getSecurityReport, 
  getAIRecommendations,
  executeAction,
  formatReport,
  generateServerSchema,
  findExistingAgeRoles,
  checkMEE6Compatibility
} from './modules/serverAnalyzer.js';
import { 
  connectDB, 
  saveServerStats, 
  getServerStats, 
  saveAuditLog,
  saveServerSnapshot,
  getServerSnapshots,
  saveDailyMetrics,
  getTrends
} from './modules/database.js';
import {
  getCachedAudit,
  setCachedAudit,
  checkRateLimit,
  getCacheStats
} from './modules/cache.js';

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
    
    if (stats.messageCount % 100 === 0) {
      saveDailyMetrics(message.guild.id, {
        memberCount: message.guild.memberCount,
        messageCount: stats.messageCount,
        activeChannels: stats.activeChannels.size
      }).catch(err => console.error('Metrics save error:', err.message));
    }
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

    const rateCheck = checkRateLimit(message.guild.id, 'audit');
    if (!rateCheck.allowed) {
      return message.reply(`⏳ Comando in cooldown. Riprova tra ${rateCheck.remaining} secondi.\n💡 *Usa la cache per risparmiare risorse!*`);
    }

    const cached = getCachedAudit(message.guild.id);
    if (cached && !args.includes('--force')) {
      const cacheAge = Math.round((Date.now() - cached.timestamp) / 60000);
      await message.reply(`📋 **Report dalla cache** (${cacheAge} min fa)\n*Usa \`!audit --force\` per nuova analisi*\n\n${cached.report.slice(0, 1900)}`);
      return;
    }

    const loadingMsg = await message.reply('🔍 Analisi del server in corso...');
    
    try {
      const report = await getSecurityReport(message.guild);
      const trends = await getTrends(message.guild.id);
      const mee6Compat = await checkMEE6Compatibility(message.guild);
      const aiRecommendations = await getAIRecommendations(report, message.guild, trends);
      
      const formattedReport = formatReport(report, aiRecommendations, mee6Compat);
      
      setCachedAudit(message.guild.id, { 
        report: formattedReport, 
        timestamp: Date.now(),
        score: report.score
      });
      
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

  if (command === 'schema') {
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return message.reply('❌ Serve il permesso Amministratore.');
    }

    const loadingMsg = await message.reply('🗺️ Generazione schema server...');
    
    try {
      const structure = await analyzeServerStructure(message.guild);
      const schema = generateServerSchema(structure);
      
      await saveServerSnapshot(message.guild.id, {
        memberCount: structure.memberCount,
        categories: structure.categories.length,
        textChannels: structure.textChannels.length,
        voiceChannels: structure.voiceChannels.length,
        roles: structure.roles.length
      });
      
      if (schema.length > 2000) {
        const chunks = schema.match(/[\s\S]{1,1900}/g);
        await loadingMsg.edit(chunks[0]);
        for (let i = 1; i < chunks.length; i++) {
          await message.channel.send(chunks[i]);
        }
      } else {
        await loadingMsg.edit(schema);
      }
    } catch (error) {
      console.error('Schema error:', error);
      await loadingMsg.edit('❌ Errore durante la generazione dello schema.');
    }
  }

  if (command === 'trend' || command === 'trends') {
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return message.reply('❌ Serve il permesso Amministratore.');
    }

    const trends = await getTrends(message.guild.id);
    const snapshots = await getServerSnapshots(message.guild.id, 5);
    
    const embed = new EmbedBuilder()
      .setTitle('📈 Trend e Andamento Community')
      .setColor('#3498db');

    if (trends) {
      const memberEmoji = parseFloat(trends.memberTrend) >= 0 ? '📈' : '📉';
      const msgEmoji = parseFloat(trends.messageTrend) >= 0 ? '📈' : '📉';
      
      embed.addFields(
        { name: `${memberEmoji} Crescita Membri`, value: `${trends.memberTrend}% (ultimi 14 giorni)`, inline: true },
        { name: `${msgEmoji} Trend Messaggi`, value: `${trends.messageTrend}%`, inline: true },
        { name: '📊 Dati Raccolti', value: `${trends.dataPoints} giorni`, inline: true }
      );
    } else {
      embed.setDescription('⏳ Dati insufficienti per calcolare i trend.\nContinua ad usare il bot per raccogliere metriche!');
    }

    if (snapshots.length > 0) {
      const latest = snapshots[0];
      const oldest = snapshots[snapshots.length - 1];
      
      if (snapshots.length > 1) {
        const memberChange = latest.memberCount - oldest.memberCount;
        const channelChange = (latest.textChannels + latest.voiceChannels) - (oldest.textChannels + oldest.voiceChannels);
        
        embed.addFields({
          name: '📸 Confronto Snapshot',
          value: `Membri: ${memberChange >= 0 ? '+' : ''}${memberChange}\nCanali: ${channelChange >= 0 ? '+' : ''}${channelChange}\n(${snapshots.length} snapshot salvati)`
        });
      }
    }

    embed.setFooter({ text: 'Usa !audit per analisi AI con suggerimenti scalabili' });
    
    await message.reply({ embeds: [embed] });
  }

  if (command === 'mee6') {
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return message.reply('❌ Serve il permesso Amministratore.');
    }

    const rateCheck = checkRateLimit(message.guild.id, 'mee6');
    if (!rateCheck.allowed) {
      return message.reply(`⏳ Comando in cooldown. Riprova tra ${rateCheck.remaining} secondi.`);
    }

    const loadingMsg = await message.reply('🔍 Analisi compatibilità MEE6...');
    
    try {
      const mee6Compat = await checkMEE6Compatibility(message.guild);
      
      const embed = new EmbedBuilder()
        .setTitle('🤖 Compatibilità MEE6')
        .setColor(mee6Compat.mee6Present ? (mee6Compat.symbiosis === 'excellent' ? '#2ecc71' : '#f1c40f') : '#3498db');

      if (!mee6Compat.mee6Present) {
        embed.setDescription('MEE6 non è presente in questo server.\nFriday può gestire tutte le funzionalità autonomamente.');
      } else {
        embed.addFields(
          { name: 'Stato Simbiosi', value: `${mee6Compat.symbiosis === 'excellent' ? '✅ Eccellente' : mee6Compat.symbiosis === 'good' ? '🟡 Buona' : '⚠️ Da verificare'}`, inline: true },
          { name: 'Punteggio', value: `${mee6Compat.score}/100`, inline: true },
          { name: 'Ruolo MEE6', value: mee6Compat.mee6Role, inline: true }
        );
        
        if (mee6Compat.detectedFeatures.length > 0) {
          embed.addFields({
            name: '🎯 Funzioni MEE6 Rilevate',
            value: mee6Compat.detectedFeatures.map(f => `• ${f}`).join('\n')
          });
        }
        
        if (mee6Compat.channelsUsedByMEE6.length > 0) {
          embed.addFields({
            name: '📺 Canali MEE6',
            value: mee6Compat.channelsUsedByMEE6.slice(0, 5).map(c => `#${c.name} (${c.feature})`).join('\n')
          });
        }
        
        embed.addFields({
          name: '📋 Raccomandazioni',
          value: mee6Compat.recommendations.slice(0, 4).join('\n')
        });
        
        if (mee6Compat.conflicts.length > 0) {
          embed.addFields({
            name: '⚠️ Note',
            value: mee6Compat.conflicts.map(c => `• ${c.message}`).join('\n')
          });
        }
      }
      
      embed.setFooter({ text: 'Friday si integra perfettamente con MEE6 Premium!' });
      
      await loadingMsg.edit({ content: '', embeds: [embed] });
    } catch (error) {
      console.error('MEE6 check error:', error);
      await loadingMsg.edit('❌ Errore durante l\'analisi MEE6.');
    }
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
        { name: '!schema', value: 'Mappa struttura server', inline: true },
        { name: '!trend', value: 'Andamento e crescita', inline: true },
        { name: '!mee6', value: 'Check compatibilità MEE6', inline: true },
        { name: '!fix <azione>', value: 'Applica correzioni', inline: true }
      )
      .setFooter({ text: 'Friday + MEE6 = Simbiosi perfetta!' });

    await message.reply({ embeds: [embed] });
  }
});

export { client, serverStats };

console.log('Avvio del bot Discord...');
client.login(process.env.DISCORD_BOT_TOKEN);
