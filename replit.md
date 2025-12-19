# Discord Community Bot

## Overview

Bot Discord avanzato per la gestione e analisi di server community. Offre audit di sicurezza, controllo separazione fasce d'età, suggerimenti AI per la crescita della community, e azioni automatiche per correggere problemi. Include una dashboard web con autenticazione OAuth2 Discord.

## User Preferences

Preferred communication style: Simple, everyday language (Italian)

## Recent Changes

- **2024-12-19**: Ottimizzazioni scalabilità e performance
  - Nuovo modulo cache.js per caching risultati audit (6 ore TTL)
  - Rate limiting su comandi costosi (audit: 10 min, mee6: 5 min)
  - Batching ottimizzato scritture MongoDB (ogni 100 messaggi)
  - TTL indexes automatici per auto-pulizia dati vecchi (30-90 giorni)
  - Supporto `!audit --force` per bypassare cache
- **2024-12-19**: Sistema compatibilità MEE6 Premium
  - Nuovo comando `!mee6` per check compatibilità con MEE6
  - Rilevamento automatico funzionalità MEE6 attive (leveling, welcome, mod-log, reaction roles)
  - Analisi simbiosi Friday + MEE6 con punteggio
  - Integrazione nel report !audit con sezione dedicata MEE6
  - Friday evita duplicazioni: non tocca mai funzioni già gestite da MEE6
- **2024-12**: Aggiunta configurazione deploy Fly.io + MongoDB
  - Dockerfile e fly.toml per deploy su Fly.io
  - Modulo database.js per persistenza dati su MongoDB Atlas
  - Script start.js per avvio produzione
- **2024-12**: Implementate funzionalità complete di analisi server
  - Modulo serverAnalyzer.js per analisi struttura, sicurezza, e separazione età
  - Integrazione OpenAI per suggerimenti AI intelligenti
  - Sistema di azioni automatiche (!fix) per correggere problemi
  - Dashboard web aggiornata con visualizzazione comandi
  - Protezione CSRF nel flusso OAuth2

## System Architecture

### Discord Bot (index.js)
- discord.js v14 per interazioni API Discord
- Comandi disponibili:
  - `!ping` - Test connessione
  - `!info` - Info server
  - `!stats` - Statistiche server
  - `!audit` - Analisi completa con AI (suggerimenti graduali in 3 fasi + check MEE6)
  - `!security` - Report sicurezza
  - `!age` - Controllo separazione fasce d'età
  - `!schema` - Mappa visuale struttura server (categorie, canali, ruoli)
  - `!trend` - Andamento e trend crescita community
  - `!mee6` - Check compatibilità con MEE6 Premium (simbiosi, funzioni rilevate, conflitti)
  - `!fix <azione>` - Applica correzioni automatiche (riusa ruoli esistenti)
  - `!help` - Lista comandi
- Tracciamento statistiche in-memory e su MongoDB (join, messaggi, attività canali)
- Sistema di snapshot per tracciare evoluzione struttura nel tempo
- Trend analysis con confronto metriche settimanali

### Server Analyzer Module (modules/serverAnalyzer.js)
- `findExistingAgeRoles()` - Cerca ruoli età già esistenti (fuzzy matching)
- `analyzeServerStructure()` - Mappa canali, categorie, ruoli, permessi
- `checkAgeSeparation()` - Verifica separazione minorenni/adulti
- `getSecurityReport()` - Report completo sicurezza con punteggio
- `getAIRecommendations()` - Suggerimenti AI graduali in 3 fasi (breve/medio/lungo termine)
- `executeAction()` - Esegue correzioni automatiche (riusa ruoli esistenti):
  - createAgeRoles - Riusa o crea ruoli Under18/Over18
  - blockMinorsFromNSFW - Blocca minorenni da canali NSFW
  - increaseVerification - Aumenta livello verifica
  - disableEveryoneInvites - Disabilita inviti per @everyone
- `formatReport()` - Formatta report per Discord con fasi
- `generateServerSchema()` - Genera mappa visuale struttura server
- `checkMEE6Compatibility()` - Analizza simbiosi con MEE6 Premium:
  - Rileva presenza MEE6 nel server
  - Identifica funzionalità MEE6 attive (leveling, welcome, mod-log, reaction roles)
  - Analizza canali usati da MEE6
  - Verifica conflitti di permessi/gerarchia ruoli
  - Genera punteggio simbiosi e raccomandazioni

### Web Dashboard (server.js)
- Express 5.x su porta 5000
- Autenticazione OAuth2 Discord con protezione CSRF (state parameter)
- Sessioni sicure con express-session
- Dashboard con overview comandi e funzionalità

### AI Integration
- OpenAI via Replit AI Integrations
- Modello gpt-4o per raccomandazioni intelligenti
- Nessuna API key richiesta (usa crediti Replit)

## Environment Variables Required

- `DISCORD_BOT_TOKEN` - Token del bot Discord
- `DISCORD_CLIENT_ID` - Client ID applicazione Discord
- `DISCORD_CLIENT_SECRET` - Client Secret per OAuth2
- `SESSION_SECRET` - Chiave per sessioni web
- `MONGODB_URI` - (opzionale) Connection string MongoDB Atlas
- `AI_INTEGRATIONS_OPENAI_API_KEY` - (automatico da Replit)
- `AI_INTEGRATIONS_OPENAI_BASE_URL` - (automatico da Replit)

## File Structure

```
/
├── index.js              # Bot Discord principale
├── server.js             # Web server con OAuth2
├── start.js              # Script avvio produzione
├── Dockerfile            # Container per Fly.io
├── fly.toml              # Config Fly.io
├── package.json          # Dipendenze Node.js
├── modules/
│   ├── serverAnalyzer.js # Modulo analisi server
│   └── database.js       # Connessione MongoDB
└── .replit_integration_files/  # File integrazione AI (non modificare)
```

## Deploy su Fly.io

1. Installa Fly CLI: `curl -L https://fly.io/install.sh | sh`
2. Login: `fly auth login`
3. Launch: `fly launch --name friday-discord-bot`
4. Configura secrets:
   - `fly secrets set DISCORD_BOT_TOKEN="..."`
   - `fly secrets set DISCORD_CLIENT_ID="..."`
   - `fly secrets set DISCORD_CLIENT_SECRET="..."`
   - `fly secrets set SESSION_SECRET="..."`
   - `fly secrets set MONGODB_URI="..."` (opzionale)
5. Deploy: `fly deploy`

## External Dependencies

- discord.js v14.x - Framework Discord
- express v5.x - Web server
- express-session - Gestione sessioni
- cookie-parser - Cookie handling
- openai - SDK OpenAI
- mongodb - Driver MongoDB
- p-limit, p-retry - Rate limiting e retry
