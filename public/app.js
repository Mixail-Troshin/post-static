// элементы DOM — убедись, что в HTML есть такие id
const loginSection = document.getElementById('login-section');
const adminSection = document.getElementById('admin-section');

const loginForm = document.getElementById('login-form');
const loginInput = document.getElementById('login');
const passwordInput = document.getElementById('password');
const loginError = document.getElementById('login-error');

const logoutBtn = document.getElementById('logout-btn');
const statusLabel = document.getElementById('status-label');

const addForm = document.getElementById('add-form');
const urlInput = document.getElementById('article-url');
const costInput = document.getElementById('article-cost');
const addError = document.getElementById('add-error');

const dateFromInput = document.getElementById('date-from');
const dateToInput = document.getElementById('date-to');
const monthSelect = document.getElementById('month-select');
const resetFilterBtn = document.getElementById('reset-filter-btn');

const statCount = document.getElementById('stat-count');
const statOpens = document.getElementById('stat-opens');
const statBudget = document.getElementById('stat-budget');
const statCpm = document.getElementById('stat-cpm');

const articlesBody = document.getElementById('articles-body');

let allArticles = [];

// --- helpers ---
function setLoading(text = 'Обновляем…') {
  if (statusLabel) statusLabel.textContent = text;
}

function clearLoading() {
  if (statusLabel) statusLabel.textContent = '';
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: {
      'Content-Type': 'application/json'
    },
    credentials: 'same-origin',
    ...options
  });

  if (res.status === 401) {
    showLogin();
    throw new Error('Не авторизован');
  }

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.error || 'Ошибка запроса');
  }

  return data;
}

function showLogin() {
  if (loginSection) loginSection.classList.remove('hidden');
  if (adminSection) adminSection.classList.add('hidden');
}

function showAdmin() {
  if (loginSection) loginSection.classList.add('hidden');
  if (adminSection) adminSection.classList.remove('hidden');
}

// --- авторизация ---
if (loginForm) {
  loginForm.addEventListener('submit', async e => {
    e.preventDefault();
    if (loginError) loginError.textContent = '';

    try {
      setLoading('Вход…');

      await api('/api/login', {
        method: 'POST',
        body: JSON.stringify({
          login: loginInput.value.trim(),
          password: passwordInput.value.trim()
        })
      });

      showAdmin();
      await loadArticles();
    } catch (err) {
      if (loginError) loginError.textContent = err.message;
    } finally {
      clearLoading();
    }
  });
}

if (logoutBtn) {
  logoutBtn.addEventListener('click', async () => {
    try {
      await api('/api/logout', { method: 'POST' });
    } catch {}
    showLogin();
  });
}

// --- работа со статьями ---
async function loadArticles() {
  try {
    setLoading('Загружаем статьи…');
    const articles = await api('/api/articles');
    allArticles = articles;
    render();
  } catch (err) {
    console.error(err);
  } finally {
    clearLoading();
  }
}

if (addForm) {
  addForm.addEventListener('submit', async e => {
    e.preventDefault();
    if (addError) addError.textContent = '';

    const url = urlInput.value.trim();
    const cost = costInput.value.trim();

    if (!url) {
      if (addError) addError.textContent = 'Укажите ссылку на публикацию';
      return;
    }

    try {
      setLoading('Подтягиваем статистику…');
      const article = await api('/api/articles', {
        method: 'POST',
        body: JSON.stringify({ url, cost })
      });

      allArticles.push(article);
      urlInput.value = '';
      costInput.value = '';
      render();
    } catch (err) {
      if (addError) addError.textContent = err.message;
    } finally {
      clearLoading();
    }
  });
}

async function handleDelete(id) {
  if (!confirm('Удалить эту статью?')) return;
  try {
    await api(`/api/articles/${id}`, { method: 'DELETE' });
    allArticles = allArticles.filter(a => a.id !== id);
    render();
  } catch (err) {
    alert(err.message);
  }
}

// --- фильтры и статистика ---
function normalizeDate(dateStr) {
  if (!dateStr) return null;

  // ISO
  const iso = Date.parse(dateStr);
  if (!Number.isNaN(iso)) return new Date(iso);

  // dd.mm.yyyy
  const parts = dateStr.split('.');
  if (parts.length === 3) {
    const [d, m, y] = parts.map(Number);
    return new Date(y, m - 1, d);
  }

  return null;
}

function applyFilters(list) {
  let filtered = [...list];

  const from = dateFromInput?.value ? new Date(dateFromInput.value) : null;
  const to = dateToInput?.value ? new Date(dateToInput.value) : null;
  const month = monthSelect?.value || 'all';

  if (from || to || month !== 'all') {
    filtered = filtered.filter(a => {
      const d = normalizeDate(a.publishedAt);
      if (!d) return true;
      if (from && d < from) return false;
      if (to && d > to) return false;
      if (month !== 'all' && d.getMonth() + 1 !== Number(month)) return false;
      return true;
    });
  }

  return filtered;
}

function formatNumber(n) {
  if (n == null || Number.isNaN(n)) return '—';
  return n.toLocaleString('ru-RU');
}

function render() {
  const list = applyFilters(allArticles);

  const count = list.length;
  const opens = list.reduce((sum, a) => sum + (a.opens || 0), 0);
  const budget = list.reduce((sum, a) => sum + (a.cost || 0), 0);
  const avgCpm = opens > 0 ? Math.round((budget / opens) * 1000) : null;

  if (statCount) statCount.textContent = count;
  if (statOpens) statOpens.textContent = formatNumber(opens);
  if (statBudget) statBudget.textContent = formatNumber(budget);
  if (statCpm)
    statCpm.textContent = avgCpm != null ? formatNumber(avgCpm) : '—';

  if (!articlesBody) return;

  articlesBody.innerHTML = '';

  list
    .slice()
    .sort((a, b) => {
      const da = normalizeDate(a.publishedAt)?.getTime() || 0;
      const db = normalizeDate(b.publishedAt)?.getTime() || 0;
      return db - da;
    })
    .forEach(article => {
      const tr = document.createElement('tr');

      const dateTd = document.createElement('td');
      dateTd.textContent = article.publishedAt || '—';

      const titleTd = document.createElement('td');
      titleTd.textContent = article.title || 'Без названия';

      const linkTd = document.createElement('td');
      const link = document.createElement('a');
      link.href = article.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = 'Открыть';
      linkTd.appendChild(link);

      const opensTd = document.createElement('td');
      opensTd.textContent = formatNumber(article.opens);

      const costTd = document.createElement('td');
      costTd.textContent = formatNumber(article.cost);

      const cpmTd = document.createElement('td');
      cpmTd.textContent =
        article.cpm != null ? formatNumber(article.cpm) : '—';

      const actionsTd = document.createElement('td');
      actionsTd.className = 'actions-cell';
      const delBtn = document.createElement('button');
      delBtn.className = 'btn-secondary';
      delBtn.textContent = 'Удалить';
      delBtn.addEventListener('click', () => handleDelete(article.id));
      actionsTd.appendChild(delBtn);

      tr.appendChild(dateTd);
      tr.appendChild(titleTd);
      tr.appendChild(linkTd);
      tr.appendChild(opensTd);
      tr.appendChild(costTd);
      tr.appendChild(cpmTd);
      tr.appendChild(actionsTd);

      articlesBody.appendChild(tr);
    });
}

// фильтры
[dateFromInput, dateToInput, monthSelect].forEach(el => {
  if (!el) return;
  el.addEventListener('change', () => render());
});

if (resetFilterBtn) {
  resetFilterBtn.addEventListener('click', () => {
    if (dateFromInput) dateFromInput.value = '';
    if (dateToInput) dateToInput.value = '';
    if (monthSelect) monthSelect.value = 'all';
    render();
  });
}

// при загрузке страницы пробуем сразу получить статьи
window.addEventListener('load', async () => {
  try {
    await loadArticles();
    showAdmin();
  } catch {
    showLogin();
  }
});
