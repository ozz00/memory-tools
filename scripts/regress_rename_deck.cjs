/**
 * 回归：题集重命名 store.renameDeck + 导入弹窗名称清洗
 *
 * 背景：wx.showModal({editable:true}) 在真机上会把 content 预填进输入框，
 *       导致提示语被当成题集名存进题库。故新增 renameDeck 做批量改名，
 *       并在 admin 侧对 res.content 做清洗（长度>30 / 含提示语关键词 → 回退自动名）。
 *
 * 用法：node scripts/regress_rename_deck.cjs
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'caq_rename_'));

const IMP = path.join(T, 'importer.cjs');
const DC = path.join(T, 'defaultCards.cjs');
const BL = path.join(T, 'builtinLocal.cjs');
const SC = path.join(T, 'sampleCards.cjs');
const STO = path.join(T, 'store.cjs');
const CS = path.join(T, 'cardShards.cjs');

fs.copyFileSync(path.join(ROOT, 'miniprogram/utils/importer.js'), IMP);
fs.copyFileSync(path.join(ROOT, 'miniprogram/data/sampleCards.js'), SC);
fs.copyFileSync(path.join(ROOT, 'miniprogram/utils/cardShards.js'), CS);
fs.writeFileSync(BL, 'const ENABLED = false;\nconst BUILTIN_CARDS = [];\nmodule.exports = { ENABLED, BUILTIN_CARDS };\n', 'utf8');
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

let pass = 0;
let fail = 0;
function assert(n, c, e) {
  if (c) { pass++; console.log('  ok  ' + n); }
  else { fail++; console.log('FAIL  ' + n + ' => ' + JSON.stringify(e)); }
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

const CARD = (id, deck) => ({
  id: id, deck: deck, front: '题干' + id, back: '答案：A',
  options: ['A. x', 'B. y'], correctAnswer: 'A', cardType: 'single_choice',
  tags: ['t'], stage: 'measure', interval: 6, repetitions: 3,
  easeFactor: 2.36, nextReviewDate: 1, state: 'review'
});

/* admin 侧名称清洗逻辑的镜像实现，用于断言行为一致 */
const HINT_RE = /(确定导入|自动识别|已按文件名|直接点|取消)/;
function cleanName(input, autoName) {
  let n = String(input || '').trim().replace(/\s+/g, ' ');
  if (!n || n.length > 30 || HINT_RE.test(n)) n = autoName;
  return n;
}

try {
  // ── A：批量改名 ──
  let s = freshStore();
  s.setCards([CARD('a1', '坏名字'), CARD('a2', '坏名字'), CARD('b1', '别的题集')]);
  let r = s.renameDeck('坏名字', '2018绿带真题-单选');
  assert('A 返回 changed=2', r.ok === true && r.changed === 2, r);
  let cards = s.getCards();
  assert('A 两张已改名', cards.filter((c) => c.deck === '2018绿带真题-单选').length === 2, cards.map((c) => c.deck));
  assert('A 其他题集不受影响', cards.filter((c) => c.deck === '别的题集').length === 1, cards.map((c) => c.deck));
  const c1 = cards.find((c) => c.id === 'a1');
  assert('A 改名不破坏 SM-2 进度', c1.easeFactor === 2.36 && c1.repetitions === 3 && c1.interval === 6, c1);

  // ── B：防御分支 ──
  assert('B 空名称拒绝', s.renameDeck('2018绿带真题-单选', '   ').ok === false, null);
  assert('B 不存在的题集 changed=0', s.renameDeck('不存在', 'x').changed === 0, null);
  const before = s.getCards().length;
  assert('B 失败时不丢卡', s.renameDeck('不存在', 'x') && s.getCards().length === before, s.getCards().length);

  // ── C：无 deck 的卡片归入「未命名」 ──
  s = freshStore();
  const noDeck = CARD('n1', '');
  delete noDeck.deck;
  s.setCards([noDeck, CARD('n2', '未命名')]);
  r = s.renameDeck('未命名', '默认题集');
  assert('C 未命名归类可改名', r.changed === 2, r);
  assert('C 改名后无残留未命名', s.getCards().every((c) => c.deck === '默认题集'), s.getCards().map((c) => c.deck));

  // ── D：真机弹窗预填提示语 → 回退自动名 ──
  const hint = '已按文件名自动识别为「2018年中质协六西格玛绿带考试真题-单选题」。直接点「确定导入」即可，也可在下方改成其他名称。';
  assert('D 提示语回退为文件名', cleanName(hint, '2018年中质协六西格玛绿带考试真题-单选题') === '2018年中质协六西格玛绿带考试真题-单选题', cleanName(hint, 'x'));
  assert('D 留空回退为文件名', cleanName('', '默认名') === '默认名', cleanName('', '默认名'));
  assert('D 正常自定义名保留', cleanName('我的题集 A', '默认名') === '我的题集 A', cleanName('我的题集 A', '默认名'));
  assert('D 超长名回退', cleanName('一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十一二三', '默认名') === '默认名', null);
  assert('D 首尾空白与连续空格归一', cleanName('  2018 绿带  真题  ', 'x') === '2018 绿带 真题', cleanName('  2018 绿带  真题  ', 'x'));

  console.log('\n题集重命名与名称清洗：通过 ' + pass + ' / 失败 ' + fail);
} finally {
  try { fs.rmSync(T, { recursive: true, force: true }); } catch (e) {}
}

process.exit(fail ? 1 : 0);
