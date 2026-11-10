// Proposals list. Polls the server so proposals Claude creates appear without a refresh.
(function () {
  const { esc, money, ago } = window.pp;
  const listEl = document.getElementById('proposal-list');
  const filtersEl = document.getElementById('filters');
  let proposals = JSON.parse(document.getElementById('dashboard-data').textContent).proposals;
  let filter = new URLSearchParams(location.search).get('status') || 'all';
  let lastJson = JSON.stringify(proposals);
  const fresh = new Set();

  const LABEL = { draft: 'Draft', sent: 'Sent', viewed: 'Opened', accepted: 'Accepted', declined: 'Declined' };
  const FILTERS = [['all', 'All'], ['draft', 'Drafts'], ['sent', 'Sent'], ['viewed', 'Opened'], ['accepted', 'Accepted'], ['declined', 'Declined']];
  const WHO = { claude: 'Claude', you: 'you', client: 'your client' };

  function lastEvent(p) {
    if (p.status === 'accepted') return `Signed by ${p.signer_name}`;
    if (p.status === 'declined') return 'Declined by your client';
    if (p.status === 'viewed' && Date.parse(p.viewed_at) >= Date.parse(p.updated_at) - 1000) return 'Opened by your client';
    if (p.created_by === 'claude' && p.version === 1) return 'Written by Claude';
    return `Edited by ${WHO[p.last_edited_by] || 'you'}`;
  }

  function render() {
    const counts = { all: proposals.length };
    for (const p of proposals) counts[p.status] = (counts[p.status] || 0) + 1;

    filtersEl.innerHTML = FILTERS
      .filter(([k]) => k === 'all' || counts[k] || k === filter)
      .map(([k, label]) => `<button type="button" role="tab" aria-selected="${k === filter}" data-filter="${k}">${label} <span class="count">${counts[k] || 0}</span></button>`)
      .join('');

    const shown = filter === 'all' ? proposals : proposals.filter((p) => p.status === filter);

    if (!proposals.length) {
      listEl.innerHTML = `<div class="empty">
        <h2>Your first proposal starts in Claude</h2>
        <p>Connect Pitchpad using the link on this page, then ask Claude something like:</p>
        <blockquote>Use Pitchpad to write a proposal for Priya at Northwind Yoga: a booking-friendly website, 4 pages, 3 weeks, $1,800.</blockquote>
        <p>The draft appears here within seconds. You can also start one by hand.</p>
      </div>`;
      return;
    }
    if (!shown.length) {
      listEl.innerHTML = `<div class="empty"><p>No ${esc(LABEL[filter] || '').toLowerCase()} proposals.</p></div>`;
      return;
    }

    listEl.innerHTML = `<ul class="rows">${shown.map((p) => `
      <li class="${fresh.has(p.id) ? 'row-fresh' : ''}">
        <a class="row" href="/app/proposals/${encodeURIComponent(p.id)}">
          <span class="row-code">${esc(p.code)}</span>
          <span class="row-main">
            <span class="row-title">${esc(p.title)}</span>
            <span class="row-client">${esc([p.client_name, p.client_company].filter(Boolean).join(', ') || 'No client yet')}</span>
          </span>
          <span class="status status-${p.status}">${LABEL[p.status]}</span>
          <span class="row-total">${esc(money(p.totals.total, p.currency))}</span>
          <span class="row-when">${esc(lastEvent(p))}, ${esc(ago(p.updated_at))}</span>
        </a>
      </li>`).join('')}</ul>`;
  }

  filtersEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-filter]');
    if (!b) return;
    filter = b.dataset.filter;
    const url = new URL(location.href);
    if (filter === 'all') url.searchParams.delete('status'); else url.searchParams.set('status', filter);
    history.replaceState(null, '', url);
    render();
  });

  async function poll() {
    if (document.hidden) return;
    try {
      const r = await fetch('/api/proposals', { headers: { Accept: 'application/json' } });
      if (r.status === 401) { location.href = '/login?next=/app'; return; }
      if (!r.ok) return;
      const next = (await r.json()).proposals;
      const json = JSON.stringify(next);
      if (json === lastJson) { render(); return; }
      const before = new Map(proposals.map((p) => [p.id, p.rev]));
      fresh.clear();
      for (const p of next) if (before.get(p.id) !== p.rev) fresh.add(p.id);
      const added = next.filter((p) => !before.has(p.id));
      proposals = next;
      lastJson = json;
      render();
      if (added.length) window.pp.toast(added.length === 1 ? `New proposal: ${added[0].title}` : `${added.length} new proposals`);
    } catch { /* offline, try again next tick */ }
  }

  render();
  setInterval(poll, 5000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
})();
