-- 練習時間安排：Cloudflare D1 資料表
-- 每個場次一筆（設定：名稱、日期、成員…）
CREATE TABLE IF NOT EXISTS sessions (
  code         TEXT PRIMARY KEY,
  setup        TEXT NOT NULL,          -- JSON：eventName, dates, people, startDate, endDate, excludedDates
  owner_device TEXT,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_sessions_owner ON sessions(owner_device, created_at);

-- 每個人的回覆各自一筆，多人同時填寫不會互相覆蓋
CREATE TABLE IF NOT EXISTS responses (
  code       TEXT NOT NULL,
  person     TEXT NOT NULL,
  responses  TEXT NOT NULL DEFAULT '{}', -- JSON：{ "2026-11-12": "X", ... }
  sidecam    TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (code, person)
);
