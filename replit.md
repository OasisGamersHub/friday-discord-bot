# Discord Community Bot

## Overview

Bot Discord avanzato per la gestione e analisi di server community. Offre audit di sicurezza, controllo separazione fasce d'età, suggerimenti AI per la crescita della community, e azioni automatiche per correggere problemi. Include una dashboard web con autenticazione OAuth2 Discord.

## User Preferences

Preferred communication style: Simple, everyday language (Italian)

## Recent Changes

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
  - `!audit` - Analisi completa con AI
  - `!security` - Report sicurezza
  - `!age` - Controllo separazione fasce d'età
  - `!fix <azione>` - Applica correzioni automatiche
  - `!help` - Lista comandi
- Tracciamento statistiche in-memory (join, messaggi, attività canali)

### Server Analyzer Module (modules/serverAnalyzer.js)
- `analyzeServerStructure()` - Mappa canali, categorie, ruoli, permessi
- `checkAgeSeparation()` - Verifica separazione minorenni/adulti
- `getSecurityReport()` - Report completo sicurezza con punteggio
- `getAIRecommendations()` - Suggerimenti AI tramite OpenAI
- `executeAction()` - Esegue correzioni automatiche:
  - createAgeRoles - Crea ruoli Under18/Over18
  - blockMinorsFromNSFW - Blocca minorenni da canali NSFW
  - increaseVerification - Aumenta livello verifica
  - disableEveryoneInvites - Disabilita inviti per @everyone
- `formatReport()` - Formatta report per Discord

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
- `AI_INTEGRATIONS_OPENAI_API_KEY` - (automatico da Replit)
- `AI_INTEGRATIONS_OPENAI_BASE_URL` - (automatico da Replit)

## File Structure

```
/
├── index.js              # Bot Discord principale
├── server.js             # Web server con OAuth2
├── package.json          # Dipendenze Node.js
├── modules/
│   └── serverAnalyzer.js # Modulo analisi server
└── .replit_integration_files/  # File integrazione AI (non modificare)
```

## External Dependencies

- discord.js v14.x - Framework Discord
- express v5.x - Web server
- express-session - Gestione sessioni
- cookie-parser - Cookie handling
- openai - SDK OpenAI
- p-limit, p-retry - Rate limiting e retry
