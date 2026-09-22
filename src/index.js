const TOP_N = 50;
const MAX_SCORE = 50_000_000;
const NAME_RE = /^[\u4e00-\u9fffA-Za-z0-9_\-]{1,8}$/;

function cors(extra = {}) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    ...extra,
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: cors({ "Content-Type": "application/json; charset=utf-8" }),
  });
}

/** YYYY-MM-DD + weekday short in Asia/Shanghai */
function cnNow(d = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  // en-US: month/day/year
  const year = +parts.year;
  const month = +parts.month;
  const day = +parts.day;
  const weekday = parts.weekday; // Mon, Tue, ...
  return { year, month, day, weekday, iso: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` };
}

function monthKey(d = new Date()) {
  const p = cnNow(d);
  return `month:${p.year}-${String(p.month).padStart(2, "0")}`;
}

/** Week key: Monday-start week in Shanghai. Format week:YYYY-MM-DD (that Monday). */
function weekKey(d = new Date()) {
  const p = cnNow(d);
  const map = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  const off = map[p.weekday] ?? 0;
  // Construct a UTC date at Shanghai calendar day, then subtract offset
  const utc = Date.UTC(p.year, p.month - 1, p.day) - off * 86400000;
  const md = new Date(utc);
  const y = md.getUTCFullYear();
  const m = String(md.getUTCMonth() + 1).padStart(2, "0");
  const day = String(md.getUTCDate()).padStart(2, "0");
  return `week:${y}-${m}-${day}`;
}

function periodMeta() {
  const p = cnNow();
  return {
    now: p.iso,
    timezone: "Asia/Shanghai",
    weekKey: weekKey(),
    monthKey: monthKey(),
    note: "周榜每周一（北京时间）换新；月榜每月1日换新",
  };
}

async function readBoard(env, key) {
  const raw = await env.RANKS.get(key);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

async function writeBoard(env, key, list) {
  await env.RANKS.put(key, JSON.stringify(list.slice(0, TOP_N)));
}

function clientIp(request) {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "0.0.0.0"
  );
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS" && url.pathname.startsWith("/api/")) {
      return new Response(null, { status: 204, headers: cors() });
    }

    if (url.pathname === "/api/ranks" && request.method === "GET") {
      const period = url.searchParams.get("period") === "month" ? "month" : "week";
      const key = period === "month" ? monthKey() : weekKey();
      const list = await readBoard(env, key);
      return json({ ok: true, period, key, meta: periodMeta(), list });
    }

    if (url.pathname === "/api/ranks" && request.method === "POST") {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ ok: false, error: "bad_json" }, 400);
      }
      const name = String(body.name || "").trim();
      const score = Math.floor(Number(body.score));
      const stage = Math.max(1, Math.min(15, Math.floor(Number(body.stage) || 1)));
      const cycle = Math.max(1, Math.min(999, Math.floor(Number(body.cycle) || 1)));
      const ship = String(body.ship || "").slice(0, 16);

      if (!NAME_RE.test(name)) return json({ ok: false, error: "bad_name" }, 400);
      if (!Number.isFinite(score) || score < 1 || score > MAX_SCORE) {
        return json({ ok: false, error: "bad_score" }, 400);
      }

      const ip = clientIp(request);
      const rlKey = `rl:${ip}`;
      const last = await env.RANKS.get(rlKey);
      if (last && Date.now() - Number(last) < 15000) {
        return json({ ok: false, error: "too_fast" }, 429);
      }
      await env.RANKS.put(rlKey, String(Date.now()), { expirationTtl: 60 });

      const entry = { name, score, stage, cycle, ship, at: new Date().toISOString() };
      const results = {};
      for (const [period, key] of [
        ["week", weekKey()],
        ["month", monthKey()],
      ]) {
        const list = await readBoard(env, key);
        const filtered = list.filter((e) => e.name !== name);
        filtered.push(entry);
        filtered.sort((a, b) => b.score - a.score || String(a.at).localeCompare(String(b.at)));
        const trimmed = filtered.slice(0, TOP_N);
        await writeBoard(env, key, trimmed);
        const rank = trimmed.findIndex((e) => e.name === name && e.score === score) + 1;
        results[period] = { key, rank: rank || null, list: trimmed.slice(0, 20) };
      }
      return json({ ok: true, results, meta: periodMeta() });
    }

    return env.ASSETS.fetch(request);
  },
};
