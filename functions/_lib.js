// 共用的小工具

export const SETUP_FIELDS = ["eventName", "dates", "people", "startDate", "endDate", "excludedDates"];

export function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

// 讀出一個場次的完整資料（格式與原本 Flask 版相同，前端不用改）
export async function loadSession(db, code) {
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
