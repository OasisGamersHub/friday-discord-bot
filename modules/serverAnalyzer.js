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
  leveling: ['livello', 'level', 'xp', 'rank', 'classifica', 'leaderboard'],
  welcome: ['benvenuto', 'welcome', 'arrivals', 'arrivi', 'join'],
  moderation: ['mod-log', 'modlog', 'logs', 'warns', 'mute'],
  reactionRoles: ['reaction-role', 'ruoli', 'roles', 'self-assign']
};

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
    symbiosis: 'unknown',
    score: 100,
    detectedFeatures: [],
    conflicts: [],
    recommendations: [],
    channelsUsedByMEE6: [],
    webhooks: []
  };

  try {
    const members = await guild.members.fetch();
    const mee6Bot = members.get(MEE6_BOT_ID);
    
    if (!mee6Bot) {
      result.symbiosis = 'no_mee6';
      result.recommendations.push('MEE6 non rilevato. Friday può gestire tutte le funzionalità.');
      return result;
    }

    result.mee6Present = true;
    result.mee6Role = mee6Bot.roles.highest?.name || 'Nessun ruolo';

    const channels = guild.channels.cache;
    channels.forEach(channel => {
      if (channel.type !== 0) return;
      const lowerName = channel.name.toLowerCase();
      
      Object.entries(MEE6_FEATURES).forEach(([feature, keywords]) => {
        if (keywords.some(kw => lowerName.includes(kw))) {
          if (!result.detectedFeatures.includes(feature)) {
            result.detectedFeatures.push(feature);
          }
          result.channelsUsedByMEE6.push({
            name: channel.name,
            feature: feature
          });
        }
      });
    });

    const fridayFeatures = ['audit', 'security', 'age-separation', 'ticketing', 'ai-analysis'];
    const mee6Features = result.detectedFeatures;
    
    if (mee6Features.includes('leveling')) {
      result.recommendations.push('✅ Leveling gestito da MEE6 - Friday NON duplicherà questa funzione');
    }
    if (mee6Features.includes('welcome')) {
      result.recommendations.push('✅ Welcome gestito da MEE6 - Friday NON duplicherà questa funzione');
    }
    if (mee6Features.includes('moderation')) {
      result.recommendations.push('✅ Mod-log gestito da MEE6 - Friday si concentra su audit AI avanzato');
    }
    if (mee6Features.includes('reactionRoles')) {
      result.recommendations.push('✅ Reaction Roles gestiti da MEE6 - Friday NON li toccherà');
    }

    const mee6RolePosition = mee6Bot.roles.highest?.position || 0;
    const botMember = guild.members.me;
    const fridayRolePosition = botMember?.roles.highest?.position || 0;
    
    if (fridayRolePosition < mee6RolePosition) {
      result.conflicts.push({
        type: 'ROLE_HIERARCHY',
        severity: 'LOW',
        message: 'Friday ha un ruolo più basso di MEE6 (non è un problema)'
      });
    }

    const mee6Perms = mee6Bot.permissions;
    if (mee6Perms.has('Administrator')) {
      result.recommendations.push('⚠️ MEE6 ha permessi Admin - Friday eviterà conflitti di permessi');
    }

    if (result.conflicts.filter(c => c.severity === 'HIGH').length === 0) {
      result.symbiosis = 'excellent';
      result.score = 100;
    } else if (result.conflicts.filter(c => c.severity === 'MEDIUM').length > 0) {
      result.symbiosis = 'good';
      result.score = 80;
    } else {
      result.symbiosis = 'needs_attention';
      result.score = 60;
    }

    result.recommendations.push('🤝 Friday e MEE6 possono coesistere perfettamente!');
    result.recommendations.push('📊 Friday si occupa di: Audit AI, Sicurezza, Separazione Età, Ticketing');

  } catch (error) {
    console.error('MEE6 check error:', error);
    result.symbiosis = 'error';
    result.recommendations.push('Impossibile verificare completamente la compatibilità MEE6');
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
