#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
gen_frontmatter.py - 从 templater 模板生成 Obsidian 标准 frontmatter
Python 2.7 / 3.x 兼容。

用法:
  python gen_frontmatter.py --source 日常/undolog.md --link "什么时候发生Crash"
  python gen_frontmatter.py --source 日常/undolog.md --link "什么时候发生Crash" --locate

修复历史:
  - stdout / argv 编码在 Windows 中文环境下乱码 (cp936 vs utf-8)
  - Py2 下 str vs unicode 比较触发 UnicodeWarning，导致 find_sources 静默失败
  - 解决方案：启动时统一 stdout 到 utf-8；argv 入口用 bytes 解码；find_sources
    内 str/unicode 比较前显式转 unicode，并捕获 UnicodeWarning 容错
"""

import codecs
import json
import os
import re
import sys
from datetime import datetime

# ---------- Py2/Py3 兼容辅助 ----------
try:
    string_types = (str, unicode)  # Py2
    unicode_type = unicode
    bytes_type = str
except NameError:
    string_types = (str,)  # Py3
    unicode_type = str
    bytes_type = bytes

ILLEGAL = re.compile(r'[*"\\/<>:\|?]')
WIKI = re.compile(r'\[\[([^\]]+)\]\]')


def _to_unicode(s, encoding=None):
    """Py2: str(可能 cp936/utf-8) -> unicode; Py3: 原样返回."""
    if s is None:
        return u''
    if isinstance(s, unicode_type):
        return s
    if not encoding:
        # 优先 utf-8, 再 fallback 到 cp936 (Windows 中文 cmdline 默认)
        for enc in ('utf-8', 'cp936', 'gbk'):
            try:
                return s.decode(enc)
            except (UnicodeDecodeError, AttributeError):
                continue
        return s.decode('utf-8', errors='replace')
    return s.decode(encoding, errors='replace')


def _setup_stdout():
    """让 print 出来的中文不乱码: Py2 重写 stdout, Py3 reconfigure."""
    try:
        # Py3.7+
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except (AttributeError, Exception):
        pass
    if sys.version_info[0] == 2:
        # Py2: sys.stdout 默认不带 encoding, print u'中文' 会爆 UnicodeEncodeError
        try:
            sys.stdout = codecs.getwriter('utf-8')(sys.stdout, errors='replace')
        except Exception:
            pass


# ---------- 路径与文件 ----------
def find_vault_root(start):
    p = os.path.abspath(start)
    while True:
        if os.path.isdir(os.path.join(p, '.obsidian')):
            return p
        if os.path.isfile(os.path.join(p, 'ctl', 'tmpl_frontmatter_meta.md')):
            return p
        parent = os.path.dirname(p)
        if parent == p:
            raise RuntimeError('cannot find vault root')
        p = parent


def read_file(path):
    """read file with utf-8, py2/3 compatible; fallback to cp936 on decode error."""
    with open(path, 'rb') as f:
        data = f.read()
    for enc in ('utf-8-sig', 'utf-8', 'cp936', 'gbk'):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return data.decode('utf-8', errors='replace')


def write_file(path, text):
    with open(path, 'wb') as f:
        f.write(text.encode('utf-8'))


# ---------- 源文件定位 ----------
def find_sources(vault, link_text):
    """找到所有引用了 [[link_text]] 的 markdown 文件."""
    link_text_u = _to_unicode(link_text)  # 统一 unicode
    hits = []
    for root, dirs, files in os.walk(vault):
        dirs[:] = [d for d in dirs if not d.startswith('.') and d != '.git']
        for f in sorted(files):
            if not f.endswith('.md'):
                continue
            fpath = os.path.join(root, f)
            rel = os.path.relpath(fpath, vault).replace('\\', '/')
            if rel.startswith('ctl/'):
                continue
            try:
                content = read_file(fpath)
            except Exception:
                continue
            for i, line in enumerate(content.split('\n'), 1):
                for m in WIKI.finditer(line):
                    resolved = _to_unicode(
                        m.group(1).split('#')[0].split('|')[0]
                    ).strip()
                    # Py2 str/unicode 比较: 先用 try, 失败再逐个转 unicode
                    matched = False
                    try:
                        matched = (resolved == link_text_u)
                    except UnicodeWarning:
                        # 编码不一致: 强制转 unicode 再比
                        matched = (
                            _to_unicode(resolved) == _to_unicode(link_text_u)
                        )
                    if matched:
                        hits.append({'file': rel, 'line': i})
    return hits


# ---------- 模板解析 ----------
def read_template_keys(tpath):
    try:
        content = read_file(tpath)
    except Exception:
        return ['creatime', 'tags', 'bklink']
    m = re.search(r'---\n(.+?)\n---', content, re.DOTALL)
    if m:
        keys = []
        for line in m.group(1).split('\n'):
            line = line.strip().lstrip('*').strip()
            if line and ':' in line:
                keys.append(line.split(':')[0].strip())
        if keys:
            return keys
    return ['creatime', 'tags', 'bklink']


# ---------- 文件名清理 ----------
def sanitize(raw):
    name = ILLEGAL.sub('', raw).strip().strip('.')
    name = re.sub(r' {2,}', ' ', name)
    if not name:
        name = 'unresolved-%d' % (abs(hash(raw)) % 10000)
    return name


# ---------- 模板键同义映射 ----------
_BKLINK_ALIASES = ('bklink', 'backlinks', 'backlink', 'aliases')
_TIME_ALIASES = ('creatime', 'created', 'create_time', 'date')
_TAG_ALIASES = ('tags', 'tag')


def gen_frontmatter(keys, bklink_entries):
    now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    # Py2: 全用 unicode 字面量/u 前缀, 避免最后一段是 str 触发 ASCII 编码
    lines = [u'---']
    for key in keys:
        # key 来自 read_file 已是 unicode, 这里仍兜底一次
        key = _to_unicode(key) if isinstance(key, bytes_type) else key
        k = key.lower()
        if k in _TIME_ALIASES:
            lines.append(u'%s: %s' % (key, now))
        elif k in _TAG_ALIASES:
            lines.append(u'%s: []' % key)
        elif k in _BKLINK_ALIASES:
            if bklink_entries:
                lines.append(u'%s:' % key)
                seen = set()
                for entry in bklink_entries:
                    stem = _to_unicode(os.path.splitext(os.path.basename(entry))[0])
                    if stem not in seen:
                        seen.add(stem)
                        lines.append(u'  - "[[%s]]"' % stem)
            else:
                lines.append(u'%s: []' % key)
        else:
            lines.append(u'%s:' % key)
    lines.append(u'---')
    return u'\n'.join(lines)


# ---------- 入口 ----------
def main():
    _setup_stdout()

    if '--source' in sys.argv:
        src_idx = sys.argv.index('--source')
        source = sys.argv[src_idx + 1] if src_idx + 1 < len(sys.argv) else None
    else:
        source = None
    if '--link' in sys.argv:
        link_idx = sys.argv.index('--link')
        link = sys.argv[link_idx + 1] if link_idx + 1 < len(sys.argv) else None
    else:
        link = None
    if not link:
        print('usage: gen_frontmatter.py --link <link> [--source <file>] [--locate]')
        sys.exit(1)

    # Py2: sys.argv 是 GBK str, 转 unicode 后 vault 路径才能用
    source_u = _to_unicode(source)
    link_u = _to_unicode(link)

    # Py2 下 os.path 返回 str (cp936 bytes), 必须转 unicode 才能安全拼接
    if sys.version_info[0] == 2:
        try:
            sys.setdefaultencoding('utf-8')
        except Exception:
            pass

    locate = '--locate' in sys.argv
    vault = _to_unicode(find_vault_root(os.getcwd()))
    tpl = os.path.join(_to_unicode(vault), 'ctl', 'tmpl_frontmatter_meta.md')
    keys = read_template_keys(tpl)
    safe = sanitize(link_u)

    print(u'. vault: %s' % vault)
    print(u'. frontmatter keys: %s' % keys)
    print(u'. filename: %s.md' % safe)

    bklink_entries = []
    if source_u:
        stem = os.path.splitext(os.path.basename(source_u))[0]
        bklink_entries.append(stem)
    if locate or not source_u:
        sources = find_sources(vault, link_u)
        for s in sources:
            stem = os.path.splitext(os.path.basename(_to_unicode(s['file'])))[0]
            if stem not in bklink_entries:
                bklink_entries.append(stem)
            print(u'. source: %s:%d' % (_to_unicode(s['file']), s['line']))

    print(gen_frontmatter(keys, bklink_entries))


if __name__ == '__main__':
    main()
