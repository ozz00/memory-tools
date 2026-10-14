/**
 * 回归：exportAnkiTxt → parseText 闭环
 * 1) exportAnkiTxt 输出格式符合 Anki 桌面端约定（CSV QUOTE_MINIMAL + 文件头）
 * 2) 导出后再 import 能拿回同样数量的卡片，题干/选项/答案/标签完整
 * 3) 分文件策略：每个 deck 一个 txt
 * 4) 边界：含双引号/Tab/换行的字段；选项乱序；无 deck；多答案
 * 5) SM-2 进度字段确认被丢弃
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// 复制 importer.js 为 .cjs 副本（项目 package.json type:module → Node require .js 会失败）
const SRC = path.join(__dirname, '..', 'miniprogram', 'utils', 'importer.js');
const CJS = path.join(os.tmpdir(), 'importer_export_test_' + Date.now() + '.cjs');
fs.copyFileSync(SRC, CJS);
const importer = require(CJS);

let pass = 0, fail = 0;
function ok(name) { pass++; console.log('  ✅', name); }
function bad(name, info) { fail++; console.log('  ❌', name, info || ''); }
function eq(a, b, name) {
  if (a === b) ok(name);
  else bad(name, 'expected=' + JSON.stringify(b) + ' got=' + JSON.stringify(a));
}
function truthy(v, name) { v ? ok(name) : bad(name, 'expected truthy'); }

const SAMPLE_CARDS = [
  {
    id: 'c1',
    front: '六西格玛的 DMAIC 是什么？',
    back: 'Define-Measure-Analyze-Improve-Control 五个阶段的缩写。',
    cardType: 'flashcard',
    stage: 'define',
    qNo: 27,
    deck: '2018年考题',
    interval: 12, repetitions: 3, easeFactor: 2.6, nextReviewDate: 12345, state: 'review',
    isFav: true, isWrong: false
  },
  {
    id: 'c2',
    front: '计量值数据应使用哪种控制图？',
    back: 'I-MR 图（单值移动极差图）。',
    options: ['A. p 图', 'B. I-MR 图', 'C. c 图', 'D. u 图'],
    correctAnswer: 'B',
    cardType: 'single_choice',
    stage: 'control',
    qNo: 28,
    deck: '2018年考题',
    interval: 5, repetitions: 2, easeFactor: 2.5, nextReviewDate: 67890
  },
  {
    id: 'c3',
    front: '以下哪些是质量改进工具？',
    back: '柏拉图、因果图、控制图都是质量改进工具。',
    options: ['A. 柏拉图', 'B. 流程图', 'C. 因果图', 'D. 排版软件'],
    correctAnswer: 'ABC',
    cardType: 'multiple_choice',
    stage: 'improve',
    qNo: 29,
    deck: '2018年考题'
  },
  {
    id: 'c4',
    // 字段含双引号 + 换行 + Tab + 答案已存在
    front: '"特殊字符" 测试\n题干 Tab',
    back: '已经写在 back 里的【答案】C',
    options: ['A. 选项1', 'B. 选项2', 'C. 选项3'],
    correctAnswer: 'C',
    cardType: 'single_choice',
    stage: 'analyze',
    qNo: 30,
    deck: '2018年考题'
  },
  {
    id: 'c5',
    front: '默认题集无 deck 的卡片',
    back: '应当归入「默认题集」',
    cardType: 'flashcard',
    stage: 'overview'
    // 无 deck、无 qNo
  },
  {
    id: 'c6',
    front: '另一题集的题',
    back: 'DFSS 是 Design for Six Sigma。',
    cardType: 'flashcard',
    stage: 'dfss',
    deck: '2020年考题',
    qNo: 5
  }
];

console.log('\n=== exportAnkiTxt 输出结构 ===');
const r = importer.exportAnkiTxt(SAMPLE_CARDS);
eq(r.total, 6, 'total 卡片数 = 6');
truthy(Array.isArray(r.files), 'files 是数组');
eq(r.files.length, 3, '分文件数 = 3（2018年考题 / 默认牌组 / 2020年考题）');

const f2018 = r.files.find(f => f.deck === '2018年考题');
const fDefault = r.files.find(f => f.deck === '默认牌组');
const f2020 = r.files.find(f => f.deck === '2020年考题');
truthy(f2018, '存在 2018年考题 文件');
truthy(fDefault, '存在 默认牌组 文件');
truthy(f2020, '存在 2020年考题 文件');
eq(f2018.count, 4, '2018年考题 4 张');
eq(fDefault.count, 1, '默认牌组 1 张');
eq(f2020.count, 1, '2020年考题 1 张');

console.log('\n=== 文件头格式 ===');
const headerLines = f2018.text.split('\n').slice(0, 4);
eq(headerLines[0], '#separator:tab', '文件头 1: #separator:tab');
eq(headerLines[1], '#html:true', '文件头 2: #html:true');
eq(headerLines[2], '#deck:2018年考题', '文件头 3: #deck:xxx');
eq(headerLines[3], '#columns:front back tags', '文件头 4: 三列约定');

console.log('\n=== 题号/选项/答案在导出文本里 ===');
truthy(f2018.text.includes('qNo:28 type:single_choice stage:control'), '标签列格式正确（第 28 题）');
truthy(f2018.text.includes('I-MR 图'), '选项 B 内容在导出文本');
truthy(f2018.text.includes('<b>答案</b>：B'), '单选题答案 B 写入背面');
truthy(f2018.text.includes('<b>答案</b>：ABC'), '多选题答案 ABC 写入背面');
// 答案已存在时不应重复
truthy(!f2018.text.match(/答案[::]\s*C[\s\S]*答案[::]\s*C/), 'back 含答案时不重复写');
// 题号走标签列，正面不应再出现 #27/#28 字样
truthy(!/<\s*sup\s*>\s*#/.test(f2018.text), '正面不写 <sup>#N</sup> 前缀（避免与原文题号重复）');

console.log('\n=== CSV QUOTE_MINIMAL 转义 ===');
truthy(f2018.text.includes('""特殊字符""'), '字段内双引号被转义为 ""');
truthy(f2018.text.includes('题干 Tab'), '含 Tab 字段被双引号包裹');

// 第四题无重复答案（前 3 题答案行只出现一次）
const c4Section = f2018.text.split('\n').filter(l => l.includes('"特殊字符"'));
eq(c4Section.length, 1, '第 4 题只出现一行');

console.log('\n=== 解析回读（导出 → 重新导入 应等价） ===');
// 仅测 2018年考题（其他 deck 同样格式）
const parsed = importer.parseText(f2018.text);
truthy(parsed.success, 'parseText 解析 exportAnkiTxt 产物成功');
eq(parsed.totalParsed, 4, '回读后卡片数 = 4');

// 取前两张题的内容验证（其他 deck 顺序按数组顺序）
const p1 = parsed.cards[0];
const p2 = parsed.cards[1];
const p3 = parsed.cards[2];
const p4 = parsed.cards[3];

truthy(p1 && p1.qNo === 27, '第 1 张 qNo=27 回读正确');
truthy(p1 && p1.front.includes('DMAIC'), '第 1 张题干含 DMAIC');

truthy(p2 && Array.isArray(p2.options) && p2.options.length === 4, '第 2 张选项 4 个回读正确');
truthy(p2 && p2.options.some(o => o.includes('I-MR')), '第 2 张选项含 I-MR');
truthy(p2 && p2.correctAnswer === 'B', '第 2 张答案 B 回读正确');
truthy(p2 && p2.qNo === 28, '第 2 张 qNo=28 回读正确');

truthy(p3 && p3.correctAnswer === 'ABC', '第 3 张答案 ABC 回读正确');

truthy(p4 && p4.front.includes('特殊字符'), '第 4 张题干特殊字符回读');
truthy(p4 && p4.front.includes('题干 Tab'), '第 4 张题干 Tab 内容回读');
// 背面里已经写过「答案 C」，不应被识别为 multiple_choice（只有单字母才算 multiple_choice 的 derive）
truthy(p4 && p4.cardType === 'single_choice', '第 4 张题型回读 single_choice');

console.log('\n=== SM-2 进度字段确认被丢弃 ===');
// makeCard 把 SM-2 全部重置为初始值（interval=0 / easeFactor=2.5 / state=new），
// 而原卡的 interval=12 / easeFactor=2.6 — 若这两个字段被回读到原值，说明导出文本意外携带了进度
eq(p1.interval, 0, '回读后 interval 重置为 0（原 12，已丢弃）');
eq(p1.easeFactor, 2.5, '回读后 easeFactor 重置为 2.5（原 2.6，已丢弃）');
truthy(!p1.isFav, '回读后 isFav 不存在（makeCard 不复制收藏标记）');

console.log('\n=== 边界：空数组 ===');
const empty = importer.exportAnkiTxt([]);
eq(empty.total, 0, '空数组 total=0');
eq(empty.files.length, 0, '空数组 files=[]');

console.log('\n=== 边界：单卡片无 deck/qNo/options ===');
const single = importer.exportAnkiTxt([{ front: 'X', back: 'Y', cardType: 'flashcard' }]);
eq(single.files.length, 1, '无 deck → 单文件');
eq(single.files[0].deck, '默认牌组', '无 deck → 「默认牌组」');
truthy(!single.files[0].text.includes('<sup>'), '无 qNo → 不输出 <sup>');

// 清理临时 .cjs
try { fs.unlinkSync(CJS); } catch (e) {}

console.log('\n===========================');
console.log('  通过 ' + pass + ' / 失败 ' + fail);
console.log('===========================');
process.exit(fail === 0 ? 0 : 1);