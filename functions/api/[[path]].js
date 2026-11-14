export async function onRequest({ request, env }) {
  const origin = String(env.MIGOLIVE_API_ORIGIN || "").replace(/\/$/, "");
  if (!origin) {
    return new Response(JSON.stringify({
      ok: false,
      message: "لم يتم ضبط عنوان خادم MigoLive في إعدادات Cloudflare"
    }), {
      status: 503,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
    });
  }

  const incoming = new URL(request.url);
  const target = new URL(origin + incoming.pathname + incoming.search);
  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("origin");
  headers.delete("referer");
  headers.set("x-forwarded-host", incoming.host);

  const upstream = new Request(target.toString(), {
    method: request.method,
    headers,
    body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
    redirect: "manual"
  });
  const response = await fetch(upstream);
  const outgoingHeaders = new Headers(response.headers);
  outgoingHeaders.set("cache-control", "no-store");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: outgoingHeaders
  });
}
