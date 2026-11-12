// Cloudflare Worker: serves the static site from public/ (via the assets binding) and
// handles /api/careers/* itself. Static files are matched first; anything that is not
// a file (i.e. the API) reaches this fetch handler.
import { handle } from "../lib/careers/handlers.mjs";
import { kvStore } from "../lib/careers/kv-store.mjs";

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith("/api/careers/")) {
      return handle(request, {
        store: kvStore(env.CAREERS),
        ip: request.headers.get("cf-connecting-ip") || "",
      });
    }
    return env.ASSETS.fetch(request);
  },
};
