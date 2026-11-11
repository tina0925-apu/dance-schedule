import { json, readJson, loadSession, SETUP_FIELDS } from "../../../_lib.js";

// GET /api/session/:code
export async function onRequestGet({ env, params }) {
  const data = await loadSession(env.DB, params.code);
  if (!data) return json({ error: "not_found" }, 404);
  return json(data);
}

// POST /api/session/:code
// 建立場次，或只更新「設定」欄位（名稱/日期/成員）。別人已填好的回覆不會被覆蓋。
export async function onRequestPost({ env, params, request, data: ctx }) {
  const code = params.code;
  const payload = await readJson(request);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return json({ error: "invalid_json" }, 400);
  }
  const db = env.DB;
  const row = await db.prepare("SELECT setup FROM sessions WHERE code = ?").bind(code).first();

  if (!row) {
    const { responses = {}, sidecam = {}, ...setup } = payload;
    const people = Array.isArray(setup.people) ? setup.people : [];
    const stmts = [
      db
        .prepare("INSERT INTO sessions (code, setup, owner_device) VALUES (?, ?, ?) ON CONFLICT(code) DO NOTHING")
        .bind(code, JSON.stringify(setup), ctx.deviceId),
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
