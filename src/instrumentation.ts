import type { Instrumentation } from "next";

/**
 * Server error logging. Writes one JSON line per error to stdout (Vercel → Logs shows and searches these).
 * Set ERROR_WEBHOOK_URL to also POST each error to an external collector (Slack/Discord/Logtail webhook, etc.).
 * Request headers are not logged (they contain session cookies).
 */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const e = err as { message?: string; digest?: string; stack?: string };
  const entry = {
    level: "error",
    at: new Date().toISOString(),
    message: e?.message ?? String(err),
    digest: e?.digest,
    method: request.method,
    path: request.path.split("?")[0],
    routePath: context.routePath,
    routeType: context.routeType,
    stack: e?.stack?.split("\n").slice(0, 6).join("\n"),
  };
  console.error(JSON.stringify(entry));
  const url = process.env.ERROR_WEBHOOK_URL;
  if (url) {
    await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: `[BoonBaby] ${entry.message} at ${entry.path}`, ...entry }) }).catch(() => {});
  }
};
