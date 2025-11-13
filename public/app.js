// public/app.js
document.addEventListener('DOMContentLoaded', () => {
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));

  const money = n => (Number(n || 0)).toLocaleString("ru-RU");
  const fmt = ts => ts ? new Date((String(ts).length > 10 ? ts : ts * 1000)).toLocaleString() : "—";
  const cpm = (price, metric) => !metric ? 0 : Math.round((Number(price || 0) / (metric / 1000)));

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

  function showToast(msg) {
    const t = $("#toast");
    t.textContent = msg; t.classList.remove("hidden");
    setTimeout(() => t.classList.add("hidden"), 2500);
  }

  function setTab(name) {
    $$(".tab").forEach(b => b.classList.toggle("active", b.dataset.tab === name));
    $("#tab-monitor").classList.toggle("hidden", name !== "monitor");
    $("#tab-settings").classList.toggle("hidden", name !== "settings");
  }
  $$(".tab").forEach(b => b.onclick = () => setTab(b.dataset.tab));

  async function guard() {
    try {
      const { user } = await api("/api/me");
      $("#login").classList.add("hidden");
      $("#app").classList.remove("hidden");
      $("#tabSettings").style.display = user.isAdmin ? "inline-block" : "none";
      await loadData();
    } catch {
      $("#login").classList.remove("hidden");
      $("#app").classList.add("hidden");
    }
  }

  // ---- login/logout ----
  const loginForm = $("#loginForm");
  if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
      e.preventDefault(); // не даём странице перезагружаться
      $("#loginErr").textContent = "";
      const email = $("#email").value.trim();
      const password = $("#password").value;

      if (!email || !password) {
        $("#loginErr").textContent = "Введите e-mail и пароль";
        return;
      }

      const btn = $("#loginBtn");
      btn.disabled = true; btn.textContent = "Входим…";
      try {
        await api("/api/login", {
          method: "POST",
          body: JSON.stringify({ email, password })
        });
        await guard();
      } catch (e2) {
        $("#loginErr").textContent = e2.message;
      } finally {
        btn.disabled = false; btn.textContent = "Войти";
      }
    });
  }

  const logoutBtn = $("#logout");
  if (logoutBtn) {
    logoutBtn.onclick = async () => {
      await api("/api/logout", { method: "POST" });
      $("#app").classList.add("hidden");
      $("#login").classList.remove("hidden");
    };
  }

  // ---- data ----
  const state = { items: [], price: 0 };

  async function loadData() {
    const { items, placementPrice } = await api("/api/articles");
    state.items = items;
    state.price = placementPrice || 0;
    $("#price").value = state.price;
    renderTable();
  }

  function renderTable() {
    const tb = $("#table tbody"); if (!tb) return;
    tb.innerHTML = "";
    for (const it of state.items) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${fmt(it.date)}</td>
        <td><a href="${it.url}" target="_blank">${it.title || it.url}</a></td>
        <td>${money(it.counters?.hits)}</td>
        <td>${money(it.counters?.views)}</td>
        <td>${money(cpm(state.price, it.counters?.hits))}</td>
        <td>${money(cpm(state.price, it.counters?.views))}</td>
        <td>${fmt(it.lastUpdated)}</td>
        <td class="actions">
          <button class="ghost" data-act="refresh" data-id="${it.id}">Обновить</button>
          <button class="danger" data-act="remove" data-id="${it.id}">Удалить</button>
        </td>`;
      tb.appendChild(tr);
    }
  }

  const table = $("#table");
  if (table) {
    table.addEventListener("click", async (e) => {
      const btn = e.target.closest("button"); if (!btn) return;
      const id = btn.dataset.id;

      if (btn.dataset.act === "refresh") {
        btn.disabled = true; btn.textContent = "…";
        try {
          const { item } = await api(`/api/articles/${id}/refresh`, { method: "PATCH" });
          const i = state.items.findIndex(x => String(x.id) === String(id));
          state.items[i] = item; renderTable(); showToast("Обновлено");
        } finally {
          btn.disabled = false; btn.textContent = "Обновить";
        }
      }

      if (btn.dataset.act === "remove") {
        if (!confirm("Удалить статью из списка?")) return;
        await api(`/api/articles/${id}`, { method: "DELETE" });
        state.items = state.items.filter(x => String(x.id) !== String(id));
        renderTable(); showToast("Удалено");
      }
    });
  }

  const addBtn = $("#addBtn");
  if (addBtn) {
    addBtn.onclick = async () => {
      const url = $("#urlInput").value.trim(); if (!url) return;
      $("#addMsg").textContent = "Добавляю…";
      try {
        await api("/api/articles", { method: "POST", body: JSON.stringify({ url }) });
        $("#urlInput").value = ""; await loadData(); $("#addMsg").textContent = "Готово";
      } catch (e) {
        $("#addMsg").textContent = "Ошибка: " + e.message;
      }
    };
  }

  const refreshAll = $("#refreshAll");
  if (refreshAll) {
    refreshAll.onclick = async () => {
      refreshAll.disabled = true; refreshAll.textContent = "Обновляю…";
      try { await api("/api/refresh-all", { method: "POST" }); await loadData(); }
      finally { refreshAll.disabled = false; refreshAll.textContent = "Обновить всё"; }
    };
  }

  const savePrice = $("#savePrice");
  if (savePrice) {
    savePrice.onclick = async () => {
      try {
        const val = Number($("#price").value || 0);
        await api("/api/admin/set-price", { method: "POST", body: JSON.stringify({ price: val }) });
        state.price = val; renderTable();
        $("#priceMsg").textContent = "Сохранено";
        setTimeout(() => $("#priceMsg").textContent = "", 1500);
      } catch (e) {
        $("#priceMsg").textContent = "Нужны права администратора";
      }
    };
  }

  // старт
  guard();
});
