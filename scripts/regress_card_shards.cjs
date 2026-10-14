/**
 * 回归：卡片分片存储（规避单 key 1MB 上限）
 *
 * 背景：原先全部卡片写在单一 key `caq_6sigma_flashcards_v1` 上。实测单卡均值 1.66KB
 * ⇒ 2316 张 = 3842KB，而微信单 key 上限 1MB，真机写入直接抛错；旧代码把异常吞掉，
 * 用户看到的是「复习进度不保存」。开发者工具不强制该上限，所以本地测不出来。
 *
 * 本脚本守的是**这套分片机制本身的不变量**，而不是某个业务功能：
 *   1. 往返守恒 + 顺序不乱（分片拼接必须还原原数组顺序）
 *   2. 单片不超预算（这是分片存在的理由，破了就等于没做）
 *   3. v1→v2 迁移幂等，且**读回校验通过后才删旧键**（删早了就是整库丢失）
 *   4. 分片损坏时不返回 null（返回 null 会被上层回落到默认库，把小故障放大成整库覆盖）
 *   5. 只重写真正变了的分片 / 变少了要清理残留片
 *   6. 任一步写入失败都要回滚到写之前的状态
 *   7. 总容量超限如实报错，不静默丢数据
 *
 * 用法：node scripts/regress_card_shards.cjs
 */
const path = require('path');

const env = require('./_testenv.cjs').prepare();
const { memWx } = require('./_testenv.cjs');
const STO = env.STO;
const { DC, BL, IMP, CS } = env;

let pass = 0;
let fail = 0;
function assert(name, cond, extra) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (extra !== undefined ? ' => ' + JSON.stringify(extra) : '')); }
}

/** 清掉 store 模块缓存：store 内有分片缓存（_shardCache）等模块级状态 */
function freshStore() {
  [STO, DC, BL, IMP].forEach((p) => { try { delete require.cache[require.resolve(p)]; } catch (e) {} });
  return require(STO);
}

/** 逼近真实体积的卡片：实测均值 1.66KB，这里填充到 ~1.5KB 量级 */
const FILLER = '六西格玛管理的核心是减少过程变异并持续改进，DMAIC 各阶段需明确交付物与测量指标；过程能力指数 Cpk 同时考虑中心偏移与固有波动。';
function makeCard(i) {
  return {
    id: 'import-' + (1757400000 + i) + '-0-abcd',
    deck: '2026模拟题集',
    qNo: String(i + 1),
    // 题干必须逐张唯一：导入默认开启内容去重（按归一化题干+选项判定），
    // 若造数据所有卡题干相同，会被正确地判成同一道题而只剩一张。
    front: '(单选) ' + (i + 1) + '.在六西格玛项目中，关于第 ' + (i + 1) + ' 类过程的描述，下列说法不正确的是（）。',
    back: '【答案】A<br/>【解析】' + FILLER.repeat(9),
    options: [
      'A. 顾客与过程结果的符合性',
      'B. 过程能力与规格限的对比关系',
      'C. 供应商管理与来料检验策略',
      'D. 员工满意度调查的执行周期'
    ],
    correctAnswer: 'A',
    cardType: 'single_choice',
    tags: ['导入', '模拟'],
    stage: 'overview',
    interval: 0, repetitions: 0, easeFactor: 2.5, nextReviewDate: 0, state: 'new'
  };
}
function makeCards(n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(makeCard(i));
  return out;
}

/** 记录写入/删除的键名，用于「只写改动片」「清理残留片」类断言 */
function counting(w) {
  const set0 = w.setStorageSync;
  const rem0 = w.removeStorageSync;
  w.writes = [];
  w.removes = [];
  w.setStorageSync = function (k, v) { w.writes.push(k); set0.call(w, k, v); };
  w.removeStorageSync = function (k) { w.removes.push(k); rem0.call(w, k); };
  w.resetLog = function () { w.writes = []; w.removes = []; };
  w.shardWrites = function () {
    const P = w.__prefix;
    return w.writes.filter((k) => k.indexOf(P) === 0).length;
  };
  return w;
}

function setup(seed, opts) {
  const store = freshStore();
  const w = counting(memWx(store, seed, opts));
  w.__prefix = store.KEY_CARDS_SHARD_PREFIX;
  global.wx = w;
  return { store: store, w: w };
}

console.log('\n── 1. 字节计量（上限按字节算，不是 length）──');
{
  const S = require(CS);
  assert('1.1 ASCII 1 字节', S.byteLen('abc') === 3, S.byteLen('abc'));
  assert('1.2 中文 3 字节（length 只有 1）', S.byteLen('中') === 3 && '中'.length === 1, S.byteLen('中'));
  assert('1.3 emoji 4 字节（代理对）', S.byteLen('😀') === 4, S.byteLen('😀'));
  assert('1.4 混排累计正确', S.byteLen('a中😀') === 1 + 3 + 4, S.byteLen('a中😀'));
  assert('1.5 单卡体积与实测均值同量级', (() => {
    const b = S.cardBytes(makeCard(0));
    return b > 800 && b < 3000;
  })(), S.cardBytes(makeCard(0)));
}

console.log('\n── 2. 往返守恒 + 顺序（分片拼接必须还原原数组顺序）──');
{
  const cards = makeCards(1200);
  const { store, w } = setup({}, { strict: true });
  const info = store.setCards(cards);
  assert('2.1 写入成功', info.ok === true, info);
  assert('2.2 确实切成了多片（>1）', info.count > 1, info.count);
  const back = store.getCards();
  assert('2.3 卡数守恒', back.length === 1200, back.length);
  assert('2.4 顺序守恒（按 id 逐个比对）', back.every((c, i) => c.id === cards[i].id),
    (() => { for (let i = 0; i < back.length; i++) if (back[i].id !== cards[i].id) return { at: i, got: back[i].id, want: cards[i].id }; return null; })());
  assert('2.5 内容守恒（深度相等）', JSON.stringify(back) === JSON.stringify(cards), null);
  assert('2.6 只存在分片键，无旧版单键', !w.hasLegacyKey(), Object.keys(w.mem));
}

console.log('\n── 3. 单片不超预算（分片存在的唯一理由）──');
{
  const cards = makeCards(2316); // 用户真实题库规模
  const { store, w } = setup({}, { strict: true });
  const info = store.setCards(cards);
  const shards = w.shardInfo();
  const maxBytes = Math.max.apply(null, shards.map((s) => s.bytes));
  const maxCards = Math.max.apply(null, shards.map((s) => s.cards));
  console.log('  总字节 ' + Math.round(info.bytes / 1024) + 'KB / ' + shards.length + ' 片 / 单片最大 '
    + Math.round(maxBytes / 1024) + 'KB・' + maxCards + ' 张');
  assert('3.1 总字节约 3.8MB（复现问题规模）', info.bytes > 3.0 * 1024 * 1024, Math.round(info.bytes / 1024) + 'KB');
  assert('3.2 单片 ≤ 700KB 预算', maxBytes <= store.CARD_SHARDS.SHARD_BUDGET_BYTES, Math.round(maxBytes / 1024) + 'KB');
  assert('3.3 单片 ≤ 1MB 硬上限（留余量）', maxBytes < 1024 * 1024, Math.round(maxBytes / 1024) + 'KB');
  assert('3.4 单片卡数 = 目标张数（片边界按下标锚定）', maxCards === store.CARD_SHARDS.SHARD_TARGET_CARDS, maxCards);
  assert('3.5 片数 = ceil(卡数 / 目标张数)', shards.length === Math.ceil(2316 / store.CARD_SHARDS.SHARD_TARGET_CARDS),
    shards.length);
  assert('3.6 体积估算与实际序列化接近', (() => {
    const real = shards.reduce((a, s) => a + s.bytes, 0);
    return Math.abs(real - info.bytes) / info.bytes < 0.05;
  })(), null);
  assert('3.7 一次复习只重写一片（约 ' + Math.round(maxBytes / 1024) + 'KB，改造前是全库 '
    + Math.round(info.bytes / 1024) + 'KB）', info.count === shards.length, null);
  assert('3.8 读回一致', store.getCards().length === 2316, store.getCards().length);
  assert('3.9 无超大分片标记', info.oversize.length === 0, info.oversize);
}

console.log('\n── 4. 超预算时的二分（异常大体积卡的兜底）──');
{
  const S = require(CS);
  const idsOf = (p) => p.shards.reduce((a, s) => a.concat(s.map((c) => c.id)), []).join(',');

  // 4a：单张卡本身就超预算 → 不可再分，必须靠 oversize 标记提前暴露
  const huge = makeCard(9999);
  huge.back = '【解析】' + FILLER.repeat(9000); // ~1.2MB
  const seq1 = [makeCard(1), huge, makeCard(2)];
  const p1 = S.plan(seq1);
  const holder = p1.shards.filter((s) => s.some((c) => c.id === huge.id));
  assert('4.1 单卡超预算时独占一片（无法再分）', holder.length === 1 && holder[0].length === 1,
    holder.map((s) => s.length));
  assert('4.2 超 1MB 的单片被 oversize 标记（提前预警，而非写完才发现失败）',
    p1.oversize.length === 1 && p1.bytes[p1.oversize[0]] > 1024 * 1024, p1.oversize);
  assert('4.3 顺序未被打乱', idsOf(p1) === seq1.map((c) => c.id).join(','), null);

  // 4b：一组小卡总量超预算 → 自动二分
  const fat = [];
  for (let i = 0; i < 60; i++) {
    const c = makeCard(20000 + i);
    c.back = '【解析】' + FILLER.repeat(115); // 约 20KB/张 → 60 张 ≈ 1.2MB，落在同一组内
    fat.push(c);
  }
  const p2 = S.plan(fat);
  const maxB2 = Math.max.apply(null, p2.bytes);
  assert('4.4 超预算的一组被自动二分', p2.shards.length > 1, p2.shards.length);
  assert('4.5 二分后每片都在预算内', maxB2 <= S.SHARD_BUDGET_BYTES, Math.round(maxB2 / 1024) + 'KB');
  assert('4.6 二分后每片都在 1MB 内', maxB2 < 1024 * 1024, Math.round(maxB2 / 1024) + 'KB');
  assert('4.7 二分不打乱顺序', idsOf(p2) === fat.map((c) => c.id).join(','), null);

  // 4c：二分只影响该组，前面的片边界不动 —— 这是「只重写 1 片」不被破坏的前提
  const head = makeCards(200);                       // 恰好一组
  const tail = [];
  for (let i = 0; i < 60; i++) {
    const c = makeCard(30000 + i);
    c.back = '【解析】' + FILLER.repeat(115);
    tail.push(c);
  }
  const p3 = S.plan(head.concat(tail));
  assert('4.8 前面那一组仍是一片（未被后面的二分波及）',
    p3.shards[0].length === 200 && p3.bytes[0] <= S.SHARD_BUDGET_BYTES, [p3.shards[0].length, Math.round(p3.bytes[0] / 1024) + 'KB']);
}

console.log('\n── 5. v1→v2 迁移（读回校验通过才删旧键）──');
{
  const legacy = makeCards(700); // 700 张 ≈ 1.1MB，正是旧结构会失败的量级
  const { store, w } = setup({ 'caq_6sigma_flashcards_v1': legacy }, { strict: true });
  const got = store.getCards();
  assert('5.1 迁移后卡片完整', got.length === 700, got.length);
  assert('5.2 已写 meta（提交点）', !!w.mem[store.KEY_CARDS_META], w.mem[store.KEY_CARDS_META]);
  assert('5.3 meta 记录了片数与总数', w.mem[store.KEY_CARDS_META].count === w.shardInfo().length
    && w.mem[store.KEY_CARDS_META].total === 700, w.mem[store.KEY_CARDS_META]);
  assert('5.4 迁移后旧版单键已删除', !w.hasLegacyKey(), Object.keys(w.mem));
  assert('5.5 分片可直接拼回', w.readCards().length === 700, w.readCards() && w.readCards().length);

  // 幂等：再读一次不应再迁移、不应再写旧键
  w.resetLog();
  const again = store.getCards();
  assert('5.6 二次读取幂等', again.length === 700 && !w.hasLegacyKey(), again.length);
  assert('5.7 二次读取不写旧键', w.writes.indexOf('caq_6sigma_flashcards_v1') < 0, w.writes);
}

console.log('\n── 6. 分片损坏：既不整库清零，也要能自愈 ──');
{
  const cards = makeCards(900);
  const { store, w } = setup({}, { strict: true });
  store.setCards(cards);
  const count = w.mem[store.KEY_CARDS_META].count;
  assert('6.1 缺陷前置：确实有多片', count >= 2, count);

  // 砍掉中间一片，且不留旧键
  const mid = Math.floor(count / 2);
  delete w.mem[store.KEY_CARDS_SHARD_PREFIX + mid];
  const v = store.verifyCardStorage();
  assert('6.2 诊断能报出缺片', v.ok === false && v.reason === 'shard-missing', v);

  const got = store.getCards();
  assert('6.3 绝不返回空库（返回 null 会被回落到默认库并覆盖）', got.length > 0, got.length);

  // 被物理删掉的那一片无法凭空恢复，但**剩余部分必须原样保住**：
  // 即「原数组去掉那一段连续切片」，顺序不乱。
  const keep = store.CARD_SHARDS.plan(cards).shards
    .filter((s, i) => i !== mid)
    .reduce((a, s) => a.concat(s), []);
  assert('6.4 剩余卡片内容与顺序完整保住', got.length === keep.length && got.every((c, i) => c.id === keep[i].id),
    (() => { for (let i = 0; i < got.length; i++) if (got[i].id !== keep[i].id) return { at: i, got: got[i].id, want: keep[i].id }; return null; })());

  // 关键：自愈后状态必须**收敛**。若 meta 仍记着 900，此后每次读取都会判为「不完整」
  // 而强制全量回写一次 —— 读一次写一次，写放大到无法接受。
  const after = store.verifyCardStorage();
  assert('6.5 自愈后状态自洽（meta.total == 实际卡数）', after.ok === true && after.cards === got.length, after);

  w.resetLog();
  store.getCards();
  assert('6.6 自愈后不再反复回写', w.shardWrites() === 0, { writes: w.writes });
}

console.log('\n── 7. 只重写真正变了的分片 ──');
{
  const cards = makeCards(1200);
  const { store, w } = setup({}, { strict: true });
  store.setCards(cards);
  const count = w.mem[store.KEY_CARDS_META].count;

  w.resetLog();
  const same = store.setCards(cards);
  assert('7.1 内容未变 → 一个分片都不写', same.wrote === 0 && w.shardWrites() === 0, { wrote: same.wrote, writes: w.writes });

  w.resetLog();
  const touched = cards.slice();
  touched[0] = Object.assign({}, touched[0], { repetitions: 3, interval: 15, state: 'review' });
  const oneChange = store.setCards(touched);
  // 恰好 1 片：片边界按下标锚定，改第一张卡不会引发后续边界级联位移。
  // （早先「塞满式」贪心切片在这里是 11/11 片全写，真机实测抓到的，见 cardShards.js 注释）
  assert('7.2 改一张卡 → 恰好只写 1 片', oneChange.wrote === 1,
    { wrote: oneChange.wrote, count: count });
  assert('7.3 跳过数 + 写入数 = 总片数', oneChange.wrote + oneChange.skipped === count,
    { wrote: oneChange.wrote, skipped: oneChange.skipped, count: count });
  assert('7.4 改动已持久化', (() => {
    const back = store.getCards();
    return back[0].repetitions === 3 && back[0].interval === 15;
  })(), null);
  assert('7.5 未改动的卡原样保留', (() => {
    const back = store.getCards();
    return back.slice(1).every((c, i) => c.id === cards[i + 1].id);
  })(), null);

  // 中间片同样只写 1 片（边界是双向稳定的，不只在两端）。
  // ⚠️ 每次都要以**当前已落库的内容**为基线做增量修改：若从最初那份 cards 出发，
  // 会把上一轮改动一并「回退」，那是两片真的有差异 → wrote=2，是测试自己写错了。
  w.resetLog();
  let cur = store.getCards();
  const midIdx = store.CARD_SHARDS.SHARD_TARGET_CARDS + 5;
  cur[midIdx] = Object.assign({}, cur[midIdx], { repetitions: 7, interval: 30, state: 'review' });
  const midChange = store.setCards(cur);
  assert('7.6 改中间片的卡 → 同样只写 1 片', midChange.wrote === 1, { wrote: midChange.wrote, count: count });
  assert('7.7 中间片改动也落库', store.getCards()[midIdx].repetitions === 7, store.getCards()[midIdx].repetitions);

  // 复习会累加 history（体积微增），同样不该引起边界级联
  w.resetLog();
  cur = store.getCards();
  cur[0] = Object.assign({}, cur[0], {
    history: [{ date: Date.now(), rating: 'good', elapsedDays: 0 }]
  });
  const growChange = store.setCards(cur);
  assert('7.8 复习累加 history 仍只写 1 片', growChange.wrote === 1, { wrote: growChange.wrote, count: count });
}

console.log('\n── 8. 分片数变少时清理残留片 ──');
{
  const many = makeCards(1200);
  const { store, w } = setup({}, { strict: true });
  store.setCards(many);
  const before = w.mem[store.KEY_CARDS_META].count;
  assert('8.1 前置：前一轮多片', before >= 3, before);

  const few = makeCards(60);
  const info = store.setCards(few);
  const P = store.KEY_CARDS_SHARD_PREFIX;
  const left = Object.keys(w.mem).filter((k) => k.indexOf(P) === 0);
  assert('8.2 片数已收敛', info.count < before, { before: before, after: info.count });
  assert('8.3 无残留片键', left.length === info.count, left);
  assert('8.4 缩容后读回只有新内容', (() => {
    const back = store.getCards();
    return back.length === 60 && back[0].id === few[0].id;
  })(), store.getCards().length);
}

console.log('\n── 8b. 真机分支：有 getStorageInfoSync 时按现存键名清扫 ──');
{
  const many = makeCards(1200);
  const { store, w } = setup({}, { strict: true });
  store.setCards(many);
  // 挂上真机才有的 API，走另一条清理分支
  w.getStorageInfoSync = function () { return { keys: Object.keys(w.mem), currentSize: 0, limitSize: 10240 }; };
  const few = makeCards(60);
  const info = store.setCards(few);
  const P = store.KEY_CARDS_SHARD_PREFIX;
  const left = Object.keys(w.mem).filter((k) => k.indexOf(P) === 0);
  assert('8b.1 该分支同样清理干净', left.length === info.count, left);
  assert('8b.2 读回正确', store.getCards().length === 60, store.getCards().length);
}

console.log('\n── 9. 写入失败必须回滚（否则一半新一半旧）──');
{
  const cards = makeCards(1200);
  const { store, w } = setup({}, { strict: true });
  store.setCards(cards);
  const snapshot = JSON.stringify(w.readCards());
  const count = w.mem[store.KEY_CARDS_META].count;

  // 全量改写（所有片都变），只让第 1 片写失败 → 第 0 片已写，必须被回滚
  const changed = cards.map((c) => Object.assign({}, c, { front: c.front + '【改】' }));
  const P = store.KEY_CARDS_SHARD_PREFIX;
  const set0 = w.setStorageSync;
  w.setStorageSync = function (k, v) {
    if (k === P + '1') throw new Error('storage quota exceeded');
    set0.call(w, k, v);
  };
  const info = store.setCards(changed);
  assert('9.1 如实报错', info.ok === false && info.reason === 'shard-write-failed', info);
  assert('9.2 标出失败片号', info.failedAt === 1, info.failedAt);
  assert('9.3 已写片被回滚（内容回到写之前）', JSON.stringify(w.readCards()) === snapshot, null);
  assert('9.4 meta 未被推进', w.mem[store.KEY_CARDS_META].count === count, w.mem[store.KEY_CARDS_META]);

  // 恢复后重试应能成功
  w.setStorageSync = set0;
  const retry = store.setCards(changed);
  assert('9.5 故障排除后重试成功', retry.ok === true, retry);
  assert('9.6 重试后内容为最新', store.getCards()[0].front.indexOf('【改】') >= 0, store.getCards()[0].front);
}

console.log('\n── 10. meta 写失败 → 全部分片回滚 ──');
{
  const cards = makeCards(600);
  const { store, w } = setup({}, { strict: true });
  store.setCards(cards);
  const snapshot = JSON.stringify(w.readCards());
  const changed = cards.map((c) => Object.assign({}, c, { state: 'review', repetitions: 1 }));

  const set0 = w.setStorageSync;
  w.setStorageSync = function (k, v) {
    if (k === store.KEY_CARDS_META) throw new Error('meta write failed');
    set0.call(w, k, v);
  };
  const info = store.setCards(changed);
  assert('10.1 报 meta 写失败', info.ok === false && info.reason === 'meta-write-failed', info);
  assert('10.2 所有已写分片已回滚', JSON.stringify(w.readCards()) === snapshot, null);
  w.setStorageSync = set0;
}

console.log('\n── 11. 总容量超限如实拒绝，不静默丢数据 ──');
{
  const cards = makeCards(1200);
  const { store, w } = setup({}, { strict: true });
  const origBudget = store.CARD_SHARDS.MAX_TOTAL_BYTES;
  store.CARD_SHARDS.MAX_TOTAL_BYTES = 1024; // 临时压到 1KB 触发守卫
  const info = store.setCards(cards);
  assert('11.1 超限 → ok:false / too-large', info.ok === false && info.reason === 'too-large', info);
  assert('11.2 超限时一个键都不写', w.writes.length === 0, w.writes);
  assert('11.3 存储保持为空（未被半量污染）', w.readCards() === null, w.readCards());
  store.CARD_SHARDS.MAX_TOTAL_BYTES = origBudget;
  assert('11.4 预算恢复后写入成功', store.setCards(cards).ok === true, null);
}

console.log('\n── 12. 空库语义与改造前一致（不因分片改变行为）──');
{
  const { store, w } = setup({}, { strict: true });
  const cleared = store.clearAllCards();
  assert('12.1 clearAllCards 返回空数组', Array.isArray(cleared) && cleared.length === 0, cleared);
  assert('12.2 空库仍写 meta（count 0）', w.mem[store.KEY_CARDS_META].count === 0, w.mem[store.KEY_CARDS_META]);
  assert('12.3 原单键语义：getCards 回落默认库（示例卡常驻）', (() => {
    const back = store.getCards();
    return back.length === 24;
  })(), store.getCards().length);
}

console.log('\n── 13. 诊断接口：未迁移时如实上报旧键存量 ──');
{
  const legacy = makeCards(30);
  const { store } = setup({ 'caq_6sigma_flashcards_v1': legacy }, { strict: true });
  const v = store.verifyCardStorage();
  assert('13.1 未迁移 → not-migrated 且报出旧键存量', v.ok === false && v.reason === 'not-migrated' && v.legacyCards === 30, v);
  assert('13.2 诊断本身不产生写入（读操作无副作用）', (() => {
    const w = global.wx;
    const before = Object.keys(w.mem).sort().join(',');
    store.verifyCardStorage();
    return Object.keys(w.mem).sort().join(',') === before;
  })(), null);
}

console.log('\n── 14. 重启（新 JS 上下文、缓存清空）后数据不丢 ──');
{
  const cards = makeCards(1200);
  const { store, w } = setup({}, { strict: true });
  store.setCards(cards);
  const persist = w.mem; // 模拟磁盘：只有存储内容带得走

  // 新上下文：重新 require store（模块级分片缓存归零），沿用一个「磁盘」
  const store2 = freshStore();
  const w2 = counting(memWx(store2, persist, { strict: true }));
  global.wx = w2;
  const back = store2.getCards();
  assert('14.1 重启后卡数守恒', back.length === 1200, back.length);
  assert('14.2 重启后顺序守恒', back.every((c, i) => c.id === cards[i].id), null);

  // 读一次即已按实际分片内容建好缓存 ⇒ 内容未变时不该产生任何写入
  w2.resetLog();
  const noop = store2.setCards(back);
  assert('14.3 重启后未改动不产生写入', noop.wrote === 0 && w2.shardWrites() === 0, { wrote: noop.wrote, writes: w2.writes });

  // 改一张卡仍应只落在受影响的那一片上（说明缓存是按片内容对齐的，不是整体失效）
  w2.resetLog();
  const touched = back.slice();
  touched[600] = Object.assign({}, touched[600], { repetitions: 2, interval: 1, state: 'review' });
  const oneChange = store2.setCards(touched);
  assert('14.4 重启后改一张卡只写 1 片', oneChange.wrote === 1,
    { wrote: oneChange.wrote, count: oneChange.count });
  assert('14.5 改动已持久化', store2.getCards()[600].repetitions === 2, store2.getCards()[600].repetitions);
}

console.log('\n── 15. 按年份分多次导入：每次只重写自己那几片 ──');
{
  // 场景：用户把真题按年份拆成多个 TXT，一个个上传（append）。
  // 守住的是「追加成本与总量无关」——若哪天切片策略被改回「按字节塞满」，
  // 每次追加都会把边界挤走、级联重写全部分片（真机实测过：11/11 片全重写）。
  const { store, w } = setup({}, { strict: true });
  // 空库读取会自动回填示例卡 + 内置题库（store.getCards 的既有语义，不是本节的被测行为）
  const baseCards = store.getCards();
  const baseN = baseCards.length;
  const baseDecks = {};
  baseCards.forEach((c) => { baseDecks[c.deck || '未命名'] = 1; });
  const baseDeckN = Object.keys(baseDecks).length;

  let wroteBytes = 0;
  const setOrig = w.setStorageSync;
  w.setStorageSync = function (k, v) { wroteBytes += store.CARD_SHARDS.byteLen(JSON.stringify(v)); setOrig.call(w, k, v); };

  const BATCH = 100, N = 12;
  let maxWrote = 0, maxBytes = 0;
  for (let b = 0; b < N; b++) {
    const batch = [];
    for (let i = 0; i < BATCH; i++) {
      const c = makeCard(b * BATCH + i);
      c.deck = String(2001 + b);
      batch.push(c);
    }
    wroteBytes = 0;
    store.importCards(batch, 'append');
    const info = store.getLastCardWrite();
    if (info.wrote > maxWrote) maxWrote = info.wrote;
    if (wroteBytes > maxBytes) maxBytes = wroteBytes;
  }

  const all = store.getCards();
  const imported = all.slice(baseN);
  assert('15.1 逐批追加不丢卡', all.length === baseN + BATCH * N, all.length);
  assert('15.2 各年份题集各自独立', (() => {
    const d = {};
    imported.forEach((c) => { d[c.deck] = (d[c.deck] || 0) + 1; });
    return Object.keys(d).length === N && Object.keys(d).every((k) => d[k] === BATCH);
  })(), imported.length);
  assert('15.3 单批最多重写 2 片（含新建片）', maxWrote <= 2, maxWrote);
  assert('15.4 单批写入量 < 700KB 单片预算', maxBytes < store.CARD_SHARDS.SHARD_BUDGET_BYTES, Math.round(maxBytes / 1024) + 'KB');
  assert('15.5 库中顺序 = 导入顺序', imported[0].deck === '2001' && imported[imported.length - 1].deck === '2012',
    [imported[0].deck, imported[imported.length - 1].deck]);
  assert('15.6 原有题集未被覆盖', (() => {
    const d = {};
    all.forEach((c) => { d[c.deck || '未命名'] = 1; });
    return Object.keys(d).length === baseDeckN + N;
  })(), null);
}

console.log('\n卡片分片存储：通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
