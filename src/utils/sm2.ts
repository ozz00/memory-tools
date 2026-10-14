import { FlashCard, ReviewRating, CardState } from '../types';

/**
 * SM-2 调度常量（与 miniprogram/utils/sm2.js 保持完全一致）
 * 修改任意一侧务必同步另一侧。
 */
export const SM2_CONSTANTS = {
  EF_BASELINE: 2.5,
  EF_MIN: 1.3,
  EF_MAX: 3.0,
  EF_REVERSION: 0.08,
  MAX_INTERVAL_DAYS: 365,
  RELEARN_MINUTES: 10,
  FIRST_GOOD_DAYS: 1,
  SECOND_GOOD_DAYS: 6,
  FIRST_EASY_DAYS: 4,
  EASY_BONUS: 1.3,
  HARD_FACTOR: 1.2,
  AGAIN_EF_PENALTY: 0.2,
  HARD_EF_PENALTY: 0.15,
  EASY_EF_BONUS: 0.15,
};

const clampEaseFactor = (ef: number) =>
  Math.min(SM2_CONSTANTS.EF_MAX, Math.max(SM2_CONSTANTS.EF_MIN, ef));

/**
 * 均值回归：EF 朝基线 2.5 缓慢收敛，消除「ease hell」。
 * 注意本函数不做夹取——必须先回归、后夹取，否则下界形同虚设。
 */
const revertEaseFactor = (ef: number) =>
  ef + (SM2_CONSTANTS.EF_BASELINE - ef) * SM2_CONSTANTS.EF_REVERSION;

/** 天数间隔：四舍五入到整日，并夹在 [1, 上限] 之间 */
const capDays = (days: number, maxDays: number) =>
  Math.min(maxDays, Math.max(1, Math.round(days)));

/**
 * 解析调用方给的间隔上限。
 * 语义是「只能收紧、不能放宽」：MAX_INTERVAL_DAYS（365）是算法自身的硬天花板，
 * 传入更大的值无效；非法值（缺失/NaN/<1）一律回落 365，保证不传参数时行为不变。
 * 2026-09-10：上限从写死改为可选参数，设置项 maxIntervalDays 默认 90 天。
 */
export const resolveMaxDays = (maxDays?: number | null): number => {
  const n = Number(maxDays);
  if (!isFinite(n) || n < 1) return SM2_CONSTANTS.MAX_INTERVAL_DAYS;
  return Math.min(Math.round(n), SM2_CONSTANTS.MAX_INTERVAL_DAYS);
};

/**
 * 三档间隔一次算出，用构造法保证不变式「困难 ≤ 良好 ≤ 简单」。
 * 夹取必须发生在「取 max」**之前**，否则中间值会逃逸出上限（如上限 3 天时得到 6）。
 */
function nextIntervals(
  repetitions: number,
  interval: number,
  easeFactor: number,
  maxDays?: number | null
) {
  const cap = resolveMaxDays(maxDays);

  const hardDays = capDays(interval === 0 ? 1 : interval * SM2_CONSTANTS.HARD_FACTOR, cap);

  let goodDays =
    repetitions === 0
      ? capDays(SM2_CONSTANTS.FIRST_GOOD_DAYS, cap)
      : capDays(Math.max(SM2_CONSTANTS.SECOND_GOOD_DAYS, interval * easeFactor), cap);
  goodDays = Math.max(goodDays, hardDays);

  let easyDays =
    repetitions === 0
      ? capDays(SM2_CONSTANTS.FIRST_EASY_DAYS, cap)
      : capDays(goodDays * SM2_CONSTANTS.EASY_BONUS, cap);
  easyDays = Math.max(easyDays, goodDays);

  return { hardDays, goodDays, easyDays };
}

export function calculateSm2Review(
  card: FlashCard,
  rating: ReviewRating,
  maxDays?: number | null
): Partial<FlashCard> {
  const now = Date.now();
  let { repetitions, easeFactor, interval } = card;
  let newState: CardState = card.state;

  const ratingValues: Record<ReviewRating, number> = {
    again: 1,
    hard: 2,
    good: 3,
    easy: 4,
  };

  const q = ratingValues[rating];
  const steps = nextIntervals(repetitions, interval, easeFactor, maxDays);

  if (q === 1) {
    // Again: fail/forgot
    repetitions = 0;
    interval = 0; // review again within RELEARN_MINUTES
    easeFactor = easeFactor - SM2_CONSTANTS.AGAIN_EF_PENALTY;
    newState = 'learning';
  } else if (q === 2) {
    // Hard: difficult recall
    repetitions = Math.max(1, repetitions);
    interval = steps.hardDays;
    easeFactor = easeFactor - SM2_CONSTANTS.HARD_EF_PENALTY;
    newState = 'learning';
  } else if (q === 3) {
    // Good: standard recall
    interval = steps.goodDays;
    repetitions += 1;
    newState = repetitions >= 3 ? 'mastered' : 'review';
  } else if (q === 4) {
    // Easy: instant recall
    interval = steps.easyDays;
    repetitions += 1;
    easeFactor = easeFactor + SM2_CONSTANTS.EASY_EF_BONUS;
    newState = 'mastered';
  }

  // 统一收口：先回归、再夹取（顺序反了会让 EF 下界失效）
  easeFactor = clampEaseFactor(revertEaseFactor(easeFactor));

  const nextIntervalMs =
    interval === 0
      ? SM2_CONSTANTS.RELEARN_MINUTES * 60 * 1000
      : interval * 24 * 60 * 60 * 1000;
  const nextReviewDate = now + nextIntervalMs;

  const historyEntry = {
    date: now,
    rating,
  };

  return {
    repetitions,
    easeFactor,
    interval,
    nextReviewDate,
    state: newState,
    lastReviewed: now,
    history: [...(card.history || []), historyEntry],
  };
}

/**
 * 按钮下方的小字：直接复用 calculateSm2Review 的结果，
 * 不再重复一遍乘法（避免显示与实际排期不一致）。
 * maxDays 必须与实际排期用的是同一个值。
 */
export function formatIntervalLabel(
  card: FlashCard,
  rating: ReviewRating,
  maxDays?: number | null
): string {
  if (rating === 'again') {
    return `<${SM2_CONSTANTS.RELEARN_MINUTES}分`;
  }
  const next = calculateSm2Review(card, rating, maxDays);
  const days = next.interval && next.interval > 0 ? next.interval : 1;
  return `${days}天`;
}
