const fs = require('fs');
const os = require('os');
const path = require('path');
// 根 package.json 为 type:module，Node 下需复制为 .cjs 才能 require
let richPath = process.env.RICH_PATH;
if (!richPath) {
  richPath = path.join(os.tmpdir(), 'caq_rich_' + Date.now() + '.cjs');
  fs.copyFileSync(path.resolve(__dirname, '../miniprogram/utils/rich.js'), richPath);
}
const rich = require(richPath);
let pass = 0, fail = 0;
function assert(name, cond, extra) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('FAIL  ' + name + ' => ' + JSON.stringify(extra)); }
}

// 用例 A：<a href> 包裹的公众号文章链接
const back1 = '参考<a href="https://mp.weixin.qq.com/s/abcDEF123">一张图彻底搞清楚如何计算DPU，DPO，DPMO，DPPM</a>的讲解。';
const links1 = rich.extractLinks(back1);
assert('A1 提取到 1 条链接', links1.length === 1, links1);
assert('A2 url 正确', links1[0].url === 'https://mp.weixin.qq.com/s/abcDEF123', links1[0]);
assert('A3 标题文本正确', links1[0].text === '一张图彻底搞清楚如何计算DPU，DPO，DPMO，DPPM', links1[0]);
const nodes1 = rich.toNodes(back1);
var anchorText = JSON.stringify(nodes1);
assert('A4 锚点渲染为链接样式', anchorText.indexOf('color:#2563eb') >= 0 && anchorText.indexOf('underline') >= 0, anchorText.slice(0, 200));

// 用例 B：裸 URL（无 <a> 包裹）
const back2 = '参考文章：https://mp.weixin.qq.com/s/xyz789。<br/>完';
const links2 = rich.extractLinks(back2);
assert('B1 裸 URL 提取', links2.length === 1 && links2[0].url === 'https://mp.weixin.qq.com/s/xyz789', links2);

// 用例 C：混合 + 去重
const back3 = '<a href="https://mp.weixin.qq.com/s/abcDEF123">DPU 一张图</a>与 https://github.com/x/y 及 <a href="https://mp.weixin.qq.com/s/abcDEF123">重复链接</a>';
const links3 = rich.extractLinks(back3);
assert('C1 去重后 2 条', links3.length === 2, links3);
assert('C2 顺序保持', links3[0].url === 'https://mp.weixin.qq.com/s/abcDEF123' && links3[1].url === 'https://github.com/x/y', links3);

// 用例 D：无链接不显示入口
assert('D1 无链接返回空数组', rich.extractLinks('纯文本背面，没有任何链接').length === 0);
assert('D2 空值安全', rich.extractLinks('').length === 0 && rich.extractLinks(null).length === 0);

// 用例 E：单引号 href + 锚内嵌套标签
const back4 = "<a href='https://mp.weixin.qq.com/s/qwerty'>【<b>必读</b>】DPMO 计算详解</a>";
const links4 = rich.extractLinks(back4);
assert('E1 单引号 href 提取', links4.length === 1 && links4[0].url === 'https://mp.weixin.qq.com/s/qwerty', links4);
assert('E2 嵌套标签剥净取文案', links4[0].text === '【必读】DPMO 计算详解', links4[0]);

console.log('\n链接提取回归：通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
