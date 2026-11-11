import { json, readJson, loadSession } from "../../../_lib.js";

// POST /api/session/:code/response
// 只存「一個人」的回覆，所以很多人同時填也不會互相蓋掉。
export async function onRequestPost({ env, params, request }) {
  const code = params.code;
  const payload = (await readJson(request)) || {};
  const person = payload.person;
  if (!person || typeof person !== "string") return json({ error: "missing_person" }, 400);

  const db = env.DB;
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
