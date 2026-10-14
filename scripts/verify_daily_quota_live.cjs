/**
 * 每日任务配额「端到端」实测（需开发者工具处于自动化模式，非无头环境）
 *
 * 前置：
 *   /Applications/wechatwebdevtools.app/Contents/MacOS/cli auto \
 *     --project <abs>/miniprogram --auto-port 9430
 *   （首次常报 wait IDE port timeout，原样重试一次即可）
 *   NODE_PATH=~/.workbuddy/binaries/node/workspace/node_modules node 本脚本
 *
 * 覆盖脚本单测覆盖不到的部分：真实渲染层里首页「今日任务」卡片是否出得来、
 * 配额是否真的限制了真实队列的新卡数（pickQueue 在真实运行时里跑通）。
 *
 * 安全性：会**备份并还原** settings 与 stats（今日学习记录），不动 cards。
 * 不纳入 run_all.sh（run_all 必须可在无头环境跑）。
 */
const automator = require('miniprogram-automator');
const fs = require('fs');
const path = require('path');

const ROOT = '/Users/jackyzhao/Documents/Myapp/CAQ-tester/CAQ--main';
const OUT = path.join(ROOT, '.workbuddy/screenshots');
const KEY_SETTINGS = 'caq_6sigma_settings_v1';
const KEY_STATS = 'caq_6sigma_user_stats_v1';
// 卡片自 2026-09-10 起为分片存储，不再写在单一 key 上：
// 直接读写旧键会静默拿到空 / 写了个没人读的键，卡片一律走 _liveenv 的语义化接口。
const { makeCardIO } = require('./_liveenv.cjs');
// 端口可通过环境变量覆盖（WS_PORT 优先，兼容旧的 AUTO_PORT）：项目里同时存在
// 9420 / 9430 / 9440 多套自动化端口，写死会导致「明明 IDE 开着却连不上」。
const PORT = process.env.WS_PORT || process.env.AUTO_PORT || 9430;

let pass = 0;
let fail = 0;
function check(n, c, d) {
  if (c) { pass++; console.log('  ok  ' + n + (d !== undefined ? '  [' + d + ']' : '')); }
  else { fail++; console.log('FAIL  ' + n + (d !== undefined ? '  [' + d + ']' : '')); }
}

function dayStr(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const p = function (n) { return (n < 10 ? '0' + n : '' + n); };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

/** 构造测试卡：isNew=true 为未学新卡，否则为已到期需复习的卡 */
function mkCard(id, isNew) {
  return {
    id: id,
    deck: 'E2E分池验证',
    front: '题干' + id,
    back: '答案：A',
    options: ['A. x', 'B. y'],
    correctAnswer: 'A',
    cardType: 'single_choice',
    interval: 0,
    repetitions: 0,
    easeFactor: 2.5,
    nextReviewDate: isNew ? 0 : Date.now() - 86400000,
    state: isNew ? 'new' : 'review'
  };
}

(async () => {
  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:' + PORT });
  const read = (k) => mp.evaluate((key) => wx.getStorageSync(key), k);
  const write = (k, v) => mp.evaluate((key, val) => { wx.setStorageSync(key, val); return true; }, k, v);
  const io = makeCardIO(mp);

  const backup = {
    settings: await read(KEY_SETTINGS),
    stats: await read(KEY_STATS),
    cards: await io.readCards()
  };

  try {
    /* ── 1. 首页：今日任务卡片是否真的渲染出来 ── */
    let page = await mp.reLaunch('/pages/anki/index');
    await page.waitFor(2200);
    let d = await page.data();

    check('首页 todayTask 已计算', !!d.todayTask,
      d.todayTask ? '到期 ' + d.todayTask.due + ' / 新卡 ' + d.todayTask.new : 'null');
    check('首页 todayDone 为数字', typeof d.todayDone === 'number', d.todayDone);
    check('首页 quota.newPerDay 有默认值', d.todayTask && d.todayTask.quota &&
      d.todayTask.quota.newPerDay > 0, d.todayTask && d.todayTask.quota && d.todayTask.quota.newPerDay);

    const pageEl = await page.$('.page');
    const txt = pageEl ? await pageEl.text() : '';
    check('今日任务卡片已渲染到 DOM', txt.indexOf('今日任务') >= 0);
    check('三宫格标签渲染（到期复习/新卡/今日已做）',
      txt.indexOf('到期复习') >= 0 && txt.indexOf('新卡') >= 0 && txt.indexOf('今日已做') >= 0);

    if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
    try {
      await mp.screenshot({ path: path.join(OUT, 'daily_task_home.png') });
      console.log('  截图：.workbuddy/screenshots/daily_task_home.png');
    } catch (e) { console.log('  （截图跳过：' + (e && e.message) + '）'); }

    /* ── 2. 配额是否真的限制了真实队列的新卡数 ── */
    const cards = await io.readCards();
    console.log('  本地题库 ' + cards.length + ' 张，其中新卡 ' + cards.filter((c) => c.state === 'new').length + ' 张');

    // 真实题库有未学卡时直接用它；只有示例卡（≤100 张且已无新卡）时，
    // 临时构造「到期洪峰 + 新卡」——不这么做就测不到分池（示例卡没有新卡可被挤）。
    let testCards = cards;
    let synthetic = false;
    if (cards.length <= 100 && !cards.some((c) => c.state === 'new')) {
      testCards = [];
      for (let i = 0; i < 60; i++) testCards.push(mkCard('e2e-due-' + i, false));
      for (let i = 0; i < 40; i++) testCards.push(mkCard('e2e-new-' + i, true));
      await io.writeCards(testCards);
      synthetic = true;
      console.log('  （无真实题库 → 临时构造 60 张到期 + 40 张新卡来验证分池，结束会还原）');
    }

    if (testCards.length > 0 && testCards.some((c) => c.state === 'new')) {
      // 清空今日配额记录 + 把新卡上限压到 5，看真实队列是否照做
      const st = await read(KEY_STATS) || {};
      const today = dayStr(0);
      st.daily = st.daily || {};
      st.daily[today] = { sec: 0, rated: 0, kept: 0 };
      await write(KEY_STATS, st);
      const s0 = await read(KEY_SETTINGS) || {};
      await write(KEY_SETTINGS, Object.assign({}, s0, { newPerDay: 5, reviewPerDay: 0 }));

      page = await mp.reLaunch('/pages/anki/index');
      await page.waitFor(2200);
      d = await page.data();
      check('newPerDay=5 已读到首页', d.todayTask && d.todayTask.quota.newPerDay === 5,
        d.todayTask && d.todayTask.quota.newPerDay);
      check('首页新卡余额被夹到 5', d.todayTask && d.todayTask.new <= 5, d.todayTask && d.todayTask.new);

      // 定位目标题集行（构造场景下是 E2E 题集；真实题库则取第一个题集）
      let row = null;
      for (const r of await page.$$('.card-box')) {
        const t = await r.text();
        if (t.indexOf('›') < 0 || t.indexOf('今日任务') >= 0) continue;
        if (!synthetic || t.indexOf('E2E') >= 0) { row = r; break; }
      }
      check('找到可点击的题集行', !!row);
      if (row) {
        await row.tap();
        await page.waitFor(2000);
        d = await page.data();
        const batchIds = (d.session && d.session.batchIds) || [];
        const byId = {};
        testCards.forEach((c) => { byId[c.id] = c; });
        const newInBatch = batchIds.filter((id) => byId[id] && byId[id].state === 'new').length;
        const dueInBatch = batchIds.length - newInBatch;
        check('本轮批次非空', batchIds.length > 0, batchIds.length + ' 张');
        check('批内新卡数 ≤ 每日新卡上限 5', newInBatch <= 5, newInBatch + ' 张新卡');
        check('批内新卡数 > 0 —— 新卡未被到期卡挤掉（本次修复的核心）',
          newInBatch > 0, '新卡 ' + newInBatch + ' / 到期 ' + dueInBatch);

        // 连续做完整批：新卡配额当天应用完，而不是被 60 张到期卡无限推迟
        await page.callMethod('continueToday');
        await page.waitFor(1500);
        d = await page.data();
        console.log('  （第二批队列 ' + (((d.session && d.session.batchIds) || []).length) + ' 张，用于人工确认配额连续性）');
      }
    } else {
      console.log('  （跳过配额实测：题库为空）');
    }

    /* ── 3. 设置页：三项设置与覆盖率预警 ── */
    page = await mp.reLaunch('/pages/settings/index');
    await page.waitFor(2000);
    d = await page.data();
    check('设置页读到 newPerDay', typeof d.newPerDay === 'number', d.newPerDay);
    check('设置页读到 reviewPerDay', typeof d.reviewPerDay === 'number', d.reviewPerDay);
    check('设置页有 todayStr（date picker 下限）', /^\d{4}-\d{2}-\d{2}$/.test(d.todayStr || ''), d.todayStr);

    // 写入一个 90 天后的考试日期，看预警是否出现
    const s1 = await read(KEY_SETTINGS) || {};
    await write(KEY_SETTINGS, Object.assign({}, s1, { examDate: dayStr(90) }));
    page = await mp.reLaunch('/pages/settings/index');
    await page.waitFor(2000);
    d = await page.data();
    check('考试日期已回填 UI', d.examDate === dayStr(90), d.examDate);
    check('examDays 计算正确（91 天）', d.examDays === 91, d.examDays);
    check('examPlan 已生成', !!d.examPlan,
      d.examPlan ? '待学新卡 ' + d.examPlan.newLeft + ' / 需每天 ' + d.examPlan.needPerDay : 'null');

    const sEl = await page.$('.page');
    const sTxt = sEl ? await sEl.text() : '';
    check('设置页渲染出「每日任务配额」行', sTxt.indexOf('每日任务配额') >= 0);
    check('设置页渲染出「考试日期」行', sTxt.indexOf('考试日期') >= 0);
    check('设置页渲染出「单批卡片数」行', sTxt.indexOf('单批卡片数') >= 0);
    if (d.examPlan && !d.examPlan.enough) {
      check('覆盖率不足时渲染红色预警行', sTxt.indexOf('过不完首轮') >= 0);
    } else {
      console.log('  （当前题库在 90 天内可学完，未触发预警行 —— 属正常分支）');
    }
  } finally {
    // 还原 cards / settings / stats（构造场景下 cards 会被临时替换）。
    // ⚠️ 必须无条件写回：首次运行时备份可能是空串/falsy，若用 `if (backup.x)` 守卫，
    // 还原会被整段跳过，测试值就永久留在用户存储里（实测踩到，首页残留「距考试 91 天」）。
    await io.writeCards(backup.cards || []);
    await write(KEY_SETTINGS, backup.settings || {});
    await write(KEY_STATS, backup.stats || {});
    await mp.reLaunch('/pages/anki/index');
    console.log('  已还原 cards / settings / stats');
  }

  console.log('');
  console.log('每日任务配额端到端：通过 ' + pass + ' / 失败 ' + fail);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('端到端脚本异常：', e && e.message);
  process.exit(1);
});
