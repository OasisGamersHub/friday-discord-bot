import { PermissionFlagsBits, ChannelType } from 'discord.js';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

const AGE_ROLES = {
  minors: ['minore', 'under18', 'minorenne', '-18', 'teen', 'giovane'],
  adults: ['adulto', 'over18', 'maggiorenne', '+18', '18+', 'adult', 'nsfw']
};

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

export async function getAIRecommendations(report, guild) {
  const prompt = `Sei un esperto di community Discord. Analizza questo report del server "${guild.name}" e fornisci raccomandazioni specifiche e attuabili.

STRUTTURA SERVER:
- Membri: ${report.structure.memberCount}
- Categorie: ${report.structure.categories.length}
- Canali testo: ${report.structure.textChannels.length}
- Canali vocali: ${report.structure.voiceChannels.length}
- Ruoli: ${report.structure.roles.length}

PROBLEMI SICUREZZA (${report.securityIssues.length}):
${report.securityIssues.map(i => `- [${i.severity}] ${i.message}`).join('\n') || 'Nessuno'}

SEPARAZIONE ETÀ:
- Configurato: ${report.ageSeparation.configured ? 'Sì' : 'No'}
- Ruoli minorenni: ${report.ageSeparation.minorRoles.join(', ') || 'Nessuno'}
- Ruoli adulti: ${report.ageSeparation.adultRoles.join(', ') || 'Nessuno'}
- Problemi: ${report.ageSeparation.issues.map(i => i.message).join('; ') || 'Nessuno'}

PUNTEGGIO SICUREZZA: ${report.score}/100

Fornisci:
1. 3-5 migliorie prioritarie per la struttura del server
2. Strategie per aumentare engagement e crescita
3. Best practices per community sicure e scalabili
4. Azioni concrete che posso eseguire automaticamente

Rispondi in italiano in formato JSON con questa struttura:
{
  "priorityActions": [{"title": "", "description": "", "canAutomate": true/false, "automationAction": ""}],
  "growthStrategies": [{"title": "", "description": ""}],
  "bestPractices": [{"title": "", "description": ""}],
  "overallAssessment": ""
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
        const minorRole = await guild.roles.create({
          name: 'Under18',
          color: '#3498db',
          reason: 'Creato automaticamente per separazione età'
        });
        const adultRole = await guild.roles.create({
          name: 'Over18',
          color: '#e74c3c',
          reason: 'Creato automaticamente per separazione età'
        });
        results.success = true;
        results.message = 'Ruoli età creati con successo';
        results.details = { minorRole: minorRole.name, adultRole: adultRole.name };
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

export function formatReport(report, aiRecommendations) {
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

  if (aiRecommendations && aiRecommendations.priorityActions) {
    text += `\n**💡 Raccomandazioni AI:**\n`;
    aiRecommendations.priorityActions.slice(0, 3).forEach((action, i) => {
      text += `${i + 1}. **${action.title}**\n   ${action.description}\n`;
      if (action.canAutomate) {
        text += `   ✅ *Automatizzabile con* \`!fix ${action.automationAction}\`\n`;
      }
    });
  }

  return text;
}
