/**
 * 导入内容去重「端到端」实测（需开发者工具处于自动化模式）
 *
 * 前置：
 *   /Applications/wechatwebdevtools.app/Contents/MacOS/cli quit
 *   /Applications/wechatwebdevtools.app/Contents/MacOS/cli open --project <abs>/miniprogram
 *   /Applications/wechatwebdevtools.app/Contents/MacOS/cli auto \
 *     --project <abs>/miniprogram --auto-port 9440
 *   NODE_PATH=~/.workbuddy/binaries/node/workspace/node_modules \
 *     node scripts/verify_import_dedup_live.cjs
 *
 * 与 regress_import_dedup.cjs 的分工（二者不可互相替代）：
 *   - 回归脚本用内存 mock，测的是**判定逻辑**（哪些写法算同一道题）
 *   - 本脚本在**真实运行时**里跑 store.importCards，落的是真分片、受真机 1MB/键约束，
 *     并能验出 mock 测不到的问题：大批量去重后写入是否被拒、分片数是否收敛、
 *     学习进度是否真的没被 importCards 改掉。
 *
 * 脚本会临时替换题库，结束后**自动还原**；中途异常退出请手动检查存储。
 * 不纳入 run_all.sh（run_all 必须可在无头环境跑）。
 */
const automator = require('miniprogram-automator');

const PORT = process.env.WS_PORT || process.env.AUTO_PORT || 9440;
const KEY_SETTINGS = 'caq_6sigma_settings_v1';

const { makeCardIO } = require('./_liveenv.cjs');

let pass = 0;
let fail = 0;
const check = (n, c, d) => {
  if (c) { pass++; console.log('  ok  ' + n + (d !== undefined ? '  [' + d + ']' : '')); }
  else { fail++; console.log('FAIL  ' + n + (d !== undefined ? '  [' + d + ']' : '')); }
};

const FILLER = '六西格玛管理的核心是减少过程变异并持续改进，DMAIC 各阶段需明确交付物与测量指标；过程能力指数 Cpk 同时考虑中心偏移与固有波动。';

// 考点词表：让每张卡的**题干本体**真的不同。
// 千万别用「只改题号」的造法 —— 题号会被 dedupNormalize 剥掉，
// 那样造出来的 120 张会被正确地判成同一道题（真机实测过：只进 1 张）。
const TOPICS = ['过程能力指数 Cpk', '过程绩效指数 Ppk', '测量系统分析 GR&R', '缺陷率 DPMO', '单位缺陷数 DPU',
  '直通率 RTY', '西格玛水平 Z 值', '控制图判异准则', '抽样检验 OC 曲线', '假设检验第一类错误',
  '方差分析 ANOVA', '回归分析残差诊断', '试验设计 DOE', '响应曲面法 RSM', '田口方法信噪比',
  '失效模式 FMEA', '故障树分析 FTA', '统计过程控制 SPC', '过程sigma 水平换算', '质量功能展开 QFD'];

/**
 * 造一张「真题风格」的卡。同一批内题干与选项都随 n 变化 ⇒ 互不重复。
 * @param {number} n 全局唯一序号
 */
function mkCard(n, over) {
  const topic = TOPICS[n % TOPICS.length];
  const v = Math.floor(n / TOPICS.length); // 同考点重复出现时的变体号，保证全局唯一
  const stem = '关于' + topic + '的应用，下列说法不正确的是（）' + (v ? '（变体 ' + v + '）' : '');
  const c = {
    id: 'e2e-dedup-' + n + '-' + Math.random().toString(36).slice(2, 6),
    deck: 'E2E去重验证题集',
    qNo: String(n),
    front: '<div>（单选）' + n + '．' + stem + '</div>'
      + '<div>A. 需先确认测量系统可靠' + n + '</div><div>B. 只看固有波动' + n + '</div>'
      + '<div>C. 与规格限无关' + n + '</div><div>D. 仅用于计数型数据' + n + '</div>',
    back: '<b>答案：A</b><br/>解析：' + FILLER.repeat(8),
    options: ['A. 需先确认测量系统可靠' + n, 'B. 只看固有波动' + n, 'C. 与规格限无关' + n, 'D. 仅用于计数型数据' + n],
    correctAnswer: 'A',
    cardType: 'single_choice',
    tags: ['E2E'],
    stage: 'measure',
    interval: 0, repetitions: 0, easeFactor: 2.5, nextReviewDate: Date.now(), state: 'new'
  };
  return Object.assign(c, over || {});
}

function mkBatch(from, n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(mkCard(from + i));
  return out;
}

(async () => {
  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:' + PORT });
  const io = makeCardIO(mp);

  // ── 备份：卡片走分片语义读，设置走普通键 ──
  const backupCards = await io.readCards();
  const backupSettings = await mp.evaluate((k) => wx.getStorageSync(k), KEY_SETTINGS);
  console.log('备份：卡片 ' + backupCards.length + ' 张 / 设置 ' + (backupSettings ? '有' : '无'));

  const restore = async () => {
    if (backupCards.length) await io.writeCards(backupCards);
    else await io.writeCards([]);
    if (backupSettings) {
      await mp.evaluate((k, v) => { wx.setStorageSync(k, v); return true; }, KEY_SETTINGS, backupSettings);
    }
  };

  try {
    /* ── 1. 真实运行时里的去重扫描与导入 ── */
    console.log('\n── 1. 真实运行时：同一批导入两次 ⇒ 库不翻倍 ──');
    {
      const r = await mp.evaluate((batch) => {
        const store = require('utils/store.js');
        const importer = require('utils/importer.js');
        const out = {};

        // 从受控基线开始（空库会被示例卡回填，故先记录基线）
        store.clearAllCards();
        store.getCards();          // 触发一次回填，把基线固定下来
        out.base = store.getCards().length;

        // 第一次导入
        store.importCards(batch, 'append');
        out.r1 = store.getLastImportReport();
        out.n1 = store.getCards().length;

        // 第二次导入**同一批内容**：id 必须全新，模拟「重新上传同一个文件」
        const again = batch.map((c) => Object.assign({}, c, {
          id: 'e2e-dedup-again-' + Math.random().toString(36).slice(2, 8)
        }));
        out.idDiff = again[0].id !== batch[0].id;

        out.scan = ((s) => ({ total: s.total, library: s.library, batch: s.batch, dup: s.dup, unique: s.unique }))(store.scanDuplicates(again, 'append'));

        store.importCards(again, 'append');
        out.r2 = store.getLastImportReport();
        out.n2 = store.getCards().length;
        return out;
      }, mkBatch(1, 120));

      check('1.1 首次导入 120 张全部进库', r.r1.added === 120 && r.r1.skippedDuplicates === 0,
        'added=' + r.r1.added + ' skipped=' + r.r1.skippedDuplicates);
      check('1.2 重传时 id 确实不同（id 判重失效的前提）', r.idDiff === true, r.idDiff);
      check('1.3 扫描判定 120 张全部与库重复', r.scan.library === 120 && r.scan.dup === 120 && r.scan.unique === 0,
        'lib=' + r.scan.library + ' batch=' + r.scan.batch + ' unique=' + r.scan.unique);
      check('1.4 重传后 0 新增', r.r2.added === 0 && r.r2.skippedDuplicates === 120,
        'added=' + r.r2.added + ' skipped=' + r.r2.skippedDuplicates);
      check('1.5 库张数未翻倍', r.n2 === r.n1 && r.n1 - r.base === 120,
        'base=' + r.base + ' n1=' + r.n1 + ' n2=' + r.n2);
    }

    /* ── 2. 学习进度保护（真实落库后读回） ── */
    console.log('\n── 2. 去重写回后，库中那张的学习进度完好 ──');
    {
      const r = await mp.evaluate((cards) => {
        const store = require('utils/store.js');
        // 造一张「已学到第 5 次」的卡
        const learned = Object.assign({}, cards[0], {
          id: 'e2e-learned-1', repetitions: 5, interval: 42, easeFactor: 2.1, state: 'review'
        });
        const fresh = store.getCards().slice();
        fresh.push(learned);
        store.setCards(fresh);

        // 重传同一道题（解析写得不一样）
        const incoming = [Object.assign({}, learned, {
          id: 'e2e-incoming-' + Math.random().toString(36).slice(2, 8),
          back: '另一份来源的解析，写得完全不同。',
          correctAnswer: 'B'
        })];
        store.importCards(incoming, 'append');
        const rep = store.getLastImportReport();

        // 重新从存储读一遍（绕开内存缓存，确认真的落盘了）
        const back = store.getCards().filter((c) => c.id === 'e2e-learned-1');
        return {
          added: rep.added, skipped: rep.skippedDuplicates,
          found: back.length,
          card: back[0] ? {
            id: back[0].id, repetitions: back[0].repetitions, interval: back[0].interval,
            easeFactor: back[0].easeFactor, state: back[0].state
          } : null
        };
      }, mkBatch(500, 1));

      check('2.1 判为重复、未新增', r.added === 0 && r.skipped === 1, 'added=' + r.added + ' skipped=' + r.skipped);
      check('2.2 原卡还在（没被新卡替换）', r.found === 1 && r.card && r.card.id === 'e2e-learned-1', r.card);
      check('2.3 学习进度完好（5 次 / 42 天 / EF 2.1）',
        r.card && r.card.repetitions === 5 && r.card.interval === 42 && r.card.easeFactor === 2.1, r.card);
    }

    /* ── 3. 逃生通道：强制全部导入 ── */
    console.log('\n── 3. skipDuplicates:false ⇒ 真的会翻倍（逃生通道有效） ──');
    {
      const r = await mp.evaluate((batch) => {
        const store = require('utils/store.js');
        const before = store.getCards().length;
        const again = batch.map((c) => Object.assign({}, c, {
          id: 'e2e-force-' + Math.random().toString(36).slice(2, 8)
        }));
        store.importCards(again, 'append', { skipDuplicates: false });
        return { before: before, after: store.getCards().length, rep: store.getLastImportReport() };
      }, mkBatch(1, 50));

      check('3.1 强制导入时不去重', r.rep.skippedDuplicates === 0 && r.rep.added === 50,
        'added=' + r.rep.added + ' skipped=' + r.rep.skippedDuplicates);
      check('3.2 库确实增长 50（说明去重不是「永远拦着」）', r.after - r.before === 50,
        r.before + ' → ' + r.after);
    }

    /* ── 4. 大批量：去重 + 分片写入在真机 1MB 约束下同时成立 ── */
    console.log('\n── 4. 1200 张规模：去重后写入不被拒、分片收敛 ──');
    {
      const batch = mkBatch(1000, 1200);
      const r = await mp.evaluate((b) => {
        const store = require('utils/store.js');
        store.clearAllCards();
        store.getCards();
        const base = store.getCards().length;

        const t0 = Date.now();
        store.importCards(b, 'append');
        const t1 = Date.now();
        const first = store.getLastImportReport();
        const w1 = store.getLastCardWrite();
        const n1 = store.getCards().length;

        // 整批重传：应全部判重，且不产生写入膨胀
        const again = b.map((c) => Object.assign({}, c, { id: 'e2e-big-' + Math.random().toString(36).slice(2, 8) }));
        const t2 = Date.now();
        store.importCards(again, 'append');
        const t3 = Date.now();

        return {
          base: base, n1: n1, n2: store.getCards().length,
          first: first, second: store.getLastImportReport(),
          w1ok: w1 ? w1.ok : null, w1reason: w1 ? w1.reason : null,
          ms1: t1 - t0, ms2: t3 - t2
        };
      }, batch);

      check('4.1 首次 1200 张写入成功（未被 1MB 上限拒掉）', r.w1ok === true && r.first.added === 1200,
        'ok=' + r.w1ok + ' added=' + r.first.added + (r.w1reason ? ' reason=' + r.w1reason : ''));
      check('4.2 整批重传全判重', r.second.skippedDuplicates === 1200 && r.second.added === 0,
        'added=' + r.second.added + ' skipped=' + r.second.skippedDuplicates);
      check('4.3 重传后库未翻倍', r.n2 === r.n1, r.n1 + ' → ' + r.n2);

      const v = await io.verify();
      check('4.4 分片完整无缺片', v.ok === true && v.missing.length === 0, v.reason || 'ok');
      check('4.5 单片未超 1MB 硬上限', v.maxShardBytes < 1024 * 1024, Math.round(v.maxShardBytes / 1024) + 'KB 最大片');
      check('4.6 单片在预算内', v.maxShardBytes <= io.S.SHARD_BUDGET_BYTES,
        Math.round(v.maxShardBytes / 1024) + 'KB / 预算 ' + Math.round(io.S.SHARD_BUDGET_BYTES / 1024) + 'KB');
      check('4.7 重传耗时在可接受范围（<3s）', r.ms2 < 3000, r.ms2 + 'ms（首次 ' + r.ms1 + 'ms）');
      console.log('      存储占用 ' + (v.storageInfo.currentSizeKB || '?') + 'KB / 上限 ' + (v.storageInfo.limitSizeKB || '?') + 'KB，共 ' + v.count + ' 片');
    }

    /* ── 5. 残卡不被吞并（真机落库后核对张数） ── */
    console.log('\n── 5. 空/极短题干残卡：不会被互相合并 ──');
    {
      const r = await mp.evaluate(() => {
        const store = require('utils/store.js');
        store.clearAllCards();
        store.getCards();
        const base = store.getCards().length;
        const junk = [
          { id: 'e2e-j1', deck: '残卡', front: '', back: 'x' },
          { id: 'e2e-j2', deck: '残卡', front: '   ', back: 'y' },
          { id: 'e2e-j3', deck: '残卡', front: '1.', back: 'z' },
          { id: 'e2e-j4', deck: '残卡', front: '（单选）', back: 'w' }
        ];
        store.importCards(junk, 'append');
        const r1 = store.getLastImportReport();
        const junk2 = junk.map((c) => Object.assign({}, c, { id: c.id + '-b' }));
        store.importCards(junk2, 'append');
        const r2 = store.getLastImportReport();
        return { base: base, r1: r1, r2: r2, n: store.getCards().length };
      });

      check('5.1 首批 4 张残卡全部入库', r.r1.added === 4 && r.r1.skippedDuplicates === 0, r.r1);
      check('5.2 再来一批残卡仍全部入库（不互相吞并）', r.r2.added === 4 && r.r2.skippedDuplicates === 0, r.r2);
    }

  } finally {
    console.log('\n── 还原题库 ──');
    await restore();
    const after = await io.readCards();
    console.log('还原后：卡片 ' + after.length + ' 张（备份 ' + backupCards.length + ' 张）');
    await mp.disconnect();
  }

  console.log('\n导入内容去重（真机）：通过 ' + pass + ' / 失败 ' + fail);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('运行异常：', e && e.stack || e);
  process.exit(1);
});
