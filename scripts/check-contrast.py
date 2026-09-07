# Generated from devondoes/ds/lint/check-contrast.py — do not edit here.
# Edit the source and run `node ds/sync.mjs`. `--check` fails on drift.
#!/usr/bin/env python3
"""Score the token palette instead of eyeballing it.

Written because a --muted that shipped in Mise for months sat at 3.31:1 — under
the 4.5 normal text needs — and was used 38 times. An entire layer of the
interface read as washed out and nobody could say why. Eyes adapt; ratios do not.

Checks every text-on-ground pair the contract implies, in BOTH themes:

    --ink, --muted   on --bg and --surface     need 4.5 (normal text)
    --accent, --ok, --danger on --bg           need 4.5 (they carry meaning)
    --accent-ink     on --accent               need 4.5 (text on a button)
    --faint          on --bg                   need 3.0, and only 3.0 —
                                               it is documented as optional
                                               metadata, never body text.

Usage: python lint/check-contrast.py tokens.css
"""
import re
import sys


def parse(css: str) -> tuple[dict, dict]:
    """Light is bare :root; dark is the [data-theme='dark'] block, which the
    contract requires to be a complete restatement rather than a patch."""
    def block(pattern: str) -> dict:
        m = re.search(pattern + r"\s*\{(.*?)\n\}", css, re.S | re.M)
        if not m:
            return {}
        return {k: v.strip() for k, v in re.findall(r"(--[\w-]+)\s*:\s*([^;]+);", m.group(1))}
    light = block(r"^:root")
    dark = block(r"^:root\[data-theme='dark'\]")
    # Dark inherits anything it does not restate.
    return light, {**light, **dark}


def rgb(value: str):
    v = value.strip().lstrip("#")
    if len(v) == 3:
        v = "".join(c * 2 for c in v)
    if len(v) != 6 or not re.fullmatch(r"[0-9a-fA-F]{6}", v):
        return None  # rgba(), a gradient, a shadow — not a flat colour
    return tuple(int(v[i:i + 2], 16) for i in (0, 2, 4))


def luminance(c) -> float:
    def channel(x):
        x /= 255
        return x / 12.92 if x <= 0.03928 else ((x + 0.055) / 1.055) ** 2.4
    r, g, b = (channel(v) for v in c)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def ratio(fg, bg) -> float:
    a, b = luminance(fg), luminance(bg)
    hi, lo = max(a, b), min(a, b)
    return (hi + 0.05) / (lo + 0.05)


PAIRS = [
    ("--ink", "--bg", 4.5), ("--ink", "--surface", 4.5),
    ("--muted", "--bg", 4.5), ("--muted", "--surface", 4.5),
    ("--accent", "--bg", 4.5), ("--accent-deep", "--bg", 4.5),
    ("--ok", "--bg", 4.5), ("--danger", "--bg", 4.5),
    ("--accent-ink", "--accent", 4.5),
    ("--notice-ink", "--notice-bg", 4.5),
    ("--faint", "--bg", 3.0),
]


def main() -> int:
    path = sys.argv[1] if len(sys.argv) > 1 else "tokens.css"
    with open(path, encoding="utf-8") as fh:
        light, dark = parse(fh.read())

    failed = 0
    for name, tokens in (("light", light), ("dark", dark)):
        for fg, bg, need in PAIRS:
            a, b = rgb(tokens.get(fg, "")), rgb(tokens.get(bg, ""))
            if not a or not b:
                print(f"  ?      {name:<5} {fg} on {bg} — not a flat colour, skipped")
                continue
            r = ratio(a, b)
            ok = r >= need
            failed += not ok
            print(f"  {'PASS' if ok else 'FAIL':<6} {name:<5} {fg:<14} on {bg:<12} "
                  f"{r:5.2f}:1  (needs {need})")

    if failed:
        print(f"\n{failed} pair(s) below the threshold. Darken the foreground, or "
              f"say why the pair is exempt.")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
