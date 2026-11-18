// L3 code panes: real source lines rasterised with a tiny highlighter into canvas textures.
// Chunked so textures stay under GPU limits; re-rasterised at higher resolution as you zoom.
import { Container, Sprite, Texture } from 'pixi.js';
import { CARD_W, LH, CODE_FS, GUTTER, MAX_CODE_CHARS, MONO_FONT, SYNTAX, COLORS } from '../config.js';
import { getLines } from '../source.js';
import { highlight } from '../highlight.js';

const MAX_TEX = 4096;

let charW = null;
export function measureCharW() {
  if (charW) return charW;
  const c = document.createElement('canvas').getContext('2d');
  c.font = `100px ${MONO_FONT}`;
  charW = c.measureText('MMMMMMMMMM').width / 1000; // per 1px of font size
  return charW;
}

/** builds the line model once per function */
/**
 * links: [{line, col, len, to}] in raw-file columns; stored per display line index
 * as {c0, c1, to} in dedented columns (what is drawn and hit-tested).
 */
export function codeModel(fn, callLines, links = [], lang = 'js') {
  if (fn.kind === 'external') {
    const lines = (fn.desc || [fn.name]).map(t => ({ num: '', text: t }));
    return { lines, toks: lines.map(l => [[l.text, 'plain']]), callLines: new Set(), links: new Map() };
  }
  const { lines, indent } = getLines(fn.file, fn.startLine, fn.endLine);
  const toks = highlight(lines.map(l => l.text), fn.file.endsWith('.nimf') ? 'nimf' : lang);
  const byLine = new Map();
  for (const k of links) {
    const i = k.line - fn.startLine;
    if (i < 0 || i >= lines.length) continue;
    const c0 = k.col - indent;
    if (c0 < 0 || c0 >= MAX_CODE_CHARS) continue;
    if (!byLine.has(i)) byLine.set(i, []);
    const list = byLine.get(i);
    if (!list.some(x => x.c0 === c0)) list.push({ c0, c1: c0 + k.len, to: k.to, alt: k.alt || [] });
  }
  return { lines, toks, callLines, links: byLine };
}

/** link under a point given in card-local code coordinates (x from card left, y from code top) */
export function linkAt(model, x, y) {
  const i = Math.floor(y / LH);
  const list = model.links.get(i);
  if (!list) return null;
  const col = (x - GUTTER) / (measureCharW() * CODE_FS);
  for (const k of list) if (col >= k.c0 - 0.3 && col <= k.c1 + 0.3) return { ...k, lineIndex: i };
  return null;
}

function rasterChunk(model, from, to, res) {
  const w = CARD_W;
  const h = (to - from) * LH;
  const c = document.createElement('canvas');
  c.width = Math.ceil(w * res);
  c.height = Math.ceil(h * res);
  const g = c.getContext('2d');
  g.scale(res, res);
  g.textBaseline = 'middle';
  const cw = measureCharW() * CODE_FS;
  const maxChars = MAX_CODE_CHARS;
  for (let i = from; i < to; i++) {
    const y = (i - from) * LH;
    const line = model.lines[i];
    if (model.callLines.has(line.num)) {
      g.fillStyle = COLORS.callSite;
      g.fillRect(0, y, w, LH);
      g.fillStyle = '#e0662f';
      g.fillRect(w - 3, y + 1, 3, LH - 2);
    }
    g.font = `${CODE_FS * 0.86}px ${MONO_FONT}`;
    g.fillStyle = SYNTAX.gutter;
    g.textAlign = 'right';
    g.fillText(String(line.num), GUTTER - 7, y + LH / 2);
    g.textAlign = 'left';
    g.font = `${CODE_FS}px ${MONO_FONT}`;
    let x = GUTTER;
    let used = 0;
    for (const [text, kind] of model.toks[i]) {
      let t = text;
      if (used + t.length > maxChars) t = t.slice(0, Math.max(0, maxChars - used - 1)) + '…';
      g.fillStyle = SYNTAX[kind] || SYNTAX.plain;
      g.fillText(t, x, y + LH / 2);
      x += t.length * cw;
      used += t.length;
      if (used >= maxChars) break;
    }
    // clickable function names: underline
    const links = model.links.get(i);
    if (links) {
      g.fillStyle = SYNTAX.link;
      g.globalAlpha = 0.75;
      for (const k of links) {
        const c1 = Math.min(k.c1, maxChars);
        g.fillRect(GUTTER + k.c0 * cw, y + LH * 0.86, (c1 - k.c0) * cw, Math.max(0.5, LH * 0.07));
      }
      g.globalAlpha = 1;
    }
  }
  return Texture.from(c);
}

/** L2 "code silhouette": one faint bar per token, at exactly the place the text appears in L3. */
export function drawCodeSilhouette(g, model) {
  const cw = measureCharW() * CODE_FS;
  const colors = { plain: 0x24302a, kw: 0x7c3aed, str: 0x15803d, num: 0xb45309, com: 0x9aa29c, fn: 0x1d4ed8, type: 0x0f766e, punc: 0x5b6660 };
  model.toks.forEach((toks, i) => {
    let col = 0;
    const y = i * LH + LH * 0.28;
    for (const [text, kind] of toks) {
      const n = Math.min(text.length, MAX_CODE_CHARS - col);
      if (n <= 0) break;
      if (kind !== 'punc' && text.trim()) {
        const lead = text.length - text.trimStart().length;
        g.rect(GUTTER + (col + lead) * cw, y, Math.max(cw, (n - lead) * cw), LH * 0.44).fill({ color: colors[kind] ?? colors.plain, alpha: kind === 'com' ? 0.25 : 0.32 });
      }
      col += text.length;
    }
  });
  return g;
}

export class CodePane {
  constructor(model) {
    this.model = model;
    this.view = new Container();
    this.res = 0;
    this.sprites = [];
  }

  render(res) {
    if (res === this.res) return;
    this.res = res;
    for (const sp of this.sprites) {
      sp.texture.destroy(true);
      sp.destroy();
    }
    this.sprites = [];
    const n = this.model.lines.length;
    const per = Math.max(4, Math.floor(MAX_TEX / (LH * res)));
    for (let from = 0; from < n; from += per) {
      const to = Math.min(n, from + per);
      const sp = new Sprite(rasterChunk(this.model, from, to, res));
      sp.scale.set(1 / res);
      sp.y = from * LH;
      this.view.addChild(sp);
      this.sprites.push(sp);
    }
  }

  destroy() {
    for (const sp of this.sprites) sp.texture.destroy(true);
    this.view.destroy({ children: true });
  }
}

/** quantised raster resolution for a camera scale */
export function paneRes(s, dpr) {
  const want = s * dpr;
  const steps = [1, 1.5, 2, 3, 4, 6, 8];
  for (const st of steps) if (st >= want * 0.92) return st;
  return 8;
}
