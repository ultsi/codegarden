// HTML overlay: view toggle, level indicator, zoom controls, tooltip.

export class UI {
  constructor({ onMode, onLevel, onZoom, onFit, onBack, onRepo }) {
    this.el = {
      toggle: document.querySelectorAll('[data-mode]'),
      levels: document.querySelectorAll('[data-level]'),
      pct: document.getElementById('zpct'),
      tip: document.getElementById('tip'),
    };
    this.el.toggle.forEach(b => b.addEventListener('click', () => onMode(b.dataset.mode)));
    this.el.levels.forEach(b => b.addEventListener('click', () => onLevel(+b.dataset.level)));
    document.getElementById('zin').addEventListener('click', () => onZoom(1.6));
    document.getElementById('zout').addEventListener('click', () => onZoom(1 / 1.6));
    document.getElementById('fit').addEventListener('click', onFit);
    this.el.back = document.getElementById('back');
    this.el.back.addEventListener('click', onBack);
    this.el.repo = document.getElementById('repo');
    this.el.repo.addEventListener('change', () => onRepo(this.el.repo.value));
  }

  setRepo(repo) {
    if (![...this.el.repo.options].some(o => o.value === repo)) this.el.repo.add(new Option(repo, repo));
    this.el.repo.value = repo;
  }

  setBack(on) {
    this.el.back.hidden = !on;
  }

  setMode(mode) {
    this.el.toggle.forEach(b => b.classList.toggle('on', b.dataset.mode === mode));
  }

  update(s, w) {
    this.el.pct.textContent = `${Math.round(s * 100)}%`;
    const ws = [w.l1, w.l2, w.l3];
    this.el.levels.forEach((b, i) => {
      b.style.setProperty('--w', ws[i].toFixed(3));
      b.classList.toggle('on', ws[i] > 0.5);
    });
  }

  tip(info, x, y) {
    const t = this.el.tip;
    if (!info) {
      t.hidden = true;
      return;
    }
    t.hidden = false;
    t.innerHTML = info;
    const pad = 16;
    const r = t.getBoundingClientRect();
    const nx = x + pad + r.width > innerWidth ? x - pad - r.width : x + pad;
    const ny = y + pad + r.height > innerHeight ? y - pad - r.height : y + pad;
    t.style.transform = `translate(${nx}px, ${ny}px)`;
  }
}

export const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
