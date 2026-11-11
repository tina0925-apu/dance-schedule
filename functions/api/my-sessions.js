import { json } from "../_lib.js";

// GET /api/my-sessions：列出這台裝置建立過的場次
export async function onRequestGet({ env, data }) {
  const { results } = await env.DB
    .prepare("SELECT code, setup FROM sessions WHERE owner_device = ? ORDER BY created_at DESC, rowid DESC")
    .bind(data.deviceId)
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
