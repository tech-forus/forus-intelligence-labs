// Cloudflare Worker for forusintelligencelabs.com. Runs before static assets
// (run_worker_first in wrangler.toml) so it can redirect http -> https and www -> apex,
// answers /api/careers/* itself, and hands everything else to the public/ assets.
import { handle, processQueue } from "../lib/careers/handlers.mjs";
import { kvStore } from "../lib/careers/kv-store.mjs";

const APEX = "forusintelligencelabs.com";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname === `www.${APEX}` || (url.hostname === APEX && url.protocol === "http:")) {
      url.hostname = APEX;
      url.protocol = "https:";
      return Response.redirect(url.toString(), 301);
    }
    if (url.hostname === `careers.${APEX}` && url.protocol === "http:") {
      url.protocol = "https:";
      return Response.redirect(url.toString(), 301);
    }
    if (url.pathname.startsWith("/api/careers/")) {
      return handle(request, {
        store: kvStore(env.CAREERS),
        ip: request.headers.get("cf-connecting-ip") || "",
        env,
      });
    }
    // careers lives at careers.<apex>; the old /careers path redirects there
    if (url.hostname === APEX && /^\/careers\/?$/.test(url.pathname)) {
      return Response.redirect(`https://careers.${APEX}/${url.search}`, 301);
    }
    if (url.hostname === `careers.${APEX}`) {
      if (url.pathname === "/" || url.pathname === "/index.html") {
        url.pathname = "/careers/";
        return env.ASSETS.fetch(new Request(url, request));
      }
      if (/^\/careers\/?$/.test(url.pathname)) return Response.redirect(`https://careers.${APEX}/${url.search}`, 301);
    }
    return env.ASSETS.fetch(request);
  },

  // hourly: send due "kept on file" / closing emails and carry out due discards
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(processQueue(kvStore(env.CAREERS), env).then((r) => console.log("[careers] queue", JSON.stringify(r))));
  },
};
