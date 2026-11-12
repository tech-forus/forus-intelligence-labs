// Netlify Function: everything under /api/careers/*.
// Logic lives in lib/careers/handlers.mjs; this file only wires in Netlify Blobs.
import { getStore } from "@netlify/blobs";
import { handle } from "../../lib/careers/handlers.mjs";

export default async (req, context) =>
  handle(req, {
    store: getStore({ name: "careers", consistency: "strong" }),
    ip: context.ip,
  });

export const config = { path: "/api/careers/*" };
