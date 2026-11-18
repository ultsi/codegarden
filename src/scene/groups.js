// L1 "garden beds": group rectangles (flow stages or files) plus their morphing labels,
// and directory frames for the files mode.
import { Container, Graphics, Text } from 'pixi.js';
import { COLORS, UI_FONT } from '../config.js';
import { clamp, lerp, smoothstep } from '../zoom.js';

const TITLE_FS = 22; // label content is authored in "screen px" units
const DESC_FS = 13;
const L2_TITLE_WORLD = 58; // world font size of the group title once cards are visible
const L2_TITLE_MIN_PX = 13;
const SPILL_FLOW = { x: 380, y: 160 }; // flow beds have wide gutters
const SPILL_FILES = { x: 110, y: 120 };

class GroupLabel {
  constructor(title, desc, stats, hue) {
    this.view = new Container();
    this.bg = new Graphics();
    this.title = new Text({
      text: title,
      style: { fontFamily: UI_FONT, fontSize: TITLE_FS, fontWeight: '700', fill: hue, stroke: { color: 0xffffff, width: 5, join: 'round' } },
    });
    this.desc = new Text({
      text: desc,
      style: { fontFamily: UI_FONT, fontSize: DESC_FS, fill: COLORS.inkSoft, wordWrap: true, wordWrapWidth: 210, align: 'center', lineHeight: 17 },
    });
    this.stats = new Text({
      text: stats,
      style: { fontFamily: UI_FONT, fontSize: 11, fill: COLORS.inkFaint, fontWeight: '600', letterSpacing: 0.4 },
    });
    this.view.addChild(this.bg, this.title, this.desc, this.stats);
    // L1 block layout (centered)
    const w = Math.max(this.title.width, this.desc.width, this.stats.width) + 28;
    this.blockW = w;
    this.desc.position.set((w - this.desc.width) / 2, TITLE_FS + 14);
    this.stats.position.set((w - this.stats.width) / 2, TITLE_FS + 20 + this.desc.height);
    this.blockH = TITLE_FS + 32 + this.desc.height + this.stats.height;
    this.bg.roundRect(0, -8, w, this.blockH + 4, 12).fill({ color: 0xffffff, alpha: 0.86 });
    this.res = 0;
  }

  /**
   * vis: 0 = L1 (centered, screen-sized), 1 = L2+ (top-left sign above the bed).
   * At L1 the label degrades with available room: full block -> title only -> hidden.
   */
  update(rect, s, vis, alpha, spill) {
    const tw = this.title.width, th = TITLE_FS + 6;
    // room on screen (px): the bed plus part of the gutter around it
    const sw = (rect.w + spill.x) * s, sh = (rect.h + spill.y) * s;
    const sFull = Math.min(1, (sw * 0.92) / this.blockW, (sh * 0.92) / this.blockH);
    const sTitle = Math.min(1, (sw * 0.9) / tw, (sh * 0.9) / th);
    const d = smoothstep(0.62, 0.85, sFull); // 1 = full block, 0 = title only
    const l1Alpha = smoothstep(0.38, 0.55, sTitle);
    const a = alpha * lerp(l1Alpha, 1, vis);
    this.view.alpha = a;
    this.view.visible = a > 0.005;
    if (!this.view.visible) return;

    const px = lerp(sTitle, sFull, d); // L1: px per content unit
    const l1Scale = px / s;
    const l2Scale = Math.max(L2_TITLE_WORLD / TITLE_FS, L2_TITLE_MIN_PX / TITLE_FS / s);
    const sc = Math.exp(lerp(Math.log(l1Scale), Math.log(l2Scale), vis));
    const boxW = lerp(tw, this.blockW, d), boxH = lerp(th, this.blockH, d);
    const x1 = rect.x + rect.w / 2 - (boxW / 2) * l1Scale;
    const y1 = rect.y + rect.h / 2 - (boxH / 2) * l1Scale;
    const x2 = rect.x + 6;
    const y2 = rect.y - (TITLE_FS + 10) * l2Scale;
    this.view.position.set(lerp(x1, x2, vis), lerp(y1, y2, vis));
    this.view.scale.set(sc);
    this.title.x = lerp(lerp(0, (this.blockW - tw) / 2, d), 0, vis);
    const detail = d * clamp(1 - vis * 2.2, 0, 1);
    this.desc.alpha = this.stats.alpha = this.bg.alpha = detail;
    this.lastScale = sc * s;
  }

  sharpen(dpr) {
    const want = clamp(Math.ceil((this.lastScale || 1) * dpr * 2) / 2, 1, 6);
    if (Math.abs(want - this.res) < 0.5) return;
    this.res = want;
    this.title.resolution = want;
    this.desc.resolution = this.stats.resolution = Math.min(want, 3);
  }
}

export class Groups {
  constructor(data, layouts) {
    this.beds = new Container(); // under edges & cards
    this.labels = new Container(); // above cards
    this.items = [];
    const stat = fns => {
      const lines = fns.reduce((a, f) => a + (f.endLine - f.startLine + 1), 0);
      return `${fns.length} FUNCTIONS · ${lines} LINES`;
    };

    // directory frames (files mode)
    this.frames = [];
    const dirHue = new Map(data.dirs.map(d => [d.dir, d.hue]));
    for (const d of layouts.files.dirs) {
      const hue = dirHue.get(d.dir) ?? COLORS.inkSoft;
      const g = new Graphics();
      const r = d.rect;
      g.roundRect(r.x, r.y, r.w, r.h, 60).fill({ color: hue, alpha: 0.035 }).stroke({ width: 5, color: hue, alpha: 0.28 });
      const label = new Text({
        text: d.dir === '.' ? data.title + '/' : d.dir === '(external)' ? 'outside the repo' : d.dir + '/',
        style: { fontFamily: UI_FONT, fontSize: 18, fontWeight: '700', fill: hue, letterSpacing: 0.5 },
      });
      this.beds.addChild(g);
      this.labels.addChild(label);
      this.frames.push({ g, label, rect: r });
    }

    for (const mode of ['flow', 'files']) {
      const L = layouts[mode];
      for (const def of data.groups[mode]) {
        const rect = L.groups.get(def.id);
        if (!rect) continue;
        const fns = data.functions.filter(f => (mode === 'flow' ? f.flowGroup : f.file) === def.id);
        const hue = def.hue ?? dirHue.get(def.dir) ?? COLORS.inkSoft;
        const fill = new Graphics().roundRect(0, 0, rect.w, rect.h, 36).fill({ color: hue, alpha: 1 });
        fill.position.set(rect.x, rect.y);
        const border = new Graphics()
          .roundRect(0, 0, rect.w, rect.h, 36)
          .stroke({ width: 4, color: hue, alpha: 1 });
        border.position.set(rect.x, rect.y);
        const label = new GroupLabel(def.title, def.desc || '', stat(fns), hue);
        this.beds.addChild(fill, border);
        this.labels.addChild(label.view);
        this.items.push({ id: def.id, mode, rect, hue, fill, border, label, def });
      }
    }
  }

  /** modeW: 0 = flow, 1 = files */
  update(cam, w, modeW, hoverId) {
    const s = cam.s;
    const view = cam.viewRect(200);
    for (const it of this.items) {
      const ma = it.mode === 'flow' ? 1 - modeW : modeW;
      const onScreen = intersects(it.rect, view);
      const visible = ma > 0.005 && onScreen;
      it.fill.visible = it.border.visible = visible;
      if (visible) {
        const hot = hoverId === it.id;
        it.fill.alpha = ma * lerp(0.2, 0.05, w.vis) * (hot ? 1.5 : 1);
        it.border.alpha = ma * lerp(0.55, 0.32, w.vis) * (hot ? 1.6 : 1);
      }
      it.label.update(it.rect, s, w.vis, onScreen ? ma : 0, it.mode === 'flow' ? SPILL_FLOW : SPILL_FILES);
    }
    for (const f of this.frames) {
      const a = modeW;
      f.g.visible = f.label.visible = a > 0.005;
      f.g.alpha = a;
      f.label.alpha = a * 0.95;
      const sc = Math.max(1 / s, 64 / 18);
      f.label.scale.set(sc);
      f.label.position.set(f.rect.x + 40, f.rect.y + 30);
    }
  }

  sharpen(dpr) {
    for (const it of this.items) if (it.label.view.visible) it.label.sharpen(dpr);
  }

  hit(wx, wy, modeW) {
    const mode = modeW < 0.5 ? 'flow' : 'files';
    for (const it of this.items) {
      if (it.mode !== mode) continue;
      const r = it.rect;
      if (wx >= r.x && wx <= r.x + r.w && wy >= r.y && wy <= r.y + r.h) return it;
    }
    return null;
  }
}

export function intersects(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
