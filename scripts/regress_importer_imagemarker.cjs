/* 回归：@image 占位标记清理 + 题干前缀引号剥离 + 存量卡自动修复 */
global.wx = {
  getStorageSync: function () { return ''; },
  setStorageSync: function () {},
  removeStorageSync: function () {}
};
const env = require('./_testenv.cjs').resolve();
const { memWx } = require('./_testenv.cjs');
const IMP = env.IMP;
const STO = env.STO;
const importer = require(IMP);
const store = require(STO);

let pass = 0, fail = 0;
function assert(name, cond, extra) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (extra ? ' => ' + JSON.stringify(extra) : '')); }
}

// ── 用例 1：新导入（CSV 包裹 + @image 标记 + 内部转义引号）──
const content = [
  '#separator:tab',
  '#html:true',
  '"@image#1:Clipboard_Screenshot.png @image#2:Clipboard_Screenshot-1.png',
  '""(单选) 9.六西格玛管理强调以（）为关注焦点。',
  '<div>A. 顾客</div><div>B. 过程</div><div>C. 供应商</div><div>D. 员工"\t【答案】A</div>',
  '<div>【解析】六西格玛管理以顾客为关注焦点。"</div>'
].join('\n');
const r1 = importer.parseText(content);
assert('用例1 解析成功', r1.success, r1.message);
const c1 = r1.cards[0];
console.log('  front =>', JSON.stringify(c1.front));
console.log('  options =>', JSON.stringify(c1.options));
assert('用例1 front 无 @image 标记', c1.front.indexOf('@image') < 0, c1.front);
assert('用例1 front 无残留引号', c1.front.indexOf('"') < 0, c1.front);
assert('用例1 front 保留 (单选) 标注', c1.front.indexOf('(单选)') >= 0, c1.front);
assert('用例1 front 含题干本体', /\(单选\)\s*9\.\s*六西格玛管理强调以（）为关注焦点/.test(c1.front), c1.front);
assert('用例1 选项提取 4 项', c1.options && c1.options.length === 4, c1.options);
assert('用例1 答案 A', c1.correctAnswer === 'A', c1.correctAnswer);

// ── 用例 2：纯文本格式 + 标记独立成行 + 行首杂散引号（真实 Anki 布局：题面+选项一列，答案/解析一列）──
const content2 = [
  '@image#1:Clipboard_Screenshot.png',
  '@image#2:Clipboard_Screenshot-1.png',
  '"(单选) 10.关于项目特许任务书，下列说法不正确的是（）。',
  'A. 特许任务书是正式批准项目的文件',
  'B. 特许任务书由项目经理编制',
  'C. 特许任务书明确项目目标',
  'D. 特许任务书指定资源\t【答案】B',
  '解析：项目特许任务书由管理层或发起人发布，不是项目经理编制。'
].join('\n');
const r2 = importer.parseText(content2);
assert('用例2 解析成功', r2.success, r2.message);
const c2 = r2.cards[0];
console.log('  front =>', JSON.stringify(c2.front));
assert('用例2 front 无 @image 标记', c2.front.indexOf('@image') < 0, c2.front);
assert('用例2 front 保留 (单选)/题号、无引号', !/["“]/.test(c2.front) && /\(单选\)/.test(c2.front) && /10\./.test(c2.front), c2.front);
assert('用例2 front 为题干本体', /关于项目特许任务书，下列说法不正确的是（）/.test(c2.front), c2.front);
assert('用例2 选项 4 项', c2.options && c2.options.length === 4, c2.options);
assert('用例2 答案 B', c2.correctAnswer === 'B', c2.correctAnswer);

// ── 用例 3：存量卡自动修复（getCards 内部触发 syncImportedCards）──
const legacy = [{
  id: 'import-1757400000-0-abcd',
  front: '@image#1:Clipboard_Screenshot.png @image#2:Clipboard_Screenshot-1.png "(单选) 9.六西格玛管理强调以（）为关注焦点。',
  back: '【答案】A<br/>【解析】六西格玛管理以顾客为关注焦点。',
  options: ['A. 顾客', 'B. 过程', 'C. 供应商', 'D. 员工'],
  correctAnswer: 'A', cardType: 'single_choice', tags: ['导入'],
  stage: 'overview', interval: 0, repetitions: 0, easeFactor: 2.5,
  nextReviewDate: 0, state: 'new'
}];
// 卡片已改分片存储：预置数据仍写在**旧版单键**上，用来顺带验证 v1→v2 自动迁移；
// 回写断言则一律走「存储语义」而不是某个具体键名（盯着旧键会永远读到空）。
const w3 = memWx(store, { 'caq_6sigma_flashcards_v1': legacy });
global.wx = w3;
const synced = store.getCards();
console.log('  synced front =>', JSON.stringify(synced[0].front));
assert('用例3 存量 front 清除 @image', synced[0].front.indexOf('@image') < 0, synced[0].front);
assert('用例3 存量 front 保留 (单选)/题号、无引号', !/["“]/.test(synced[0].front) && /\(单选\)/.test(synced[0].front) && /9\./.test(synced[0].front), synced[0].front);
assert('用例3 选项保留', JSON.stringify(synced[0].options) === JSON.stringify(legacy[0].options), synced[0].options);
assert('用例3 答案保留', synced[0].correctAnswer === 'A', synced[0].correctAnswer);
assert('用例3 自动迁移到分片（写 meta）', !!w3.mem[store.KEY_CARDS_META], w3.mem[store.KEY_CARDS_META]);
assert('用例3 迁移后旧版单键已删除', !w3.hasLegacyKey(), Object.keys(w3.mem));
assert('用例3 分片内容可拼回且与内存一致', (w3.readCards() || []).length === 1, (w3.readCards() || []).length);

// ── 用例 4：回归保护 — 正常无标记卡片不受影响 ──
const content4 = '(单选) 3.过程能力指数 Cp 用于衡量（）。A. 过程中心偏移 B. 过程固有能力\t【答案】B';
const r4 = importer.parseText(content4);
assert('用例4 解析成功', r4.success, r4.message);
assert('用例4 front 保留前缀含题干', /\(单选\)\s*3\.\s*过程能力指数/.test(r4.cards[0].front), r4.cards[0].front);

// ── 用例 5：合法 HTML 网络图不受影响 ──
const html = '<div>题干</div><img src="https://mmbiz.qpic.cn/abc.jpg">';
assert('用例5 网络图保留', /<img[^>]*mmbiz\.qpic\.cn/.test(importer.cleanHtml(html)), importer.cleanHtml(html));
assert('用例5 htmlToText 转 [图] 占位', importer.htmlToText(html).indexOf('[图]') >= 0, importer.htmlToText(html));

console.log('\n通过 ' + pass + ' / 失败 ' + fail);

// ── 用例 6：内置题库删除 ──
const storageSim = {
  'caq_6sigma_flashcards_v1': [
    { id: 'caq-bb-001', front: '内置卡1', back: 'x', options: ['A. 1', 'B. 2'], correctAnswer: 'A', cardType: 'single_choice', tags: [], stage: 'overview', interval: 0, repetitions: 0, easeFactor: 2.5, nextReviewDate: 0, state: 'new' },
    { id: 'import-1757400000-9-zzzz', front: '导入卡', back: '【答案】A', deck: '2018单选', options: ['A. 1', 'B. 2'], correctAnswer: 'A', cardType: 'single_choice', tags: [], stage: 'overview', interval: 0, repetitions: 0, easeFactor: 2.5, nextReviewDate: 0, state: 'new' }
  ]
};
global.wx = memWx(store, storageSim);
const w6 = global.wx;
const cards6 = store.getCards();
console.log('  内置删除后卡数 =>', cards6.length, 'ids =>', cards6.map(function (c) { return c.id; }).join(','));
assert('用例6 存量内置卡被清除', cards6.length === 1 && cards6[0].id === 'import-1757400000-9-zzzz', cards6.map(function (c) { return c.id; }));
assert('用例6 导入卡保留完整', cards6[0].front === '导入卡' && cards6[0].deck === '2018单选', cards6[0]);
assert('用例6 清除结果回写存储', Array.isArray(w6.readCards()) && w6.readCards().length === 1, w6.readCards() && w6.readCards().length);
const reset6 = store.resetCards();
assert('用例6 resetCards 恢复初始（含示例卡）', Array.isArray(reset6) && reset6.length === 24, reset6 && reset6.length);
const cleared6 = store.clearAllCards();
assert('用例6 clearAllCards 真清空', Array.isArray(cleared6) && cleared6.length === 0, cleared6 && cleared6.length);
const stats6 = store.getStats();
assert('用例6 默认统计无内置引用', stats6.wrongCardIds.length === 0 && stats6.favoriteCardIds.length === 0, stats6);

console.log('\n用例6 追加：通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
