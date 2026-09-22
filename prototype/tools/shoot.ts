/**
 * Drive the prototype in a real browser and screenshot it.
 *
 * The page had never been rendered — every prior check was structural. This
 * launches headless Edge over CDP, clicks through each scenario, presses
 * "Ask Jev", waits for the live answers to land, and captures the full page
 * including stages 5 and 6.
 *
 *   deno run -A tools/shoot.ts [--out DIR] [--browser PATH] [--keep]
 *
 * Requires the dev server to already be listening on :8787.
 */

const OUT = flag("--out") ?? "shots";
const BROWSER = flag("--browser") ??
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = flag("--base") ?? "http://localhost:8787/";
const PORT = 9333;

function flag(name: string): string | undefined {
  const i = Deno.args.indexOf(name);
  return i >= 0 ? Deno.args[i + 1] : undefined;
}

// --- minimal CDP client -----------------------------------------------------

class CDP {
  #ws: WebSocket;
  #id = 0;
  #pending = new Map<number, (v: Record<string, unknown>) => void>();

  private constructor(ws: WebSocket) {
    this.#ws = ws;
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.#pending.has(msg.id)) {
        this.#pending.get(msg.id)!(msg.result ?? {});
        this.#pending.delete(msg.id);
      }
    };
  }

  static async connect(url: string): Promise<CDP> {
    const ws = new WebSocket(url);
    await new Promise<void>((res, rej) => {
      ws.onopen = () => res();
      ws.onerror = () => rej(new Error(`CDP connect failed: ${url}`));
    });
    return new CDP(ws);
  }

  send(method: string, params: Record<string, unknown> = {}) {
    const id = ++this.#id;
    this.#ws.send(JSON.stringify({ id, method, params }));
    return new Promise<Record<string, unknown>>((res) => this.#pending.set(id, res));
  }

  /** Evaluate an expression in the page and return its JSON value. */
  async eval<T = unknown>(expression: string): Promise<T> {
    const r = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    }) as { result?: { value?: T } };
    return r.result?.value as T;
  }

  close() {
    this.#ws.close();
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Poll an in-page predicate until it is true. */
async function until(
  cdp: CDP,
  expression: string,
  label: string,
  timeoutMs = 60_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await cdp.eval<boolean>(expression)) return true;
    await sleep(250);
  }
  console.warn(`  ! timed out waiting for ${label}`);
  return false;
}

// --- main -------------------------------------------------------------------

await Deno.mkdir(OUT, { recursive: true });
const profile = await Deno.makeTempDir({ prefix: "jev-shoot-" });

const browser = new Deno.Command(BROWSER, {
  args: [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--no-first-run",
    "--no-default-browser-check",
    "--hide-scrollbars",
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${PORT}`,
    "--window-size=1400,1200",
    "about:blank",
  ],
  stdout: "null",
  stderr: "null",
}).spawn();

// Wait for the debugging endpoint to answer.
let wsUrl = "";
for (let i = 0; i < 60 && !wsUrl; i++) {
  await sleep(300);
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const page = list.find((t: { type: string }) => t.type === "page");
    if (page) wsUrl = page.webSocketDebuggerUrl;
  } catch { /* not up yet */ }
}
if (!wsUrl) {
  browser.kill();
  throw new Error("Edge never exposed a CDP endpoint");
}

const cdp = await CDP.connect(wsUrl);
await cdp.send("Page.enable");
await cdp.send("Runtime.enable");
await cdp.send("Emulation.setDeviceMetricsOverride", {
  width: 1400,
  height: 1200,
  deviceScaleFactor: 1,
  mobile: false,
});

async function shoot(name: string) {
  const m = await cdp.send("Page.getLayoutMetrics") as {
    cssContentSize?: { width: number; height: number };
  };
  const size = m.cssContentSize ?? { width: 1400, height: 1200 };
  const r = await cdp.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
    clip: {
      x: 0,
      y: 0,
      width: Math.ceil(size.width),
      height: Math.ceil(size.height),
      scale: 1,
    },
  }) as { data: string };
  const bytes = Uint8Array.from(atob(r.data), (c) => c.charCodeAt(0));
  const path = `${OUT}/${name}.png`;
  await Deno.writeFile(path, bytes);
  console.log(`  ${path}  ${(bytes.length / 1024).toFixed(0)} KB  ` +
    `${Math.ceil(size.width)}x${Math.ceil(size.height)}`);
}

console.log(`\nDriving ${BASE}\n`);

await cdp.send("Page.navigate", { url: BASE });
await until(cdp, `!!document.querySelector('#ask')`, "page shell");
// The bundle is compiled on demand, so the first load can be slow.
await until(
  cdp,
  `document.querySelectorAll('#scenarios .scn').length === 4`,
  "scenario buttons (bundle compiled)",
);
console.log("  bundle loaded, 4 scenarios rendered");

const scenarios = await cdp.eval<string[]>(
  `Array.from(document.querySelectorAll('#scenarios .scn')).map(b => b.textContent.trim())`,
);

for (let i = 0; i < scenarios.length; i++) {
  const label = scenarios[i].toLowerCase().split(/[\s—]/)[0].replace(/\W/g, "");
  console.log(`\n${scenarios[i]}`);

  await cdp.eval(`document.querySelectorAll('#scenarios .scn')[${i}].click()`);
  await sleep(400);

  const changes = await cdp.eval<string>(
    `document.querySelector('#diff-count')?.textContent ?? '?'`,
  );
  console.log(`  diff: ${changes}`);

  await cdp.eval(`document.querySelector('#ask').click()`);
  // Answers land when the readings strip renders.
  const ok = await until(
    cdp,
    `!!document.querySelector('#answers .readings')`,
    "live answers",
  );
  const status = await cdp.eval<string>(
    `document.querySelector('#call-status')?.textContent ?? ''`,
  );
  console.log(`  call-status: ${status.trim()}${ok ? "" : "  (TIMED OUT)"}`);

  // Expand the payload disclosure so the screenshot shows it.
  await cdp.eval(
    `document.querySelectorAll('details').forEach(d => d.open = true)`,
  );
  await sleep(300);

  await shoot(`${i + 1}-${label}`);

  // Report anything the page itself considers an error.
  const errs = await cdp.eval<string[]>(
    `Array.from(document.querySelectorAll('.error, .flag')).map(e => e.textContent.trim())`,
  );
  for (const e of errs) console.log(`  · ${e.slice(0, 120)}`);
}

cdp.close();
browser.kill();
await browser.status;
if (!Deno.args.includes("--keep")) {
  await Deno.remove(profile, { recursive: true }).catch(() => {});
}
console.log(`\nDone — ${scenarios.length} screenshots in ${OUT}/\n`);
