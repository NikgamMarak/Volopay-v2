// The client link stays live: if the owner or Claude edits the proposal while
// the client is reading, a banner offers the latest version.
(function () {
  const doc = document.getElementById('doc');
  if (!doc) return;
  const share = doc.dataset.share;
  const rev = Number(doc.dataset.rev);
  let submitting = false;
  const banner = document.getElementById('live-banner');

  document.getElementById('live-reload').addEventListener('click', () => location.reload());

  async function poll() {
    if (document.hidden || submitting) return;
    try {
      const r = await fetch(`/p/${encodeURIComponent(share)}/rev`, { headers: { Accept: 'application/json' } });
      if (!r.ok) return;
      const next = (await r.json()).rev;
      if (next !== rev) banner.hidden = false;
    } catch { /* offline */ }
  }
  setInterval(poll, 8000);

  document.querySelectorAll('form').forEach((f) => {
    f.addEventListener('submit', () => {
      // A person's own response shouldn't trigger the "updated" banner.
      submitting = true;
      setTimeout(() => f.querySelectorAll('button[type=submit]').forEach((b) => { b.disabled = true; }), 0);
    });
  });
})();
