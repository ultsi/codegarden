// Edges, drawn in screen space each frame (crisp, constant width):
//  - L1: aggregated group->group edges (flow: calls between stages; files: require graph)
//  - L2: function -> function calls, anchored near card titles
//  - L3: same edges re-anchored to the exact call-site line in the caller's code
import { Graphics, Container } from 'pixi.js';
import { COLORS, HEAD, LH } from '../config.js';
import { lerp } from '../zoom.js';

export class Edges {
  constructor(data, layouts) {
    this.view = new Container();
    this.g = new Graphics(); // normal edges
    this.hot = new Graphics(); // highlighted edges on top
    this.view.addChild(this.g, this.hot);
    this.calls = data.calls.filter(c => c.from !== c.to);
    this.fns = new Map(data.functions.map(f => [f.id, f]));
    this.layouts = layouts;

    const ubiquitous = new Set(data.ubiquitous || []);
    // aggregated L1 edges
    const agg = (pairs, key) => {
      const m = new Map();
      for (const [a, b] of pairs) {
        if (a === b) continue;
        const k = a + '\u0000' + b;
        m.set(k, (m.get(k) || 0) + 1);
      }
      return [...m].map(([k, n]) => {
        const [a, b] = k.split('\u0000');
        return { from: a, to: b, n, faint: key === 'files' && ubiquitous.has(b) };
      });
    };
    this.agg = {
      flow: agg(this.calls.map(c => [this.fns.get(c.from).flowGroup, this.fns.get(c.to).flowGroup]), 'flow'),
      files: agg(data.requires.map(r => [r.from, r.to]), 'files'),
    };
  }

  /**
   * focus: {kind:'card'|'group', id} or null
   */
  update(cam, w, modeW, rects, focus) {
    const g = this.g;
    const hot = this.hot;
    g.clear();
    hot.clear();
    const vw = cam.vw, vh = cam.vh;
    const dim = focus ? 0.22 : 1;

    // ---- L1 aggregated
    for (const mode of ['flow', 'files']) {
      const ma = (mode === 'flow' ? 1 - modeW : modeW) * w.l1;
      if (ma < 0.01) continue;
      const groups = this.layouts[mode].groups;
      for (const e of this.agg[mode]) {
        const A = groups.get(e.from), B = groups.get(e.to);
        if (!A || !B) continue;
        const isHot = focus && focus.kind === 'group' && (focus.id === e.from || focus.id === e.to);
        const width = (e.faint ? 1 : 1.6 + 1.5 * Math.log2(1 + e.n)) * (isHot ? 1.25 : 1);
        const base = e.faint ? 0.08 : mode === 'files' ? 0.24 : 0.34;
        const alpha = ma * (isHot ? 0.95 : base * dim);
        const p = anchors(cam, A, B, A.y + A.h / 2, B.y + B.h / 2);
        if (!p || offscreen(p, vw, vh)) continue;
        drawCurve(isHot ? hot : g, p, width, isHot ? COLORS.edgeHot : COLORS.edge, alpha, 7 + width);
      }
    }

    // ---- L2 / L3 function edges
    const ca = w.vis;
    if (ca > 0.01) {
      for (const c of this.calls) {
        const A = rects.get(c.from), B = rects.get(c.to);
        const fa = this.fns.get(c.from);
        const isHot = focus && ((focus.kind === 'card' && (focus.id === c.from || focus.id === c.to)) ||
          (focus.kind === 'edge' && focus.from === c.from && focus.to === c.to));
        const yA2 = A.y + Math.min(46, A.h / 2);
        const inRange = c.line >= fa.startLine && c.line <= fa.endLine && fa.startLine > 0;
        const yA3 = inRange ? A.y + HEAD + (c.line - fa.startLine + 0.5) * LH : A.y + HEAD / 2;
        const yB2 = B.y + Math.min(46, B.h / 2);
        const yB3 = B.y + HEAD / 2;
        const p = anchors(cam, A, B, lerp(yA2, yA3, w.l3), lerp(yB2, yB3, w.l3));
        if (!p || offscreen(p, vw, vh)) continue;
        const alpha = ca * (isHot ? 1 : 0.5 * dim);
        drawCurve(isHot ? hot : g, p, isHot ? 2.4 : 1.3, isHot ? COLORS.edgeHot : COLORS.edge, alpha, isHot ? 9 : 7);
      }
    }
  }
}

/** pick exit/entry sides; returns screen-space [p0, c1, c2, p3] */
function anchors(cam, A, B, ya, yb) {
  const acx = A.x + A.w / 2, bcx = B.x + B.w / 2;
  let xa, xb, da, db;
  const overlapX = Math.abs(acx - bcx) < (A.w + B.w) / 2;
  if (overlapX) {
    // same column: leave and enter on the right, looping outwards
    xa = A.x + A.w; xb = B.x + B.w; da = 1; db = 1;
  } else if (bcx > acx) {
    xa = A.x + A.w; xb = B.x; da = 1; db = -1;
  } else {
    xa = A.x; xb = B.x + B.w; da = -1; db = 1;
  }
  const [x0, y0] = cam.toScreen(xa, ya);
  const [x3, y3] = cam.toScreen(xb, yb);
  const dist = Math.hypot(x3 - x0, y3 - y0);
  const k = overlapX ? Math.max(40, Math.min(220, dist * 0.35 + 30)) : Math.max(30, Math.abs(x3 - x0) * 0.45);
  return [x0, y0, x0 + da * k, y0, x3 + db * k, y3, x3, y3];
}

function offscreen(p, vw, vh) {
  const m = 20;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < 8; i += 2) {
    x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]);
    y0 = Math.min(y0, p[i + 1]); y1 = Math.max(y1, p[i + 1]);
  }
  return x1 < -m || y1 < -m || x0 > vw + m || y0 > vh + m;
}

function drawCurve(g, p, width, color, alpha, head) {
  const [x0, y0, c1x, c1y, c2x, c2y, x3, y3] = p;
  // stop the line at the arrow base
  const ang = Math.atan2(y3 - c2y, x3 - c2x);
  const bx = x3 - Math.cos(ang) * head * 0.8, by = y3 - Math.sin(ang) * head * 0.8;
  g.moveTo(x0, y0).bezierCurveTo(c1x, c1y, c2x, c2y, bx, by).stroke({ width, color, alpha, cap: 'round' });
  const s = head * 0.55;
  g.poly([
    x3, y3,
    x3 - Math.cos(ang) * head + Math.sin(ang) * s, y3 - Math.sin(ang) * head - Math.cos(ang) * s,
    x3 - Math.cos(ang) * head - Math.sin(ang) * s, y3 - Math.sin(ang) * head + Math.cos(ang) * s,
  ]).fill({ color, alpha });
}
