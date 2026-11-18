// Camera: world <-> screen transform with smoothed, cursor-anchored zoom and animated fly-to.
// screen = (world - center) * s + viewport / 2

import { MIN_SCALE, MAX_SCALE } from './config.js';
import { clamp, easeInOut, lerp } from './zoom.js';

export class Camera {
  constructor() {
    this.cx = 0;
    this.cy = 0;
    this.ls = Math.log(0.15); // log scale
    this.tls = this.ls; // target log scale (smoothed wheel zoom)
    this.anchor = null; // {sx, sy, wx, wy}: world point pinned under the cursor while zooming
    this.fly = null;
    this.vw = 1;
    this.vh = 1;
    this.dirty = true;
    this.lastChange = 0;
  }

  get s() {
    return Math.exp(this.ls);
  }

  resize(w, h) {
    this.vw = w;
    this.vh = h;
    this.dirty = true;
  }

  toScreen(x, y) {
    const s = this.s;
    return [(x - this.cx) * s + this.vw / 2, (y - this.cy) * s + this.vh / 2];
  }

  toWorld(sx, sy) {
    const s = this.s;
    return [(sx - this.vw / 2) / s + this.cx, (sy - this.vh / 2) / s + this.cy];
  }

  /** world rect currently visible */
  viewRect(margin = 0) {
    const [x0, y0] = this.toWorld(-margin, -margin);
    const [x1, y1] = this.toWorld(this.vw + margin, this.vh + margin);
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  pan(dx, dy) {
    const s = this.s;
    this.cx -= dx / s;
    this.cy -= dy / s;
    if (this.anchor) {
      this.anchor.sx += dx;
      this.anchor.sy += dy;
    }
    this.fly = null;
    this.dirty = true;
  }

  zoomAt(sx, sy, factor) {
    const [wx, wy] = this.toWorld(sx, sy);
    this.anchor = { sx, sy, wx, wy };
    this.tls = clamp(this.tls + Math.log(factor), Math.log(MIN_SCALE), Math.log(MAX_SCALE));
    this.fly = null;
    this.dirty = true;
  }

  /** Smoothly zoom to an absolute scale keeping the given screen point fixed. */
  zoomToScale(s, sx = this.vw / 2, sy = this.vh / 2) {
    this.zoomAt(sx, sy, s / Math.exp(this.tls));
  }

  flyToRect(r, fill = 0.86, maxScale = MAX_SCALE) {
    const s = clamp(Math.min((this.vw * fill) / r.w, (this.vh * fill) / r.h), MIN_SCALE, maxScale);
    this.flyTo(r.x + r.w / 2, r.y + r.h / 2, s);
  }

  flyTo(cx, cy, s, dur = 750) {
    this.anchor = null;
    this.fly = {
      from: { cx: this.cx, cy: this.cy, ls: this.ls },
      to: { cx, cy, ls: Math.log(s) },
      t0: performance.now(),
      dur,
    };
    this.dirty = true;
  }

  jumpTo(cx, cy, s) {
    this.cx = cx;
    this.cy = cy;
    this.ls = this.tls = Math.log(s);
    this.fly = null;
    this.anchor = null;
    this.dirty = true;
  }

  /** advance animation; returns true if the transform changed since last frame */
  update(now, dt) {
    if (this.fly) {
      const f = this.fly;
      const t = clamp((now - f.t0) / f.dur, 0, 1);
      const e = easeInOut(t);
      // zoom out a bit mid-flight when travelling far: feels like Google Maps
      const dist = Math.hypot(f.to.cx - f.from.cx, f.to.cy - f.from.cy);
      const minS = Math.min(Math.exp(f.from.ls), Math.exp(f.to.ls));
      const needed = Math.log(Math.max(MIN_SCALE, Math.min(minS, (this.vw * 0.9) / (dist + 1))));
      const dip = Math.min(0, needed - Math.min(f.from.ls, f.to.ls)) * Math.sin(Math.PI * e);
      this.cx = lerp(f.from.cx, f.to.cx, e);
      this.cy = lerp(f.from.cy, f.to.cy, e);
      this.ls = lerp(f.from.ls, f.to.ls, e) + dip;
      this.tls = this.ls;
      if (t >= 1) {
        this.ls = this.tls = f.to.ls;
        this.fly = null;
      }
      this.dirty = true;
    } else if (Math.abs(this.tls - this.ls) > 1e-4) {
      const k = 1 - Math.exp(-dt / 70);
      this.ls += (this.tls - this.ls) * k;
      if (Math.abs(this.tls - this.ls) <= 1e-4) this.ls = this.tls;
      if (this.anchor) {
        const s = this.s;
        this.cx = this.anchor.wx - (this.anchor.sx - this.vw / 2) / s;
        this.cy = this.anchor.wy - (this.anchor.sy - this.vh / 2) / s;
      }
      this.dirty = true;
    } else {
      this.anchor = null;
    }
    const changed = this.dirty;
    if (changed) this.lastChange = now;
    this.dirty = false;
    return changed;
  }

  get settling() {
    return !!this.fly || Math.abs(this.tls - this.ls) > 1e-4;
  }
}
