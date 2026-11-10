// Shared helpers for every page. Plain browser JavaScript, no build step.
(function () {
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESC[c]);

  function money(amount, currency) {
    const locale = currency === 'INR' ? 'en-IN' : 'en-US';
    try { return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount || 0); }
    catch { return `${currency} ${Number(amount || 0).toFixed(2)}`; }
  }

  function ago(iso) {
    if (!iso) return '';
    const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
    if (s < 45) return 'just now';
    const m = Math.round(s / 60);
    if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h} h ago`;
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  }

  function date(iso) {
    if (!iso) return '';
    const d = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }

  let toastEl;
  function toast(message) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'toast';
      toastEl.setAttribute('role', 'status');
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = message;
    toastEl.classList.add('toast-on');
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(() => toastEl.classList.remove('toast-on'), 2600);
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const t = document.createElement('textarea');
      t.value = text;
      t.setAttribute('readonly', '');
      t.style.position = 'fixed';
      t.style.opacity = '0';
      document.body.appendChild(t);
      t.select();
      document.execCommand('copy');
      t.remove();
    }
  }

  function grow(el) {
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }

  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-copy], [data-copy-text]');
    if (btn) {
      const text = btn.dataset.copyText != null ? btn.dataset.copyText : (document.querySelector(btn.dataset.copy) || {}).value || '';
      await copy(text);
      toast(btn.dataset.copyText != null ? 'Prompt copied. Paste it into Claude.' : 'Copied');
      return;
    }
    if (e.target.closest('[data-print]')) window.print();
  });

  document.addEventListener('submit', (e) => {
    const msg = e.target.dataset && e.target.dataset.confirm;
    if (msg && !window.confirm(msg)) e.preventDefault();
  });

  document.addEventListener('input', (e) => {
    if (e.target.matches && e.target.matches('textarea[data-autogrow]')) grow(e.target);
  });
  document.querySelectorAll('textarea[data-autogrow]').forEach(grow);

  window.pp = { esc, money, ago, date, toast, copy, grow };
})();
