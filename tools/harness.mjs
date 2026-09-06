// ---------------------------------------------------------------------------
// Shared test harness.
//
// Nightward has no unit tests and would not benefit much from them: almost
// every bug worth catching here is a bug in what ends up on screen or in how
// the simulation evolves, and neither is visible from a function signature.
// What these tools do instead is run the real game headlessly and read numbers
// out of it — the positions the renderer is actually handed, the state after a
// known number of simulated seconds — so a claim like "the nests sit on the
// ground now" is a measurement rather than an impression.
//
// Requires: npm i -D playwright && npx playwright install chromium
// ---------------------------------------------------------------------------
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css',
               '.png':'image/png', '.json':'application/json' };

// A static server for the repo root, so a tool is one command rather than two
// terminals. Port 0 lets the OS pick, which keeps parallel runs from colliding.
export function serve(port = 0) {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
      const file = path.join(ROOT, rel || 'nightward.html');
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404).end('not found');
        return;
      }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(port, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}

// Everything below runs inside the page. It is injected after load and hangs
// off window.__nw, next to the window.__hf surface the build already exposes.
function pageHelpers() {
  const G = window.__hf.game, R = window.__hf.gl;
  const nw = window.__nw = {};

  // Grab the batch list off a real render call rather than guessing an index.
  // Decals are drawn in their own blended pass and so arrive in a separate
  // argument, but they are still instances the renderer was handed and every
  // check here wants them counted — a wrapper that dropped them would have made
  // "no ring segment is below the ground" pass by finding no ring segments.
  let LIST = null;
  const origRender = R.render.bind(R);
  R.render = function (cam, batches, flash, overlay, decals) {
    if (!LIST && batches) LIST = batches.concat(decals || []);
    return origRender(cam, batches, flash, overlay, decals);
  };

  // name -> batch, for both the plain batches and the rig bones
  function names() {
    const out = new Map();
    const B = G.batches ? G.batches() : {};
    for (const k in B) out.set(B[k], k);
    for (const k in G.RIG) {
      const r = G.RIG[k];
      if (r.bBody) out.set(r.bBody, k + ':body');
      if (r.bArm)  out.set(r.bArm,  k + ':arm');
      if (r.bArmL) out.set(r.bArmL, k + ':armL');
      if (r.bLeg)  out.set(r.bLeg,  k + ':leg');
    }
    return out;
  }

  nw.start = function (seed, opts) {
    window.__hf.show('play');
    G.start(seed, null, opts || null);
    return true;
  };
  // Deterministic time. The game never sees a real frame clock in these tools,
  // so the same seed and the same number of steps give the same world.
  nw.run = function (seconds, step) {
    step = step || 1 / 30;
    const n = Math.round(seconds / step);
    for (let i = 0; i < n; i++) G.update(step);
  };
  nw.state = function () { return G.state(); };
  nw.hall = function (x, z) { return G.place('hall', HF.w2gx(x || 0), HF.w2gx(z || 0)); };
  nw.place = function (t, x, z) { return G.place(t, HF.w2gx(x), HF.w2gx(z)); };
  // Buildings live in S.cells keyed "gx,gz"; a multi-cell footprint is one root
  // plus references, so both of these resolve to the root.
  nw.roots = function () {
    const S = G.state();
    return Object.keys(S.cells).map(k => S.cells[k]).filter(c => !c.ref);
  };
  nw.at = function (x, z) {
    const S = G.state(), c = S.cells[HF.w2gx(x) + ',' + HF.w2gx(z)];
    return c ? (c.ref || c) : null;
  };
  // Keep a building alive when the test is about something other than survival.
  // Without this a wave with no defence ends the round, update() stops
  // simulating, and the rest of the test measures a frozen world.
  nw.invincible = function () {
    nw.roots().forEach(b => { b.hp = b.max = 1e9; });
  };

  // The heart of it: every instance the renderer is handed this frame, tagged
  // with the batch it belongs to. Twelve floats per instance —
  // iPosRot(x,y,z,yaw) iColA(r,g,b,scale) iColB(r,g,b,pitch).
  nw.frame = function () {
    if (!LIST) G.draw();
    const label = names(), rows = [], counts = {};
    const orig = R.setInstances.bind(R);
    R.setInstances = function (batch, arr, cnt) {
      const key = label.get(batch) || ('#' + (LIST ? LIST.indexOf(batch) : -1));
      counts[key] = (counts[key] || 0) + cnt;
      for (let i = 0; i < cnt; i++) {
        const o = i * 12;
        rows.push({ b: key, x: arr[o], y: arr[o + 1], z: arr[o + 2], yaw: arr[o + 3],
                    ca: [arr[o + 4], arr[o + 5], arr[o + 6]], sc: arr[o + 7],
                    cb: [arr[o + 8], arr[o + 9], arr[o + 10]], pitch: arr[o + 11] });
      }
      return orig(batch, arr, cnt);
    };
    G.draw();
    R.setInstances = orig;
    return { counts, rows };
  };

  // Terrain height under a point — what everything drawable should sit on.
  nw.ground = function (x, z) {
    const S = G.state();
    return S && S.T ? S.T.h(x, z) : null;
  };
}

const GL_ARGS = ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'];

// Two pages that can reach each other over WebRTC, sharing one server and one
// browser. Chrome hides local IPs behind .local mDNS candidates by default,
// which never resolve in a sandbox, so two pages in one browser gather
// candidates neither of them can use and the handshake times out looking
// perfectly healthy. Turning that off is the whole reason this is a separate
// entry point rather than two calls to open().
export async function openMany(n = 2, { width = 1300, height = 820, webrtc = false } = {}) {
  const { srv, port } = await serve();
  const target = `http://127.0.0.1:${port}/nightward.html`;
  // Only one of two pages can be frontmost, and Chrome throttles a background
  // tab's rAF to about once a second. The host is the side that simulates and
  // ships snapshots, so whichever page loses that race quietly stops being a
  // game — snapshots trickle, every round trip takes seconds, and the failure
  // reads as "the netcode is slow" rather than "the tab is asleep".
  const browser = await chromium.launch({
    args: GL_ARGS.concat(
      ['--disable-background-timer-throttling', '--disable-renderer-backgrounding',
       '--disable-backgrounding-occluded-windows'],
      webrtc ? ['--disable-features=WebRtcHideLocalIpsWithMdns'] : []),
  });
  const errors = [], pages = [];
  for (let i = 0; i < n; i++) {
    const page = await browser.newPage({ viewport: { width, height } });
    const tag = n > 1 ? `[${i === 0 ? 'host' : 'guest'}] ` : '';
    page.on('pageerror', e => errors.push(tag + 'pageerror: ' + e.message));
    page.on('console', m => {
      const t = m.text();
      if (m.type() === 'error' && !/Failed to load resource/.test(t)) errors.push(tag + t);
    });
    await page.goto(target);
    await page.waitForFunction(() => window.__hf && window.__hf.game, null, { timeout: 30000 });
    await page.evaluate(pageHelpers);
    pages.push(page);
  }
  return {
    browser, pages, errors, url: target,
    close: async () => { await browser.close(); srv.close(); },
  };
}

export async function open({ url, width = 1300, height = 820 } = {}) {
  const { srv, port } = url ? { srv: null, port: 0 } : await serve();
  const target = url || `http://127.0.0.1:${port}/nightward.html`;
  const browser = await chromium.launch({ args: GL_ARGS });
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => {
    const t = m.text();
    // The built page loads nothing but a Google Fonts stylesheet, and that is
    // the only request that can fail. A sandbox with no egress reports it as a
    // bare "Failed to load resource" with no URL, so filter the shape.
    if (m.type() === 'error' && !/Failed to load resource/.test(t)) errors.push(t);
  });
  await page.goto(target);
  await page.waitForFunction(() => window.__hf && window.__hf.game, null, { timeout: 30000 });
  await page.evaluate(pageHelpers);
  return {
    browser, page, errors, url: target,
    // `url` is here for the one thing a single page load cannot test: whether
    // an edit survives a reload. Anything that reloads loses window.__nw and
    // must re-inject it — reopen() does both.
    reopen: async () => {
      await page.goto(target);
      await page.waitForFunction(() => window.__hf && window.__hf.game, null, { timeout: 30000 });
      await page.evaluate(pageHelpers);
    },
    close: async () => { await browser.close(); if (srv) srv.close(); },
  };
}

// ---- reporting ------------------------------------------------------------
// Tools print a line per check and exit non-zero if any failed, so they are
// usable from a shell or CI without anyone reading the prose.
let failed = 0;
export function check(label, ok, detail) {
  const mark = ok ? 'ok  ' : 'FAIL';
  if (!ok) failed++;
  console.log(`${mark} ${label}${detail === undefined ? '' : '  ' + detail}`);
  return ok;
}
export function done(errors = []) {
  if (errors.length) {
    failed++;
    console.log('FAIL page errors:');
    for (const e of errors.slice(0, 5)) console.log('     ' + e);
  }
  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
}
