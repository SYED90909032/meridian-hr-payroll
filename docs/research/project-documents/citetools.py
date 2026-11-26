#!/usr/bin/env python3
"""Assemble research markdown files into one dossier with globally renumbered citations."""
import re
import sys

DEF_RE = re.compile(
    r'^\s*(?:[-*]\s*)?\[(\d+)\]:\s*<?(\S+?)>?\s*(?:"([^"]*)"|\'([^\']*)\'|\(([^)]*)\))?\s*$'
)
REF_HEAD_RE = re.compile(r'^#{1,6}\s+\**(References|Sources|Reference list)\**\s*:?\s*$', re.I)
CITE_RE = re.compile(r'\[(\d+(?:\s*[,\u2013-]\s*\d+)*)\](?![(:\[])')


class Refs:
    def __init__(self):
        self.by_url = {}
        self.items = []

    def add(self, url, title):
        url = url.strip().replace('(', '%28').replace(')', '%29')
        key = url.rstrip('/').lower()
        if key in self.by_url:
            return self.by_url[key]
        n = len(self.items) + 1
        self.by_url[key] = n
        title = (title or '').strip() or url
        title = title.replace('"', "'").replace('(', '- ').replace(')', '')
        title = re.sub(r'\s+', ' ', title)
        self.items.append((n, url, title))
        return n

    def render(self):
        return '\n'.join(f'[{n}]: {u} "{t}"' for n, u, t in self.items)


def expand(token):
    nums = []
    for part in re.split(r'\s*,\s*', token):
        m = re.match(r'^(\d+)\s*[\u2013-]\s*(\d+)$', part)
        if m:
            a, b = int(m.group(1)), int(m.group(2))
            if 0 < b - a < 30:
                nums.extend(range(a, b + 1))
                continue
        if part.strip().isdigit():
            nums.append(int(part))
    return nums


def process(text, refs, demote=0, stats=None):
    lines = text.split('\n')
    local = {}
    body = []
    in_refs = False
    in_code = False
    for ln in lines:
        if ln.strip().startswith('```'):
            in_code = not in_code
        m = DEF_RE.match(ln) if not in_code else None
        if m:
            n = int(m.group(1))
            title = m.group(3) or m.group(4) or m.group(5) or ''
            local[n] = (m.group(2), title)
            continue
        if not in_code and REF_HEAD_RE.match(ln.strip()):
            in_refs = True
            continue
        if in_refs:
            if re.match(r'^#{1,6}\s', ln):
                in_refs = False
            else:
                mm = re.match(r'^\s*(?:\[(\d+)\]|(\d+)[.)])\s*(.*)$', ln)
                if mm:
                    n = int(mm.group(1) or mm.group(2))
                    rest = mm.group(3)
                    um = re.search(r'\((https?://[^)\s]+)\)', rest) or re.search(r'(https?://\S+)', rest)
                    if um:
                        url = um.group(1).rstrip('.,;')
                        title = re.sub(r'\(https?://[^)]+\)|https?://\S+', '', rest)
                        title = title.replace('[', '').replace(']', '').strip(' -:"*')
                        local.setdefault(n, (url, title))
                continue
        body.append(ln)

    mapping = {}
    out = []
    in_code = False
    for ln in body:
        if ln.strip().startswith('```'):
            in_code = not in_code
            out.append(ln)
            continue
        if in_code:
            out.append(ln)
            continue
        if demote and re.match(r'^#{1,6}\s', ln):
            hashes = len(ln) - len(ln.lstrip('#'))
            ln = '#' * min(6, hashes + demote) + ln[hashes:]

        def repl(mt):
            nums = expand(mt.group(1))
            if not nums:
                return mt.group(0)
            parts = []
            for n in nums:
                if n not in local:
                    if stats is not None:
                        stats['missing'] += 1
                    continue
                if n not in mapping:
                    mapping[n] = refs.add(*local[n])
                parts.append(f'[{mapping[n]}]')
            return ' '.join(parts)

        ln = CITE_RE.sub(repl, ln)
        ln = re.sub(r'\](\[\d+\])', r'] \1', ln)
        out.append(ln)
    text_out = '\n'.join(out).strip('\n')
    text_out = re.sub(r'\n{3,}', '\n\n', text_out)
    return text_out


if __name__ == '__main__':
    print('module only', file=sys.stderr)
