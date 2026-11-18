// Miro-style dot grid in screen space. Two tiling layers (fine / coarse = 4x) crossfade
// across powers of 4; dot textures are regenerated at the exact pixel spacing so dots
// stay a constant size on screen.
import { Container, Texture, TilingSprite } from 'pixi.js';
import { COLORS } from '../config.js';

const BASE = 40; // world spacing of the finest grid

class DotLayer {
  constructor(radius) {
    this.radius = radius;
    this.size = 0;
    this.sprite = new TilingSprite({ texture: Texture.WHITE, width: 10, height: 10 });
  }

  setSpacing(px) {
    const size = Math.max(6, Math.round(px));
    if (size === this.size) return;
    this.size = size;
    const res = window.devicePixelRatio || 1;
    const c = document.createElement('canvas');
    c.width = c.height = Math.round(size * res);
    const g = c.getContext('2d');
    g.scale(res, res);
    g.fillStyle = COLORS.dot;
    g.beginPath();
    g.arc(size / 2, size / 2, this.radius, 0, Math.PI * 2);
    g.fill();
    const old = this.sprite.texture;
    this.sprite.texture = Texture.from(c);
    this.sprite.tileScale.set(1 / res);
    if (old !== Texture.WHITE) old.destroy(true);
  }
}

export class Grid {
  constructor() {
    this.view = new Container();
    this.fine = new DotLayer(1.1);
    this.coarse = new DotLayer(1.5);
    this.view.addChild(this.fine.sprite, this.coarse.sprite);
  }

  update(cam) {
    const s = cam.s;
    const k = Math.ceil(Math.log(14 / (BASE * s)) / Math.log(4));
    const finePx = BASE * Math.pow(4, k) * s; // in [14, 56)
    const fade = Math.min(1, Math.max(0, (finePx - 14) / 28));
    this.place(this.fine, cam, finePx, fade);
    this.place(this.coarse, cam, finePx * 4, 1);
  }

  place(layer, cam, px, alpha) {
    layer.setSpacing(px);
    const sp = layer.sprite;
    sp.width = cam.vw;
    sp.height = cam.vh;
    // tile spacing is rounded to whole px; keep the world origin pinned regardless
    const [ox, oy] = cam.toScreen(0, 0);
    sp.tilePosition.set(ox - layer.size / 2, oy - layer.size / 2);
    sp.alpha = alpha;
    sp.visible = alpha > 0.01;
  }
}
