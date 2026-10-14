/**
 * 生成内置题库：扫描 Anki 导出 TXT → 用项目 importer 解析 → 产出 miniprogram/data/builtinLocal.js
 *
 * 用法：
 *   node scripts/build_builtin_cards.cjs              # dry-run，只打印统计
 *   node scripts/build_builtin_cards.cjs --write      # 生成内置题库（本地开发用）
 *   node scripts/build_builtin_cards.cjs --clean      # 清空内置题库（提交审核/上传前执行）
 *
 * 【发布开关 / 双形态工作流】
 *   - 本地自用：跑 --write，代码包带全套题，随便刷（不对外传播，无风险）
 *   - 提交发布：跑 --clean，文件变为 ENABLED:false + 空数组，代码包干干净净
 *   - 小程序上传的是「开发者工具本地文件」，与 git 无关，因此开关必须体现在文件内容上，
 *     不能靠 .gitignore（无效）。本脚本同时写入 .gitignore 仅用于避免推到远端仓库。
 *
 * 说明：
 *   - 卡片 id 用稳定的 builtin-<序号>（不用时间戳），保证换设备/更新版本后学习进度能对应
 *   - 按「题干+选项」去重，避免同一题在多份 TXT 里重复
 *   - deck 取自文件名，首页按 deck 分组显示题集
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');

/**
 * 加载 importer：项目 package.json 可能是 type:module，直接 require 项目内 .js 会失败，
 * 故复制到临时目录改扩展名为 .cjs 再 require（源文件不动）。
 */
function loadImporter() {
  const src = path.join(ROOT, 'miniprogram/utils/importer.js');
  const tmp = path.join(os.tmpdir(), 'caq_importer_' + Date.now() + '.cjs');
  fs.writeFileSync(tmp, fs.readFileSync(src, 'utf8'), 'utf8');
  const mod = require(tmp);
  try { fs.unlinkSync(tmp); } catch (e) {}
  return mod;
}
const importer = loadImporter();

const SCAN_DIRS = [
  path.join(os.homedir(), 'Downloads'),
  path.join(os.homedir(), 'Downloads/绿带'),
  path.join(os.homedir(), 'Downloads/Anki-BB2026'),
  path.join(os.homedir(), 'Downloads/PT_seeds')
];

// 明显不是题库的文件
const EXCLUDE = /(backup|codes|discord|zhaozhiyuan)/i;

function collectFiles() {
  const out = [];
  SCAN_DIRS.forEach((dir) => {
    if (!fs.existsSync(dir)) return;
    fs.readdirSync(dir).forEach((name) => {
      if (!/\.txt$/i.test(name)) return;
      if (EXCLUDE.test(name)) return;
      out.push(path.join(dir, name));
    });
  });
  return out;
}

function deckNameOf(file) {
  let n = path.basename(file).replace(/\.txt$/i, '');
  n = n.replace(/^CAQ[_\s]*/i, '').replace(/[_\s]*note$/i, '');
  n = n.replace(/\s*\(\d+\)\s*/g, '');  // 「真题(1)」→「真题」
  return n.trim();
}

/**
 * 题干指纹：剥掉一切非中英文数字的字符（HTML/空格/标点/全角差异全部归一），
 * 再去掉开头的题型标注与题号，取前 40 字。
 * 这样同一题在不同 TXT 副本里（格式、题号前缀不同）也能判为重复。
 */
function normKey(front, options) {
  const strip = (s) => String(s || '').replace(/[^一-龥a-zA-Z0-9]/g, '');
  let q = strip(front).replace(/^(单选题|多选题|不定项选择题|判断题|选择题|单选|多选|不定项|判断)\d*/, '');
  q = q.slice(0, 40);
  const o = strip((options || []).join('')).slice(0, 60);
  return q + '#' + o;
}

function main() {
  const argv = process.argv;
  const write = argv.indexOf('--write') >= 0;
  const clean = argv.indexOf('--clean') >= 0;
  const target = path.join(ROOT, 'miniprogram/data/builtinLocal.js');

  // ── 发布前清空：写成 ENABLED:false + 空数组，代码包内不含任何题目 ──
  if (clean) {
    const empty =
      '/* 内置题库（自动生成，请勿手工编辑）\n' +
      ' * 生成脚本：scripts/build_builtin_cards.cjs\n' +
      ' * 当前状态：已清空（发布模式）—— 代码包内不含任何题目，题库由用户自行导入。\n' +
      ' * 恢复本地题库：node scripts/build_builtin_cards.cjs --write\n' +
      ' */\n' +
      'const ENABLED = false;\n\n' +
      'const BUILTIN_CARDS = [];\n\n' +
      'module.exports = { ENABLED, BUILTIN_CARDS };\n';
    fs.writeFileSync(target, empty, 'utf8');
    console.log('已清空内置题库 => ' + target);
    console.log('当前为【发布模式】：代码包不含题目，可提交审核。');
    console.log('恢复本地题库：node scripts/build_builtin_cards.cjs --write');
    return;
  }

  const files = collectFiles();
  const seen = new Set();
  const cards = [];
  const report = [];

  files.forEach((file) => {
    let text = '';
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch (e) {
      return;
    }
    let r = null;
    try {
      r = importer.parseText(text);
    } catch (e) {
      report.push([path.basename(file), '解析异常 ' + e.message, 0]);
      return;
    }
    if (!r || !r.success || !Array.isArray(r.cards) || !r.cards.length) {
      report.push([path.basename(file), '无可解析卡片', 0]);
      return;
    }
    const deck = deckNameOf(file);
    let added = 0;
    let dup = 0;
    r.cards.forEach((c) => {
      const key = normKey(c.front, c.options);
      if (seen.has(key)) { dup++; return; }
      seen.add(key);
      cards.push({
        id: 'builtin-' + String(cards.length).padStart(4, '0'),
        deck: deck,
        front: c.front,
        back: c.back,
        qNo: c.qNo || undefined,
        options: c.options,
        correctAnswer: c.correctAnswer,
        stage: c.stage || 'overview',
        tags: Array.isArray(c.tags) && c.tags.length ? c.tags : ['内置'],
        cardType: c.cardType || 'flashcard',
        interval: 0,
        repetitions: 0,
        easeFactor: 2.5,
        nextReviewDate: 0,
        state: 'new'
      });
      added++;
    });
    report.push([path.basename(file), 'ok', added, dup]);
  });

  console.log('=== 扫描结果 ===');
  report.forEach((r) => {
    console.log(`  ${r[1] === 'ok' ? '✔' : '✖'} ${r[0]}  新增 ${r[2] || 0} 重复 ${r[3] || 0}`);
  });
  console.log(`\n合计内置卡片：${cards.length} 张`);

  const noAns = cards.filter((c) => !c.correctAnswer).length;
  const noOpt = cards.filter((c) => !c.options || c.options.length < 2).length;
  console.log(`未识别答案：${noAns} 张   选项<2（转问答卡）：${noOpt} 张`);

  const byDeck = {};
  cards.forEach((c) => { byDeck[c.deck] = (byDeck[c.deck] || 0) + 1; });
  console.log('\n按题集：');
  Object.keys(byDeck).forEach((d) => console.log(`  ${d}: ${byDeck[d]} 张`));

  if (!write) {
    if (process.argv.indexOf('--debug') >= 0) {
      const bad = cards.filter((c) => !c.correctAnswer);
      console.log('\n=== 未识别答案样本（front / back 前 160 字）===');
      bad.slice(0, 8).forEach((c, i) => {
        console.log(`\n[${i + 1}] deck=${c.deck}`);
        console.log('  F: ' + String(c.front).slice(0, 100));
        console.log('  B: ' + String(c.back).slice(0, 160));
      });
      const badOpt = cards.filter((c) => !c.options || c.options.length < 2);
      console.log('\n=== 选项<2 样本 ===');
      badOpt.slice(0, 5).forEach((c, i) => {
        console.log(`\n[${i + 1}] deck=${c.deck}`);
        console.log('  F: ' + String(c.front).slice(0, 120));
      });
    }
    console.log('\n[dry-run] 加 --write 才会生成文件');
    return;
  }

  const body = cards
    .map((c) => '  ' + JSON.stringify(c).replace(/"([a-zA-Z]+)":/g, '$1:'))
    .join(',\n');
  const out =
    '/* 内置题库（自动生成，请勿手工编辑）\n' +
    ' * 生成脚本：scripts/build_builtin_cards.cjs\n' +
    ' * 当前状态：已启用（本地自用模式）—— 提交审核前请执行 --clean 清空。\n' +
    ' * 卡片总数：' + cards.length + ' 张\n' +
    ' * 说明：本地 Storage 为空时作为兜底题库；本地已有数据优先使用本地。\n' +
    ' */\n' +
    'const ENABLED = true;\n\n' +
    'const BUILTIN_CARDS = [\n' + body + '\n];\n\n' +
    'module.exports = { ENABLED, BUILTIN_CARDS };\n';

  fs.writeFileSync(target, out, 'utf8');
  const kb = (Buffer.byteLength(out, 'utf8') / 1024).toFixed(0);
  console.log(`\n已写入 ${target}\n体积 ${kb} KB（主包上限 2MB，超过需拆分包）`);
  console.log('当前为【本地自用模式】：请勿直接上传，提交审核前先跑 --clean');

  // 写入 .gitignore：避免真题推到远端仓库（注意：这不影响小程序上传，上传看的是文件内容）
  const gi = path.join(ROOT, '.gitignore');
  const entry = 'miniprogram/data/builtinLocal.js';
  try {
    let cur = fs.existsSync(gi) ? fs.readFileSync(gi, 'utf8') : '';
    if (cur.indexOf(entry) < 0) {
      cur = cur.replace(/\n*$/, '\n') + '\n# 内置题库（本地自用，可能含第三方考题；发布前用 --clean 清空）\n' + entry + '\n';
      fs.writeFileSync(gi, cur, 'utf8');
      console.log('已加入 .gitignore: ' + entry);
    }
  } catch (e) {}
}

main();
