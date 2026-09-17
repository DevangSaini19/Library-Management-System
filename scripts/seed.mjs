/**
 * Seed a MongoDB database with the sample library data that ships in this repo
 * (`.devcontainer/data/library/*.bson`, i.e. the same dump the devcontainer restores).
 *
 * It only needs Node.js — no MongoDB Database Tools (`mongorestore`) required — and
 * works the same on macOS, Linux and Windows.
 *
 * Usage (from the repo root):
 *   npm run db:seed                     # drop + restore the configured database
 *   npm run db:seed -- --dry-run        # validate the data files, don't touch the DB
 *   npm run db:seed -- --keep           # insert without dropping existing documents
 *   npm run db:seed -- --uri mongodb://127.0.0.1:27017 --db library --dir path/to/dump
 *
 * Connection settings come from `server/.env` (DATABASE_URI / DATABASE_NAME) unless
 * overridden by the environment or the flags above.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoClient, BSON } from 'mongodb';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = parseArgs(process.argv.slice(2));

if (args.help) {
    printHelp();
    process.exit(0);
}

const envFile = path.join(root, 'server', '.env');
const env = { ...parseEnvFile(envFile), ...process.env };

const uri = args.uri || env.DATABASE_URI;
const dbName = args.db || env.DATABASE_NAME || 'library';
const dataDir = args.dir
    ? path.resolve(root, args.dir)
    : path.join(root, '.devcontainer', 'data', 'library');

if (!uri) {
    fail(
        `No connection string found.\n` +
        `  Set DATABASE_URI in server/.env (npm run setup creates it), or pass --uri mongodb://127.0.0.1:27017`
    );
}

if (!fs.existsSync(dataDir)) {
    fail(`Sample data directory not found: ${path.relative(root, dataDir)}`);
}

const collections = fs
    .readdirSync(dataDir)
    .filter((file) => file.endsWith('.bson'))
    .map((file) => ({
        name: file.replace(/\.bson$/, ''),
        bsonFile: path.join(dataDir, file),
        metaFile: path.join(dataDir, `${file.replace(/\.bson$/, '')}.metadata.json`),
    }));

if (!collections.length) {
    fail(`No .bson files in ${path.relative(root, dataDir)} — nothing to import.`);
}

console.log(`Importing sample library data\n  database: ${dbName}\n  files:    ${path.relative(root, dataDir)}\n`);

let totalDocuments = 0;
const client = args.dryRun ? undefined : await connect();
const db = client?.db(dbName);

for (const collection of collections) {
    const documents = readBsonFile(collection.bsonFile);
    const size = formatBytes(fs.statSync(collection.bsonFile).size);
    totalDocuments += documents.length;

    if (args.dryRun) {
        console.log(`  ${pad(collection.name)} ${documents.length} documents, ${size} — ok`);
        continue;
    }

    const indexes = readIndexes(collection.metaFile);
    await writeCollection(db, collection.name, documents, indexes);
    console.log(
        `  ${pad(collection.name)} ${documents.length} documents, ${size}` +
        `${indexes.length ? `, ${indexes.length} index(es)` : ''}`
    );
}

if (args.dryRun) {
    console.log(`\n✔ ${totalDocuments} documents validated (--dry-run: database untouched).`);
    process.exit(0);
}

await client.close();
console.log(`\n✔ Done — ${totalDocuments} documents loaded into "${dbName}".`);
console.log('  Start everything with `npm run dev`, then open http://localhost:4200');

/**
 * @param {import('mongodb').Db} db
 * @param {string} name
 * @param {object[]} documents
 * @param {{key: Record<string, number>, name?: string, unique?: boolean}[]} indexes
 */
async function writeCollection(db, name, documents, indexes) {
    const collection = db.collection(name);

    if (!args.keep) {
        await collection.deleteMany({});
    }

    // Insert in chunks so a 12 MB dump doesn't become one oversized write command.
    const chunkSize = 500;
    for (let i = 0; i < documents.length; i += chunkSize) {
        await collection.insertMany(documents.slice(i, i + chunkSize), { ordered: true });
    }

    for (const index of indexes) {
        await collection.createIndex(index.key, { name: index.name, unique: !!index.unique });
    }
}

async function connect() {
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 });
    try {
        await client.connect();
        await client.db(dbName).command({ ping: 1 });
        return client;
    } catch (error) {
        fail(
            `Could not reach MongoDB at ${redact(uri)}.\n` +
            `  • Docker:      npm run db:start     (starts mongodb://127.0.0.1:27017)\n` +
            `  • Local mongod: mongod --dbpath <directory>\n` +
            `  • Atlas:        put your SRV string in DATABASE_URI inside server/.env\n` +
            `  Original error: ${error.message}`
        );
    }
}

/** Read a mongodump `.bson` file (concatenated length-prefixed BSON documents). */
function readBsonFile(file) {
    const buffer = fs.readFileSync(file);
    const documents = [];
    let offset = 0;

    while (offset + 4 <= buffer.length) {
        const size = buffer.readInt32LE(offset);
        if (size < 5 || offset + size > buffer.length) {
            fail(`Malformed BSON stream in ${path.relative(root, file)} (offset ${offset}).`);
        }
        documents.push(BSON.deserialize(buffer.subarray(offset, offset + size)));
        offset += size;
    }

    return documents;
}

/** Pull the usable secondary indexes out of a mongodump `.metadata.json` file. */
function readIndexes(metaFile) {
    if (!fs.existsSync(metaFile)) {
        return [];
    }

    let meta;
    try {
        // The dump uses MongoDB Extended JSON, e.g. {"$numberInt": "1"}.
        meta = BSON.EJSON.parse(fs.readFileSync(metaFile, 'utf8'));
    } catch (error) {
        console.warn(`  ! skipping indexes in ${path.basename(metaFile)}: ${error.message}`);
        return [];
    }

    return (meta?.indexes ?? [])
        .filter((index) => index?.key && index.name !== '_id_')
        .map((index) => ({ key: index.key, name: index.name, unique: index.unique }));
}

function parseEnvFile(file) {
    if (!fs.existsSync(file)) {
        return {};
    }

    const values = {};
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
        const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
        if (!match || match[2].trim().startsWith('#')) {
            continue;
        }
        values[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
    }
    return values;
}

function parseArgs(argv) {
    const knownValueFlags = ['uri', 'db', 'dir'];
    const knownFlags = [...knownValueFlags, 'dry-run', 'keep', 'help'];
    const parsed = {};

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];

        if (!arg.startsWith('--') || !knownFlags.includes(arg.slice(2))) {
            fail(`Unknown argument "${arg}". Run with --help for usage.`);
        }

        const key = arg.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
        if (knownValueFlags.includes(key)) {
            parsed[key] = argv[++i];
            if (parsed[key] === undefined) {
                fail(`--${arg.slice(2)} needs a value.`);
            }
        } else {
            parsed[key] = true;
        }
    }
    return parsed;
}

/** Hide credentials when printing a connection string. */
function redact(connection) {
    return connection.replace(/\/\/[^@/]+@/, '//***:***@');
}

function fail(message) {
    console.error(`\n✖ ${message}\n`);
    process.exit(1);
}

function pad(text) {
    return text.padEnd(14);
}

function formatBytes(bytes) {
    return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} kB`;
}

function printHelp() {
    console.log(`Usage: node scripts/seed.mjs [options]

  --dry-run     Validate the data files without connecting to MongoDB
  --keep        Insert documents instead of clearing each collection first
  --uri <uri>   Connection string (default: DATABASE_URI from server/.env)
  --db <name>   Database name (default: DATABASE_NAME from server/.env, else "library")
  --dir <path>  Directory with mongodump .bson/.metadata.json files
  --help        Show this message`);
}
