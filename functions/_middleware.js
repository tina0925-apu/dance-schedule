// 每位訪客自動拿到一個長效的「裝置 ID」cookie，用來記住他建立過哪些場次（不用登入）。

const COOKIE = "device_id";
const ONE_YEAR = 60 * 60 * 24 * 365;

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

export async function onRequest(context) {
  let deviceId = readCookie(context.request, COOKIE);
  const isNew = !deviceId || !/^[A-Za-z0-9_-]{16,64}$/.test(deviceId);
  if (isNew) deviceId = newId();
  context.data.deviceId = deviceId;

  const response = await context.next();
  // 每次都續期一年，跟原本 Flask 的 permanent session 一樣
  const res = new Response(response.body, response);
  res.headers.append(
    "Set-Cookie",
    `${COOKIE}=${deviceId}; Max-Age=${ONE_YEAR}; Path=/; HttpOnly; Secure; SameSite=Lax`
  );
  return res;
}
