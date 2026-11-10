// All proposal rules live here. Both the MCP tools (Claude) and the web editor (a person)
// go through these same functions, so the app behaves the same no matter who edits.
import crypto from 'node:crypto';
import { db, transaction } from './db.js';

export const STATUSES = ['draft', 'sent', 'viewed', 'accepted', 'declined'];
export const CURRENCIES = ['USD', 'EUR', 'GBP', 'INR', 'CAD', 'AUD', 'NZD', 'SGD', 'AED', 'CHF', 'JPY', 'ZAR'];
export const EDITABLE_FIELDS = [
  'title', 'client_name', 'client_company', 'client_email', 'intro', 'sections',
  'line_items', 'currency', 'tax_rate', 'discount', 'valid_until', 'terms',
];

const FIELD_LABELS = {
  title: 'title',
  client_name: 'client details',
  client_company: 'client details',
  client_email: 'client details',
  intro: 'introduction',
  sections: 'sections',
  line_items: 'line items',
  currency: 'pricing',
  tax_rate: 'pricing',
  discount: 'pricing',
  valid_until: 'expiry date',
  terms: 'terms',
};

export class AppError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code; // 'invalid' | 'not_found' | 'locked' | 'conflict'
    Object.assign(this, extra);
  }
}

export const nowIso = () => new Date().toISOString();
export const randomId = (bytes = 9) => crypto.randomBytes(bytes).toString('base64url');

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export function computeTotals({ line_items = [], discount = 0, tax_rate = 0 }) {
  const subtotal = round2(
    line_items.reduce((sum, item) => sum + round2((Number(item.quantity) || 0) * (Number(item.unit_price) || 0)), 0),
  );
  const appliedDiscount = Math.min(round2(Number(discount) || 0), subtotal);
  const taxable = round2(subtotal - appliedDiscount);
  const tax = round2((taxable * (Number(tax_rate) || 0)) / 100);
  return { subtotal, discount: appliedDiscount, tax, total: round2(taxable + tax) };
}

export function formatMoney(amount, currency) {
  const locale = currency === 'INR' ? 'en-IN' : 'en-US';
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount);
  } catch {
    return `${currency} ${Number(amount).toFixed(2)}`;
  }
}

export const proposalCode = (number) => `P-${String(number).padStart(4, '0')}`;

// ---------- validation ----------

function text(value, max, field) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new AppError('invalid', `${field} must be text.`);
  }
  const s = String(value);
  if (s.length > max) throw new AppError('invalid', `${field} is too long (max ${max} characters).`);
  return s;
}

function num(value, { min, max, field }) {
  if (value === '' || value === null || value === undefined) return 0;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new AppError('invalid', `${field} must be a number.`);
  if (n < min || n > max) throw new AppError('invalid', `${field} must be between ${min} and ${max}.`);
  return n;
}

function validCurrency(code) {
  const c = String(code || '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(c)) throw new AppError('invalid', 'currency must be a 3-letter code like USD or INR.');
  try {
    new Intl.NumberFormat('en', { style: 'currency', currency: c });
  } catch {
    throw new AppError('invalid', `${c} is not a currency code Pitchpad recognises.`);
  }
  return c;
}

function validDate(value) {
  if (value === undefined || value === null || value === '') return null;
  const s = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) {
    throw new AppError('invalid', 'valid_until must be a date in YYYY-MM-DD format.');
  }
  return s;
}

function sectionsList(value) {
  if (!Array.isArray(value)) throw new AppError('invalid', 'sections must be a list.');
  if (value.length > 40) throw new AppError('invalid', 'A proposal can have at most 40 sections.');
  return value.map((s, i) => ({
    heading: text(s?.heading, 200, `sections[${i}].heading`),
    body: text(s?.body, 20000, `sections[${i}].body`),
  }));
}

function itemsList(value) {
  if (!Array.isArray(value)) throw new AppError('invalid', 'line_items must be a list.');
  if (value.length > 100) throw new AppError('invalid', 'A proposal can have at most 100 line items.');
  return value.map((it, i) => ({
    description: text(it?.description, 300, `line_items[${i}].description`),
    details: text(it?.details, 1000, `line_items[${i}].details`),
    quantity: it?.quantity === undefined ? 1 : num(it.quantity, { min: 0, max: 1e6, field: `line_items[${i}].quantity` }),
    unit_price: num(it?.unit_price, { min: 0, max: 1e10, field: `line_items[${i}].unit_price` }),
  }));
}

// Turns any partial input into clean column values. Unknown keys are ignored.
function cleanPatch(raw) {
  // Keys sent as undefined count as "not sent".
  const input = Object.fromEntries(Object.entries(raw || {}).filter(([, v]) => v !== undefined));
  const out = {};
  if ('title' in input) {
    out.title = text(input.title, 200, 'title').trim();
    if (!out.title) throw new AppError('invalid', 'title cannot be empty.');
  }
  if ('client_name' in input) out.client_name = text(input.client_name, 200, 'client_name');
  if ('client_company' in input) out.client_company = text(input.client_company, 200, 'client_company');
  if ('client_email' in input) out.client_email = text(input.client_email, 200, 'client_email').trim();
  if ('intro' in input) out.intro = text(input.intro, 20000, 'intro');
  if ('sections' in input) out.sections = sectionsList(input.sections);
  if ('line_items' in input) out.line_items = itemsList(input.line_items);
  if ('currency' in input) out.currency = validCurrency(input.currency);
  if ('tax_rate' in input) out.tax_rate = num(input.tax_rate, { min: 0, max: 100, field: 'tax_rate' });
  if ('discount' in input) out.discount = num(input.discount, { min: 0, max: 1e10, field: 'discount' });
  if ('valid_until' in input) out.valid_until = validDate(input.valid_until);
  if ('terms' in input) out.terms = text(input.terms, 20000, 'terms');
  return out;
}

// ---------- reading ----------

function hydrate(row) {
  if (!row) return null;
  const p = {
    ...row,
    sections: JSON.parse(row.sections),
    line_items: JSON.parse(row.line_items),
  };
  p.code = proposalCode(p.number);
  p.totals = computeTotals(p);
  return p;
}

export async function getProposal(workspaceId, id, q = db) {
  const row = await q.get(`SELECT * FROM proposals WHERE id = ? AND workspace_id = ?`, [String(id), workspaceId]);
  if (!row) throw new AppError('not_found', `No proposal with id ${id} in this workspace.`);
  return hydrate(row);
}

export async function getProposalByShareId(shareId, q = db) {
  return hydrate(await q.get(`SELECT * FROM proposals WHERE share_id = ?`, [String(shareId)]));
}

export async function listProposals(workspaceId, { status, limit = 200 } = {}) {
  const rows = status
    ? await db.all(`SELECT * FROM proposals WHERE workspace_id = ? AND status = ? ORDER BY updated_at DESC LIMIT ?`, [workspaceId, status, limit])
    : await db.all(`SELECT * FROM proposals WHERE workspace_id = ? ORDER BY updated_at DESC LIMIT ?`, [workspaceId, limit]);
  return rows.map(hydrate);
}

export async function getActivity(proposalId, limit = 30) {
  return db.all(`SELECT actor, action, created_at FROM activity WHERE proposal_id = ? ORDER BY id DESC LIMIT ?`, [proposalId, limit]);
}

// ---------- activity ----------

async function logActivity(q, proposalId, actor, action, { mergeEdits = false } = {}) {
  const ts = nowIso();
  if (mergeEdits) {
    // Autosave fires often. Fold repeated edits by the same person into one entry
    // so the history stays readable.
    const last = await q.get(`SELECT * FROM activity WHERE proposal_id = ? ORDER BY id DESC LIMIT 1`, [proposalId]);
    const tenMinutes = 10 * 60 * 1000;
    if (last && last.actor === actor && last.action.startsWith('Edited ') && Date.now() - Date.parse(last.created_at) < tenMinutes) {
      const labels = new Set([...parseLabels(last.action), ...parseLabels(action)]);
      await q.run(`UPDATE activity SET action = ?, created_at = ? WHERE id = ?`, [editedSentence([...labels]), ts, last.id]);
      return;
    }
  }
  await q.run(`INSERT INTO activity (proposal_id, actor, action, created_at) VALUES (?, ?, ?, ?)`, [proposalId, actor, action, ts]);
}

function editedSentence(labels) {
  if (labels.length <= 1) return `Edited ${labels[0] || 'the proposal'}`;
  return `Edited ${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

function parseLabels(sentence) {
  return sentence.replace(/^Edited /, '').split(/, | and /).filter(Boolean);
}

// ---------- writing ----------

export async function createProposal(workspace, input, actor) {
  const fields = cleanPatch({ ...input, title: input.title || 'Untitled proposal' });
  const ts = nowIso();
  const id = randomId(9);
  return transaction(async (q) => {
    const next = (await q.get(`SELECT COALESCE(MAX(number), 0) + 1 AS n FROM proposals WHERE workspace_id = ?`, [workspace.id])).n;
    await q.run(`
      INSERT INTO proposals (id, workspace_id, share_id, number, title, client_name, client_company, client_email,
        intro, sections, line_items, currency, tax_rate, discount, valid_until, terms, created_by, last_edited_by,
        created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id, workspace.id, randomId(15), next, fields.title,
      fields.client_name ?? '', fields.client_company ?? '', fields.client_email ?? '',
      fields.intro ?? '', JSON.stringify(fields.sections ?? []), JSON.stringify(fields.line_items ?? []),
      fields.currency ?? workspace.default_currency, fields.tax_rate ?? workspace.default_tax_rate,
      fields.discount ?? 0, fields.valid_until ?? null,
      'terms' in fields ? fields.terms : workspace.default_terms,
      actor, actor, ts, ts,
    ]);
    await logActivity(q, id, actor, 'Created this proposal');
    return getProposal(workspace.id, id, q);
  });
}

export async function updateProposal(workspaceId, id, input, actor, { baseVersion } = {}) {
  const patch = cleanPatch(input);
  return transaction(async (q) => {
    const current = await getProposal(workspaceId, id, q);
    if (current.status === 'accepted') {
      throw new AppError('locked', 'This proposal was accepted, so it is locked. Reopen it in Pitchpad to change it.', { proposal: current });
    }
    if (baseVersion !== undefined && Number(baseVersion) !== current.version) {
      throw new AppError('conflict', 'This proposal changed since you opened it.', { proposal: current });
    }

    const changed = Object.keys(patch).filter((k) => JSON.stringify(patch[k]) !== JSON.stringify(current[k]));
    if (changed.length === 0) return current;

    const sets = changed.map((k) => `${k} = ?`);
    const values = changed.map((k) => (k === 'sections' || k === 'line_items' ? JSON.stringify(patch[k]) : patch[k]));
    // Revising a declined proposal turns it back into a draft you can send again.
    let statusNote = '';
    if (current.status === 'declined') {
      sets.push(`status = 'draft'`, `responded_at = NULL`, `decline_reason = NULL`);
      statusNote = ' (moved back to draft)';
    }
    await q.run(`
      UPDATE proposals SET ${sets.join(', ')}, version = version + 1, rev = rev + 1, last_edited_by = ?, updated_at = ?
      WHERE id = ?
    `, [...values, actor, nowIso(), current.id]);

    const labels = [...new Set(changed.map((k) => FIELD_LABELS[k]))];
    await logActivity(q, current.id, actor, editedSentence(labels) + statusNote, { mergeEdits: !statusNote });
    return getProposal(workspaceId, current.id, q);
  });
}

async function setStatus(q, id, fields, actor, action) {
  const keys = Object.keys(fields);
  await q.run(
    `UPDATE proposals SET ${keys.map((k) => `${k} = ?`).join(', ')}, rev = rev + 1, updated_at = ? WHERE id = ?`,
    [...keys.map((k) => fields[k]), nowIso(), id],
  );
  await logActivity(q, id, actor, action);
}

export async function publishProposal(workspaceId, id, actor) {
  return transaction(async (q) => {
    const p = await getProposal(workspaceId, id, q);
    if (p.status === 'accepted') throw new AppError('locked', 'This proposal is already accepted.');
    if (p.status === 'sent' || p.status === 'viewed') return p;
    if (!p.line_items.length && !p.intro.trim() && !p.sections.length) {
      throw new AppError('invalid', 'Add an introduction, a section or a line item before publishing.');
    }
    await setStatus(q, p.id, { status: 'sent', sent_at: nowIso(), responded_at: null, decline_reason: null }, actor, 'Published the client link');
    return getProposal(workspaceId, p.id, q);
  });
}

export async function reopenProposal(workspaceId, id, actor) {
  return transaction(async (q) => {
    const p = await getProposal(workspaceId, id, q);
    if (p.status !== 'accepted' && p.status !== 'declined') return p;
    await setStatus(q, p.id, { status: 'draft', signer_name: null, responded_at: null, decline_reason: null }, actor, 'Reopened for changes');
    return getProposal(workspaceId, p.id, q);
  });
}

export async function deleteProposal(workspaceId, id) {
  await transaction(async (q) => {
    const p = await getProposal(workspaceId, id, q);
    await q.run(`DELETE FROM activity WHERE proposal_id = ?`, [p.id]);
    await q.run(`DELETE FROM proposals WHERE id = ?`, [p.id]);
  });
}

// Client-side events from the public link. Each re-reads inside a transaction,
// so two clicks at once cannot both succeed.
export async function markViewed(shareId) {
  await transaction(async (q) => {
    const p = await getProposalByShareId(shareId, q);
    if (!p || p.status !== 'sent') return;
    await setStatus(q, p.id, { status: 'viewed', viewed_at: nowIso() }, 'client', 'Opened the proposal');
  });
}

export async function acceptProposal(shareId, signerName) {
  const name = String(signerName || '').trim().slice(0, 120);
  if (!name) throw new AppError('invalid', 'Type your full name to accept.');
  await transaction(async (q) => {
    const p = await getProposalByShareId(shareId, q);
    if (!p || (p.status !== 'sent' && p.status !== 'viewed')) throw new AppError('locked', 'This proposal can no longer be accepted.');
    await setStatus(q, p.id, { status: 'accepted', signer_name: name, responded_at: nowIso() }, 'client', `Accepted, signed by ${name}`);
  });
}

export async function declineProposal(shareId, reason) {
  const why = String(reason || '').trim().slice(0, 1000);
  await transaction(async (q) => {
    const p = await getProposalByShareId(shareId, q);
    if (!p || (p.status !== 'sent' && p.status !== 'viewed')) throw new AppError('locked', 'This proposal can no longer be declined.');
    await setStatus(q, p.id, { status: 'declined', decline_reason: why || null, responded_at: nowIso() }, 'client', why ? `Declined: ${why}` : 'Declined');
  });
}

// What the editor and Claude both see.
export function publicShape(p, baseUrl) {
  return {
    id: p.id,
    code: p.code,
    title: p.title,
    status: p.status,
    client_name: p.client_name,
    client_company: p.client_company,
    client_email: p.client_email,
    intro: p.intro,
    sections: p.sections,
    line_items: p.line_items,
    currency: p.currency,
    tax_rate: p.tax_rate,
    discount: p.discount,
    valid_until: p.valid_until,
    terms: p.terms,
    totals: p.totals,
    version: p.version,
    rev: p.rev,
    created_by: p.created_by,
    last_edited_by: p.last_edited_by,
    created_at: p.created_at,
    updated_at: p.updated_at,
    sent_at: p.sent_at,
    viewed_at: p.viewed_at,
    responded_at: p.responded_at,
    signer_name: p.signer_name,
    decline_reason: p.decline_reason,
    edit_url: `${baseUrl}/app/proposals/${p.id}`,
    client_url: `${baseUrl}/p/${p.share_id}`,
  };
}
