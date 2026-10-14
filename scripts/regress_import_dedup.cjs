/**
 * 回归：导入内容去重（防止「同一文件重传一次 = 题库翻倍」）
 *
 * 背景：导入卡的 id 是 `'import-' + Date.now() + '-' + index + '-' + 随机串`，**不含内容**，
 * 所以按 id 判重对「重新上传同一个文件」完全失效 —— 100% 变成重复对子，而且后果是静默的：
 * 题库翻倍、复习量翻倍、存储成倍占用（题库本来就顶在微信 1MB/键 与总容量预算上）。
 *
 * 现在 importCards 默认走内容去重，判定键 = importer.contentKey(card)
 * = 归一化题干 + 归一化选项。本脚本守的就是这个键的**两个方向**：
 *   A. 不漏杀：同一道题的各种写法（HTML/题号/引号/全角/同形字母/选项标点）必须同键；
 *   B. 不误杀：不同题必须不同键，尤其「题干很短、内容全在选项里」的题不能被合并；
 *      空题干/极短残卡一律返回 null（视为不重复），否则一批残卡会互相吞并成一张。
 *
 * 用法：node scripts/regress_import_dedup.cjs
 */
const env = require('./_testenv.cjs').prepare();
const { memWx } = require('./_testenv.cjs');
const STO = env.STO;
const { DC, BL, IMP, CS } = env;
const importer = require(IMP);

let pass = 0;
let fail = 0;
function assert(name, cond, extra) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (extra !== undefined ? ' => ' + JSON.stringify(extra) : '')); }
}

/** 清掉 store 模块缓存：store 内有 _shardCache / _lastImportReport 等模块级状态 */
function freshStore() {
  [STO, DC, BL, IMP, CS].forEach((p) => { try { delete require.cache[require.resolve(p)]; } catch (e) {} });
  return require(STO);
}

function setup(seed) {
  const store = freshStore();
  const w = memWx(store, seed || {}, { strict: true });
  global.wx = w;
  return { store: store, w: w };
}

/** 造一张题干逐张唯一的卡（题干必须唯一，否则会被正确地判成同一道题） */
function card(i, over) {
  const base = {
    id: 'lib-' + i,
    deck: '2018单选',
    qNo: String(i),
    front: '第 ' + i + ' 题：关于过程能力指数 Cpk 的描述，下列说法不正确的是（）。',
    back: '【答案】A<br/>【解析】Cpk 同时考虑中心偏移与固有波动。',
    options: ['A. 同时考虑中心偏移', 'B. 只看固有波动', 'C. 与规格限无关', 'D. 仅用于计数型数据'],
    correctAnswer: 'A',
    cardType: 'single_choice',
    stage: 'measure',
    interval: 0, repetitions: 0, easeFactor: 2.5, nextReviewDate: 0, state: 'new'
  };
  return Object.assign(base, over || {});
}

function libCards(n) {
  const out = [];
  for (let i = 1; i <= n; i++) out.push(card(i));
  return out;
}

/** 一份「某年份真题」Anki TXT（含 Tab，走启发式解析路径） */
function yearTxt(year, n, opts) {
  const o = opts || {};
  const lines = ['#separator:tab', '#html:true', '#columns:front back tags'];
  for (let i = 1; i <= n; i++) {
    const stem = o.sameStem
      ? '下列说法不正确的是（）。'
      : year + ' 年第 ' + i + ' 题：关于过程能力指数 Cpk 的描述，下列说法不正确的是（）。';
    // varyOptions：题干保持相同的短句，把差异放进选项（模拟「题干很泛、内容全在选项里」的题集）
    const tag = o.varyOptions ? ('（' + year + '-' + i + '）') : '';
    const front = '<div>（单选）' + i + '．' + stem + '</div>'
      + '<div>A. 同时考虑中心偏移' + tag + '</div><div>B. 只看固有波动' + tag + '</div>'
      + '<div>C. 与规格限无关' + tag + '</div><div>D. 仅用于计数型数据' + tag + '</div>';
    const back = o.noAnswer ? '解析：Cpk 同时考虑中心偏移与固有波动。'
      : '<b>答案：A</b><br/>解析：Cpk 同时考虑中心偏移与固有波动。';
    lines.push([front, back, 'qNo:' + i + ' type:single_choice stage:measure'].join('\t'));
  }
  return lines.join('\n') + '\n';
}

/* ────────────────────────── 1. 同一道题的各种写法 ⇒ 同键 ────────────────────────── */
console.log('\n── 1. contentKey：同一道题的多种写法必须同键 ──');
{
  const K = (c) => importer.contentKey(c);
  // 注意：card(i) 的题干里带序号，比较「同一道题」时两侧必须用**同一个 i**
  const F = '关于过程能力指数 Cpk 的描述，下列说法不正确的是（）。';

  assert('1.1 完全相同 → 同键', K(card(1)) === K(card(1, { id: 'x', qNo: '9' })), [K(card(1)), K(card(1, { id: 'x', qNo: '9' }))]);

  // 题号不同（回忆版重复题最常见）
  assert('1.2 题号/题型标注不同 → 同键', (() => {
    const a = card(1, { front: '第 1 题：' + F });
    const b = card(1, { front: '（单项选择题）第 108 题：' + F });
    return K(a) === K(b);
  })(), [K(card(1, { front: '第 1 题：' + F })), K(card(1, { front: '（单项选择题）第 108 题：' + F }))]);

  // HTML 差异
  assert('1.3 HTML 标签/实体差异 → 同键', (() => {
    const a = card(1, { front: '<div>第 1 题：关于过程能力指数 <b>Cpk</b> 的描述，下列说法不正确的是（）。</div>' });
    const b = card(1, { front: '第 1 题：关于过程能力指数 Cpk 的描述，下列说法不正确的是（）。<br/>' });
    return K(a) === K(b);
  })(), [K(card(1, { front: '<div>第 1 题：关于过程能力指数 <b>Cpk</b> 的描述，下列说法不正确的是（）。</div>' })), K(card(1, { front: '第 1 题：关于过程能力指数 Cpk 的描述，下列说法不正确的是（）。<br/>' }))]);

  // 引号 / 空白 / 全角
  assert('1.4 引号、空白、全角差异 → 同键', (() => {
    const a = card(1, { front: '第1题："关于 过程能力指数 Cpk 的描述" ，下列说法不正确的是（）。' });
    const b = card(1, { front: '第１题： “关于　过程能力指数　Ｃｐｋ　的描述”，下列说法不正确的是（）。' });
    return K(a) === K(b);
  })(), null);

  // 本地截图占位标记残留（历史遗留数据里存在）
  assert('1.5 @image 占位残留 → 同键', (() => {
    const a = card(1, { front: '第 1 题：' + F });
    const b = card(1, { front: '第 1 题：关于过程能力指数 Cpk 的描述，@image#1:1444044307158373.png 下列说法不正确的是（）。' });
    return K(a) === K(b);
  })(), null);

  // 选项标点/空白差异
  assert('1.6 选项标点差异 → 同键', (() => {
    const a = card(1, { options: ['A. 同时考虑中心偏移', 'B. 只看固有波动', 'C. 与规格限无关', 'D. 仅用于计数型数据'] });
    const b = card(1, { options: ['A、同时考虑中心偏移 ', 'B．只看固有波动', 'C: 与规格限无关', 'D . 仅用于计数型数据'] });
    return K(a) === K(b);
  })(), [K(card(1, { options: ['A. 同时考虑中心偏移', 'B. 只看固有波动', 'C. 与规格限无关', 'D. 仅用于计数型数据'] })), K(card(1, { options: ['A、同时考虑中心偏移 ', 'B．只看固有波动', 'C: 与规格限无关', 'D . 仅用于计数型数据'] }))]);

  // 同形希腊/西里尔字母
  assert('1.7 同形希腊字母 Β 与 B → 同键', (() => {
    const a = card(1, { options: ['A. 同时考虑中心偏移', 'B. 只看固有波动'] });
    const b = card(1, { options: ['A. 同时考虑中心偏移', '\u0392. 只看固有波动'] });
    return K(a) === K(b);
  })(), null);

  // 答案/解析不同不影响判定（换源、回忆版缺答案）
  assert('1.8 答案缺失、解析不同 → 仍同键', (() => {
    const a = card(1);
    const b = card(1, { correctAnswer: undefined, back: '解析：完全不同的一段说明文字。' });
    return K(a) === K(b);
  })(), null);

  // 无选项的闪卡
  assert('1.9 闪卡（无选项）同题干 → 同键', (() => {
    const a = { front: 'DPMO 与 DPU 的区别是什么？' };
    const b = { front: '<div>DPMO 与　DPU 的区别是什么？</div>' };
    return K(a) === K(b);
  })(), null);
}

/* ────────────────────────── 2. 不同题 / 不可判定 ⇒ 不合并 ────────────────────────── */
console.log('\n── 2. contentKey：不同题必须不同键（防误杀） ──');
{
  const K = (c) => importer.contentKey(c);

  assert('2.1 题干只差一个数字 → 不同键',
    K(card(1, { front: '第 1 题：关于过程能力指数 Cpk 的描述，下列说法不正确的是（）。' })) !==
    K(card(1, { front: '第 1 题：关于过程能力指数 Cpk 的描述，下列说法不正确的是（）。', options: ['A. 同时考虑中心偏移', 'B. 只看固有波动', 'C. 与规格限无关', 'D. 仅用于计数型数据5'] })),
    null);

  // 关键：题干很短、内容全在选项里。若只比题干，一批这样的题会被合并成一张。
  assert('2.2 题干相同但选项不同 → 不同键（短题干题集的护栏）', (() => {
    const a = { front: '下列说法不正确的是（）。', options: ['A. 甲', 'B. 乙', 'C. 丙', 'D. 丁'] };
    const b = { front: '下列说法不正确的是（）。', options: ['A. 戊', 'B. 己', 'C. 庚', 'D. 辛'] };
    return K(a) !== K(b);
  })(), null);

  assert('2.3 题干相同、选项数量不同 → 不同键', (() => {
    const a = { front: '下列说法不正确的是（）。', options: ['A. 甲', 'B. 乙', 'C. 丙', 'D. 丁'] };
    const b = { front: '下列说法不正确的是（）。', options: ['A. 甲', 'B. 乙', 'C. 丙'] };
    return K(a) !== K(b);
  })(), null);

  assert('2.4 题干差一个数字 → 不同键',
    K({ front: '某过程 Cpk=1.33，其 DPMO 约为多少？' }) !== K({ front: '某过程 Cpk=1.34，其 DPMO 约为多少？' }), null);

  assert('2.5 空题干 → null（不参与判定）',
    K({ front: '' }) === null && K({ front: '   ' }) === null && K({ front: '<div></div>' }) === null, null);

  assert('2.6 归一化后过短的残卡 → null（避免互相吞并）',
    K({ front: '1.' }) === null && K({ front: '（单选）' }) === null && K({ front: 'A' }) === null,
    [K({ front: '1.' }), K({ front: '（单选）' }), K({ front: 'A' })]);

  assert('2.7 非对象输入 → null（不炸）',
    K(null) === null && K(undefined) === null && K('x') === null, null);
}

/* ────────────────────────── 3. 同一文件重传 ⇒ 不再翻倍 ────────────────────────── */
console.log('\n── 3. 同一文件重新上传（真实解析链路） ──');
{
  const { store } = setup();
  const txt = yearTxt(2018, 100);

  const first = importer.parseText(txt);
  assert('3.1 解析出 100 张', first.success === true && first.cards.length === 100, { ok: first.success, n: first.cards.length });

  const batch1 = first.cards.map((c) => Object.assign({}, c, { deck: '2018' }));
  store.importCards(batch1, 'append');
  const r1 = store.getLastImportReport();
  assert('3.2 首次导入 100 张全部进库', r1.added === 100 && r1.skippedDuplicates === 0, r1);
  const n1 = store.getCards().length;

  // 再解析一次同一份文本：id 全新（含新的时间戳与随机串），按 id 判重必然失效
  const second = importer.parseText(txt);
  assert('3.3 重解析出的 id 与首次不同（id 判重失效的前提）',
    second.cards[0].id !== first.cards[0].id, [first.cards[0].id, second.cards[0].id]);

  const batch2 = second.cards.map((c) => Object.assign({}, c, { deck: '2018' }));
  store.importCards(batch2, 'append');
  const r2 = store.getLastImportReport();
  const n2 = store.getCards().length;

  assert('3.4 重传全部判为重复', r2.skippedDuplicates === 100 && r2.duplicateInLibrary === 100, r2);
  assert('3.5 重传后 0 新增', r2.added === 0 && n2 === n1, { added: r2.added, before: n1, after: n2 });
  assert('3.6 库中仍是 100 张（不是 200）', n2 - (n1 - 100) === 100, n2);
}

/* ────────────────────────── 4. 批内重复 ────────────────────────── */
console.log('\n── 4. 批内重复（同一个文件内部就有重复） ──');
{
  const { store } = setup();
  const txt = yearTxt(2019, 90);
  const uniq = importer.parseText(txt).cards;
  // 前 10 张再复制一份 → 批内 10 对重复
  const batch = uniq.slice(0, 10).map((c) => Object.assign({}, c, { id: c.id })).concat(uniq);
  const r = store.scanDuplicates(batch.map((c) => Object.assign({}, c, { deck: '2019' })), 'append');
  assert('4.1 扫出批内 10 张重复', r.batch === 10 && r.library === 0, r);
  assert('4.2 去重后剩 90 张', r.unique === 90 && r.kept.length === 90, { unique: r.unique });

  const decked = batch.map((c) => Object.assign({}, c, { deck: '2019' }));
  store.importCards(decked, 'append');
  const rep = store.getLastImportReport();
  assert('4.3 实际只入库 90 张', rep.added === 90 && rep.skippedDuplicates === 10, rep);
}

/* ────────────────────────── 5. 换源：同一道题来自另一份文件 ────────────────────────── */
console.log('\n── 5. 换源比对（题干+选项相同、来源不同） ──');
{
  const { store } = setup();
  const a = importer.parseText(yearTxt(2020, 50)).cards.map((c) => Object.assign({}, c, { deck: '2020' }));
  store.importCards(a, 'append');
  const n1 = store.getCards().length;

  // 同一批题，换成没有答案的来源（答案缺失不该被当成另一道题）
  const b = importer.parseText(yearTxt(2020, 50, { noAnswer: true })).cards.map((c) => Object.assign({}, c, { deck: '2020回忆版' }));
  store.importCards(b, 'append');
  const r = store.getLastImportReport();
  assert('5.1 换源（缺答案）仍判为重复', r.skippedDuplicates === 50 && r.added === 0, r);
  assert('5.2 库未增长', store.getCards().length === n1, { before: n1, after: store.getCards().length });

  // 题干都是同一句泛化短句、差异全在选项里 ⇒ 必须全部保留（短题干护栏的真实用例）
  const c2 = importer.parseText(yearTxt(2021, 50, { sameStem: true, varyOptions: true })).cards.map((x) => Object.assign({}, x, { deck: '2021' }));
  const c3 = importer.parseText(yearTxt(2022, 50, { sameStem: true, varyOptions: true })).cards.map((x) => Object.assign({}, x, { deck: '2022' }));
  store.importCards(c2, 'append');
  const rC2 = store.getLastImportReport();
  store.importCards(c3, 'append');
  const rC3 = store.getLastImportReport();
  assert('5.3 同一批内：题干相同但选项不同 → 不误杀', rC2.added === 50 && rC2.skippedDuplicates === 0, rC2);
  assert('5.4 跨年份：题干相同但选项不同 → 不误杀', rC3.added === 50 && rC3.skippedDuplicates === 0, rC3);
  // 而同一份 2021 再传一次，必须被挡住
  const c2again = importer.parseText(yearTxt(2021, 50, { sameStem: true, varyOptions: true })).cards.map((x) => Object.assign({}, x, { deck: '2021' }));
  store.importCards(c2again, 'append');
  assert('5.5 同一年份重传 → 全判重', store.getLastImportReport().skippedDuplicates === 50, store.getLastImportReport());
}

/* ────────────────────────── 6. 逃生通道：仍然全部导入 ────────────────────────── */
console.log('\n── 6. skipDuplicates:false（用户点「仍然导入」） ──');
{
  const { store } = setup();
  const txt = yearTxt(2018, 30);
  const b1 = importer.parseText(txt).cards.map((c) => Object.assign({}, c, { deck: '2018' }));
  store.importCards(b1, 'append');
  const n1 = store.getCards().length;

  const b2 = importer.parseText(txt).cards.map((c) => Object.assign({}, c, { deck: '2018' }));
  store.importCards(b2, 'append', { skipDuplicates: false });
  const r = store.getLastImportReport();
  assert('6.1 强制导入时不去重', r.skippedDuplicates === 0 && r.added === 30, r);
  assert('6.2 库按预期增长 30', store.getCards().length === n1 + 30, { before: n1, after: store.getCards().length });
}

/* ────────────────────────── 7. replace 模式 ────────────────────────── */
console.log('\n── 7. replace 模式（覆盖导入） ──');
{
  const { store } = setup();
  const old = importer.parseText(yearTxt(2018, 40)).cards.map((c) => Object.assign({}, c, { deck: '2018' }));
  store.importCards(old, 'append');

  // 覆盖导入同一批（去掉答案的来源）：库会被替换，故不应与「库」比对而误报重复，
  // 但仍应做批内去重
  const rep = importer.parseText(yearTxt(2018, 40, { noAnswer: true })).cards.map((c) => Object.assign({}, c, { deck: '2018' }));
  const dup = store.scanDuplicates(rep, 'replace');
  assert('7.1 replace 模式不与库比对', dup.library === 0 && dup.batch === 0, dup);

  const doubled = rep.concat(rep.slice(0, 5));
  store.importCards(doubled.map((c) => Object.assign({}, c, { deck: '2018' })), 'replace');
  const r = store.getLastImportReport();
  assert('7.2 replace 模式仍做批内去重', r.skippedDuplicates === 5 && r.totalAfter === 40, r);
}

/* ────────────────────────── 8. 库中已有卡（含学习进度）绝不被动 ────────────────────────── */
console.log('\n── 8. 去重时保留的是「库中那张」，学习进度不被改动 ──');
{
  const { store } = setup();
  const learned = card(7, { id: 'import-learned-1', repetitions: 5, interval: 42, easeFactor: 2.1, state: 'review' });
  store.setCards([learned]);
  assert('8.1 预置卡已落库', store.getCards().length === 1, store.getCards().length);

  // 重传同一道题（题干与选项一致、答案写法不同）
  const incoming = [card(7, { id: 'import-9999999-0-zzzz', correctAnswer: 'A', back: '另一份来源的解析' })];
  store.importCards(incoming, 'append');
  const r = store.getLastImportReport();
  const after = store.getCards();

  assert('8.2 判为重复、未新增', r.added === 0 && r.skippedDuplicates === 1, r);
  assert('8.3 库中仍是原卡（id 未被换掉）', after.length === 1 && after[0].id === 'import-learned-1', after.map((c) => c.id));
  assert('8.4 学习进度完好', after[0].repetitions === 5 && after[0].interval === 42 && after[0].easeFactor === 2.1, after[0]);
}

/* ────────────────────────── 9. scanDuplicates 只读 ────────────────────────── */
console.log('\n── 9. scanDuplicates 是只读的（不得有副作用） ──');
{
  const { store, w } = setup();
  store.importCards(libCards(20).map((c) => Object.assign({}, c, { id: 'import-s-1', deck: 'D' })), 'append');
  // 先读一次把 getCards 的惰性同步「沉淀」掉，否则快照会把那次写入算到扫描头上
  const before = store.getCards().length;
  const snapshot = JSON.stringify(w.mem);

  const dup = store.scanDuplicates(libCards(20).map((c) => Object.assign({}, c, { id: 'import-s-2', deck: 'D' })), 'append');
  assert('9.1 扫出 20 张与库重复', dup.library === 20 && dup.unique === 0, dup);
  assert('9.2 扫描未改动存储', JSON.stringify(w.mem) === snapshot, null);
  assert('9.3 扫描未改动库', store.getCards().length === before, { before: before, after: store.getCards().length });
}

/* ────────────────────────── 10. 空题干残卡不被吞并 ────────────────────────── */
console.log('\n── 10. 空/极短题干残卡：既不参与判定，也不被丢弃 ──');
{
  const { store } = setup();
  const junk = [
    { id: 'import-j-1', deck: 'D', front: '', back: 'x', options: undefined },
    { id: 'import-j-2', deck: 'D', front: '   ', back: 'y' },
    { id: 'import-j-3', deck: 'D', front: '1.', back: 'z' },
    { id: 'import-j-4', deck: 'D', front: '（单选）', back: 'w' }
  ];
  const dup = store.scanDuplicates(junk, 'append');
  assert('10.1 残卡全部无法判定 ⇒ 不判重', dup.dup === 0 && dup.unique === 4, dup);

  store.importCards(junk, 'append');
  const r = store.getLastImportReport();
  assert('10.2 残卡全部入库（一张不丢）', r.added === 4 && r.skippedDuplicates === 0, r);

  // 再来一批：库里已有 4 张残卡，但残卡不参与判定，所以仍应全部入库
  const junk2 = [
    { id: 'import-k-1', deck: 'D', front: '', back: 'x2' },
    { id: 'import-k-2', deck: 'D', front: '1.', back: 'z2' }
  ];
  store.importCards(junk2, 'append');
  assert('10.3 残卡不会互相吞并', store.getLastImportReport().added === 2, store.getLastImportReport());
}

/* ────────────────────────── 11. 报告字段 & 全重复场景 ────────────────────────── */
console.log('\n── 11. 导入报告字段 ──');
{
  const { store } = setup();
  const base = importer.parseText(yearTxt(2018, 20)).cards.map((c) => Object.assign({}, c, { deck: '2018' }));
  store.importCards(base, 'append');
  const n0 = store.getCards().length; // 含空库自动回填的示例卡，故用增量断言

  // 一半重复、一半新
  const mixed = importer.parseText(yearTxt(2018, 10)).cards
    .concat(importer.parseText(yearTxt(2023, 10)).cards)
    .map((c) => Object.assign({}, c, { deck: '2018' }));
  store.importCards(mixed, 'append');
  const r = store.getLastImportReport();
  assert('11.1 total = 本批张数', r.total === 20, r);
  assert('11.2 skippedDuplicates = 重复张数', r.skippedDuplicates === 10, r);
  assert('11.3 added = 真正进库张数', r.added === 10, r);
  assert('11.4 totalAfter = 导入后总张数', r.totalAfter === n0 + 10 && r.totalAfter === store.getCards().length, { totalAfter: r.totalAfter, n0: n0 });
  assert('11.5 分类计数：库内 10 / 批内 0', r.duplicateInLibrary === 10 && r.duplicateInBatch === 0, r);

  // 全部重复
  const allDup = importer.parseText(yearTxt(2018, 10)).cards.map((c) => Object.assign({}, c, { deck: '2018' }));
  store.importCards(allDup, 'append');
  const r2 = store.getLastImportReport();
  assert('11.6 全重复时 added = 0', r2.added === 0 && r2.skippedDuplicates === 10, r2);

  // 空批次不炸
  store.importCards([], 'append');
  const r3 = store.getLastImportReport();
  assert('11.7 空批次安全', r3.total === 0 && r3.added === 0, r3);
  assert('11.8 非数组入参安全', store.importCards(null, 'append') !== undefined, null);

  // 报告必须在 getCards() 之后仍可读（admin 页取的时机在 getCards 之前，这里反向确认不会崩）
  assert('11.9 报告可被稳定读取', typeof store.getLastImportReport().added === 'number', store.getLastImportReport());
}

/* ────────────────────────── 12. 导出 → 重新导入（往返） ────────────────────────── */
console.log('\n── 12. 导出 Anki TXT 后再导入同一批 ⇒ 判为重复 ──');
{
  const { store } = setup();
  const cards = importer.parseText(yearTxt(2018, 25)).cards.map((c) => Object.assign({}, c, { deck: '2018' }));
  store.importCards(cards, 'append');
  const n1 = store.getCards().length;

  // 只导出本次导入的题集（空库回填的示例卡会另成一个题集文件，与本节无关）
  const exp = importer.exportAnkiTxt(store.getCards().filter((c) => c.deck === '2018'));
  assert('12.1 导出得到 1 个题集文件', exp.files.length === 1 && exp.total === 25, { files: exp.files.length, total: exp.total });

  const back = importer.parseText(exp.files[0].text);
  assert('12.2 回读解析出 25 张', back.success === true && back.cards.length === 25, { ok: back.success, n: back.cards.length });

  store.importCards(back.cards.map((c) => Object.assign({}, c, { deck: '2018' })), 'append');
  const r = store.getLastImportReport();
  assert('12.3 往返后判为全重复', r.skippedDuplicates === 25 && r.added === 0, r);
  assert('12.4 库未翻倍', store.getCards().length === n1, { before: n1, after: store.getCards().length });
}

console.log('\n导入内容去重：通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
