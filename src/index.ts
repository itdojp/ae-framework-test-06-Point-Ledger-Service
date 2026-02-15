import { buildApp } from './http/app.js';
import { LedgerService } from './services/ledger-service.js';

const port = Number(process.env['PORT'] ?? 3000);
const host = process.env['HOST'] ?? '0.0.0.0';
const stateFilePath = process.env['LEDGER_STATE_FILE'];

const service = new LedgerService({ stateFilePath });
if (stateFilePath) {
  await service.loadStateFromFile(stateFilePath);
}

const app = buildApp(service);
app.listen({ port, host }).catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
