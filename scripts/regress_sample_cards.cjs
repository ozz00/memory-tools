/**
 * 回归：示例卡（miniprogram/data/sampleCards.js）数据质量校验
 *
 * 校验项：数量、id 唯一性与前缀、题干/解析非空、单选题答案与选项一致性、
 *         stage 合法性、无重复题干、deck 统一、必需的学习字段齐全。
 *
 * 运行：node scripts/regress_sample_cards.cjs
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'miniprogram/data/sampleCards.js');
const TMP = path.join(os.tmpdir(), 'caq_sample_' + Date.now() + '.cjs');
fs.copyFileSync(SRC, TMP);
const { SAMPLE_CARDS: cards } = require(TMP);
try { fs.unlinkSync(TMP); } catch (e) {}

const VALID_STAGES = ['overview', 'define', 'measure', 'analyze', 'improve', 'control', 'lean', 'dfss'];

let pass = 0;
let fail = 0;
function assert(name, cond, extra) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('FAIL  ' + name + ' => ' + JSON.stringify(extra).slice(0, 300)); }
}

assert('卡片数量 24 张', cards.length === 24, cards.length);
assert('id 唯一', new Set(cards.map((c) => c.id)).size === cards.length, cards.map((c) => c.id));
assert('id 均为 sample- 前缀', cards.every((c) => String(c.id).indexOf('sample-') === 0), cards.map((c) => c.id).filter((i) => i.indexOf('sample-') !== 0));
assert('题干非空', cards.every((c) => c.front && c.front.trim().length > 4), cards.filter((c) => !c.front).map((c) => c.id));
assert('解析非空且长度合理（>40 字）', cards.every((c) => c.back && c.back.length > 40), cards.filter((c) => !c.back || c.back.length <= 40).map((c) => c.id));

const sc = cards.filter((c) => c.cardType === 'single_choice');
const fc = cards.filter((c) => c.cardType === 'flashcard');
assert('题型分布合理（单选 ≥8、问答 ≥8）', sc.length >= 8 && fc.length >= 8, { sc: sc.length, fc: fc.length });
assert('单选卡均有 options 且 ≥3 项', sc.every((c) => Array.isArray(c.options) && c.options.length >= 3), sc.filter((c) => !c.options || c.options.length < 3).map((c) => c.id));
assert('单选卡答案在选项字母范围内',
  sc.every((c) => /^[A-D]$/.test(c.correctAnswer) && c.options.some((o) => o.indexOf(c.correctAnswer + '.') === 0)),
  sc.filter((c) => !c.options.some((o) => o.indexOf(c.correctAnswer + '.') === 0)).map((c) => c.id));
assert('选项格式统一（"X. " 开头）', sc.every((c) => c.options.every((o) => /^[A-D]\.\s/.test(o))), sc.flatMap((c) => c.options).filter((o) => !/^[A-D]\.\s/.test(o)));
assert('问答卡不带 options', fc.every((c) => !c.options), fc.filter((c) => c.options).map((c) => c.id));

assert('stage 全部合法', cards.every((c) => VALID_STAGES.indexOf(c.stage) >= 0), cards.filter((c) => VALID_STAGES.indexOf(c.stage) < 0).map((c) => c.stage));
assert('stage 覆盖全部 8 个阶段', new Set(cards.map((c) => c.stage)).size === 8, Array.from(new Set(cards.map((c) => c.stage))));
assert('无重复题干', new Set(cards.map((c) => c.front)).size === cards.length, null);
assert('deck 统一为示例题集', new Set(cards.map((c) => c.deck)).size === 1, Array.from(new Set(cards.map((c) => c.deck))));
assert('qNo 连续 1..24', cards.every((c, i) => c.qNo === i + 1), cards.map((c) => c.qNo));
assert('学习字段齐全', cards.every((c) =>
  c.interval === 0 && c.repetitions === 0 && c.easeFactor === 2.5 && c.nextReviewDate === 0 && c.state === 'new'),
  cards.filter((c) => c.interval !== 0 || c.repetitions !== 0 || c.state !== 'new').map((c) => c.id));
assert('全部带 tags', cards.every((c) => Array.isArray(c.tags) && c.tags.length > 0), cards.filter((c) => !c.tags || !c.tags.length).map((c) => c.id));

// 版权自检：不得出现考试真题特征词
const allText = cards.map((c) => c.front + ' ' + c.back + ' ' + (c.options || []).join(' ')).join(' ');
const BANNED = ['中质协', '真题', '押题', '考试答案', '历年考题'];
assert('不含考试真题特征词', BANNED.every((w) => allText.indexOf(w) < 0), BANNED.filter((w) => allText.indexOf(w) >= 0));

console.log('\n示例卡校验：通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
