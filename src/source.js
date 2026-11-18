// Loads the real repository sources (raw text) so code panes always show actual code.
// The server root is the codegarden folder; each repo lives at ../<root>/ next to garden/.

const files = new Map();

export async function loadSources(root, paths) {
  const base = new URL(`../../${root}/`, import.meta.url);
  await Promise.all(
    paths.map(async p => {
      try {
        const res = await fetch(new URL(p, base));
        if (!res.ok) throw new Error(res.status);
        files.set(p, (await res.text()).split('\n'));
      } catch (e) {
        console.warn('could not load source', p, e);
        files.set(p, [`// could not load ${p}`]);
      }
    }),
  );
}

/**
 * Lines [start, end] (1-based, inclusive), dedented.
 * Returns {lines: [{num, text}], indent} — indent = columns removed from every line.
 */
export function getLines(path, start, end) {
  const all = files.get(path) || [];
  const out = [];
  for (let n = start; n <= end && n <= all.length; n++) {
    out.push({ num: n, text: all[n - 1].replace(/\t/g, '  ') });
  }
  let indent = Infinity;
  for (const l of out) {
    if (!l.text.trim()) continue;
    indent = Math.min(indent, l.text.match(/^ */)[0].length);
  }
  if (indent === Infinity) indent = 0;
  if (indent > 0) for (const l of out) l.text = l.text.slice(indent);
  return { lines: out, indent };
}
