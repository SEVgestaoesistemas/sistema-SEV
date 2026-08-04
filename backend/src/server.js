import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';

const start = async () => {
  const config = loadConfig();
  const app = await buildApp({ config });

  if (app.db.available) {
    await app.db.query('SELECT 1');
  }

  const close = async signal => {
    app.log.info({ signal }, 'Encerrando API');
    await app.close();
    process.exit(0);
  };

  process.once('SIGINT', () => close('SIGINT'));
  process.once('SIGTERM', () => close('SIGTERM'));

  await app.listen({ port: config.port, host: config.host });
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  start().catch(error => {
    console.error(error);
    process.exit(1);
  });
}
