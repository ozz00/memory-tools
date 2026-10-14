/**
 * SM-2 调度「端到端」实测（需开发者工具处于自动化模式，非无头环境）
 *
 * 前置：
 *   /Applications/wechatwebdevtools.app/Contents/MacOS/cli auto \
 *     --project <abs>/miniprogram --auto-port 9420
 *   （首次常报 wait IDE port timeout，原样重试一次即可）
 *   npm i miniprogram-automator --prefix ~/.workbuddy/binaries/node/workspace
 *   NODE_PATH=~/.workbuddy/binaries/node/workspace/node_modules node 本脚本
 *
 * 覆盖脚本单测覆盖不到的部分：评分按钮小字的真实渲染值、点击「良好」后
 * 真正落库的 interval/repetitions、FSRS 影子字段是否真的写进存储
 * （证明预打包的 fsrs.js 能在真实小程序运行时里被 require 起来）、
 * 设置页弹窗是否已同步新文案。
 *
 * 注意：脚本会临时把受测卡片设为「唯一队列」并连续评分三次，结束后**自动还原**
 * 该卡片原始字段；若中途异常退出，请检查 miniprogram 存储中该卡是否残留。
 * 不纳入 run_all.sh（run_all 必须可在无头环境跑）。
 */
const automator = require('miniprogram-automator');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = '/Users/jackyzhao/Documents/Myapp/CAQ-tester/CAQ--main';
const OUT = path.join(ROOT, '.workbuddy/screenshots');
// 卡片自 2026-09-10 起为分片存储，不再写在单一 key 上：
// 直接读旧键会静默拿到空，卡片相关读写一律走 _liveenv 的语义化接口。
const { makeCardIO } = require('./_liveenv.cjs');
const KEY_SETTINGS = 'caq_6sigma_settings_v1';
// 端口可通过环境变量覆盖：项目里同时存在 9420（布局验证）与 9430（配额验证）两套自动化端口，
// 写死端口会导致「明明 IDE 开着却连不上」。
const PORT = process.env.WS_PORT || '9420';
const TMP = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'caq_e2e_')), 'sm2.cjs');
fs.copyFileSync(path.join(ROOT, 'miniprogram/utils/sm2.js'), TMP);
const sm2 = require(TMP);

let pass = 0, fail = 0;
const check = (n, c, d) => { if (c) { pass++; console.log('  ok  ' + n + (d ? '  [' + d + ']' : '')); } else { fail++; console.log('FAIL  ' + n + (d ? '  [' + d + ']' : '')); } };

(async () => {
  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:' + PORT });
  const io = makeCardIO(mp);
  const readCards = io.readCards;
  const writeCards = io.writeCards;
  const readSettings = () => mp.evaluate((k) => wx.getStorageSync(k), KEY_SETTINGS);

  // 先取「规范化后的」设置：store.getSettings() 会给缺失字段补默认值（如 maxIntervalDays→90）。
  // ⚠️ 直接读原始存储会拿到 undefined，从而把有效上限误判成 365 天。
  let NORMALIZED_MAX = null;
  {
    const sp = await mp.reLaunch('/pages/settings/index');
    await sp.waitFor(1600);
    NORMALIZED_MAX = (await sp.data()).maxIntervalDays;
    console.log('  规范化后的间隔上限 = ' + NORMALIZED_MAX + ' 天（原始存储：'
      + JSON.stringify((await readSettings() || {}).maxIntervalDays) + '）');
  }

  let page = await mp.reLaunch('/pages/anki/index');
  await page.waitFor(2000);
  let d = await page.data();
  check('首页题集列表非空', (d.deckList || []).length > 0, '题集 ' + (d.deckList || []).length + ' 个 / 卡片 ' + d.totalCards + ' 张');

  let deckRow = null;
  for (const r of await page.$$('.card-box')) { if ((await r.text()).indexOf('›') >= 0) { deckRow = r; break; } }
  check('题集行可点', !!deckRow);
  await deckRow.tap();
  await page.waitFor(1800);

  const before = await readCards();
  check('可读取本地卡片存储', Array.isArray(before) && before.length > 0, before.length + ' 张');

  d = await page.data();
  const target = Object.assign({}, before.find((c) => c.id === d.current.id));
  const idx = before.findIndex((c) => c.id === target.id);
  console.log('  受测卡片：' + target.id + '（原始 reps=' + target.repetitions + ' i=' + target.interval + ' ef=' + target.easeFactor + '）');

  // 只保留这一张在队列里，从而能对同一张卡连续评分观察间隔爬升
  const sequence = [target.interval];
  for (let step = 1; step <= 3; step++) {
    d = await page.data();
    const card = Object.assign({}, d.current);
    await page.setData({ session: { deck: d.currentDeck, total: 1, limit: 1, passed: [], pending: [card.id], batchIds: [card.id], updatedAt: Date.now() }, current: card, flipped: true });
    await page.waitFor(400);
    const beforeHints = (await page.data()).ratings.map((r) => r.hint).join(' ');
    await page.callMethod('onRate', { currentTarget: { dataset: { rating: 'good' } } });
    await page.waitFor(900);

    const cards = await readCards();
    const now = cards[idx];
    // 期望值由算法按评分前的真实卡态算出（EF 会因历史评分漂移，不能写死 6×2.5）。
    // ⚠️ 间隔上限必须传：页面走的是 store.getSettings().maxIntervalDays（默认 90），
    // 漏传会让这条断言在卡片间隔逼近上限时假失败。
    const cap = sm2.resolveMaxDays(NORMALIZED_MAX);
    const want = sm2.calculateSm2Review(card, 'good', cap);
    const storedOK = now.repetitions === want.repetitions && now.interval === want.interval;
    check('第 ' + step + ' 次评「良好」→ 落库 reps=' + want.repetitions + ' interval=' + want.interval + ' 天',
      storedOK, '实际 reps=' + now.repetitions + ' i=' + now.interval + ' ef=' + Number(now.easeFactor).toFixed(2));
    sequence.push(now.interval);
    console.log('     评分前按钮小字：' + beforeHints);

    // —— FSRS 影子记录：跑在真实小程序运行时里，若预打包的 fsrs.js 加载不了、
    //    或 scheduler.js 的 require 链路有问题，这里会直接看出来 ——
    const lastH = now.history && now.history[now.history.length - 1];
    if (step === 1) {
      check('真实运行时内 fsrs 快照已落库（预打包单文件 require 成功）',
        !!(now.fsrs && now.fsrs.stability > 0 && now.fsrs.due > 0),
        now.fsrs ? 'S=' + Number(now.fsrs.stability).toFixed(3) + ' D=' + Number(now.fsrs.difficulty).toFixed(2)
          + ' state=' + now.fsrs.state : '缺失');
      check('shadowError 未出现', !!lastH && !lastH.shadowError, (lastH && lastH.shadowError) || '无');
    }
    if (step === 3) {
      const keys = ['elapsedDays', 'sBefore', 'dBefore', 'sAfter', 'dAfter'];
      check('history 条目含 elapsedDays + sBefore/dBefore/sAfter/dAfter',
        !!lastH && keys.every((k) => typeof lastH[k] === 'number'),
        lastH ? JSON.stringify(lastH) : '无条目');
      check('elapsedDays 为真实经过时间（>0，且远小于 1 天；未按日粒度抹平）',
        !!lastH && lastH.elapsedDays > 0 && lastH.elapsedDays < 1,
        lastH ? lastH.elapsedDays + ' 天（本次评分间隔约 1 秒）' : 'n/a');
      check('history 累积了 3 条以上（只追加不改写）',
        Array.isArray(now.history) && now.history.length >= 3,
        (now.history || []).length + ' 条');
    }

    if (step < 3) {
      // 把更新后的卡片放回队首，模拟它再次到期
      await page.setData({ session: { deck: d.currentDeck, total: 1, limit: 1, passed: [], pending: [now.id], batchIds: [now.id], updatedAt: Date.now() }, current: now, flipped: true });
      await page.callMethod('refresh');
      await page.waitFor(700);
      await page.setData({ current: now, flipped: true });
      await page.waitFor(500);
    }
  }
  check('同一张卡连续「良好」的间隔满足 1 < 第二步 < 第三步（爬升）',
    sequence[1] === 1 && sequence[2] >= 6 && sequence[3] > sequence[2],
    sequence.slice(1).join(' → ') + ' 天');

  /* ── 间隔上限在真实运行时内贯通（store → scheduler → SM-2 → 存储）──
     把受测卡的间隔人为拉到 300 天再评「良好」：上限若没生效会落库 365 天，
     而不是设置里的值。这条链横跨三个文件，任一段断开都只是「静默退回 365」，
     不会报错，所以必须在真实运行时里断言一次。 */
  {
    const cards2 = await readCards();
    const c2 = cards2[idx];
    const cap = sm2.resolveMaxDays(NORMALIZED_MAX);
    const forced = Object.assign({}, c2, {
      interval: 300, repetitions: 5, state: 'review',
      nextReviewDate: Date.now() - 1000, history: c2.history || []
    });
    await page.setData({
      session: { deck: d.currentDeck, total: 1, limit: 1, passed: [], pending: [forced.id], batchIds: [forced.id], updatedAt: Date.now() },
      current: forced, flipped: true
    });
    await page.waitFor(500);
    await page.callMethod('onRate', { currentTarget: { dataset: { rating: 'good' } } });
    await page.waitFor(1000);
    const capped = (await readCards())[idx];
    check('真实运行时内间隔上限生效（设置 ' + cap + ' 天，原间隔 300 天）', capped.interval === cap,
      '落库 ' + capped.interval + ' 天（上限 ' + cap + '，若未生效会是 365）');
    check('落库间隔 ≤ 设置上限', capped.interval <= cap, capped.interval + ' ≤ ' + cap);
  }

  // 还原受测卡片（分片布局下按 id 替换，不能按下标改「那个大数组」了）
  await io.replaceCard(target);
  const restored = (await readCards())[idx];
  check('受测卡片已还原', restored.repetitions === target.repetitions && restored.interval === target.interval,
    'reps=' + restored.repetitions + ' i=' + restored.interval);

  // 设置页弹窗文案
  const sp = await mp.reLaunch('/pages/settings/index');
  await sp.waitFor(1800);
  for (const r of await sp.$$('.row')) { if ((await r.text()).indexOf('SM-2') >= 0) { await r.tap(); break; } }
  await sp.waitFor(1200);
  fs.mkdirSync(OUT, { recursive: true });
  await mp.screenshot({ path: path.join(OUT, 'sm2_modal_top.png') });
  await sp.setData({ scrollAnchor: 'modal-footer-anchor' });
  await sp.waitFor(1400);
  await mp.screenshot({ path: path.join(OUT, 'sm2_modal_bottom.png') });
  const body = await (await sp.$('.modal-body')).text();
  check('弹窗文案已同步（6 天 / 均值回归 / 365 天 / 间隔上限）',
    body.indexOf('6 天') >= 0 && body.indexOf('回归') >= 0 && body.indexOf('365 天') >= 0
    && body.indexOf('间隔上限') >= 0 && body.indexOf('考试日之后') >= 0);
  check('间隔上限段写明当前值（90 天）', body.indexOf('90 天') >= 0);
  check('不再出现旧的「1 天 → 3 天」序列', body.indexOf('1 天 → 3 天') < 0);
  check('不再出现错误的「良好：EF +0.15」', !/良好[^。]{0,12}EF \+0\.15/.test(body));

  await mp.disconnect();
  console.log('\n端到端实测：通过 ' + pass + ' / 失败 ' + fail);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('ERROR ' + (e && e.message)); process.exit(1); });
