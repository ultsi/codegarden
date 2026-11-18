// Tiny per-language highlighters (JS, Nim, Nim source filters). Tokens per line, with
// multi-line comment / string state carried across lines.

const JS_KW = new Set(
  ('const let var function return if else for while do switch case break continue new class ' +
    'extends this typeof instanceof in of try catch finally throw async await yield default ' +
    'null undefined true false require module exports super delete void static get set')
    .split(' '),
);

const NIM_KW = new Set(
  ('proc func template macro iterator method converter let var const type object enum ref ptr tuple ' +
    'if elif else case of when while for in notin is isnot and or not xor shl shr div mod return result ' +
    'discard yield break continue try except finally raise import export from include as nil true false ' +
    'await async defer distinct static block using concept mixin bind addr cast echo end')
    .split(' '),
);

/** @returns {Array<Array<[string, string]>>} tokens per line: [text, kind] */
export function highlight(lines, lang = 'js') {
  if (lang === 'nim') return nim(lines);
  if (lang === 'nimf') return nimf(lines);
  return js(lines);
}

function js(lines) {
  let state = null; // null | 'com' | '`'
  const out = [];
  for (const line of lines) {
    const toks = [];
    let i = 0;
    const push = (text, kind) => text && toks.push([text, kind]);
    while (i < line.length) {
      if (state === 'com') {
        const e = line.indexOf('*/', i);
        if (e < 0) { push(line.slice(i), 'com'); i = line.length; }
        else { push(line.slice(i, e + 2), 'com'); i = e + 2; state = null; }
        continue;
      }
      if (state === '`') {
        let j = i;
        while (j < line.length && line[j] !== '`') j += line[j] === '\\' ? 2 : 1;
        if (j >= line.length) { push(line.slice(i), 'str'); i = line.length; }
        else { push(line.slice(i, j + 1), 'str'); i = j + 1; state = null; }
        continue;
      }
      const c = line[i];
      const rest = line.slice(i);
      if (rest.startsWith('//')) { push(rest, 'com'); break; }
      if (rest.startsWith('/*')) { state = 'com'; push('/*', 'com'); i += 2; continue; }
      if (c === "'" || c === '"') {
        let j = i + 1;
        while (j < line.length && line[j] !== c) j += line[j] === '\\' ? 2 : 1;
        push(line.slice(i, j + 1), 'str'); i = j + 1; continue;
      }
      if (c === '`') { state = '`'; push('`', 'str'); i++; continue; }
      let m;
      if ((m = rest.match(/^\d[\d._]*(e[+-]?\d+)?/i))) { push(m[0], 'num'); i += m[0].length; continue; }
      if ((m = rest.match(/^[A-Za-z_$][\w$]*/))) {
        const w = m[0];
        push(w, JS_KW.has(w) ? 'kw' : /^\s*\(/.test(line.slice(i + w.length)) ? 'fn' : 'plain');
        i += w.length; continue;
      }
      if ((m = rest.match(/^\s+/))) { push(m[0], 'plain'); i += m[0].length; continue; }
      push(c, 'punc'); i++;
    }
    out.push(toks);
  }
  return out;
}

function nimLine(line, state, toks) {
  // returns new state: null | 'com' (#[ ]#) | 'str3' (""")
  const push = (text, kind) => text && toks.push([text, kind]);
  let i = 0;
  let prevKw = null;
  while (i < line.length) {
    if (state === 'com') {
      const e = line.indexOf(']#', i);
      if (e < 0) { push(line.slice(i), 'com'); return 'com'; }
      push(line.slice(i, e + 2), 'com'); i = e + 2; state = null; continue;
    }
    if (state === 'str3') {
      const e = line.indexOf('"""', i);
      if (e < 0) { push(line.slice(i), 'str'); return 'str3'; }
      let k = e + 3;
      while (line[k] === '"') k++;
      push(line.slice(i, k), 'str'); i = k; state = null; continue;
    }
    const c = line[i];
    const rest = line.slice(i);
    let m;
    if (rest.startsWith('#[')) { state = 'com'; push('#[', 'com'); i += 2; continue; }
    if (c === '#') { push(rest, 'com'); break; }
    if (rest.startsWith('"""')) { state = 'str3'; push('"""', 'str'); i += 3; continue; }
    if (c === '"' || ((c === 'r' || c === 'R' || c === 'f' || c === 'p') && line[i + 1] === '"' && !/\w/.test(line[i - 1] || ''))) {
      let j = c === '"' ? i + 1 : i + 2;
      const raw = c !== '"';
      while (j < line.length && line[j] !== '"') j += !raw && line[j] === '\\' ? 2 : 1;
      push(line.slice(i, j + 1), 'str'); i = j + 1; continue;
    }
    if ((m = rest.match(/^'(\\.[^']*|[^'\\])'/))) { push(m[0], 'str'); i += m[0].length; continue; }
    if ((m = rest.match(/^(0[xob][\da-f_]+|\d[\d_]*(\.\d[\d_]*)?(e[+-]?\d+)?)('?[iuf]\d*)?/i))) { push(m[0], 'num'); i += m[0].length; continue; }
    if ((m = rest.match(/^[A-Za-z_]\w*/))) {
      const w = m[0];
      let kind = 'plain';
      if (NIM_KW.has(w)) kind = 'kw';
      else if (prevKw && /^(proc|func|template|macro|iterator|method|converter)$/.test(prevKw)) kind = 'fn';
      else if (/^\s*[(\[]/.test(line.slice(i + w.length)) && !/^[A-Z]/.test(w)) kind = 'fn';
      else if (/^[A-Z]/.test(w)) kind = 'type';
      push(w, kind);
      prevKw = kind === 'kw' ? w : null;
      i += w.length; continue;
    }
    if ((m = rest.match(/^\s+/))) { push(m[0], 'plain'); i += m[0].length; continue; }
    push(c, 'punc'); i++;
  }
  return state;
}

function nim(lines) {
  let state = null;
  return lines.map(line => {
    const toks = [];
    state = nimLine(line, state, toks);
    return toks;
  });
}

// Nim source filter: '#' lines are Nim code, other lines are template text with $substitutions
function nimf(lines) {
  return lines.map(line => {
    const toks = [];
    const m = line.match(/^(\s*)#(?!#)/);
    if (m) {
      toks.push([m[0], 'punc']);
      nimLine(line.slice(m[0].length), null, toks);
    } else if (/^\s*##/.test(line)) {
      toks.push([line, 'com']);
    } else {
      const parts = line.split(/(\$\{[^}]*\}|\$\([^)]*\)|\$[A-Za-z_][\w.]*)/);
      parts.forEach((p, k) => p && toks.push([p, k % 2 ? 'fn' : 'str']));
    }
    return toks;
  });
}
