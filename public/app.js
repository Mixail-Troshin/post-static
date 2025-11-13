const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

const loginSection  = $('#login-section');
const adminSection  = $('#admin-section');
const loginForm     = $('#login-form');
const loginInput    = $('#login');
const passInput     = $('#password');
const rememberInput = $('#remember');
const loginError    = $('#login-error');

const logoutBtn     = $('#logout-btn');
const statusLabel   = $('#status-label');

const addForm   = $('#add-form');
const urlInput  = $('#article-url');
const costInput = $('#article-cost');
const addError  = $('#add-error');

const dateFrom  = $('#date-from');
const dateTo    = $('#date-to');
const monthSel  = $('#month-select');
const resetBtn  = $('#reset-filter-btn');

const bodyEl    = $('#articles-body');

const statCount  = $('#stat-count');
const statOpens  = $('#stat-opens');
const statBudget = $('#stat-budget');
const statCpm    = $('#stat-cpm');

function showLogin(){
  adminSection.classList.add('hidden');
  loginSection.classList.remove('hidden');
  loginError.textContent = '';
  loginInput.focus();
}
function showAdmin(){
  loginSection.classList.add('hidden');
  adminSection.classList.remove('hidden');
}

async function api(url, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const res = await fetch(url, { credentials: 'same-origin', headers, ...opts });
  if (!res.ok) {
    let text;
    try { text = await res.json(); } catch { text = {}; }
    throw new Error(text.error || `HTTP ${res.status}`);
  }
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : res.text();
}

async function checkAuth() {
  try {
    const me = await api('/api/me');
    if (me.auth) {
      showAdmin();
      await loadArticles();
    } else {
      showLogin();
    }
  } catch {
    showLogin();
  }
}

// Login
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.textContent = '';
  try {
    await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({
        login: loginInput.value.trim(),
        password: passInput.value,
        remember: !!rememberInput.checked
      })
    });
    await checkAuth();
    loginForm.reset();
  } catch (err) {
    loginError.textContent = err.message || 'Ошибка входа';
  }
});

// Logout
logoutBtn.addEventListener('click', async () => {
  try {
    await api('/api/logout', { method: 'POST' });
  } catch {}
  await checkAuth();
});

// Add article
addForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  addError.textContent = '';
  try {
    const url = urlInput.value.trim();
    const cost = Number(costInput.value);
    const item = await api('/api/articles', {
      method: 'POST',
      body: JSON.stringify({ url, cost })
    });
    urlInput.value = '';
    costInput.value = '';
    await loadArticles();
  } catch (err) {
    addError.textContent = err.message || 'Не удалось добавить';
  }
});

// Filters
[dateFrom, dateTo, monthSel].forEach(el => el.addEventListener('change', () => renderArticles(window.__articles || [])));
resetBtn.addEventListener('click', () => {
  dateFrom.value = ''; dateTo.value = ''; monthSel.value = 'all';
  renderArticles(window.__articles || []);
});

function withinFilters(a) {
  const from = dateFrom.value ? new Date(dateFrom.value) : null;
  const to   = dateTo.value   ? new Date(dateTo.value)   : null;
  const month = monthSel.value;

  const pub = a.publishedAt ? new Date(a.publishedAt) : null;
  if (from && pub && pub < new Date(from.getFullYear(), from.getMonth(), from.getDate())) return false;
  if (to && pub && pub > new Date(to.getFullYear(), to.getMonth(), to.getDate(), 23, 59, 59, 999)) return false;
  if (month !== 'all' && pub && (pub.getMonth()+1) !== Number(month)) return false;
  return true;
}

function formatMoney(v) {
  if (v == null) return '—';
  return new Intl.NumberFormat('ru-RU').format(Math.round(v));
}
function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('ru-RU', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function renderArticles(list) {
  const rows = [];
  const filtered = list.filter(withinFilters);

  let totalOpens = 0;
  let totalCost = 0;
  filtered.forEach(a => {
    totalOpens += Number(a.opens || 0);
    totalCost  += Number(a.cost  || 0);
  });
  const avgCpm = totalOpens > 0 ? Math.round((totalCost / totalOpens) * 1000) : null;

  statCount.textContent  = filtered.length;
  statOpens.textContent  = formatMoney(totalOpens);
  statBudget.textContent = formatMoney(totalCost);
  statCpm.textContent    = avgCpm != null ? formatMoney(avgCpm) : '—';

  filtered
    .sort((a,b) => (b.publishedAt || '').localeCompare(a.publishedAt || ''))
    .forEach(a => {
      rows.push(`
        <tr>
          <td>${formatDate(a.publishedAt)}</td>
          <td>${a.title ? a.title.replace(/</g,'&lt;') : '—'}</td>
          <td><a href="${a.url}" target="_blank" rel="noopener">Открыть</a></td>
          <td><span class="badge">${formatMoney(a.opens)}</span></td>
          <td>${formatMoney(a.cost)}</td>
          <td>${a.cpm != null ? formatMoney(a.cpm) : '—'}</td>
          <td class="actions-cell">
            <button class="btn btn--danger" data-del="${a.id}">Удалить</button>
          </td>
        </tr>
      `);
    });

  bodyEl.innerHTML = rows.join('') || `<tr><td colspan="7" style="color:#9aa7bf">Пока пусто</td></tr>`;

  // delete handlers
  $$('button[data-del]').forEach(btn => {
    btn.onclick = async () => {
      const id = Number(btn.getAttribute('data-del'));
      try {
        await api(`/api/articles/${id}`, { method: 'DELETE' });
        await loadArticles();
      } catch (e) {
        alert(e.message || 'Не удалось удалить');
      }
    };
  });

  statusLabel.textContent = `Всего в базе: ${list.length}`;
}

async function loadArticles() {
  const data = await api('/api/articles');
  window.__articles = data;
  renderArticles(data);
}

// init
window.addEventListener('load', checkAuth);
