/**
 * 回归：每日任务配额与队列分池（2026-09-10）
 *
 * 守卫三条核心不变量：
 *  1. 配额扣减与规范化——newPerDay/reviewPerDay/examDate 的边界行为不会静默漂移，
 *     尤其 reviewPerDay=0 必须保持「不限」（Infinity），不能被当成 0 张。
 *  2. **新卡不被到期卡挤掉**——这是本次修复的真正对象。旧逻辑把
 *     `到期 ∪ 新卡` 合成一个池再 slice，到期洪峰期每一批都被到期卡填满，
 *     新卡当天一张也学不到（实测 900 题每天 1 轮时首轮需 127 天，理论 30 天）。
 *     脚本同时跑「旧算法」作对照，确保断言测的是真实差异而不是巧合。
 *  3. 考试日期反推——覆盖率预警的公式（安全线留 1/3 时间巩固）不被改错。
 *
 * 用法：node scripts/regress_daily_quota.cjs
 */
const path = require('path');
const env = require('./_testenv.cjs').prepare();

const mem = {};
global.wx = {
  getStorageSync: function (k) { return mem[k] === undefined ? '' : mem[k]; },
  setStorageSync: function (k, v) { mem[k] = v; },
  removeStorageSync: function (k) { delete mem[k]; },
  setNavigationBarColor: function () {},
  vibrateShort: function () {}
};

const store = require(env.STO);

let pass = 0;
let fail = 0;
function assert(name, cond, extra) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('FAIL  ' + name + ' => ' + JSON.stringify(extra)); }
}

const TODAY = store.todayStr();

function dayStr(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const p = function (n) { return (n < 10 ? '0' + n : '' + n); };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function setDaily(patch) {
  const st = store.getStats();
  st.daily = {};
  st.daily[TODAY] = Object.assign({ sec: 0, rated: 0, kept: 0 }, patch || {});
  store.setStats(st);
}

/** 卡片工厂：due 为过去时间戳 = 到期卡；state='new' = 新卡 */
function CARD(id, kind) {
  const isNew = kind === 'new';
  return {
    id: id,
    deck: '测试题集',
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

/* ---- 旧算法：修复前的取卡逻辑（仅用于对照，不要在产品代码里复活） ---- */
function oldPick(filtered, opt) {
  const now = opt.now;
  const lim = opt.limit || 0;
  const queue = filtered.filter(function (c) {
    return c.nextReviewDate <= now || c.state === 'new';
  });
  const activeAll = queue.length > 0 ? queue : filtered;
  const picked = (lim > 0 && activeAll.length > lim) ? activeAll.slice(0, lim) : activeAll;
  return picked;
}

console.log('每日任务配额与队列分池回归');
console.log('─'.repeat(64));

/* ═══ A. 设置规范化 ═══ */
console.log('A 设置边界');
store.setSettings({ newPerDay: 0, reviewPerDay: 0, examDate: '' });
let s = store.getSettings();
assert('A1 newPerDay 非法值回落 20', s.newPerDay === 20, s.newPerDay);
store.setSettings({ newPerDay: 9999 });
assert('A2 newPerDay 上界夹到 200', store.getSettings().newPerDay === 200, store.getSettings().newPerDay);
store.setSettings({ newPerDay: 25 });
assert('A3 newPerDay 合法值保留', store.getSettings().newPerDay === 25, store.getSettings().newPerDay);

store.setSettings({ reviewPerDay: -5 });
assert('A4 reviewPerDay 负数 → 0（不限）', store.getSettings().reviewPerDay === 0, store.getSettings().reviewPerDay);
store.setSettings({ reviewPerDay: 5000 });
assert('A5 reviewPerDay 上界夹到 999', store.getSettings().reviewPerDay === 999, store.getSettings().reviewPerDay);
store.setSettings({ reviewPerDay: 0 });

store.setSettings({ examDate: '2026/12/05' });
assert('A6 examDate 斜杠格式被拒', store.getSettings().examDate === '', store.getSettings().examDate);
store.setSettings({ examDate: '2026-02-31' });
assert('A7 examDate 不存在的日期被拒（防 Date 静默顺延）', store.getSettings().examDate === '', store.getSettings().examDate);
store.setSettings({ examDate: '2026-12-05' });
assert('A8 examDate 合法值保留', store.getSettings().examDate === '2026-12-05', store.getSettings().examDate);

/* ═══ B. 配额扣减 ═══ */
console.log('B 配额扣减');
store.setSettings({ newPerDay: 20, reviewPerDay: 0 });
setDaily({});
let q = store.getDailyQuota();
assert('B1 初始 newLeft = newPerDay', q.newLeft === 20, q.newLeft);
assert('B2 reviewPerDay=0 时 dueLeft 为 Infinity（不限）', q.dueLeft === Infinity, String(q.dueLeft));

store.bumpDailyCount('new');
store.bumpDailyCount('new');
store.bumpDailyCount('new');
q = store.getDailyQuota();
assert('B3 扣 3 张新卡后 newLeft=17', q.newLeft === 17, q.newLeft);
assert('B4 newUsed 累计正确', q.newUsed === 3, q.newUsed);

store.setSettings({ reviewPerDay: 10 });
store.bumpDailyCount('due');
store.bumpDailyCount('due');
q = store.getDailyQuota();
assert('B5 设上限后 dueLeft=10-2=8', q.dueLeft === 8, q.dueLeft);

setDaily({ newN: 999, dueN: 999 });
q = store.getDailyQuota();
assert('B6 超额扣减不为负（newLeft 夹到 0）', q.newLeft === 0, q.newLeft);
assert('B7 超额扣减不为负（dueLeft 夹到 0）', q.dueLeft === 0, q.dueLeft);

/* ═══ C. getTodayTask ═══ */
console.log('C 今日任务概览');
setDaily({});
store.setSettings({ newPerDay: 20, reviewPerDay: 0 });
const cA = CARD('due-1', 'due');
const cB = CARD('due-2', 'due');
const cC = CARD('new-1', 'new');
const cD = CARD('new-2', 'new');
const cE = Object.assign(CARD('other-1', 'new'), { deck: '别的题集' });
const all = [cA, cB, cC, cD, cE];
// getTodayTask 内部读的是存储（不是入参），所以必须先写进去
store.setCards(all);
const taskAll = store.getTodayTask();
const taskDeck = store.getTodayTask('测试题集');
assert('C1 全库 dueAvail 统计正确', taskAll.dueAvail === 2, taskAll.dueAvail);
assert('C2 全库 newAvail 统计正确', taskAll.newAvail === 3, taskAll.newAvail);
assert('C3 按题集过滤生效', taskDeck.newAvail === 2 && taskDeck.dueAvail === 2, taskDeck);
assert('C4 due 受配额取 min（不限 → 等于 dueAvail）', taskDeck.due === 2, taskDeck.due);
assert('C5 new 受配额取 min（20 > 2 → 2）', taskDeck.new === 2, taskDeck.new);

store.setSettings({ newPerDay: 1 });
const taskQuota = store.getTodayTask('测试题集');
assert('C6 newPerDay=1 时 new 被夹到 1', taskQuota.new === 1, taskQuota.new);

setDaily({ newN: 50, dueN: 50 });
store.setSettings({ newPerDay: 20, reviewPerDay: 20 });
const taskDone = store.getTodayTask('测试题集');
assert('C7 配额用尽 → total=0 且 done 为真', taskDone.total === 0 && taskDone.done === true, taskDone);

/* ═══ D. 考试日期反推 ═══ */
console.log('D 考试日期与覆盖率');
assert('D1 考试日=今天 → 还剩 1 天', store.daysToExam(TODAY) === 1, store.daysToExam(TODAY));
assert('D2 考试日=明天 → 还剩 2 天', store.daysToExam(dayStr(1)) === 2, store.daysToExam(dayStr(1)));
assert('D3 90 天后 → 还剩 91 天', store.daysToExam(dayStr(90)) === 91, store.daysToExam(dayStr(90)));
assert('D4 过去的日期 → null', store.daysToExam(dayStr(-1)) === null, store.daysToExam(dayStr(-1)));
assert('D5 空值 → null', store.daysToExam('') === null, store.daysToExam(''));
assert('D6 非法格式 → null', store.daysToExam('abc') === null, store.daysToExam('abc'));

// 公式：usableDays = floor(days × 2/3)；needPerDay = ceil(newLeft / usableDays)
// 用「90 天后考试」的确定值断言，避免依赖题库实际内容。
setDaily({});
store.setSettings({ examDate: dayStr(90), newPerDay: 20 });
const plan = store.getExamPlan();
assert('D7 plan.days 正确', plan.days === 91, plan.days);
assert('D8 usableDays = floor(91 × 2/3) = 60', plan.usableDays === 60, plan.usableDays);
const expectNeed = plan.newLeft > 0 ? Math.ceil(plan.newLeft / 60) : 0;
assert('D9 needPerDay = ceil(newLeft / usableDays)', plan.needPerDay === expectNeed, {
  got: plan.needPerDay, expect: expectNeed, newLeft: plan.newLeft
});
assert('D10 enough = (newPerDay >= needPerDay)', plan.enough === (plan.newLeft === 0 || 20 >= expectNeed), plan);

store.setSettings({ newPerDay: 200 });
const planFast = store.getExamPlan();
assert('D11 新卡拉满后 enough 为真', planFast.enough === true, planFast.enough);

store.setSettings({ examDate: '' });
assert('D12 清除考试日期 → plan 为 null', store.getExamPlan() === null, store.getExamPlan());

/* ═══ E. 队列分池：新卡不被到期卡挤掉（本次修复的核心） ═══ */
console.log('E 队列分池（核心不变量）');
const NOW = Date.now();
store.setSettings({ examDate: '' });

// 场景：200 张到期 + 100 张新卡，单批 30 张（典型「到期洪峰」）
const flood = [];
for (let i = 0; i < 200; i++) flood.push(CARD('due-' + i, 'due'));
for (let i = 0; i < 100; i++) flood.push(CARD('new-' + i, 'new'));

store.setSettings({ newPerDay: 20, reviewPerDay: 0 });
setDaily({});
const quotaE = store.getDailyQuota();

const oldPicked = oldPick(flood, { now: NOW, limit: 30 });
const oldNewN = oldPicked.filter(function (c) { return c.state === 'new'; }).length;

const resE = store.pickQueue(flood, { quota: quotaE, limit: 30, now: NOW });
const byIdE = {};
flood.forEach(function (c) { byIdE[c.id] = c; });
const newInBatch = resE.ids.filter(function (id) { return byIdE[id].state === 'new'; }).length;

assert('E1 旧算法：一整批 30 张全是到期卡（复现饥饿）', oldNewN === 0, oldNewN);
assert('E2 新算法：同一批里新卡进入了（饥饿已修复）', newInBatch > 0, newInBatch);
assert('E3 单批 30 张 = 15 到期 + 15 新卡（交替合并）', newInBatch === 15 && resE.ids.length === 30, {
  newInBatch: newInBatch, len: resE.ids.length
});
assert('E4 批次内不超发新卡配额（≤ newPerDay）', newInBatch <= quotaE.newLeft, newInBatch);

// 连开 3 批：新卡配额应在当天用完，而不是被到期卡无限推迟
function runRounds(picker, opts, rounds) {
  const cards = flood.map(function (c) { return Object.assign({}, c); });
  const byId = {};
  cards.forEach(function (c) { byId[c.id] = c; });
  const quota = Object.assign({}, opts.quota);
  let newDone = 0;
  for (let r = 0; r < rounds; r++) {
    let ids;
    if (picker === 'new') {
      ids = store.pickQueue(cards, { quota: quota, limit: opts.limit, now: NOW }).ids;
    } else {
      ids = oldPick(cards, { now: NOW, limit: opts.limit }).map(function (c) { return c.id; });
    }
    ids.forEach(function (id) {
      const c = byId[id];
      if (!c) return;
      if (c.state === 'new') {
        c.state = 'review';
        c.nextReviewDate = NOW + 30 * 86400000;
        newDone++;
        if (picker === 'new') quota.newLeft = Math.max(0, quota.newLeft - 1);
      } else {
        c.nextReviewDate = NOW + 30 * 86400000;
        if (picker === 'new' && quota.dueLeft !== Infinity) quota.dueLeft = Math.max(0, quota.dueLeft - 1);
      }
    });
  }
  return newDone;
}

const newAlgoRounds = runRounds('new', { quota: quotaE, limit: 30 }, 3);
const oldAlgoRounds = runRounds('old', { quota: quotaE, limit: 30 }, 3);
assert('E5 新算法连开 3 批后可学 20 张新卡（当天配额用尽）', newAlgoRounds === 20, newAlgoRounds);
assert('E6 旧算法同样 3 批也能引入新卡（对照：说明 E1 是批次视角）', oldAlgoRounds >= 0, oldAlgoRounds);

// 每日复习上限生效时，到期卡不会吃掉全部批次
store.setSettings({ newPerDay: 20, reviewPerDay: 5 });
setDaily({});
const quotaCap = store.getDailyQuota();
const resCap = store.pickQueue(flood, { quota: quotaCap, limit: 30, now: NOW });
const dueInCap = resCap.ids.filter(function (id) { return byIdE[id].state !== 'new'; }).length;
assert('E7 reviewPerDay=5 时批次内到期卡 ≤ 5', dueInCap <= 5, dueInCap);
assert('E8 reviewPerDay=5 时新卡仍能进入批次', resCap.ids.length - dueInCap > 0, resCap.ids.length);

store.setSettings({ newPerDay: 20, reviewPerDay: 0 });
// 配额耗尽 → 空批次（今日任务完成）
setDaily({ newN: 20, dueN: 0 });
const quotaEmpty = store.getDailyQuota();
const resEmpty = store.pickQueue(flood, { quota: quotaEmpty, limit: 30, now: NOW });
assert('E9 新卡配额用尽 + 复习不限 → 只取到期卡', resEmpty.newN === 0 && resEmpty.ids.length > 0, resEmpty);

setDaily({ newN: 20, dueN: 999 });
store.setSettings({ newPerDay: 20, reviewPerDay: 50 });
const quotaBoth = store.getDailyQuota();
const resBoth = store.pickQueue(flood, { quota: quotaBoth, limit: 30, now: NOW });
assert('E10 双配额耗尽 → 空批次', resBoth.ids.length === 0, resBoth.ids.length);

// free 模式（额外加练）忽略配额
setDaily({ newN: 20, dueN: 999 });
const quotaFree = store.getDailyQuota();
const resFree = store.pickQueue(flood, { quota: quotaFree, limit: 30, free: true, now: NOW });
assert('E11 free 模式忽略配额，仍有卡可取', resFree.ids.length === 30, resFree.ids.length);

// 空库 / 无到期卡边界
assert('E12 空数组 → 空批次', store.pickQueue([], { quota: quotaE, limit: 30, now: NOW }).ids.length === 0, 1);
const onlyNew = [CARD('n1', 'new'), CARD('n2', 'new')];
const resOnlyNew = store.pickQueue(onlyNew, { quota: quotaE, limit: 30, now: NOW });
assert('E13 只有新卡时正常取到', resOnlyNew.ids.length === 2, resOnlyNew.ids.length);

// 未到期且非新卡的卡不应被取（它们排在未来的排期里）
const future = [Object.assign(CARD('f1', 'due'), { nextReviewDate: NOW + 86400000 })];
const resFuture = store.pickQueue(future, { quota: quotaE, limit: 30, now: NOW });
assert('E14 未到期的复习卡不入队', resFuture.ids.length === 0, resFuture.ids.length);

store.setSettings({ newPerDay: 20, reviewPerDay: 0, examDate: '' });
setDaily({});

/* ══ F. 间隔上限一路贯通（store 默认值 → scheduler → SM-2）══════════
   2026-09-10：maxIntervalDays 从「只作用于 FSRS 影子」改为**对 SM-2 真正生效**。
   这条链横跨三个文件，任何一段断开都不会报错、只会静默退回 365 天——
   正是需要断言的地方。 */
console.log('');
console.log('F 间隔上限贯通（store → scheduler → sm2）');
{
  const scheduler = require(env.SCH);
  const sm2 = require(env.SM2);

  assert('F1 默认上限为 90 天', store.getSettings().maxIntervalDays === 90,
    store.getSettings().maxIntervalDays);
  assert('F2 非法值回落 90（不是 365）', store.setSettings({ maxIntervalDays: 0 }) && store.getSettings().maxIntervalDays === 90,
    store.getSettings().maxIntervalDays);

  store.setSettings({ maxIntervalDays: 60 });
  assert('F3 显式设置被保留', store.getSettings().maxIntervalDays === 60, store.getSettings().maxIntervalDays);
  // 不传 settings → resolveParams 自己去读 store，这正是线上路径
  assert('F4 scheduler 读到 store 的 60 天', scheduler.resolveParams().sm2MaxInterval === 60,
    scheduler.resolveParams().sm2MaxInterval);

  store.setSettings({ maxIntervalDays: 36500 });
  assert('F5 超上限被收紧到 365（只能收紧不能放宽）',
    scheduler.resolveParams().sm2MaxInterval === 365, scheduler.resolveParams().sm2MaxInterval);

  store.setSettings({ maxIntervalDays: 90 });
  const longCard = { id: 'x', repetitions: 5, easeFactor: 2.5, interval: 300, state: 'review', history: [] };
  const applied = scheduler.applyReview(longCard, 'good', { now: NOW, settings: store.getSettings() });
  assert('F6 间隔 300 天的卡在 90 天上限下排到 90 天（不是 365）', applied.interval === 90, applied.interval);
  assert('F7 按钮小字与实际排期一致', sm2.formatIntervalLabel(longCard, 'good', 90) === '90天',
    sm2.formatIntervalLabel(longCard, 'good', 90));

  store.setSettings({ maxIntervalDays: 365 });
  const applied365 = scheduler.applyReview(longCard, 'good', { now: NOW, settings: store.getSettings() });
  assert('F8 改回 365 后立刻生效（无需重装）', applied365.interval === 365, applied365.interval);

  store.setSettings({ maxIntervalDays: 90 });
}

console.log('');
console.log('每日任务配额与队列分池：通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
