// Server-rendered pages. Every interpolated value is escaped unless wrapped in raw().
import { CURRENCIES, formatMoney } from './proposals.js';
import { escapeHtml, renderMarkdown } from './markdown.js';

class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(String(s));
const show = (v) => (v == null || v === false ? '' : v instanceof Raw ? v.s : Array.isArray(v) ? v.map(show).join('') : escapeHtml(v));
export function html(strings, ...values) {
  let out = '';
  strings.forEach((s, i) => { out += s + (i < values.length ? show(values[i]) : ''); });
  return raw(out);
}

const jsonData = (id, data) => raw(`<script type="application/json" id="${id}">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`);

export const STATUS_LABEL = { draft: 'Draft', sent: 'Sent', viewed: 'Opened', accepted: 'Accepted', declined: 'Declined' };

const FAVICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect x='4' y='3' width='22' height='26' rx='2' fill='%232D46C8'/%3E%3Cpath d='M9 10h12M9 15h12M9 20h7' stroke='white' stroke-width='2.4' stroke-linecap='round'/%3E%3C/svg%3E";

function layout({ title, body, workspace, nav, scripts = [], bodyClass = '' }) {
  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="icon" href="${raw(FAVICON)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Literata:ital,opsz,wght@0,7..72,400;0,7..72,600;1,7..72,400&family=Schibsted+Grotesk:wght@400;500;700;800&display=swap">
<link rel="stylesheet" href="/static/styles.css">
</head>
<body class="${bodyClass}">
${workspace ? appBar(workspace, nav) : ''}
${body}
<script src="/static/client-common.js"></script>
${scripts.map((s) => raw(`<script src="/static/${s}"></script>`))}
</body>
</html>`.toString();
}

function wordmark(href = '/') {
  return html`<a class="wordmark" href="${href}"><span class="wordmark-sheet" aria-hidden="true"></span>Pitchpad</a>`;
}

function appBar(ws, nav) {
  return html`<header class="appbar">
  ${wordmark('/app')}
  <nav class="appnav" aria-label="Main">
    <a href="/app" ${nav === 'proposals' ? raw('aria-current="page"') : ''}>Proposals</a>
    <a href="/app/settings" ${nav === 'settings' ? raw('aria-current="page"') : ''}>Settings</a>
  </nav>
  <div class="appbar-end">
    <span class="appbar-biz">${ws.business_name}</span>
    <form method="post" action="/logout"><button class="link-button" type="submit">Log out</button></form>
  </div>
</header>`;
}

// ---------- public marketing ----------

export function landingPage() {
  const body = html`
<header class="sitebar">
  ${wordmark('/')}
  <nav><a href="/login">Log in</a><a class="button button-small" href="/signup">Create workspace</a></nav>
</header>
<main class="landing">
  <section class="hero">
    <div class="hero-copy">
      <h1>Your Claude writes the proposal. Pitchpad gets it signed.</h1>
      <p class="lede">Connect Pitchpad to the Claude you already use. Describe the job in plain words, then edit the draft here, send one live link, and see the moment your client signs. Pitchpad has no AI inside, so there is no second AI bill.</p>
      <a class="button" href="/signup">Create your workspace</a>
      <p class="fineprint">Free during early access. Works with any Claude plan that supports custom connectors.</p>
    </div>
    <div class="hero-demo" aria-label="Example: a request typed in Claude becomes a signed proposal">
      <div class="demo-ask">
        <span class="demo-who">You, in Claude</span>
        <p>Write a proposal for Meera at Crumb &amp; Co. New logo with 3 concepts, labels for their 6 products, 4 weeks, ₹1,20,000 plus 18% GST.</p>
      </div>
      <div class="demo-sheet">
        <div class="demo-head"><span>P-0012</span><span>Valid until 30 Nov</span></div>
        <h2>Brand refresh for Crumb &amp; Co</h2>
        <p class="demo-for">Prepared for Meera Rao</p>
        <table class="demo-items">
          <tr><td>Logo design, 3 concepts</td><td>₹60,000</td></tr>
          <tr><td>Product labels, 6 designs</td><td>₹48,000</td></tr>
          <tr><td>Brand guide, 12 pages</td><td>₹12,000</td></tr>
          <tr class="demo-total"><td>Total with GST</td><td>₹1,41,600</td></tr>
        </table>
        <div class="stamp stamp-accepted demo-stamp"><strong>Accepted</strong><span>Meera Rao, 14 Nov</span></div>
      </div>
    </div>
  </section>

  <section class="how">
    <h2>How it works</h2>
    <ol class="steps">
      <li><h3>Connect</h3><p>Copy your private connector link from Pitchpad and add it in Claude under Settings, then Connectors, then Add custom connector.</p></li>
      <li><h3>Ask</h3><p>Tell Claude about the client and the job. Claude writes the proposal and saves it straight into Pitchpad as a draft.</p></li>
      <li><h3>Edit and send</h3><p>Open the draft, change any word or price, then publish. Your client reads one live link and accepts by signing their name.</p></li>
    </ol>
  </section>

  <section class="split">
    <div>
      <h2>Claude thinks. Pitchpad keeps.</h2>
      <p>Claude does the writing in your own account. Pitchpad does the rest: it stores every proposal, checks the numbers, calculates tax and totals, keeps a history of who changed what, and hosts the client link. Edits you make here show up for Claude the next time it reads the proposal, and edits Claude makes show up in your open editor within seconds.</p>
    </div>
    <div>
      <h2>Pricing</h2>
      <p>Free while Pitchpad is in early access. After that, Solo is $9 a month for one person and Studio is $24 a month for up to five people. You never pay us for AI, because we do not run any.</p>
    </div>
  </section>
</main>
<footer class="sitefoot">Pitchpad stores proposals. Claude writes them. Your clients sign them.</footer>`;
  return layout({ title: 'Pitchpad: proposals your Claude writes', body, bodyClass: 'page-site' });
}

function authForm({ mode, error, values = {}, next = '' }) {
  const isSignup = mode === 'signup';
  const body = html`
<header class="sitebar">${wordmark('/')}</header>
<main class="auth">
  <form class="auth-sheet" method="post" action="${isSignup ? '/signup' : '/login'}">
    <h1>${isSignup ? 'Create your workspace' : 'Log in to Pitchpad'}</h1>
    ${error ? html`<p class="form-error" role="alert">${error}</p>` : ''}
    <input type="hidden" name="next" value="${next}">
    ${isSignup ? html`<label>Business name<input name="business_name" required maxlength="120" value="${values.business_name || ''}" autocomplete="organization"></label>` : ''}
    <label>Email<input name="email" type="email" required value="${values.email || ''}" autocomplete="email"></label>
    <label>Password<input name="password" type="password" required minlength="${isSignup ? 8 : 1}" autocomplete="${isSignup ? 'new-password' : 'current-password'}"></label>
    ${isSignup ? html`<label>Currency you usually quote in<select name="default_currency">${CURRENCIES.map((c) => html`<option ${c === (values.default_currency || 'USD') ? raw('selected') : ''}>${c}</option>`)}</select></label>` : ''}
    <button class="button" type="submit">${isSignup ? 'Create workspace' : 'Log in'}</button>
    <p class="auth-switch">${isSignup ? html`Already have a workspace? <a href="/login">Log in</a>` : html`New here? <a href="/signup">Create a workspace</a>`}</p>
  </form>
</main>`;
  return layout({ title: isSignup ? 'Create workspace: Pitchpad' : 'Log in: Pitchpad', body, bodyClass: 'page-site' });
}
export const signupPage = (o) => authForm({ ...o, mode: 'signup' });
export const loginPage = (o) => authForm({ ...o, mode: 'login' });

// ---------- app ----------

function connectorPanel(connectorUrl, { compact = false } = {}) {
  return html`<section class="connect" aria-labelledby="connect-title">
  <h2 id="connect-title">Connect your Claude</h2>
  <p>This private link lets your Claude read and write proposals in this workspace. Keep it to yourself.</p>
  <div class="copy-field">
    <input id="connector-url" readonly value="${connectorUrl}" aria-label="Your connector link">
    <button class="button button-small" type="button" data-copy="#connector-url">Copy</button>
  </div>
  <ol class="connect-steps">
    <li>In Claude, open Settings, then Connectors.</li>
    <li>Choose Add custom connector, name it Pitchpad, and paste the link.</li>
    <li>In a chat, turn Pitchpad on from the tools menu and ask for a proposal.</li>
  </ol>
  ${compact ? '' : html`<h3>Try asking Claude</h3>
  <ul class="prompts">
    <li><button type="button" class="prompt" data-copy-text="Use Pitchpad to write a proposal for Arjun at Lakeview Dental: a 5-page website refresh, copywriting included, 3 weeks, $2,400. Read my business profile first.">Write a proposal for Arjun at Lakeview Dental: a 5-page website refresh, copywriting included, 3 weeks, $2,400.</button></li>
    <li><button type="button" class="prompt" data-copy-text="In Pitchpad, open my latest proposal and add a rush-delivery option as a line item at 20% of the subtotal.">Open my latest proposal and add a rush-delivery option at 20% of the subtotal.</button></li>
    <li><button type="button" class="prompt" data-copy-text="List my Pitchpad proposals that clients have opened but not answered yet, and draft a short follow-up note for each.">Which proposals were opened but not answered? Draft a follow-up for each.</button></li>
  </ul>
  <p class="hint">Click a prompt to copy it.</p>`}
</section>`;
}

export function dashboardPage(ws, proposals, connectorUrl) {
  const body = html`
<main class="dashboard">
  <section class="list" aria-labelledby="list-title">
    <div class="list-head">
      <h1 id="list-title">Proposals</h1>
      <form method="post" action="/app/proposals/new"><button class="button button-quiet" type="submit">Start one by hand</button></form>
    </div>
    <div class="filters" id="filters" role="tablist" aria-label="Filter by status"></div>
    <div id="proposal-list" aria-live="polite"></div>
  </section>
  <aside class="side">${connectorPanel(connectorUrl)}</aside>
</main>
${jsonData('dashboard-data', { proposals })}`;
  return layout({ title: 'Proposals: Pitchpad', body, workspace: ws, nav: 'proposals', scripts: ['client-dashboard.js'], bodyClass: 'page-app' });
}

export function editorPage(ws, proposal, activity) {
  const body = html`
<main class="editor" id="editor" data-id="${proposal.id}">
  <div id="editor-root"></div>
</main>
${jsonData('editor-data', { proposal, activity, currencies: CURRENCIES, businessName: ws.business_name })}`;
  return layout({ title: `${proposal.code} ${proposal.title}: Pitchpad`, body, workspace: ws, nav: 'proposals', scripts: ['client-editor.js'], bodyClass: 'page-app' });
}

export function settingsPage(ws, connectorUrl, { saved, error } = {}) {
  const body = html`
<main class="settings">
  <form class="settings-form" method="post" action="/app/settings">
    <h1>Settings</h1>
    ${saved ? html`<p class="form-ok" role="status">${saved}</p>` : ''}
    ${error ? html`<p class="form-error" role="alert">${error}</p>` : ''}
    <fieldset>
      <legend>Your business</legend>
      <label>Business name<input name="business_name" required maxlength="120" value="${ws.business_name}"></label>
      <label>Email on proposals<input name="business_email" type="email" value="${ws.business_email}"></label>
      <label>Address or tax ID<textarea name="business_address" rows="2" data-autogrow>${ws.business_address}</textarea></label>
    </fieldset>
    <fieldset>
      <legend>Defaults for new proposals</legend>
      <div class="row-2">
        <label>Currency<select name="default_currency">${CURRENCIES.map((c) => html`<option ${c === ws.default_currency ? raw('selected') : ''}>${c}</option>`)}</select></label>
        <label>Tax rate (%)<input name="default_tax_rate" type="number" min="0" max="100" step="0.01" value="${ws.default_tax_rate}"></label>
      </div>
      <label>Terms<textarea name="default_terms" rows="4" data-autogrow>${ws.default_terms}</textarea></label>
    </fieldset>
    <fieldset>
      <legend>How Claude should write for you</legend>
      <p class="hint">Claude reads this before writing. Mention your tone, phrases you like or avoid, and anything every proposal should include.</p>
      <textarea name="writing_notes" rows="5" data-autogrow placeholder="Friendly and direct. Short paragraphs. Always include a 'What is not included' section and two rounds of revisions.">${ws.writing_notes}</textarea>
    </fieldset>
    <button class="button" type="submit">Save settings</button>
  </form>
  <aside class="side">
    ${connectorPanel(connectorUrl, { compact: true })}
    <form method="post" action="/app/settings/rotate-token" class="rotate" data-confirm="Create a new connector link? The old link stops working right away, and you will need to update it in Claude.">
      <h3>Lost control of the link?</h3>
      <p>Create a new one. The old link stops working immediately.</p>
      <button class="button button-quiet" type="submit">Create a new connector link</button>
    </form>
  </aside>
</main>`;
  return layout({ title: 'Settings: Pitchpad', body, workspace: ws, nav: 'settings', bodyClass: 'page-app' });
}

// ---------- the proposal document (client link and owner preview) ----------

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export function documentPage(ws, p, { mode, notice, error }) {
  const isOwner = mode === 'owner';
  const money = (n) => formatMoney(n, p.currency);
  const items = p.line_items.filter((i) => i.description.trim() || Number(i.unit_price));
  const sections = p.sections.filter((s) => s.heading.trim() || s.body.trim());
  const canRespond = !isOwner && (p.status === 'sent' || p.status === 'viewed');
  const expired = p.valid_until && Date.parse(`${p.valid_until}T23:59:59Z`) < Date.now();

  const body = html`
${isOwner ? html`<div class="owner-strip">
  <span>Preview. This is exactly what your client sees${p.status === 'draft' ? ' once you publish' : ''}.</span>
  <a class="button button-small" href="/app/proposals/${p.id}">Back to editor</a>
</div>` : ''}
<div class="live-banner" id="live-banner" hidden role="status">
  <span>This proposal was just updated.</span>
  <button class="button button-small" type="button" id="live-reload">Show the latest version</button>
</div>
<main class="doc-wrap">
  <article class="doc" id="doc" data-share="${p.share_id}" data-rev="${p.rev}" data-owner="${isOwner ? '1' : ''}">
    <header class="doc-head">
      <div class="doc-from">
        <strong>${ws.business_name}</strong>
        ${ws.business_email ? html`<span>${ws.business_email}</span>` : ''}
        ${ws.business_address ? html`<span class="pre">${ws.business_address}</span>` : ''}
      </div>
      <dl class="doc-meta">
        <div><dt>Proposal</dt><dd>${p.code}</dd></div>
        <div><dt>Date</dt><dd>${fmtDate(p.sent_at || p.created_at)}</dd></div>
        ${p.valid_until ? html`<div><dt>Valid until</dt><dd>${fmtDate(p.valid_until)}</dd></div>` : ''}
      </dl>
    </header>

    <h1 class="doc-title">${p.title}</h1>
    ${p.client_name || p.client_company ? html`<p class="doc-for">Prepared for ${[p.client_name, p.client_company].filter(Boolean).join(', ')}</p>` : ''}

    ${p.intro.trim() ? html`<div class="prose">${raw(renderMarkdown(p.intro))}</div>` : ''}

    ${sections.map((s) => html`<section class="doc-section">
      ${s.heading.trim() ? html`<h2>${s.heading}</h2>` : ''}
      <div class="prose">${raw(renderMarkdown(s.body))}</div>
    </section>`)}

    ${items.length ? html`<section class="doc-section">
      <h2>Investment</h2>
      <div class="table-scroll">
      <table class="price-table">
        <thead><tr><th scope="col">Item</th><th scope="col" class="num">Qty</th><th scope="col" class="num">Rate</th><th scope="col" class="num">Amount</th></tr></thead>
        <tbody>
          ${items.map((i) => html`<tr>
            <td>${i.description}${i.details ? html`<span class="item-details">${i.details}</span>` : ''}</td>
            <td class="num">${i.quantity}</td>
            <td class="num">${money(i.unit_price)}</td>
            <td class="num">${money((Number(i.quantity) || 0) * (Number(i.unit_price) || 0))}</td>
          </tr>`)}
        </tbody>
        <tfoot>
          <tr><th scope="row" colspan="3">Subtotal</th><td class="num">${money(p.totals.subtotal)}</td></tr>
          ${p.totals.discount ? html`<tr><th scope="row" colspan="3">Discount</th><td class="num">${'-' + money(p.totals.discount)}</td></tr>` : ''}
          ${p.tax_rate ? html`<tr><th scope="row" colspan="3">Tax (${p.tax_rate}%)</th><td class="num">${money(p.totals.tax)}</td></tr>` : ''}
          <tr class="grand"><th scope="row" colspan="3">Total</th><td class="num">${money(p.totals.total)}</td></tr>
        </tfoot>
      </table>
      </div>
    </section>` : ''}

    ${p.terms.trim() ? html`<section class="doc-section doc-terms"><h2>Terms</h2><div class="prose">${raw(renderMarkdown(p.terms))}</div></section>` : ''}

    <section class="doc-response" id="respond">
      ${p.status === 'accepted' ? html`<div class="stamp stamp-accepted"><strong>Accepted</strong><span>${p.signer_name}, ${fmtDate(p.responded_at)}</span></div>` : ''}
      ${p.status === 'declined' ? html`<div class="stamp stamp-declined"><strong>Declined</strong><span>${fmtDate(p.responded_at)}</span></div>` : ''}
      ${notice ? html`<p class="form-ok" role="status">${notice}</p>` : ''}
      ${error ? html`<p class="form-error" role="alert">${error}</p>` : ''}
      ${canRespond && !expired ? html`
        <form class="accept" method="post" action="/p/${p.share_id}/accept">
          <h2>Accept this proposal</h2>
          <p>Type your full name to accept the scope, price and terms above. ${ws.business_name} sees your answer right away.</p>
          <label>Your full name<input name="signer_name" required maxlength="120" autocomplete="name"></label>
          <label class="check"><input type="checkbox" name="agree" required> I agree to this proposal and its terms.</label>
          <button class="button" type="submit">Accept and sign</button>
        </form>
        <details class="decline">
          <summary>Decline instead</summary>
          <form method="post" action="/p/${p.share_id}/decline">
            <label>Anything you would like to share? (optional)<textarea name="reason" rows="3" maxlength="1000"></textarea></label>
            <button class="button button-quiet" type="submit">Decline proposal</button>
          </form>
        </details>` : ''}
      ${canRespond && expired ? html`<p class="hint">This proposal expired on ${fmtDate(p.valid_until)}. Contact ${ws.business_name} for an updated version.</p>` : ''}
    </section>
  </article>
  <p class="doc-tools"><button class="link-button" type="button" data-print>Print or save as PDF</button></p>
</main>`;
  return layout({ title: `${p.title}: ${ws.business_name}`, body, scripts: ['client-document.js'], bodyClass: 'page-doc' });
}

export function messagePage(title, text, { workspace } = {}) {
  const body = html`${workspace ? '' : html`<header class="sitebar">${wordmark('/')}</header>`}
<main class="message"><h1>${title}</h1><p>${text}</p><p><a class="button" href="${workspace ? '/app' : '/'}">${workspace ? 'Go to proposals' : 'Go to Pitchpad'}</a></p></main>`;
  return layout({ title: `${title}: Pitchpad`, body, workspace, bodyClass: workspace ? 'page-app' : 'page-site' });
}
