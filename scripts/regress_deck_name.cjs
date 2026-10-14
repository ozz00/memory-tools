/**
 * 题集名自动识别回归：验证「TXT 文件名 → 题集名称」的清洗规则
 * （从 pages/admin/index.js 中提取 deckNameFromFileName 源码后单测，避免改动源文件导出）
 *
 * 用法：node scripts/regress_deck_name.cjs
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/admin/index.js'), 'utf8');
const m = src.match(/function deckNameFromFileName[\s\S]*?\n}/);
if (!m) {
  console.log('FAIL 未在 pages/admin/index.js 中找到 deckNameFromFileName');
  process.exit(1);
}
const fn = new Function(m[0] + '; return deckNameFromFileName;')();

let pass = 0, fail = 0;
function eq(name, input, want) {
  const got = fn(input);
  if (got === want) { pass++; console.log('  ok  ' + name + ' => ' + got); }
  else { fail++; console.log('FAIL  ' + name + ' => got "' + got + '" want "' + want + '"'); }
}

eq('普通文件名', '2018绿带考试真题-单选80题.txt', '2018绿带考试真题-单选80题');
eq('去 CAQ__ 前缀', 'CAQ__2018绿带考试真题-单选80题.txt', '2018绿带考试真题-单选80题');
eq('去 note 后缀', 'CAQ__2018绿带考试真题-单选80题note.txt', '2018绿带考试真题-单选80题');
eq('去括号序号', '2018年中质协六西格玛绿带考试真题(1)-单选题.txt', '2018年中质协六西格玛绿带考试真题-单选题');
eq('tsv 扩展名', '2007年黑带考试.tsv', '2007年黑带考试');
eq('空字符串安全', '', '');
eq('null 安全', null, '');
eq('仅扩展名', '.txt', '');

console.log('\n题集名自动识别：通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
