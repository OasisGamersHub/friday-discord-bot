import { PermissionFlagsBits, ChannelType } from 'discord.js';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

const AGE_ROLES = {
  minors: ['minore', 'under18', 'minorenne', '-18', 'teen', 'giovane', 'under 18', 'minorenni', 'ragazzo', 'ragazza'],
  adults: ['adulto', 'over18', 'maggiorenne', '+18', '18+', 'adult', 'nsfw', 'over 18', 'adulti', 'mature']
};

const MEE6_BOT_ID = '159985870458322944';

const MEE6_FEATURES = {
  leveling: ['livello', 'level', 'xp', 'rank', 'classifica', 'leaderboard', 'lvl'],
  welcome: ['benvenuto', 'welcome', 'arrivals', 'arrivi', 'join', 'nuovo', 'nuovi'],
  moderation: ['mod-log', 'modlog', 'logs', 'warns', 'mute', 'sanzioni', 'ban-log'],
  reactionRoles: ['reaction-role', 'ruoli', 'roles', 'self-assign', 'auto-ruoli', 'ottieni-ruoli'],
  captcha: ['verifica', 'verify', 'captcha', 'gate', 'ingresso'],
  streaming: ['twitch', 'youtube', 'live', 'streaming', 'notifiche-live']
};

const MEE6_ROLE_PATTERNS = [
  /^level\s*\d+$/i,
  /^lvl\s*\d+$/i,
  /^livello\s*\d+$/i,
  /mee6/i,
  /^tier\s*\d+$/i,
  /^\d+\s*(xp|level|lvl)$/i
];

export function findExistingAgeRoles(guild) {
  const roles = guild.roles.cache;
  let minorRole = null;
  let adultRole = null;
  
  roles.forEach(role => {
    const lowerName = role.name.toLowerCase();
    if (!minorRole && AGE_ROLES.minors.some(tag => lowerName.includes(tag))) {
      minorRole = role;
    }
    if (!adultRole && AGE_ROLES.adults.some(tag => lowerName.includes(tag))) {
      adultRole = role;
    }
  });
  
  return { minorRole, adultRole };
}

export async function analyzeServerStructure(guild) {
  const channels = guild.channels.cache;
  const roles = guild.roles.cache;

  const structure = {
    name: guild.name,
    memberCount: guild.memberCount,
    categories: [],
    textChannels: [],
    voiceChannels: [],
    roles: [],
    permissions: [],
    securityIssues: [],
    ageSegregation: { configured: false, issues: [] }
  };

  channels.forEach(channel => {
    if (channel.type === ChannelType.GuildCategory) {
      structure.categories.push({ id: channel.id, name: channel.name, position: channel.position });
    } else if (channel.type === ChannelType.GuildText) {
      structure.textChannels.push({ 
        id: channel.id, 
        name: channel.name, 
        category: channel.parent?.name || 'Nessuna',
        nsfw: channel.nsfw 
      });
    } else if (channel.type === ChannelType.GuildVoice) {
      structure.voiceChannels.push({ 
        id: channel.id, 
        name: channel.name, 
        category: channel.parent?.name || 'Nessuna' 
      });
    }
  });

  roles.forEach(role => {
    const dangerousPerms = [];
    if (role.permissions.has(PermissionFlagsBits.Administrator)) dangerousPerms.push('Administrator');
    if (role.permissions.has(PermissionFlagsBits.ManageGuild)) dangerousPerms.push('ManageGuild');
    if (role.permissions.has(PermissionFlagsBits.ManageRoles)) dangerousPerms.push('ManageRoles');
    if (role.permissions.has(PermissionFlagsBits.ManageChannels)) dangerousPerms.push('ManageChannels');
    if (role.permissions.has(PermissionFlagsBits.BanMembers)) dangerousPerms.push('BanMembers');
    if (role.permissions.has(PermissionFlagsBits.KickMembers)) dangerousPerms.push('KickMembers');
    if (role.permissions.has(PermissionFlagsBits.MentionEveryone)) dangerousPerms.push('MentionEveryone');

    structure.roles.push({
      id: role.id,
      name: role.name,
      color: role.hexColor,
      position: role.position,
      memberCount: role.members.size,
      dangerousPerms,
      isEveryone: role.id === guild.id
    });

    if (role.id === guild.id && dangerousPerms.length > 0) {
      structure.securityIssues.push({
        type: 'DANGEROUS_EVERYONE_PERMS',
        severity: 'HIGH',
        message: `Il ruolo @everyone ha permessi pericolosi: ${dangerousPerms.join(', ')}`
      });
    }
  });

  return structure;
}

export async function checkAgeSeparation(guild) {
  const roles = guild.roles.cache;
  const channels = guild.channels.cache;
  
  let minorRoles = [];
  let adultRoles = [];
  
  roles.forEach(role => {
    const lowerName = role.name.toLowerCase();
    if (AGE_ROLES.minors.some(tag => lowerName.includes(tag))) {
      minorRoles.push(role);
    }
    if (AGE_ROLES.adults.some(tag => lowerName.includes(tag))) {
      adultRoles.push(role);
    }
  });

  const result = {
    configured: minorRoles.length > 0 && adultRoles.length > 0,
    minorRoles: minorRoles.map(r => r.name),
    adultRoles: adultRoles.map(r => r.name),
    issues: [],
    recommendations: []
  };

  if (!result.configured) {
    result.recommendations.push({
      type: 'CREATE_AGE_ROLES',
      message: 'Crea ruoli separati per minorenni e maggiorenni (es. "Under18", "Over18")',
      action: 'createAgeRoles'
    });
    return result;
  }

  channels.forEach(channel => {
    if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildVoice) return;
    
    const overwrites = channel.permissionOverwrites.cache;
    let minorCanView = false;
    let adultCanView = false;

    minorRoles.forEach(role => {
      const overwrite = overwrites.get(role.id);
      if (!overwrite || !overwrite.deny.has(PermissionFlagsBits.ViewChannel)) {
        const everyoneOverwrite = overwrites.get(guild.id);
        if (!everyoneOverwrite || !everyoneOverwrite.deny.has(PermissionFlagsBits.ViewChannel)) {
          minorCanView = true;
        }
      }
      if (overwrite && overwrite.allow.has(PermissionFlagsBits.ViewChannel)) {
        minorCanView = true;
      }
    });

    adultRoles.forEach(role => {
      const overwrite = overwrites.get(role.id);
      if (!overwrite || !overwrite.deny.has(PermissionFlagsBits.ViewChannel)) {
        const everyoneOverwrite = overwrites.get(guild.id);
        if (!everyoneOverwrite || !everyoneOverwrite.deny.has(PermissionFlagsBits.ViewChannel)) {
          adultCanView = true;
        }
      }
      if (overwrite && overwrite.allow.has(PermissionFlagsBits.ViewChannel)) {
        adultCanView = true;
      }
    });

    if (channel.nsfw && minorCanView) {
      result.issues.push({
        type: 'MINOR_ACCESS_NSFW',
        severity: 'CRITICAL',
        channel: channel.name,
        message: `I minorenni possono accedere al canale NSFW #${channel.name}`,
        action: 'blockMinorsFromNSFW',
        channelId: channel.id
      });
    }

    if (minorCanView && adultCanView && channel.name.toLowerCase().includes('adult')) {
      result.issues.push({
        type: 'MIXED_AGE_CHANNEL',
        severity: 'WARNING',
        channel: channel.name,
        message: `Il canale #${channel.name} è accessibile sia da minorenni che maggiorenni`
      });
    }
  });

  return result;
}

export async function getSecurityReport(guild) {
  const structure = await analyzeServerStructure(guild);
  const ageSeparation = await checkAgeSeparation(guild);
  
  const issues = [...structure.securityIssues];
  
  const everyoneRole = guild.roles.everyone;
  if (everyoneRole.permissions.has(PermissionFlagsBits.CreateInstantInvite)) {
    issues.push({
      type: 'EVERYONE_CAN_INVITE',
      severity: 'MEDIUM',
      message: 'Tutti possono creare inviti al server'
    });
  }

  const verificationLevel = guild.verificationLevel;
  if (verificationLevel < 2) {
    issues.push({
      type: 'LOW_VERIFICATION',
      severity: 'MEDIUM',
      message: `Livello di verifica basso (${verificationLevel}/4). Considera di aumentarlo.`
    });
  }

  return {
    structure,
    ageSeparation,
    securityIssues: issues,
    score: calculateSecurityScore(issues, ageSeparation.issues)
  };
}

function calculateSecurityScore(securityIssues, ageIssues) {
  let score = 100;
  
  securityIssues.forEach(issue => {
    if (issue.severity === 'CRITICAL') score -= 25;
    else if (issue.severity === 'HIGH') score -= 15;
    else if (issue.severity === 'MEDIUM') score -= 10;
    else if (issue.severity === 'LOW') score -= 5;
  });

  ageIssues.forEach(issue => {
    if (issue.severity === 'CRITICAL') score -= 30;
    else if (issue.severity === 'HIGH') score -= 20;
    else if (issue.severity === 'WARNING') score -= 10;
  });

  return Math.max(0, score);
}

export async function getAIRecommendations(report, guild, trends = null) {
  const existingAgeRoles = findExistingAgeRoles(guild);
  const hasExistingRoles = existingAgeRoles.minorRole || existingAgeRoles.adultRole;
  
  const prompt = `Sei un esperto di community Discord. Analizza questo report del server "${guild.name}" e fornisci raccomandazioni GRADUALI e SCALABILI.

PRINCIPI FONDAMENTALI:
- NON suggerire misure drastiche o stravolgimenti
- MIGLIORA ciò che esiste già invece di creare da zero
- Suggerisci cambiamenti INCREMENTALI e poco invasivi
- Considera la CRESCITA FUTURA della community
- Prioritizza azioni che non disturbano l'esperienza attuale degli utenti

STRUTTURA SERVER ATTUALE:
- Membri: ${report.structure.memberCount}
- Categorie: ${report.structure.categories.length}
- Canali testo: ${report.structure.textChannels.length}
- Canali vocali: ${report.structure.voiceChannels.length}
- Ruoli: ${report.structure.roles.length}

RUOLI ETÀ GIÀ ESISTENTI:
- Ruolo minorenni esistente: ${existingAgeRoles.minorRole?.name || 'Nessuno'}
- Ruolo maggiorenni esistente: ${existingAgeRoles.adultRole?.name || 'Nessuno'}
- ${hasExistingRoles ? 'IMPORTANTE: Usa e migliora questi ruoli esistenti invece di crearne nuovi!' : 'Nessun ruolo età rilevato'}

PROBLEMI SICUREZZA (${report.securityIssues.length}):
${report.securityIssues.map(i => `- [${i.severity}] ${i.message}`).join('\n') || 'Nessuno'}

SEPARAZIONE ETÀ:
- Configurato: ${report.ageSeparation.configured ? 'Sì' : 'No'}
- Ruoli minorenni: ${report.ageSeparation.minorRoles.join(', ') || 'Nessuno'}
- Ruoli adulti: ${report.ageSeparation.adultRoles.join(', ') || 'Nessuno'}
- Problemi: ${report.ageSeparation.issues.map(i => i.message).join('; ') || 'Nessuno'}

PUNTEGGIO SICUREZZA: ${report.score}/100

${trends ? `TREND CRESCITA (ultimi 14 giorni):
- Crescita membri: ${trends.memberTrend}%
- Trend messaggi: ${trends.messageTrend}%
- Punti dati: ${trends.dataPoints}` : 'Trend non disponibili (dati insufficienti)'}

Fornisci raccomandazioni in 3 FASI (breve, medio, lungo termine):
1. FASE 1 (Immediato): Piccole migliorie che non disturbano, facili da implementare
2. FASE 2 (1-2 settimane): Miglioramenti strutturali graduali
3. FASE 3 (1 mese+): Strategie di crescita e scalabilità

Rispondi in italiano in formato JSON con questa struttura:
{
  "phase1": [{"title": "", "description": "", "effort": "basso/medio", "canAutomate": true/false, "automationAction": ""}],
  "phase2": [{"title": "", "description": "", "effort": "medio", "canAutomate": true/false}],
  "phase3": [{"title": "", "description": "", "effort": "alto", "scalabilityTip": ""}],
  "growthProjection": "",
  "overallAssessment": "",
  "existingStrengths": [""],
  "avoidActions": [""]
}`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      max_tokens: 2000
    });

    return JSON.parse(response.choices[0].message.content);
  } catch (error) {
    console.error('AI Error:', error);
    return {
      priorityActions: [{ title: "Errore AI", description: "Impossibile generare raccomandazioni", canAutomate: false }],
      growthStrategies: [],
      bestPractices: [],
      overallAssessment: "Errore nella generazione delle raccomandazioni AI"
    };
  }
}

export async function executeAction(guild, action, params = {}) {
  const results = { success: false, message: '', details: null };

  try {
    switch (action) {
      case 'createAgeRoles':
        const existingRoles = findExistingAgeRoles(guild);
        let minorRole = existingRoles.minorRole;
        let adultRole = existingRoles.adultRole;
        const created = [];
        const reused = [];
        
        if (minorRole) {
          reused.push(`"${minorRole.name}" (minorenni)`);
        } else {
          minorRole = await guild.roles.create({
            name: 'Under18',
            color: '#3498db',
            reason: 'Creato automaticamente per separazione età'
          });
          created.push('Under18');
        }
        
        if (adultRole) {
          reused.push(`"${adultRole.name}" (maggiorenni)`);
        } else {
          adultRole = await guild.roles.create({
            name: 'Over18',
            color: '#e74c3c',
            reason: 'Creato automaticamente per separazione età'
          });
          created.push('Over18');
        }
        
        results.success = true;
        if (reused.length > 0 && created.length > 0) {
          results.message = `Ruoli riutilizzati: ${reused.join(', ')}. Nuovi ruoli creati: ${created.join(', ')}`;
        } else if (reused.length > 0) {
          results.message = `Ruoli esistenti riutilizzati: ${reused.join(', ')}. Nessun nuovo ruolo necessario!`;
        } else {
          results.message = `Nuovi ruoli creati: ${created.join(', ')}`;
        }
        results.details = { minorRole: minorRole.name, adultRole: adultRole.name, reused: reused.length, created: created.length };
        break;

      case 'blockMinorsFromNSFW':
        const channel = guild.channels.cache.get(params.channelId);
        if (channel) {
          const roles = guild.roles.cache;
          for (const [, role] of roles) {
            const lowerName = role.name.toLowerCase();
            if (AGE_ROLES.minors.some(tag => lowerName.includes(tag))) {
              await channel.permissionOverwrites.edit(role, {
                ViewChannel: false
              });
            }
          }
          results.success = true;
          results.message = `Accesso bloccato per minorenni in #${channel.name}`;
        }
        break;

      case 'increaseVerification':
        await guild.setVerificationLevel(2);
        results.success = true;
        results.message = 'Livello di verifica aumentato a MEDIUM';
        break;

      case 'disableEveryoneInvites':
        const everyone = guild.roles.everyone;
        await everyone.setPermissions(everyone.permissions.remove(PermissionFlagsBits.CreateInstantInvite));
        results.success = true;
        results.message = 'Permesso di invito rimosso da @everyone';
        break;

      default:
        results.message = `Azione sconosciuta: ${action}`;
    }
  } catch (error) {
    results.message = `Errore: ${error.message}`;
  }

  return results;
}

export function formatReport(report, aiRecommendations, mee6Compat = null) {
  let text = `**📊 REPORT SERVER: ${report.structure.name}**\n\n`;
  
  text += `**🏷️ Struttura:**\n`;
  text += `• Membri: ${report.structure.memberCount}\n`;
  text += `• Categorie: ${report.structure.categories.length}\n`;
  text += `• Canali testo: ${report.structure.textChannels.length}\n`;
  text += `• Canali vocali: ${report.structure.voiceChannels.length}\n`;
  text += `• Ruoli: ${report.structure.roles.length}\n\n`;

  text += `**🔒 Punteggio Sicurezza: ${report.score}/100**\n`;
  
  if (report.securityIssues.length > 0) {
    text += `\n**⚠️ Problemi rilevati:**\n`;
    report.securityIssues.forEach(issue => {
      const emoji = issue.severity === 'CRITICAL' ? '🔴' : issue.severity === 'HIGH' ? '🟠' : '🟡';
      text += `${emoji} ${issue.message}\n`;
    });
  }

  if (report.ageSeparation.issues.length > 0) {
    text += `\n**👥 Problemi separazione età:**\n`;
    report.ageSeparation.issues.forEach(issue => {
      text += `🔴 ${issue.message}\n`;
    });
  }

  if (aiRecommendations) {
    if (aiRecommendations.existingStrengths?.length > 0) {
      text += `\n**💪 Punti di forza esistenti:**\n`;
      aiRecommendations.existingStrengths.slice(0, 3).forEach(s => {
        text += `✅ ${s}\n`;
      });
    }
    
    if (aiRecommendations.phase1?.length > 0) {
      text += `\n**🚀 FASE 1 - Azioni immediate:**\n`;
      aiRecommendations.phase1.slice(0, 3).forEach((action, i) => {
        text += `${i + 1}. **${action.title}** (sforzo: ${action.effort})\n   ${action.description}\n`;
        if (action.canAutomate && action.automationAction) {
          text += `   ✅ *Automatizzabile con* \`!fix ${action.automationAction}\`\n`;
        }
      });
    }
    
    if (aiRecommendations.phase2?.length > 0) {
      text += `\n**📅 FASE 2 - Prossime settimane:**\n`;
      aiRecommendations.phase2.slice(0, 2).forEach((action, i) => {
        text += `${i + 1}. **${action.title}**\n   ${action.description}\n`;
      });
    }
    
    if (aiRecommendations.growthProjection) {
      text += `\n**📈 Proiezione crescita:** ${aiRecommendations.growthProjection}\n`;
    }
    
    if (aiRecommendations.avoidActions?.length > 0) {
      text += `\n**⛔ Da evitare:**\n`;
      aiRecommendations.avoidActions.slice(0, 2).forEach(a => {
        text += `• ${a}\n`;
      });
    }
  }

  if (mee6Compat && mee6Compat.mee6Present) {
    const symbiosisEmoji = mee6Compat.symbiosis === 'excellent' ? '✅' : 
                           mee6Compat.symbiosis === 'good' ? '🟡' : '⚠️';
    text += `\n**🤖 Compatibilità MEE6: ${symbiosisEmoji} ${mee6Compat.score}/100**\n`;
    
    if (mee6Compat.detectedFeatures.length > 0) {
      text += `• Funzioni MEE6 rilevate: ${mee6Compat.detectedFeatures.join(', ')}\n`;
    }
    
    mee6Compat.recommendations.slice(0, 4).forEach(rec => {
      text += `${rec}\n`;
    });
    
    if (mee6Compat.conflicts.length > 0) {
      text += `\n**⚠️ Note:**\n`;
      mee6Compat.conflicts.forEach(c => {
        text += `• ${c.message}\n`;
      });
    }
  }

  text += `\n*Usa \`!schema\` per struttura, \`!trend\` per crescita, \`!mee6\` per check compatibilità*`;

  return text;
}

export async function checkMEE6Compatibility(guild) {
  const result = {
    mee6Present: false,
    mee6Role: null,
    mee6Premium: false,
    symbiosis: 'unknown',
    score: 100,
    detectedFeatures: [],
    levelRoles: [],
    conflicts: [],
    recommendations: [],
    channelsUsedByMEE6: [],
    webhooksDetected: 0,
    fridayAdvantages: []
  };

  try {
    const members = await guild.members.fetch();
    const mee6Bot = members.get(MEE6_BOT_ID);
    
    if (!mee6Bot) {
      result.symbiosis = 'no_mee6';
      result.recommendations.push('MEE6 non rilevato nel server.');
      result.fridayAdvantages.push('Friday può gestire tutte le funzionalità autonomamente');
      return result;
    }

    result.mee6Present = true;
    result.mee6Role = mee6Bot.roles.highest?.name || 'Nessun ruolo';

    const roles = guild.roles.cache;
    roles.forEach(role => {
      if (MEE6_ROLE_PATTERNS.some(pattern => pattern.test(role.name))) {
        result.levelRoles.push({
          name: role.name,
          members: role.members.size,
          color: role.hexColor
        });
      }
    });

    if (result.levelRoles.length > 0) {
      if (!result.detectedFeatures.includes('leveling')) {
        result.detectedFeatures.push('leveling');
      }
      result.mee6Premium = true;
    }

    const channels = guild.channels.cache;
    for (const [, channel] of channels) {
      if (channel.type !== 0) continue;
      const lowerName = channel.name.toLowerCase();
      
      Object.entries(MEE6_FEATURES).forEach(([feature, keywords]) => {
        if (keywords.some(kw => lowerName.includes(kw))) {
          if (!result.detectedFeatures.includes(feature)) {
            result.detectedFeatures.push(feature);
          }
          if (!result.channelsUsedByMEE6.find(c => c.name === channel.name)) {
            result.channelsUsedByMEE6.push({
              name: channel.name,
              feature: feature,
              id: channel.id
            });
          }
        }
      });

      try {
        if (channel.permissionsFor(guild.members.me)?.has('ManageWebhooks')) {
          const webhooks = await channel.fetchWebhooks();
          const mee6Webhooks = webhooks.filter(wh => 
            wh.name.toLowerCase().includes('mee6') || 
            wh.owner?.id === MEE6_BOT_ID
          );
          result.webhooksDetected += mee6Webhooks.size;
        }
      } catch (e) {
      }
    }

    if (result.webhooksDetected > 0) {
      result.mee6Premium = true;
    }

    if (result.detectedFeatures.includes('captcha')) {
      result.mee6Premium = true;
    }

    const mee6Features = result.detectedFeatures;
    
    if (mee6Features.includes('leveling')) {
      result.recommendations.push('✅ **Leveling** attivo - Friday non toccherà XP/livelli');
      if (result.levelRoles.length > 0) {
        result.recommendations.push(`   └ ${result.levelRoles.length} ruoli livello rilevati`);
      }
    }
    
    if (mee6Features.includes('welcome')) {
      result.recommendations.push('✅ **Welcome** attivo - Friday non gestirà benvenuti');
    }
    
    if (mee6Features.includes('moderation')) {
      result.recommendations.push('✅ **Mod-log** attivo - Friday fa audit AI avanzato');
    }
    
    if (mee6Features.includes('reactionRoles')) {
      result.recommendations.push('✅ **Reaction Roles** attivo - Friday non li toccherà');
    }
    
    if (mee6Features.includes('captcha')) {
      result.recommendations.push('✅ **Captcha/Verifica** attivo - Friday non interferirà');
    }
    
    if (mee6Features.includes('streaming')) {
      result.recommendations.push('✅ **Notifiche Streaming** attivo');
    }

    result.fridayAdvantages = [
      '🔒 Audit sicurezza con AI',
      '👥 Controllo separazione fasce età',
      '📊 Trend e analisi crescita',
      '🛠️ Fix automatici struttura',
      '📈 Report evoluzione server'
    ];

    if (!mee6Features.includes('captcha')) {
      result.fridayAdvantages.push('🎫 Sistema ticketing (disponibile)');
    }

    const mee6RolePosition = mee6Bot.roles.highest?.position || 0;
    const botMember = guild.members.me;
    const fridayRolePosition = botMember?.roles.highest?.position || 0;
    
    if (fridayRolePosition > mee6RolePosition) {
      result.conflicts.push({
        type: 'ROLE_HIERARCHY',
        severity: 'INFO',
        message: 'Friday ha priorità su MEE6 nella gerarchia ruoli'
      });
    }

    const mee6Perms = mee6Bot.permissions;
    if (mee6Perms.has('Administrator')) {
      result.conflicts.push({
        type: 'MEE6_ADMIN',
        severity: 'INFO',
        message: 'MEE6 ha permessi Admin - Friday eviterà conflitti'
      });
    }

    const featureCount = result.detectedFeatures.length;
    if (featureCount >= 4) {
      result.symbiosis = 'excellent';
      result.score = 100;
    } else if (featureCount >= 2) {
      result.symbiosis = 'good';
      result.score = 85;
    } else if (featureCount >= 1) {
      result.symbiosis = 'basic';
      result.score = 70;
    } else {
      result.symbiosis = 'minimal';
      result.score = 50;
    }

    if (result.mee6Premium) {
      result.recommendations.unshift('👑 **MEE6 Premium rilevato** - Funzionalità avanzate attive');
    }

  } catch (error) {
    console.error('MEE6 check error:', error);
    result.symbiosis = 'error';
    result.recommendations.push('⚠️ Errore durante analisi MEE6');
  }

  return result;
}

export function generateServerSchema(structure) {
  let schema = `**🗺️ SCHEMA SERVER: ${structure.name}**\n\n`;
  
  schema += `**📊 Panoramica:**\n`;
  schema += `\`\`\`\n`;
  schema += `Membri: ${structure.memberCount}\n`;
  schema += `Categorie: ${structure.categories.length}\n`;
  schema += `Canali Testo: ${structure.textChannels.length}\n`;
  schema += `Canali Voice: ${structure.voiceChannels.length}\n`;
  schema += `Ruoli: ${structure.roles.length}\n`;
  schema += `\`\`\`\n\n`;
  
  schema += `**📁 Categorie e Canali:**\n`;
  const byCategory = {};
  structure.textChannels.forEach(ch => {
    const cat = ch.category || 'Senza categoria';
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push({ name: ch.name, type: 'text', nsfw: ch.nsfw });
  });
  structure.voiceChannels.forEach(ch => {
    const cat = ch.category || 'Senza categoria';
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push({ name: ch.name, type: 'voice' });
  });
  
  Object.entries(byCategory).forEach(([cat, channels]) => {
    schema += `\n📂 **${cat}**\n`;
    channels.forEach(ch => {
      const icon = ch.type === 'voice' ? '🔊' : (ch.nsfw ? '🔞' : '💬');
      schema += `   ${icon} ${ch.name}\n`;
    });
  });
  
  schema += `\n**🎭 Ruoli principali:**\n`;
  const importantRoles = structure.roles
    .filter(r => !r.isEveryone && r.memberCount > 0)
    .sort((a, b) => b.position - a.position)
    .slice(0, 10);
  
  importantRoles.forEach(role => {
    const warning = role.dangerousPerms.length > 0 ? ' ⚠️' : '';
    schema += `• **${role.name}** (${role.memberCount} membri)${warning}\n`;
  });
  
  return schema;
}

export async function generateTextSuggestions(guild, structure) {
  const channels = guild.channels.cache;
  const guildName = guild.name;
  
  const missingElements = [];
  const channelNames = Array.from(channels.values()).map(c => c.name.toLowerCase());
  
  const hasRules = channelNames.some(n => n.includes('regole') || n.includes('rules'));
  const hasWelcome = channelNames.some(n => n.includes('benvenuto') || n.includes('welcome'));
  const hasAnnouncements = channelNames.some(n => n.includes('annunci') || n.includes('announcements'));
  const hasIntro = channelNames.some(n => n.includes('presentazioni') || n.includes('intro'));
  const hasRoles = channelNames.some(n => n.includes('ruoli') || n.includes('roles'));
  
  if (!hasRules) missingElements.push('regole');
  if (!hasWelcome) missingElements.push('benvenuto');
  if (!hasAnnouncements) missingElements.push('annunci');
  if (!hasIntro) missingElements.push('presentazioni');
  if (!hasRoles) missingElements.push('ruoli');
  
  const prompt = `Sei un esperto di community Discord gaming. Il server si chiama "${guildName}" ed è una community gaming italiana.

ELEMENTI MANCANTI O DA MIGLIORARE: ${missingElements.length > 0 ? missingElements.join(', ') : 'nessuno rilevato'}

CANALI ESISTENTI: ${channelNames.slice(0, 20).join(', ')}

NUMERO MEMBRI: ${guild.memberCount}

Genera testi PRONTI ALL'USO per una community gaming italiana. Usa un tono amichevole ma professionale. Includi emoji appropriate.

Rispondi in JSON con questa struttura:
{
  "welcomeMessage": "Messaggio di benvenuto per nuovi membri (max 300 caratteri)",
  "rulesText": "Regole del server numerate (5-7 regole essenziali)",
  "channelDescriptions": {
    "generale": "Descrizione per canale chat generale",
    "gaming": "Descrizione per canale gaming",
    "off-topic": "Descrizione per canale off-topic"
  },
  "roleSelectionMessage": "Messaggio per selezione ruoli con reaction",
  "announcementTemplate": "Template per annunci importanti",
  "suggestions": [
    {"type": "missing_channel", "suggestion": "Descrizione cosa manca e perché è importante"},
    {"type": "improvement", "suggestion": "Suggerimento per migliorare qualcosa"}
  ]
}`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      max_tokens: 1500
    });

    let result;
    try {
      result = JSON.parse(response.choices[0].message.content);
    } catch (parseError) {
      console.error('JSON parse error:', parseError);
      return {
        error: true,
        message: 'Errore nel parsing della risposta AI',
        missingElements
      };
    }
    
    result.missingElements = missingElements;
    result.hasRules = hasRules;
    result.hasWelcome = hasWelcome;
    result.hasAnnouncements = hasAnnouncements;
    result.hasIntro = hasIntro;
    result.hasRoles = hasRoles;
    
    result.welcomeMessage = result.welcomeMessage || null;
    result.rulesText = result.rulesText || null;
    result.roleSelectionMessage = result.roleSelectionMessage || null;
    result.announcementTemplate = result.announcementTemplate || null;
    result.channelDescriptions = result.channelDescriptions || {};
    result.suggestions = Array.isArray(result.suggestions) ? result.suggestions : [];
    
    return result;
  } catch (error) {
    console.error('AI Text Generation Error:', error);
    return {
      error: true,
      message: 'Errore nella generazione dei testi: ' + (error.message || 'errore sconosciuto'),
      missingElements
    };
  }
}

export function formatTextSuggestions(textSuggestions) {
  if (!textSuggestions || textSuggestions.error) {
    return '**❌ Errore nella generazione dei suggerimenti testo**\n' + 
           (textSuggestions?.message || 'Riprova più tardi.');
  }
  
  let text = `**✍️ SUGGERIMENTI TESTO AI**\n\n`;
  
  if (textSuggestions.missingElements?.length > 0) {
    text += `**⚠️ Elementi mancanti:** ${textSuggestions.missingElements.join(', ')}\n\n`;
  } else {
    text += `**✅ Struttura base completa!** Ecco comunque alcuni testi utili:\n\n`;
  }
  
  if (textSuggestions.welcomeMessage) {
    const label = textSuggestions.hasWelcome ? '(miglioramento)' : '(mancante)';
    text += `**👋 Messaggio di Benvenuto ${label}:**\n`;
    text += `\`\`\`\n${textSuggestions.welcomeMessage}\n\`\`\`\n\n`;
  }
  
  if (textSuggestions.rulesText) {
    const label = textSuggestions.hasRules ? '(miglioramento)' : '(mancante)';
    text += `**📜 Regole ${label}:**\n`;
    text += `\`\`\`\n${textSuggestions.rulesText}\n\`\`\`\n\n`;
  }
  
  if (textSuggestions.channelDescriptions) {
    text += `**💬 Descrizioni canali suggerite:**\n`;
    Object.entries(textSuggestions.channelDescriptions).forEach(([channel, desc]) => {
      if (desc) text += `• **#${channel}:** ${desc}\n`;
    });
    text += `\n`;
  }
  
  if (textSuggestions.roleSelectionMessage) {
    const label = textSuggestions.hasRoles ? '(miglioramento)' : '(mancante)';
    text += `**🎭 Messaggio selezione ruoli ${label}:**\n`;
    text += `\`\`\`\n${textSuggestions.roleSelectionMessage}\n\`\`\`\n\n`;
  }
  
  if (textSuggestions.announcementTemplate) {
    const label = textSuggestions.hasAnnouncements ? '(miglioramento)' : '(mancante)';
    text += `**📢 Template annuncio ${label}:**\n`;
    text += `\`\`\`\n${textSuggestions.announcementTemplate}\n\`\`\`\n\n`;
  }
  
  if (textSuggestions.suggestions?.length > 0) {
    text += `**💡 Suggerimenti aggiuntivi:**\n`;
    textSuggestions.suggestions.forEach(s => {
      if (s?.suggestion) {
        const emoji = s.type === 'missing_channel' ? '📌' : '✨';
        text += `${emoji} ${s.suggestion}\n`;
      }
    });
  }
  
  return text;
}

// ============================================
// STRATEGY AI REPORT GENERATION
// ============================================

export async function generateStrategyReport(snapshot, serverInfo) {
  const { guildName, memberCount, channelCount, inviteLink } = serverInfo;
  
  const prompt = `Sei un consulente esperto di community Discord gaming. Analizza i dati del server "${guildName}" e genera un report strategico mensile dettagliato.

DATI SERVER:
- Nome: ${guildName}
- Membri attuali: ${memberCount}
- Canali: ${channelCount}
- Link invito: ${inviteLink || 'non specificato'}

METRICHE ULTIMO MESE:
- Messaggi totali: ${snapshot?.currentMonth?.totalMessages || 0}
- Media messaggi/giorno: ${snapshot?.currentMonth?.avgDailyMessages || 0}
- Nuovi membri: ${snapshot?.currentMonth?.totalJoins || 0}
- Membri usciti: ${snapshot?.currentMonth?.totalLeaves || 0}
- Crescita netta: ${snapshot?.currentMonth?.netGrowth || 0}
- Giorni tracciati: ${snapshot?.currentMonth?.daysTracked || 0}

CONFRONTO MESE PRECEDENTE:
- Messaggi totali precedente: ${snapshot?.previousMonth?.totalMessages || 0}
- Nuovi membri precedente: ${snapshot?.previousMonth?.totalJoins || 0}
- Crescita netta precedente: ${snapshot?.previousMonth?.netGrowth || 0}

INVITI:
- Inviti questo mese: ${snapshot?.invites?.thisMonth || 0}
- Inviti validi: ${snapshot?.invites?.validThisMonth || 0}
- Top inviters: ${snapshot?.invites?.topInviters?.map(t => t.username + ' (' + t.count + ')').join(', ') || 'nessuno'}

Genera un report strategico completo in JSON con questa struttura:
{
  "executiveSummary": "Riassunto in 2-3 frasi dello stato della community e trend principale",
  "healthScore": numero da 1 a 100,
  "trend": "growing" | "stable" | "declining",
  "priorityActions": [
    {
      "title": "Titolo azione",
      "description": "Descrizione dettagliata cosa fare",
      "priority": "high" | "medium" | "low",
      "estimatedImpact": "Impatto previsto",
      "timeframe": "Tempo per implementare (es. 1 settimana)"
    }
  ],
  "advertisingOpportunities": [
    {
      "platform": "Nome piattaforma (Reddit, Twitter, Disboard, etc)",
      "strategy": "Come promuovere",
      "cost": "Gratuito" | "Budget basso" | "Budget medio",
      "expectedReach": "Portata stimata"
    }
  ],
  "recommendedServices": [
    {
      "name": "Nome servizio/tool",
      "purpose": "A cosa serve",
      "cost": "Gratuito" | "Freemium" | "A pagamento",
      "link": "URL se disponibile"
    }
  ],
  "kpiTargets": {
    "memberGrowth": "Obiettivo membri prossimo mese",
    "engagement": "Obiettivo engagement (messaggi/giorno)",
    "retention": "Obiettivo retention"
  },
  "monthlyFocus": "Una frase che riassume su cosa concentrarsi questo mese"
}

IMPORTANTE: 
- Fornisci 3-5 azioni prioritarie concrete e realizzabili
- Suggerisci solo servizi/piattaforme gratuite o freemium per mantenere costi zero
- Le strategie devono essere specifiche per community gaming italiana
- Includi almeno un suggerimento per eventi/attivita da organizzare`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      max_tokens: 2000
    });

    const result = JSON.parse(response.choices[0].message.content);
    
    return {
      success: true,
      report: result,
      generatedAt: new Date(),
      snapshot: snapshot
    };
  } catch (error) {
    console.error('Strategy AI Error:', error);
    return {
      success: false,
      error: error.message,
      generatedAt: new Date()
    };
  }
}

const SCALING_THRESHOLDS = {
  channelUtilization: { low: 0.3, optimal: 0.7, high: 0.85 },
  orphanedRolesMax: 0.2,
  staffMemberRatio: { min: 0.02, max: 0.1 },
  weeklyEngagement: { min: 0.1, target: 0.15 },
  channelsPerMember: { min: 0.05, max: 0.3 }
};

// Soglie dinamiche 2025 per community gaming (basate su best practices Discord)
// Fonte: Discord official guides, top gaming servers analysis (Valorant, Genshin, etc.)
const GROWTH_PHASES = [
  { maxMembers: 50, name: 'Avvio', channels: { min: 4, max: 15, optimal: 8 } },
  { maxMembers: 100, name: 'Base', channels: { min: 8, max: 20, optimal: 12 } },
  { maxMembers: 500, name: 'Crescita', channels: { min: 12, max: 30, optimal: 20 } },
  { maxMembers: 1000, name: 'Maturità', channels: { min: 15, max: 40, optimal: 25 } },
  { maxMembers: 5000, name: 'Grande', channels: { min: 20, max: 50, optimal: 35 } },
  { maxMembers: Infinity, name: 'Mega', channels: { min: 25, max: 65, optimal: 45 } }
];

function getGrowthPhase(memberCount) {
  return GROWTH_PHASES.find(phase => memberCount <= phase.maxMembers) || GROWTH_PHASES[GROWTH_PHASES.length - 1];
}

function getChannelStatus(channelCount, memberCount) {
  const phase = getGrowthPhase(memberCount);
  
  if (channelCount < phase.channels.min) {
    return { status: 'under_scaled', phase: phase.name, recommended: phase.channels.optimal };
  } else if (channelCount > phase.channels.max) {
    return { status: 'over_scaled', phase: phase.name, recommended: phase.channels.optimal };
  } else if (channelCount >= phase.channels.optimal - 5 && channelCount <= phase.channels.optimal + 10) {
    return { status: 'optimal', phase: phase.name, recommended: phase.channels.optimal };
  } else {
    return { status: 'good', phase: phase.name, recommended: phase.channels.optimal };
  }
}

const MEE6_ECONOMY_PATTERNS = {
  currency: ['coin', 'moneta', 'soldi', 'gold', 'token', 'crediti', 'punti', 'gems', 'diamanti', 'stelline', 'currency', 'valuta', 'denaro'],
  shop: ['shop', 'negozio', 'store', 'acquista', 'compra', 'mercato', 'economia', 'economy'],
  achievements: ['achievement', 'traguardo', 'obiettivo', 'premio', 'reward', 'badge', 'medaglia', 'unlock', 'sblocco', 'sfida', 'challenge', 'completato', 'completed', 'milestone', 'livello', 'level', 'rank', 'rango', 'grado', 'xp', 'exp', 'experience', 'esperienza', 'leaderboard', 'classifica', 'top', 'master', 'pro', 'elite', 'veteran', 'veterano', 'legend', 'leggenda', 'champion', 'campione'],
  premium: ['premium', 'vip', 'supporter', 'donatore', 'patron', 'boost', 'abbonato', 'sub', 'subscriber', 'member', 'membro', 'special', 'speciale', 'exclusive', 'esclusivo']
};

export async function analyzeServerScaling(guild, dailyMetrics = []) {
  const channels = guild.channels.cache;
  const roles = guild.roles.cache;
  const memberCount = guild.memberCount;
  
  const textChannels = channels.filter(c => c.type === ChannelType.GuildText);
  const voiceChannels = channels.filter(c => c.type === ChannelType.GuildVoice);
  
  const scaling = {
    memberCount,
    targetMembers: 1000,
    progressToTarget: Math.min((memberCount / 1000) * 100, 100).toFixed(1),
    channels: {
      text: textChannels.size,
      voice: voiceChannels.size,
      total: textChannels.size + voiceChannels.size,
      perMember: ((textChannels.size + voiceChannels.size) / memberCount).toFixed(3),
      status: 'optimal'
    },
    roles: {
      total: roles.size,
      withMembers: 0,
      orphaned: 0,
      staffRoles: 0,
      levelRoles: 0,
      orphanedList: []
    },
    engagement: {
      weeklyActive: 0,
      weeklyMessages: 0,
      weeklyJoins: 0,
      weeklyLeaves: 0,
      netGrowth: 0,
      growthRate: 0
    },
    issues: [],
    recommendations: [],
    score: 100
  };
  
  roles.forEach(role => {
    if (role.id === guild.id) return;
    
    if (role.members.size > 0) {
      scaling.roles.withMembers++;
    } else {
      scaling.roles.orphaned++;
      if (scaling.roles.orphanedList.length < 5) {
        scaling.roles.orphanedList.push(role.name);
      }
    }
    
    const lowerName = role.name.toLowerCase();
    if (lowerName.includes('mod') || lowerName.includes('admin') || lowerName.includes('staff') || 
        lowerName.includes('helper') || lowerName.includes('owner')) {
      scaling.roles.staffRoles++;
    }
    
    if (MEE6_ROLE_PATTERNS.some(pattern => pattern.test(role.name))) {
      scaling.roles.levelRoles++;
    }
  });
  
  const orphanedRatio = scaling.roles.orphaned / Math.max(scaling.roles.total, 1);
  const staffRatio = scaling.roles.staffRoles / Math.max(memberCount, 1);
  const channelsPerMember = parseFloat(scaling.channels.perMember);
  
  if (dailyMetrics.length >= 7) {
    const lastWeek = dailyMetrics.slice(-7);
    scaling.engagement.weeklyMessages = lastWeek.reduce((sum, d) => sum + (d.messageCount || 0), 0);
    scaling.engagement.weeklyJoins = lastWeek.reduce((sum, d) => sum + (d.joinCount || 0), 0);
    scaling.engagement.weeklyLeaves = lastWeek.reduce((sum, d) => sum + (d.leaveCount || 0), 0);
    scaling.engagement.netGrowth = scaling.engagement.weeklyJoins - scaling.engagement.weeklyLeaves;
    scaling.engagement.growthRate = ((scaling.engagement.netGrowth / Math.max(memberCount, 1)) * 100).toFixed(2);
  }
  
  if (orphanedRatio > SCALING_THRESHOLDS.orphanedRolesMax) {
    scaling.issues.push({
      type: 'orphaned_roles',
      severity: 'medium',
      message: `${scaling.roles.orphaned} ruoli senza membri (${(orphanedRatio * 100).toFixed(0)}%)`,
      details: scaling.roles.orphanedList
    });
    scaling.score -= 10;
    scaling.recommendations.push({
      priority: 'medium',
      action: 'cleanOrphanedRoles',
      text: 'Elimina i ruoli inutilizzati per semplificare la gerarchia'
    });
  }
  
  // Usa soglie dinamiche basate sulla fase di crescita
  const channelAnalysis = getChannelStatus(scaling.channels.total, memberCount);
  scaling.channels.status = channelAnalysis.status;
  scaling.channels.phase = channelAnalysis.phase;
  scaling.channels.recommended = channelAnalysis.recommended;
  
  if (channelAnalysis.status === 'over_scaled') {
    scaling.issues.push({
      type: 'too_many_channels',
      severity: 'low',
      message: `Fase "${channelAnalysis.phase}": ${scaling.channels.total} canali (consigliati: ${channelAnalysis.recommended} per questa fase)`
    });
    scaling.score -= 5;
    scaling.recommendations.push({
      priority: 'low',
      action: 'mergeChannels',
      text: `Per la fase "${channelAnalysis.phase}" sono consigliati circa ${channelAnalysis.recommended} canali. Puoi unire canali simili o attendere la crescita.`
    });
  } else if (channelAnalysis.status === 'under_scaled') {
    scaling.issues.push({
      type: 'few_channels',
      severity: 'low',
      message: `Fase "${channelAnalysis.phase}": ${scaling.channels.total} canali (consigliati: ${channelAnalysis.recommended})`
    });
    scaling.score -= 5;
    scaling.recommendations.push({
      priority: 'low',
      action: 'addChannels',
      text: `Per la fase "${channelAnalysis.phase}" sono consigliati circa ${channelAnalysis.recommended} canali. Aggiungi canali tematici.`
    });
  }
  
  if (staffRatio < SCALING_THRESHOLDS.staffMemberRatio.min && memberCount > 30) {
    scaling.issues.push({
      type: 'understaffed',
      severity: 'high',
      message: `Team di moderazione ridotto (${scaling.roles.staffRoles} staff per ${memberCount} membri)`
    });
    scaling.score -= 15;
    scaling.recommendations.push({
      priority: 'high',
      action: 'recruitStaff',
      text: 'Recluta nuovi moderatori per gestire meglio la community'
    });
  } else if (staffRatio > SCALING_THRESHOLDS.staffMemberRatio.max) {
    scaling.issues.push({
      type: 'overstaffed',
      severity: 'low',
      message: `Team di moderazione molto ampio rispetto ai membri`
    });
    scaling.score -= 5;
  }
  
  if (scaling.engagement.netGrowth < 0) {
    scaling.issues.push({
      type: 'negative_growth',
      severity: 'high',
      message: `Crescita negativa questa settimana: ${scaling.engagement.netGrowth} membri`
    });
    scaling.score -= 20;
    scaling.recommendations.push({
      priority: 'critical',
      action: 'retentionStrategy',
      text: 'Implementa strategie di retention: eventi, contenuti esclusivi, community engagement'
    });
  }
  
  if (memberCount < 100) {
    scaling.recommendations.push({
      priority: 'high',
      action: 'growthPhase1',
      text: 'Fase iniziale: focus su contenuti di qualità e inviti personali'
    });
  } else if (memberCount < 500) {
    scaling.recommendations.push({
      priority: 'high',
      action: 'growthPhase2',
      text: 'Fase crescita: attiva partnership, eventi cross-server, SEO Discord'
    });
  } else if (memberCount < 1000) {
    scaling.recommendations.push({
      priority: 'high',
      action: 'growthPhase3',
      text: 'Quasi al traguardo! Focus su community features e monetizzazione'
    });
  }
  
  scaling.score = Math.max(0, Math.min(100, scaling.score));
  
  return scaling;
}

export async function checkMEE6Economy(guild) {
  const channels = guild.channels.cache;
  const roles = guild.roles.cache;
  
  let mee6Bot = guild.members.cache.get(MEE6_BOT_ID);
  if (!mee6Bot) {
    try {
      mee6Bot = await guild.members.fetch(MEE6_BOT_ID).catch(() => null);
    } catch (e) {
      mee6Bot = null;
    }
  }
  
  const economy = {
    mee6Present: !!mee6Bot,
    mee6Premium: false,
    features: {
      economy: { detected: false, channels: [], roles: [] },
      achievements: { detected: false, channels: [], roles: [] },
      monetization: { detected: false, channels: [], roles: [] },
      leveling: { detected: false, channels: [], roles: [], levelCount: 0 }
    },
    gaps: [],
    recommendations: [],
    synergyScore: 0
  };
  
  if (!mee6Bot) {
    economy.gaps.push('MEE6 non presente nel server');
    return economy;
  }
  
  const mee6Role = roles.find(r => r.name.toLowerCase().includes('mee6'));
  if (mee6Role && mee6Role.position > roles.size * 0.5) {
    economy.mee6Premium = true;
  }
  
  channels.forEach(channel => {
    if (channel.type !== ChannelType.GuildText) return;
    const lowerName = channel.name.toLowerCase();
    
    if (MEE6_ECONOMY_PATTERNS.currency.some(p => lowerName.includes(p)) ||
        MEE6_ECONOMY_PATTERNS.shop.some(p => lowerName.includes(p))) {
      economy.features.economy.detected = true;
      economy.features.economy.channels.push(channel.name);
    }
    
    if (MEE6_ECONOMY_PATTERNS.achievements.some(p => lowerName.includes(p))) {
      economy.features.achievements.detected = true;
      economy.features.achievements.channels.push(channel.name);
    }
    
    if (MEE6_ECONOMY_PATTERNS.premium.some(p => lowerName.includes(p))) {
      economy.features.monetization.detected = true;
      economy.features.monetization.channels.push(channel.name);
    }
    
    if (MEE6_FEATURES.leveling.some(p => lowerName.includes(p))) {
      economy.features.leveling.detected = true;
      economy.features.leveling.channels.push(channel.name);
    }
  });
  
  roles.forEach(role => {
    const lowerName = role.name.toLowerCase();
    
    if (MEE6_ROLE_PATTERNS.some(pattern => pattern.test(role.name))) {
      economy.features.leveling.detected = true;
      economy.features.leveling.roles.push(role.name);
      economy.features.leveling.levelCount++;
    }
    
    if (MEE6_ECONOMY_PATTERNS.premium.some(p => lowerName.includes(p))) {
      economy.features.monetization.detected = true;
      economy.features.monetization.roles.push(role.name);
    }
    
    if (MEE6_ECONOMY_PATTERNS.achievements.some(p => lowerName.includes(p))) {
      economy.features.achievements.detected = true;
      economy.features.achievements.roles.push(role.name);
    }
  });
  
  if (!economy.features.economy.detected) {
    economy.gaps.push('Sistema economia MEE6 non attivo');
    economy.recommendations.push({
      priority: 'medium',
      text: 'Attiva l\'economia MEE6 per aumentare engagement con valuta virtuale e shop'
    });
  }
  
  if (!economy.features.achievements.detected) {
    economy.gaps.push('Nessun sistema achievements rilevato');
    economy.recommendations.push({
      priority: 'low',
      text: 'Configura achievements/badge per premiare i membri attivi'
    });
  }
  
  if (!economy.features.monetization.detected) {
    economy.gaps.push('Nessuna monetizzazione configurata');
    economy.recommendations.push({
      priority: 'high',
      text: 'Configura ruoli premium o donazioni per supportare il server'
    });
  }
  
  if (economy.features.leveling.detected && economy.features.leveling.levelCount < 5) {
    economy.gaps.push('Pochi ruoli livello configurati');
    economy.recommendations.push({
      priority: 'medium',
      text: 'Aggiungi più ruoli livello per dare obiettivi ai membri'
    });
  }
  
  let score = 0;
  if (economy.mee6Present) score += 20;
  if (economy.mee6Premium) score += 10;
  if (economy.features.economy.detected) score += 20;
  if (economy.features.achievements.detected) score += 15;
  if (economy.features.monetization.detected) score += 20;
  if (economy.features.leveling.detected) score += 15;
  
  economy.synergyScore = score;
  
  return economy;
}

export function formatScalingReport(scaling, economy) {
  let text = `**📊 ANALISI SCALING SERVER**\n\n`;
  
  text += `**🎯 Obiettivo 1000 Membri**\n`;
  text += `Progresso: ${scaling.memberCount}/1000 (${scaling.progressToTarget}%)\n`;
  text += `${'█'.repeat(Math.floor(parseFloat(scaling.progressToTarget) / 10))}${'░'.repeat(10 - Math.floor(parseFloat(scaling.progressToTarget) / 10))} \n\n`;
  
  text += `**📈 Punteggio Scaling: ${scaling.score}/100**\n`;
  const scoreEmoji = scaling.score >= 80 ? '🟢' : scaling.score >= 60 ? '🟡' : '🔴';
  text += `${scoreEmoji} ${scaling.score >= 80 ? 'Ottimo' : scaling.score >= 60 ? 'Buono' : 'Da migliorare'}\n\n`;
  
  text += `**📊 Struttura**\n`;
  text += `• Canali: ${scaling.channels.text} testo + ${scaling.channels.voice} vocali\n`;
  text += `• Ruoli: ${scaling.roles.total} (${scaling.roles.orphaned} inutilizzati)\n`;
  text += `• Staff: ${scaling.roles.staffRoles} ruoli moderazione\n`;
  text += `• Ruoli Livello: ${scaling.roles.levelRoles}\n\n`;
  
  if (scaling.engagement.weeklyMessages > 0 || scaling.engagement.weeklyJoins > 0) {
    text += `**📈 Trend Settimanale**\n`;
    text += `• Messaggi: ${scaling.engagement.weeklyMessages}\n`;
    text += `• Nuovi membri: +${scaling.engagement.weeklyJoins}\n`;
    text += `• Usciti: -${scaling.engagement.weeklyLeaves}\n`;
    const growthEmoji = scaling.engagement.netGrowth >= 0 ? '📈' : '📉';
    text += `• Crescita netta: ${growthEmoji} ${scaling.engagement.netGrowth} (${scaling.engagement.growthRate}%)\n\n`;
  }
  
  if (scaling.issues.length > 0) {
    text += `**⚠️ Problemi Rilevati**\n`;
    scaling.issues.forEach(issue => {
      const icon = issue.severity === 'high' ? '🔴' : issue.severity === 'medium' ? '🟡' : '🟢';
      text += `${icon} ${issue.message}\n`;
    });
    text += `\n`;
  }
  
  if (economy) {
    text += `**💰 MEE6 Economy & Monetization**\n`;
    text += `• MEE6: ${economy.mee6Present ? '✅ Presente' : '❌ Assente'}`;
    if (economy.mee6Premium) text += ` (Premium)`;
    text += `\n`;
    text += `• Economia: ${economy.features.economy.detected ? '✅' : '❌'}\n`;
    text += `• Achievements: ${economy.features.achievements.detected ? '✅' : '❌'}\n`;
    text += `• Monetizzazione: ${economy.features.monetization.detected ? '✅' : '❌'}\n`;
    text += `• Leveling: ${economy.features.leveling.detected ? `✅ (${economy.features.leveling.levelCount} livelli)` : '❌'}\n`;
    text += `• Punteggio Sinergia: ${economy.synergyScore}/100\n\n`;
    
    if (economy.gaps.length > 0) {
      text += `**🔍 Funzionalità Mancanti**\n`;
      economy.gaps.forEach(gap => {
        text += `• ${gap}\n`;
      });
      text += `\n`;
    }
  }
  
  const allRecs = [...scaling.recommendations];
  if (economy?.recommendations) {
    allRecs.push(...economy.recommendations);
  }
  
  if (allRecs.length > 0) {
    text += `**💡 Raccomandazioni**\n`;
    const sorted = allRecs.sort((a, b) => {
      const order = { critical: 0, high: 1, medium: 2, low: 3 };
      return (order[a.priority] || 3) - (order[b.priority] || 3);
    });
    
    sorted.slice(0, 5).forEach(rec => {
      const icon = rec.priority === 'critical' ? '🚨' : rec.priority === 'high' ? '❗' : rec.priority === 'medium' ? '💡' : '📝';
      text += `${icon} ${rec.text}\n`;
    });
  }
  
  return text;
}

// Struttura ideale gaming 2025 per benchmark
const GAMING_STRUCTURE_2025 = {
  categories: [
    { name: 'INFO', channels: ['welcome', 'rules', 'announcements', 'server-info'], priority: 'essential' },
    { name: 'COMMUNITY', channels: ['general-chat', 'introductions', 'off-topic', 'memes'], priority: 'essential' },
    { name: 'GAMING', channels: ['lfg', 'game-clips', 'tips-tricks'], priority: 'essential' },
    { name: 'CREATIVE', channels: ['fan-art', 'content-creators', 'streaming'], priority: 'recommended' },
    { name: 'SUPPORT', channels: ['help', 'suggestions', 'bot-commands'], priority: 'recommended' },
    { name: 'VOICE', channels: ['general-voice', 'gaming-1', 'gaming-2', 'afk'], priority: 'essential' }
  ],
  essentialChannels: ['welcome', 'rules', 'announcements', 'general', 'chat'],
  recommendedFeatures: ['onboarding', 'reaction-roles', 'leveling', 'events', 'giveaways']
};

export async function analyzeFullStructure360(guild) {
  const channels = guild.channels.cache;
  const roles = guild.roles.cache;
  const memberCount = guild.memberCount;
  const phase = getGrowthPhase(memberCount);
  
  const analysis = {
    phase: phase.name,
    memberCount,
    currentStructure: {
      categories: [],
      textChannels: [],
      voiceChannels: [],
      privateChannels: 0,
      totalChannels: 0
    },
    benchmark: {
      score: 100,
      missingEssential: [],
      missingRecommended: [],
      excess: [],
      wellConfigured: []
    },
    mee6Integration: {
      detected: false,
      managedFeatures: []
    },
    recommendations360: [],
    proposedChanges: []
  };
  
  // Analizza struttura attuale
  const categoryMap = new Map();
  channels.forEach(ch => {
    if (ch.type === ChannelType.GuildCategory) {
      categoryMap.set(ch.id, { name: ch.name, channels: [] });
      analysis.currentStructure.categories.push(ch.name);
    }
  });
  
  channels.forEach(ch => {
    if (ch.type === ChannelType.GuildText) {
      analysis.currentStructure.textChannels.push({
        name: ch.name,
        category: ch.parent?.name || 'Nessuna',
        nsfw: ch.nsfw || false
      });
      if (ch.parentId && categoryMap.has(ch.parentId)) {
        categoryMap.get(ch.parentId).channels.push(ch.name);
      }
    } else if (ch.type === ChannelType.GuildVoice) {
      analysis.currentStructure.voiceChannels.push({
        name: ch.name,
        category: ch.parent?.name || 'Nessuna'
      });
    }
  });
  
  analysis.currentStructure.totalChannels = 
    analysis.currentStructure.textChannels.length + 
    analysis.currentStructure.voiceChannels.length;
  
  // Stima canali privati (differenza tra totale guild e visibili)
  try {
    const allChannels = await guild.channels.fetch();
    const visibleCount = channels.size;
    const totalCount = allChannels.size;
    analysis.currentStructure.privateChannels = Math.max(0, totalCount - visibleCount);
  } catch (e) {
    analysis.currentStructure.privateChannels = 0;
  }
  
  // Benchmark contro struttura ideale gaming 2025
  const allChannelNames = analysis.currentStructure.textChannels.map(c => c.name.toLowerCase());
  
  GAMING_STRUCTURE_2025.essentialChannels.forEach(essential => {
    const found = allChannelNames.some(ch => ch.includes(essential));
    if (found) {
      analysis.benchmark.wellConfigured.push(essential);
    } else {
      analysis.benchmark.missingEssential.push(essential);
      analysis.benchmark.score -= 10;
    }
  });
  
  // Verifica categorie
  const categoryNames = analysis.currentStructure.categories.map(c => c.toLowerCase());
  GAMING_STRUCTURE_2025.categories.forEach(cat => {
    const hasCategory = categoryNames.some(c => 
      c.includes(cat.name.toLowerCase()) || 
      cat.channels.some(ch => c.includes(ch))
    );
    if (!hasCategory && cat.priority === 'essential') {
      analysis.benchmark.missingRecommended.push(`Categoria ${cat.name}`);
      analysis.benchmark.score -= 5;
    }
  });
  
  // Rileva integrazione MEE6
  try {
    const mee6 = await guild.members.fetch(MEE6_BOT_ID).catch(() => null);
    if (mee6) {
      analysis.mee6Integration.detected = true;
      
      // Rileva funzionalità MEE6 attive
      for (const [feature, keywords] of Object.entries(MEE6_FEATURES)) {
        const hasFeature = allChannelNames.some(ch => 
          keywords.some(kw => ch.includes(kw.toLowerCase()))
        );
        if (hasFeature) {
          analysis.mee6Integration.managedFeatures.push(feature);
        }
      }
    }
  } catch (e) {}
  
  // Calcola eccesso canali
  const channelStatus = getChannelStatus(analysis.currentStructure.totalChannels, memberCount);
  if (channelStatus.status === 'over_scaled') {
    analysis.benchmark.excess.push({
      type: 'channels',
      current: analysis.currentStructure.totalChannels,
      recommended: channelStatus.recommended,
      difference: analysis.currentStructure.totalChannels - channelStatus.recommended
    });
    analysis.benchmark.score -= 10;
  }
  
  // Genera raccomandazioni 360°
  analysis.recommendations360 = generateRecommendations360(analysis, phase);
  
  // Proponi modifiche concrete
  analysis.proposedChanges = generateProposedChanges(analysis, phase);
  
  analysis.benchmark.score = Math.max(0, Math.min(100, analysis.benchmark.score));
  
  return analysis;
}

function generateRecommendations360(analysis, phase) {
  const recs = [];
  
  // Raccomandazioni struttura
  if (analysis.benchmark.missingEssential.length > 0) {
    recs.push({
      category: 'Struttura',
      priority: 'high',
      title: 'Canali essenziali mancanti',
      description: `Aggiungi: ${analysis.benchmark.missingEssential.join(', ')}`,
      effort: 'basso',
      impact: 'alto'
    });
  }
  
  if (analysis.benchmark.excess.length > 0) {
    const excess = analysis.benchmark.excess[0];
    recs.push({
      category: 'Scalabilità',
      priority: 'medium',
      title: 'Ottimizza numero canali',
      description: `Hai ${excess.current} canali, consigliati ${excess.recommended} per fase "${phase.name}". Unisci canali simili o archivia quelli inattivi.`,
      effort: 'medio',
      impact: 'medio'
    });
  }
  
  // Raccomandazioni MEE6
  if (analysis.mee6Integration.detected) {
    if (!analysis.mee6Integration.managedFeatures.includes('leveling')) {
      recs.push({
        category: 'Engagement',
        priority: 'high',
        title: 'Attiva MEE6 Leveling',
        description: 'Il sistema di livelli aumenta engagement del 40%. Crea canali #leaderboard e ruoli livello.',
        effort: 'basso',
        impact: 'alto'
      });
    }
    if (!analysis.mee6Integration.managedFeatures.includes('welcome')) {
      recs.push({
        category: 'Onboarding',
        priority: 'high',
        title: 'Configura messaggio benvenuto',
        description: 'Messaggio di benvenuto personalizzato aumenta retention nuovi membri.',
        effort: 'basso',
        impact: 'alto'
      });
    }
  }
  
  // Raccomandazioni growth
  if (phase.name === 'Avvio' || phase.name === 'Base') {
    recs.push({
      category: 'Growth',
      priority: 'medium',
      title: 'Focus su community core',
      description: 'In questa fase, concentrati su 10-15 membri attivi piuttosto che numeri. Organizza eventi settimanali.',
      effort: 'medio',
      impact: 'alto'
    });
  }
  
  // Raccomandazioni eventi
  recs.push({
    category: 'Eventi',
    priority: 'medium',
    title: 'Calendario eventi regolari',
    description: 'Game nights settimanali, tornei mensili, giveaway Nitro aumentano attività.',
    effort: 'medio',
    impact: 'alto'
  });
  
  // Raccomandazioni monetizzazione
  if (!analysis.mee6Integration.managedFeatures.includes('monetization')) {
    recs.push({
      category: 'Monetizzazione',
      priority: 'low',
      title: 'Prepara per monetizzazione',
      description: 'Con 500+ membri puoi attivare Discord Server Subscriptions o MEE6 Premium features.',
      effort: 'medio',
      impact: 'medio'
    });
  }
  
  return recs.sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 };
    return order[a.priority] - order[b.priority];
  });
}

function generateProposedChanges(analysis, phase) {
  const changes = [];
  
  // Proponi creazione canali mancanti
  analysis.benchmark.missingEssential.forEach(ch => {
    changes.push({
      action: 'create',
      type: 'channel',
      name: `#${ch}`,
      reason: 'Canale essenziale mancante',
      autoApply: false
    });
  });
  
  // Proponi merge canali se over_scaled
  if (analysis.benchmark.excess.length > 0) {
    const textChannels = analysis.currentStructure.textChannels;
    const duplicatePatterns = findDuplicateChannels(textChannels);
    
    duplicatePatterns.forEach(dup => {
      changes.push({
        action: 'merge',
        type: 'channels',
        targets: dup.channels,
        into: dup.suggested,
        reason: 'Canali simili che possono essere uniti',
        autoApply: false
      });
    });
  }
  
  // Proponi archiviazione categorie vuote
  analysis.currentStructure.categories.forEach(cat => {
    const channelsInCat = analysis.currentStructure.textChannels.filter(c => c.category === cat);
    if (channelsInCat.length === 0) {
      changes.push({
        action: 'archive',
        type: 'category',
        name: cat,
        reason: 'Categoria senza canali',
        autoApply: false
      });
    }
  });
  
  return changes;
}

function findDuplicateChannels(channels) {
  const duplicates = [];
  const patterns = [
    { regex: /game|gaming|giochi/i, suggested: 'gaming' },
    { regex: /chat|talk|discuss/i, suggested: 'general-chat' },
    { regex: /clip|video|highlight/i, suggested: 'media' },
    { regex: /help|support|aiuto/i, suggested: 'support' }
  ];
  
  patterns.forEach(pattern => {
    const matches = channels.filter(c => pattern.regex.test(c.name));
    if (matches.length > 2) {
      duplicates.push({
        channels: matches.map(c => c.name).slice(0, 4),
        suggested: pattern.suggested
      });
    }
  });
  
  return duplicates;
}

export function formatStructure360Report(analysis) {
  let text = `# 🏗️ Analisi Struttura 360° - ${analysis.phase}\n\n`;
  
  text += `**📊 Stato Attuale**\n`;
  text += `• Membri: ${analysis.memberCount}\n`;
  text += `• Canali testo: ${analysis.currentStructure.textChannels.length}\n`;
  text += `• Canali vocali: ${analysis.currentStructure.voiceChannels.length}\n`;
  text += `• Categorie: ${analysis.currentStructure.categories.length}\n`;
  if (analysis.currentStructure.privateChannels > 0) {
    text += `• Canali privati (non visibili): ~${analysis.currentStructure.privateChannels}\n`;
  }
  text += `\n`;
  
  text += `**🎯 Punteggio Benchmark Gaming 2025: ${analysis.benchmark.score}/100**\n\n`;
  
  if (analysis.benchmark.wellConfigured.length > 0) {
    text += `✅ **Ben configurato:** ${analysis.benchmark.wellConfigured.join(', ')}\n`;
  }
  
  if (analysis.benchmark.missingEssential.length > 0) {
    text += `❌ **Mancanti essenziali:** ${analysis.benchmark.missingEssential.join(', ')}\n`;
  }
  
  if (analysis.benchmark.excess.length > 0) {
    const ex = analysis.benchmark.excess[0];
    text += `⚠️ **Eccesso:** ${ex.current} canali (consigliati: ${ex.recommended})\n`;
  }
  text += `\n`;
  
  if (analysis.mee6Integration.detected) {
    text += `**🤖 MEE6 Integration**\n`;
    text += `• Rilevato: ✅\n`;
    text += `• Funzionalità attive: ${analysis.mee6Integration.managedFeatures.join(', ') || 'Nessuna rilevata'}\n`;
    text += `• Friday evita duplicazioni con MEE6\n\n`;
  }
  
  if (analysis.recommendations360.length > 0) {
    text += `**💡 Raccomandazioni 360°**\n`;
    analysis.recommendations360.slice(0, 6).forEach((rec, i) => {
      const icon = rec.priority === 'high' ? '🔴' : rec.priority === 'medium' ? '🟡' : '🟢';
      text += `${icon} **${rec.category}**: ${rec.title}\n`;
      text += `   └ ${rec.description}\n`;
    });
    text += `\n`;
  }
  
  if (analysis.proposedChanges.length > 0) {
    text += `**🔧 Modifiche Proposte** (richiede approvazione)\n`;
    analysis.proposedChanges.slice(0, 5).forEach(change => {
      const icon = change.action === 'create' ? '➕' : change.action === 'merge' ? '🔀' : '📦';
      if (change.action === 'merge') {
        text += `${icon} Unisci: ${change.targets.join(', ')} → #${change.into}\n`;
      } else {
        text += `${icon} ${change.action}: ${change.name || change.targets?.join(', ')}\n`;
      }
    });
  }
  
  return text;
}
