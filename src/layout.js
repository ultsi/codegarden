// Computes world rectangles for groups and cards in both modes ("flow" and "files").
// Group positions come from the curated column assignment; cards are masonry-packed inside.

import {
  CARD_W, HEAD, LH, CODE_PAD_B, CARD_MIN_H, GROUP_PAD, CARD_GAP, GROUP_TARGET_H,
  GROUP_MAX_COLS, GROUP_VGAP, COL_GAP,
} from './config.js';

export function cardSize(fn) {
  if (fn.kind === 'external') return { w: CARD_W, h: 230 };
  const lines = fn.endLine - fn.startLine + 1;
  return { w: CARD_W, h: Math.max(CARD_MIN_H, HEAD + lines * LH + CODE_PAD_B) };
}

/** Pack cards into a group: returns {w, h, slots: Map(fnId -> {x,y}) relative to group origin}. */
let OPTS = { groupMaxCols: GROUP_MAX_COLS, groupTargetH: GROUP_TARGET_H, dirTargetH: 3400 };

function packGroup(fns) {
  const sizes = fns.map(cardSize);
  const total = sizes.reduce((a, s) => a + s.h + CARD_GAP, 0);
  const tallest = Math.max(...sizes.map(s => s.h));
  let cols = Math.ceil(total / OPTS.groupTargetH);
  cols = Math.max(1, Math.min(OPTS.groupMaxCols, cols, fns.length));
  // a single very tall card should not force extra empty columns
  if (cols > 1 && tallest > total / cols) cols = Math.max(1, Math.min(cols, Math.ceil(total / tallest)));
  const colH = new Array(cols).fill(0);
  const slots = new Map();
  fns.forEach((fn, i) => {
    let c = 0;
    for (let k = 1; k < cols; k++) if (colH[k] < colH[c] - 1) c = k;
    slots.set(fn.id, { x: GROUP_PAD + c * (CARD_W + CARD_GAP), y: GROUP_PAD + colH[c] });
    colH[c] += sizes[i].h + CARD_GAP;
  });
  return {
    w: GROUP_PAD * 2 + cols * CARD_W + (cols - 1) * CARD_GAP,
    h: GROUP_PAD * 2 + Math.max(...colH) - CARD_GAP,
    slots,
  };
}

/**
 * Lays out groups in columns; returns {groups: Map(id -> rect), cards: Map(fnId -> rect), bounds}.
 * groupDefs: [{id, col, ...}], memberOf: fn -> groupId
 */
function layoutMode(groupDefs, functions, memberOf, sortFns) {
  const members = new Map(groupDefs.map(g => [g.id, []]));
  for (const fn of functions) {
    const gid = memberOf(fn);
    if (members.has(gid)) members.get(gid).push(fn);
  }
  if (sortFns) for (const list of members.values()) list.sort(sortFns);

  const packed = new Map();
  for (const g of groupDefs) {
    if (members.get(g.id).length) packed.set(g.id, packGroup(members.get(g.id)));
  }

  // columns
  const colIds = [...new Set(groupDefs.map(g => g.col))].sort((a, b) => a - b);
  const columns = colIds.map(c => groupDefs.filter(g => g.col === c && packed.has(g.id)));
  const colW = columns.map(list => Math.max(0, ...list.map(g => packed.get(g.id).w)));
  const colH = columns.map(list =>
    list.reduce((a, g) => a + packed.get(g.id).h, 0) + Math.max(0, list.length - 1) * GROUP_VGAP,
  );

  const groups = new Map();
  const cards = new Map();
  let x = 0;
  columns.forEach((list, ci) => {
    let y = -colH[ci] / 2;
    for (const g of list) {
      const p = packed.get(g.id);
      const gx = x + (colW[ci] - p.w) / 2;
      groups.set(g.id, { x: gx, y, w: p.w, h: p.h });
      for (const fn of members.get(g.id)) {
        const s = p.slots.get(fn.id);
        const size = cardSize(fn);
        cards.set(fn.id, { x: gx + s.x, y: y + s.y, w: size.w, h: size.h });
      }
      y += p.h + GROUP_VGAP;
    }
    x += colW[ci] + COL_GAP;
  });

  return { groups, cards, bounds: unionRects([...groups.values()]) };
}

export function unionRects(rects) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rects) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w);
    y1 = Math.max(y1, r.y + r.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * Files mode: each directory is a region; its file groups are masonry-packed inside it.
 * Regions sharing a column stack vertically.
 */
function layoutFiles(data) {
  const DIR_TARGET_H = OPTS.dirTargetH;
  const HGAP = 140;
  const fnsByFile = new Map();
  for (const fn of data.functions) {
    if (!fnsByFile.has(fn.file)) fnsByFile.set(fn.file, []);
    fnsByFile.get(fn.file).push(fn);
  }
  for (const list of fnsByFile.values()) list.sort((a, b) => a.startLine - b.startLine);

  const regions = [];
  for (const d of data.dirs) {
    const defs = data.groups.files.filter(g => g.dir === d.dir && fnsByFile.has(g.id));
    if (!defs.length) continue;
    const packed = defs.map(g => ({ id: g.id, p: packGroup(fnsByFile.get(g.id)) }));
    const total = packed.reduce((a, x) => a + x.p.h + GROUP_VGAP, 0);
    const k = Math.max(1, Math.min(packed.length, Math.round(total / DIR_TARGET_H) || 1));
    const colX = [0];
    const colH = new Array(k).fill(0);
    const colW = new Array(k).fill(0);
    const place = packed.map(() => null);
    packed.forEach((x, i) => {
      let c = 0;
      for (let j = 1; j < k; j++) if (colH[j] < colH[c] - 1) c = j;
      place[i] = { c, y: colH[c] };
      colH[c] += x.p.h + GROUP_VGAP;
      colW[c] = Math.max(colW[c], x.p.w);
    });
    for (let j = 1; j < k; j++) colX[j] = colX[j - 1] + colW[j - 1] + HGAP;
    regions.push({
      dir: d.dir,
      col: Math.min(...d.cols),
      w: colX[k - 1] + colW[k - 1],
      h: Math.max(...colH) - GROUP_VGAP,
      items: packed.map((x, i) => ({ ...x, x: colX[place[i].c], y: place[i].y })),
    });
  }

  const groups = new Map();
  const cards = new Map();
  const cols = [...new Set(regions.map(r => r.col))].sort((a, b) => a - b);
  const RGAP = 380; // vertical gap between stacked regions (dir label sits in here)
  let x = 0;
  for (const c of cols) {
    const list = regions.filter(r => r.col === c);
    const w = Math.max(...list.map(r => r.w));
    let y = -(list.reduce((a, r) => a + r.h, 0) + (list.length - 1) * RGAP) / 2;
    for (const r of list) {
      const rx = x + (w - r.w) / 2;
      for (const it of r.items) {
        const gx = rx + it.x, gy = y + it.y;
        groups.set(it.id, { x: gx, y: gy, w: it.p.w, h: it.p.h });
        for (const fn of fnsByFile.get(it.id)) {
          const sl = it.p.slots.get(fn.id);
          const size = cardSize(fn);
          cards.set(fn.id, { x: gx + sl.x, y: gy + sl.y, w: size.w, h: size.h });
        }
      }
      y += r.h + RGAP;
    }
    x += w + COL_GAP;
  }
  return { groups, cards, bounds: unionRects([...groups.values()]) };
}

export function computeLayouts(data) {
  OPTS = { ...OPTS, ...(data.layout || {}) };
  const flow = layoutMode(data.groups.flow, data.functions, fn => fn.flowGroup, null);
  const files = layoutFiles(data);

  // directory frames around file groups (files mode only)
  files.dirs = [];
  for (const d of data.dirs) {
    const rects = data.groups.files.filter(g => g.dir === d.dir && files.groups.has(g.id)).map(g => files.groups.get(g.id));
    if (!rects.length) continue;
    const u = unionRects(rects);
    const pad = 60;
    files.dirs.push({ dir: d.dir, rect: { x: u.x - pad, y: u.y - pad - 130, w: u.w + pad * 2, h: u.h + pad * 2 + 130 } });
  }
  files.bounds = unionRects([files.bounds, ...files.dirs.map(d => d.rect)]);
  return { flow, files };
}
