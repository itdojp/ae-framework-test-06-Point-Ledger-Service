import { buildApp } from './http/app.js';

const app = buildApp();
const port = Number(process.env['PORT'] ?? 3000);
const host = process.env['HOST'] ?? '0.0.0.0';

app.listen({ port, host }).catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
