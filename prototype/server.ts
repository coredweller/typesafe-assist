/**
 * Local dev server for the Jev diff prototype.
 *
 * Three jobs:
 *   1. Serve index.html and static assets.
 *   2. Bundle src/main.ts to browser ESM on request (browsers can't run TS).
 *   3. Proxy POST /api/systemone to the real TypeSafe API, attaching the
 *      Authorization header server-side so the key never reaches the browser.
 *
 * Run:  deno task dev
 */

import { contentType } from "jsr:@std/media-types@1";
import { extname, join, normalize } from "jsr:@std/path@1";

const ROOT = import.meta.dirname!;
const PORT = Number(Deno.env.get("PORT") ?? 8787);
const UPSTREAM = Deno.env.get("TYPESAFE_BASE_URL") ?? "https://api.typesafe.ai";
const API_KEY = Deno.env.get("TYPESAFE_API_KEY")?.trim();

// ---------------------------------------------------------------------------
// TypeScript -> browser ESM, via Deno's built-in bundler
// ---------------------------------------------------------------------------

async function bundle(entry: string): Promise<Response> {
  const cmd = new Deno.Command(Deno.execPath(), {
    args: ["bundle", "--platform", "browser", "--format", "esm", entry],
    cwd: ROOT,
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout, stderr } = await cmd.output();
  const err = new TextDecoder().decode(stderr);

  if (code !== 0) {
    console.error(`\nBundle failed:\n${err}`);
    // Surface the failure in the browser console rather than a blank page.
    const msg = JSON.stringify(`Bundle failed:\n${err}`);
    return new Response(
      `console.error(${msg});\ndocument.body.textContent = ${msg};`,
      { headers: { "content-type": "text/javascript; charset=utf-8" } },
    );
  }
  if (err.trim()) console.warn(err);

  return new Response(stdout, {
    headers: {
      "content-type": "text/javascript; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

// ---------------------------------------------------------------------------
// Proxy
// ---------------------------------------------------------------------------

async function proxy(req: Request): Promise<Response> {
  if (!API_KEY) {
    return Response.json(
      {
        error: "TYPESAFE_API_KEY is not set.",
        hint:
          "Create prototype/.env with TYPESAFE_API_KEY=sk-... and restart `deno task dev`.",
      },
      { status: 500 },
    );
  }

  const body = await req.text();
  const started = performance.now();

  let upstream: Response;
  try {
    upstream = await fetch(`${UPSTREAM}/v1/systemone`, {
      method: "POST",
      headers: {
        // Same shape as TypeSafeClient._headers in api.py.
        "Authorization": `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body,
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`Upstream error: ${message}`);
    return Response.json({ error: `Could not reach TypeSafe: ${message}` }, {
      status: 502,
    });
  }

  const elapsed = Math.round(performance.now() - started);
  const text = await upstream.text();
  console.log(
    `  POST /v1/systemone -> ${upstream.status} in ${elapsed}ms ` +
      `(${body.length} bytes up, ${text.length} down)`,
  );

  return new Response(text, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "application/json",
      "x-upstream-ms": String(elapsed),
    },
  });
}

// ---------------------------------------------------------------------------
// Static
// ---------------------------------------------------------------------------

async function serveStatic(pathname: string): Promise<Response> {
  const rel = normalize(pathname).replace(/^[/\\]+/, "");
  const path = join(ROOT, rel);

  // Refuse anything that escapes the prototype directory.
  if (!path.startsWith(ROOT)) return new Response("Forbidden", { status: 403 });

  try {
    const file = await Deno.readFile(path);
    return new Response(file, {
      headers: {
        "content-type": contentType(extname(path)) ?? "application/octet-stream",
        "cache-control": "no-store",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

// ---------------------------------------------------------------------------

Deno.serve({ port: PORT, onListen: ({ port }) => {
  console.log(`\n  Jev diff prototype  →  http://localhost:${port}`);
  console.log(
    API_KEY
      ? `  API key loaded (${API_KEY.slice(0, 6)}…), proxying to ${UPSTREAM}`
      : `  ⚠  No TYPESAFE_API_KEY — create prototype/.env before calling Jev.`,
  );
  console.log("");
} }, async (req) => {
  const url = new URL(req.url);

  if (url.pathname === "/api/systemone" && req.method === "POST") {
    return await proxy(req);
  }
  if (url.pathname === "/app.js") {
    return await bundle("src/main.ts");
  }
  if (url.pathname === "/" || url.pathname === "/index.html") {
    return await serveStatic("index.html");
  }
  return await serveStatic(url.pathname);
});
