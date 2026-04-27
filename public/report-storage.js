(() => {
  let lastData = null;
  let me = null;
  const $ = id => document.getElementById(id);

  function sources(data) {
    return ['speed', 'events', 'oee', 'sluis', 'orders', 'pasaban'].filter(k => data && data[k]);
  }
  function route(data) {
    const optional = ['oee', 'sluis', 'orders', 'pasaban'].filter(k => data && data[k]).length;
    return optional ? 'Complete route' : 'Basic route';
  }
  function shiftLabel() {
    return `${$('shift-start')?.value || ''}-${$('shift-end')?.value || ''}`;
  }
  function reportTitle() {
    const machine = $('machine')?.value || 'Machine';
    const stamp = new Date().toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' });
    return `${machine} ${shiftLabel()} ${stamp}`;
  }
  function insertBar(user) {
    if (document.querySelector('.jm-accountbar')) return;
    const bar = document.createElement('div');
    bar.className = 'jm-accountbar';
    bar.innerHTML = `<div><strong>${user.name || user.email}</strong><span>${user.location || 'No site'} · ${user.role === 'admin' ? 'admin' : 'user'}</span></div><nav><a href="/my-reports">My reports</a>${user.role === 'admin' ? '<a href="/admin">Admin</a>' : ''}<button type="button" id="jm-logout">Log out</button></nav>`;
    document.body.prepend(bar);
    document.getElementById('jm-logout').onclick = () => window.jmAuth.logout();
  }
  function insertSavePanel() {
    if (document.querySelector('.jm-savepanel')) return;
    const panel = document.createElement('section');
    panel.className = 'jm-savepanel';
    panel.innerHTML = `<div><div class="title">Storage</div><p class="muted">Save the generated report so you and admins can view it later. Old reports are cleaned up automatically based on the retention setting.</p></div><button class="btn" id="jm-save-report" disabled>Save report</button><span id="jm-save-status" class="muted"></span>`;
    const tabs = $('tabs');
    tabs?.parentNode.insertBefore(panel, tabs);
    $('jm-save-report').onclick = saveReport;
  }
  async function saveReport() {
    const report = $('report');
    const status = $('jm-save-status');
    if (!report || !report.innerHTML.trim() || !lastData) return;
    $('jm-save-report').disabled = true;
    status.textContent = 'Saving...';
    try {
      const payload = {
        title: reportTitle(),
        machine: $('machine')?.value || '',
        shift: shiftLabel(),
        route: route(lastData),
        sources: sources(lastData),
        summary: `${route(lastData)} with ${sources(lastData).join(', ')}`,
        html: report.innerHTML,
      };
      const res = await fetch('/api/reports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Save failed.');
      status.textContent = `Saved: ${data.report.title}`;
    } catch (e) {
      status.textContent = e.message;
    } finally {
      $('jm-save-report').disabled = false;
    }
  }
  function patchBuild() {
    if (typeof window.build !== 'function' || window.build.__jmPatched) return;
    const original = window.build;
    window.build = function patchedBuild(data) {
      lastData = data;
      const result = original.apply(this, arguments);
      setTimeout(() => {
        const btn = $('jm-save-report');
        if (btn) btn.disabled = false;
      }, 0);
      return result;
    };
    window.build.__jmPatched = true;
  }
  function styles() {
    const style = document.createElement('style');
    style.textContent = `.jm-accountbar{display:flex;justify-content:space-between;align-items:center;gap:16px;background:#0b0c0f;border-bottom:1px solid var(--border);padding:10px 34px;color:var(--text)}.jm-accountbar span{display:block;color:var(--muted);font-size:12px}.jm-accountbar nav{display:flex;align-items:center;gap:10px}.jm-accountbar a,.jm-accountbar button{border:1px solid var(--border);background:var(--bg2);color:var(--text);border-radius:7px;padding:7px 10px;text-decoration:none;font-weight:800;font-size:12px;cursor:pointer}.jm-savepanel{display:flex;justify-content:space-between;align-items:center;gap:14px;background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:18px;margin:16px 0}@media(max-width:780px){.jm-accountbar,.jm-savepanel{display:block}.jm-accountbar nav{margin-top:10px;flex-wrap:wrap}.jm-savepanel .btn{margin-top:12px}}`;
    document.head.appendChild(style);
  }
  document.addEventListener('jm:user', e => {
    me = e.detail.user;
    styles();
    insertBar(me);
    insertSavePanel();
    patchBuild();
  });
  setTimeout(patchBuild, 0);
})();
