/*
  Shadow benchmark: open  ?level=city&bench  and keep the tab in front, hands off.
  The page reloads itself once per configuration (the shadow filter is baked into every
  shader, so a clean load is the only fair switch), warms up, then samples frames:
    - GPU time of the shadow pass and of the rest of the frame (EXT_disjoint_timer_query_webgl2;
      "n/a" where the browser doesn't expose it)
    - CPU time of renderer.render, rAF frame interval
    - draw calls and triangles, split into main view and shadow pass
  Results collect in sessionStorage; the last run shows a table and logs it to the console.
*/
const CONFIGS = [['soft', 2048], ['pcf', 2048], ['pcf', 1024], ['soft', 1024]];
const KEY = 'shadowBench';
const BQ = new URLSearchParams(location.search);
const SAMPLES = +BQ.get('benchFrames') || 360, WARM = Math.max(30, Math.round(SAMPLES * 0.66)); // ?benchFrames=N for a quick run

export function startBench(renderer) {
  const Q = new URLSearchParams(location.search);
  const step = +Q.get('bench') || 0;
  const [type, res] = CONFIGS[step];
  if (Q.get('shadow') !== type || +Q.get('shadowRes') !== res) return go(step); // first entry: set the config
  if (step === 0) sessionStorage.removeItem(KEY);

  const gl = renderer.getContext(), ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const info = renderer.info.render;
  const pending = [], S = { gpuShadow: [], gpuMain: [], cpu: [], frame: [], calls: [], tris: [], sCalls: [], sTris: [] };
  let frame = 0, last = 0, cur = null, sCalls = 0, sTris = 0;

  const sm = renderer.shadowMap, smRender = sm.render.bind(sm);
  sm.render = (...a) => {
    const c0 = info.calls, t0 = info.triangles;
    if (cur) { cur.shadow = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, cur.shadow); }
    smRender(...a);
    if (cur) { gl.endQuery(ext.TIME_ELAPSED_EXT); cur.main = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, cur.main); }
    sCalls = info.calls - c0; sTris = info.triangles - t0;
  };
  const render = renderer.render.bind(renderer);
  renderer.render = (scene, camera) => {
    const now = performance.now();
    const sampling = frame >= WARM;
    cur = sampling && ext ? {} : null;
    sCalls = sTris = 0;
    const t = performance.now();
    render(scene, camera);
    const cpu = performance.now() - t;
    if (cur?.main) { gl.endQuery(ext.TIME_ELAPSED_EXT); pending.push(cur); }
    else if (cur?.shadow) gl.deleteQuery(cur.shadow); // no shadow pass ran: drop it
    cur = null;
    if (sampling) {
      S.cpu.push(cpu); if (last) S.frame.push(now - last);
      S.calls.push(info.calls - sCalls); S.tris.push(info.triangles - sTris);
      S.sCalls.push(sCalls); S.sTris.push(sTris);
    }
    last = now;
    poll();
    if (++frame === WARM + SAMPLES) finish();
  };
  function poll() {
    if (!ext) return;
    const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
    while (pending.length && gl.getQueryParameter(pending[0].main, gl.QUERY_RESULT_AVAILABLE)) {
      const p = pending.shift();
      if (!disjoint) {
        S.gpuShadow.push(gl.getQueryParameter(p.shadow, gl.QUERY_RESULT) / 1e6);
        S.gpuMain.push(gl.getQueryParameter(p.main, gl.QUERY_RESULT) / 1e6);
      }
      gl.deleteQuery(p.shadow); gl.deleteQuery(p.main);
    }
  }
  function finish() {
    setTimeout(() => {
      poll();
      const med = (a) => { if (!a.length) return null; const b = [...a].sort((x, y) => x - y); return b[b.length >> 1]; };
      const row = {
        config: `${type} / ${res}`,
        gpuShadow: med(S.gpuShadow), gpuMain: med(S.gpuMain), cpuRender: med(S.cpu), frame: med(S.frame),
        mainCalls: med(S.calls), mainTris: med(S.tris), shadowCalls: med(S.sCalls), shadowTris: med(S.sTris),
        size: `${renderer.domElement.width}x${renderer.domElement.height}`, gpuSamples: S.gpuShadow.length,
      };
      const all = JSON.parse(sessionStorage.getItem(KEY) || '[]');
      all.push(row);
      sessionStorage.setItem(KEY, JSON.stringify(all));
      if (step + 1 < CONFIGS.length) go(step + 1);
      else show(all, !!ext);
    }, 300);
  }
}

function go(step) {
  const Q = new URLSearchParams(location.search);
  const [type, res] = CONFIGS[step];
  Q.set('bench', step); Q.set('shadow', type); Q.set('shadowRes', res);
  location.search = Q.toString();
}

function show(rows, gpu) {
  window.__bench = rows;
  console.log('shadow bench', JSON.stringify(rows, null, 1));
  const f = (v, d = 2) => (v == null ? 'n/a' : v.toFixed(d));
  const k = (v) => (v == null ? 'n/a' : v >= 1000 ? `${(v / 1000).toFixed(0)}k` : `${v}`);
  const el = document.createElement('div');
  el.id = 'bench';
  el.style.cssText = 'position:fixed;left:12px;top:12px;z-index:99;background:rgba(10,12,14,.85);color:#e8e8e8;font:12px/1.5 ui-monospace,monospace;padding:10px 12px;border-radius:6px;white-space:pre';
  el.textContent = [
    `shadow bench  ${rows[0].size}${gpu ? '' : '  (no GPU timer query in this browser)'}`,
    'config        gpu shadow  gpu main  cpu render  frame   main draws/tris   shadow draws/tris',
    ...rows.map((r) => `${r.config.padEnd(12)}  ${f(r.gpuShadow).padStart(8)}ms ${f(r.gpuMain).padStart(7)}ms ${f(r.cpuRender).padStart(8)}ms ${f(r.frame, 1).padStart(6)}ms   ${`${k(r.mainCalls)} / ${k(r.mainTris)}`.padEnd(16)}  ${k(r.shadowCalls)} / ${k(r.shadowTris)}`),
  ].join('\n');
  document.body.append(el);
}
