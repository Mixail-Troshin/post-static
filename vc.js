// используем публичный endpoint: counters доступны без JWT/cookies
// основной: v2.10/content?id=...&markdown=false
// запасной: v2.1/content?id=...

async function fetchJson(url) {
  const r = await fetch(url, { headers: { 'accept': 'application/json' } });
  if (!r.ok) throw new Error(`VC API ${r.status}`);
  return r.json();
}

export async function getContentById(vcId) {
  // пробуем v2.10
  try {
    const j = await fetchJson(`https://api.vc.ru/v2.10/content?id=${vcId}&markdown=false`);
    return normalize(j);
  } catch {
    const j = await fetchJson(`https://api.vc.ru/v2.1/content?id=${vcId}&markdown=false`);
    return normalize(j);
  }
}

function normalize(j) {
  const r = j?.result || {};
  const counters = r.counters || {};
  const views = Number.isFinite(counters.views) ? counters.views : null;
  const hits = Number.isFinite(counters.hits) ? counters.hits : (Number.isFinite(r.hitsCount) ? r.hitsCount : null);
  return {
    vc_id: r.id ?? null,
    title: r.title ?? '',
    pub_date_sec: r.date ?? null,
    url: r.url ?? '',
    views,
    hits
  };
}
