/**
 * 「确认导入」按钮的交互约束回归（静态，无需 IDE）
 *
 * 背景（2026-09-12 真机反馈）：
 *   ① 按钮原先带 `disabled` 属性 ⇒ <button disabled> **不派发 bindtap**，
 *      点上去毫无反应，用户误判「按钮坏了」；
 *   ② 更严重的是 txt 标签的文本框允许手动粘贴 Anki TXT（placeholder 就是这么写的），
 *      但该标签没有任何解析入口 ⇒ parseResult 永远为空 ⇒ 按钮永远置灰 ⇒ **粘贴路径是死路**。
 *
 * 修复结论（本脚本守护之）：
 *   - 不用 `disabled` 拦截，改用视觉弱化 class `is-disabled`，按钮**始终可点**；
 *   - 点击时在 handler 里给出「为什么不能导入 + 下一步做什么」；
 *   - 文本框有内容却未解析 ⇒ **就地解析**，打通手动粘贴路径。
 *
 * 行为级验证见 scripts/verify_confirm_import_live.cjs（需 IDE 自动化端口）。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const WXML = path.join(ROOT, 'miniprogram/pages/admin/index.wxml');
const WXSS = path.join(ROOT, 'miniprogram/pages/admin/index.wxss');
const JS = path.join(ROOT, 'miniprogram/pages/admin/index.js');

let pass = 0, fail = 0;
const check = (n, c, d) => {
  if (c) { pass++; console.log('  ok  ' + n + (d !== undefined ? '  [' + d + ']' : '')); }
  else { fail++; console.log('FAIL  ' + n + (d !== undefined ? '  [' + d + ']' : '')); }
};

const wxml = fs.readFileSync(WXML, 'utf8');
const wxss = fs.readFileSync(WXSS, 'utf8');
const js = fs.readFileSync(JS, 'utf8');

/* 取「确认导入」按钮那一行（去掉 HTML 注释，避免注释里的字样造成假命中） */
const wxmlNoComment = wxml.replace(/<!--[\s\S]*?-->/g, '');
const btnLine = wxmlNoComment.split('\n').find((l) => l.includes('确认导入') && l.includes('<button'));

console.log('── 1. WXML：按钮自身 ──');
check('1.1 找到「确认导入」按钮', !!btnLine);
check('1.2 按钮**不带** disabled 属性（disabled 会吞掉 tap）',
  !!btnLine && !/\sdisabled\s*=/.test(btnLine),
  btnLine && (/\sdisabled\s*=/.test(btnLine) ? '🔴 仍含 disabled= 属性' : '仅 is-disabled 弱化类，无禁用属性'));
check('1.3 仍绑定 confirmImport', !!btnLine && /bindtap\s*=\s*"confirmImport"/.test(btnLine));
check('1.4 用 is-disabled 做视觉弱化（而非禁用交互）',
  !!btnLine && /is-disabled/.test(btnLine));

console.log('\n── 2. WXSS：弱化态样式存在 ──');
check('2.1 定义了 .action-bar-fixed .action-btn.is-disabled',
  /\.action-bar-fixed\s+\.action-btn\.is-disabled\s*\{/.test(wxss));

console.log('\n── 3. JS：confirmImport 的反馈与补解析 ──');
const cm = js.slice(js.indexOf('confirmImport()'));
const body = cm.slice(0, cm.indexOf('\n  },') + 1 || 4000);
check('3.1 注释中写明了「disabled 会吞掉 tap」这一取舍（防后人改回去）',
  /disabled/.test(body) && /bindtap|派发/.test(body), '存在说明性注释');
check('3.2 空文本框时给出 toast（不是静默 return）',
  /if\s*\(!text\)\s*\{[\s\S]{0,400}?wx\.showToast/.test(body));
check('3.3 文本框有内容时**就地解析**（importer.parseText）',
  /r\s*=\s*importer\.parseText\(/.test(body));
check('3.4 解析失败时用 showModal 说明格式问题并 return（不静默导入）',
  /wx\.showModal[\s\S]{0,400}?return;/.test(body));

console.log('\n确认导入按钮交互约束：通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
