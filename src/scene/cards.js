// L2 function cards that morph into L3 code panes (same rect; label slides into a header).
import { Container, Graphics, Text } from 'pixi.js';
import { COLORS, HEAD, UI_FONT, MONO_FONT } from '../config.js';
import { clamp, lerp, smoothstep } from '../zoom.js';
import { CodePane, codeModel, paneRes, drawCodeSilhouette, linkAt } from './code.js';
import { intersects } from './groups.js';

const NAME_FS = 26;
const HEADER_NAME_FS = 14;

const KIND_LABEL = {
  handler: 'COMMAND',
  phases: 'MULTI-PHASE',
  menu: 'INLINE MENU',
  method: 'METHOD',
  data: 'DATA',
  external: 'EXTERNAL',
  toplevel: 'MODULE',
  fn: 'FUNCTION',
  route: 'ROUTE',
  router: 'ROUTER',
  template: 'TEMPLATE',
  macro: 'MACRO',
  iterator: 'ITERATOR',
};

function mix(a, b, t) {
  const r = (a >> 16) + (((b >> 16) - (a >> 16)) * t);
  const g = ((a >> 8) & 255) + ((((b >> 8) & 255) - ((a >> 8) & 255)) * t);
  const bl = (a & 255) + (((b & 255) - (a & 255)) * t);
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
}

class Card {
  constructor(fn, size, callLines, links, lang, hue) {
    this.fn = fn;
    this.w = size.w;
    this.h = size.h;
    this.callLines = callLines;
    this.hue = hue;

    this.view = new Container();
    this.view.pivot.set(this.w / 2, this.h / 2);

    this.body = new Graphics()
      .roundRect(0, 0, this.w, this.h, 14)
      .fill({ color: COLORS.card })
      .stroke({ width: 2, color: COLORS.cardBorder });
    this.stripe = new Graphics().roundRect(0, 0, 9, this.h, 4).fill({ color: hue });
    this.header = new Graphics()
      .roundRect(0, 0, this.w, HEAD, 14)
      .rect(0, HEAD - 14, this.w, 14)
      .fill({ color: hue, alpha: 0.1 })
      .rect(0, HEAD - 1, this.w, 1)
      .fill({ color: hue, alpha: 0.35 });
    this.ring = new Graphics().roundRect(-5, -5, this.w + 10, this.h + 10, 18).stroke({ width: 5, color: COLORS.edgeHot });
    this.ring.visible = false;

    this.name = new Text({
      text: fn.name,
      style: { fontFamily: UI_FONT, fontSize: NAME_FS, fontWeight: '700', fill: COLORS.ink },
    });
    this.meta = new Text({
      text: fn.params ? `(${fn.params})` : '',
      style: { fontFamily: MONO_FONT, fontSize: 15, fill: COLORS.inkSoft, wordWrap: true, wordWrapWidth: this.w - 50, breakWords: true },
    });
    const loc = fn.kind === 'external' ? 'outside the repo' : `${fn.file.split('/').pop()}:${fn.startLine}`;
    this.badge = new Text({
      text: `${KIND_LABEL[fn.kind] || ''}  ·  ${loc}`,
      style: { fontFamily: UI_FONT, fontSize: 12, fontWeight: '600', fill: COLORS.inkFaint, letterSpacing: 0.6 },
    });
    this.badge.anchor.set(1, 0);
    this.badge.position.set(this.w - 16, 11);

    this.codeHost = new Container();
    this.codeHost.y = HEAD;
    this.pane = null;
    this.model = codeModel(fn, callLines, links, lang);

    // L2: code silhouette (token bars) that morphs into real text at L3
    this.silhouette = drawCodeSilhouette(new Graphics(), this.model);
    this.silhouette.y = HEAD;
    // plate keeps the L2 title readable on top of the silhouette
    this.plate = new Graphics();

    this.view.addChild(this.body, this.header, this.stripe, this.silhouette, this.plate, this.codeHost, this.name, this.meta, this.badge, this.ring);
    this.labelRes = 0;
  }

  layoutLabels(l3) {
    // L2: big name top-left, params below. L3: small name inside the header bar.
    // names never wrap: long ones (e.g. Jester routes) shrink to fit the card / header
    if (this.rawNameW === undefined) this.rawNameW = this.name.width / this.name.scale.x;
    const fitL2 = Math.min(1, (this.w - 48) / this.rawNameW);
    if (this.rawBadgeW === undefined) this.rawBadgeW = this.badge.width / this.badge.scale.x;
    const fitL3 = Math.min(HEADER_NAME_FS / NAME_FS, (this.w - 50 - this.rawBadgeW * 0.8) / this.rawNameW);
    const sc = lerp(fitL2, fitL3, l3);
    this.name.scale.set(sc);
    this.name.position.set(lerp(24, 18, l3), lerp(22, (HEAD - this.name.height) / 2, l3));
    this.meta.position.set(24, this.name.y + this.name.height + 6);
    const plateH = Math.min(this.h - 12, this.meta.y + this.meta.height + 14);
    if (plateH !== this.plateH) {
      this.plateH = plateH;
      this.plate.clear().roundRect(10, 6, this.w - 16, plateH - 6, 10).fill({ color: COLORS.card, alpha: 0.92 });
    }
  }
}

export class Cards {
  constructor(data, layouts, cardSize) {
    this.view = new Container();
    this.cards = new Map();
    this.layouts = layouts;
    const callLines = new Map();
    for (const c of data.calls) {
      if (!callLines.has(c.from)) callLines.set(c.from, new Set());
      callLines.get(c.from).add(c.line);
    }
    const links = new Map();
    for (const k of data.links || []) {
      if (!links.has(k.from)) links.set(k.from, []);
      links.get(k.from).push(k);
    }
    const hues = new Map(data.groups.flow.map(g => [g.id, g.hue]));
    for (const fn of data.functions) {
      const card = new Card(fn, cardSize(fn), callLines.get(fn.id) || new Set(), links.get(fn.id) || [], data.lang,
        hues.get(fn.flowGroup) ?? COLORS.inkSoft);
      this.cards.set(fn.id, card);
      this.view.addChild(card.view);
    }
    this.rects = new Map(); // current (tweened) rects
    this.panes = 0;
  }

  /** modeT: eased 0 (flow) .. 1 (files). Updates and returns current rects. */
  updateRects(modeT) {
    for (const [id, card] of this.cards) {
      const a = this.layouts.flow.cards.get(id);
      const b = this.layouts.files.cards.get(id);
      const r = { x: lerp(a.x, b.x, modeT), y: lerp(a.y, b.y, modeT), w: card.w, h: card.h };
      this.rects.set(id, r);
    }
    return this.rects;
  }

  update(cam, w, focusIds, dpr) {
    const view = cam.viewRect(100);
    const vis = w.vis;
    const sprout = lerp(0.9, 1, vis);
    const textA = clamp((vis - 0.35) / 0.65, 0, 1);
    const wantRes = paneRes(cam.s, dpr);
    let budget = 3; // new panes per frame
    for (const [id, card] of this.cards) {
      const r = this.rects.get(id);
      const on = intersects(r, view);
      card.view.visible = on;
      if (!on) continue;
      card.view.position.set(r.x + r.w / 2, r.y + r.h / 2);
      card.view.scale.set(sprout);
      // label morph runs ahead of the code fade so title and code never fight for space
      const lt = smoothstep(0, 0.55, w.l3);
      card.body.alpha = lerp(0.5, 1, vis);
      card.body.tint = mix(0xffffff, card.hue, 0.38 * (1 - vis));
      card.silhouette.alpha = vis * (1 - smoothstep(0.25, 0.95, w.l3));
      card.silhouette.visible = card.silhouette.alpha > 0.01;
      card.plate.alpha = textA * (1 - lt);
      card.stripe.alpha = lerp(0.5, 1, vis);
      card.header.alpha = lt;
      card.name.alpha = textA;
      card.badge.alpha = textA * 0.95;
      card.badge.scale.set(lerp(1, 0.8, lt));
      card.meta.alpha = textA * (1 - smoothstep(0, 0.3, w.l3));
      card.ring.visible = focusIds && focusIds.has(id) && vis > 0.2;
      card.layoutLabels(lt);

      // L3 code
      if (w.l3 > 0.004) {
        if (!card.pane && budget > 0) {
          budget--;
          card.pane = new CodePane(card.model);
          card.pane.render(Math.min(wantRes, 3));
          card.codeHost.addChild(card.pane.view);
          this.panes++;
        }
        card.codeHost.alpha = smoothstep(0.15, 1, w.l3);
        card.codeHost.visible = true;
      } else {
        card.codeHost.visible = false;
      }
    }
  }

  /** called when the camera has settled: sharpen visible text/code, free hidden panes */
  settle(cam, w, dpr) {
    const view = cam.viewRect(100);
    const wantRes = paneRes(cam.s, dpr);
    let budget = 6;
    for (const card of this.cards.values()) {
      const on = card.view.visible;
      if (card.pane && (w.l3 <= 0.004 || (!on && this.panes > 30))) {
        card.pane.destroy();
        card.pane = null;
        this.panes--;
        continue;
      }
      if (!on) continue;
      if (card.pane && card.pane.res !== wantRes && budget > 0) {
        budget--;
        card.pane.render(wantRes);
      }
      const labelPx = card.name.scale.x * cam.s * dpr;
      const res = clamp(Math.ceil(labelPx * 2) / 2, 1, 6);
      if (Math.abs(res - card.labelRes) >= 0.5 && w.vis > 0.2) {
        card.labelRes = res;
        card.name.resolution = res;
        card.meta.resolution = card.badge.resolution = clamp(Math.ceil(cam.s * dpr * 2) / 2, 1, 6);
      }
    }
    return budget === 0; // true if more work remains
  }

  /** clickable function name under a world point (only meaningful at L3) */
  linkAt(card, wx, wy) {
    const r = this.rects.get(card.fn.id);
    const y = wy - r.y - HEAD;
    if (y < 0) return null;
    return linkAt(card.model, wx - r.x, y);
  }

  hit(wx, wy) {
    for (const [id, r] of this.rects) {
      if (wx >= r.x && wx <= r.x + r.w && wy >= r.y && wy <= r.y + r.h) return this.cards.get(id);
    }
    return null;
  }
}
