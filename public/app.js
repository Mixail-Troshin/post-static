// app.js

let ALL_ARTICLES = [];

// --------- УТИЛИТЫ ----------

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('ru-RU');
}

function formatNumber(x) {
  if (x == null) return '—';
  return x.toLocaleString('ru-RU');
}

function formatMoney(x) {
  if (x == null) return '—';
  return x.toLocaleString('ru-RU', {
    maximumFractionDigits: 0,
  });
}

// --------- АВТОРИЗАЦИЯ ----------

async function checkAuth() {
  try {
    const res = await fetch('/api/auth/status');
    if (res.ok) {
      showApp();
      await loadArticles();
    } else {
      showLogin();
    }
  } catch (e) {
    console.error('Ошибка проверки авторизации', e);
    showLogin();
  }
}

function showLogin() {
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('app').classList.add('hidden');
}

function showApp() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
}

async function handleLogin(event) {
  event.preventDefault();
  const login = document.getElementById('login').value.trim();
  const password = document.getElementById('password').value.trim();
  const errorEl = document.getElementById('login-error');
  errorEl.textContent = '';

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login, password }),
    });

    if (res.ok) {
      showApp();
      await loadArticles();
    } else {
      errorEl.textContent = 'Неверный логин или пароль';
    }
  } catch (e) {
    console.error(e);
    errorEl.textContent = 'Ошибка при попытке входа';
  }
}

async function handleLogout() {
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
  } catch (e) {
    console.warn('Ошибка логаута', e);
  }
  showLogin();
}

// --------- РАБОТА СО СТАТЬЯМИ ----------

async function loadArticles() {
  try {
    const res = await fetch('/api/articles');
    if (!res.ok) {
      if (res.status === 401) {
        showLogin();
        return;
      }
      throw new Error('Ошибка загрузки статей');
    }

    ALL_ARTICLES = await res.json();
    renderArticles();
  } catch (e) {
    console.error(e);
    alert('Не удалось загрузить статьи');
  }
}

function getFilteredArticles() {
  const fromVal = document.getElementById('from').value;
  const toVal = document.getElementById('to').value;
  const monthVal = document.getElementById('month').value;

  let from = fromVal ? new Date(fromVal) : null;
  let to = toVal ? new Date(toVal) : null;

  if (to) {
    // включительно конец дня
    to.setHours(23, 59, 59, 999);
  }

  return ALL_ARTICLES.filter((a) => {
    if (!a.publishedAt) return true;
    const d = new Date(a.publishedAt);

    if (from && d < from) return false;
    if (to && d > to) return false;

    if (monthVal !== '') {
      const m = d.getMonth();
      if (m !== Number(monthVal)) return false;
    }

    return true;
  });
}

function renderArticles() {
  const tbody = document.getElementById('articles-tbody');
  tbody.innerHTML = '';

  const filtered = getFilteredArticles();

  let totalOpens = 0;
  let totalCost = 0;
  let cpmValues = 0;
  let cpmCount = 0;

  for (const article of filtered) {
    const tr = document.createElement('tr');

    const published = formatDate(article.publishedAt);
    const opens = article.opens ?? article.views ?? 0;
    const cost = article.cost || 0;
    const cpm =
      opens > 0 && cost > 0 ? +(cost / (opens / 1000)).toFixed(2) : null;

    totalOpens += opens;
    totalCost += cost;
    if (cpm != null) {
      cpmValues += cpm;
      cpmCount += 1;
    }

    tr.innerHTML = `
      <td>${published}</td>
      <td>${article.title ? article.title : '—'}</td>
      <td>
        <a href="${article.url}" target="_blank" rel="noopener noreferrer">Открыть</a>
      </td>
      <td>${formatNumber(opens)}</td>
      <td>${formatMoney(cost)}</td>
      <td>${cpm != null ? formatNumber(cpm) : '—'}</td>
      <td>
        <button class="btn danger small" data-id="${article.id}">Удалить</button>
      </td>
    `;

    tbody.appendChild(tr);
  }

  // обновляем сводку
  document.getElementById('stat-count').textContent = filtered.length;
  document.getElementById('stat-opens').textContent = formatNumber(totalOpens);
  document.getElementById('stat-cost').textContent = formatMoney(totalCost);

  const avgCpm = cpmCount > 0 ? +(cpmValues / cpmCount).toFixed(2) : null;
  document.getElementById('stat-cpm').textContent =
    avgCpm != null ? formatNumber(avgCpm) : '—';

  // навешиваем обработчики удаления
  tbody.querySelectorAll('button[data-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      deleteArticle(id);
    });
  });
}

async function deleteArticle(id) {
  if (!confirm('Удалить эту статью из списка?')) return;

  try {
    const res = await fetch(`/api/articles/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Ошибка удаления');

    ALL_ARTICLES = ALL_ARTICLES.filter((a) => a.id !== id);
    renderArticles();
  } catch (e) {
    console.error(e);
    alert('Не удалось удалить статью');
  }
}

async function handleAddArticle(event) {
  event.preventDefault();
  const urlInput = document.getElementById('url');
  const costInput = document.getElementById('cost');

  const url = urlInput.value.trim();
  const cost = costInput.value ? Number(costInput.value) : 0;

  if (!url) {
    alert('Введите ссылку на статью');
    return;
  }

  const btn = event.submitter || event.target.querySelector('button[type=submit]');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Добавляем...';

  try {
    const res = await fetch('/api/articles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, cost }),
    });

    if (!res.ok) {
      if (res.status === 401) {
        showLogin();
        return;
      }
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Не удалось добавить статью');
    }

    const article = await res.json();
    ALL_ARTICLES.push(article);
    urlInput.value = '';
    costInput.value = '';
    renderArticles();
  } catch (e) {
    console.error(e);
    alert(e.message || 'Ошибка при добавлении статьи');
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

async function handleRefreshAll() {
  if (!confirm('Обновить статистику по всем статьям?')) return;

  const btn = document.getElementById('refresh-btn');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Обновляем...';

  try {
    const res = await fetch('/api/articles/refresh', { method: 'POST' });
    if (!res.ok) {
      if (res.status === 401) {
        showLogin();
        return;
      }
      throw new Error('Не удалось обновить статьи');
    }
    ALL_ARTICLES = await res.json();
    renderArticles();
  } catch (e) {
    console.error(e);
    alert(e.message || 'Ошибка при обновлении статей');
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

function handleFiltersChange() {
  renderArticles();
}

function handleClearFilters() {
  document.getElementById('from').value = '';
  document.getElementById('to').value = '';
  document.getElementById('month').value = '';
  renderArticles();
}

// --------- INIT ----------

document.addEventListener('DOMContentLoaded', () => {
  // логин
  const loginForm = document.getElementById('login-form');
  loginForm.addEventListener('submit', handleLogin);

  // logout
  document.getElementById('logout-btn').addEventListener('click', handleLogout);

  // форма добавления
  document
    .getElementById('add-form')
    .addEventListener('submit', handleAddArticle);

  // кнопка обновления
  document
    .getElementById('refresh-btn')
    .addEventListener('click', handleRefreshAll);

  // фильтры
  ['from', 'to', 'month'].forEach((id) => {
    const el = document.getElementById(id);
    el.addEventListener('change', handleFiltersChange);
  });

  document
    .getElementById('clear-filters')
    .addEventListener('click', handleClearFilters);

  // старт — проверяем авторизацию
  checkAuth();
});
