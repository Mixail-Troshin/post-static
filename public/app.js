const apiBase = ''; // тот же домен/порт, где крутится сервер

const tableBody = document.getElementById('articles-body');
const totalArticlesEl = document.getElementById('total-articles');
const totalViewsEl = document.getElementById('total-views');
const form = document.getElementById('add-form');
const urlInput = document.getElementById('article-url');
const formMessage = document.getElementById('form-message');
const refreshAllBtn = document.getElementById('refresh-all');

async function fetchArticles() {
  const res = await fetch(`${apiBase}/api/articles`);
  return res.json();
}

function formatDate(iso) {
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

function renderArticles(articles) {
  tableBody.innerHTML = '';

  let totalViews = 0;

  articles.forEach((article, index) => {
    totalViews += article.views || 0;

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
      <td class="small">${formatDate(article.lastUpdated)}</td>
      <td class="actions">
        <button class="table-row-button" data-id="${article.id}">Обновить</button>
      </td>
    `;

    tableBody.appendChild(tr);
  });

  totalArticlesEl.textContent = articles.length;
  totalViewsEl.textContent = totalViews.toLocaleString('ru-RU');
}

async function loadAndRender() {
  try {
    const articles = await fetchArticles();
    renderArticles(articles);
  } catch (e) {
    console.error(e);
  }
}

// отправка формы "Добавить статью"
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  formMessage.textContent = '';
  formMessage.className = 'message';

  const url = urlInput.value.trim();
  if (!url) return;

  try {
    const res = await fetch(`${apiBase}/api/articles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });

    const data = await res.json();

    if (!res.ok) {
      formMessage.textContent = data.error || 'Ошибка при добавлении статьи';
      formMessage.classList.add('error');
      return;
    }

    formMessage.textContent = 'Статья добавлена ✅';
    formMessage.classList.add('success');
    urlInput.value = '';

    await loadAndRender();
  } catch (err) {
    console.error(err);
    formMessage.textContent = 'Ошибка подключения к серверу';
    formMessage.classList.add('error');
  }
});

// кнопка "Обновить все"
refreshAllBtn.addEventListener('click', async () => {
  refreshAllBtn.disabled = true;
  const originalText = refreshAllBtn.textContent;
  refreshAllBtn.textContent = 'Обновляем...';

  try {
    await fetch(`${apiBase}/api/refresh-all`, { method: 'POST' });
    await loadAndRender();
  } catch (e) {
    console.error(e);
    alert('Ошибка при обновлении всех статей');
  } finally {
    refreshAllBtn.disabled = false;
    refreshAllBtn.textContent = originalText;
  }
});

// кнопка "Обновить" в строке
tableBody.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-id]');
  if (!btn) return;

  const id = btn.dataset.id;
  btn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = '...';

  try {
    await fetch(`${apiBase}/api/articles/${id}/refresh`, {
      method: 'POST'
    });
    await loadAndRender();
  } catch (err) {
    console.error(err);
    alert('Не удалось обновить статью');
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
});

// первая загрузка
loadAndRender();
