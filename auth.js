// Accounts and sessions using only Node's built-in crypto.
import crypto from 'node:crypto';
import { db } from './db.js';
import { AppError, CURRENCIES, nowIso, randomId } from './proposals.js';

const SESSION_COOKIE = 'pp_session';
const SESSION_DAYS = 30;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  const [saltHex, hashHex] = String(stored).split(':');
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

const newMcpToken = () => `ppc_${crypto.randomBytes(24).toString('base64url')}`;

export async function createWorkspace({ email, password, business_name, default_currency }) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) throw new AppError('invalid', 'Enter a valid email address.');
  if (String(password || '').length < 8) throw new AppError('invalid', 'Use a password with at least 8 characters.');
  const name = String(business_name || '').trim().slice(0, 120);
  if (!name) throw new AppError('invalid', 'Enter your business name.');
  const currency = CURRENCIES.includes(default_currency) ? default_currency : 'USD';
  if (await db.get(`SELECT 1 AS found FROM workspaces WHERE email = ?`, [cleanEmail])) {
    throw new AppError('invalid', 'An account with this email already exists. Log in instead.');
  }
  const ws = {
    id: randomId(9),
    email: cleanEmail,
    password_hash: hashPassword(password),
    business_name: name,
    business_email: cleanEmail,
    default_currency: currency,
    default_terms: 'Payment: 50% to start, 50% on delivery. Invoices are due within 14 days.\nThis proposal is valid for 30 days.',
    mcp_token: newMcpToken(),
    created_at: nowIso(),
  };
  await db.run(`
    INSERT INTO workspaces (id, email, password_hash, business_name, business_email, default_currency, default_terms, mcp_token, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [ws.id, ws.email, ws.password_hash, ws.business_name, ws.business_email, ws.default_currency, ws.default_terms, ws.mcp_token, ws.created_at]);
  return getWorkspace(ws.id);
}

export const getWorkspace = (id) => db.get(`SELECT * FROM workspaces WHERE id = ?`, [id]);
export const getWorkspaceByToken = (token) => db.get(`SELECT * FROM workspaces WHERE mcp_token = ?`, [String(token || '')]);

export async function rotateMcpToken(workspaceId) {
  await db.run(`UPDATE workspaces SET mcp_token = ? WHERE id = ?`, [newMcpToken(), workspaceId]);
  return getWorkspace(workspaceId);
}

export async function updateWorkspaceSettings(workspaceId, input) {
  const name = String(input.business_name || '').trim().slice(0, 120);
  if (!name) throw new AppError('invalid', 'Business name cannot be empty.');
  const tax = Number(input.default_tax_rate || 0);
  if (!Number.isFinite(tax) || tax < 0 || tax > 100) throw new AppError('invalid', 'Default tax rate must be between 0 and 100.');
  await db.run(`
    UPDATE workspaces SET business_name = ?, business_email = ?, business_address = ?, default_currency = ?,
      default_tax_rate = ?, default_terms = ?, writing_notes = ?
    WHERE id = ?
  `, [
    name,
    String(input.business_email || '').trim().slice(0, 200),
    String(input.business_address || '').slice(0, 500),
    CURRENCIES.includes(input.default_currency) ? input.default_currency : 'USD',
    tax,
    String(input.default_terms || '').slice(0, 5000),
    String(input.writing_notes || '').slice(0, 5000),
    workspaceId,
  ]);
  return getWorkspace(workspaceId);
}

// Simple in-memory brake on password guessing.
const failures = new Map();
export async function login(email, password) {
  const key = String(email || '').trim().toLowerCase();
  const entry = failures.get(key);
  if (entry && entry.count >= 10 && Date.now() - entry.first < 15 * 60 * 1000) {
    throw new AppError('invalid', 'Too many attempts. Wait 15 minutes and try again.');
  }
  const ws = await db.get(`SELECT * FROM workspaces WHERE email = ?`, [key]);
  if (!ws || !verifyPassword(String(password || ''), ws.password_hash)) {
    const e = entry && Date.now() - entry.first < 15 * 60 * 1000 ? entry : { count: 0, first: Date.now() };
    e.count += 1;
    failures.set(key, e);
    throw new AppError('invalid', 'That email and password do not match.');
  }
  failures.delete(key);
  return ws;
}

// ---------- sessions ----------

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export async function startSession(res, workspaceId, secure) {
  const id = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000);
  await db.run(`INSERT INTO sessions (id, workspace_id, created_at, expires_at) VALUES (?, ?, ?, ?)`, [id, workspaceId, nowIso(), expires.toISOString()]);
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${id}; Path=/; HttpOnly; SameSite=Lax; Expires=${expires.toUTCString()}${secure ? '; Secure' : ''}`);
}

export async function endSession(req, res) {
  const id = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (id) await db.run(`DELETE FROM sessions WHERE id = ?`, [id]);
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

export async function loadUser(req, _res, next) {
  const id = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (id) {
    const s = await db.get(`SELECT * FROM sessions WHERE id = ? AND expires_at > ?`, [id, nowIso()]);
    if (s) req.workspace = await getWorkspace(s.workspace_id);
  }
  next();
}

export function requirePage(req, res, next) {
  if (!req.workspace) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
  next();
}

export function requireApi(req, res, next) {
  if (!req.workspace) return res.status(401).json({ error: 'Log in to continue.' });
  // JSON-only API: browsers cannot send JSON cross-site without CORS, which we never allow.
  // DELETE needs no body, and plain HTML forms can never send DELETE, so it is safe as is.
  if (['POST', 'PUT', 'PATCH'].includes(req.method) && !req.is('application/json')) {
    return res.status(415).json({ error: 'Send JSON.' });
  }
  next();
}
