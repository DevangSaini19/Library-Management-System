/**
 * Create `server/.env` from `server/.env.example` if it does not exist yet.
 * Run through `npm run setup` (repo root) or `node scripts/setup-env.mjs`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'server', '.env');
const template = path.join(root, 'server', '.env.example');

if (!fs.existsSync(target)) {
    if (!fs.existsSync(template)) {
        console.error(`✖ ${path.relative(root, template)} is missing — cannot create server/.env.`);
        process.exit(1);
    }
    fs.copyFileSync(template, target);
    console.log(`✔ created server/.env with local development defaults`);
} else {
    console.log(`✔ server/.env already exists — left untouched`);
}

const contents = fs.readFileSync(target, 'utf8');
const uri = readVar(contents, 'DATABASE_URI');

if (!uri) {
    console.warn('⚠ server/.env has no DATABASE_URI. Add one before starting the server.');
} else if (uri.includes('REPLACE') || uri === 'mongodb+srv://user:password@cluster') {
    console.warn(`⚠ server/.env still has the placeholder DATABASE_URI (${uri}).`);
    console.warn('  Point it at a local MongoDB (npm run db:start) or your Atlas cluster.');
}

/** Read a single KEY=value out of .env file contents. */
function readVar(text, key) {
    for (const line of text.split(/\r?\n/)) {
        const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
        if (match?.[1] === key) {
            return match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
        }
    }
    return undefined;
}
