// Pitchpad: proposals that the customer's own Claude writes through MCP.
// There is no AI in this server. It stores, validates, calculates and hosts.
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { dbDescription, initDb } from './db.js';
import {
  AppError, acceptProposal, createProposal, declineProposal, deleteProposal, getActivity, getProposal,
  getProposalByShareId, listProposals, markViewed, publicShape, publishProposal, reopenProposal, updateProposal,
} from './proposals.js';
import {
  createWorkspace, endSession, getWorkspace, getWorkspaceByToken, loadUser, login, requireApi, requirePage,
  rotateMcpToken, startSession, updateWorkspaceSettings,
} from './auth.js';
import { buildMcpServer } from './mcp.js';
import {
  dashboardPage, documentPage, editorPage, landingPage, loginPage, messagePage, settingsPage, signupPage,
} from './views.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');

const baseUrl = (req) => (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
const isSecure = (req) => req.secure || String(process.env.PUBLIC_URL || '').startsWith('https://');
const connectorUrl = (req, ws) => `${baseUrl(req)}/mcp/${ws.mcp_token}`;
const safeNext = (n) => (typeof n === 'string' && /^\/app(\/|$|\?)/.test(n) ? n : '/app');

// ---------- MCP endpoint (Claude connects here) ----------
// Registered before the page middleware so Claude's requests skip cookies and CSP.

app.post('/mcp/:token', express.json({ limit: '2mb' }), async (req, res) => {
  const ws = await getWorkspaceByToken(req.params.token);
  if (!ws) {
    return res.status(404).json({ jsonrpc: '2.0', error: { code: -32001, message: 'This Pitchpad connector link is not valid. Copy a fresh one from Pitchpad settings.' }, id: null });
  }
  // Stateless: a fresh server per request, scoped to this one workspace.
  const server = buildMcpServer(ws.id, baseUrl(req));
  // Plain JSON replies (no event streams) so the connector works behind any proxy or tunnel.
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => { transport.close(); server.close(); });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error('MCP error', err);
    if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null });
  }
});
const methodNotAllowed = (_req, res) => res.status(405).set('Allow', 'POST').json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null });
app.get('/mcp/:token', methodNotAllowed);
app.delete('/mcp/:token', methodNotAllowed);

app.get('/healthz', (_req, res) => res.json({ ok: true }));

// ---------- web app ----------

app.use((_req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' https://fonts.googleapis.com",
      "font-src https://fonts.gstatic.com",
      "img-src 'self' data:",
      "connect-src 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "base-uri 'none'",
    ].join('; '),
  });
  next();
});
// Browser files live next to the server files. Only these exact names are served,
// so the server's own code and settings can never be downloaded.
const STATIC_FILES = new Set(['styles.css', 'client-common.js', 'client-dashboard.js', 'client-editor.js', 'client-document.js']);
app.get('/static/:file', (req, res, next) => {
  if (!STATIC_FILES.has(req.params.file)) return next();
  res.set('Cache-Control', 'public, max-age=3600');
  res.sendFile(path.join(__dirname, req.params.file));
});
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '200kb' }));
app.use(loadUser);

app.get('/', (req, res) => (req.workspace ? res.redirect('/app') : res.send(landingPage())));

app.get('/signup', (req, res) => (req.workspace ? res.redirect('/app') : res.send(signupPage({}))));
app.post('/signup', async (req, res) => {
  try {
    const ws = await createWorkspace(req.body);
    await startSession(res, ws.id, isSecure(req));
    res.redirect('/app');
  } catch (e) {
    if (!(e instanceof AppError)) throw e;
    res.status(400).send(signupPage({ error: e.message, values: req.body }));
  }
});

app.get('/login', (req, res) => (req.workspace ? res.redirect('/app') : res.send(loginPage({ next: req.query.next }))));
app.post('/login', async (req, res) => {
  try {
    const ws = await login(req.body.email, req.body.password);
    await startSession(res, ws.id, isSecure(req));
    res.redirect(safeNext(req.body.next));
  } catch (e) {
    if (!(e instanceof AppError)) throw e;
    res.status(400).send(loginPage({ error: e.message, values: req.body, next: req.body.next }));
  }
});

app.post('/logout', async (req, res) => { await endSession(req, res); res.redirect('/'); });

app.get('/app', requirePage, async (req, res) => {
  const proposals = (await listProposals(req.workspace.id)).map((p) => publicShape(p, baseUrl(req)));
  res.send(dashboardPage(req.workspace, proposals, connectorUrl(req, req.workspace)));
});

app.post('/app/proposals/new', requirePage, async (req, res) => {
  const p = await createProposal(req.workspace, { title: 'Untitled proposal' }, 'you');
  res.redirect(`/app/proposals/${p.id}`);
});

app.get('/app/proposals/:id', requirePage, async (req, res) => {
  try {
    const p = await getProposal(req.workspace.id, req.params.id);
    res.send(editorPage(req.workspace, publicShape(p, baseUrl(req)), await getActivity(p.id)));
  } catch (e) {
    if (e.code !== 'not_found') throw e;
    res.status(404).send(messagePage('Proposal not found', 'It may have been deleted.', { workspace: req.workspace }));
  }
});

app.get('/app/proposals/:id/preview', requirePage, async (req, res) => {
  try {
    const p = await getProposal(req.workspace.id, req.params.id);
    res.send(documentPage(req.workspace, p, { mode: 'owner' }));
  } catch (e) {
    if (e.code !== 'not_found') throw e;
    res.status(404).send(messagePage('Proposal not found', 'It may have been deleted.', { workspace: req.workspace }));
  }
});

app.get('/app/settings', requirePage, (req, res) => {
  res.send(settingsPage(req.workspace, connectorUrl(req, req.workspace), { saved: req.query.saved ? 'Settings saved.' : req.query.rotated ? 'New connector link created. Update it in Claude.' : '' }));
});
app.post('/app/settings', requirePage, async (req, res) => {
  try {
    await updateWorkspaceSettings(req.workspace.id, req.body);
    res.redirect('/app/settings?saved=1');
  } catch (e) {
    if (!(e instanceof AppError)) throw e;
    res.status(400).send(settingsPage({ ...req.workspace, ...req.body }, connectorUrl(req, req.workspace), { error: e.message }));
  }
});
app.post('/app/settings/rotate-token', requirePage, async (req, res) => {
  await rotateMcpToken(req.workspace.id);
  res.redirect('/app/settings?rotated=1');
});

// ---------- JSON API for the editor and dashboard ----------

const api = express.Router();
api.use(requireApi);

const sendError = (res, e) => {
  const status = { invalid: 400, not_found: 404, locked: 423, conflict: 409 }[e.code];
  if (!status) throw e;
  const body = { error: e.message, code: e.code };
  if (e.proposal) body.proposal = publicShape(e.proposal, res.locals.base);
  res.status(status).json(body);
};
api.use((req, res, next) => { res.locals.base = baseUrl(req); next(); });

api.get('/me', async (req, res) => {
  const ws = await getWorkspace(req.workspace.id);
  res.json({ business_name: ws.business_name, email: ws.email, connector_url: connectorUrl(req, ws) });
});

api.get('/proposals', async (req, res) => {
  res.json({ proposals: (await listProposals(req.workspace.id)).map((p) => publicShape(p, res.locals.base)) });
});

api.get('/proposals/:id', async (req, res) => {
  try {
    const p = await getProposal(req.workspace.id, req.params.id);
    res.json({ proposal: publicShape(p, res.locals.base), activity: await getActivity(p.id) });
  } catch (e) { sendError(res, e); }
});

api.get('/proposals/:id/rev', async (req, res) => {
  try {
    const p = await getProposal(req.workspace.id, req.params.id);
    res.json({ version: p.version, rev: p.rev, status: p.status, last_edited_by: p.last_edited_by, updated_at: p.updated_at });
  } catch (e) { sendError(res, e); }
});

api.put('/proposals/:id', async (req, res) => {
  try {
    const { base_version, fields } = req.body || {};
    const p = await updateProposal(req.workspace.id, req.params.id, fields || {}, 'you', { baseVersion: base_version });
    res.json({ proposal: publicShape(p, res.locals.base), activity: await getActivity(p.id) });
  } catch (e) { sendError(res, e); }
});

for (const [route, fn] of [['publish', publishProposal], ['reopen', reopenProposal]]) {
  api.post(`/proposals/:id/${route}`, async (req, res) => {
    try {
      const p = await fn(req.workspace.id, req.params.id, 'you');
      res.json({ proposal: publicShape(p, res.locals.base), activity: await getActivity(p.id) });
    } catch (e) { sendError(res, e); }
  });
}

api.delete('/proposals/:id', async (req, res) => {
  try {
    await deleteProposal(req.workspace.id, req.params.id);
    res.json({ ok: true });
  } catch (e) { sendError(res, e); }
});

app.use('/api', api);

// ---------- client link ----------

async function loadShared(req, res) {
  const p = await getProposalByShareId(req.params.shareId);
  const ws = p && (await getWorkspace(p.workspace_id));
  const isOwner = p && req.workspace && req.workspace.id === p.workspace_id;
  if (!p || (p.status === 'draft' && !isOwner)) {
    res.status(404).send(messagePage('This proposal is not available', 'The link may be wrong, or the proposal has not been published yet.'));
    return {};
  }
  return { p, ws, isOwner };
}

app.get('/p/:shareId', async (req, res) => {
  const { p, ws, isOwner } = await loadShared(req, res);
  if (!p) return;
  if (isOwner) return res.redirect(`/app/proposals/${p.id}/preview`);
  await markViewed(p.share_id);
  const notice = { accepted: 'Thank you. Your acceptance is recorded.', declined: 'Your answer is recorded. Thank you for letting us know.' }[req.query.done];
  res.send(documentPage(ws, await getProposalByShareId(p.share_id), { mode: 'client', notice }));
});

app.get('/p/:shareId/rev', async (req, res) => {
  const p = await getProposalByShareId(req.params.shareId);
  if (!p || p.status === 'draft') return res.status(404).json({ error: 'Not available.' });
  res.json({ rev: p.rev });
});

for (const [route, act, field] of [['accept', acceptProposal, 'signer_name'], ['decline', declineProposal, 'reason']]) {
  app.post(`/p/:shareId/${route}`, async (req, res) => {
    const { p, ws } = await loadShared(req, res);
    if (!p) return;
    try {
      if (route === 'accept' && !req.body.agree) throw new AppError('invalid', 'Tick the box to confirm you agree.');
      await act(p.share_id, req.body[field]);
      res.redirect(303, `/p/${p.share_id}?done=${route === 'accept' ? 'accepted' : 'declined'}#respond`);
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
      res.status(400).send(documentPage(ws, await getProposalByShareId(p.share_id), { mode: 'client', error: e.message }));
    }
  });
}

app.use((req, res) => res.status(404).send(messagePage('Page not found', 'Check the address and try again.', { workspace: req.workspace })));

app.use((err, req, res, _next) => {
  console.error(err);
  if (req.path.startsWith('/api/')) return res.status(500).json({ error: 'Something went wrong on the server.' });
  res.status(500).send(messagePage('Something went wrong', 'The server hit an error. Try again in a moment.'));
});

const port = Number(process.env.PORT || 3000);
if (process.env.RENDER && !process.env.TURSO_DATABASE_URL && !process.env.DB_PATH) {
  console.warn('WARNING: no TURSO_DATABASE_URL is set. On this host, saved proposals will be lost on every restart.');
}
await initDb();
app.listen(port, () => {
  console.log(`Pitchpad is running on http://localhost:${port}`);
  console.log(`Storing data in ${dbDescription}`);
});
