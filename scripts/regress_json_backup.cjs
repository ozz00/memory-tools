/**
 * JSON 备份字段透传回归：验证「导出 → 恢复」不丢 deck / qNo / localImages / 进度
 *
 * 用法：node scripts/regress_json_backup.cjs
 * （项目 package.json 可能是 type:module，脚本内部把 importer.js 复制为临时 .cjs 再 require）
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
function loadImporter() {
  const src = path.join(ROOT, 'miniprogram/utils/importer.js');
  const tmp = path.join(os.tmpdir(), 'caq_importer_' + Date.now() + '.cjs');
  fs.writeFileSync(tmp, fs.readFileSync(src, 'utf8'), 'utf8');
  const mod = require(tmp);
  try { fs.unlinkSync(tmp); } catch (e) {}
  return mod;
}
const importer = loadImporter();

let pass = 0, fail = 0;
function assert(n, c, e) {
  if (c) { pass++; console.log('  ok  ' + n); }
  else { fail++; console.log('FAIL  ' + n + ' => ' + JSON.stringify(e)); }
}

const backup = {
  version: 1,
  cards: [
    {
      id: 'builtin-0001', deck: '2018绿带', qNo: 7,
      front: '(单选)7.题干？', back: '答案：B<br>解析',
      options: ['A. x', 'B. y'], correctAnswer: 'B', cardType: 'single_choice',
      localImages: ['/a/b.png'], tags: ['导入'], stage: 'measure',
      interval: 3, repetitions: 2, easeFactor: 2.5, nextReviewDate: 1, state: 'review'
    },
    {
      id: 'builtin-0002', deck: '2007黑带', qNo: 12,
      front: '第二题？', back: '答案：A',
      options: ['A. x', 'B. y'], correctAnswer: 'A', cardType: 'single_choice',
      tags: [], stage: 'analyze',
      interval: 0, repetitions: 0, easeFactor: 2.5, nextReviewDate: 0, state: 'new'
    }
  ]
};

const r = importer.parseJson(JSON.stringify(backup));
assert('parseJson 成功', r.success && r.cards.length === 2, r.message);
assert('保留 deck（多题集不并成一套）', r.cards[0].deck === '2018绿带' && r.cards[1].deck === '2007黑带', r.cards.map((c) => c.deck));
assert('保留 qNo（原卷题号）', r.cards[0].qNo === 7 && r.cards[1].qNo === 12, r.cards.map((c) => c.qNo));
assert('保留 localImages（手动补图）', r.cards[0].localImages && r.cards[0].localImages[0] === '/a/b.png', r.cards[0].localImages);
assert('保留 id 与学习进度', r.cards[0].id === 'builtin-0001' && r.cards[0].repetitions === 2, r.cards[0]);

const noDeck = importer.parseJson(JSON.stringify({ cards: [{ front: '无题集题', back: '答案：C', options: ['A. 1', 'B. 2', 'C. 3'] }] }));
assert('缺 deck 的卡不报错且 deck 为空', noDeck.success && !noDeck.cards[0].deck, noDeck.cards[0]);

const arr = importer.parseJson(JSON.stringify(backup.cards));
assert('裸数组格式兼容', arr.success && arr.cards.length === 2, arr.message);

console.log('\nJSON 备份字段回归：通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
