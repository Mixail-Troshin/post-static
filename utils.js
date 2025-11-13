export function extractVcIdFromUrl(url) {
  try {
    const u = new URL(url.trim());
    const seg = u.pathname.split('/').filter(Boolean).pop() || '';
    // берём ведущие цифры последнего сегмента
    const m = seg.match(/^(\d+)/);
    if (m) return parseInt(m[1], 10);
    // запасной вариант: ищем самое длинное число в пути
    const allNums = u.pathname.match(/\d+/g);
    if (allNums && allNums.length) return parseInt(allNums[allNums.length - 1], 10);
  } catch {}
  return null;
}

export function toInt(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}
