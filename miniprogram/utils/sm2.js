/**
 * SM-2 (SuperMemo-2) 间隔重复算法
 * 与原 H5 版本 src/utils/sm2.ts 逻辑一致。
 *
 * 2026-09-10 四项行为修正（原版规则保留，只做以下补丁）：
 *   ① EF 均值回归：每次评分后熟练因子朝基线 2.5 缓慢收敛，
 *      消除「ease hell」——原版 Good 不改 EF、Again/Hard 只降不升，
 *      EF 触底 1.3 后间隔只能按 ×1.3 爬，卡片永久卡在短间隔循环里。
 *   ② 间隔上限：天数间隔统一封顶 365 天，避免 EF 高位时
 *      「×EF×1.3」连乘产生无意义的超大间隔。
 *      2026-09-10 追加：上限改为**可由调用方收紧**（第三个参数 maxDays）——
 *      备考有时间边界，卡片若被排到考试日之后就不再出现。设置项
 *      `maxIntervalDays` 默认 90 天（见 store.defaultSettings）。
 *      注意上限**只能收紧不能放宽**：365 是算法自身的硬天花板，传入更大的值无效。
 *   ③ 第二次「良好」由 3 天回到标准 SM-2 的 6 天。
 *   ④ 档位单调性不变式：任意卡态下恒有 困难 ≤ 良好 ≤ 简单。
 *      ③ 单独改动会破掉这条——第二次复习时「简单」按 ×EF×1.3 算只有 3 天，
 *      反而比「良好」的 6 天更早出现。故「简单」改为在「良好」结果上再乘 1.3。
 *
 * 回归守卫：scripts/regress_sm2_schedule.cjs（已注册进 scripts/run_all.sh）
 */

// —— 可调常量（改这里即可，回归脚本按同一套常量断言）——
const EF_BASELINE = 2.5; // 熟练因子基线：均值回归的吸引点
const EF_MIN = 1.3; // 熟练因子下界
const EF_MAX = 3.0; // 熟练因子上界
const EF_REVERSION = 0.08; // 每次评分后向基线回归的步长比例
const MAX_INTERVAL_DAYS = 365; // 天数间隔上限
const RELEARN_MINUTES = 10; // 「重来」后的重学间隔（分钟）
const FIRST_GOOD_DAYS = 1; // 新卡首评「良好」→ 1 天
const SECOND_GOOD_DAYS = 6; // 次评起的「良好」下限（标准 SM-2 口径）
const FIRST_EASY_DAYS = 4; // 新卡首评「简单」→ 4 天
const EASY_BONUS = 1.3; // 「简单」在「良好」结果上的额外放大倍数
const HARD_FACTOR = 1.2; // 「困难」的慢速前进系数
const AGAIN_EF_PENALTY = 0.2; // 「重来」的 EF 降幅
const HARD_EF_PENALTY = 0.15; // 「困难」的 EF 降幅
const EASY_EF_BONUS = 0.15; // 「简单」的 EF 增幅

function clampEaseFactor(ef) {
  return Math.min(EF_MAX, Math.max(EF_MIN, ef));
}

/**
 * 均值回归：把 EF 朝基线 2.5 拉一小步。
 * - EF 触底后每评一次「良好」约回升 0.10，约 8 次可回到 1.9 附近；
 * - EF 高位时轻微回落，抑制无节制膨胀；
 * - 连续「重来」时仍会单调降到下界 1.3 并停在那里（失败仍然惩罚，
 *   只是比原版慢一档）——注意必须先回归、后夹取，顺序反了会让
 *   底界失效（收敛到 1.396 而非 1.3）。
 */
function revertEaseFactor(ef) {
  return ef + (EF_BASELINE - ef) * EF_REVERSION;
}

/** 天数间隔：四舍五入到整日，并夹在 [1, 上限] 之间 */
function capDays(days, maxDays) {
  return Math.min(maxDays, Math.max(1, Math.round(days)));
}

/**
 * 解析调用方给的间隔上限。
 *
 * 语义是「只能收紧、不能放宽」：MAX_INTERVAL_DAYS（365）是算法自身的硬天花板，
 * 设置里写 1000 也只生效到 365。非法值（缺失/NaN/<1）一律回落 365，
 * 保证不传参数的旧调用方行为完全不变。
 *
 * 为什么上限要做成参数而不是常量：备考有明确的时间边界。间隔按 EF 连乘增长，
 * 365 天的天花板会让卡片被排到考试日之后、此后不再出现——实测 262 天窗口下
 * 71% 的卡在考前 60 天内复习过、最久空档 128 天。压到 90 天只需 +1% 负荷即可
 * 把空档压到 89 天以内。
 */
function resolveMaxDays(maxDays) {
  const n = Number(maxDays);
  if (!isFinite(n) || n < 1) return MAX_INTERVAL_DAYS;
  return Math.min(Math.round(n), MAX_INTERVAL_DAYS);
}

/**
 * 三档间隔一次算出，用构造法保证不变式「困难 ≤ 良好 ≤ 简单」。
 *
 * 不能各算各的：原版「良好」在第二次复习时是硬编码的步长（1 天/3 天），
 * 若卡片带着更大的间隔（JSON 备份还原），就会出现「良好 1 天」反而
 * 早于「困难 7 天」的倒挂。所以良好取「不低于困难」、简单取「不低于良好」。
 *
 * ⚠️ 夹取必须发生在「取 max」**之前**：先 max 后夹取会让中间值逃逸出上限
 * （如上限 3 天时 max(6, x) 得到 6）。取 max 只作用于已受限的同量级值，
 * 因此任意上限下单调性都成立。
 */
function nextIntervals(repetitions, interval, easeFactor, maxDays) {
  const cap = resolveMaxDays(maxDays);

  const hardDays = capDays(interval === 0 ? 1 : interval * HARD_FACTOR, cap);

  let goodDays = repetitions === 0
    ? capDays(FIRST_GOOD_DAYS, cap)
    : capDays(Math.max(SECOND_GOOD_DAYS, interval * easeFactor), cap);
  goodDays = Math.max(goodDays, hardDays);

  let easyDays = repetitions === 0
    ? capDays(FIRST_EASY_DAYS, cap)
    : capDays(goodDays * EASY_BONUS, cap);
  easyDays = Math.max(easyDays, goodDays);

  return { hardDays: hardDays, goodDays: goodDays, easyDays: easyDays };
}

/**
 * @param {object} card
 * @param {string} rating
 * @param {number} [maxDays] 间隔上限（天）。省略 = 365。上限只会被收紧，不会放宽。
 */
function calculateSm2Review(card, rating, maxDays) {
  const now = Date.now();
  let repetitions = card.repetitions;
  let easeFactor = card.easeFactor;
  let interval = card.interval;
  let state = card.state;

  const ratingValues = { again: 1, hard: 2, good: 3, easy: 4 };
  const q = ratingValues[rating];
  const steps = nextIntervals(repetitions, interval, easeFactor, maxDays);

  if (q === 1) {
    // 重来：完全遗忘
    repetitions = 0;
    interval = 0; // 0 表示走「分钟级重学」，见下方 nextIntervalMs
    easeFactor = easeFactor - AGAIN_EF_PENALTY;
    state = 'learning';
  } else if (q === 2) {
    // 困难：勉强回忆
    repetitions = Math.max(1, repetitions);
    interval = steps.hardDays;
    easeFactor = easeFactor - HARD_EF_PENALTY;
    state = 'learning';
  } else if (q === 3) {
    // 良好：正常掌握
    interval = steps.goodDays;
    repetitions += 1;
    state = repetitions >= 3 ? 'mastered' : 'review';
  } else if (q === 4) {
    // 简单：熟练贯通（恒不低于「良好」的排期）
    interval = steps.easyDays;
    repetitions += 1;
    easeFactor = easeFactor + EASY_EF_BONUS;
    state = 'mastered';
  }

  // 四档统一收口：先回归、再夹取。
  // 顺序不能反——先夹取会把「重来」压到 1.3，再回归又抬回 1.396，
  // 导致下界形同虚设、EF 永远停在 1.396。
  easeFactor = clampEaseFactor(revertEaseFactor(easeFactor));

  const nextIntervalMs =
    interval === 0 ? RELEARN_MINUTES * 60 * 1000 : interval * 24 * 60 * 60 * 1000;
  const nextReviewDate = now + nextIntervalMs;

  return {
    repetitions: repetitions,
    easeFactor: easeFactor,
    interval: interval,
    nextReviewDate: nextReviewDate,
    state: state,
    lastReviewed: now,
    history: (card.history || []).concat([{ date: now, rating: rating }])
  };
}

/**
 * 按钮下方的小字（下次出现间隔）。
 *
 * 关键：直接复用 calculateSm2Review 的结果，不再重复一遍乘法。
 * 原实现把间隔算法抄了两份，导致「显示的天数」与「实际排期的天数」可能不一致
 * （尤其是上限封顶生效后）。
 *
 * ⚠️ maxDays 必须与实际排期时传的是同一个值，否则小字又会和落库结果对不上——
 * 这条不变式由 scripts/verify_sm2_live.cjs 在真实运行时守着。
 */
function formatIntervalLabel(card, rating, maxDays) {
  if (rating === 'again') {
    return '<' + RELEARN_MINUTES + '分';
  }
  const next = calculateSm2Review(card, rating, maxDays);
  const days = next.interval > 0 ? next.interval : 1;
  return days + '天';
}

module.exports = {
  calculateSm2Review: calculateSm2Review,
  formatIntervalLabel: formatIntervalLabel,
  // 供调用方（scheduler / 页面）复用同一套上限解析口径，避免两处各写一份夹取逻辑
  resolveMaxDays: resolveMaxDays,
  nextIntervals: nextIntervals,
  // 常量一并导出，供回归脚本断言，避免测试与实现各写一套数字
  SM2_CONSTANTS: {
    EF_BASELINE: EF_BASELINE,
    EF_MIN: EF_MIN,
    EF_MAX: EF_MAX,
    EF_REVERSION: EF_REVERSION,
    MAX_INTERVAL_DAYS: MAX_INTERVAL_DAYS,
    RELEARN_MINUTES: RELEARN_MINUTES,
    FIRST_GOOD_DAYS: FIRST_GOOD_DAYS,
    SECOND_GOOD_DAYS: SECOND_GOOD_DAYS,
    FIRST_EASY_DAYS: FIRST_EASY_DAYS,
    EASY_BONUS: EASY_BONUS,
    HARD_FACTOR: HARD_FACTOR,
    AGAIN_EF_PENALTY: AGAIN_EF_PENALTY,
    HARD_EF_PENALTY: HARD_EF_PENALTY,
    EASY_EF_BONUS: EASY_EF_BONUS
  }
};
