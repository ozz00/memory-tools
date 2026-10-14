#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""WXML 标签闭合检查

背景：曾因手工编辑 wxml 漏写 </view>，导致「WXML 文件编译错误 expect end-tag
`view`, near `block`」，模拟器直接编译失败、页面白屏。Node 侧回归脚本只测 .js，
覆盖不到 wxml，故补一个纯 Python 的静态检查并接入 run_all.sh。

用法：python3 scripts/check_wxml.py   （退出码 0=全部通过，1=有错）
"""
import glob
import os
import re
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
MINI = os.path.join(ROOT, 'miniprogram')

# 本身就是自闭合或不成对的标签（wxml 中常见）
VOID_TAGS = {'br', 'img', 'image', 'input', 'icon', 'import', 'include',
             'wxs', 'textarea_placeholder', 'slot'}

TAG_RE = re.compile(r'<(/?)([A-Za-z][\w-]*)([^>]*?)(/?)>', re.S)


def check_file(path):
    src = open(path, encoding='utf-8').read()
    stack = []
    errs = []
    for m in TAG_RE.finditer(src):
        close, tag, attrs, selfclose = m.group(1), m.group(2), m.group(3), m.group(4)
        if tag in VOID_TAGS or selfclose == '/':
            continue
        line = src[:m.start()].count('\n') + 1
        if close:
            if not stack:
                errs.append('第 %d 行：多余的 </%s>' % (line, tag))
            elif stack[-1][0] != tag:
                errs.append('第 %d 行：</%s> 与 <%s>（第 %d 行）不匹配'
                            % (line, tag, stack[-1][0], stack[-1][1]))
                stack.pop()
            else:
                stack.pop()
        else:
            stack.append((tag, line))
    if stack:
        errs.append('未闭合：' + ', '.join('<%s> 第 %d 行' % (t, l) for t, l in stack))
    return errs


def main():
    files = sorted(glob.glob(os.path.join(MINI, 'pages', '**', '*.wxml'), recursive=True)
                   + glob.glob(os.path.join(MINI, 'custom-tab-bar', '*.wxml')))
    bad = 0
    for f in files:
        rel = os.path.relpath(f, ROOT)
        errs = check_file(f)
        if errs:
            bad += 1
            print('  FAIL %s' % rel)
            for e in errs[:5]:
                print('       %s' % e)
    print('WXML 标签闭合检查：通过 %d / 失败 %d' % (len(files) - bad, bad))
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
