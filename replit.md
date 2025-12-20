## Overview

This project is an advanced Discord bot designed for managing and analyzing the Oasis Gamers Hub community server. It provides security audits, age-gating control, AI-powered community growth suggestions, automatic problem-solving actions, anti-raid protection, configuration backups, and an interactive web dashboard with Discord OAuth2 authentication. The bot aims to ensure server health, promote growth, and offer a professional management interface.

## User Preferences

Preferred communication style: Simple, everyday language (Italian)

## System Architecture

### UI/UX Decisions

The web dashboard features a professional design using CSS variables with a brand palette of teal (#4FD1C5) and golden (#D4A373). It employs Space Grotesk for titles and Inter for body text, along with a sophisticated dark theme, radial gradients, and glass-morphism effects. Interactive elements like tabbed navigation with pill-container styling, animated hover effects, and custom scrollbars are implemented. All styling utilizes CSS variables for consistency, removing inline styles. Chart.js colors are updated to match the brand palette.

### Technical Implementations

The system consists of a Discord bot built with `discord.js v14` and a web dashboard using `Express 5.x`. Data persistence is handled by MongoDB Atlas. Key modules include:

-   **Discord Bot (`index.js`):** Manages Discord API interactions, handles various commands for server analysis, security, age verification, structure mapping, trend analysis, MEE6 compatibility checks, automatic fixes, backups, AI text generation, and scaling analysis. It also includes an automatic anti-raid system.
-   **Server Analyzer (`modules/serverAnalyzer.js`):** Core logic for server analysis, including structure mapping, age separation checks, security reporting, and AI-driven recommendations using OpenAI. It can execute automatic corrections and generate server schemas and AI-powered text suggestions for server content. It also includes comprehensive MEE6 compatibility analysis to prevent feature duplication.
-   **Shared State (`modules/sharedState.js`):** Facilitates real-time communication and data sharing between the Discord bot and the web dashboard for statuses, statistics, activity logs, and anti-raid status.
-   **Web Dashboard (`server.js`):** Provides an interactive interface with OAuth2 Discord authentication, secure sessions, and multiple tabs (Overview, Actions, Security, Activity, Commands, Functionality). It displays live statistics, audit logs, backup lists, and real-time anti-raid alerts using Chart.js for data visualization. It also supports remote actions via a command queuing system.
-   **Automations:** Includes automatic scale checks every 6 hours, daily reports, weekly configuration backups, and milestone notifications.
-   **Security:** Implements secure HTTP headers, API rate limiting, brute-force protection, security audit logs, and secure sessions.

### Feature Specifications

-   **360° Structure Analysis:** Command `!structure` provides a comprehensive server analysis against 2025 gaming benchmarks, identifying private channels, and offering prioritized recommendations for structure, scalability, engagement, growth, events, and monetization. It also proposes concrete changes (create, merge, archive) and integrates with MEE6 to avoid duplication.
-   **Scaling & Economy Analysis:** Command `!scalecheck` analyzes server scaling, MEE6 economy, and offers prioritized recommendations based on weekly trends (joins, leaves, messages).
-   **AI Text Generation:** Command `!testi` generates personalized welcome messages, rules, channel descriptions, and other essential server texts, detecting missing elements.
-   **Anti-Raid System:** Automatically detects rapid joins (10+ in 30 seconds) and notifies the owner, with configuration options available via the dashboard.
-   **Backup System:** Command `!backup` allows saving server configuration (roles, channels, permissions) to MongoDB, with automatic weekly backups.
-   **MEE6 Compatibility:** Command `!mee6` checks for active MEE6 features to ensure harmonious operation and avoid conflicts, with a symbiosis score.
-   **Advanced Analytics:** Tracks daily metrics (message count, join count, leave count) persisted to MongoDB and visualizes trends through Chart.js graphs on the dashboard.
-   **Command Queue:** Dashboard-bot communication is managed via a MongoDB pendingCommands collection, allowing the dashboard to initiate remote actions.
-   **Invite Tracking System:** Complete invite tracking with:
    -   Automatic detection of which invite was used when members join (cache comparison)
    -   MongoDB persistence of all invites (inviter, invited, code, valid flag, timestamp)
    -   Milestone rewards at thresholds: 5, 10, 25, 50, 100 invites
    -   Automatic role creation and assignment for milestones (with unique colors)
    -   DM notifications with MEE6 coins suggestion for manual payout
    -   Dashboard tab "Inviti" with leaderboard (top 10), milestone display, recent invites feed
-   **Financial Hub:** Tab dedicated to cost monitoring and MEE6 shop analysis. Features include:
    -   **Costi & Limiti Panel:** Visual progress bars tracking free-tier service usage (MongoDB Atlas M0 512MB, Fly.io 3 VMs + 160GB, OpenAI calls/month, Discord API).
    -   **MEE6 Shop Analyzer:** Copy-paste parser (block-based, blank-line delimited) to import shop items from MEE6 dashboard exports. Zero API cost approach.
    -   **Actionable Suggestions Engine:** Rule-based analysis (without AI) providing optimization tips: price gap analysis, item type variety, expensive item warnings, shop size recommendations.
    -   **Shop Items Database:** MongoDB collections for persisting shop items, service costs, and economy analysis data.

### System Design Choices

The architecture is designed for scalability and performance, utilizing caching for audit results (6-hour TTL), rate limiting on intensive commands, optimized MongoDB batching, and automatic TTL indexes for data cleanup. The bot and dashboard run within the same process on Fly.io to facilitate shared state management. Deployment is managed via Docker and GitHub Actions for continuous integration.

## External Dependencies

-   **discord.js v14.x:** Discord API interaction.
-   **express v5.x, express-session, cookie-parser:** Web server, session management, and cookie handling for the dashboard.
-   **mongodb:** MongoDB driver for database interactions.
-   **openai:** OpenAI SDK for AI-powered features (utilizes Replit AI Integrations).
-   **p-limit, p-retry:** Utilities for rate limiting and retrying operations.