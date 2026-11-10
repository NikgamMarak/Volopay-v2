// Storage. Locally it is one SQLite file. Online it can be a free Turso database
// (hosted SQLite), so the app runs on hosts that have no permanent disk.
import { createClient } from '@libsql/client';
import fs from 'node:fs';
import path from 'node:path';

const remoteUrl = process.env.TURSO_DATABASE_URL;
let url = remoteUrl;
if (!url) {
  const file = path.resolve(process.env.DB_PATH || path.join(process.cwd(), 'data', 'pitchpad.db'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  url = `file:${file}`;
}

const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN || undefined });
export const dbDescription = remoteUrl ? `Turso database ${remoteUrl}` : url;

const toObjects = (rs) => rs.rows.map((row) => Object.fromEntries(rs.columns.map((c, i) => [c, row[i]])));
const clean = (args) => args.map((v) => (v === undefined ? null : v));

function wrap(exec) {
  return {
    async all(sql, args = []) { return toObjects(await exec.execute({ sql, args: clean(args) })); },
    async get(sql, args = []) { return (await this.all(sql, args))[0]; },
    async run(sql, args = []) { return exec.execute({ sql, args: clean(args) }); },
  };
}

// Use `db` for single statements, `transaction` when several must succeed together.
export const db = wrap(client);

export async function transaction(fn) {
  const tx = await client.transaction('write');
  try {
    const result = await fn(wrap(tx));
    await tx.commit();
    return result;
  } catch (err) {
    try { await tx.rollback(); } catch { /* already closed */ }
    throw err;
  } finally {
    tx.close();
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS workspaces (
  id               TEXT PRIMARY KEY,
  email            TEXT NOT NULL UNIQUE,
  password_hash    TEXT NOT NULL,
  business_name    TEXT NOT NULL,
  business_email   TEXT NOT NULL DEFAULT '',
  business_address TEXT NOT NULL DEFAULT '',
  default_currency TEXT NOT NULL DEFAULT 'USD',
  default_tax_rate REAL NOT NULL DEFAULT 0,
  default_terms    TEXT NOT NULL DEFAULT '',
  writing_notes    TEXT NOT NULL DEFAULT '',
  mcp_token        TEXT NOT NULL UNIQUE,
  created_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS proposals (
  id             TEXT PRIMARY KEY,
  workspace_id   TEXT NOT NULL,
  share_id       TEXT NOT NULL UNIQUE,
  number         INTEGER NOT NULL,
  title          TEXT NOT NULL,
  client_name    TEXT NOT NULL DEFAULT '',
  client_company TEXT NOT NULL DEFAULT '',
  client_email   TEXT NOT NULL DEFAULT '',
  intro          TEXT NOT NULL DEFAULT '',
  sections       TEXT NOT NULL DEFAULT '[]',
  line_items     TEXT NOT NULL DEFAULT '[]',
  currency       TEXT NOT NULL,
  tax_rate       REAL NOT NULL DEFAULT 0,
  discount       REAL NOT NULL DEFAULT 0,
  valid_until    TEXT,
  terms          TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'draft',
  version        INTEGER NOT NULL DEFAULT 1,
  rev            INTEGER NOT NULL DEFAULT 1,
  created_by     TEXT NOT NULL,
  last_edited_by TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  sent_at        TEXT,
  viewed_at      TEXT,
  responded_at   TEXT,
  signer_name    TEXT,
  decline_reason TEXT
);
CREATE INDEX IF NOT EXISTS proposals_by_workspace ON proposals(workspace_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS activity (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  proposal_id  TEXT NOT NULL,
  actor        TEXT NOT NULL,
  action       TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS activity_by_proposal ON activity(proposal_id, id DESC);
`;

export async function initDb() {
  if (!remoteUrl) {
    try { await client.execute('PRAGMA journal_mode = WAL'); } catch { /* not critical */ }
  }
  await client.executeMultiple(SCHEMA);
  await db.run(`DELETE FROM sessions WHERE expires_at < ?`, [new Date().toISOString()]);
}
