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
  checkMEE6Compatibility,
  generateTextSuggestions,
  formatTextSuggestions
} from './modules/serverAnalyzer.js';
import { 
  connectDB, 
  saveServerStats, 
  getServerStats, 
  saveAuditLog,
  saveServerSnapshot,
  getServerSnapshots,
  saveDailyMetrics,
  getTodayMetrics,
  getTrends,
  saveConfigBackup,
  getConfigBackups,
  getPendingCommands,
  updateCommandStatus,
  cleanOldCommands
} from './modules/database.js';
import {
  getCachedAudit,
  setCachedAudit,
  checkRateLimit,
  getCacheStats
} from './modules/cache.js';
import {
  setBotOnline,
  updateGuildStats,
  addActivityLog,
  setAntiRaidStatus,
  getAntiRaidStatus
} from './modules/sharedState.js';

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
  
  setBotOnline();
  await connectDB();
  
  for (const guild of client.guilds.cache.values()) {
    const savedStats = await getServerStats(guild.id);
    const todayMetrics = await getTodayMetrics(guild.id);
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const metricsDate = todayMetrics?.date ? new Date(todayMetrics.date) : null;
    const isToday = metricsDate && metricsDate.getTime() === today.getTime();
    
    serverStats.set(guild.id, {
      joinHistory: savedStats?.joinHistory || [],
      messageCount: isToday ? (todayMetrics?.messageCount || 0) : 0,
      activeChannels: new Map(Object.entries(savedStats?.activeChannels || {})),
      todayJoins: isToday ? (todayMetrics?.joinCount || 0) : 0,
      todayLeaves: isToday ? (todayMetrics?.leaveCount || 0) : 0
    });
    
    updateGuildStats(guild.id, {
      name: guild.name,
      memberCount: guild.memberCount,
      channelCount: guild.channels.cache.size,
      roleCount: guild.roles.cache.size,
      ownerId: guild.ownerId,
      icon: guild.iconURL()
    });
  }
  
  addActivityLog({
    type: 'bot_start',
    message: `Bot avviato - ${client.guilds.cache.size} server connessi`
  });
  
  setupScheduledTasks();
});

function setupScheduledTasks() {
  setInterval(async () => {
    for (const guild of client.guilds.cache.values()) {
      updateGuildStats(guild.id, {
        name: guild.name,
        memberCount: guild.memberCount,
        channelCount: guild.channels.cache.size,
        roleCount: guild.roles.cache.size,
        onlineCount: guild.approximatePresenceCount || 0
      });
    }
  }, 60000);
  
  setInterval(processPendingCommands, 5000);
  
  setInterval(cleanOldCommands, 30 * 60 * 1000);
  
  const now = new Date();
  const msUntilMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0) - now;
  
  setTimeout(() => {
    resetDailyCounters();
    setInterval(resetDailyCounters, 24 * 60 * 60 * 1000);
  }, msUntilMidnight);
  
  const msUntilSunday = ((7 - now.getDay()) % 7 || 7) * 24 * 60 * 60 * 1000 - 
    now.getHours() * 60 * 60 * 1000 - now.getMinutes() * 60 * 1000;
  
  setTimeout(() => {
    runWeeklyAudit();
    setInterval(runWeeklyAudit, 7 * 24 * 60 * 60 * 1000);
  }, msUntilSunday);
  
  console.log('Task schedulati configurati (incluso polling comandi dashboard)');
}

async function processPendingCommands() {
  for (const guild of client.guilds.cache.values()) {
    const commands = await getPendingCommands(guild.id);
    
    for (const cmd of commands) {
      try {
        await updateCommandStatus(cmd._id.toString(), 'processing');
        
        const owner = await guild.fetchOwner();
        const channel = guild.channels.cache.find(c => 
          c.isTextBased() && c.permissionsFor(guild.members.me)?.has('SendMessages')
        );
        
        let result = { success: false, message: 'Comando non riconosciuto' };
        
        switch (cmd.command) {
          case 'audit':
            if (channel) {
              await channel.send(`📊 **Audit richiesto da dashboard** (da ${cmd.requestedBy || 'Dashboard'})`);
              const structure = await analyzeServerStructure(guild);
              const security = await getSecurityReport(guild);
              const aiRecs = await getAIRecommendations(guild, structure, security);
              const report = await formatReport(guild, structure, security, aiRecs);
              
              for (const part of report) {
                await channel.send(part);
              }
              
              await saveAuditLog(guild.id, { type: 'dashboard', requestedBy: cmd.requestedBy, security: security.score });
              result = { success: true, message: 'Audit completato e inviato su Discord' };
            } else {
              result = { success: false, message: 'Nessun canale disponibile per inviare il report' };
            }
            break;
            
          case 'backup':
            const roles = guild.roles.cache.map(r => ({
              name: r.name,
              color: r.hexColor,
              position: r.position,
              permissions: r.permissions.bitfield.toString(),
              hoist: r.hoist,
              mentionable: r.mentionable
            }));
            
            const channels = guild.channels.cache.map(c => ({
              name: c.name,
              type: c.type,
              position: c.position,
              parentId: c.parentId,
              topic: c.topic || null
            }));
            
            await saveConfigBackup(guild.id, {
              guildName: guild.name,
              roles,
              channels,
              memberCount: guild.memberCount,
              requestedBy: cmd.requestedBy,
              source: 'dashboard'
            });
            
            if (channel) {
              await channel.send(`💾 **Backup completato** (richiesto da dashboard da ${cmd.requestedBy || 'utente'})`);
            }
            result = { success: true, message: `Backup salvato: ${roles.length} ruoli, ${channels.length} canali` };
            break;
            
          default:
            result = { success: false, message: `Comando '${cmd.command}' non supportato` };
        }
        
        await updateCommandStatus(cmd._id.toString(), 'completed', result);
        
        addActivityLog({
          type: 'command_executed',
          action: cmd.command,
          message: result.message,
          source: 'dashboard'
        });
        
      } catch (error) {
        console.error(`Errore esecuzione comando ${cmd.command}:`, error.message);
        await updateCommandStatus(cmd._id.toString(), 'failed', { success: false, message: error.message });
      }
    }
  }
}

async function resetDailyCounters() {
  for (const [guildId, stats] of serverStats) {
    stats.todayJoins = 0;
    stats.todayLeaves = 0;
    stats.messageCount = 0;
    stats.activeChannels = new Map();
    
    const guild = client.guilds.cache.get(guildId);
    if (guild) {
      await saveDailyMetrics(guildId, {
        memberCount: guild.memberCount,
        messageCount: 0,
        joinCount: 0,
        leaveCount: 0,
        activeChannels: 0
      });
    }
  }
  
  addActivityLog({
    type: 'system',
    message: 'Contatori giornalieri resettati a mezzanotte'
  });
  
  console.log('Contatori giornalieri resettati e persistiti');
}

async function runWeeklyAudit() {
  const oasisGuildId = process.env.OASIS_GUILD_ID;
  if (!oasisGuildId) return;
  
  const guild = client.guilds.cache.get(oasisGuildId);
  if (!guild) return;
  
  try {
    const report = await getSecurityReport(guild);
    const trends = await getTrends(guild.id);
    
    await saveAuditLog(guild.id, {
      type: 'scheduled_weekly',
      securityScore: report.securityScore,
      issuesCount: report.issues.length
    });
    
    addActivityLog({
      type: 'scheduled_audit',
      guildId: guild.id,
      message: `Audit settimanale completato - Score: ${report.securityScore}/100`
    });
    
    if (report.securityScore < 50) {
      const owner = await guild.fetchOwner();
      if (owner) {
        try {
          await owner.send(`⚠️ **Audit Settimanale Friday**\n\nIl tuo server "${guild.name}" ha un punteggio di sicurezza basso: **${report.securityScore}/100**\n\nUsa \`!audit\` nel server per vedere i dettagli.`);
        } catch (e) {
          console.log('Impossibile inviare DM al proprietario');
        }
      }
    }
  } catch (error) {
    console.error('Errore audit settimanale:', error.message);
  }
}

const joinTracker = new Map();
const RAID_THRESHOLD = 10;
const RAID_TIMEFRAME = 30000;

client.on('guildMemberAdd', async member => {
  const stats = serverStats.get(member.guild.id);
  if (stats) {
    stats.joinHistory.push({ timestamp: Date.now(), memberId: member.id });
    stats.todayJoins = (stats.todayJoins || 0) + 1;
    
    saveDailyMetrics(member.guild.id, {
      memberCount: member.guild.memberCount,
      messageCount: stats.messageCount || 0,
      joinCount: stats.todayJoins || 0,
      leaveCount: stats.todayLeaves || 0
    }).catch(err => console.error('Metrics save error:', err.message));
  }
  
  const guildId = member.guild.id;
  const now = Date.now();
  
  if (!joinTracker.has(guildId)) {
    joinTracker.set(guildId, []);
  }
  
  const recentJoins = joinTracker.get(guildId);
  recentJoins.push(now);
  
  const validJoins = recentJoins.filter(t => now - t < RAID_TIMEFRAME);
  joinTracker.set(guildId, validJoins);
  
  if (validJoins.length >= RAID_THRESHOLD) {
    const raidStatus = getAntiRaidStatus(guildId);
    
    if (!raidStatus.triggered) {
      setAntiRaidStatus(guildId, {
        enabled: true,
        triggered: true,
        triggeredAt: now,
        joinCount: validJoins.length
      });
      
      addActivityLog({
        type: 'raid_detected',
        guildId,
        message: `RAID RILEVATO! ${validJoins.length} join in ${RAID_TIMEFRAME/1000}s`
      });
      
      try {
        const owner = await member.guild.fetchOwner();
        if (owner) {
          await owner.send(`🚨 **ALERT ANTI-RAID**\n\nRilevati **${validJoins.length} join** in ${RAID_TIMEFRAME/1000} secondi nel server "${member.guild.name}"!\n\nVerifica il server immediatamente.`);
        }
      } catch (e) {
        console.log('Impossibile notificare owner per raid');
      }
      
      setTimeout(() => {
        setAntiRaidStatus(guildId, { enabled: true, triggered: false });
      }, 5 * 60 * 1000);
    }
  }
  
  await handleWelcome(member);
});

client.on('guildMemberRemove', async member => {
  const stats = serverStats.get(member.guild.id);
  if (stats) {
    stats.todayLeaves = (stats.todayLeaves || 0) + 1;
    
    saveDailyMetrics(member.guild.id, {
      memberCount: member.guild.memberCount,
      messageCount: stats.messageCount || 0,
      joinCount: stats.todayJoins || 0,
      leaveCount: stats.todayLeaves || 0
    }).catch(err => console.error('Metrics save error:', err.message));
  }
  
  addActivityLog({
    type: 'member_leave',
    guildId: member.guild.id,
    message: `${member.user.tag} ha lasciato il server`
  });
});

async function handleWelcome(member) {
  const guild = member.guild;
  const hasMee6Welcome = guild.channels.cache.some(ch => 
    ch.name.toLowerCase().includes('welcome') || 
    ch.name.toLowerCase().includes('benvenuto')
  );
  
  if (hasMee6Welcome) return;
  
  const welcomeChannel = guild.channels.cache.find(ch => 
    ch.name.toLowerCase().includes('general') || 
    ch.name.toLowerCase().includes('chat') ||
    ch.name.toLowerCase().includes('lobby')
  );
  
  if (!welcomeChannel || !welcomeChannel.isTextBased()) return;
  
  try {
    const embed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle(`👋 Benvenuto/a ${member.displayName}!`)
      .setDescription(`Siamo felici di averti in **${guild.name}**!\n\nSei il membro #${guild.memberCount}`)
      .setThumbnail(member.displayAvatarURL())
      .setTimestamp();
    
    await welcomeChannel.send({ embeds: [embed] });
    
    addActivityLog({
      type: 'welcome_sent',
      guildId: guild.id,
      message: `Welcome inviato a ${member.user.tag}`
    });
  } catch (e) {
    console.log('Errore invio welcome:', e.message);
  }
}

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  
  const stats = serverStats.get(message.guild?.id);
  if (stats) {
    stats.messageCount++;
    const channelCount = stats.activeChannels.get(message.channel.id) || 0;
    stats.activeChannels.set(message.channel.id, channelCount + 1);
    
    if (stats.messageCount % 10 === 0) {
      saveDailyMetrics(message.guild.id, {
        memberCount: message.guild.memberCount,
        messageCount: stats.messageCount,
        joinCount: stats.todayJoins || 0,
        leaveCount: stats.todayLeaves || 0,
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
        if (mee6Compat.fridayAdvantages?.length > 0) {
          embed.addFields({
            name: '🚀 Friday può gestire',
            value: mee6Compat.fridayAdvantages.join('\n')
          });
        }
      } else {
        const symbiosisLabels = {
          'excellent': '✅ Eccellente',
          'good': '🟢 Buona',
          'basic': '🟡 Base',
          'minimal': '🟠 Minima'
        };
        
        embed.addFields(
          { name: 'Simbiosi', value: symbiosisLabels[mee6Compat.symbiosis] || '❓ Sconosciuta', inline: true },
          { name: 'Punteggio', value: `${mee6Compat.score}/100`, inline: true },
          { name: 'Premium', value: mee6Compat.mee6Premium ? '👑 Sì' : '📦 Base', inline: true }
        );
        
        if (mee6Compat.detectedFeatures.length > 0) {
          embed.addFields({
            name: '🎯 Funzioni MEE6 Attive',
            value: mee6Compat.detectedFeatures.map(f => `• ${f}`).join('\n')
          });
        }
        
        if (mee6Compat.levelRoles?.length > 0) {
          embed.addFields({
            name: '🎖️ Ruoli Livello MEE6',
            value: mee6Compat.levelRoles.slice(0, 5).map(r => `${r.name} (${r.members} utenti)`).join('\n')
          });
        }
        
        if (mee6Compat.channelsUsedByMEE6.length > 0) {
          embed.addFields({
            name: '📺 Canali MEE6',
            value: mee6Compat.channelsUsedByMEE6.slice(0, 5).map(c => `#${c.name} → ${c.feature}`).join('\n')
          });
        }
        
        if (mee6Compat.recommendations?.length > 0) {
          embed.addFields({
            name: '📋 Stato Integrazione',
            value: mee6Compat.recommendations.slice(0, 6).join('\n')
          });
        }
        
        if (mee6Compat.fridayAdvantages?.length > 0) {
          embed.addFields({
            name: '🔷 Friday gestisce (esclusivo)',
            value: mee6Compat.fridayAdvantages.slice(0, 5).join('\n')
          });
        }
        
        if (mee6Compat.webhooksDetected > 0) {
          embed.addFields({
            name: '🔗 Webhook MEE6',
            value: `${mee6Compat.webhooksDetected} webhook rilevati`,
            inline: true
          });
        }
      }
      
      embed.setFooter({ text: 'Friday + MEE6 = Simbiosi perfetta!' });
      
      await loadingMsg.edit({ content: '', embeds: [embed] });
    } catch (error) {
      console.error('MEE6 check error:', error);
      await loadingMsg.edit('❌ Errore durante l\'analisi MEE6.');
    }
  }

  if (command === 'backup') {
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return message.reply('❌ Serve il permesso Amministratore.');
    }

    const loadingMsg = await message.reply('💾 Creazione backup configurazione...');
    
    try {
      const roles = message.guild.roles.cache.map(role => ({
        name: role.name,
        id: role.id,
        color: role.hexColor,
        position: role.position,
        permissions: role.permissions.toArray(),
        hoist: role.hoist,
        mentionable: role.mentionable
      }));
      
      const channels = message.guild.channels.cache.map(channel => ({
        name: channel.name,
        id: channel.id,
        type: channel.type,
        parentId: channel.parentId,
        position: channel.position,
        permissionOverwrites: channel.permissionOverwrites?.cache 
          ? Array.from(channel.permissionOverwrites.cache.values()).map(po => ({
              id: po.id,
              type: po.type,
              allow: po.allow.toArray(),
              deny: po.deny.toArray()
            }))
          : []
      }));
      
      const backup = {
        guildName: message.guild.name,
        memberCount: message.guild.memberCount,
        rolesCount: roles.length,
        channelsCount: channels.length,
        roles: roles,
        channels: channels,
        verificationLevel: message.guild.verificationLevel,
        explicitContentFilter: message.guild.explicitContentFilter
      };
      
      await saveConfigBackup(message.guild.id, backup);
      
      addActivityLog({
        type: 'backup_created',
        guildId: message.guild.id,
        message: `Backup creato: ${roles.length} ruoli, ${channels.length} canali`
      });
      
      const embed = new EmbedBuilder()
        .setTitle('💾 Backup Configurazione Creato')
        .setColor('#2ecc71')
        .addFields(
          { name: 'Ruoli Salvati', value: `${roles.length}`, inline: true },
          { name: 'Canali Salvati', value: `${channels.length}`, inline: true },
          { name: 'Membri', value: `${message.guild.memberCount}`, inline: true }
        )
        .setFooter({ text: 'Backup salvato su MongoDB - Massimo 10 backup conservati' })
        .setTimestamp();
      
      await loadingMsg.edit({ content: '', embeds: [embed] });
    } catch (error) {
      console.error('Backup error:', error);
      await loadingMsg.edit('❌ Errore durante la creazione del backup.');
    }
  }

  if (command === 'testi') {
    if (!isOwner) {
      return message.reply('❌ Solo il proprietario del server può usare questo comando.');
    }
    
    const rateCheck = checkRateLimit(message.guild.id, 'testi');
    if (!rateCheck.allowed) {
      return message.reply(`⏱️ Comando in cooldown. Riprova tra ${rateCheck.remaining} secondi.`);
    }
    
    const loadingMsg = await message.reply('✍️ Generando suggerimenti testo AI... (15-20 secondi)');
    
    try {
      const structure = await analyzeServerStructure(message.guild);
      const textSuggestions = await generateTextSuggestions(message.guild, structure);
      const formattedText = formatTextSuggestions(textSuggestions);
      
      if (formattedText.length > 2000) {
        const parts = formattedText.match(/[\s\S]{1,1900}/g) || [formattedText];
        await loadingMsg.edit(parts[0]);
        for (let i = 1; i < parts.length; i++) {
          await message.channel.send(parts[i]);
        }
      } else {
        await loadingMsg.edit(formattedText);
      }
      
      addActivityLog({
        type: 'text_suggestions',
        guildId: message.guild.id,
        message: `Suggerimenti testo generati per ${message.guild.name}`
      });
    } catch (error) {
      console.error('Text suggestions error:', error);
      await loadingMsg.edit('❌ Errore nella generazione dei suggerimenti testo.');
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
        { name: '!backup', value: 'Backup configurazione', inline: true },
        { name: '!testi', value: 'Suggerimenti testo AI', inline: true },
        { name: '!fix <azione>', value: 'Applica correzioni', inline: true }
      )
      .setFooter({ text: 'Friday + MEE6 = Simbiosi perfetta!' });

    await message.reply({ embeds: [embed] });
  }
});

export { client, serverStats };

console.log('Avvio del bot Discord...');
client.login(process.env.DISCORD_BOT_TOKEN);
