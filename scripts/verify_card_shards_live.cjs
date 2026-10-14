/**
 * 卡片分片存储「端到端」实测（需开发者工具处于自动化模式，非无头环境）
 *
 * 前置：
 *   /Applications/wechatwebdevtools.app/Contents/MacOS/cli quit
 *   /Applications/wechatwebdevtools.app/Contents/MacOS/cli auto \
 *     --project <abs>/miniprogram --auto-port 9440
 *   NODE_PATH=~/.workbuddy/binaries/node/workspace/node_modules \
 *     node scripts/verify_card_shards_live.cjs
 *
 * 为什么必须在真实运行时里验一次：单 key 1MB 是**真机才强制**的限制，
 * 开发者工具模拟器可以正常往返 3.8MB，所以单元/回归脚本永远测不出这个问题。
 * 本脚本覆盖的都是纸上推不出来的东西：
 *   1. 2316 张（约 3.8MB）是否真的写得进去 —— 改造前这里必然抛错
 *   2. 跨分片拼接后页面拿到的卡数是否正确（顺序、不多不少）
 *   3. 答题一次之后进度是否真的落库，以及**只重写了几片**
 *   4. 老版本 App 升级上来的现场（只有旧版单键）能否自动迁移并删掉旧键
 *
 * 脚本会临时把题库换成大题库，结束后**自动还原**；中途异常退出请手动检查存储。
 * 不纳入 run_all.sh（run_all 必须可在无头环境跑）。
 */
const automator = require('miniprogram-automator');
const fs = require('fs');
const path = require('path');

const ROOT = '/Users/jackyzhao/Documents/Myapp/CAQ-tester/CAQ--main';
const OUT = path.join(ROOT, '.workbuddy/screenshots');
const KEY_SETTINGS = 'caq_6sigma_settings_v1';
const PORT = process.env.WS_PORT || process.env.AUTO_PORT || 9440;

const { makeCardIO } = require('./_liveenv.cjs');

let pass = 0;
let fail = 0;
const check = (n, c, d) => {
  if (c) { pass++; console.log('  ok  ' + n + (d !== undefined ? '  [' + d + ']' : '')); }
  else { fail++; console.log('FAIL  ' + n + (d !== undefined ? '  [' + d + ']' : '')); }
};

// 逼近真实体积：实测均值 1.66KB（含解析 HTML）
const FILLER = '六西格玛管理的核心是减少过程变异并持续改进，DMAIC 各阶段需明确交付物与测量指标；过程能力指数 Cpk 同时考虑中心偏移与固有波动。';
function mkCard(i) {
  return {
    id: 'e2e-shard-' + (1757400000 + i),
    deck: 'E2E分片验证题集',
    qNo: String(i + 1),
    front: '(单选) ' + (i + 1) + '.六西格玛管理强调以（）为关注焦点，下列说法不正确的是（）。',
    back: '【答案】A<br/>【解析】' + FILLER.repeat(9),
    options: ['A. 顾客与过程结果的符合性', 'B. 过程能力与规格限的对比关系', 'C. 供应商管理与来料检验策略', 'D. 员工满意度调查的执行周期'],
    correctAnswer: 'A',
    cardType: 'single_choice',
    tags: ['E2E'],
    stage: 'overview',
    interval: 0, repetitions: 0, easeFactor: 2.5, nextReviewDate: Date.now(), state: 'new'
  };
}

(async () => {
  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:' + PORT });
  const io = makeCardIO(mp);
  const read = (k) => mp.evaluate((key) => wx.getStorageSync(key), k);
  const write = (k, v) => mp.evaluate((key, val) => { wx.setStorageSync(key, val); return true; }, k, v);

  /** 各分片内容指纹：用来判断「答题一次到底重写了几片」 */
  const shardHashes = () => mp.evaluate((metaKey, prefix) => {
    const m = wx.getStorageSync(metaKey);
    if (!m) return [];
    const out = [];
    for (let i = 0; i < Number(m.count); i++) {
      const s = JSON.stringify(wx.getStorageSync(prefix + i) || []);
      let h = 5381;
      for (let j = 0; j < s.length; j++) h = ((h * 33) ^ s.charCodeAt(j)) >>> 0;
      out.push(h);
    }
    return out;
  }, io.META_KEY, io.SHARD_KEY_PREFIX);

  const backup = { cards: await io.readCards(), settings: await read(KEY_SETTINGS) };
  console.log('  已备份原题库 ' + backup.cards.length + ' 张（脚本结束会还原）');

  try {
    /* ── 1. 大题库写入：改造前必然失败的场景 ── */
    const BIG = 2316;
    const big = [];
    for (let i = 0; i < BIG; i++) big.push(mkCard(i));
    const p = io.S.plan(big);
    console.log('  拟写入 ' + BIG + ' 张 / ' + Math.round(p.totalBytes / 1024) + 'KB / ' + p.shards.length + ' 片');

    const t0 = Date.now();
    await io.writeCards(big);
    const writeMs = Date.now() - t0;

    let v = await io.verify();
    check('分片写入成功（改造前 3.8MB 落在单键上必然抛错）', v.ok === true,
      JSON.stringify({ count: v.count, cards: v.cards, expected: v.expected }));
    check('落库卡数正确', v.cards === BIG, v.cards + ' / ' + BIG);
    check('确实切成多片', v.count > 1, v.count + ' 片');
    check('单片未超 1MB 硬上限', v.maxShardBytes < 1024 * 1024, Math.round(v.maxShardBytes / 1024) + 'KB 最大片');
    check('单片在 700KB 预算内', v.maxShardBytes <= io.S.SHARD_BUDGET_BYTES, Math.round(v.maxShardBytes / 1024) + 'KB');
    check('单片卡数 = 目标张数（片边界按下标锚定）', v.maxShardCards === io.S.SHARD_TARGET_CARDS, v.maxShardCards + ' 张');
    check('旧版单键未被占用', v.legacyPresent === false, v.legacyPresent);
    console.log('  写入耗时 ' + writeMs + 'ms；小程序存储占用 '
      + v.storageInfo.currentSizeKB + 'KB / 上限 ' + v.storageInfo.limitSizeKB + 'KB，共 '
      + v.storageInfo.keys + ' 个键');

    /* ── 2. 真实运行时读回：跨分片拼接后的卡数 ── */
    let page = await mp.reLaunch('/pages/anki/index');
    await page.waitFor(3000);
    let d = await page.data();
    check('首页读到大题库（跨分片拼接）', d.totalCards === BIG, d.totalCards + ' / ' + BIG);
    check('题集列表按 deck 聚合', (d.deckList || []).length > 0,
      (d.deckList || []).map((x) => x.name + ':' + x.count).join(' / '));
    check('今日任务可计算（大数据量下未超时）', !!d.todayTask,
      d.todayTask ? '到期 ' + d.todayTask.due + ' / 新卡 ' + d.todayTask.new : 'null');

    if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
    try {
      await mp.screenshot({ path: path.join(OUT, 'shard_big_bank_home.png') });
      console.log('  截图：.workbuddy/screenshots/shard_big_bank_home.png');
    } catch (e) { console.log('  （截图跳过：' + (e && e.message) + '）'); }

    /* ── 3. 答题一次：进度落库 + 只重写少数分片 ── */
    let deckRow = null;
    for (const r of await page.$$('.card-box')) {
      if ((await r.text()).indexOf('›') >= 0) { deckRow = r; break; }
    }
    check('题集行可点', !!deckRow);
    if (deckRow) {
      await deckRow.tap();
      await page.waitFor(2000);
      d = await page.data();
      const target = Object.assign({}, d.current);
      const idx = big.findIndex((c) => c.id === target.id);
      const hashesBefore = await shardHashes();

      await page.setData({
        session: {
          deck: d.currentDeck, total: 1, limit: 1, passed: [], pending: [target.id],
          batchIds: [target.id], updatedAt: Date.now()
        },
        current: target, flipped: true
      });
      await page.waitFor(500);
      await page.callMethod('onRate', { currentTarget: { dataset: { rating: 'good' } } });
      await page.waitFor(1200);

      const after = await io.readCards();
      const now = after[idx];
      check('答题后进度真的落库（分片未丢写入）',
        !!now && now.repetitions === (target.repetitions || 0) + 1,
        now ? 'reps ' + target.repetitions + ' → ' + now.repetitions + ' / i=' + now.interval : 'card missing');
      check('答题后题库仍是全量', after.length === BIG, after.length + ' / ' + BIG);
      check('答题后卡片顺序未乱', after.every((c, i) => c.id === big[i].id), null);

      const hashesAfter = await shardHashes();
      let changed = 0;
      for (let i = 0; i < hashesAfter.length; i++) if (hashesBefore[i] !== hashesAfter[i]) changed++;
      // 恰好 1 片：片边界按下标锚定。早先「塞满式」贪心切片在这里是 11/11 片全写，
      // 一次复习重写 5MB —— 这条断言就是那次真机实测固化下来的。
      check('一次答题只重写 1 片（改造前是全库 3.8MB 重写）', changed === 1,
        changed + ' / ' + hashesAfter.length + ' 片被重写');

      v = await io.verify();
      check('答题后分片状态依旧自洽', v.ok === true, JSON.stringify({ cards: v.cards, expected: v.expected }));
    }

    /* ── 4. 升级现场：只有旧版单键 → 自动迁移 ── */
    {
      const legacy = [];
      for (let i = 0; i < 500; i++) legacy.push(mkCard(90000 + i)); // ~800KB，旧结构下能写进去的上限附近
      await write(io.LEGACY_KEY, legacy);
      // 抹掉分片元数据，模拟「老版本 App 升级上来」的现场
      await mp.evaluate((k) => { wx.removeStorageSync(k); return true; }, io.META_KEY);

      page = await mp.reLaunch('/pages/anki/index');
      await page.waitFor(3000);
      v = await io.verify();
      check('升级现场自动迁移到分片', v.ok === true && v.cards === 500,
        JSON.stringify({ ok: v.ok, cards: v.cards, expected: v.expected, reason: v.reason }));
      check('迁移后旧版单键已删除', v.legacyPresent === false, v.legacyPresent);
      check('迁移后不留残缺片', v.count === v.perShard.length, v.count + ' 声明 / ' + v.perShard.length + ' 实际');
      d = await page.data();
      check('迁移后页面读到全部卡片', d.totalCards === 500, d.totalCards + ' / 500');
    }
  } finally {
    // 还原：先把原题库写回分片，再复原设置
    await io.writeCards(backup.cards || []);
    if (backup.settings !== undefined && backup.settings !== '') await write(KEY_SETTINGS, backup.settings);
    const back = await io.verify();
    console.log('\n  已还原题库 ' + (back.cards || 0) + ' 张 / ' + (back.count || 0) + ' 片；'
      + '设置已复原；遗留旧键 ' + (back.legacyPresent ? '是（需手动清理）' : '否'));
  }

  console.log('\n分片存储端到端：通过 ' + pass + ' / 失败 ' + fail);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('脚本异常：', e && e.message ? e.message : e);
  process.exit(1);
});
