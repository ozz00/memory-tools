/**
 * 回归：内置题库与 store 的集成（本地优先 / 内置兜底 / 不被 removeBuiltIns 误删）
 *
 * 用法：node scripts/regress_builtin_store.cjs
 *
 * 说明：根 package.json 为 type:module，Node 下 require('.js') 会被当 ESM，
 *      故统一复制到临时目录改 .cjs 再加载（源文件不动，builtinLocal.js 也不动）。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'caq_bstore_'));

const IMP = path.join(T, 'importer.cjs');
const DC = path.join(T, 'defaultCards.cjs');
const BL = path.join(T, 'builtinLocal.cjs');
const SC = path.join(T, 'sampleCards.cjs');
const STO = path.join(T, 'store.cjs');
const CS = path.join(T, 'cardShards.cjs');

fs.copyFileSync(path.join(ROOT, 'miniprogram/utils/importer.js'), IMP);
fs.copyFileSync(path.join(ROOT, 'miniprogram/data/builtinLocal.js'), BL);
fs.copyFileSync(path.join(ROOT, 'miniprogram/data/sampleCards.js'), SC);
fs.copyFileSync(path.join(ROOT, 'miniprogram/utils/cardShards.js'), CS);
fs.writeFileSync(
  DC,
  fs.readFileSync(path.join(ROOT, 'miniprogram/data/defaultCards.js'), 'utf8')
    .replace(/require\('\.\/builtinLocal\.js'\)/, "require('" + BL.replace(/\\/g, '/') + "')")
    .replace(/require\('\.\/sampleCards\.js'\)/, "require('" + SC.replace(/\\/g, '/') + "')"),
  'utf8'
);
fs.writeFileSync(
  STO,
  fs.readFileSync(path.join(ROOT, 'miniprogram/utils/store.js'), 'utf8')
    .replace(/require\('\.\/importer\.js'\)/, "require('" + IMP.replace(/\\/g, '/') + "')")
    .replace(/require\('\.\/cardShards\.js'\)/, "require('" + CS.replace(/\\/g, '/') + "')")
    .replace(/require\('\.\.\/data\/defaultCards\.js'\)/, "require('" + DC.replace(/\\/g, '/') + "')"),
  'utf8'
);

const builtinsOf = (arr) => (arr || []).filter((c) => String(c.id).indexOf('builtin-') === 0);

let pass = 0;
let fail = 0;
function assert(n, c, e) {
  if (c) { pass++; console.log('  ok  ' + n); }
  else { fail++; console.log('FAIL  ' + n + ' => ' + JSON.stringify(e)); }
}

function setBuiltin(content) {
  fs.writeFileSync(BL, content, 'utf8');
  [STO, DC, BL, IMP].forEach((p) => { try { delete require.cache[require.resolve(p)]; } catch (e) {} });
}

function freshStore() {
  const mem = {};
  global.wx = {
    getStorageSync: (k) => mem[k] || '',
    setStorageSync: (k, v) => { mem[k] = v; },
    removeStorageSync: (k) => { delete mem[k]; }
  };
  [STO, DC, BL, IMP].forEach((p) => { try { delete require.cache[require.resolve(p)]; } catch (e) {} });
  return require(STO);
}

const CARD = (id) => ({
  id: id, deck: '本地题集', front: '题干' + id, back: '答案：A',
  options: ['A. x', 'B. y'], correctAnswer: 'A', cardType: 'single_choice',
  tags: ['内置'], stage: 'measure', interval: 0, repetitions: 0,
  easeFactor: 2.5, nextReviewDate: 0, state: 'new'
});

try {
  // ── A：发布模式（ENABLED:false）→ 空库 ──
  setBuiltin('const ENABLED = false;\nconst BUILTIN_CARDS = [];\nmodule.exports = { ENABLED, BUILTIN_CARDS };\n');
  const a1 = freshStore().getCards();
  assert('A 发布模式无内置卡', builtinsOf(a1).length === 0, builtinsOf(a1).length);
  assert('A 发布模式保留示例卡（供审核体验）', a1.length === 24 && a1.every((c) => String(c.id).indexOf('sample-') === 0), a1.length);

  // ── B：自用模式 + Storage 空 → 使用内置卡 ──
  setBuiltin('const ENABLED = true;\nconst BUILTIN_CARDS = [\n' +
    '  ' + JSON.stringify(CARD('builtin-0001')) + ',\n' +
    '  ' + JSON.stringify(CARD('builtin-0002')) + '\n' +
    '];\nmodule.exports = { ENABLED, BUILTIN_CARDS };\n');
  let all = freshStore().getCards();
  let cards = builtinsOf(all);
  assert('B Storage 空时使用内置卡', cards.length === 2, cards.length);
  assert('B 内置卡未被 removeBuiltIns 清除', cards.every((c) => String(c.id).indexOf('builtin-') === 0), cards.map((c) => c.id));
  assert('B 内置卡保留 deck', cards[0] && cards[0].deck === '本地题集', cards[0] && cards[0].deck);
  assert('B 示例卡与内置卡共存', all.length === 26, all.length);

  // ── C：Storage 已有用户卡 → 本地优先，内置不混入 ──
  let s = freshStore();
  s.setCards([Object.assign(CARD('import-1'), { deck: '用户导入题集' })]);
  const c3 = s.getCards();
  assert('C 本地优先：仅返回用户卡', c3.length === 1 && c3[0].id === 'import-1', c3.map((c) => c.id));

  // ── D：内置回写后不重复累积 ──
  s = freshStore();
  const d1 = s.getCards();
  const d2 = s.getCards();
  assert('D 内置卡回写后不重复累积', builtinsOf(d1).length === 2 && builtinsOf(d2).length === 2, [d1.length, d2.length]);

  // ── E：ENA BLED:false 但有内容 → 忽略（开关优先）──
  setBuiltin('const ENABLED = false;\nconst BUILTIN_CARDS = [' + JSON.stringify(CARD('builtin-0001')) + '];\nmodule.exports = { ENABLED, BUILTIN_CARDS };\n');
  assert('E ENABLED:false 时忽略内容', builtinsOf(freshStore().getCards()).length === 0, null);

  // ── F：内置卡上的用户数据必须跨 getCards() 存活（2026-09-10 修复）──
  // 原实现以代码常量为基底重建内置卡，只回填 6 个调度字段 —— 而只要有内置卡，
  // syncBuiltIns 每次 getCards() 都命中（changed 恒为 true），等于每次读卡片都把
  // history / fsrs / 补图抹掉。这条链路没有任何报错，只能靠断言守住。
  setBuiltin('const ENABLED = true;\nconst BUILTIN_CARDS = [' + JSON.stringify(CARD('builtin-0001')) + '];\nmodule.exports = { ENABLED, BUILTIN_CARDS };\n');
  {
    const st = freshStore();
    const b = st.getCards().find((c) => c.id === 'builtin-0001');
    assert('F1 内置卡存在', !!b, null);
    if (b) {
      st.updateCard(Object.assign({}, b, {
        repetitions: 3, interval: 15, state: 'review',
        history: [{ date: Date.now(), rating: 'good', elapsedDays: 0 }],
        fsrs: {
          stability: 2.1, difficulty: 2.0, due: Date.now(), state: 2, reps: 3,
          lapses: 0, scheduledDays: 15, learningSteps: 0, lastReview: Date.now()
        },
        localImages: ['/tmp/a.png']
      }));
      const back = st.getCards().find((c) => c.id === 'builtin-0001');
      assert('F2 history 跨 getCards 存活', Array.isArray(back.history) && back.history.length === 1,
        JSON.stringify(back.history));
      assert('F3 fsrs 影子快照跨 getCards 存活', !!back.fsrs, back.fsrs ? 'S=' + back.fsrs.stability : '缺失');
      assert('F4 localImages 跨 getCards 存活',
        Array.isArray(back.localImages) && back.localImages.length === 1, null);
      assert('F5 调度进度仍保留', back.repetitions === 3 && back.interval === 15,
        back.repetitions + '/' + back.interval);
      assert('F6 正文仍以代码常量为准', back.front === CARD('builtin-0001').front, null);
    }
  }

  console.log('\nStore 内置题库集成：通过 ' + pass + ' / 失败 ' + fail);
} finally {
  try { fs.rmSync(T, { recursive: true, force: true }); } catch (e) {}
}

process.exit(fail ? 1 : 0);
