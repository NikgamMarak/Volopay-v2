// The proposal editor. A person can change anything Claude wrote.
// Saves automatically, and picks up Claude's changes while the page is open.
(function () {
  const { esc, money, ago, date, toast, copy, grow } = window.pp;
  const root = document.getElementById('editor-root');
  const boot = JSON.parse(document.getElementById('editor-data').textContent);
  const ID = boot.proposal.id;

  const EDITABLE = ['title', 'client_name', 'client_company', 'client_email', 'intro', 'sections', 'line_items', 'currency', 'tax_rate', 'discount', 'valid_until', 'terms'];
  const NUMERIC = new Set(['tax_rate', 'discount', 'quantity', 'unit_price']);
  const STATUS_LABEL = { draft: 'Draft', sent: 'Sent', viewed: 'Opened', accepted: 'Accepted', declined: 'Declined' };
  const ACTOR = { claude: 'Claude', you: 'You', client: 'Client' };

  const S = {
    p: boot.proposal,
    activity: boot.activity,
    dirty: false,
    saving: false,
    timer: null,
    conflict: null,
    savedAt: null,
    message: '',
  };

  // ---------- helpers ----------

  const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  function totals(p) {
    const subtotal = round2(p.line_items.reduce((s, i) => s + round2((Number(i.quantity) || 0) * (Number(i.unit_price) || 0)), 0));
    const discount = Math.min(round2(Number(p.discount) || 0), subtotal);
    const taxable = round2(subtotal - discount);
    const tax = round2((taxable * (Number(p.tax_rate) || 0)) / 100);
    return { subtotal, discount, tax, total: round2(taxable + tax) };
  }
  const toNum = (v) => (v === '' || v == null ? 0 : Number(v));
  const numAttr = (v) => (v === 0 || v ? String(v) : '');

  async function api(method, url, body) {
    const r = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (r.status === 401) { location.href = `/login?next=${encodeURIComponent(location.pathname)}`; throw new Error('auth'); }
    let data = {};
    try { data = await r.json(); } catch { /* empty */ }
    return { ok: r.ok, status: r.status, data };
  }

  function mergeMeta(server) {
    // Take server-owned fields without touching what the person is typing.
    for (const k of Object.keys(server)) if (!EDITABLE.includes(k)) S.p[k] = server[k];
  }

  // ---------- rendering ----------

  function sectionHtml(s, i, n) {
    return `<div class="sec" data-i="${i}">
      <div class="sec-bar">
        <input class="sec-heading" data-s="${i}" data-k="heading" value="${esc(s.heading)}" placeholder="Section heading" maxlength="200" aria-label="Section ${i + 1} heading">
        <div class="sec-tools">
          <button type="button" class="icon-btn" data-act="sec-up" data-i="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Move section up">↑</button>
          <button type="button" class="icon-btn" data-act="sec-down" data-i="${i}" ${i === n - 1 ? 'disabled' : ''} aria-label="Move section down">↓</button>
          <button type="button" class="icon-btn" data-act="sec-remove" data-i="${i}" aria-label="Remove section">×</button>
        </div>
      </div>
      <textarea data-s="${i}" data-k="body" rows="3" aria-label="Section ${i + 1} text" placeholder="Write this section. Use - for bullets.">${esc(s.body)}</textarea>
    </div>`;
  }

  function itemHtml(it, i) {
    const amount = (Number(it.quantity) || 0) * (Number(it.unit_price) || 0);
    return `<tr data-i="${i}">
      <td class="item-desc">
        <input data-li="${i}" data-k="description" value="${esc(it.description)}" placeholder="What the client pays for" maxlength="300" aria-label="Item ${i + 1} description">
        <input class="item-details-input" data-li="${i}" data-k="details" value="${esc(it.details || '')}" placeholder="Details (optional)" maxlength="1000" aria-label="Item ${i + 1} details">
      </td>
      <td><input type="number" inputmode="decimal" min="0" step="any" data-li="${i}" data-k="quantity" value="${numAttr(it.quantity)}" aria-label="Item ${i + 1} quantity"></td>
      <td><input type="number" inputmode="decimal" min="0" step="any" data-li="${i}" data-k="unit_price" value="${numAttr(it.unit_price)}" aria-label="Item ${i + 1} rate"></td>
      <td class="num" data-amount="${i}">${esc(money(amount, S.p.currency))}</td>
      <td><button type="button" class="icon-btn" data-act="item-remove" data-i="${i}" aria-label="Remove item">×</button></td>
    </tr>`;
  }

  function totalsHtml() {
    const t = totals(S.p);
    const c = S.p.currency;
    return `<div><dt>Subtotal</dt><dd>${esc(money(t.subtotal, c))}</dd></div>
      ${t.discount ? `<div><dt>Discount</dt><dd>-${esc(money(t.discount, c))}</dd></div>` : ''}
      ${Number(S.p.tax_rate) ? `<div><dt>Tax ${esc(S.p.tax_rate)}%</dt><dd>${esc(money(t.tax, c))}</dd></div>` : ''}
      <div class="grand"><dt>Total</dt><dd>${esc(money(t.total, c))}</dd></div>`;
  }

  function actionsHtml() {
    const p = S.p;
    const preview = `<a class="button button-quiet" href="/app/proposals/${encodeURIComponent(p.id)}/preview">Preview</a>`;
    const link = `<div class="copy-field"><input id="client-link" readonly value="${esc(p.client_url)}" aria-label="Client link"><button type="button" class="button button-small" data-copy="#client-link">Copy</button></div>`;
    let main = '';
    if (p.status === 'draft') {
      main = `<p>Only you can see this draft. Publish it to get a link your client can read and sign.</p>
        <div class="btn-row"><button type="button" class="button" data-act="publish">Publish client link</button>${preview}</div>`;
    } else if (p.status === 'sent' || p.status === 'viewed') {
      main = `<p>${p.status === 'viewed' ? `Your client opened it ${esc(ago(p.viewed_at))}.` : 'Published. Waiting for your client to open it.'} The link always shows your latest edits.</p>
        ${link}<div class="btn-row">${preview}</div>`;
    } else if (p.status === 'accepted') {
      main = `<p class="accepted-note">Signed by <strong>${esc(p.signer_name)}</strong> on ${esc(date(p.responded_at))}. Accepted proposals are locked.</p>
        ${link}<div class="btn-row"><button type="button" class="button button-quiet" data-act="reopen">Reopen for changes</button>${preview}</div>`;
    } else if (p.status === 'declined') {
      main = `<p>Declined ${esc(ago(p.responded_at))}.${p.decline_reason ? ` Their note: “${esc(p.decline_reason)}”` : ''}</p>
        <p class="hint">Edit anything to revise it, then publish again.</p>
        <div class="btn-row"><button type="button" class="button" data-act="publish">Publish again</button>${preview}</div>`;
    }
    return `<h2>Client link</h2>${main}<button type="button" class="link-button danger" data-act="delete">Delete proposal</button>`;
  }

  function activityHtml() {
    if (!S.activity.length) return '<li class="hint">No history yet.</li>';
    return S.activity.map((a) => `<li><span class="actor actor-${esc(a.actor)}">${esc(ACTOR[a.actor] || a.actor)}</span> <span class="act-text">${esc(a.action)}</span> <time datetime="${esc(a.created_at)}">${esc(ago(a.created_at))}</time></li>`).join('');
  }

  function focusKey(el) {
    if (!el || !root.contains(el)) return null;
    for (const k of ['f', 's', 'li']) if (el.dataset[k] !== undefined) return { k, v: el.dataset[k], sub: el.dataset.k, pos: el.selectionStart };
    return null;
  }
  function restoreFocus(key) {
    if (!key) return;
    const sel = `[data-${key.k}="${CSS.escape(key.v)}"]${key.sub ? `[data-k="${key.sub}"]` : ''}`;
    const el = root.querySelector(sel);
    if (!el) return;
    el.focus();
    try { if (key.pos != null) el.setSelectionRange(key.pos, key.pos); } catch { /* number inputs */ }
  }

  function render() {
    const p = S.p;
    const locked = p.status === 'accepted';
    const fk = focusKey(document.activeElement);
    root.innerHTML = `
    <div class="editor-top">
      <nav class="crumbs" aria-label="Breadcrumb"><a href="/app">Proposals</a><span aria-hidden="true">/</span><span>${esc(p.code)}</span></nav>
      <span class="status status-${p.status}" id="status-pill">${STATUS_LABEL[p.status]}</span>
      <span class="save-state" id="save-state" aria-live="polite"></span>
    </div>
    <div id="banner"></div>
    <div class="editor-grid">
      <div class="sheet" id="sheet">
        ${locked ? '<p class="lock-note">This proposal is accepted and locked. Reopen it to make changes.</p>' : ''}
        <fieldset ${locked ? 'disabled' : ''}>
          <textarea class="title-input" data-f="title" rows="1" maxlength="200" aria-label="Proposal title" placeholder="Proposal title">${esc(p.title)}</textarea>
          <div class="client-row">
            <label>Client name<input data-f="client_name" value="${esc(p.client_name)}" maxlength="200" autocomplete="off"></label>
            <label>Company<input data-f="client_company" value="${esc(p.client_company)}" maxlength="200" autocomplete="off"></label>
            <label>Email<input type="email" data-f="client_email" value="${esc(p.client_email)}" maxlength="200" autocomplete="off"></label>
          </div>

          <label class="block">Introduction<textarea data-f="intro" rows="3" placeholder="A short opening note to your client.">${esc(p.intro)}</textarea></label>

          <h2 class="sheet-h">Sections</h2>
          <p class="hint format-hint">Start a line with - for bullets or 1. for steps. Wrap words in **double asterisks** to make them bold.</p>
          <div class="sections">${p.sections.map((s, i) => sectionHtml(s, i, p.sections.length)).join('') || '<p class="hint">No sections yet.</p>'}</div>
          <button type="button" class="button button-quiet button-small" data-act="sec-add">Add section</button>

          <h2 class="sheet-h">Line items</h2>
          <div class="table-scroll">
            <table class="items-table">
              <thead><tr><th scope="col">Item</th><th scope="col">Qty</th><th scope="col">Rate</th><th scope="col" class="num">Amount</th><th scope="col"><span class="sr-only">Remove</span></th></tr></thead>
              <tbody>${p.line_items.map(itemHtml).join('')}</tbody>
            </table>
          </div>
          ${p.line_items.length ? '' : '<p class="hint">No line items yet.</p>'}
          <button type="button" class="button button-quiet button-small" data-act="item-add">Add line item</button>

          <label class="block">Terms<textarea data-f="terms" rows="3">${esc(p.terms)}</textarea></label>
        </fieldset>
      </div>

      <aside class="editor-side">
        <section class="panel">
          <h2>Pricing</h2>
          <fieldset ${locked ? 'disabled' : ''}>
            <div class="row-2">
              <label>Currency<select data-f="currency">${boot.currencies.concat(boot.currencies.includes(p.currency) ? [] : [p.currency]).map((c) => `<option ${c === p.currency ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
              <label>Valid until<input type="date" data-f="valid_until" value="${esc(p.valid_until || '')}"></label>
            </div>
            <div class="row-2">
              <label>Discount<input type="number" inputmode="decimal" min="0" step="any" data-f="discount" value="${numAttr(p.discount)}"></label>
              <label>Tax %<input type="number" inputmode="decimal" min="0" max="100" step="any" data-f="tax_rate" value="${numAttr(p.tax_rate)}"></label>
            </div>
          </fieldset>
          <dl class="totals" id="totals">${totalsHtml()}</dl>
        </section>
        <section class="panel" id="actions">${actionsHtml()}</section>
        <section class="panel">
          <h2>History</h2>
          <ol class="activity" id="activity">${activityHtml()}</ol>
        </section>
      </aside>
    </div>`;
    root.querySelectorAll('textarea').forEach(grow);
    renderSaveState();
    renderBanner();
    restoreFocus(fk);
  }

  function renderSide() {
    const pill = document.getElementById('status-pill');
    pill.className = `status status-${S.p.status}`;
    pill.textContent = STATUS_LABEL[S.p.status];
    document.getElementById('actions').innerHTML = actionsHtml();
    document.getElementById('activity').innerHTML = activityHtml();
  }

  function renderTotals() {
    document.getElementById('totals').innerHTML = totalsHtml();
    S.p.line_items.forEach((it, i) => {
      const cell = root.querySelector(`[data-amount="${i}"]`);
      if (cell) cell.textContent = money((Number(it.quantity) || 0) * (Number(it.unit_price) || 0), S.p.currency);
    });
  }

  function renderSaveState() {
    const el = document.getElementById('save-state');
    if (!el) return;
    if (S.message) el.textContent = S.message;
    else if (S.saving) el.textContent = 'Saving';
    else if (S.dirty) el.textContent = 'Unsaved changes';
    else if (S.savedAt) el.textContent = `Saved ${ago(S.savedAt)}`;
    else el.textContent = S.p.last_edited_by === 'claude' ? `Last edited by Claude ${ago(S.p.updated_at)}` : `Saved ${ago(S.p.updated_at)}`;
  }

  function renderBanner() {
    const el = document.getElementById('banner');
    if (!el) return;
    if (!S.conflict) { el.innerHTML = ''; return; }
    const who = S.conflict.last_edited_by === 'claude' ? 'Claude' : 'Someone';
    el.innerHTML = `<div class="banner" role="alert">
      <p><strong>${who} changed this proposal while you were editing.</strong> Pick which version to keep.</p>
      <div class="btn-row">
        <button type="button" class="button button-small" data-act="take-theirs">Load ${who === 'Claude' ? "Claude's" : 'the latest'} version</button>
        <button type="button" class="button button-quiet button-small" data-act="keep-mine">Keep my version</button>
      </div>
    </div>`;
  }

  // ---------- saving ----------

  function markDirty() {
    S.dirty = true;
    S.message = '';
    renderSaveState();
    clearTimeout(S.timer);
    if (!S.conflict) S.timer = setTimeout(save, 700);
  }

  async function save() {
    if (S.saving || !S.dirty || S.conflict) return;
    S.saving = true;
    S.dirty = false;
    renderSaveState();
    const fields = {};
    for (const k of EDITABLE) fields[k] = S.p[k];
    try {
      const r = await api('PUT', `/api/proposals/${encodeURIComponent(ID)}`, { base_version: S.p.version, fields });
      if (r.ok) {
        mergeMeta(r.data.proposal);
        S.activity = r.data.activity;
        S.savedAt = new Date().toISOString();
        S.message = '';
        renderSide();
      } else if (r.status === 409) {
        S.dirty = true;
        S.conflict = r.data.proposal;
        renderBanner();
      } else if (r.status === 423) {
        S.p = r.data.proposal;
        S.dirty = false;
        render();
        toast('This proposal is accepted and locked.');
      } else {
        S.dirty = true;
        S.message = r.data.error ? `Not saved: ${r.data.error}` : 'Not saved. Retrying soon.';
        if (!r.data.error) setTimeout(save, 5000);
      }
    } catch {
      S.dirty = true;
      S.message = 'Offline. Your changes will save when you reconnect.';
      setTimeout(save, 5000);
    } finally {
      S.saving = false;
      renderSaveState();
      if (S.dirty && !S.conflict && !S.message) { clearTimeout(S.timer); S.timer = setTimeout(save, 700); }
    }
  }

  async function flush() {
    clearTimeout(S.timer);
    while (S.saving) await new Promise((r) => setTimeout(r, 100));
    if (S.dirty) await save();
    return !S.dirty && !S.conflict;
  }

  // ---------- events ----------

  function onField(e) {
    const t = e.target;
    let changed = false;
    if (t.dataset.f !== undefined) {
      const f = t.dataset.f;
      S.p[f] = NUMERIC.has(f) ? toNum(t.value) : f === 'valid_until' ? (t.value || null) : t.value;
      changed = true;
      if (f === 'currency') renderTotals();
    } else if (t.dataset.s !== undefined) {
      S.p.sections[Number(t.dataset.s)][t.dataset.k] = t.value;
      changed = true;
    } else if (t.dataset.li !== undefined) {
      const k = t.dataset.k;
      S.p.line_items[Number(t.dataset.li)][k] = NUMERIC.has(k) ? toNum(t.value) : t.value;
      changed = true;
    }
    if (!changed) return;
    if (t.tagName === 'TEXTAREA') grow(t);
    renderTotals();
    markDirty();
  }
  root.addEventListener('input', onField);
  root.addEventListener('keydown', (e) => {
    // The title is one line, even though it wraps.
    if (e.key === 'Enter' && e.target.dataset.f === 'title') e.preventDefault();
  });
  root.addEventListener('change', (e) => { if (e.target.tagName === 'SELECT') onField(e); });

  root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    const i = Number(b.dataset.i);
    const p = S.p;
    switch (b.dataset.act) {
      case 'sec-add':
        p.sections.push({ heading: '', body: '' });
        render(); markDirty();
        root.querySelector(`[data-s="${p.sections.length - 1}"][data-k="heading"]`).focus();
        break;
      case 'sec-remove':
        if ((p.sections[i].heading || p.sections[i].body) && !confirm('Remove this section?')) return;
        p.sections.splice(i, 1); render(); markDirty();
        break;
      case 'sec-up':
        [p.sections[i - 1], p.sections[i]] = [p.sections[i], p.sections[i - 1]]; render(); markDirty();
        break;
      case 'sec-down':
        [p.sections[i + 1], p.sections[i]] = [p.sections[i], p.sections[i + 1]]; render(); markDirty();
        break;
      case 'item-add':
        p.line_items.push({ description: '', details: '', quantity: 1, unit_price: 0 });
        render(); markDirty();
        root.querySelector(`[data-li="${p.line_items.length - 1}"][data-k="description"]`).focus();
        break;
      case 'item-remove':
        p.line_items.splice(i, 1); render(); markDirty();
        break;
      case 'publish': {
        if (!(await flush())) return;
        const r = await api('POST', `/api/proposals/${encodeURIComponent(ID)}/publish`, {});
        if (!r.ok) { toast(r.data.error || 'Could not publish.'); return; }
        mergeMeta(r.data.proposal); S.activity = r.data.activity; renderSide();
        await copy(S.p.client_url);
        toast('Published. Client link copied.');
        break;
      }
      case 'reopen': {
        const r = await api('POST', `/api/proposals/${encodeURIComponent(ID)}/reopen`, {});
        if (!r.ok) { toast(r.data.error || 'Could not reopen.'); return; }
        S.p = r.data.proposal; S.activity = r.data.activity; render();
        toast('Reopened. The proposal is a draft again.');
        break;
      }
      case 'delete': {
        if (!confirm('Delete this proposal? The client link stops working too.')) return;
        const r = await api('DELETE', `/api/proposals/${encodeURIComponent(ID)}`);
        if (r.ok) location.href = '/app'; else toast(r.data.error || 'Could not delete.');
        break;
      }
      case 'take-theirs':
        S.p = S.conflict; S.conflict = null; S.dirty = false; S.message = '';
        await refreshActivity();
        render();
        toast('Loaded the latest version.');
        break;
      case 'keep-mine':
        S.p.version = S.conflict.version; S.conflict = null; S.dirty = true;
        renderBanner(); await save();
        toast('Kept your version.');
        break;
      default:
    }
  });

  async function refreshActivity() {
    const r = await api('GET', `/api/proposals/${encodeURIComponent(ID)}`);
    if (r.ok) S.activity = r.data.activity;
    return r;
  }

  // ---------- live updates ----------

  async function poll() {
    if (document.hidden || S.saving) return;
    let r;
    try { r = await api('GET', `/api/proposals/${encodeURIComponent(ID)}/rev`); } catch { return; }
    if (r.status === 404) { S.message = 'This proposal was deleted.'; renderSaveState(); return; }
    if (!r.ok || r.data.rev === S.p.rev || S.saving) return;

    const full = await api('GET', `/api/proposals/${encodeURIComponent(ID)}`);
    if (!full.ok || S.saving) return;
    const server = full.data.proposal;
    const prevStatus = S.p.status;

    if (server.version !== S.p.version) {
      if (S.dirty || S.conflict) { S.conflict = server; renderBanner(); return; }
      S.p = server;
      S.activity = full.data.activity;
      S.savedAt = null;
      render();
      const sheet = document.getElementById('sheet');
      sheet.classList.add('sheet-fresh');
      setTimeout(() => sheet.classList.remove('sheet-fresh'), 1600);
      toast(server.last_edited_by === 'claude' ? 'Claude just updated this proposal.' : 'This proposal was updated in another tab.');
    } else {
      mergeMeta(server);
      S.activity = full.data.activity;
      if ((prevStatus === 'accepted') !== (server.status === 'accepted')) render(); else renderSide();
    }
    if (prevStatus !== server.status) {
      const said = { viewed: 'Your client just opened the proposal.', accepted: 'Your client accepted and signed.', declined: 'Your client declined the proposal.' }[server.status];
      if (said) toast(said);
    }
  }

  window.addEventListener('beforeunload', (e) => {
    if (S.dirty || S.saving) { e.preventDefault(); e.returnValue = ''; }
  });

  render();
  setInterval(poll, 4000);
  setInterval(() => { renderSaveState(); const a = document.getElementById('activity'); if (a) a.innerHTML = activityHtml(); }, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
})();
