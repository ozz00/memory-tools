/**
 * 调度门面（scheduler）：SM-2 主调度 + FSRS 影子记录
 *
 * ── 为什么要有这一层 ──────────────────────────────────────────────
 * 1. 页面只调 applyReview()，将来切换调度算法只改这个文件，页面零改动。
 * 2. FSRS 目前处于「影子模式」：**只计算、只落盘，不参与任何排期决策**。
 *    实际生效的仍是 SM-2（settings.scheduler 固定 'sm2'）。
 * 3. 每次复习把 FSRS 将来必需的上下文写进 history —— 这就是"现在就补记"的落点。
 *
 * ── 为什么必须现在记，不能等切算法时再补 ──────────────────────────
 * history 原先只存 {date, rating}。看着"能重放"，实际有两处不可逆损失：
 *   a) elapsedDays：卡片「重来」后走 10 分钟重学步，同一天内多次复习。
 *      若日后按"相邻 date 相减"推算，同日的分钟级间隔会被抹平成 0 天，
 *      而 FSRS 的 elapsed_days 正是决定稳定度增益的自变量 —— 差值不是精度问题，
 *      是"这一档数据永久错掉"。
 *   b) sBefore / dBefore：复习**前**的稳定度/难度。事后重放虽然能逼近，
 *      但一旦算法版本或参数变过，重放值就不再等于当时的真实值。
 *      记下当时的真值，是让将来那次迁移"可验证"的唯一办法。
 * 注意：history 全项目**只写不读**（可 grep 验证），扩展其字段零风险。
 *
 * ── 不变量（回归脚本 regress_fsrs_shadow.cjs 守着）───────────────
 * 1. 影子计算**绝不影响** SM-2 结果：applyReview 返回的 repetitions /
 *    easeFactor / interval / nextReviewDate / state 必须与直接调用
 *    sm2.calculateSm2Review **传入同一个间隔上限**完全一致。
 *    （上限来自 resolveParams().sm2MaxInterval，默认 90 天。）
 * 2. 每条 history 条目必须带 elapsedDays；FSRS 可用时必须带 sBefore/dBefore。
 * 3. 影子出错不得中断复习：异常被吞掉并记在条目的 shadowError 上，主流程照常。
 * 4. 惰性迁移可验证：对老卡（card.fsrs 缺失）重放 history 得到的 S/D，
 *    必须等于继续复习后落盘的 sAfter/dAfter。
 */
const sm2 = require('./sm2.js');
const fsrsLib = require('./fsrs.js');

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * FSRS 目标参数。
 * 备考场景默认 request_retention = 0.95，而非库默认的 0.90：
 * r=0.90 时末次复习会停在第 59 天，与第 180 天的考试之间空 121 天，
 * 用户心理上无法接受；0.95 把这个空窗压到可接受范围。
 */
const DEFAULT_REQUEST_RETENTION = 0.95;
const DEFAULT_MAX_INTERVAL_DAYS = 365;

/** 本项目的评分档 → FSRS Rating（Again=1 / Hard=2 / Good=3 / Easy=4） */
const RATING_TO_FSRS = {
  again: fsrsLib.Rating.Again,
  hard: fsrsLib.Rating.Hard,
  good: fsrsLib.Rating.Good,
  easy: fsrsLib.Rating.Easy
};

/* ── 工具 ───────────────────────────────────────────────────────── */

function round4(n) {
  return Math.round(n * 1e4) / 1e4;
}

/**
 * elapsedDays 用 6 位小数（分辨率约 0.086 秒），而不是 4 位。
 * 理由：这个字段的用途是保留**亚日间隔**——10 分钟重学步 = 0.0069 天，
 * 4 位小数虽能表示，但秒级间隔会被抹成 0，而它的成本只有每条约 2 字节。
 * sBefore/sAfter 这类模型量仍用 4 位：FSRS 稳定度的第 5 位没有实际意义，
 * 且它们的完整精度保存在 card.fsrs 里（那里不做舍入）。
 */
function round6(n) {
  return Math.round(n * 1e6) / 1e6;
}

/** fsrs() 实例较重，按参数签名缓存（页面里每次复习都要用） */
const _schedulerCache = {};
function schedulerFor(retention, maxInterval) {
  const key = retention + '@' + maxInterval;
  if (!_schedulerCache[key]) {
    _schedulerCache[key] = fsrsLib.fsrs(
      fsrsLib.generatorParameters({
        request_retention: retention,
        maximum_interval: maxInterval,
        // 影子模式必须关掉随机抖动：同一卡态要得到同一结果，否则回归无法断言，
        // 也会让 sBefore/dBefore 在「只重放不复习」时对不上。
        enable_fuzz: false,
        enable_short_term: true
      })
    );
  }
  return _schedulerCache[key];
}

/**
 * FSRS 参数 + SM-2 间隔上限。
 * 优先级：显式传入 > 用户设置 > 默认值（显式传入是为了让回归脚本不依赖 wx 存储）。
 *
 * 两个 maxInterval 的关系：
 *   - maxInterval（FSRS 的 maximum_interval）允许到 36500，是库的原始语义；
 *   - sm2MaxInterval 则是**实际生效**的那个——SM-2 自身有 365 天硬天花板，
 *     所以取 min(maxInterval, 365)，只能收紧不能放宽。
 * 合并成一个入口是为了让「设置里那个数字」只解析一次：
 * 两处各写一套夹取逻辑，绕过 store 写入的值就会得到第三种结果。
 */
function resolveParams(settings) {
  let s = settings;
  if (!s) {
    try {
      s = require('./store.js').getSettings() || {};
    } catch (e) {
      s = {};
    }
  }
  const r = Number(s.requestRetention);
  const m = Number(s.maxIntervalDays);
  // 与 store.normMaxInterval 同口径：合法数字夹到 [1, 36500]，非数字才回落默认。
  // ⚠️ 这里的默认值 365 是「调用方没给设置」时的兜底，**不是用户默认值**——
  // 用户默认值由 store.defaultSettings 决定（当前 90 天，见 SM2_MAX_INTERVAL_DAYS）。
  const maxInterval = isFinite(m) && m >= 1
    ? Math.min(Math.round(m), 36500)
    : DEFAULT_MAX_INTERVAL_DAYS;
  return {
    retention: r > 0.7 && r < 1 ? r : DEFAULT_REQUEST_RETENTION,
    maxInterval: maxInterval,
    // SM-2 生效上限：口径统一在 sm2.resolveMaxDays（那边夹到 365），此处不重复夹取
    sm2MaxInterval: sm2.resolveMaxDays(maxInterval)
  };
}

/* ── FSRS 卡态：落盘 / 还原 / 重放 ──────────────────────────────── */

/**
 * FSRS 卡态 → 可 JSON 序列化的紧凑结构。
 * Date 统一转毫秒数：wx 存储会 JSON 化，Date 存下来是 ISO 字符串，
 * 存毫秒数可避免还原时到处补 new Date()。字段名与 ts-fsrs 的 Card 一一对应
 * （state / reps / lapses / scheduled_days / learning_steps / last_review）。
 *
 * stability / difficulty **不做小数舍入**：这份快照每卡只存最新一份
 * （不是逐次累积），舍入省不下存储，却会让「history 重放」与「快照续算」
 * 两条路径产生 ~1e-4 的漂移，破坏「迁移不产生分叉」这条不变量。
 * 需要可读的审计值时，那是 history 条目的职责（那里才做舍入）。
 */
function packFsrs(c) {
  return {
    stability: c.stability,
    difficulty: c.difficulty,
    due: c.due ? +new Date(c.due) : 0,
    lastReview: c.last_review ? +new Date(c.last_review) : 0,
    state: c.state,
    reps: c.reps,
    lapses: c.lapses,
    scheduledDays: c.scheduled_days,
    learningSteps: c.learning_steps || 0
  };
}

function unpackFsrs(f) {
  const base = fsrsLib.createEmptyCard(new Date(f.lastReview || Date.now()));
  base.stability = f.stability;
  base.difficulty = f.difficulty;
  base.due = new Date(f.due);
  base.last_review = f.lastReview ? new Date(f.lastReview) : undefined;
  base.state = f.state;
  base.reps = f.reps;
  base.lapses = f.lapses;
  base.scheduled_days = f.scheduledDays;
  base.learning_steps = f.learningSteps || 0;
  base.elapsed_days = 0;
  return base;
}

/**
 * 复习前的 FSRS 卡态。
 * 优先用卡上的 fsrs 快照；缺失（老卡 / JSON 备份还原）时用 history 重放重建
 * —— 这正是评估里那条「不必清掉用户进度」的落地路径。
 *
 * now 由调用方传入而非内部取 Date.now()：新卡的 FSRS 起点必须是"本次复习时刻"，
 * 否则注入固定时间的回归测试无法复现同一条链路。
 */
function fsrsCardBeforeReview(card, sched, now) {
  if (card.fsrs && typeof card.fsrs.stability === 'number' && card.fsrs.due) {
    return unpackFsrs(card.fsrs);
  }
  const hist = Array.isArray(card.history) ? card.history : [];
  if (!hist.length) {
    return fsrsLib.createEmptyCard(new Date(now || card.lastReviewed || Date.now()));
  }
  let c = fsrsLib.createEmptyCard(new Date(hist[0].date));
  for (let i = 0; i < hist.length; i++) {
    const g = RATING_TO_FSRS[hist[i].rating] || fsrsLib.Rating.Good;
    c = sched.next(c, new Date(hist[i].date), g).card;
  }
  return c;
}

/* ── 对外主入口 ─────────────────────────────────────────────────── */

/**
 * 执行一次复习评分，返回更新后的完整卡片。
 *
 * @param {object} card   当前卡片
 * @param {string} rating 'again' | 'hard' | 'good' | 'easy'
 * @param {object} [opts] { now?: number（测试注入固定时间）, settings?: object }
 * @returns {object} 新卡片对象（SM-2 字段生效 + fsrs 影子字段 + 增强 history）
 */
function applyReview(card, rating, opts) {
  const o = opts || {};
  const now = o.now || Date.now();
  const params = resolveParams(o.settings);

  // ① SM-2 仍是唯一生效的调度器。
  // 间隔上限从设置取（默认 90 天）——备考有时间边界，若不收紧，
  // 掌握良好的卡会被排到考试日之后、此后不再出现（262 天窗口实测最久空档 128 天）。
  const sm2Next = sm2.calculateSm2Review(card, rating, params.sm2MaxInterval);
  // 摘掉 sm2 写入的简版条目，改由本层写增强版（字段是超集，不会丢信息）
  delete sm2Next.history;

  const out = Object.assign({}, card, sm2Next);

  // ② 增强 history 条目
  const hist = Array.isArray(card.history) ? card.history.slice() : [];
  const prevDate = hist.length
    ? hist[hist.length - 1].date
    : card.lastReviewed || 0;
  const elapsedDays = prevDate ? Math.max(0, (now - prevDate) / MS_PER_DAY) : 0;

  const entry = {
    date: now,
    rating: rating,
    elapsedDays: round6(elapsedDays)
  };

  // ③ FSRS 影子计算：只记录，不排期。失败绝不影响复习主流程。
  try {
    const sched = schedulerFor(params.retention, params.maxInterval);
    const before = fsrsCardBeforeReview(card, sched, now);
    const after = sched.next(before, new Date(now), RATING_TO_FSRS[rating] || fsrsLib.Rating.Good).card;
    entry.sBefore = round4(before.stability);
    entry.dBefore = round4(before.difficulty);
    entry.sAfter = round4(after.stability);
    entry.dAfter = round4(after.difficulty);
    out.fsrs = packFsrs(after);
  } catch (e) {
    entry.shadowError = String((e && e.message) || e);
  }

  hist.push(entry);
  out.history = hist;
  return out;
}

/**
 * 读取某张卡在「当前时刻」的预测保留率（0~1）。
 * 影子模式下仅供看板/调试使用，不参与排期。卡上没有 FSRS 快照时返回 null。
 */
function retrievability(card, opts) {
  const o = opts || {};
  const params = resolveParams(o.settings);
  if (!card.fsrs || typeof card.fsrs.stability !== 'number') return null;
  try {
    const sched = schedulerFor(params.retention, params.maxInterval);
    const c = unpackFsrs(card.fsrs);
    return sched.get_retrievability(c, new Date(o.now || Date.now()), false);
  } catch (e) {
    return null;
  }
}

module.exports = {
  applyReview: applyReview,
  retrievability: retrievability,
  // 供回归与迁移脚本复用
  fsrsCardBeforeReview: fsrsCardBeforeReview,
  schedulerFor: schedulerFor,
  resolveParams: resolveParams,
  packFsrs: packFsrs,
  unpackFsrs: unpackFsrs,
  RATING_TO_FSRS: RATING_TO_FSRS,
  SCHEDULER_CONSTANTS: {
    DEFAULT_REQUEST_RETENTION: DEFAULT_REQUEST_RETENTION,
    DEFAULT_MAX_INTERVAL_DAYS: DEFAULT_MAX_INTERVAL_DAYS,
    MS_PER_DAY: MS_PER_DAY
  }
};
