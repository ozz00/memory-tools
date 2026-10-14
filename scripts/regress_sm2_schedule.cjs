/**
 * SM-2 调度回归：守卫 2026-09-10 增补的四项行为修正
 *   ① EF 均值回归（消除 ease hell） ② 间隔上限 365 天
 *   ③ 第二次「良好」= 6 天         ④ 档位单调性 困难 ≤ 良好 ≤ 简单
 *
 * 为什么需要：间隔算法与「按钮小字」原来是两份重复实现，
 * 且档位排序不变式无人守——单独把二档从 3 天改成 6 天就会让
 * 「简单」(3天) 排在「良好」(6天) 前面。本脚本守住这两类问题。
 *
 * 用法：node scripts/regress_sm2_schedule.cjs
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'miniprogram/utils/sm2.js');

// 根 package.json 为 type:module，直接 require 项目内 .js 会被当 ESM 解析
const TMP = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'caq_sm2_')), 'sm2.cjs');
fs.copyFileSync(SRC, TMP);

const sm2 = require(TMP);
const C = sm2.SM2_CONSTANTS;

let pass = 0;
let fail = 0;

function check(name, cond, detail) {
  if (cond) {
    pass++;
    console.log('  ok  ' + name + (detail ? '  [' + detail + ']' : ''));
  } else {
    fail++;
    console.log('FAIL  ' + name + (detail ? '  [' + detail + ']' : ''));
  }
}

const card = (repetitions, easeFactor, interval, state) => ({
  repetitions,
  easeFactor,
  interval,
  state: state || 'review',
  history: [],
});

/** 连续以同一档评分，返回逐次 interval 序列 */
function streak(start, rating, times) {
  let c = start;
  const seq = [];
  const efs = [];
  for (let i = 0; i < times; i++) {
    c = Object.assign({}, start, sm2.calculateSm2Review(c, rating));
    seq.push(c.interval);
    efs.push(c.easeFactor);
  }
  return { card: c, seq, efs };
}

console.log('— 常量口径 —');
check('EF 上下界为 1.3 / 3.0', C.EF_MIN === 1.3 && C.EF_MAX === 3.0, C.EF_MIN + ' / ' + C.EF_MAX);
check('EF 基线为 2.5', C.EF_BASELINE === 2.5, String(C.EF_BASELINE));
check('间隔上限为 365 天', C.MAX_INTERVAL_DAYS === 365, String(C.MAX_INTERVAL_DAYS));
check('第二次「良好」为 6 天', C.SECOND_GOOD_DAYS === 6, String(C.SECOND_GOOD_DAYS));
check('「重来」走 10 分钟重学', C.RELEARN_MINUTES === 10, C.RELEARN_MINUTES + ' 分钟');

console.log('\n— 良好档爬升序列 —');
const good = streak(card(0, 2.5, 0, 'new'), 'good', 5);
check(
  '新卡连续良好为 1 → 6 → 15 → 38 → 95 天',
  good.seq.join(',') === '1,6,15,38,95',
  good.seq.join(' → ')
);
check('第二次复习即 6 天（不再是最保守的 3 天）', good.seq[1] === 6, good.seq[1] + '天');

const easy = streak(card(0, 2.5, 0, 'new'), 'easy', 4);
check('新卡首评「简单」为 4 天', easy.seq[0] === 4, easy.seq[0] + '天');
check('「简单」起始晚于「良好」起始', easy.seq[0] > good.seq[0], easy.seq[0] + ' vs ' + good.seq[0]);
check('「简单」爬升快于「良好」', easy.seq[1] > good.seq[1], easy.seq[1] + ' vs ' + good.seq[1]);

console.log('\n— 间隔上限 —');
const spamGood = streak(card(0, 3.0, 0, 'new'), 'good', 12);
const spamEasy = streak(card(9, 3.0, 300), 'easy', 12);
const capOK = spamGood.seq.concat(spamEasy.seq).every((v) => v <= C.MAX_INTERVAL_DAYS);
check('连续好评的间隔永不越过上限', capOK, '峰值 ' + Math.max.apply(null, spamGood.seq.concat(spamEasy.seq)));
check('达到上限后稳定在 365 天', spamGood.seq[spamGood.seq.length - 1] === 365, spamGood.seq.join(' → '));

console.log('\n— ease hell 消除（核心补丁）—');
const hell = streak(card(0, 2.5, 0, 'new'), 'again', 6);
const afterHell = hell.card.easeFactor;
check('6 次「重来」后 EF 未钉死在 1.3', afterHell > C.EF_MIN + 0.05, 'EF=' + afterHell.toFixed(3));
const recover = streak(hell.card, 'good', 8);
const recovered = recover.card.easeFactor;
check('触底后连续「良好」能把 EF 拉回', recovered > afterHell + 0.3, afterHell.toFixed(3) + ' → ' + recovered.toFixed(3));
check('EF 回升过程中单调不减', recover.efs.every((v, i, a) => i === 0 || v >= a[i - 1] - 1e-9), recover.efs.map((v) => v.toFixed(2)).join(' ↑ '));

const deeper = streak(card(0, 2.5, 0, 'new'), 'again', 20);
check('持续「重来」仍会降到 EF 下界（失败仍有惩罚）', Math.abs(deeper.card.easeFactor - C.EF_MIN) < 1e-6, 'EF=' + deeper.card.easeFactor.toFixed(3));

const all = []
  .concat(spamGood.efs, spamEasy.efs, recover.efs, deeper.efs, hell.efs)
  .every((v) => v >= C.EF_MIN - 1e-9 && v <= C.EF_MAX + 1e-9);
check('EF 始终夹在 [1.3, 3.0] 内', all);

console.log('\n— 档位单调性不变式（穷举）—');
const REPS = [0, 1, 2, 3, 5, 9];
const IVALS = [0, 1, 6, 15, 95, 300, 365];
const EFS = [1.3, 1.8, 2.5, 3.0];
let orderBad = 0;
let shrinkBad = 0;
let worst = '';
for (const r of REPS) {
  for (const iv of IVALS) {
    for (const ef of EFS) {
      const c = card(r, ef, iv);
      const h = sm2.calculateSm2Review(c, 'hard').interval;
      const g = sm2.calculateSm2Review(c, 'good').interval;
      const e = sm2.calculateSm2Review(c, 'easy').interval;
      if (!(h <= g && g <= e)) {
        orderBad++;
        worst = worst || 'reps=' + r + ' i=' + iv + ' ef=' + ef + ' → ' + h + '/' + g + '/' + e;
      }
      if (r >= 1 && (g < iv || h < iv)) {
        shrinkBad++;
      }
    }
  }
}
check(
  '任意卡态下恒有 困难 ≤ 良好 ≤ 简单',
  orderBad === 0,
  orderBad === 0 ? REPS.length * IVALS.length * EFS.length + ' 组全过' : orderBad + ' 组违规，如 ' + worst
);
check('「困难」「良好」不会把已有间隔改小', shrinkBad === 0, shrinkBad === 0 ? '0 组缩水' : shrinkBad + ' 组缩水');

console.log('\n— 按钮小字与实际排期一致（穷举）—');
let labelBad = 0;
let labelSample = '';
let labelTotal = 0;
for (const r of REPS) {
  for (const iv of IVALS) {
    for (const ef of EFS) {
      for (const rating of ['hard', 'good', 'easy']) {
        const c = card(r, ef, iv);
        const want = sm2.calculateSm2Review(c, rating).interval;
        const got = sm2.formatIntervalLabel(c, rating);
        labelTotal++;
        const m = String(got).match(/^(\d+)天$/);
        if (!m || Number(m[1]) !== want) {
          labelBad++;
          labelSample = labelSample || 'reps=' + r + ' i=' + iv + ' ef=' + ef + ' ' + rating + ' → 显示 ' + got + ' 实际 ' + want + '天';
        }
      }
    }
  }
}
check('四档小字数字等于实际排期天数', labelBad === 0, labelBad === 0 ? labelTotal + ' 组全过' : labelBad + ' 组不符，如 ' + labelSample);
check('「重来」小字为 <10分', sm2.formatIntervalLabel(card(0, 2.5, 0), 'again') === '<10分', sm2.formatIntervalLabel(card(0, 2.5, 0), 'again'));

console.log('\n— 间隔上限参数化（备考窗口收紧）—');
/* 2026-09-10：上限从写死的常量改为可选参数（设置项 maxIntervalDays 默认 90）。
   三条必须守住的性质：
     ① 生效上限永不超过传入值（含夹取发生在取 max 之前——顺序反了会逃逸，如上限 3 时得到 6）
     ② 只能收紧不能放宽：传 >365 等价于 365；不传则行为与旧版完全一致
     ③ 任意上限下「困难 ≤ 良好 ≤ 简单」仍成立                                  */
const CAPS = [365, 90, 60, 30, 7, 3, 1];
let capBad = 0, capDetail = '', capCases = 0;
for (const cap of CAPS) {
  for (const r of REPS) {
    for (const iv of IVALS) {
      for (const ef of EFS) {
        capCases++;
        const t = sm2.nextIntervals(r, iv, ef, cap);
        if (!(t.hardDays <= t.goodDays && t.goodDays <= t.easyDays)) {
          capBad++; capDetail = capDetail || '上限 ' + cap + ' 单调性破坏 ' + JSON.stringify(t);
        }
        for (const rating of ['hard', 'good', 'easy']) {
          const got = sm2.calculateSm2Review(card(r, ef, iv), rating, cap).interval;
          const uncapped = sm2.calculateSm2Review(card(r, ef, iv), rating).interval;
          if (got > cap || got > uncapped) {
            capBad++; capDetail = capDetail || '上限 ' + cap + ' reps=' + r + ' i=' + iv + ' ef=' + ef
              + ' ' + rating + ' → ' + got + '（上限 ' + cap + '，无上限时 ' + uncapped + '）';
          }
        }
      }
    }
  }
}
check('任意上限下：间隔不超过上限且单调性成立', capBad === 0,
  capBad === 0 ? CAPS.length + ' 种上限 × ' + (REPS.length * IVALS.length * EFS.length) + ' 卡态全过' : capBad + ' 组违规，如 ' + capDetail);

const bigCard = card(5, 2.5, 300);
check('上限只能收紧：传 9999 等价于 365',
  sm2.calculateSm2Review(bigCard, 'good', 9999).interval === 365
  && sm2.calculateSm2Review(bigCard, 'good', 365).interval === 365,
  sm2.calculateSm2Review(bigCard, 'good', 9999).interval + ' / ' + sm2.calculateSm2Review(bigCard, 'good', 365).interval);
check('非法上限回落 365（不传参数的旧调用行为不变）',
  [undefined, null, NaN, 0, -5, 'abc'].every(function (v) { return sm2.resolveMaxDays(v) === 365; }),
  [undefined, null, NaN, 0, -5, 'abc'].map(function (v) { return sm2.resolveMaxDays(v); }).join(','));
check('不传上限与显式传 365 结果完全一致（向后兼容）',
  REPS.every(function (r) {
    return IVALS.every(function (iv) {
      return EFS.every(function (ef) {
        return ['hard', 'good', 'easy'].every(function (rating) {
          return sm2.calculateSm2Review(card(r, ef, iv), rating).interval
            === sm2.calculateSm2Review(card(r, ef, iv), rating, 365).interval;
        });
      });
    });
  }));
check('小字跟随同一上限（90 天上限下不会显示 365 天）',
  sm2.formatIntervalLabel(bigCard, 'good', 90) === '90天'
  && sm2.formatIntervalLabel(bigCard, 'good') === '365天',
  sm2.formatIntervalLabel(bigCard, 'good', 90) + ' / ' + sm2.formatIntervalLabel(bigCard, 'good'));
check('上限 1 天时三档全部收敛到 1 天（极端参数不产生 0 天或负数）',
  sm2.nextIntervals(9, 300, 3.0, 1).easyDays === 1,
  JSON.stringify(sm2.nextIntervals(9, 300, 3.0, 1)));

console.log('\n— 「重来」走分钟级重学 —');
const again = sm2.calculateSm2Review(card(3, 2.5, 15), 'again');
check('「重来」把间隔归零', again.interval === 0, 'interval=' + again.interval);
check('「重来」下次复习落在 10 分钟后', again.nextReviewDate - again.lastReviewed === 10 * 60 * 1000,
  (again.nextReviewDate - again.lastReviewed) / 60000 + ' 分钟');
check('「重来」把重复次数清零并回到学习中', again.repetitions === 0 && again.state === 'learning', again.state);

console.log('\n— 状态机与副作用 —');
const threeGood = streak(card(0, 2.5, 0, 'new'), 'good', 3).card;
check('连续三次「良好」后进入已掌握', threeGood.state === 'mastered' && threeGood.repetitions === 3, threeGood.state + ' reps=' + threeGood.repetitions);
const oneHard = sm2.calculateSm2Review(card(0, 2.5, 0, 'new'), 'hard');
check('新卡评「困难」→ 1 天且留在学习中', oneHard.interval === 1 && oneHard.state === 'learning', oneHard.interval + '天 ' + oneHard.state);
const origin = card(1, 2.5, 6);
origin.history = [{ date: 1, rating: 'good' }];
const out = sm2.calculateSm2Review(origin, 'good');
check('原卡片对象未被就地修改', origin.repetitions === 1 && origin.interval === 6, 'reps=' + origin.repetitions + ' i=' + origin.interval);
check('history 追加本次评分且保留旧记录', out.history.length === 2 && out.history[0].rating === 'good' && out.history[1].rating === 'good',
  out.history.length + ' 条');

console.log('\nSM-2 调度：通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
