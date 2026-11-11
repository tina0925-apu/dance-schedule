// 練習時間安排：Cloudflare Worker 後端
// 網頁檔案（public/）由 Cloudflare 直接提供；/api/... 的請求才會進到這裡。

const SETUP_FIELDS = ["eventName", "dates", "people", "startDate", "endDate", "excludedDates"];
const COOKIE = "device_id";
const ONE_YEAR = 60 * 60 * 24 * 365;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

// ---------- 裝置 ID（不用登入，記住你建立過哪些場次） ----------
function readCookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

function newId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ---------- 資料庫 ----------
async function loadSession(db, code) {
  const row = await db.prepare("SELECT setup FROM sessions WHERE code = ?").bind(code).first();
  if (!row) return null;
  const data = JSON.parse(row.setup);
  data.responses = {};
  data.sidecam = {};
  const { results } = await db
    .prepare("SELECT person, responses, sidecam FROM responses WHERE code = ?")
    .bind(code)
    .all();
  for (const r of results) {
    data.responses[r.person] = JSON.parse(r.responses);
    data.sidecam[r.person] = r.sidecam;
  }
  return data;
}

// GET /api/my-sessions：列出這台裝置建立過的場次
async function mySessions(db, deviceId) {
  const { results } = await db
    .prepare("SELECT code, setup FROM sessions WHERE owner_device = ? ORDER BY created_at DESC, rowid DESC")
    .bind(deviceId)
    .all();
  return json(
    results.map((r) => {
      let eventName = r.code;
      try {
        eventName = JSON.parse(r.setup).eventName || r.code;
      } catch {}
      return { code: r.code, eventName };
    })
  );
}

// GET /api/session/:code
async function getSession(db, code) {
  const data = await loadSession(db, code);
  if (!data) return json({ error: "not_found" }, 404);
  return json(data);
}

// POST /api/session/:code
// 建立場次，或只更新「設定」欄位（名稱/日期/成員）。別人已填好的回覆不會被覆蓋。
async function saveSession(db, code, request, deviceId) {
  const payload = await readJson(request);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return json({ error: "invalid_json" }, 400);
  }
  const row = await db.prepare("SELECT setup FROM sessions WHERE code = ?").bind(code).first();

  if (!row) {
    const { responses = {}, sidecam = {}, ...setup } = payload;
    const people = Array.isArray(setup.people) ? setup.people : [];
    const stmts = [
      db
        .prepare("INSERT INTO sessions (code, setup, owner_device) VALUES (?, ?, ?) ON CONFLICT(code) DO NOTHING")
        .bind(code, JSON.stringify(setup), deviceId),
    ];
    for (const p of people) {
      if (responses[p] === undefined && sidecam[p] === undefined) continue;
      stmts.push(
        db
          .prepare("INSERT OR REPLACE INTO responses (code, person, responses, sidecam) VALUES (?, ?, ?, ?)")
          .bind(code, p, JSON.stringify(responses[p] || {}), String(sidecam[p] || ""))
      );
    }
    await db.batch(stmts);
  } else {
    const setup = JSON.parse(row.setup);
    for (const f of SETUP_FIELDS) if (f in payload) setup[f] = payload[f];
    const people = Array.isArray(setup.people) ? setup.people : [];
    // 一次執行（原子操作）：更新設定，並刪掉已經被移出名單的人的回覆
    await db.batch([
      db.prepare("UPDATE sessions SET setup = ? WHERE code = ?").bind(JSON.stringify(setup), code),
      db
        .prepare("DELETE FROM responses WHERE code = ? AND person NOT IN (SELECT value FROM json_each(?))")
        .bind(code, JSON.stringify(people)),
    ]);
  }
  return json(await loadSession(db, code));
}

// POST /api/session/:code/response
// 只存「一個人」的回覆，所以很多人同時填也不會互相蓋掉。
async function saveResponse(db, code, request) {
  const payload = (await readJson(request)) || {};
  const person = payload.person;
  if (!person || typeof person !== "string") return json({ error: "missing_person" }, 400);

  const exists = await db.prepare("SELECT 1 FROM sessions WHERE code = ?").bind(code).first();
  if (!exists) return json({ error: "not_found" }, 404);

  // 只有當這個人在成員名單裡才寫入（檢查和寫入在同一個指令內完成）
  const result = await db
    .prepare(
      `INSERT INTO responses (code, person, responses, sidecam, updated_at)
       SELECT ?1, ?2, ?3, ?4, unixepoch()
       WHERE EXISTS (
         SELECT 1 FROM sessions, json_each(sessions.setup, '$.people')
         WHERE sessions.code = ?1 AND json_each.value = ?2
       )
       ON CONFLICT(code, person) DO UPDATE SET
         responses = excluded.responses,
         sidecam = excluded.sidecam,
         updated_at = excluded.updated_at`
    )
    .bind(code, person, JSON.stringify(payload.responses || {}), String(payload.sidecam || ""))
    .run();

  if (!result.meta.changes) return json({ error: "unknown_person" }, 400);
  return json(await loadSession(db, code));
}

// ---------- 路由 ----------
async function route(request, env, deviceId) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  const db = env.DB;

  if (path === "/api/my-sessions" && method === "GET") return mySessions(db, deviceId);

  let m = path.match(/^\/api\/session\/([^/]+)\/response\/?$/);
  if (m && method === "POST") return saveResponse(db, decodeURIComponent(m[1]), request);

  m = path.match(/^\/api\/session\/([^/]+)\/?$/);
  if (m && method === "GET") return getSession(db, decodeURIComponent(m[1]));
  if (m && method === "POST") return saveSession(db, decodeURIComponent(m[1]), request, deviceId);

  if (path.startsWith("/api/")) return json({ error: "not_found" }, 404);
  // 其他路徑交給靜態網頁
  return env.ASSETS.fetch(request);
}

export default {
  async fetch(request, env) {
    let deviceId = readCookie(request, COOKIE);
    if (!deviceId || !/^[A-Za-z0-9_-]{16,64}$/.test(deviceId)) deviceId = newId();

    let response;
    try {
      response = await route(request, env, deviceId);
    } catch (err) {
      console.error(err);
      response = json({ error: "server_error" }, 500);
    }
    // 每次都續期一年
    const res = new Response(response.body, response);
    res.headers.append(
      "Set-Cookie",
      `${COOKIE}=${deviceId}; Max-Age=${ONE_YEAR}; Path=/; HttpOnly; Secure; SameSite=Lax`
    );
    return res;
  },
};
