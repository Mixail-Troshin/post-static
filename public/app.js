const apiBase = ''; // тот же домен, где крутится бекенд

const tableBody = document.getElementById('articles-body');
const totalArticlesEl = document.getElementById('total-articles');
const totalViewsEl = document.getElementById('total-views');
const totalCostEl = document.getElementById('total-cost');
const totalCpmEl = document.getElementById('total-cpm');
const avgViewsEl = document.getElementById('avg-views');

const form = document.getElementById('add-form');
const urlInput = document.getElementById('article-url');
const costInput = document.getElementById('article-cost');
const formMessage = document.getElementById('form-message');

const refreshAllBtn = document.getElementById('refresh-all');

const filterFromInput = document.getElementById('filter-from');
const filterToInput = document.getElementById('filter-to');
const applyFilterBtn = document.getElementById('apply-filter');
const resetFilterBtn = document.getElementById('reset-filter');
const quickFilterChips = document.querySelectorAll('.chip[data-filter]');

let allArticles = [];
let filteredArticles = [];

// ====== helpers ======

function formatDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('ru-RU');
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function parseISODate(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function toNumberOrNull(value) {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isNaN(value) ? null : value;
  const num = parseFloat(String(value).replace(',', '.'));
  return Number.isNaN(num) ? null : num;
}

function formatMoney(value) {
  const num = toNumberOrNull(value);
  if (num == null) return '—';
  return num.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
}

function calcCpm(cost, views) {
  const c = toNumberOrNull(cost);
  const v = toNumberOrNull(views);
  if (c == null || v == null || v === 0) return null;
  return (c / v) * 1000;
}

// ====== API ======

async function fetchArticles() {
  const res = await fetch(`${apiBase}/api/articles`);
  if (!res.ok) throw new Error('Failed to load articles');
  return res.json();
}

async function addArticle(url, cost) {
  const res = await fetch(`${apiBase}/api/articles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, cost })
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Ошибка при добавлении статьи');
  }
  return data;
}

async function refreshArticle(id) {
  const res = await fetch(`${apiBase}/api/articles/${id}/refresh`, {
    method: 'POST'
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Ошибка при обновлении статьи');
  }
  return data;
}

async function refreshAll() {
  const res = await fetch(`${apiBase}/api/refresh-all`, {
    method: 'POST'
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Ошибка при обновлении всех статей');
  }
  return data;
}

async function deleteArticle(id) {
  const res = await fetch(`${apiBase}/api/articles/${id}`, {
    method: 'DELETE'
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Ошибка при удалении статьи');
  }
  return data;
}

// ====== фильтрация ======

function applyFilter() {
  const from = filterFromInput.value ? new Date(filterFromInput.value) : null;
  const to = filterToInput.value ? new Date(filterToInput.value) : null;

  if (from) from.setHours(0, 0, 0, 0);
  if (to) to.setHours(23, 59, 59, 999);

  filteredArticles = allArticles.filter((article) => {
    const dateSource = article.publishedDatetime || article.publishedAt;
    const d = parseISODate(dateSource);
    if (!d) return true;

    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  });

  renderArticles(filteredArticles);
  renderStats(filteredArticles);
}

function setQuickFilter(type) {
  quickFilterChips.forEach((chip) => chip.classList.remove('active'));

  const chip = document.querySelector(`.chip[data-filter="${type}"]`);
  if (chip) chip.classList.add('active');

  const now = new Date();
  let from = null;
  let to = null;

  if (type === 'all') {
    filterFromInput.value = '';
    filterToInput.value = '';
  } else if (type === 'this-month') {
    from = new Date(now.getFullYear(), now.getMonth(), 1);
    to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  } else if (type === 'last-month') {
    const m = now.getMonth() - 1;
    const year = m < 0 ? now.getFullYear() - 1 : now.getFullYear();
    const realMonth = (m + 12) % 12;
    from = new Date(year, realMonth, 1);
    to = new Date(year, realMonth + 1, 0);
  }

  if (from && to) {
    filterFromInput.value = from.toISOString().slice(0, 10);
    filterToInput.value = to.toISOString().slice(0, 10);
  }

  applyFilter();
}

// ====== рендер ======

function renderArticles(articles) {
  tableBody.innerHTML = '';

  articles.forEach((article, index) => {
    const cpm = calcCpm(article.cost, article.views);
    const tr = document.createElement('tr');

    tr.innerHTML = `
      <td>${index + 1}</td>
      <td>${article.title ? escapeHtml(article.title) : '—'}</td>
      <td class="small">
        <a href="${article.url}" target="_blank" rel="noopener noreferrer">
          открыть
        </a>
      </td>
      <td class="small">${article.publishedAt || '—'}</td>
      <td class="views">${article.views ?? '—'}</td>
      <td class="views">${formatMoney(article.cost)}</td>
      <td class="views">${cpm == null ? '—' : formatMoney(cpm)}</td>
      <td class="small">${formatDateTime(article.lastUpdated)}</td>
      <td class="actions">
        <button class="table-row-button" data-action="refresh" data-id="${article.id}">Обновить</button>
        <button class="table-row-button delete" data-action="delete" data-id="${article.id}">Удалить</button>
      </td>
    `;

    tableBody.appendChild(tr);
  });
}

function renderStats(articles) {
  const totalArticles = articles.length;
  let totalViews = 0;
  let totalCost = 0;

  articles.forEach((a) => {
    const views = toNumberOrNull(a.views) || 0;
    const cost = toNumberOrNull(a.cost) || 0;
    totalViews += views;
    totalCost += cost;
  });

  totalArticlesEl.textContent = totalArticles;
  totalViewsEl.textContent = totalViews.toLocaleString('ru-RU');
  totalCostEl.textContent = totalCost.toLocaleString('ru-RU', {
    maximumFractionDigits: 2
  });

  const avg = totalArticles ? Math.round(totalViews / totalArticles) : 0;
  avgViewsEl.textContent = avg.toLocaleString('ru-RU');

  const totalCpm = totalViews ? (totalCost / totalViews) * 1000 : 0;
  totalCpmEl.textContent = totalViews
    ? totalCpm.toLocaleString('ru-RU', { maximumFractionDigits: 2 })
    : '0';
}

// ====== основная логика ======

async function loadAndRender() {
  try {
    const data = await fetchArticles();
    allArticles = data;
    setQuickFilter('all');
  } catch (e) {
    console.error(e);
    alert('Ошибка загрузки статей с сервера');
  }
}

// отправка формы "Добавить статью"
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  formMessage.textContent = '';
  formMessage.className = 'message';

  const url = urlInput.value.trim();
  let costVal = costInput.value.trim();

  let cost = null;
  if (costVal) {
    const num = parseFloat(costVal.replace(',', '.'));
    if (!Number.isNaN(num)) cost = num;
  }

  if (!url) return;

  try {
    await addArticle(url, cost);
    formMessage.textContent = 'Статья добавлена и загружена ✅';
    formMessage.classList.add('success');
    urlInput.value = '';
    costInput.value = '';

    await loadAndRender();
  } catch (err) {
    console.error(err);
    formMessage.textContent = err.message || 'Ошибка при добавлении статьи';
    formMessage.classList.add('error');
  }
});

// кнопка "Обновить все"
refreshAllBtn.addEventListener('click', async () => {
  refreshAllBtn.disabled = true;
  const originalText = refreshAllBtn.textContent;
  refreshAllBtn.textContent = 'Обновляем...';

  try {
    await refreshAll();
    await loadAndRender();
  } catch (e) {
    console.error(e);
    alert('Ошибка при обновлении всех статей');
  } finally {
    refreshAllBtn.disabled = false;
    refreshAllBtn.textContent = originalText;
  }
});

// кнопки в таблице (обновить / удалить)
tableBody.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;

  const action = btn.dataset.action;
  const id = btn.dataset.id;

  if (action === 'refresh') {
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '...';

    try {
      await refreshArticle(id);
      await loadAndRender();
    } catch (err) {
      console.error(err);
      alert('Не удалось обновить статью');
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }

  if (action === 'delete') {
    const ok = confirm('Удалить эту статью?');
    if (!ok) return;

    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '...';

    try {
      await deleteArticle(id);
      await loadAndRender();
    } catch (err) {
      console.error(err);
      alert('Не удалось удалить статью');
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }
});

// фильтр: кнопка "Применить"
applyFilterBtn.addEventListener('click', () => {
  quickFilterChips.forEach((chip) => chip.classList.remove('active'));
  applyFilter();
});

// фильтр: кнопка "Сбросить"
resetFilterBtn.addEventListener('click', () => {
  filterFromInput.value = '';
  filterToInput.value = '';
  setQuickFilter('all');
});

// быстрые фильтры
quickFilterChips.forEach((chip) => {
  chip.addEventListener('click', () => {
    const type = chip.dataset.filter;
    setQuickFilter(type);
  });
});

// первая загрузка
loadAndRender();
