// Cloudflare KV adapter with the store interface handlers.mjs expects.
// KV is eventually consistent across locations: a new application can take up to
// ~60 s to show in another region's list. Values up to 25 MB, metadata up to 1 KB.

export function kvStore(kv) {
  return {
    async set(key, bytes, opts = {}) {
      await kv.put(key, bytes, { metadata: opts.metadata || {} });
    },
    async setJSON(key, value, opts = {}) {
      await kv.put(key, JSON.stringify(value), opts.ttl ? { expirationTtl: Math.max(60, opts.ttl) } : {});
    },
    async get(key, opts = {}) {
      return kv.get(key, opts.type === "json" ? "json" : opts.type === "arrayBuffer" ? "arrayBuffer" : "text");
    },
    async getWithMetadata(key, opts = {}) {
      const r = await kv.getWithMetadata(key, opts.type === "arrayBuffer" ? "arrayBuffer" : "text");
      return r && r.value !== null ? { data: r.value, metadata: r.metadata || {} } : null;
    },
    async delete(key) {
      await kv.delete(key);
    },
    async list({ prefix = "" } = {}) {
      const blobs = [];
      let cursor;
      do {
        const page = await kv.list({ prefix, cursor });
        for (const k of page.keys) blobs.push({ key: k.name });
        cursor = page.list_complete ? undefined : page.cursor;
      } while (cursor);
      return { blobs };
    },
  };
}
