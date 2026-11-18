#!/usr/bin/env python3
"""
Builds garden/data/nitter.json for the nitter repo (Nim, Jester + Karax).

Curated by hand (top of file): flow groups, which file belongs to which group,
external services and the rules that connect code to them.
Extracted from the sources: top-level procs/funcs/templates/iterators (+ .nimf
source-filter procs), Jester route handlers, imports, and call sites. Calls are
resolved by name with Nim's module scoping approximated as:
  same file > directly imported module > transitively imported (depth 3) > unique global.
Overloads in the winning tier are all linked (capped).

Usage:  python3 garden/tools/gen_nitter.py
"""
import json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, '..', '..', 'nitter'))
SRC = os.path.join(REPO, 'src')
OUT = os.path.normpath(os.path.join(HERE, '..', 'data', 'nitter.json'))

# ---------------------------------------------------------------- curated: flow groups
FLOW_GROUPS = [
    # id,              col, title,                hue,      description
    ('entry',            0, 'Entry',              0x64748b, 'Browser requests, startup & config'),
    ('routes_timeline',  1, 'Timeline routes',    0x4338ca, 'Profiles, tweets, search, lists, communities, RSS'),
    ('routes_media',     1, 'Media routes',       0x6d28d9, 'Media proxy, embeds, broadcasts, spaces, articles'),
    ('routes_misc',      1, 'Misc routes',        0x7c3aed, 'Preferences, resolver, debug, unsupported, helpers'),
    ('views_page',       2, 'Page shell',         0x15803d, 'Karax page layout, navbar, search & preference forms'),
    ('views_content',    2, 'Content views',      0x16a34a, 'Tweets, timelines, profiles, lists, articles…'),
    ('views_feeds',      2, 'Feeds',              0x4d7c0f, 'RSS / OpenSearch / oEmbed source filters'),
    ('formatting',       2, 'Formatting',         0x65a30d, 'URL rewriting, text & time formatting, media signing'),
    ('api',              3, 'Twitter API',        0xb45309, 'GraphQL / REST endpoint wrappers'),
    ('cache',            3, 'Cache',              0xb91c1c, 'Redis-backed caching of users, tweets, lists, RSS'),
    ('prefs',            3, 'Prefs & queries',    0x0d9488, 'User preferences (cookies) and search query building'),
    ('transport',        4, 'Transport & auth',   0x0369a1, 'Signed requests, session pool, rate limits, HTTP pool'),
    ('parsing',          4, 'Parsing',            0x9a3412, 'JSON → model objects'),
    ('model',            5, 'Model',              0x78716c, 'Types and small type helpers'),
]

def flow_group_of(path):
    """path relative to src/"""
    base = os.path.basename(path)
    d = os.path.dirname(path)
    if path in ('nitter.nim', 'config.nim'):
        return 'entry'
    if d == 'routes':
        if base in ('timeline.nim', 'status.nim', 'search.nim', 'list.nim', 'community.nim', 'rss.nim'):
            return 'routes_timeline'
        if base in ('media.nim', 'embed.nim', 'broadcast.nim', 'space.nim', 'article.nim'):
            return 'routes_media'
        return 'routes_misc'
    if d == 'views':
        if base.endswith('.nimf'):
            return 'views_feeds'
        if base in ('general.nim', 'renderutils.nim', 'preferences.nim', 'about.nim', 'feature.nim', 'search.nim'):
            return 'views_page'
        return 'views_content'
    if base in ('formatters.nim', 'utils.nim'):
        return 'formatting'
    if base == 'api.nim':
        return 'api'
    if base == 'redis_cache.nim':
        return 'cache'
    if base in ('prefs.nim', 'prefs_impl.nim', 'query.nim'):
        return 'prefs'
    if base in ('apiutils.nim', 'http_pool.nim', 'auth.nim', 'tid.nim', 'consts.nim'):
        return 'transport'
    if d.startswith('experimental/types') or base == 'types.nim':
        return 'model'
    if d.startswith('experimental') or base in ('parser.nim', 'parserutils.nim'):
        return 'parsing'
    return 'model'

DIR_HUES = {
    '(external)': 0x64748b, 'src': 0x475569, 'src/routes': 0x4338ca, 'src/views': 0x15803d,
    'src/experimental': 0x9a3412, 'src/experimental/parser': 0x9a3412, 'src/experimental/types': 0x78716c,
}
DIR_COLS = [
    ('(external)', [0]), ('src', [1]), ('src/routes', [2]), ('src/views', [3]),
    ('src/experimental', [4]), ('src/experimental/parser', [4]), ('src/experimental/types', [5]),
]

FILE_DESC = {
    'src/nitter.nim': 'Entrypoint: config, pools, routers, Jester app',
    'src/config.nim': 'Parses nitter.conf',
    'src/api.nim': 'Typed wrappers around X GraphQL/REST endpoints',
    'src/apiutils.nim': 'Signed fetch with retries, rate-limit bookkeeping',
    'src/auth.nim': 'Session pool: pick, limit, invalidate sessions',
    'src/http_pool.nim': 'Pooled async HTTP clients',
    'src/redis_cache.nim': 'Redis cache for users, tweets, lists, RSS',
    'src/parser.nim': 'Parses API JSON into Tweets, Users, Timelines',
    'src/parserutils.nim': 'JSON helpers, entity expansion',
    'src/formatters.nim': 'Rewrites URLs, formats text/time, signs media',
    'src/types.nim': 'Core data types',
    'src/query.nim': 'Search query <-> URL params',
    'src/prefs.nim': 'Preference access from cookies',
    'src/prefs_impl.nim': 'Preference definitions (macro-generated)',
    'src/tid.nim': 'x-client-transaction-id generation',
    'src/utils.nim': 'HMAC signing, URL helpers',
    'src/consts.nim': 'API endpoints, GraphQL ids & features',
}

# ---------------------------------------------------------------- curated: externals
EXTERNALS = [
    # id, name, group, file-dir for files mode, description lines
    ('ext.browser', 'Browser', 'entry', [
        'The user\'s browser — outside this repository.',
        '',
        'Sends GET/POST requests to Jester routes and',
        'receives server-rendered HTML (Karax), RSS/XML,',
        'proxied media and JSON (oEmbed).',
    ]),
    ('ext.twitter', 'X / Twitter API & CDN', 'transport', [
        'X (Twitter) servers — outside this repository.',
        '',
        'GraphQL + REST API (x.com/i/api) used with',
        'pooled sessions and signed headers;',
        'pbs.twimg.com / video.twimg.com media fetched',
        'by the media proxy routes.',
    ]),
    ('ext.redis', 'Redis', 'cache', [
        'Redis server — outside this repository.',
        '',
        'Caches users, tweets, lists, RSS feeds and',
        'username <-> id mappings with TTLs.',
    ]),
]
# body regex -> external (caller -> external edges)
EXTERNAL_RULES = [
    (re.compile(r'\bpool\.use\b|\bclient\.(request|getContent|get|send)\b|\bc\.get\('), 'ext.twitter'),
    (re.compile(r'\bwithAcquire\b'), 'ext.redis'),
]

# names too generic to resolve without call syntax `name(`
GENERIC = {'get', 'set', 'add', 'len', 'text', 'link', 'icon', 'cache', 'release', 'use', 'log',
           'error', 'parse', 'pretty', 'endpoint', 'migrate', 'expand', 'contains', 'items', 'hash'}

DEF_RE = re.compile(r'^(#?)(\s*)(proc|func|template|macro|iterator|method|converter)\s+(`[^`]+`|[A-Za-z_]\w*)(\*?)')
ROUTE_RE = re.compile(r'^(\s+)(get|post|put|delete|patch)\s+"([^"]+)"\s*:')
IDENT_RE = re.compile(r'[A-Za-z_]\w*')


def read(path):
    with open(os.path.join(SRC, path), encoding='utf-8') as f:
        return f.read().split('\n')


def code_only(line, nimf=False):
    """Strip strings/comments for identifier scanning (single line, approximate)."""
    if nimf:
        if line.lstrip().startswith('#'):
            line = line.lstrip()[1:]
            if line.startswith('#'):
                return ''
        else:
            # template text: only $ substitutions are code
            return ' '.join(m.group(1) or m.group(2) or '' for m in re.finditer(r'\$\{([^}]*)\}|\$\(([^)]*)\)', line)) + \
                ' ' + ' '.join(re.findall(r'\$([A-Za-z_][\w.]*)', line))
    out, i, q = [], 0, None
    while i < len(line):
        c = line[i]
        if q:
            if c == '\\' and q == '"':
                i += 2
                continue
            if c == q:
                q = None
            out.append(' ')
        elif c == '#':
            break
        elif c == '"':
            q = '"'
            out.append(' ')
        elif c == "'" and i + 2 < len(line) and (line[i + 2] == "'" or (line[i + 1] == '\\' and i + 3 < len(line))):
            j = line.find("'", i + 1 + (1 if line[i + 1] == '\\' else 0) + 1)
            j = j if j > 0 else i
            out.append(' ' * (j - i + 1))
            i = j + 1
            continue
        else:
            out.append(c)
        i += 1
    return ''.join(out)


def indent_of(s):
    return len(s) - len(s.lstrip(' '))


def block_end(lines, start, base_indent, nimf=False):
    """Index (0-based, inclusive) of the last line of the block that starts at `start`."""
    if nimf:
        for i in range(start + 1, len(lines)):
            if re.match(r'^#\s*end\s+proc', lines[i]):
                return i
        return start
    # signature may span lines until a line ends with '='
    i = start
    sig_end = None
    for k in range(start, min(start + 10, len(lines))):
        if k > start and indent_of(lines[k]) <= base_indent and lines[k].strip():
            break
        if k > start and not lines[k].strip():
            break
        c = code_only(lines[k]).rstrip()
        if c.endswith('='):
            sig_end = k
            break
    if sig_end is None:
        # one-liner or forward decl
        sig_end = start
        if '=' not in code_only(lines[start]):
            return start
    last = sig_end
    for k in range(sig_end + 1, len(lines)):
        s = lines[k]
        if not s.strip():
            continue
        if indent_of(s) <= base_indent:
            break
        last = k
    return last


def main():
    files = []
    for root, _, names in os.walk(SRC):
        for n in sorted(names):
            if n.endswith('.nim') or n.endswith('.nimf'):
                files.append(os.path.relpath(os.path.join(root, n), SRC))
    files.sort()
    srcs = {p: read(p) for p in files}

    # ---- module resolution / imports
    modpath = {}
    for p in files:
        modpath[p[:-4] if p.endswith('.nim') else p[:-5]] = p

    def resolve_mod(fromfile, item):
        item = item.strip().strip('"')
        item = re.sub(r'\s+as\s+\w+$', '', item)
        cands = [os.path.normpath(os.path.join(os.path.dirname(fromfile), item)), os.path.normpath(item)]
        for c in cands:
            if c in modpath:
                return modpath[c]
        return None

    imports = {}
    for p, lines in srcs.items():
        text = '\n'.join(l.lstrip('#') if p.endswith('.nimf') else l for l in lines)
        stmts = re.findall(r'^(?:import|include|export)\s+((?:[^\n]*\[[^\]]*\][^\n]*)|[^\n]+)', text, re.M)
        stmts += re.findall(r'^from\s+(\S+)\s+import', text, re.M)
        deps = set()
        for st in stmts:
            st = re.sub(r'#.*', '', st)
            # expand a/[b, c] and ".."/[b, c]
            for m in re.finditer(r'("?[\w./]+"?)\s*/\s*\[([^\]]*)\]', st):
                pre = m.group(1).strip('"')
                for it in m.group(2).split(','):
                    r = resolve_mod(p, pre + '/' + it.strip())
                    if r:
                        deps.add(r)
            st2 = re.sub(r'("?[\w./]+"?)\s*/\s*\[[^\]]*\]', '', st)
            for it in st2.split(','):
                it = it.strip()
                if it:
                    r = resolve_mod(p, it)
                    if r:
                        deps.add(r)
        deps.discard(p)
        imports[p] = deps

    def reachable(p, depth=3):
        seen, frontier = set(), {p}
        for _ in range(depth):
            nxt = set()
            for f in frontier:
                for d in imports.get(f, ()):
                    if d not in seen and d != p:
                        seen.add(d)
                        nxt.add(d)
            frontier = nxt
        return seen

    # ---- extract defs and routes
    functions = []
    for p, lines in srcs.items():
        nimf = p.endswith('.nimf')
        routers = []
        for i, line in enumerate(lines):
            m = DEF_RE.match(line)
            if not m:
                continue
            hashp, ind, kind, name, exported = m.groups()
            if nimf != bool(hashp):
                continue
            if len(ind) != 0:
                continue
            name = name.strip('`')
            end = block_end(lines, i, 0, nimf)
            sig = line[m.end():]
            params = re.match(r'\s*\(([^)]*)\)?', sig)
            params = params.group(1).strip() if params else ''
            fn = dict(file='src/' + p, name=name, params=params[:120], startLine=i + 1, endLine=end + 1,
                      kind={'template': 'template', 'macro': 'macro', 'iterator': 'iterator'}.get(kind, 'fn'),
                      exported=bool(exported))
            body = '\n'.join(lines[i:end + 1])
            if re.search(r'^\s+router\s+\w+\s*:', body, re.M):
                routers.append(fn)
            functions.append(fn)

        # route handlers (inside router procs, or the routes: block in nitter.nim)
        for i, line in enumerate(lines):
            m = ROUTE_RE.match(line)
            if not m:
                continue
            ind = len(m.group(1))
            end = i
            for k in range(i + 1, len(lines)):
                if lines[k].strip() and indent_of(lines[k]) <= ind:
                    break
                if lines[k].strip():
                    end = k
            functions.append(dict(file='src/' + p, name=f'{m.group(2).upper()} {m.group(3)}', params='',
                                  startLine=i + 1, endLine=end + 1, kind='route', exported=False))

        # router procs: shrink to their header (routes are their own cards)
        for fn in routers:
            first_route = None
            for k in range(fn['startLine'], fn['endLine']):
                if ROUTE_RE.match(lines[k]):
                    first_route = k
                    break
            if first_route:
                fn['endLine'] = first_route  # lines up to (not incl.) first route
                fn['kind'] = 'router'

    # nitter.nim top-level startup code and `routes:` block
    main_lines = srcs['nitter.nim']
    settings_line = next(i for i, l in enumerate(main_lines) if l.startswith('settings:'))
    functions.append(dict(file='src/nitter.nim', name='nitter.nim (startup)', params='', startLine=1,
                          endLine=settings_line, kind='toplevel', exported=False))

    # drop routes that duplicate inside each other (nested blocks) and order
    functions.sort(key=lambda f: (f['file'], f['startLine']))

    # ids
    used = {}
    for fn in functions:
        stem = fn['file'][4:].rsplit('.', 1)[0].replace('/', '.')
        base = f"{stem}.{fn['name']}" if fn['kind'] != 'route' else f"{stem}:{fn['name']}"
        n = used.get(base, 0)
        used[base] = n + 1
        fn['id'] = base if n == 0 else f'{base}#{n + 1}'
        fn['flowGroup'] = flow_group_of(fn['file'][4:])
        if fn['kind'] == 'route':
            fn['params'] = 'Jester route handler'

    for eid, name, group, desc in EXTERNALS:
        functions.insert(0, dict(id=eid, file='(external)', name=name, params='', startLine=0, endLine=0,
                                 kind='external', flowGroup=group, desc=desc, exported=False))

    # object field names (UFCS makes `x.field` look like a call)
    fields = set()
    for p, lines in srcs.items():
        if 'types' not in p:
            continue
        for l in lines:
            m = re.match(r'^\s{2,}([A-Za-z_]\w*)\*?\s*(,|:)', l)
            if m:
                fields.add(m.group(1))
            for mm in re.finditer(r'([A-Za-z_]\w*)\*?\s*,', l if re.match(r'^\s{2,}\w+\*?\s*,', l) else ''):
                fields.add(mm.group(1))

    def locals_of(fn, lines):
        names = set()
        sig = lines[fn['startLine'] - 1]
        if fn['kind'] not in ('route', 'toplevel'):
            for grp in re.findall(r'\(([^)]*)\)', sig)[:1]:
                for part in grp.split(';'):
                    for nm in part.split(':')[0].split('=')[0].split(','):
                        nm = nm.strip().replace('var ', '')
                        if re.match(r'^\w+$', nm):
                            names.add(nm)
        in_block = None
        for ln in range(fn['startLine'], fn['endLine'] + 1):
            l = lines[ln - 1].lstrip('#') if fn['file'].endswith('.nimf') else lines[ln - 1]
            m = re.match(r'^(\s*)(let|var|const)\s*(\w+)?', l)
            if m:
                if m.group(3) and m.group(3) not in ('let', 'var', 'const'):
                    names.add(m.group(3))
                    in_block = None
                else:
                    in_block = len(m.group(1))
                # tuple unpack: let (a, b) =
                for mm in re.finditer(r'(\w+)', (re.search(r'\(([^)]*)\)\s*=', l) or re.match('', '')).group(1) if re.search(r'\(([^)]*)\)\s*=', l) else ''):
                    names.add(mm.group(1))
                continue
            if in_block is not None:
                if l.strip() and indent_of(l) <= in_block:
                    in_block = None
                else:
                    mm = re.match(r'^\s+(\w+)\s*(:|=|,)', l)
                    if mm:
                        names.add(mm.group(1))
            for mm in re.finditer(r'\bfor\s+([\w\s,()]+?)\s+in\b', l):
                names.update(re.findall(r'\w+', mm.group(1)))
        names.update({'result', 'it', 'a', 'b'})
        return names

    by_name = {}
    for fn in functions:
        if fn['kind'] in ('external', 'route', 'toplevel'):
            continue
        by_name.setdefault(fn['name'], []).append(fn)

    # ---- calls
    calls, links = [], []
    reach_cache = {}
    for fn in functions:
        if fn['kind'] == 'external':
            continue
        p = fn['file'][4:]
        lines = srcs[p]
        nimf = p.endswith('.nimf')
        direct = imports.get(p, set())
        if p not in reach_cache:
            reach_cache[p] = reachable(p)
        trans = reach_cache[p]
        first_line = {}
        local = locals_of(fn, lines)
        # skip the def line itself (parameter names) for procs
        start = fn['startLine'] + (0 if fn['kind'] in ('route', 'toplevel') else 1)
        for ln in range(start, fn['endLine'] + 1):
            raw = lines[ln - 1]
            code = code_only(raw, nimf)
            for m in IDENT_RE.finditer(code):
                name = m.group(0)
                cands = by_name.get(name)
                if not cands:
                    continue
                after = code[m.end():m.end() + 2]
                before = code[max(0, m.start() - 1):m.start()]
                if after.startswith(':') and not after.startswith(':='):
                    continue  # named arg / field decl
                if after.lstrip().startswith('=') and not after.lstrip().startswith('=='):
                    continue  # assignment target
                call_syntax = after.startswith('(') or after.startswith('[')
                if name in GENERIC and (not call_syntax or before == '.'):
                    continue
                if name in local and not call_syntax:
                    continue
                if before == '.' and name in fields and not call_syntax:
                    continue
                tiers = [
                    [c for c in cands if c['file'] == fn['file']],
                    [c for c in cands if c['file'][4:] in direct],
                    [c for c in cands if c['file'][4:] in trans],
                    cands if len(cands) == 1 else [],
                ]
                chosen = next((t for t in tiers if t), [])
                chosen = [c for c in chosen if c['id'] != fn['id']][:3]
                if not chosen:
                    continue
                # the column in the raw line (nimf: code lines had '#' stripped)
                col = m.start()
                if nimf and raw.lstrip().startswith('#'):
                    col += indent_of(raw) + 1
                elif nimf:
                    k = raw.find(name)
                    col = k if k >= 0 else 0
                links.append({'from': fn['id'], 'to': chosen[0]['id'], 'line': ln, 'col': col, 'len': len(name),
                              'alt': [c['id'] for c in chosen[1:]]})
                for c in chosen:
                    first_line.setdefault(c['id'], ln)
        for to, ln in first_line.items():
            calls.append({'from': fn['id'], 'to': to, 'line': ln})
        # externals
        body = '\n'.join(lines[fn['startLine'] - 1:fn['endLine']])
        for rx, ext in EXTERNAL_RULES:
            mm = rx.search(body)
            if mm:
                ln = fn['startLine'] + body[:mm.start()].count('\n')
                calls.append({'from': fn['id'], 'to': ext, 'line': ln})

    # browser -> routes, startup -> routers, routers -> their routes
    routers = [f for f in functions if f['kind'] == 'router']
    for fn in functions:
        if fn['kind'] == 'route':
            calls.append({'from': 'ext.browser', 'to': fn['id'], 'line': 0})
            owner = next((r for r in routers if r['file'] == fn['file']), None)
            if owner:
                calls.append({'from': owner['id'], 'to': fn['id'], 'line': owner['startLine']})

    # requires (file -> file imports), restricted to files with cards
    card_files = {f['file'] for f in functions}
    requires = sorted({('src/' + a, 'src/' + b) for a, ds in imports.items() for b in ds
                       if 'src/' + a in card_files and 'src/' + b in card_files})
    requires = [{'from': a, 'to': b} for a, b in requires]

    # ---- files & groups
    file_list = sorted(card_files - {'(external)'})
    files_out = [dict(id=p, path=p, dir=os.path.dirname(p), desc=FILE_DESC.get(p, '')) for p in file_list]
    files_out.append(dict(id='(external)', path='(external)', dir='(external)', desc='Outside the repo'))
    file_groups = []
    for d, cols in DIR_COLS:
        for p in sorted(f['path'] for f in files_out if f['dir'] == d):
            title = os.path.basename(p) if p != '(external)' else 'External services'
            file_groups.append(dict(id=p, title=title, desc=FILE_DESC.get(p, ''), col=cols[0], dir=d,
                                    hue=DIR_HUES.get(d, 0x64748b)))

    # ubiquitous imports (drawn faint in files mode)
    counts = {}
    for r in requires:
        counts[r['to']] = counts.get(r['to'], 0) + 1
    ubiquitous = sorted(p for p, n in counts.items() if n >= 10)

    for fn in functions:
        fn.pop('exported', None)

    data = dict(
        repo='nitter', title='nitter', lang='nim', root='nitter',
        files=files_out,
        groups=dict(
            flow=[dict(id=g, col=c, title=t, hue=h, desc=d) for g, c, t, h, d in FLOW_GROUPS],
            files=file_groups,
        ),
        dirs=[dict(dir=d, cols=c, hue=DIR_HUES.get(d, 0x64748b)) for d, c in DIR_COLS],
        functions=functions, calls=calls, links=links, requires=requires, ubiquitous=ubiquitous,
        layout=dict(groupMaxCols=6, groupTargetH=2200, dirTargetH=9000),
    )
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=0, ensure_ascii=False)
    kinds = {}
    for fn in functions:
        kinds[fn['kind']] = kinds.get(fn['kind'], 0) + 1
    print(f'wrote {OUT}: {len(functions)} functions {kinds}, {len(calls)} calls, {len(links)} links, '
          f'{len(requires)} requires, {len(files_out)} files')
    groups = {}
    for fn in functions:
        groups[fn['flowGroup']] = groups.get(fn['flowGroup'], 0) + 1
    print('per group:', groups)


if __name__ == '__main__':
    main()
