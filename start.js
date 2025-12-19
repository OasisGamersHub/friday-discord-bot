import { spawn } from 'child_process';

console.log('Avvio servizi...');

const bot = spawn('node', ['index.js'], { stdio: 'inherit' });
const server = spawn('node', ['server.js'], { stdio: 'inherit' });

bot.on('error', (err) => console.error('Errore bot:', err));
server.on('error', (err) => console.error('Errore server:', err));

process.on('SIGTERM', () => {
  bot.kill();
  server.kill();
  process.exit(0);
});
