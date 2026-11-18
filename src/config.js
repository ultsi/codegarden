// Shared constants: world-unit geometry, zoom bands and palette.

// ---- card / code geometry (world units)
export const CARD_W = 400;
export const HEAD = 34; // code-pane header height
export const LH = 9; // code line height
export const CODE_FS = 6.6; // code font size
export const CODE_PAD_B = 10;
export const CARD_MIN_H = 96;
export const GUTTER = 30; // line-number gutter inside code pane
export const MAX_CODE_CHARS = 88;

// ---- group / column layout (world units)
export const GROUP_PAD = 48;
export const CARD_GAP = 28;
export const GROUP_TARGET_H = 1500; // aim for groups about this tall before adding columns
export const GROUP_MAX_COLS = 4;
export const GROUP_VGAP = 260; // vertical gap between stacked groups (title sits in here)
export const COL_GAP = 440; // horizontal gap between layout columns (room for edges)

// ---- zoom bands (camera scale). Smoothstep in log-space.
export const BAND_L1_L2 = [0.2, 0.36];
export const BAND_L2_L3 = [0.95, 1.5];
export const MIN_SCALE = 0.035;
export const MAX_SCALE = 10;
export const LEVEL_SCALES = [0.13, 0.55, 2.0]; // targets when jumping to a level

// ---- fonts
export const UI_FONT = 'Inter, system-ui, sans-serif';
export const MONO_FONT = '"JetBrains Mono", ui-monospace, monospace';

// ---- palette (light "garden paper")
export const COLORS = {
  bg: 0xf4f2ea,
  dot: '#c9c4b4',
  card: 0xffffff,
  cardBorder: 0xd9d4c5,
  ink: 0x1f2a24,
  inkSoft: 0x5b6660,
  inkFaint: 0x8b948e,
  edge: 0x6f7a74,
  edgeHot: 0xe0662f,
  codeBg: 0xfbfaf6,
  callSite: 'rgba(224,102,47,0.13)',
};

export const SYNTAX = {
  plain: '#24302a',
  kw: '#7c3aed',
  str: '#15803d',
  num: '#b45309',
  com: '#9aa29c',
  fn: '#1d4ed8',
  type: '#0f766e',
  link: '#1d4ed8',
  punc: '#5b6660',
  gutter: '#b4b9b0',
};
