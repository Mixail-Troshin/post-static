(async function () {
  const $ = (id) => document.getElementById(id);
  const nf = new Intl.NumberFormat('ru-RU');

  const whoami = $('whoami');
  const logoutBtn = $('logoutBtn');
  const adminPanel = $('adminPanel');
  const inviteEmail = $('inviteEmail');
  const inviteBtn = $('inviteBtn');
  const resetBtn = $('resetBtn');
  const adminMsg = $('adminMsg');

  const articleSelect = $('articleSelect');
  const contentId = $('contentId');
  const loadBtn = $('loadBtn');
  const status = $('status');
  const viewsEl = $('views');
  const hitsEl = $('hits');
  const modeSel = $('mode');
  const fixedInputs = $('fixedInputs');
  const budgetInput = $('budgetInput');
  const cpmHits = $('cpmHits');
  const cpmViews = $('cpmViews');
  const budget = $('budget');
  const calcA = $('calcA');
  const calcB = $('calcB');
  const calcTitle = $('calcTitle');
  const calcASub = $('calcASub');
  const calcBSub = $('calcBSub');

  let CONFIG = { apiBase: '', mode: 'fixed', cpm: { hits: 500, views: 150 }, budget: 10000 };

  function setStatus(kind, textHtml) {
    status.className = `status ${kind}`;
    status.innerHTML = textHtml;
  }
  function apiBase() {
    const base = (CONFIG.apiBase || '').trim();
    return base || ''; // свой же origin
  }

  // ---- auth check ----
  try {
    const r = await fetch('/api/auth/me');
    if (!r.ok) location.href = '/login';
    const me = await r.json();
    whoami.textContent = `${me.user.email || me.user.username} (${me.user.role})`;
    if (me.user.role === 'admin') adminPanel.style.display = 'block';
  } catch {
    location.href = '/login';
    return;
  }

  logoutBtn.addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    location.href = '/login';
  });

  // ---- admin actions ----
  function setAdminMsg(kind, text) {
    adminMsg.className = `status ${kind}`;
    adminMsg.textContent = text;
  }
  inviteBtn.addEventListener('click', async () => {
    setAdminMsg('muted', 'Отправляю приглашение…');
    try {
      const r = await fetch('/api/users/invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail.value })
      });
      const d = await r.json();
      if (!r.ok || !d.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setAdminMsg('ok', 'Готово. Письмо отправлено (или залогировано, если SMTP не настроен).');
    } catch (e) {
      setAdminMsg('err', 'Ошибка: ' + (e.message || e));
    }
  });
  resetBtn.addEventListener('click', async () => {
    setAdminMsg('muted', 'Сбрасываю пароль…');
    try {
      const r = await fetch('/api/users/reset', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail.value })
      });
      const d = await r.json();
      if (!r.ok || !d.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setAdminMsg('ok', 'Готово. Новый пароль отправлен.');
    } catch (e) {
      setAdminMsg('err', 'Ошибка: ' + (e.message || e));
    }
  });

  // ---- metrics UI ----
  function computeAndRender({ views, hits }) {
    viewsEl.textContent = views == null ? '—' : nf.format(views);
    hitsEl.textContent = hits == null ? '—' : nf.format(hits);

    const v = Number(views || 0);
    const h = Number(hits || 0);

    if (modeSel.value === 'fixed') {
      const cHits = Number(cpmHits.value || 0);
      const cViews = Number(cpmViews.value || 0);
      const costHits = h > 0 ? (h / 1000) * cHits : 0;
      const costViews = v > 0 ? (v / 1000) * cViews : 0;
      calcA.textContent = nf.format(Math.round(costHits * 100) / 100);
      calcB.textContent = nf.format(Math.round(costViews * 100) / 100);
    } else {
      const b = Number(budget.value || 0);
      const eCPMHits = h > 0 ? (b / h) * 1000 : 0;
      const eCPMViews = v > 0 ? (b / v) * 1000 : 0;
      calcA.textContent = nf.format(Math.round(eCPMHits * 100) / 100);
      calcB.textContent = nf.format(Math.round(eCPMViews * 100) / 100);
    }
  }

  modeSel.addEventListener('change', () => {
    const isFixed = modeSel.value === 'fixed';
    fixedInputs.style.display = isFixed ? 'flex' : 'none';
    budgetInput.style.display = isFixed ? 'none' : 'flex';
    if (isFixed) {
      calcTitle.textContent = 'Стоимость по CPM (₽)';
      calcASub.textContent = 'по открытиям';
      calcBSub.textContent = 'по показам';
    } else {
      calcTitle.textContent = 'eCPM (₽ за 1000)';
      calcASub.textContent = 'по открытиям';
      calcBSub.textContent = 'по показам';
    }
  });

  // первичная загрузка конфигов/списка статей
  try {
    const [cfgRes, listRes] = await Promise.all([
      fetch('/config.json'),
      fetch('/articles.json')
    ]);
    if (cfgRes.ok) CONFIG = await cfgRes.json();
    const list = listRes.ok ? await listRes.json() : [];
    articleSelect.innerHTML = '';
    list.forEach((a, i) => {
      const opt = document.createElement('option');
      opt.value = a.id;
      opt.textContent = `${a.id} — ${a.title || ''}`;
      if (i === 0) opt.selected = true;
      articleSelect.appendChild(opt);
    });
    if (list.length) contentId.value = list[0].id;
    modeSel.value = CONFIG.mode || 'fixed';
    cpmHits.value = CONFIG.cpm?.hits ?? 500;
    cpmViews.value = CONFIG.cpm?.views ?? 150;
    budget.value = CONFIG.budget ?? 10000;
    modeSel.dispatchEvent(new Event('change'));
  } catch {}

  articleSelect.addEventListener('change', () => {
    contentId.value = articleSelect.value;
  });

  loadBtn.addEventListener('click', async () => {
    setStatus('muted', '<span class="spinner"></span> Ждем загрузки…');
    const id = contentId.value.trim();
    if (!id) {
      setStatus('err', 'Укажи content_id');
      return;
    }
    try {
      const base = apiBase();
      const url = `${base}/api/metrics?content_id=${encodeURIComponent(id)}`;
      const r = await fetch(url);
      const data = await r.json();
      if (!r.ok || !data.ok) throw new Error(data.error || `HTTP ${r.status}`);
      computeAndRender({ views: data.views, hits: data.hits });
      setStatus('ok', 'Готово. Данные получены.');
    } catch (e) {
      setStatus('err', `Ошибка: ${e.message || e}`);
    }
  });
})();
