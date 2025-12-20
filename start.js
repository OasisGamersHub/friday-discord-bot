console.log('Avvio servizi...');

import('./server.js').catch(err => console.error('Errore server:', err));
import('./index.js').catch(err => console.error('Errore bot:', err));

process.on('SIGTERM', () => {
  console.log('Ricevuto SIGTERM, chiusura...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('Ricevuto SIGINT, chiusura...');
  process.exit(0);
});
