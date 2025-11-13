const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

const fmtDate = (sec) => sec ? new Date(sec * 1000).toLocaleString() : '—';
const fmtNum = (n) => (n ?? 0).toLocaleString('ru-RU');
const money = (n) => `${(n ?? 0).toLocaleString('ru-RU')} ₽`;

$('#logoutBtn')?.addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  location.href = '/';
});

// tabs
$$('nav.tabs button').forEach(b => {
  b.onclick = () => {
    $$('nav.tabs button').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    $$('.tab').forEach(x => x.classList.remove('active'));
    $('#tab-' + b.dataset.tab).classList.add('active');
    if (b.dataset.tab === 'monitor') loadArticles();
    if (b.dataset.tab === 'users') loadUsers();
    if (b.dataset.tab === 'settings') loadSettings();
  };
});

// мониторинг
async function loadArticles() {
  $('#listStatus').textContent = 'Загрузка...';
  const r = await fetch('/api/articles');
  if (!r.ok) { $('#listStatus').textContent = 'Ошибка загрузки'; return; }
  const { items, cpm } = await r.json();
  $('#listStatus').textContent = `Ставки CPM — открытий: ${cpm.views}₽ / 1000; лента: ${cpm.hits}₽ / 1000`;

  const tb = $('#articlesTbl tbody'); tb.innerHTML = '';
  for (const a of items) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><a href="${a.url}" target="_blank">${a.title || '(без названия)'}</a><div class="muted">vc_id: ${a.vc_id}</div></td>
      <td>${fmtDate(a.pub_date)}</td>
      <td>${fmtNum(a.views)}</td>
      <td>${fmtNum(a.hits)}</td>
      <td>${money(Math.round((a.views ?? 0) / 1000 * cpm.views))}</td>
      <td>${money(Math.round((a.hits ?? 0) / 1000 * cpm.hits))}</td>
      <td>${money(a.revenue_views + a.revenue_hits)}</td>
      <td class="actions">
        <button data-act="refresh" data-id="${a.id}">Обновить</button>
        <button data-act="remove" data-id="${a.id}" class="secondary">Удалить</button>
      </td>
    `;
    tb.appendChild(tr);
  }

  tb.querySelectorAll('button[data-act="refresh"]').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.dataset.id;
      const txt = btn.textContent;
      btn.disabled = true; btn.textContent = '...';
      const r = await fetch(`/api/articles/${id}/refresh`, { method: 'POST' });
      if (!r.ok) alert('Ошибка обновления');
      btn.disabled = false; btn.textContent = txt;
      await loadArticles();
    };
  });
  tb.querySelectorAll('button[data-act="remove"]').forEach(btn => {
    btn.onclick = async () => {
      if (!confirm('Удалить статью и её метрики?')) return;
      const id = btn.dataset.id;
      const r = await fetch(`/api/articles/${id}`, { method: 'DELETE' });
      if (!r.ok) alert('Ошибка удаления');
      await loadArticles();
    };
  });
}
loadArticles();

$('#addForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = e.target.url.value.trim();
  const status = $('#addStatus');
  const btn = e.submitter; btn.disabled = true; status.textContent = 'Добавляем...';
  try {
    const r = await fetch('/api/articles', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url })
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Ошибка добавления');
    status.textContent = '✅ Готово';
    e.target.reset();
    await loadArticles();
  } catch (err) {
    status.textContent = `⚠️ ${err.message}`;
  } finally {
    btn.disabled = false;
    setTimeout(() => status.textContent = '', 2500);
  }
});

// пользователи
async function loadUsers() {
  const r = await fetch('/api/users');
  if (!r.ok) { $('#usersTbl tbody').innerHTML = '<tr><td colspan="4">Нет доступа</td></tr>'; return; }
  const { users } = await r.json();
  const tb = $('#usersTbl tbody'); tb.innerHTML = '';
  for (const u of users) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${u.email || u.username}</td>
      <td><span class="badge">${u.role}</span></td>
      <td>${new Date(u.created_at).toLocaleString()}</td>
      <td>
        <button data-reset="${u.id}">Сбросить пароль</button>
        <button data-del="${u.id}" class="secondary">Удалить</button>
      </td>`;
    tb.appendChild(tr);
  }
  tb.querySelectorAll('button[data-reset]').forEach(b => b.onclick = async () => {
    const id = b.dataset.reset;
    const r = await fetch(`/api/users/${id}/reset`, { method: 'POST' });
    if (!r.ok) alert('Ошибка');
    else alert('Пароль отправлен (или выведен в логи сервера)');
  });
  tb.querySelectorAll('button[data-del]').forEach(b => b.onclick = async () => {
    if (!confirm('Удалить пользователя?')) return;
    const id = b.dataset.del;
    await fetch(`/api/users/${id}`, { method: 'DELETE' });
    await loadUsers();
  });
}
$('#userForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = e.target.email.value.trim();
  const role = e.target.role.value;
  const st = $('#userStatus');
  const btn = e.submitter; btn.disabled = true; st.textContent = 'Создаём...';
  try {
    const r = await fetch('/api/users', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, role })
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Ошибка');
    st.textContent = '✅ Готово';
    e.target.reset();
    await loadUsers();
  } catch (err) { st.textContent = `⚠️ ${err.message}`; }
  finally { btn.disabled = false; setTimeout(() => st.textContent='', 2500); }
});

// настройки
async function loadSettings() {
  const r = await fetch('/api/settings');
  if (!r.ok) return;
  const set = await r.json();
  const f = $('#settingsForm');
  f.CPM_VIEWS.value = set.CPM_VIEWS ?? 0;
  f.CPM_HITS.value = set.CPM_HITS ?? 0;
}
$('#settingsForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const st = $('#setStatus');
  st.textContent = 'Сохраняем...';
  const body = {
    CPM_VIEWS: Number(e.target.CPM_VIEWS.value || 0),
    CPM_HITS: Number(e.target.CPM_HITS.value || 0)
  };
  const r = await fetch('/api/settings', {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  });
  if (!r.ok) st.textContent = 'Ошибка';
  else { st.textContent = '✅ Сохранено'; setTimeout(() => st.textContent = '', 2000); }
});
