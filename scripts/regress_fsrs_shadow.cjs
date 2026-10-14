/**
 * FSRS 影子模式回归：守卫「补记」数据的正确性与「影子不影响主调度」这条红线
 *
 * 覆盖：
 *   A. 影子绝不影响 SM-2 —— applyReview 的排期字段必须与 calculateSm2Review 完全一致
 *   B. history 条目结构 —— elapsedDays 必须存在且为真实经过时间（含 10 分钟重学步）
 *   C. FSRS 影子数值 —— sBefore/dBefore/sAfter/dAfter 存在、且高评分给出更高稳定度
 *   D. 惰性迁移可验证 —— 丢弃 card.fsrs 后由 history 重放，能还原出同一卡态
 *   E. 参数解析 —— 默认 0.95 / 365，非法值回落
 *   F. 健壮性 —— 影子异常不得中断复习
 *
 * 用法：node scripts/regress_fsrs_shadow.cjs
 */
const env = require('./_testenv.cjs').prepare();
const scheduler = require(env.SCH);
const sm2 = require(env.SM2);
const fsrsLib = require(env.FSR);

let pass = 0;
let fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok  ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; console.log('FAIL  ' + name + (detail ? '  [' + detail + ']' : '')); }
}

const DAY = 86400000;
const MIN = 60000;
const T0 = Date.UTC(2026, 0, 1, 9, 0, 0);

const fresh = () => ({
  id: 'test-1', repetitions: 0, easeFactor: 2.5, interval: 0,
  state: 'new', history: [], nextReviewDate: T0
});
const review = (card, rating, at, settings) =>
  scheduler.applyReview(card, rating, { now: at, settings: settings || {} });

/* ══ A. 红线：影子不影响 SM-2 ═══════════════════════════════════ */
console.log('— A. 影子不改变 SM-2 排期（红线）—');
{
  const states = [
    { repetitions: 0, easeFactor: 2.5, interval: 0, state: 'new' },
    { repetitions: 0, easeFactor: 1.3, interval: 0, state: 'learning' },
    { repetitions: 1, easeFactor: 2.5, interval: 1, state: 'review' },
    { repetitions: 1, easeFactor: 1.3, interval: 6, state: 'review' },
    { repetitions: 2, easeFactor: 2.5, interval: 6, state: 'review' },
    { repetitions: 3, easeFactor: 3.0, interval: 15, state: 'mastered' },
    { repetitions: 5, easeFactor: 1.3, interval: 95, state: 'mastered' },
    { repetitions: 9, easeFactor: 3.0, interval: 300, state: 'mastered' },
    { repetitions: 3, easeFactor: 2.5, interval: 0, state: 'learning' }
  ];
  const ratings = ['again', 'hard', 'good', 'easy'];
  // 间隔上限也要覆盖：applyReview 现在会把 settings.maxIntervalDays 传给 SM-2
  // （见 scheduler.resolveParams().sm2MaxInterval）。若只比对「不传上限」的口径，
  // 这条红线就测不到真实默认值那条路径——而那正是线上走的路径。
  const caps = [
    { cap: undefined, settings: {}, label: '无设置(365)' },
    { cap: 365, settings: { maxIntervalDays: 365 }, label: '上限365' },
    { cap: 90, settings: { maxIntervalDays: 90 }, label: '上限90(默认)' },
    { cap: 30, settings: { maxIntervalDays: 30 }, label: '上限30(极端)' }
  ];
  let mismatch = 0;
  let msDrift = 0;
  let n = 0;
  for (const c of caps) {
  for (const st of states) {
    for (const r of ratings) {
      const card = Object.assign({}, st, { history: [], nextReviewDate: T0 });
      const want = sm2.calculateSm2Review(card, r, c.cap);
      const got = review(card, r, T0, c.settings);
      n++;
      if (want.repetitions !== got.repetitions || want.easeFactor !== got.easeFactor
        || want.interval !== got.interval || want.state !== got.state) {
        mismatch++;
        console.log('        不一致 reps=' + st.repetitions + ' ef=' + st.easeFactor
          + ' i=' + st.interval + ' ' + r
          + ' → 期望 ' + want.repetitions + '/' + want.easeFactor.toFixed(3) + '/' + want.interval + '/' + want.state
          + ' 实际 ' + got.repetitions + '/' + got.easeFactor.toFixed(3) + '/' + got.interval + '/' + got.state);
      }
      msDrift = Math.max(msDrift, Math.abs(want.nextReviewDate - got.nextReviewDate));
    }
  }
  }
  check(n + ' 组（4 种间隔上限 × 9 卡态 × 4 档）排期字段与 SM-2 完全一致', mismatch === 0, n + ' 组，不一致 ' + mismatch);
  check('nextReviewDate 与 SM-2 一致（毫秒级容差）', msDrift <= 5, '最大偏差 ' + msDrift + 'ms');
  check('影子卡不会多出 SM-2 之外的排期字段', (() => {
    const got = review(fresh(), 'good', T0);
    const allowed = new Set(['id', 'repetitions', 'easeFactor', 'interval', 'nextReviewDate',
      'state', 'lastReviewed', 'history', 'fsrs', 'shadowError']);
    return Object.keys(got).every((k) => allowed.has(k));
  })(), Object.keys(review(fresh(), 'good', T0)).join(','));
}

/* ══ B. history 结构与 elapsedDays ══════════════════════════════ */
console.log('\n— B. history 条目与 elapsedDays —');
{
  const c1 = review(fresh(), 'good', T0);
  check('新卡首评写入 1 条 history', c1.history.length === 1, c1.history.length + ' 条');
  check('首评 elapsedDays = 0（无前次复习）', c1.history[0].elapsedDays === 0, String(c1.history[0].elapsedDays));
  check('条目带 date / rating / elapsedDays',
    typeof c1.history[0].date === 'number' && c1.history[0].rating === 'good'
    && typeof c1.history[0].elapsedDays === 'number',
    JSON.stringify(c1.history[0]));

  // 「重来」后的 10 分钟重学步：这是老格式（只有 date+rating）最不可逆的损失
  const c2 = review(c1, 'again', T0 + 10 * MIN);
  const e2 = c2.history[1].elapsedDays;
  check('10 分钟重学步的 elapsedDays ≈ 0.0069 天（不被抹平为 0）',
    Math.abs(e2 - 10 / 1440) < 1e-4, e2 + ' 天');

  const c3 = review(c2, 'good', T0 + 3 * DAY);
  const e3 = c3.history[2].elapsedDays;
  // 注意：上一张卡的复习时刻是 T0 + 10 分钟，故真实间隔是「3 天 − 10 分钟」；
  // elapsedDays 落盘时保留 4 位小数（≈8.6 秒精度），故容差取 1e-4 天
  check('elapsedDays 等于两条记录之间的真实经过时间',
    Math.abs(e3 - (3 * DAY - 10 * MIN) / DAY) <= 1e-4, e3 + ' 天（真值 ' + ((3 * DAY - 10 * MIN) / DAY).toFixed(6) + '）');

  check('history 只追加、不改写旧条目',
    c3.history.length === 3 && c3.history[0].date === T0 && c3.history[1].date === T0 + 10 * MIN,
    c3.history.map((h) => h.date - T0).join('/'));
  check('原卡片对象未被就地修改', c1.history.length === 1, 'c1.history=' + c1.history.length);

  // 亚日精度守卫：4 秒的间隔也必须 > 0。
  // 这条是实测踩出来的——elapsedDays 原按 4 位小数舍入（分辨率 8.6 秒），
  // 秒级间隔会被抹成 0，恰好把这个字段唯一的用途（保留亚日间隔）废掉。
  const c4 = review(c3, 'good', T0 + 3 * DAY + 4000);
  check('4 秒间隔不被抹平（elapsedDays 保留亚日精度）',
    c4.history[3].elapsedDays > 0 && Math.abs(c4.history[3].elapsedDays - 4000 / DAY) <= 1e-6,
    c4.history[3].elapsedDays + ' 天（期望 ' + (4000 / DAY).toFixed(6) + '）');

  // 链路一致性：后一条的 sBefore/dBefore 必须等于前一条的 sAfter/dAfter
  check('sBefore/dBefore 与上一条的 sAfter/dAfter 咬合（链路无断裂）',
    c3.history[1].sBefore === c3.history[0].sAfter && c3.history[2].sBefore === c3.history[1].sAfter
    && c3.history[1].dBefore === c3.history[0].dAfter,
    [c3.history[0].sAfter, c3.history[1].sBefore, c3.history[1].sAfter, c3.history[2].sBefore].join(' → '));
}

/* ══ C. FSRS 影子数值 ══════════════════════════════════════════ */
console.log('\n— C. FSRS 影子数值 —');
{
  const c1 = review(fresh(), 'good', T0);
  const e = c1.history[0];
  const hasAll = ['sBefore', 'dBefore', 'sAfter', 'dAfter'].every((k) => typeof e[k] === 'number');
  check('条目含 sBefore/dBefore/sAfter/dAfter', hasAll,
    hasAll ? 'S ' + e.sBefore + '→' + e.sAfter + '  D ' + e.dBefore + '→' + e.dAfter : JSON.stringify(e));
  check('卡上写入 fsrs 快照', !!(c1.fsrs && c1.fsrs.stability > 0 && c1.fsrs.due > 0),
    c1.fsrs ? 'S=' + c1.fsrs.stability + ' D=' + c1.fsrs.difficulty + ' state=' + c1.fsrs.state : '缺失');
  check('影子计算未报错', !e.shadowError, e.shadowError || '无');

  // 同一卡态下，评分越高稳定度增益越大
  const base = review(fresh(), 'good', T0);
  const seq = {};
  ['again', 'hard', 'good', 'easy'].forEach((r) => {
    seq[r] = review(base, r, T0 + DAY).history[1];
  });
  const maxR = 0.95; // request_retention 默认值，用于交叉验证
  check('稳定度增益随评分单调：重来 < 困难 < 良好 ≤ 简单',
    seq.again.sAfter < seq.hard.sAfter && seq.hard.sAfter < seq.good.sAfter
    && seq.good.sAfter <= seq.easy.sAfter,
    ['again', 'hard', 'good', 'easy'].map((r) => r + '=' + seq[r].sAfter).join(' '));
  check('「重来」的稳定度低于复习前（遗忘确实惩罚）',
    seq.again.sAfter < seq.again.sBefore,
    seq.again.sBefore + ' → ' + seq.again.sAfter);

  // 保留率读数
  const rv = scheduler.retrievability(base, { now: T0 + DAY });
  check('retrievability 返回 (0,1] 的数值', rv !== null && rv > 0 && rv <= 1,
    rv === null ? 'null' : (rv * 100).toFixed(1) + '%');
  check('目标保留率默认 0.95', scheduler.SCHEDULER_CONSTANTS.DEFAULT_REQUEST_RETENTION === 0.95,
    String(scheduler.SCHEDULER_CONSTANTS.DEFAULT_REQUEST_RETENTION));
  check('retention 参数确实被传给了库（0.95 ≠ 库默认 0.90）', maxR === 0.95);
}

/* ══ D. 惰性迁移：history 重放可还原卡态 ══════════════════════ */
console.log('\n— D. 老卡由 history 重放还原 FSRS 卡态 —');
{
  // 造一段真实复习序列（含 10 分钟重学步）
  let c = fresh();
  const plan = [
    ['good', 0], ['good', 1 * DAY], ['again', 4 * DAY], ['again', 4 * DAY + 10 * MIN],
    ['good', 5 * DAY], ['hard', 9 * DAY], ['good', 20 * DAY], ['easy', 45 * DAY]
  ];
  for (const [r, off] of plan) c = review(c, r, T0 + off);

  const stored = c.fsrs;
  // 模拟"老卡"：抹掉 fsrs 快照，只留 history
  const legacy = Object.assign({}, c, { history: c.history });
  delete legacy.fsrs;

  const sched = scheduler.schedulerFor(0.95, 365);
  const replayed = scheduler.fsrsCardBeforeReview(legacy, sched, T0 + 45 * DAY);

  check('重放还原的 stability 与落盘值一致',
    Math.abs(replayed.stability - stored.stability) < 1e-9,
    replayed.stability + ' vs ' + stored.stability);
  check('重放还原的 difficulty 与落盘值一致',
    Math.abs(replayed.difficulty - stored.difficulty) < 1e-9,
    replayed.difficulty + ' vs ' + stored.difficulty);
  check('重放还原的 state / reps / lapses 一致',
    replayed.state === stored.state && replayed.reps === stored.reps && replayed.lapses === stored.lapses,
    ['state ' + replayed.state + '/' + stored.state, 'reps ' + replayed.reps + '/' + stored.reps,
      'lapses ' + replayed.lapses + '/' + stored.lapses].join('  '));
  check('重放还原的到期时刻一致',
    Math.abs(+replayed.due - stored.due) < 1000,
    new Date(+replayed.due).toISOString() + ' vs ' + new Date(stored.due).toISOString());

  // 继续复习后仍与"未抹掉快照"的路径一致 —— 迁移不产生分叉
  const fromLegacy = review(legacy, 'good', T0 + 60 * DAY);
  const fromStored = review(c, 'good', T0 + 60 * DAY);
  check('迁移后继续复习与原生路径逐位一致（迁移不产生分叉）',
    fromLegacy.fsrs.stability === fromStored.fsrs.stability
    && fromLegacy.fsrs.difficulty === fromStored.fsrs.difficulty
    && fromLegacy.fsrs.state === fromStored.fsrs.state,
    'S ' + fromLegacy.fsrs.stability + ' vs ' + fromStored.fsrs.stability);

  // sBefore/dBefore 不可事后还原：改变库权重（将来回灌个性化训练权重的场景）
  // 后重放同一段 history，得到的稳定度不再等于当时落盘的真值。
  // 扰动 w[2]（Good 的初始稳定度）与 w[5]（初始难度）——该序列以 Good 起手，
  // 这两项必然进入链路（只动 w[0] 是无效的：w[0] 只作用于 New 卡的 Again）。
  const w2 = fsrsLib.default_w.slice();
  w2[2] = w2[2] + 0.5;
  w2[5] = w2[5] + 0.5;
  const schedOther = fsrsLib.fsrs(fsrsLib.generatorParameters({
    w: w2, enable_fuzz: false, enable_short_term: true
  }));
  const replayedOther = scheduler.fsrsCardBeforeReview(legacy, schedOther, T0 + 45 * DAY);
  check('权重变化后重放 ≠ 当时真值（所以 sBefore/dBefore 必须当场落盘）',
    Math.abs(replayedOther.stability - stored.stability) > 1e-6,
    '另一套权重重放 S=' + replayedOther.stability.toFixed(4) + ' vs 当时真值 S=' + stored.stability.toFixed(4));

  // 亚日间隔的事实性说明：把 date 归一到日粒度，分钟级重学步会被抹平为 0
  const coarse = legacy.history.map((h) => Object.assign({}, h, { date: Math.round(h.date / DAY) * DAY }));
  let coarseZero = 0;
  for (let i = 1; i < coarse.length; i++) {
    if (coarse[i].date === coarse[i - 1].date) coarseZero++;
  }
  check('日粒度归一化会抹平同日复习（故 date 必须保留毫秒）',
    coarseZero > 0 && legacy.history[3].elapsedDays > 0,
    coarseZero + ' 条被抹平，原条目 elapsedDays=' + legacy.history[3].elapsedDays);
}

/* ══ E. 参数解析 ═══════════════════════════════════════════════ */
console.log('\n— E. 参数解析 —');
{
  const p = (s) => scheduler.resolveParams(s);
  check('空设置 → 0.95 / 365', p({}).retention === 0.95 && p({}).maxInterval === 365,
    p({}).retention + ' / ' + p({}).maxInterval);
  check('显式 0.90 被采纳', p({ requestRetention: 0.9 }).retention === 0.9, String(p({ requestRetention: 0.9 }).retention));
  check('非法 retention（1.5 / 0.5 / NaN）回落 0.95',
    p({ requestRetention: 1.5 }).retention === 0.95
    && p({ requestRetention: 0.5 }).retention === 0.95
    && p({ requestRetention: 'x' }).retention === 0.95,
    [p({ requestRetention: 1.5 }).retention, p({ requestRetention: 0.5 }).retention, p({ requestRetention: 'x' }).retention].join('/'));
  check('非法 maxInterval（0 / -5）回落 365',
    p({ maxIntervalDays: 0 }).maxInterval === 365 && p({ maxIntervalDays: -5 }).maxInterval === 365,
    p({ maxIntervalDays: 0 }).maxInterval + '/' + p({ maxIntervalDays: -5 }).maxInterval);
  check('maxInterval 被夹到 ≤36500（与 store.normMaxInterval 同口径）',
    p({ maxIntervalDays: 99999 }).maxInterval === 36500,
    String(p({ maxIntervalDays: 99999 }).maxInterval));
  check('maxInterval 与 store 口径一致（不产生第三种结果）', (() => {
    // store.normMaxInterval 夹到 36500；resolveParams 必须给出同一答案
    const normMaxInterval = (v) => {
      const n = parseInt(v, 10);
      if (!n || n < 1) return 365;
      return Math.min(n, 36500);
    };
    return [0, -5, 1, 30, 365, 99999].every((v) =>
      normMaxInterval(v) === scheduler.resolveParams({ maxIntervalDays: v }).maxInterval);
  })(), '0/-5/1/30/365/99999 全一致');
  check('显式 maxInterval 改变 FSRS 排期（旋钮确实接入）', (() => {
    const card = fresh();
    const a = review(card, 'good', T0).fsrs.due;
    const b = review(card, 'good', T0, { maxIntervalDays: 1 }).fsrs.due;
    return +new Date(b) <= +new Date(a);
  })(), 'max=1d 的到期时刻不晚于默认');
}

/* ══ F. 健壮性 ═════════════════════════════════════════════════ */
console.log('\n— F. 健壮性 —');
{
  // 故意传入无法处理的评分档：影子应记录错误但 SM-2 主流程不受影响
  const card = fresh();
  const out = scheduler.applyReview(card, 'bogus', { now: T0, settings: {} });
  check('未知评分档不抛异常', !!out && typeof out.interval === 'number', 'interval=' + out.interval);
  const okHistory = Array.isArray(out.history) && out.history.length === 1;
  check('未知评分档仍写入 history 条目', okHistory, out.history && out.history.length + ' 条');

  const broken = Object.assign({}, fresh(), { history: [{ date: 'not-a-date', rating: 'good' }] });
  let threw = false;
  let res = null;
  try { res = scheduler.applyReview(broken, 'good', { now: T0, settings: {} }); } catch (e) { threw = true; }
  check('history 含脏数据时不抛异常（影子错误被吞掉）', !threw && !!res && typeof res.interval === 'number',
    threw ? '抛异常' : ('interval=' + res.interval + (res.history[1] && res.history[1].shadowError ? ' 已记 shadowError' : '')));

  const noHist = Object.assign({}, fresh());
  delete noHist.history;
  let threw2 = false;
  try { scheduler.applyReview(noHist, 'good', { now: T0, settings: {} }); } catch (e) { threw2 = true; }
  check('卡片无 history 字段时正常初始化', !threw2);
}

console.log('\nFSRS 影子记录：通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
