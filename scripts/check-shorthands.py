# Generated from devondoes/ds/lint/check-shorthands.py — do not edit here.
# Edit the source and run `node ds/sync.mjs`. `--check` fails on drift.
"""
Find CSS shorthands that silently reset a longhand set earlier for the same
selector.

This is the class of bug that made the list name wrap: `.list-pick-name` set
`white-space: nowrap` in one rule, and a later rule for the same selector set
`text-wrap: balance` — which is a sub-property of the `white-space` shorthand,
so it reset the wrapping mode. Nothing errors, nothing looks wrong in the
source, and the symptom appears somewhere else entirely.

Grepping for the property name cannot find these, because the two declarations
do not mention each other. What matters is: for one selector, in document
order, does a shorthand appear AFTER a longhand it would reset, without
restating it?
"""
import re
import sys
from collections import defaultdict

# shorthand -> the longhands it resets to initial when it does not name them.
RESETS = {
    'white-space': ['text-wrap', 'text-wrap-mode', 'text-wrap-style', 'white-space-collapse'],
    'text-wrap': ['white-space', 'text-wrap-mode', 'text-wrap-style'],
    'background': ['background-color', 'background-image', 'background-position',
                   'background-size', 'background-repeat', 'background-attachment',
                   'background-clip', 'background-origin'],
    'font': ['font-size', 'font-family', 'font-weight', 'font-style',
             'font-variant', 'line-height', 'font-stretch'],
    'border': ['border-width', 'border-style', 'border-color', 'border-top',
               'border-right', 'border-bottom', 'border-left'],
    'border-radius': ['border-top-left-radius', 'border-top-right-radius',
                      'border-bottom-left-radius', 'border-bottom-right-radius'],
    'inset': ['top', 'right', 'bottom', 'left'],
    'flex': ['flex-grow', 'flex-shrink', 'flex-basis'],
    'grid-area': ['grid-row', 'grid-column', 'grid-row-start', 'grid-column-start'],
    'animation': ['animation-name', 'animation-duration', 'animation-timing-function',
                  'animation-delay', 'animation-iteration-count', 'animation-direction',
                  'animation-fill-mode', 'animation-play-state'],
    'transition': ['transition-property', 'transition-duration',
                   'transition-timing-function', 'transition-delay'],
    'overflow': ['overflow-x', 'overflow-y'],
    'place-items': ['align-items', 'justify-items'],
    'gap': ['row-gap', 'column-gap'],
    'padding': ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'],
    'margin': ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'],
    'mask': ['mask-image', 'mask-size', 'mask-repeat', 'mask-position'],
}
# The reverse: which shorthand owns a longhand.
OWNER = defaultdict(list)
for sh, longs in RESETS.items():
    for lg in longs:
        OWNER[lg].append(sh)

path = sys.argv[1]
css = open(path, encoding='utf-8').read()
css = re.sub(r'/\*.*?\*/', '', css, flags=re.S)

# Flat scan of `selector { decls }`, tracking the enclosing at-rule so rules in
# different media are not compared as if they always coexist.
rules = []
i = 0
context = []
while i < len(css):
    at = re.compile(r'@[\w-]+[^{]*\{').match(css, i)
    if at:
        context.append(at.group(0).strip())
        i = at.end()
        continue
    if css[i] == '}':
        if context:
            context.pop()
        i += 1
        continue
    m = re.compile(r'([^{}@]+)\{([^{}]*)\}', re.S).match(css, i)
    if not m:
        i += 1
        continue
    for sel in m.group(1).split(','):
        sel = ' '.join(sel.split())
        if sel:
            # The body's absolute offset, so each declaration inside it can be
            # given its own position. Using the RULE's position for all of them
            # made "is this restated afterwards?" unanswerable within a rule,
            # which is where restating actually happens.
            rules.append((sel, m.group(2), tuple(context), m.start(2)))
    i = m.end()

by_sel = defaultdict(list)
for sel, body, ctx, body_start in rules:
    offset = 0
    for d in body.split(';'):
        pos = body_start + offset
        offset += len(d) + 1
        if ':' not in d:
            continue
        prop, val = d.split(':', 1)
        prop = prop.strip().lower()
        if prop.startswith('--') or not prop:
            continue
        by_sel[sel].append((pos, prop, val.strip(), ctx))

problems = []
for sel, decls in by_sel.items():
    decls.sort(key=lambda d: d[0])
    seen_longhand = {}          # longhand -> (pos, ctx)
    for pos, prop, val, ctx in decls:
        for sh in OWNER.get(prop, []):
            seen_longhand.setdefault((sh, prop), (pos, ctx))
        if prop in RESETS:
            for lg in RESETS[prop]:
                key = (prop, lg)
                if key in seen_longhand:
                    earlier_pos, earlier_ctx = seen_longhand[key]
                    if earlier_pos >= pos:
                        continue
                    # Only a real conflict if the later shorthand does not
                    # restate the value, and both can apply together.
                    if earlier_ctx != ctx and earlier_ctx and ctx:
                        continue
                    # Resolved if the longhand is restated AFTER the
                    # shorthand — the normal, correct way to write this. A tool
                    # that reports those as faults is a tool nobody runs.
                    restated = any(
                        p2 > pos and pr2 == lg for p2, pr2, _v, _c in decls
                    )
                    if not restated:
                        problems.append((sel, lg, earlier_pos, prop, val, pos))

if not problems:
    print('  no shorthand/longhand conflicts found')
else:
    print(f'  {len(problems)} potential conflict(s):')
    for sel, lg, epos, sh, val, pos in problems:
        eline = css[:epos].count('\n') + 1
        line = css[:pos].count('\n') + 1
        print(f'    {sel}')
        print(f'      line {eline}: {lg} ... then line {line}: {sh}: {val}')
