(async function () {
  const $ = (id) => document.getElementById(id);
  const nf = new Intl.NumberFormat('ru-RU');

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

  // конфиг
  let CONFIG = { apiBase: '', mode: 'fixed', cpm: { hits: 500, views: 150 }, budget: 10000 };

  function setStatus(kind, textHtml) {
    status.className = `status ${kind}`;
    status.innerHTML = textHtml;
  }

  function apiBase() {
    const base = (CONFIG.apiBase || '').trim();
    return base || ''; // свой же origin
  }

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

  // переключение режима
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

    // populate select
    articleSelect.innerHTML = '';
    list.forEach((a, i) => {
      const opt = document.createElement('option');
      opt.value = a.id;
      opt.textContent = `${a.id} — ${a.title || ''}`;
      if (i === 0) opt.selected = true;
      articleSelect.appendChild(opt);
    });
    if (list.length) contentId.value = list[0].id;

    // apply config defaults
    modeSel.value = CONFIG.mode || 'fixed';
    cpmHits.value = CONFIG.cpm?.hits ?? 500;
    cpmViews.value = CONFIG.cpm?.views ?? 150;
    budget.value = CONFIG.budget ?? 10000;
    modeSel.dispatchEvent(new Event('change'));
  } catch (e) {
    // не критично
  }

  // выбор из селекта заливает ID в поле
  articleSelect.addEventListener('change', () => {
    contentId.value = articleSelect.value;
  });

  // Срабатываем с ПЕРВОГО нажатия
  loadBtn.addEventListener('click', async () => {
    loadBtn.disabled = true;
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
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      if (!data.ok) throw new Error(data.error || 'Неизвестная ошибка');

      computeAndRender({ views: data.views, hits: data.hits });
      setStatus('ok', 'Готово. Данные получены.');
    } catch (e) {
      setStatus('err', `Ошибка: ${e.message || e}`);
    }
  }, { once: true });
})();
