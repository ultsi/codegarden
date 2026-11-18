import { Application, Container } from 'pixi.js';
import { COLORS, LEVEL_SCALES, UI_FONT, MONO_FONT } from './config.js';
import { levelWeights, easeInOut, clamp } from './zoom.js';
import { computeLayouts, cardSize } from './layout.js';
import { loadSources } from './source.js';
import { Camera } from './camera.js';
import { Grid } from './scene/grid.js';
import { Groups } from './scene/groups.js';
import { Cards } from './scene/cards.js';
import { Edges } from './scene/edges.js';
import { UI, esc } from './ui.js';

const params = new URLSearchParams(location.search);

// Test hook for headless screenshots: ?shot=<ms> holds the window load event for <ms>
// (needs a server that implements /__delay, see README).
if (params.has('shot')) {
  const img = document.createElement('img');
  img.hidden = true;
  img.src = `/__delay?ms=${+params.get('shot') || 3000}`;
  document.body.appendChild(img);
}

const trace = msg => params.has('trace') && window.__showError('· ' + msg);

async function main() {
  trace('main start');
  const repo = /^[\w-]+$/.test(params.get('repo') || '') ? params.get('repo') : 'blakkis';
  const res = await fetch(new URL(`../data/${repo}.json`, import.meta.url));
  if (!res.ok) throw new Error(`no data for repo "${repo}" (data/${repo}.json)`);
  const data = await res.json();
  document.title = `codegarden · ${data.title}`;
  await Promise.all([
    loadSources(data.root, data.files.filter(f => f.path !== '(external)').map(f => f.path)),
    document.fonts.load(`700 20px ${UI_FONT}`),
    document.fonts.load(`400 20px ${UI_FONT}`),
    document.fonts.load(`400 20px ${MONO_FONT}`),
  ]);

  trace('data, sources, fonts loaded');
  const dpr = window.devicePixelRatio || 1;
  const app = new Application();
  await app.init({
    resizeTo: window,
    background: COLORS.bg,
    antialias: true,
    resolution: dpr,
    autoDensity: true,
    preserveDrawingBuffer: params.has('shot'),
  });
  document.getElementById('stage').appendChild(app.canvas);
  trace('pixi ready: ' + app.renderer.name);

  const layouts = computeLayouts(data);
  const cam = new Camera();
  const grid = new Grid();
  const groups = new Groups(data, layouts);
  const cards = new Cards(data, layouts, cardSize);
  const edges = new Edges(data, layouts);

  // world containers share the camera transform; edges & grid live in screen space
  const worldBeds = new Container();
  const worldCards = new Container();
  const worldLabels = new Container();
  worldBeds.addChild(groups.beds);
  worldCards.addChild(cards.view);
  worldLabels.addChild(groups.labels);
  app.stage.addChild(grid.view, worldBeds, edges.view, worldCards, worldLabels);
  const worlds = [worldBeds, worldCards, worldLabels];

  // ---- mode (flow <-> files) tween
  let mode = params.get('mode') === 'files' ? 'files' : 'flow';
  let modeFrom = mode === 'files' ? 1 : 0;
  let modeTo = modeFrom;
  let modeT0 = 0;
  const MODE_DUR = 750;
  let modeW = modeFrom;

  const ui = new UI({
    onMode: m => setMode(m),
    onLevel: lvl => cam.zoomToScale(LEVEL_SCALES[lvl - 1], pointer.inside ? pointer.x : cam.vw / 2, pointer.inside ? pointer.y : cam.vh / 2),
    onZoom: f => cam.zoomAt(cam.vw / 2, cam.vh / 2, f),
    onFit: () => fitAll(),
    onBack: () => goBack(),
    onRepo: r => {
      const q = new URLSearchParams(location.search);
      q.set('repo', r);
      location.search = q.toString();
    },
  });
  ui.setMode(mode);
  ui.setRepo(repo);

  function setMode(m) {
    if (m === mode) return;
    mode = m;
    modeFrom = modeW;
    modeTo = m === 'files' ? 1 : 0;
    modeT0 = performance.now();
    ui.setMode(m);
    dirty = true;
    // at the architecture level the two layouts have different extents: refit
    if (levelWeights(cam.s).l1 > 0.5) fitAll();
  }

  function fitAll(animate = true) {
    // leave room for the level panel on the right on wide screens
    const side = cam.vw > 900 ? 210 : 0;
    const b = layouts[mode].bounds;
    const s = Math.min(((cam.vw - side) * 0.94) / b.w, ((cam.vh - 90) * 0.94) / b.h);
    const cx = b.x + b.w / 2 + side / 2 / s;
    const cy = b.y + b.h / 2;
    if (animate) cam.flyTo(cx, cy, s);
    else cam.jumpTo(cx, cy, s);
  }

  cam.resize(app.screen.width, app.screen.height);
  fitAll(false);
  const focusParam = params.get('focus');
  if (focusParam && cards.cards.has(focusParam)) {
    cards.updateRects(modeW);
    const r = cards.rects.get(focusParam);
    const s = params.has('s') ? +params.get('s') : Math.min((cam.vw * 0.8) / r.w, (cam.vh * 0.8) / r.h);
    cam.jumpTo(r.x + r.w / 2, r.y + r.h / 2, s);
  } else if (params.has('s')) {
    cam.jumpTo(cam.cx, cam.cy, +params.get('s'));
  }
  window.addEventListener('resize', () => {
    cam.resize(app.screen.width, app.screen.height);
  });

  // ---- input
  const canvas = app.canvas;
  const pointer = { x: 0, y: 0, inside: false, down: false, moved: false, sx: 0, sy: 0, id: null };
  let hover = null; // {kind, id, obj}
  let selected = null;
  let dirty = true;

  canvas.addEventListener(
    'wheel',
    e => {
      e.preventDefault(); // blocks browser page zoom on ctrl+wheel / pinch
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? cam.vh : 1;
      const dx = e.deltaX * unit, dy = e.deltaY * unit;
      if (e.ctrlKey || e.metaKey) {
        // mouse wheels send ~100/notch, trackpad pinch sends small deltas
        const k = Math.abs(dy) >= 40 ? 0.0022 : 0.012;
        cam.zoomAt(e.offsetX, e.offsetY, Math.exp(-clamp(dy, -240, 240) * k));
      } else if (e.shiftKey && !dx) {
        cam.pan(-dy, 0);
      } else {
        cam.pan(-dx, -dy);
      }
    },
    { passive: false },
  );
  // Safari pinch
  window.addEventListener('gesturestart', e => e.preventDefault());
  window.addEventListener('gesturechange', e => e.preventDefault());
  // block ctrl +/- page zoom too: map it to the canvas zoom
  window.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && ['+', '=', '-', '0'].includes(e.key)) {
      e.preventDefault();
      if (e.key === '0') fitAll();
      else cam.zoomAt(cam.vw / 2, cam.vh / 2, e.key === '-' ? 1 / 1.6 : 1.6);
      return;
    }
    if (e.target.closest && e.target.closest('input, textarea')) return;
    if (e.key === 't' || e.key === 'T') setMode(mode === 'flow' ? 'files' : 'flow');
    else if (e.key === 'f' || e.key === 'F') fitAll();
    else if (e.key === '1' || e.key === '2' || e.key === '3') cam.zoomToScale(LEVEL_SCALES[+e.key - 1]);
    else if (e.key === 'Backspace' || (e.altKey && e.key === 'ArrowLeft')) {
      e.preventDefault();
      goBack();
    } else if (e.key === 'Escape') {
      selected = null;
      dirty = true;
    }
  });

  canvas.addEventListener('pointerdown', e => {
    pointer.down = true;
    pointer.moved = false;
    pointer.sx = e.clientX;
    pointer.sy = e.clientY;
    pointer.id = e.pointerId;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', e => {
    const dx = e.offsetX - pointer.x, dy = e.offsetY - pointer.y;
    pointer.x = e.offsetX;
    pointer.y = e.offsetY;
    pointer.inside = true;
    if (pointer.down) {
      if (!pointer.moved && Math.hypot(e.clientX - pointer.sx, e.clientY - pointer.sy) > 4) {
        pointer.moved = true;
        canvas.classList.add('grabbing');
      }
      if (pointer.moved) cam.pan(dx, dy);
    }
    updateHover();
  });
  const endDrag = e => {
    if (!pointer.down) return;
    pointer.down = false;
    canvas.classList.remove('grabbing');
    if (!pointer.moved) {
      const h = pick(pointer.x, pointer.y);
      if (h && h.kind === 'link') return jumpTo(h.link.to, h.from);
      selected = h && (!selected || selected.id !== h.id) ? h : null;
      dirty = true;
    }
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('pointerleave', () => {
    pointer.inside = false;
    hover = null;
    ui.tip(null);
    dirty = true;
  });
  canvas.addEventListener('dblclick', e => {
    const h = pick(e.offsetX, e.offsetY);
    if (h && h.kind === 'link') return;
    if (h && h.kind === 'card') cam.flyToRect(cards.rects.get(h.id), 0.82);
    else if (h && h.kind === 'group') cam.flyToRect(h.obj.rect, 0.9, 0.7);
    else cam.zoomAt(e.offsetX, e.offsetY, 2.2);
  });

  // ---- jump to a linked function (keeps you at code level), with back history
  const history = [];
  function jumpTo(id, fromId) {
    const r = cards.rects.get(id);
    if (!r) return;
    history.push({ cx: cam.cx, cy: cam.cy, s: cam.s, sel: selected });
    if (history.length > 50) history.shift();
    ui.setBack(history.length > 0);
    const s = clamp(Math.max(cam.s, 1.7), 1.7, Math.min(4, (cam.vw * 0.8) / r.w));
    // put the callee's header near the top of the screen; centre short functions
    const topAligned = r.y + (cam.vh * 0.5 - cam.vh * 0.18) / s;
    cam.flyTo(r.x + r.w / 2, Math.min(topAligned, r.y + r.h / 2), s, 650);
    selected = { kind: 'card', id };
    hover = null;
    ui.tip(null);
    dirty = true;
  }
  function goBack() {
    const h = history.pop();
    ui.setBack(history.length > 0);
    if (!h) return;
    cam.flyTo(h.cx, h.cy, h.s, 550);
    selected = h.sel;
    dirty = true;
  }

  function pick(sx, sy) {
    const [wx, wy] = cam.toWorld(sx, sy);
    const w = levelWeights(cam.s);
    if (w.vis > 0.35) {
      const c = cards.hit(wx, wy);
      if (c && w.l3 > 0.6) {
        const link = cards.linkAt(c, wx, wy);
        if (link) return { kind: 'link', id: c.fn.id + '→' + link.to, from: c.fn.id, link, obj: c };
      }
      if (c) return { kind: 'card', id: c.fn.id, obj: c };
    }
    const g = groups.hit(wx, wy, modeW);
    if (g) return { kind: 'group', id: g.id, obj: g };
    return null;
  }

  const fnById = new Map(data.functions.map(f => [f.id, f]));
  const callsOut = new Map(), callsIn = new Map();
  for (const c of data.calls) {
    callsOut.set(c.from, (callsOut.get(c.from) || 0) + 1);
    callsIn.set(c.to, (callsIn.get(c.to) || 0) + 1);
  }

  function updateHover() {
    const h = pointer.down && pointer.moved ? null : pick(pointer.x, pointer.y);
    const changed = (h && h.id) !== (hover && hover.id);
    hover = h;
    if (changed) dirty = true;
    canvas.classList.toggle('link', !!h && h.kind === 'link');
    if (!h) return ui.tip(null);
    if (h.kind === 'link') {
      const f = fnById.get(h.link.to);
      const more = h.link.alt && h.link.alt.length ? `<span>+${h.link.alt.length} other overload(s) with this name</span>` : '';
      ui.tip(
        `<b>→ ${esc(f.name)}</b>${f.params ? `<code>(${esc(f.params)})</code>` : ''}` +
          `<span>${esc(f.file)}:${f.startLine}</span>${more}<span>click to jump · Backspace to go back</span>`,
        pointer.x,
        pointer.y,
      );
      return;
    }
    if (h.kind === 'card') {
      const f = fnById.get(h.id);
      const loc = f.kind === 'external' ? 'outside the repo' : `${f.file}:${f.startLine}–${f.endLine}`;
      ui.tip(
        `<b>${esc(f.name)}</b>${f.params ? `<code>(${esc(f.params)})</code>` : ''}<span>${esc(loc)}</span>` +
          `<span>${callsOut.get(f.id) || 0} outgoing · ${callsIn.get(f.id) || 0} incoming calls</span>`,
        pointer.x,
        pointer.y,
      );
    } else {
      const d = h.obj.def;
      ui.tip(`<b>${esc(d.title)}</b><span>${esc(d.desc || d.id)}</span><span>double-click to open</span>`, pointer.x, pointer.y);
    }
  }

  // ---- frame loop
  let last = performance.now();
  let settledDone = false;
  function frame(now = performance.now()) {
    const dt = Math.min(64, now - last);
    last = now;

    const camChanged = cam.update(now, dt);
    let modeChanged = false;
    if (modeW !== modeTo) {
      const t = clamp((now - modeT0) / MODE_DUR, 0, 1);
      modeW = modeFrom + (modeTo - modeFrom) * easeInOut(t);
      if (t >= 1) modeW = modeTo;
      modeChanged = true;
    }
    if (!(camChanged || modeChanged || dirty)) {
      // settle pass: sharpen text & code once the camera rests
      if (!settledDone && now - cam.lastChange > 140) {
        const w = levelWeights(cam.s);
        const more = cards.settle(cam, w, dpr);
        groups.sharpen(dpr);
        settledDone = !more;
      }
      return;
    }
    dirty = false;
    settledDone = false;
    if (camChanged && pointer.inside && !pointer.down) updateHover();

    const s = cam.s;
    for (const wc of worlds) {
      wc.scale.set(s);
      wc.position.set(cam.vw / 2 - cam.cx * s, cam.vh / 2 - cam.cy * s);
    }
    const w = levelWeights(s);
    let focus = hover || selected;
    const focusIds = new Set();
    if (hover && hover.kind === 'link') {
      focusIds.add(hover.link.to);
      focus = { kind: 'edge', from: hover.from, to: hover.link.to };
    }
    if (hover && hover.kind === 'card') focusIds.add(hover.id);
    if (selected && selected.kind === 'card') focusIds.add(selected.id);

    grid.update(cam);
    groups.update(cam, w, modeW, focus && focus.kind === 'group' ? focus.id : null);
    const rects = cards.updateRects(modeW);
    cards.update(cam, w, focusIds, dpr);
    edges.update(cam, w, modeW, rects, focus);
    ui.update(s, w);
  }
  app.ticker.add(() => frame());

  // Headless screenshots: rAF doesn't run, so step the loop by hand and render once.
  if (params.has('shot')) {
    if (params.has('hover')) hover = { kind: 'card', id: params.get('hover') };
    if (params.has('jump')) {
      // simulate clicking a linked name: finish the fly-to animation instantly
      jumpTo(params.get('jump'));
      if (cam.fly) cam.fly.t0 = -1e9;
    }
    const t0 = performance.now();
    for (let i = 0; i < 50; i++) {
      dirty = i < 30; // keep building lazily-created code panes, then let settle() sharpen
      frame(t0 + i * 1000);
    }
    app.renderer.render(app.stage);
    // headless Firefox doesn't composite the WebGL canvas into screenshots: show a 2D copy
    const copy = app.renderer.extract.canvas({ target: app.stage, frame: app.screen, resolution: dpr });
    copy.style.cssText = `position:fixed;left:0;top:0;width:${app.screen.width}px;height:${app.screen.height}px;background:#f4f2ea`;
    document.getElementById('stage').appendChild(copy);
  }

  trace('scene built');
  window.__garden = { cam, layouts, data, jumpTo }; // handy for poking around in devtools
}

main().catch(err => {
  console.error(err);
  window.__showError('codegarden failed to start:\n' + (err && err.stack ? err.stack : err));
});
