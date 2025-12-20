# Discord Community Bot (Friday)

## Overview

Bot Discord avanzato per la gestione e analisi di server community Oasis Gamers Hub. Offre audit di sicurezza, controllo separazione fasce d'età, suggerimenti AI per la crescita della community, azioni automatiche per correggere problemi, protezione anti-raid, backup configurazione e dashboard web interattiva con autenticazione OAuth2 Discord.

## User Preferences

Preferred communication style: Simple, everyday language (Italian)

## Recent Changes

- **2024-12-20**: Sistema Automazioni Complete
  - Scalecheck automatico ogni 6 ore con cache sharedState
  - Report giornaliero via DM all'owner alle 21:00
  - Backup automatico settimanale della configurazione
  - Notifiche milestone (50, 100, 250, 500, 750, 1000 membri)
  - Scalecheck remoto dalla dashboard (nuovo Quick Action)
  - Indicatore dati live/stimati nel pannello Growth
  - Funzioni `runAutoScalecheck()`, `runDailyReport()`, `runWeeklyBackup()`, `checkMilestones()`
- **2024-12-20**: Sistema Scaling & Economy Analysis
  - Nuovo comando `!scalecheck` per analisi completa scaling server e MEE6 economy
  - Dashboard pannello "Growth" con progresso obiettivo 1000 membri
  - Analisi saturazione canali, ruoli orfani, bilanciamento staff
  - Rilevamento MEE6 economy, achievements, monetization
  - Trend settimanali (join, leave, messaggi) con raccomandazioni prioritizzate
  - Funzioni `analyzeServerScaling()`, `checkMEE6Economy()`, `formatScalingReport()`
  - API endpoint `/api/growth` per dati live nella dashboard
- **2024-12-20**: Generazione testi AI
  - Nuovo comando `!testi` per suggerimenti testo personalizzati
  - Genera messaggi benvenuto, regole, descrizioni canali pronti all'uso
  - Rileva elementi mancanti (regole, benvenuto, annunci, presentazioni, ruoli)
  - Funzioni `generateTextSuggestions()` e `formatTextSuggestions()` in serverAnalyzer.js
- **2024-12-20**: Sistema coda comandi dashboard-bot
  - Comunicazione dashboard-bot via MongoDB (pendingCommands collection)
  - Polling comandi ogni 5 secondi nel bot
  - Dashboard può avviare audit e backup in remoto
  - API endpoint `/api/action/:action` con coda persistente
- **2024-12-19**: Dashboard interattiva potenziata
  - Nuovo tab "Azioni" con Quick Actions (Audit, Backup, Security Check, Refresh Stats)
  - Configurazione Anti-Raid dalla dashboard (soglia join, finestra tempo)
  - Lista backup salvati con timestamp e dettagli
  - Risultato ultimo comando eseguito in tempo reale
  - API endpoints: POST /api/action/:action, POST /api/config/antiraid
- **2024-12-19**: Grafici extra per analytics avanzate
  - Grafico a barre per attivita messaggi (30 giorni)
  - Grafico dual-line per flusso membri Join/Leave (verde/rosso)
  - Metriche giornaliere: messageCount, joinCount, leaveCount persistite su MongoDB
  - Reset automatico contatori a mezzanotte con persistenza
  - Handler guildMemberRemove per tracciare le leave
  - Idratazione contatori da database al riavvio (nessuna perdita dati)
- **2024-12-19**: Sistema sicurezza all'avanguardia
  - Headers HTTP sicuri (CSP, HSTS, X-Frame-Options, X-XSS-Protection)
  - Rate limiting API (60 richieste/min per IP)
  - Protezione brute-force (5 tentativi = blocco 15 min)
  - Audit log sicurezza con tracking IP
  - Sessioni sicure (HttpOnly, SameSite strict, timeout 4h)
  - Tab Sicurezza nella dashboard con statistiche live
  - Logging eventi login/logout/accessi negati
- **2024-12-19**: Dashboard interattiva con statistiche live
  - Interfaccia a 6 tab (Overview, Azioni, Sicurezza, Attivita, Comandi, Funzionalita)
  - Grafici Chart.js per trend crescita 30 giorni
  - API endpoints per dati live (/api/status, /api/activity, /api/metrics, /api/audits, /api/backups, /api/security)
  - Alert anti-raid in tempo reale sulla dashboard
  - Modulo sharedState.js per comunicazione bot-to-dashboard
- **2024-12-19**: Sistema anti-raid e backup
  - Protezione anti-raid: rileva 10+ join in 30 secondi, notifica owner
  - Comando `!backup` per salvare ruoli, canali e permessi su MongoDB (max 10 backup)
  - Funzioni database per gestione backup configurazione
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
  - `!backup` - Crea backup configurazione server (ruoli, canali, permessi)
  - `!testi` - Genera suggerimenti testo AI (benvenuto, regole, descrizioni)
  - `!scalecheck` - Analisi scaling server + MEE6 economy/monetization
  - `!help` - Lista comandi
- Tracciamento statistiche in-memory e su MongoDB (join, messaggi, attività canali)
- Sistema di snapshot per tracciare evoluzione struttura nel tempo
- Trend analysis con confronto metriche settimanali
- Sistema anti-raid automatico con notifica owner

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
- `generateTextSuggestions()` - Genera testi AI per canali mancanti:
  - Messaggi di benvenuto personalizzati
  - Regole del server numerate
  - Descrizioni per canali (generale, gaming, off-topic)
  - Messaggi per selezione ruoli
  - Template per annunci
- `formatTextSuggestions()` - Formatta suggerimenti testo per Discord
- `checkMEE6Compatibility()` - Analizza simbiosi con MEE6 Premium:
  - Rileva presenza MEE6 nel server
  - Identifica funzionalità MEE6 attive (leveling, welcome, mod-log, reaction roles)
  - Analizza canali usati da MEE6
  - Verifica conflitti di permessi/gerarchia ruoli
  - Genera punteggio simbiosi e raccomandazioni

### Shared State Module (modules/sharedState.js)
- Stato condiviso tra bot Discord e web server
- `setBotOnline()` / `getBotStatus()` - Stato bot e uptime
- `updateGuildStats()` / `getGuildStats()` - Statistiche guild
- `addActivityLog()` / `getActivityLog()` - Log attività per dashboard
- `setAntiRaidStatus()` / `getAntiRaidStatus()` - Stato anti-raid

### Web Dashboard (server.js)
- Express 5.x su porta 5000
- Autenticazione OAuth2 Discord con protezione CSRF (state parameter)
- Sessioni sicure con express-session
- Dashboard interattiva con 4 tab (Overview, Attività, Comandi, Funzionalità)
- Grafici Chart.js per trend crescita 30 giorni
- API endpoints protetti per dati live:
  - GET /api/status - Stato bot e guild
  - GET /api/activity - Log attività recenti
  - GET /api/metrics - Metriche 30 giorni per grafici
  - GET /api/audits - Storico audit
  - GET /api/backups - Lista backup configurazione
- Alert anti-raid in tempo reale

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
├── server.js             # Web server con OAuth2 e API
├── start.js              # Script avvio produzione
├── Dockerfile            # Container per Fly.io
├── fly.toml              # Config Fly.io
├── package.json          # Dipendenze Node.js
├── modules/
│   ├── serverAnalyzer.js # Modulo analisi server
│   ├── database.js       # Connessione MongoDB + funzioni backup
│   ├── cache.js          # Cache audit con TTL
│   └── sharedState.js    # Stato condiviso bot-dashboard
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
