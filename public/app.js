const state = {
  me: null,
  price: 0,
  items: []
};

const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const fmtDate = ts => {
  if (!ts) return "—";
  const d = new Date((String(ts).length > 10 ? ts : ts * 1000));
  return d.toLocaleString();
};
const money = n => (n || 0).toLocaleString("ru-RU");

async function api(path, opts = {}) {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...opts
  });
  if (!res.ok) {
    let t = "";
    try { t = await res.json(); } catch { t = await res.text(); }
    throw new Error(t?.error || t || res.statusText);
  }
  const txt = await res.text();
  return txt ? JSON.parse(txt) : {};
}

function setTab(name) {
  $$(".tab").forEach(b => b.classList.toggle("active", b.dataset.tab === name));
  $("#tab-monitor").classList.toggle("hidden", name !== "monitor");
  $("#tab-users").classList.toggle("hidden", name !== "users");
}

function cpm(val) {
  const price = Number(state.price || 0);
  return !val ? 0 : Math.round((price / (val / 1000)));
}

// --------- auth UI ----------
async function tryMe() {
  try {
    const { user } = await api("/api/me");
    state.me = user;
    $("#loginSection").classList.add("hidden");
    $("#appSection").classList.remove("hidden");
    $("#usersTab").style.display = user.isAdmin ? "inline-block" : "none";
    await loadArticles();
  } catch {
    $("#loginSection").classList.remove("hidden");
    $("#appSection").classList.add("hidden");
  }
}

$("#loginBtn").onclick = async () => {
  $("#loginError").textContent = "";
  try {
    const email = $("#loginEmail").value.trim();
    const password = $("#loginPass").value;
    await api("/api/login", { method: "POST", body: JSON.stringify({ email, password }) });
    await tryMe();
  } catch (e) {
    $("#loginError").textContent = "Ошибка: " + e.message;
  }
};
$("#logoutBtn").onclick = async () => { await api("/api/logout", { method: "POST" }); location.reload(); };

// --------- tabs ----------
$$(".tab").forEach(b => b.onclick = () => setTab(b.dataset.tab));

// --------- monitor ----------
async function loadArticles() {
  const { items, placementPrice } = await api("/api/articles");
  state.items = items;
  state.price = placementPrice || 0;
  $("#priceInput").value = state.price;
  $("#priceHint").textContent = "(используется для расчёта CPM)";
  renderTable();
}

function renderTable() {
  const tbody = $("#articlesTable tbody");
  tbody.innerHTML = "";
  for (const it of state.items) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${fmtDate(it.date)}</td>
      <td><a href="${it.url}" target="_blank">${it.title || it.url}</a></td>
      <td>${money(it.counters?.hits)}</td>
      <td>${money(it.counters?.views)}</td>
      <td>${money(cpm(it.counters?.hits))}</td>
      <td>${money(cpm(it.counters?.views))}</td>
      <td>${fmtDate(it.lastUpdated)}</td>
      <td class="actions">
        <button data-act="refresh" data-id="${it.id}" class="secondary">Обновить</button>
        <button data-act="remove" data-id="${it.id}" class="danger">Удалить</button>
      </td>
    `;
    tbody.appendChild(tr);
  }

  // делегирование
  tbody.onclick = async e => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const id = btn.dataset.id;
    if (btn.dataset.act === "refresh") {
      btn.disabled = true; btn.textContent = "…";
      try {
        const { item } = await api(`/api/articles/${id}/refresh`, { method: "PATCH" });
        const idx = state.items.findIndex(x => x.id == id);
        state.items[idx] = item;
        renderTable();
      } finally { btn.disabled = false; btn.textContent = "Обновить"; }
    }
    if (btn.dataset.act === "remove") {
      if (!confirm("Удалить статью из списка?")) return;
      await api(`/api/articles/${id}`, { method: "DELETE" });
      state.items = state.items.filter(x => x.id != id);
      renderTable();
    }
  };
}

$("#addBtn").onclick = async () => {
  const url = $("#addUrl").value.trim();
  if (!url) return;
  $("#addStatus").textContent = "Добавляю…";
  try {
    await api("/api/articles", { method: "POST", body: JSON.stringify({ url }) });
    $("#addUrl").value = "";
    $("#addStatus").textContent = "Готово";
    await loadArticles();
  } catch (e) {
    $("#addStatus").textContent = "Ошибка: " + e.message;
  }
};

$("#refreshAllBtn").onclick = async () => {
  $("#refreshAllBtn").disabled = true; $("#refreshAllBtn").textContent = "Обновляю…";
  try { await api("/api/refresh-all", { method: "POST" }); await loadArticles(); }
  catch (e) { alert("Ошибка: " + e.message); }
  finally { $("#refreshAllBtn").disabled = false; $("#refreshAllBtn").textContent = "Обновить всё"; }
};

$("#savePriceBtn").onclick = async () => {
  const val = Number($("#priceInput").value || 0);
  // обновим прямо в config.json через users-reset хак? — не надо.
  // сделаем минимальный эндпоинт на сервере через POST /api/refresh-all с полем?
  // Проще: отправим служебный запрос на смену цены через админовский only endpoint:
  try {
    // небольшой трюк: изменим файл конфигурации через приватный эндпоинт
    const res = await api("/api/users", { method: "GET" }); // проверим админ-ли он
    // если не упало — мы админ, дернем скрытый endpoint:
    await api("/api/admin/set-price", { method: "POST", body: JSON.stringify({ price: val }) });
    state.price = val;
    alert("Сохранено");
    renderTable();
  } catch {
    alert("Изменять стоимость может только администратор");
  }
};

// скрытый эндпоинт для цены
// (Примечание: вызывается из фронта выше)
