// Cloudflare Pages Function: everything under /api/careers/*.
// Logic lives in lib/careers/handlers.mjs; this only wires in the KV namespace bound as CAREERS.
import { handle } from "../../../lib/careers/handlers.mjs";
import { kvStore } from "../../../lib/careers/kv-store.mjs";

export const onRequest = ({ request, env }) =>
  handle(request, {
    store: kvStore(env.CAREERS),
    ip: request.headers.get("cf-connecting-ip") || "",
  });
