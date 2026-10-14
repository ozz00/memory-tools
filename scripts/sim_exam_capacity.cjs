/**
 * 备考容量模拟器：给定题库规模与每日新卡上限，推算 90 天（或任意天数）内的
 * 每日真实工作量（新卡 + 到期复习），回答三个问题：
 *   ① 按当前设置，考前能否过完首轮？
 *   ② 中期「到期复习」洪峰会涨到多少张/天？（决定「每轮 N 张」够不够用）
 *   ③ 不同题库规模下的临界点在哪？
 *
 * 为什么需要它：`studyCount` 是「每轮张数」而非「每日上限」，单看这个数字
 * 无法回答 3 个月备考够不够。本脚本用项目真实的 SM-2 实现跑日粒度模拟，
 * 保证结论与线上算法一致（直接 require miniprogram/utils/sm2.js）。
 *
 * 用法：
 *   node scripts/sim_exam_capacity.cjs                        # 默认 900 题 / 30 新卡 / 90 天
 *   node scripts/sim_exam_capacity.cjs --cards 1500 --new 30 --days 90
 *   node scripts/sim_exam_capacity.cjs --table                # 输出题库规模容量对照表
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'miniprogram/utils/sm2.js');

// 根 package.json 为 type:module，直接 require 项目内 .js 会被当 ESM 解析（项目既定约定）
const TMP = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'caq_sim_')), 'sm2.cjs');
fs.copyFileSync(SRC, TMP);
const sm2 = require(TMP);

/* ---------------- 参数解析 ---------------- */
const argv = process.argv.slice(2);
function argNum(name, def) {
  const i = argv.indexOf('--' + name);
  if (i < 0) return def;
  const v = Number(argv[i + 1]);
  return Number.isFinite(v) ? v : def;
}
/** 正确率：--good 0.95 表示 95% 评「良好」，其余按 hard:again = 6:4 分摊 */
function goodRatio() {
  const g = argNum('good', -1);
  if (g >= 0) return Math.min(1, g);
  return 0.75;
}
function hardRatio() {
  const g = argNum('good', -1);
  if (g >= 0) return (1 - Math.min(1, g)) * 0.6;
  return 0.15;
}
const WANT_TABLE = argv.includes('--table');

/**
 * 评分分布（确定性，可复现）：按「卡序号 × 该卡累计复习次数」取模决定本次评级。
 * 默认 75% 良好 / 15% 困难 / 10% 重来 —— 贴近真实备考的初学者水平。
 *
 * ⚠️ 第二个参数必须是**该卡累计复习次数**（seen），不能是「当日第几次作答」。
 * 早期版本传的是当日 attempt，而每次到期复习都会把它重置为 1，
 * 等价于「每张卡的评级终身固定」——10% 的卡会永远评「重来」、天天到期，
 * 把日负荷虚增了近一个数量级（2292 题被高估到 546 张/天）。
 * 取 seen 递增则 bucket 每次 +3，在 20 格刻度上均匀轮转，长期分布才等于设定的比例。
 */
function ratingFor(cardIdx, seen, goodRatio, hardRatio) {
  const GOOD = Math.round(goodRatio * 20); // 20 格刻度
  const HARD = Math.round(hardRatio * 20);
  const bucket = (cardIdx * 7 + seen * 3) % 20;
  if (bucket < GOOD) return 'good';
  if (bucket < GOOD + HARD) return 'hard';
  return 'again';
}

/**
 * 把一张卡的评分结果写回（字段名严格对齐 SM-2 契约）。
 * seen 累加该卡被评分的总次数；lastDay 记录最后一次复习日（覆盖率分析用）。
 * intervalCap > 0 时把排期间隔压到该值——用于模拟「考前压缩」的效果
 * （线上 SM-2 的硬上限是 sm2.js 的 MAX_INTERVAL_DAYS = 365，不可通过设置调）。
 */
function applyReviewTo(c, rating, day, intervalCap) {
  const next = sm2.calculateSm2Review(c, rating);
  c.repetitions = next.repetitions;
  c.easeFactor = next.easeFactor;
  let iv = Number.isFinite(next.interval) && next.interval > 0 ? next.interval : 1;
  if (intervalCap > 0) iv = Math.min(iv, intervalCap);
  c.interval = iv;
  c.state = next.state;
  c.due = day + iv;
  c.seen = (c.seen || 0) + 1;
  c.lastDay = day;
}

/**
 * 日粒度模拟。
 * @param {object} o { total, newPerDay, days, reviewCap, goodRatio, hardRatio, intervalCap }
 */
function simulate(o) {
  const total = o.total;
  const newPerDay = o.newPerDay;
  const days = o.days;
  const reviewCap = o.reviewCap || 0; // 0 = 不限
  const intervalCap = o.intervalCap || 0; // 0 = 用 SM-2 自身的 365 天上限
  const goodRatio = o.goodRatio === undefined ? 0.75 : o.goodRatio;
  const hardRatio = o.hardRatio === undefined ? 0.15 : o.hardRatio;

  const cards = [];       // { idx, introduced, reps, ef, interval, due, state }
  let introduced = 0;
  const daily = [];       // { day, newN, dueN, totalN, backlogAfter, learnedTotal }
  const MAX_AGAIN_PER_DAY = 2; // 单卡当日最多重做次数，防止死循环

  for (let day = 1; day <= days; day++) {
    let work = 0;

    /* ① 到期复习（先做到期，与线上队列一致：due <= now） */
    let dueList = cards.filter(function (c) { return c.introduced && c.due <= day; });
    let dueN = dueList.length;
    let processed = dueList;
    if (reviewCap > 0 && dueList.length > reviewCap) processed = dueList.slice(0, reviewCap);

    processed.forEach(function (c) {
      let attempts = 0;
      while (true) {
        attempts++;
        work++;
        const r = ratingFor(c.idx, (c.seen || 0) + 1, goodRatio, hardRatio);
        applyReviewTo(c, r, day, intervalCap);
        if (r !== 'again' || attempts >= MAX_AGAIN_PER_DAY) break;
      }
    });

    /* ② 引入新卡（新卡首评后按间隔排期，今天不再重复出现） */
    const room = Math.max(0, total - introduced);
    const newN = Math.min(newPerDay, room);
    for (let k = 0; k < newN; k++) {
      const c = {
        idx: introduced, introduced: day, repetitions: 0, easeFactor: 2.5,
        interval: 0, due: day + 1, state: 'new', seen: 0, lastDay: day
      };
      cards.push(c);
      introduced++;
      work++;
      applyReviewTo(c, ratingFor(c.idx, 1, goodRatio, hardRatio), day, intervalCap);
    }

    /* ③ 统计积压（受 reviewCap 截断而未处理的到期卡） */
    const remainingDue = (reviewCap > 0 && dueN > reviewCap) ? dueN - reviewCap : 0;

    daily.push({
      day: day,
      newN: newN,
      dueN: dueN,
      totalN: work,
      backlogAfter: remainingDue,
      learnedTotal: introduced
    });
  }

  const peak = daily.reduce(function (a, b) { return b.totalN > a.totalN ? b : a; }, daily[0]);
  // 首轮完成日：首次 introduced === total 的那天
  const finishDay = (function () {
    for (let i = 0; i < daily.length; i++) if (daily[i].learnedTotal >= total) return i + 1;
    return null;
  })();
  // 稳态到期量（后半程均值）：反映「复习洪峰」的常态水平
  const secondHalf = daily.slice(Math.floor(days / 2));
  const steadyDue = secondHalf.length
    ? Math.round(secondHalf.reduce(function (a, b) { return a + b.dueN; }, 0) / secondHalf.length)
    : 0;

  return {
    daily: daily, peak: peak, finishDay: finishDay, steadyDue: steadyDue,
    introduced: introduced, cards: cards
  };
}

/**
 * 模拟「现有队列逻辑」：与 pages/anki/index.js 的 refresh() 一致 ——
 *   queue = 全部 (到期 ∪ 新卡)，按存储顺序；每次取前 limit 张。
 * 关键点：新卡与到期卡**共用同一个名额池**，靠前的到期卡会挤掉靠后的新卡。
 * 用来回答：现有「每轮 N 张」机制下，首轮实际需要多少天。
 */
function simulateCurrentQueue(o) {
  const total = o.total;
  const limit = o.limit || 30;
  const days = o.days;
  const rounds = o.roundsPerDay || 1;
  const goodRatio = o.goodRatio === undefined ? 1 : o.goodRatio;
  const hardRatio = o.hardRatio === undefined ? 0 : o.hardRatio;

  const cards = [];
  for (let i = 0; i < total; i++) {
    cards.push({
      idx: i, introduced: 0, repetitions: 0, easeFactor: 2.5,
      interval: 0, due: 0, state: 'new', seen: 0
    });
  }

  const daily = [];
  let introduced = 0;

  for (let day = 1; day <= days; day++) {
    let work = 0, newToday = 0, dueToday = 0, roundsUsed = 0;
    for (let r = 0; r < rounds; r++) {
      const queue = cards.filter(function (c) {
        return (c.introduced && c.due <= day) || !c.introduced;
      });
      const picked = queue.slice(0, limit);
      if (!picked.length) break;
      roundsUsed++;
      picked.forEach(function (c) {
        if (!c.introduced) { c.introduced = day; introduced++; newToday++; }
        else { dueToday++; }
        work++;
        applyReviewTo(c, ratingFor(c.idx, (c.seen || 0) + 1, goodRatio, hardRatio), day);
      });
    }
    daily.push({ day: day, newN: newToday, dueN: dueToday, totalN: work, learnedTotal: introduced });
  }

  const finishDay = (function () {
    for (let i = 0; i < daily.length; i++) if (daily[i].learnedTotal >= total) return i + 1;
    return null;
  })();
  return { daily: daily, finishDay: finishDay, introduced: introduced };
}

/**
 * 考前覆盖率分析：回答「到考试那天，每张卡上一次复习是多久以前」。
 *
 * 为什么需要：SM-2 的间隔按 EF 连乘增长，硬上限 365 天（sm2.js MAX_INTERVAL_DAYS）。
 * 备考窗口一旦拉长到半年以上，一张掌握良好的卡会被排到考试日之后，
 * 此后不再出现——最后一次见它可能是考前好几个月。
 * 本模式让这个「空档」可量化，并对比不同「间隔上限」的效果。
 */
function coverage(cards, days) {
  const gaps = [];
  let past = 0; // 已排到考试日之后（考前不会再出现）
  cards.forEach(function (c) {
    if (!c.lastDay) return;
    const gap = days - c.lastDay;
    gaps.push(gap);
    if (c.due > days) past++;
  });
  gaps.sort(function (a, b) { return a - b; });
  const n = gaps.length || 1;
  function pct(k) { return Math.round(gaps.filter(function (g) { return g <= k; }).length / n * 100); }
  return {
    n: gaps.length,
    mean: Math.round(gaps.reduce(function (a, b) { return a + b; }, 0) / n),
    max: gaps[gaps.length - 1] || 0,
    median: gaps[Math.floor(n / 2)] || 0,
    within30: pct(30),
    within60: pct(60),
    within90: pct(90),
    pastExam: past
  };
}

function coverageReport(o) {
  const cards = o.total, newPerDay = o.newPerDay, days = o.days;
  console.log('考前覆盖率分析：题库 ' + cards + ' 题 ｜ 每日新卡 ' + newPerDay
    + ' ｜ 备考 ' + days + ' 天（评分 75% 良好）');
  console.log('─'.repeat(84));
  console.log(pad('间隔上限', 10, true) + ' ｜ ' + pad('首轮', 6, true) + ' ｜ '
    + pad('全期日均', 8, true) + ' ｜ ' + pad('峰值', 6, true) + ' ｜ '
    + pad('考前60天内复习过', 16, true) + ' ｜ ' + pad('平均空档', 8, true) + ' ｜ 最久空档');
  const caps = [0, 180, 120, 90, 60, 45];
  const out = [];
  caps.forEach(function (cap) {
    const r = simulate({
      total: cards, newPerDay: newPerDay, days: days,
      goodRatio: goodRatio(), hardRatio: hardRatio(), intervalCap: cap
    });
    const c = coverage(r.cards, days);
    const tot = r.daily.reduce(function (a, b) { return a + b.totalN; }, 0);
    out.push({ cap: cap, r: r, c: c, avg: tot / days });
    const label = cap === 0 ? '无限(365)' : cap + ' 天';
    console.log(pad(label, 10, true) + ' ｜ '
      + pad(r.finishDay ? r.finishDay + '天' : '未完成', 6, true) + ' ｜ '
      + pad(Math.round(tot / days) + ' 张', 8, true) + ' ｜ '
      + pad(r.peak.totalN + ' 张', 6, true) + ' ｜ '
      + pad(c.within60 + '%', 16, true) + ' ｜ '
      + pad(c.mean + ' 天', 8, true) + ' ｜ ' + c.max + ' 天');
  });
  console.log('');
  const base = out[0];
  console.log('「无限」档的画像：中位空档 ' + base.c.median + ' 天，'
    + base.c.within30 + '% 的卡在考前 30 天内复习过，'
    + base.c.pastExam + ' 张卡已排到考试日之后。');
  console.log('');
  console.log('读法：间隔上限越小 → 考前覆盖率越高，代价是复习量上升。');
  console.log('      对比「无限」档的日均张数即可看出代价。');
}


/* ---------------- 输出 ---------------- */
function pad(s, n, right) {
  s = String(s);
  while (s.length < n) s = right ? s + ' ' : ' ' + s;
  return s;
}

function report(o) {
  const r = simulate(o);
  const newPerDay = o.newPerDay;
  const overCount = r.daily.filter(function (d) { return d.totalN > newPerDay; }).length;

  console.log('题库 ' + o.total + ' 题 ｜ 每日新卡 ' + newPerDay + ' ｜ 备考 ' + o.days + ' 天'
    + (o.reviewCap ? ' ｜ 每日复习上限 ' + o.reviewCap : ' ｜ 每日复习不限'));
  console.log('─'.repeat(72));
  console.log('首轮学完：' + (r.finishDay ? '第 ' + r.finishDay + ' 天' : '🔴 备考期内未学完（缺 '
    + (o.total - r.introduced) + ' 题）'));
  if (r.finishDay) {
    console.log('剩余巩固天数：' + (o.days - r.finishDay) + ' 天');
  }
  console.log('后半程日均到期复习：' + r.steadyDue + ' 张/天');
  console.log('峰值日：第 ' + r.peak.day + ' 天，共 ' + r.peak.totalN + ' 张（新 '
    + r.peak.newN + ' + 到期 ' + r.peak.dueN + '）');
  console.log('超过「每轮 ' + newPerDay + ' 张」的天数：' + overCount + ' / ' + o.days
    + '（占 ' + Math.round(overCount / o.days * 100) + '%）');
  if (o.reviewCap) {
    const lastBacklog = r.daily[r.daily.length - 1].backlogAfter;
    console.log('期末积压：' + lastBacklog + ' 张' + (lastBacklog > 0 ? ' 🔴 滚雪球风险' : ' ✅'));
  }
  console.log('');
  console.log('每 10 天采样（日 / 新卡 / 到期 / 合计）：');
  for (let i = 0; i < r.daily.length; i += 10) {
    const d = r.daily[i];
    console.log('  ' + pad(d.day, 3, true) + ' 天 ｜ 新 ' + pad(d.newN, 3, true)
      + ' ｜ 到期 ' + pad(d.dueN, 4, true) + ' ｜ 合计 ' + pad(d.totalN, 4, true)
      + (d.totalN > newPerDay ? '  ← 超出单轮容量' : ''));
  }
  return r;
}

if (argv.indexOf('--mode') >= 0 && argv[argv.indexOf('--mode') + 1] === 'current') {
  const cards = argNum('cards', 900);
  const limit = argNum('limit', 30);
  const days = argNum('days', 240);
  console.log('现有队列逻辑：每轮 ' + limit + ' 张，新卡与到期卡共用同一个名额池');
  console.log('题库 ' + cards + ' 题 ｜ 满分表现（全部评「良好」，排除评分波动的干扰）');
  console.log('─'.repeat(72));
  console.log(pad('每天开轮数', 10, true) + ' ｜ ' + pad('理论首轮', 8, true) + ' ｜ '
    + pad('实际首轮', 8, true) + ' ｜ 效率损失');
  [1, 2, 3, 5].forEach(function (r) {
    const res = simulateCurrentQueue({
      total: cards, limit: limit, days: days, roundsPerDay: r, goodRatio: 1, hardRatio: 0
    });
    const ideal = Math.ceil(cards / (limit * r));
    const actual = res.finishDay;
    const loss = actual ? Math.round((actual / ideal - 1) * 100) : null;
    console.log(pad(r + ' 轮', 10, true) + ' ｜ ' + pad(ideal + ' 天', 8, true) + ' ｜ '
      + pad(actual ? actual + ' 天' : '>' + days + '天', 8, true) + ' ｜ '
      + (loss === null ? '🔴 未学完' : (loss > 0 ? '🔴 +' + loss + '%' : '✅ 无损失')));
  });
  console.log('');
  console.log('原因：前一批卡评「良好」后间隔 1 天，次日即到期；它们排在数组前面，');
  console.log('      当天 30 个名额被它们全部占满，新卡（排在数组后面）被挤掉。');
} else if (argv.includes('--json')) {
  // 机器可读输出：供可视化/外部分析消费
  const r = simulate({
    total: argNum('cards', 900),
    newPerDay: argNum('new', 30),
    days: argNum('days', 90),
    reviewCap: argNum('review-cap', 0),
    goodRatio: goodRatio(),
    hardRatio: hardRatio()
  });
  console.log(JSON.stringify({
    params: { cards: argNum('cards', 900), newPerDay: argNum('new', 30), days: argNum('days', 90) },
    finishDay: r.finishDay,
    steadyDue: r.steadyDue,
    peak: r.peak,
    daily: r.daily
  }));
} else if (argv.includes('--coverage')) {
  coverageReport({
    total: argNum('cards', 2292),
    newPerDay: argNum('new', 15),
    days: argNum('days', 262)
  });
} else if (WANT_TABLE) {
  const days = argNum('days', 90);
  const newPerDay = argNum('new', 30);
  console.log('容量对照表：每天 ' + newPerDay + ' 张新卡，备考 ' + days + ' 天（评分 75% 良好）');
  console.log('─'.repeat(72));
  console.log(pad('题库', 7, true) + ' ｜ ' + pad('需时', 6, true) + ' ｜ ' + pad('剩余巩固', 8, true)
    + ' ｜ ' + pad('后半程日均到期', 12, true) + ' ｜ 结论');
  [300, 600, 900, 1200, 1500, 2000, 2700, 3600].forEach(function (n) {
    const r = simulate({ total: n, newPerDay: newPerDay, days: days, goodRatio: goodRatio(), hardRatio: hardRatio() });
    const need = Math.ceil(n / newPerDay);
    const verdict = r.finishDay
      ? (days - r.finishDay >= 30 ? '✅ 充裕' : '🟡 偏紧')
      : '🔴 学不完';
    console.log(pad(n, 7, true) + ' ｜ ' + pad(need + '天', 6, true) + ' ｜ '
      + pad(r.finishDay ? (days - r.finishDay) + '天' : '—', 8, true) + ' ｜ '
      + pad(r.steadyDue + '张/天', 12, true) + ' ｜ ' + verdict);
  });
  console.log('');
  console.log('临界题库规模 = 每日新卡 × 备考天数（不含巩固余量）：'
    + newPerDay + ' × ' + days + ' = ' + (newPerDay * days) + ' 题');
  console.log('留 1/3 时间巩固的安全规模：约 ' + Math.floor(newPerDay * days * 2 / 3) + ' 题');
} else if (argv.includes('--check')) {
  /* 自检闸门：本脚本早期版本把「当日第几次作答」当作评分种子，
     由于每次到期复习都会把它重置为 1，等价于「每张卡的评级终身固定」，
     10% 的卡永远评「重来」天天到期，2292 题被虚增到 546 张/天（真实约 144）。
     下列断言直接锁住这个缺陷，防止再次复发。 */
  console.log('评分分布与负荷自检');
  console.log('─'.repeat(72));
  let pass = 0, fail = 0;
  function ck(name, ok, extra) {
    console.log('  ' + (ok ? '✅' : '🔴') + ' ' + name + (extra === undefined ? '' : '（' + extra + '）'));
    if (ok) pass++; else fail++;
  }

  /* ① 同一张卡连续 20 次复习，分布必须恰好等于设定比例 */
  [['0.75', 15], ['0.95', 19], ['1', 20]].forEach(function (pair) {
    const gr = Number(pair[0]);
    const hr = gr >= 1 ? 0 : (1 - gr) * 0.6;
    const tally = { good: 0, hard: 0, again: 0 };
    for (let s = 1; s <= 20; s++) tally[ratingFor(0, s, gr, hr)]++;
    ck('良好占比 ' + pair[0].replace('0.', '') + '% → ' + tally.good + '/20',
      tally.good === pair[1], '期望 ' + pair[1]);
    if (gr < 1) {
      ck('  非良好档未被吞掉（否则卡会被钉死在同一评级）',
        tally.again + tally.hard === 20 - pair[1], '困难 ' + tally.hard + ' / 重来 ' + tally.again);
    }
  });

  /* ② 900 题基准的负荷量级——一旦评分种子再出错，这里会立刻爆掉 */
  const r900 = simulate({ total: 900, newPerDay: 30, days: 90, goodRatio: 0.75, hardRatio: 0.15 });
  const total900 = r900.daily.reduce(function (a, b) { return a + b.totalN; }, 0);
  const perCard = total900 / 900;
  ck('900 题 / 90 天：单卡平均复习次数 ∈ [3, 12]', perCard >= 3 && perCard <= 12,
    perCard.toFixed(1) + ' 次');
  ck('900 题后半程日均到期 < 60 张/天', r900.steadyDue < 60, r900.steadyDue + ' 张/天');
  ck('900 题首轮恰在第 30 天完成', r900.finishDay === 30, '第 ' + r900.finishDay + ' 天');

  /* ③ 题库越大，稳态到期量不应反而下降（单调性） */
  const r1500 = simulate({ total: 1500, newPerDay: 30, days: 90, goodRatio: 0.75, hardRatio: 0.15 });
  ck('题库 1500 的稳态到期 ≥ 900 的', r1500.steadyDue >= r900.steadyDue,
    r1500.steadyDue + ' ≥ ' + r900.steadyDue);

  console.log('');
  console.log('备考容量模拟器自检：通过 ' + pass + ' / 失败 ' + fail + (fail ? '  FAIL' : ''));
  process.exit(fail === 0 ? 0 : 1);
} else {
  report({
    total: argNum('cards', 900),
    newPerDay: argNum('new', 30),
    days: argNum('days', 90),
    reviewCap: argNum('review-cap', 0),
    goodRatio: goodRatio(),
    hardRatio: hardRatio()
  });
}
