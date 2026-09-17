import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

// Resolve .env relative to this file (i.e. server/.env) instead of the current
// working directory, so the server starts the same way from `npm start`, nodemon,
// a debugger or `node dist/server.js` at any cwd.
const envPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env');

dotenv.config({ path: envPath });
