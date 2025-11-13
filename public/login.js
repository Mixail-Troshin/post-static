const nf = new Intl.NumberFormat('ru-RU');
const $ = id => document.getElementById(id);
const form = $('loginForm');
const email = $('loginEmail');
const pass = $('loginPass');
const msg = $('loginMsg');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  msg.className = 'status muted';
  msg.innerHTML = '<span class="spinner"></span> Проверяем…';
  try {
    const r = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: email.value, password: pass.value })
    });
    const data = await r.json();
    if (!r.ok || !data.ok) throw new Error(data.error || `HTTP ${r.status}`);
    msg.className = 'status ok';
    msg.textContent = 'Ок, входим…';
    location.href = '/';
  } catch (e) {
    msg.className = 'status err';
    msg.textContent = 'Ошибка: ' + (e.message || e);
  }
});
