# 🩰 練習時間安排

部署在 **Cloudflare Pages**，資料存在 **Cloudflare D1**（雲端 SQLite），伺服器重啟或重新部署都不會遺失資料，也不會休眠。

## 檔案結構

```
public/index.html                       前端頁面
functions/_middleware.js                自動發「裝置 ID」cookie（記住你建立過的場次）
functions/_lib.js                       共用工具
functions/api/my-sessions.js            GET  /api/my-sessions
functions/api/session/[code]/index.js   GET/POST /api/session/:code
functions/api/session/[code]/response.js POST /api/session/:code/response
schema.sql                              資料表
wrangler.toml                           Cloudflare 設定
```

## 第一次部署（全部在 Cloudflare 網站上操作）

1. **建立資料庫**
   Cloudflare 後台 → **Storage & Databases → D1 SQL Database → Create**，名稱填 `dance-schedule`。
2. **建立資料表**
   打開剛建好的資料庫 → **Console**，把 `schema.sql` 的內容整段貼上，按 **Execute**。
3. **填入資料庫 ID**
   在資料庫頁面複製 **Database ID**，貼到 `wrangler.toml` 的 `database_id = "..."`，然後 commit 到 GitHub。
4. **建立 Pages 專案**
   **Workers & Pages → Create → Pages → Connect to Git**，選 `dance-schedule` 這個 repo：
   - Framework preset：`None`
   - Build command：留空
   - Build output directory：`public`
5. 按 **Save and Deploy**，完成後會拿到 `https://dance-schedule.pages.dev` 這類網址。

之後只要 push 到 GitHub，Cloudflare 就會自動重新部署，資料不受影響。

## 本機測試（選用）

```bash
npx wrangler d1 execute dance-schedule --local --file=schema.sql
npx wrangler pages dev
```
