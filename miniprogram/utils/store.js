/**
 * 本地持久化存储层
 * 原 H5 版本使用 localStorage，小程序改用 wx.getStorageSync / wx.setStorageSync
 */

const { INITIAL_CARDS } = require('../data/defaultCards.js');
const importer = require('./importer.js');
// 卡片分片存储（规避单 key 1MB 上限）。键名与切分规则集中在 cardShards.js：
// 纯函数模块，Node 回归脚本与真机脚本都 require 同一份实现，避免测试与实现漂移。
const cardShards = require('./cardShards.js');

const KEY_STATS = 'caq_6sigma_user_stats_v1';
const KEY_SETTINGS = 'caq_6sigma_settings_v1';
// 以下键由刷题页 anki/index.js 使用，集中声明于此避免云同步打包时键名漂移
const KEY_SESSIONS = 'caq_anki_sessions_v1';     // 各题集未完成复习会话（断点续学）
const KEY_FLIP_HINT = 'caq_flip_hint_shown_v1';  // 操作提示只显示一次的持久化标记

// 备份结构版本。exportAll 目前写 v:1（新增字段均为可选，形状是严格超集，
// 老版本 App 整包写回也不会丢数据），importAll 用此常量拒绝来自更新版本的备份。
const SUPPORTED_SCHEMA_VERSION = 1;

// 默认题集名。与 pages/anki/index.js 的 DEFAULT_DECK 同值，
// 集中声明于此供统计/配额函数复用（两处各写一份会在改名时漏掉一处）。
const DEFAULT_DECK_NAME = '默认牌组';

function todayStr() {
  const d = new Date();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return d.getFullYear() + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
}

function daysBetween(a, b) {
  const pa = a.split('-').map(Number);
  const pb = b.split('-').map(Number);
  const da = Date.UTC(pa[0], pa[1] - 1, pa[2]);
  const db = Date.UTC(pb[0], pb[1] - 1, pb[2]);
  return Math.round((db - da) / 86400000);
}

function defaultCards() {
  const now = Date.now();
  return INITIAL_CARDS.map(function (c) {
    return Object.assign({}, c, { nextReviewDate: now });
  });
}

function defaultStats() {
  return {
    totalReviewed: 0,
    cardsMastered: 0,
    cardsLearning: 0,
    cardsNew: 0,
    streakDays: 0,   // 真实连续天数：首次无历史时显示 0，隔日访问自 1 起累计
    lastActiveDate: todayStr(),
    wrongCardIds: [],
    favoriteCardIds: [],
    // 按天学习记录：{ 'YYYY-MM-DD': { sec: 秒, rated: 评分次数, kept: 记忆保留成功(良好/简单)次数 } }
    daily: {}
  };
}

function defaultSettings() {
  return {
    dark: true,        // 默认开启暗黑模式（深蓝夜间护眼）
    haptic: true,
    studyCount: 30,   // 每轮（单批）卡片数：只决定「一次做多少张」的批次粒度，防疲劳
    // —— 每日配额（2026-09-10 新增）——
    // 备考场景真正要控的是「每天投入多少」，而不是「每批多少张」。
    // 拆成两个独立配额：新卡决定首轮何时结束，复习上限是时间闸门。
    // 依据：scripts/sim_exam_capacity.cjs —— 首轮天数 ≈ 题库 ÷ newPerDay；
    // 若新卡与到期卡共用一个名额池，靠前的到期卡会把新卡挤掉（实测首轮 +300%）。
    newPerDay: 20,     // 每日新卡上限（1–200）
    reviewPerDay: 0,   // 每日到期复习上限；0 = 不限（做完为止）
    examDate: '',      // 考试日期 'YYYY-MM-DD'；空 = 未设置（用于反推所需新卡量）
    // —— 调度算法相关（2026-09-10 引入 FSRS 影子记录时新增）——
    // 目标保留率：备考场景取 0.95 而非 ts-fsrs 库默认的 0.90。
    // 0.90 会让末次复习停在第 59 天、与第 180 天的考试之间空 121 天。
    requestRetention: 0.95,
    // 间隔上限（天）——**2026-09-10 起对 SM-2 真正生效**（此前只作用于 FSRS 影子）。
    // 取 90 而非 SM-2 自身的 365 上限：备考有明确的时间边界，间隔按 EF 连乘增长时，
    // 卡片会被排到考试日之后、此后不再出现。根据 scripts/sim_exam_capacity.cjs --coverage：
    //   262 天窗口 / 2316 题 —— 上限 365 时考前 60 天内只有 71% 的卡被复习过、最久空档 128 天；
    //   压到 90 天只需 +1% 负荷（日均 74→75 张）即可把最久空档压到 89 天以内。
    // 上限只能收紧不能放宽（SM-2 硬天花板 365 天，见 sm2.js 的 MAX_INTERVAL_DAYS）。
    maxIntervalDays: 90
  };
}

/* ---------------- 卡片 ---------------- */

/**
 * （已停用）内置卡内容同步：内置题库删除后 INITIAL_CARDS 为空数组，
 * 本函数恒等返回原卡片列表，保留以兼容调用结构；清除存量内置卡见 removeBuiltIns。
 */
/**
 * 内置卡同步：以代码常量 `INITIAL_CARDS` 为**内容权威**（题库更新时正文随之更新），
 * 但**用户产生的数据必须原样保留**。
 *
 * 🐛 2026-09-10 修：原实现只保留 6 个调度字段（interval/repetitions/easeFactor/
 * nextReviewDate/state/deck），其余一律丢弃——而本函数**每次 getCards() 都会命中**
 * （只要有内置卡，changed 恒为 true），等于每次读卡片都把 history / fsrs 抹掉。
 * 后果：① 示例卡的 FSRS 影子记录永远是空的，迁移时无线索可重放；
 *       ② 内置题库卡（将来若是内置版）同理；③ 卡片补图 localImages 也会丢。
 * 修法是改成「内容覆盖 + 进度透传」，且用显式清单而不是默认丢弃，
 * 这样将来新增用户字段时只需往 USER_KEYS 加一项，不会被静默抹掉。
 */
const BUILTIN_CONTENT_KEYS = ['id', 'deck', 'qNo', 'front', 'back', 'cardType', 'stage', 'tags',
  'options', 'correctAnswer', 'correctLetters'];
const BUILTIN_USER_KEYS = ['interval', 'repetitions', 'easeFactor', 'nextReviewDate', 'state',
  'deck', 'history', 'fsrs', 'localImages', 'lastReviewed'];

function syncBuiltIns(cards) {
  let changed = false;
  const map = {};
  INITIAL_CARDS.forEach(function (c) { map[c.id] = c; });
  const out = cards.map(function (c) {
    const src = map[c.id];
    if (!src) return c;
    changed = true;
    const patch = {};
    // 内容以代码为准
    BUILTIN_CONTENT_KEYS.forEach(function (k) { if (src[k] !== undefined) patch[k] = src[k]; });
    // 进度以存储为准（含用户产生的 history / fsrs / 补图）
    BUILTIN_USER_KEYS.forEach(function (k) { if (c[k] !== undefined) patch[k] = c[k]; });
    return Object.assign({}, c, patch);
  });
  return changed ? out : cards;
}

/**
 * 导入卡修复（一次性同步，getCards 内触发）：
 * 早期版本导入时 ① 选项提取只认 A-D（E/F 被丢弃或整卡未提取成纯文本闪卡）；
 * ② 从未提取 correctAnswer（渲染层默认按 A 判分导致误判翻面）。
 * 对 import- 前缀的存量卡：用新版提取逻辑重跑正面文本恢复选项、从背面补提答案，回写存储。
 */
function syncImportedCards(cards) {
  let changed = false;
  const out = cards.map(function (c) {
    if (String(c.id || '').indexOf('import-') !== 0) return c;
    let patch = null;

    // 0) 解 CSV 包裹引号：早期导入把 Anki 导出字段整段包裹的双引号一并存进了 front/back；
    //    同时清理本地截图占位标记（@image#1:xxx.png 等纯文本残留）
    const rawFront = c.front || '';
    const rawBack = c.back || '';
    const oldFront = importer.stripLocalImages(importer.unquoteField(rawFront));
    const cleanBack = importer.stripLocalImages(importer.unquoteField(rawBack));
    if (oldFront !== rawFront || cleanBack !== rawBack) {
      patch = Object.assign(patch || {}, { front: oldFront, back: cleanBack });
    }

    // 1) 用新版逻辑重提取选项与题干（覆盖 HTML 富文本、E/F、全角标点、内联等旧版漏提取场景）
    //    正面提不到时回退到背面区域（题干/选项/答案分列的 Anki 多字段模板）
    let picked = importer.extractChoiceOptions(oldFront);
    let optionsFromFront = !!(picked.options && picked.options.length >= 2);
    if (!optionsFromFront) {
      const pickedBack = importer.extractChoiceOptions(importer.cutBackAtAnswer(cleanBack));
      if (pickedBack.options && pickedBack.options.length >= 2) {
        picked = pickedBack;
        optionsFromFront = false;
      }
    }
    if (picked.options && picked.options.length >= 2) {
      const optsChanged = JSON.stringify(c.options || []) !== JSON.stringify(picked.options);
      // 选项取自正面 → 题干用新版剥净文本；取自背面且正面已有题干 → 保留正面题干
      const keepOld = !optionsFromFront && oldFront.trim();
      const nextFront = keepOld ? oldFront : (picked.question || oldFront);
      if (optsChanged || nextFront !== c.front) {
        patch = Object.assign(patch || {}, {
          options: optsChanged ? picked.options : c.options,
          front: nextFront
        });
      }
    }

    // 1b) 选项卡题干清理：只剥杂散引号/空白，保留「(单选)」题型标注与题号
    //     （2026-09 需求变更：题干不再剥 单选/多选 前缀）
    if (c.options && c.options.length) {
      const trimmed = importer.trimFrontJunk(oldFront);
      if (trimmed && trimmed !== ((patch && patch.front) || c.front)) {
        patch = Object.assign(patch || {}, { front: trimmed });
      }
    }

    // 1c) 选项被解析评注污染的旧卡修复：如「A. 错误，数值计算不匹配。」这类
    //     是背面解析的逐项点评被旧解析器误抓为选项。多数选项呈评注句式
    //     （错误/正确 + 逗号句号续句）→ 判为污染，清空选项退化为问答卡（翻面自评）。
    const curOpts = (patch && patch.options) || c.options;
    if (curOpts && curOpts.length >= 3) {
      const commentN = curOpts.filter(function (o) { return importer.isCommentOption(o); }).length;
      if (commentN >= curOpts.length / 2) {
        patch = Object.assign(patch || {}, { options: [], cardType: 'flashcard' });
      }
    }

    // 2) 补正确答案：缺则从背面解析文本提取
    let answer = c.correctAnswer;
    if (!answer) {
      const derived = importer.extractCorrectAnswer(cleanBack, (patch && patch.front) || oldFront);
      if (derived) answer = derived;
    }
    if (answer && answer !== c.correctAnswer) {
      patch = Object.assign(patch || {}, { correctAnswer: answer });
    }

    // 3) 题型校正：按答案字母个数分单选/多选
    const finalOptions = (patch && patch.options) || c.options;
    if (finalOptions && finalOptions.length) {
      const ct = (answer || '').length > 1 ? 'multiple_choice' : 'single_choice';
      if (c.cardType !== ct) patch = Object.assign(patch || {}, { cardType: ct });
    }

    if (patch) { changed = true; return Object.assign({}, c, patch); }
    return c;
  });
  return changed ? out : cards;
}

/**
 * 内置题库已删除：存量设备上仍存储的内置卡（caq-bb-* 前缀）在此统一清除，
 * 只保留用户导入的题集（import- 前缀及其它自定义卡）。
 */
function removeBuiltIns(cards) {
  const out = cards.filter(function (c) {
    return String(c.id || '').indexOf('caq-bb-') !== 0;
  });
  return out.length !== cards.length ? out : cards;
}

/**
 * 调度字段惰性迁移（getCards 内触发，与 syncBuiltIns / syncImportedCards 同一模式）：
 * 给早期 history 条目补 elapsedDays（距上次复习的真实天数）。
 *
 * 为什么值得补：切换 FSRS 时需要每两次复习之间的真实间隔。老条目只有
 * {date, rating}，虽然可由相邻 date 相减得到，但卡片「重来」后是 10 分钟重学步
 * —— 若按天粒度处理会被抹平成 0，而 elapsed_days 正是决定稳定度增益的自变量，
 * 这一档数据错了就不可逆。一次补齐，将来切算法不必再为老数据写特殊分支。
 *
 * 用「最后一条是否已有该字段」作哨兵：新增条目一律自带，故哨兵命中即视为整卡已迁移，
 * 避免每次 getCards 全量重算。
 */
function syncSchedulerHistory(cards) {
  let changed = false;
  const out = cards.map(function (c) {
    const h = c.history;
    if (!Array.isArray(h) || !h.length) return c;
    if (h[h.length - 1].elapsedDays !== undefined) return c; // 已迁移过
    let prev = 0;
    const next = h.map(function (e) {
      const d = Number(e.date) || 0;
      if (e.elapsedDays !== undefined) {
        prev = d || prev;
        return e;
      }
      const v = prev && d ? Math.max(0, (d - prev) / 86400000) : 0;
      prev = d || prev;
      // 与 scheduler.js 的 round6 同精度（保留亚日间隔）
      return Object.assign({}, e, { elapsedDays: Math.round(v * 1e6) / 1e6 });
    });
    changed = true;
    return Object.assign({}, c, { history: next });
  });
  return changed ? out : cards;
}

/* ---------------- 卡片分片读写（规避单 key 1MB 上限） ---------------- */

/**
 * 背景：微信对**单个 storage key 设 1MB 上限**（合计 10MB），超出时
 * `wx.setStorageSync` 抛错。原先全部卡片存在一个 key 里，实测单卡均值 1.66KB
 * ⇒ 2316 张 = 3842KB，真机写入必然失败；而旧代码把异常吞掉了，用户看到的是
 * 「进度不保存」。开发者工具不强制该上限，所以本地测不出来。
 *
 * 现在的布局（键名常量见 cardShards.js）：
 *   caq_6sigma_flashcards_v1   旧版单键，v2 迁移来源，迁移成功后删除
 *   caq_6sigma_cards_meta_v2   分片元数据，也是**提交点**
 *   caq_6sigma_cards_v2_0…N    分片本体，按下标拼接即原数组顺序
 */

// 上一次成功读/写的分片内容，用于「只重写真正变了的分片」：
// 复习一张卡原本要重写整个题库（2316 张 = 3.8MB），分片后通常只动 1 片。
let _shardCache = { ser: [], val: [] };
let _lastCardWrite = null;
// 最近一次导入的内容去重结果（见 importCards）。与 _lastCardWrite 一样是「读一次就丢」的旁路结果：
// 必须在紧接着的 getCards() **之前**取，否则会被惰性同步覆盖。
let _lastImportReport = null;
// 最近一次读到的不是全量（缺片 / total 对不上）。上层据此强制回写补齐 ——
// 否则「读回的内容没变 ⇒ 跳过写入」的优化会让缺损状态永远留在存储里，
// 用户看到的是 900 道题悄悄变成 678 道，且没有任何报错。
let _readIncomplete = false;

function _clearShardCache() {
  _shardCache = { ser: [], val: [] };
}

function _cacheSet(parts) {
  const ser = [];
  const val = [];
  for (let i = 0; i < parts.length; i++) {
    ser.push(JSON.stringify(parts[i]));
    val.push(parts[i]);
  }
  _shardCache = { ser: ser, val: val };
}

function _rawGet(key) {
  try {
    const v = wx.getStorageSync(key);
    return v === '' || v === undefined || v === null ? null : v;
  } catch (e) {
    return null;
  }
}

function _rawSet(key, val) {
  try {
    wx.setStorageSync(key, val);
    return true;
  } catch (e) {
    return false;
  }
}

function _rawRemove(key) {
  try { wx.removeStorageSync(key); } catch (e) {}
}

/**
 * 宽容读取全部分片：任何一片缺失都不中断，把缺的序号记进 missing。
 * 为什么不「缺一片就整体判失败」：真出现缺片时，返回 null 会让上层回落到
 * defaultCards()，等于把剩下几片也一并覆盖掉 —— 小故障被放大成整库丢失。
 */
function _readShardsLoose(count) {
  const parts = [];
  const cards = [];
  const missing = [];
  for (let i = 0; i < count; i++) {
    const part = _rawGet(cardShards.shardKey(i));
    if (!Array.isArray(part)) {
      missing.push(i);
      parts.push(null);
      continue;
    }
    parts.push(part);
    for (let j = 0; j < part.length; j++) cards.push(part[j]);
  }
  return { parts: parts, cards: cards, missing: missing };
}

/** 读旧版单键（v2 迁移来源）。空/非数组 → null。 */
function _readLegacy() {
  const v = _rawGet(cardShards.LEGACY_KEY);
  return Array.isArray(v) && v.length ? v : null;
}

/**
 * 读取卡片：优先分片，分片不可用时回退旧版单键，旧键有数据则顺带完成 v1→v2 迁移。
 * 返回数组或 null（null = 存储里确实没有卡片，由调用方决定默认值）。
 */
function readCardsRaw() {
  _readIncomplete = false;
  const meta = _rawGet(cardShards.META_KEY);
  if (meta && Number(meta.v) === cardShards.SCHEMA_VERSION && Number(meta.count) >= 0) {
    const count = Number(meta.count);
    const r = _readShardsLoose(count);
    if (!r.missing.length && r.cards.length === Number(meta.total)) {
      _cacheSet(r.parts);
      return r.cards;
    }
    // 分片异常：标记为「非全量」，让上层强制回写（自愈），并先看旧键还在不在
    _readIncomplete = true;
    const legacy = _readLegacy();
    _clearShardCache(); // 强制下一次写入全量重写，把缺口补上（缓存会误判为「未变」）
    if (legacy) return legacy;
    if (r.cards.length) return r.cards; // 部分恢复，绝不返回 null 触发默认库覆盖
    return null;
  }
  const legacy = _readLegacy();
  if (legacy) {
    _clearShardCache();
    migrateCardsToShards(legacy);
    return legacy;
  }
  return null;
}

/**
 * v1 → v2 迁移：把旧版单键的卡片写成分片，**读回校验通过后才删除旧键**。
 * 读回校验是这里唯一的防线 —— 旧键一旦删掉而分片没写成功，就是整库丢失。
 */
function migrateCardsToShards(legacy) {
  const info = writeCards(legacy);
  if (!info.ok) return info;
  const back = _readShardsLoose(info.count);
  if (back.missing.length || back.cards.length !== legacy.length) {
    info.ok = false;
    info.reason = 'migrate-verify-failed';
    _lastCardWrite = info;
    return info;
  }
  _rawRemove(cardShards.LEGACY_KEY);
  return info;
}

/** 回滚：把已写过的分片恢复成写之前的值（原先不存在则删掉）。 */
function _rollback(indices) {
  for (let k = 0; k < indices.length; k++) {
    const i = indices[k];
    const old = _shardCache.val[i];
    if (old === undefined || old === null) _rawRemove(cardShards.shardKey(i));
    else _rawSet(cardShards.shardKey(i), old);
  }
}

/** 删除序号 >= count 的残留分片（分片数变少时才会真的删到东西）。 */
function _cleanupStaleShards(count) {
  try {
    if (typeof wx.getStorageInfoSync === 'function') {
      const stored = wx.getStorageInfoSync() || {};
      const keys = stored.keys || [];
      const prefix = cardShards.SHARD_KEY_PREFIX;
      for (let i = 0; i < keys.length; i++) {
        const k = String(keys[i]);
        if (k.indexOf(prefix) !== 0) continue;
        const idx = Number(k.slice(prefix.length));
        if (isFinite(idx) && idx >= count) _rawRemove(k);
      }
      return;
    }
  } catch (e) {}
  // 无 getStorageInfoSync（部分测试环境）：按上一轮片数推导上界
  const upper = _shardCache.val.length + 4;
  for (let i = count; i < upper; i++) _rawRemove(cardShards.shardKey(i));
}

/**
 * 写入卡片（分片）。提交顺序是有意设计的：
 *   ① 写分片 —— 任一片失败即回滚已写片，meta 不动，读者仍看到旧数据；
 *   ② 写 meta —— **提交点**，失败同样回滚；
 *   ③ 清理多余分片 + 删除旧版单键。
 * 最坏情况是回到写之前的状态，不会出现「meta 指向一堆没写成功的片」。
 *
 * 返回 { ok, reason, count, cards, bytes, wrote, skipped, oversize }，调用方可忽略。
 */
function writeCards(cards) {
  const list = Array.isArray(cards) ? cards : [];
  const p = cardShards.plan(list);
  const info = {
    ok: true, reason: '', count: p.shards.length, cards: list.length,
    bytes: p.totalBytes, wrote: 0, skipped: 0, oversize: p.oversize, at: Date.now()
  };

  if (p.totalBytes > cardShards.MAX_TOTAL_BYTES) {
    info.ok = false;
    info.reason = 'too-large';
    _lastCardWrite = info;
    return info;
  }

  // plan 里已经为计量字节数算过一次 JSON，这里直接复用，省掉一次全量 stringify
  const ser = p.ser || [];

  const written = [];
  for (let i = 0; i < p.shards.length; i++) {
    if (_shardCache.ser[i] === ser[i]) { info.skipped++; continue; }
    if (!_rawSet(cardShards.shardKey(i), p.shards[i])) {
      _rollback(written);
      info.ok = false;
      info.reason = 'shard-write-failed';
      info.failedAt = i;
      _lastCardWrite = info;
      return info;
    }
    written.push(i);
    info.wrote++;
  }

  const meta = cardShards.metaOf(p);
  if (!_rawSet(cardShards.META_KEY, meta)) {
    _rollback(written);
    info.ok = false;
    info.reason = 'meta-write-failed';
    _lastCardWrite = info;
    return info;
  }

  _cleanupStaleShards(p.shards.length);
  _rawRemove(cardShards.LEGACY_KEY);
  _cacheSet(p.shards);
  _lastCardWrite = info;
  return info;
}

/**
 * 只读存储诊断：绕过 getCards 的惰性迁移，如实报告分片现状，本身不产生写入。
 * 供真机验证脚本与故障排查使用。
 */
function verifyCardStorage() {
  const meta = _rawGet(cardShards.META_KEY);
  if (!meta || Number(meta.v) !== cardShards.SCHEMA_VERSION) {
    const legacy = _readLegacy();
    return {
      ok: false,
      reason: meta ? 'schema-mismatch' : 'not-migrated',
      schema: meta ? Number(meta.v) : 0,
      legacyCards: legacy ? legacy.length : 0
    };
  }
  const expected = Number(meta.total);
  const r = _readShardsLoose(Number(meta.count));
  return {
    ok: !r.missing.length && r.cards.length === expected,
    reason: r.missing.length ? 'shard-missing' : (r.cards.length === expected ? '' : 'count-mismatch'),
    schema: Number(meta.v),
    count: Number(meta.count),
    cards: r.cards.length,
    expected: expected,
    missing: r.missing
  };
}

function getCards() {
  try {
    const saved = readCardsRaw();
    if (saved && Array.isArray(saved) && saved.length > 0) {
      let synced = syncBuiltIns(saved);
      synced = syncImportedCards(synced);
      synced = removeBuiltIns(synced);
      synced = syncSchedulerHistory(synced);
      // 内容没变也要在「上次读到的不是全量」时回写：靠写入补齐缺损分片
      if (synced !== saved || _readIncomplete) setCards(synced);
      return synced;
    }
  } catch (e) {}
  const cards = defaultCards();
  setCards(cards);
  return cards;
}

function setCards(cards) {
  const info = writeCards(cards);
  _lastCardWrite = info;
  return info;
}

function updateCard(updated) {
  const cards = getCards().map(function (c) {
    return c.id === updated.id ? updated : c;
  });
  setCards(cards);
  return cards;
}

/**
 * 题集重命名：把某一题集名下所有卡片改到新题集名。
 * 用于修正导入时题集名被写坏（例如弹窗提示语被当成名称）的批量数据。
 */
function renameDeck(oldName, newName) {
  const to = String(newName || '').trim().replace(/\s+/g, ' ');
  if (!to) return { ok: false, changed: 0, reason: 'empty' };
  let changed = 0;
  const next = getCards().map(function (c) {
    if (!c) return c;
    const cur = c.deck || '未命名';
    if (cur === oldName) { changed += 1; return Object.assign({}, c, { deck: to }); }
    return c;
  });
  if (changed > 0) setCards(next);
  return { ok: changed > 0, changed: changed };
}

/**
 * 内容去重扫描：**只读**，不写任何存储。
 *
 * 为什么需要它：导入卡的 id 由 `Date.now() + 随机串` 生成、不含内容，
 * 所以同一个文件重新上传一次，按 id 判重完全失效（100% 变成重复对子）。
 * 这里改用 importer.contentKey()（归一化题干 + 归一化选项）判定「是不是同一道题」。
 *
 * 判定规则：
 * - `mode === 'replace'` 时库会被整批替换，故只比对本批内部；
 * - 指纹为 null（空题干 / 归一化后过短的残卡）一律视为不重复、原样保留，
 *   否则一批空题干的残卡会互相吞并成一张；
 * - **保留库中已有的那一张**（它带着学习进度），丢弃本批的重复项。
 *
 * @param {Array} [prevCards] 已在手边的当前库；不传则内部读取（importCards 会复用同一次读取）
 * @returns {{total:number, library:number, batch:number, dup:number,
 *            unique:number, kept:Array, libraryCards:Array, batchCards:Array}}
 */
function scanDuplicates(newCards, mode, prevCards) {
  const list = Array.isArray(newCards) ? newCards : [];
  // 调用方未传库时，自己读一次。走 readCardsRaw（不触发惰性同步回写），
  // 保证扫描动作是「只读」的——admin 页面把它当探针用，不该引出 setStorage 写入。
  // 这也是回归 9.2「扫描未改动存储」这条断言成立的前提。
  const lib = (mode === 'replace') ? [] : (prevCards || readCardsRaw() || []);

  const seenLib = Object.create(null);
  for (let i = 0; i < lib.length; i++) {
    const k = importer.contentKey(lib[i]);
    if (k) seenLib[k] = 1;
  }

  const seenBatch = Object.create(null);
  const kept = [];
  const libraryCards = [];
  const batchCards = [];
  for (let j = 0; j < list.length; j++) {
    const c = list[j];
    const k = importer.contentKey(c);
    if (!k) { kept.push(c); continue; }        // 无法判定 ⇒ 一律保留
    if (seenLib[k]) { libraryCards.push(c); continue; }
    if (seenBatch[k]) { batchCards.push(c); continue; }
    seenBatch[k] = 1;
    kept.push(c);
  }

  const dup = libraryCards.length + batchCards.length;
  return {
    total: list.length,
    library: libraryCards.length,
    batch: batchCards.length,
    dup: dup,
    unique: kept.length,
    kept: kept,
    libraryCards: libraryCards,
    batchCards: batchCards
  };
}

/**
 * 导入卡片。
 *
 * @param {Array} newCards
 * @param {string} mode  'append' 追加 / 'replace' 覆盖
 * @param {Object} [opts]
 * @param {boolean} [opts.skipDuplicates=true]
 *        默认**开启内容去重**：丢弃与库中（或本批内）题干+选项相同的卡。
 *        传 false 可强制全部导入（用户点「仍然导入」的逃生通道）。
 *        被丢弃的永远是**本批新卡**，库中已有那张（含学习进度）绝不被删改。
 * @returns {Array} 导入后的全量卡片数组（与旧版本返回值兼容）
 */
function importCards(newCards, mode, opts) {
  const opt = opts || {};
  const incoming = Array.isArray(newCards) ? newCards : [];
  const skip = opt.skipDuplicates !== false;

  // 只读一次库：既给去重扫描用，也给合并用（两次读之间库可能被惰性同步改写，会不一致）
  const prev = (mode === 'replace') ? [] : getCards();
  const dup = scanDuplicates(incoming, mode, prev);
  const toAdd = skip ? dup.kept : incoming;

  let merged;
  const before = prev.length;
  if (mode === 'replace') {
    merged = toAdd.slice();
  } else {
    const existing = {};
    prev.forEach(function (c) { existing[c.id] = 1; });
    merged = prev.concat(toAdd.filter(function (c) { return !existing[c.id]; }));
  }
  setCards(merged);

  _lastImportReport = {
    mode: mode || 'append',
    total: incoming.length,
    // 本批实际尝试写入的张数（去重后 / 或强制全部）
    attempted: toAdd.length,
    skippedDuplicates: skip ? dup.dup : 0,
    duplicateInLibrary: skip ? dup.library : 0,
    duplicateInBatch: skip ? dup.batch : 0,
    // 真正进库的张数（追加模式下还会再扣掉 id 重复）
    added: merged.length - before,
    totalAfter: merged.length
  };
  return merged;
}

/**
 * 恢复初始状态：回到 defaultCards()（= 示例卡 + 内置题库）。
 * 注意：示例卡常驻，故恢复后不会是空库。若需真正清空请用 clearAllCards()。
 */
function resetCards() {
  const cards = defaultCards();
  setCards(cards);
  return cards;
}

/**
 * 真正清空题库（连示例卡一并清掉）。
 * 用于管理控制台「清空题库」——用户点了就是想空，不该又冒出示例卡。
 */
function clearAllCards() {
  setCards([]);
  return [];
}

/* ---------------- 统计 ---------------- */

/**
 * 旧演示种子指纹识别：早期版本 defaultStats() 写死 streakDays:4 及一组默认统计
 * （totalReviewed 12 / mastered 3 / learning 5 / new 4、错题恰为 caq-bb-005、
 *  收藏恰为 004+009、无任何按日学习记录）。此类数据已持久化进 storage，
 * 改默认值无法自动归零。命中指纹（几乎只可能是从未真实学习的种子数据）即重建，
 * 不误伤有真实学习/打卡记录的用户。
 */
function looksLikeLegacySeed(stats) {
  if (!stats || typeof stats !== 'object') return false;
  const w = stats.wrongCardIds;
  const f = stats.favoriteCardIds;
  const d = stats.daily;
  if (stats.totalReviewed !== 12 || stats.cardsMastered !== 3) return false;
  if (stats.cardsLearning !== 5 || stats.cardsNew !== 4 || stats.streakDays < 4) return false;
  if (!Array.isArray(w) || w.length !== 1 || w[0] !== 'caq-bb-005') return false;
  if (!Array.isArray(f) || f.length !== 2 || f.indexOf('caq-bb-004') < 0 || f.indexOf('caq-bb-009') < 0) return false;
  if (d && typeof d === 'object' && Object.keys(d).length > 0) return false;
  return true;
}

function getStats() {
  let stats = null;
  try {
    const saved = wx.getStorageSync(KEY_STATS);
    if (saved && typeof saved === 'object') stats = saved;
  } catch (e) {}
  if (!stats) {
    stats = defaultStats();
  } else if (looksLikeLegacySeed(stats)) {
    // 一次性迁移：识别为旧演示种子 → 重建为真实口径（连续天数从 0 起）
    stats = defaultStats();
    setStats(stats);
  }
  // 连续打卡天数滚动更新
  const today = todayStr();
  if (stats.lastActiveDate !== today) {
    const gap = stats.lastActiveDate ? daysBetween(stats.lastActiveDate, today) : 99;
    stats.streakDays = gap === 1 ? (stats.streakDays || 0) + 1 : 1;
    stats.lastActiveDate = today;
    setStats(stats);
  }
  if (!Array.isArray(stats.wrongCardIds)) stats.wrongCardIds = [];
  if (!Array.isArray(stats.favoriteCardIds)) stats.favoriteCardIds = [];
  if (!stats.daily || typeof stats.daily !== 'object') stats.daily = {};
  return stats;
}

function setStats(stats) {
  try {
    wx.setStorageSync(KEY_STATS, stats);
  } catch (e) {}
}

function incrementReviewed(n) {
  const stats = getStats();
  stats.totalReviewed = (stats.totalReviewed || 0) + (n || 1);
  setStats(stats);
  return stats;
}

/**
 * 记录今日学习行为（进度看板数据源）：
 * @param sec 本次累计的纯学习秒数（前台刷题停留时间）
 * @param keep 最近一次评分是否为「记忆保留成功」（良好/简单=true，重来/困难=false）；
 *             不传则只记时长。
 * 每日累计结构 daily[date] = { sec, rated, kept }
 *   rated = 当日评分总次数；kept = 其中良好/简单次数
 *   记忆保留率 = kept / rated；卡片错误率 = 1 - kept / rated
 */
function recordStudy(sec, keep) {
  const stats = getStats();
  const today = todayStr();
  if (!stats.daily || typeof stats.daily !== 'object') stats.daily = {};
  const d = stats.daily[today] || { sec: 0, rated: 0, kept: 0 };
  d.sec = (d.sec || 0) + Math.max(0, Math.round(sec || 0));
  if (keep !== undefined && keep !== null) {
    d.rated = (d.rated || 0) + 1;
    if (keep) d.kept = (d.kept || 0) + 1;
  }
  stats.daily[today] = d;
  setStats(stats);
  return d;
}

/* ---------------- 每日配额与备考覆盖率（2026-09-10 新增） ---------------- */

/**
 * 距考试日还有几天（含今天算 1 天）；未设置或已过期返回 null。
 * 走 daysBetween 的 UTC 计算，避免夏令时/时区让天数差 1。
 */
function daysToExam(examDate) {
  const s = normExamDate(examDate);
  if (!s) return null;
  const diff = daysBetween(todayStr(), s);
  return diff >= 0 ? diff + 1 : null;
}

/**
 * 今日配额使用情况。
 * ⚠️ dueLeft = Infinity 表示「不限」，调用方必须先判断再参与算术
 * （Infinity 参与 slice/min 会得到看似正常的错值）。
 */
function getDailyQuota() {
  const s = getSettings();
  const stats = getStats();
  const today = todayStr();
  const d = (stats.daily && stats.daily[today]) || {};
  const newUsed = Math.max(0, parseInt(d.newN, 10) || 0);
  const dueUsed = Math.max(0, parseInt(d.dueN, 10) || 0);
  return {
    date: today,
    newPerDay: s.newPerDay,
    reviewPerDay: s.reviewPerDay,
    newUsed: newUsed,
    dueUsed: dueUsed,
    newLeft: Math.max(0, s.newPerDay - newUsed),
    dueLeft: s.reviewPerDay > 0 ? Math.max(0, s.reviewPerDay - dueUsed) : Infinity
  };
}

/**
 * 记一次配额消耗（写入 daily[今日].newN / dueN）。
 * kind='new' 新卡首次引入；kind='due' 到期复习。
 * 同一张卡当天因「重来」被反复重做时只应在首次计入——由调用方判定。
 */
function bumpDailyCount(kind) {
  const stats = getStats();
  const today = todayStr();
  if (!stats.daily || typeof stats.daily !== 'object') stats.daily = {};
  const d = stats.daily[today] || { sec: 0, rated: 0, kept: 0 };
  if (kind === 'new') d.newN = (d.newN || 0) + 1;
  else d.dueN = (d.dueN || 0) + 1;
  stats.daily[today] = d;
  setStats(stats);
  return d;
}

/**
 * 今日任务概览——首页展示与队列构建的**唯一数据源**。
 * 两处各算一套会出现「首页显示还剩 12 张、点进去是 0 张」的漂移。
 * @param {string} [deckName] 限定题集；不传 = 全部题库
 */
function getTodayTask(deckName) {
  const cards = getCards();
  const now = Date.now();
  const quota = getDailyQuota();
  let dueAvail = 0;
  let newAvail = 0;
  cards.forEach(function (c) {
    if (deckName && (c.deck || DEFAULT_DECK_NAME) !== deckName) return;
    if (c.state === 'new') newAvail++;
    else if (c.nextReviewDate <= now) dueAvail++;
  });
  const due = quota.dueLeft === Infinity ? dueAvail : Math.min(quota.dueLeft, dueAvail);
  const nw = Math.min(quota.newLeft, newAvail);
  return {
    deck: deckName || '',
    due: due,             // 今天还能做的到期复习
    new: nw,              // 今天还能引入的新卡
    total: due + nw,
    dueAvail: dueAvail,   // 不受配额限制的到期总量
    newAvail: newAvail,
    quota: quota,
    done: (due + nw) === 0
  };
}

/**
 * 备考覆盖率：按考试日期反推所需每日新卡量。
 * 安全线 = 每日新卡 × 剩余天数 × 2/3（留 1/3 时间做巩固）。
 * 系数依据 scripts/sim_exam_capacity.cjs：首轮压线完成 = 零复习时间。
 */
function getExamPlan() {
  const s = getSettings();
  const days = daysToExam(s.examDate);
  if (days === null) return null;
  const cards = getCards();
  let newLeft = 0;
  cards.forEach(function (c) { if (c.state === 'new') newLeft++; });
  const usableDays = Math.max(1, Math.floor(days * 2 / 3));
  const needPerDay = newLeft > 0 ? Math.ceil(newLeft / usableDays) : 0;
  return {
    examDate: s.examDate,
    days: days,
    newLeft: newLeft,
    usableDays: usableDays,
    needPerDay: needPerDay,
    configured: s.newPerDay,
    // 已无新卡可学 → 视为达标（不再催促调高新卡上限）
    enough: newLeft === 0 || s.newPerDay >= needPerDay,
    firstRoundDays: s.newPerDay > 0 ? Math.ceil(newLeft / s.newPerDay) : 0
  };
}

/**
 * 按今日配额挑选本轮批次：**到期复习与新卡分成两个独立队列**，各吃各的额度。
 *
 * 为什么必须分池（这是本函数存在的唯一理由）：
 * 旧逻辑是 `queue = 到期 ∪ 新卡` 再 `slice(0, limit)`。刚学完的卡评「良好」后
 * 间隔 1 天、次日即到期，而它们排在数组前面 → 当天 30 个名额被到期卡全部占满，
 * 排在后面的新卡一张也进不来。实测 900 题每天 1 轮时首轮需 127 天（理论 30 天）。
 * 合成一个池「看起来」也能跑，代价是新卡渐进式饿死，且不会报错——只能靠断言守。
 *
 * 抽成纯函数而非写在页面里，是为了让 regress_daily_quota.cjs 能直接断言
 * 「新卡不被到期卡挤掉」，页面与回归共用同一份实现，不存第二套算法。
 *
 * @param {Array}  filtered 已按题集/阶段过滤的卡片（保持存储顺序）
 * @param {object} o { quota?, free?, limit?, now? }
 *        quota = 不传则实时读；free = 忽略配额（额外加练）；limit = 单批上限
 */
function pickQueue(filtered, o) {
  const opt = o || {};
  const now = opt.now || Date.now();
  const quota = opt.quota || getDailyQuota();
  const free = !!opt.free;
  const lim = opt.limit || 0;
  const list = Array.isArray(filtered) ? filtered : [];

  const dueQueue = list.filter(function (c) {
    return c.state !== 'new' && c.nextReviewDate <= now;
  });
  const newQueue = list.filter(function (c) { return c.state === 'new'; });

  // ⚠️ dueLeft 为 Infinity 表示「不限」，必须先判再 slice
  const duePicked = free
    ? dueQueue
    : (quota.dueLeft === Infinity ? dueQueue : dueQueue.slice(0, quota.dueLeft));
  const newPicked = free ? newQueue : newQueue.slice(0, quota.newLeft);

  // 两队列**交替合并**，而不是「到期在前、新卡在后」。
  // 理由：批次还要按单批大小截断。若到期排在前，到期洪峰期（到期量 > 单批大小）
  // 每一批都会被到期卡填满，新卡当天一张也学不到 —— 首轮进度就此停摆。
  // 交替后，新卡配额总能在当天用完（新卡是备考的硬进度，到期可以明天再做）。
  const activeAll = free
    ? (duePicked.length + newPicked.length > 0 ? duePicked.concat(newPicked) : list.slice())
    : interleave(duePicked, newPicked);

  const picked = (lim > 0 && activeAll.length > lim) ? activeAll.slice(0, lim) : activeAll;
  return {
    ids: picked.map(function (c) { return c.id; }),
    dueN: duePicked.length,
    newN: newPicked.length,
    dueAvail: dueQueue.length,
    newAvail: newQueue.length
  };
}

/** 交替合并两个数组（a0,b0,a1,b1,…），任一取空后追加剩余全部 */
function interleave(a, b) {
  const out = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length) out.push(a[i++]);
    if (j < b.length) out.push(b[j++]);
  }
  return out;
}

function toggleFavorite(id) {
  const stats = getStats();
  const idx = stats.favoriteCardIds.indexOf(id);
  if (idx >= 0) stats.favoriteCardIds.splice(idx, 1);
  else stats.favoriteCardIds.push(id);
  setStats(stats);
  return stats;
}

function recordWrong(id) {
  const stats = getStats();
  if (stats.wrongCardIds.indexOf(id) < 0) stats.wrongCardIds.push(id);
  setStats(stats);
  return stats;
}

function removeWrong(id) {
  const stats = getStats();
  stats.wrongCardIds = stats.wrongCardIds.filter(function (x) { return x !== id; });
  setStats(stats);
  return stats;
}

function clearWrong() {
  const stats = getStats();
  stats.wrongCardIds = [];
  setStats(stats);
  return stats;
}

/* ---------------- 设置 ---------------- */

/* 每轮学习数量规范化：正整数 1–999，非法值回退默认 30 */
function normStudyCount(v) {
  const n = parseInt(v, 10);
  if (!n || n < 1) return 30;
  return Math.min(n, 999);
}

/** 每日新卡上限规范化：正整数 1–200，非法值回退默认 20 */
function normNewPerDay(v) {
  const n = parseInt(v, 10);
  if (!n || n < 1) return 20;
  return Math.min(n, 200);
}

/** 每日复习上限规范化：0 = 不限（默认）；否则正整数 1–999 */
function normReviewPerDay(v) {
  const n = parseInt(v, 10);
  if (!n || n <= 0) return 0;
  return Math.min(n, 999);
}

/**
 * 考试日期规范化：只接受 'YYYY-MM-DD'，其余一律回退空串。
 * 不做「是否早于今天」的校验——过期日期由 daysToExam 返回 null 处理，
 * 这样用户改错日期时不会被静默清掉，能自己看见改回来。
 */
function normExamDate(v) {
  const s = String(v === undefined || v === null ? '' : v).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  const t = Date.parse(s + 'T00:00:00');
  if (isNaN(t)) return '';
  // 反向校验：不合法日期（如 2026-02-31）会被 Date.parse 顺延，用回写比对剔除
  const d = new Date(t);
  const echo = d.getFullYear() + '-'
    + String(d.getMonth() + 1).padStart(2, '0') + '-'
    + String(d.getDate()).padStart(2, '0');
  return echo === s ? s : '';
}

/** 目标保留率夹在 (0.70, 1.00) 开区间内；非法值回落 0.95 */
function normRetention(v) {
  const n = Number(v);
  return n > 0.7 && n < 1 ? n : 0.95;
}

/** 间隔上限：至少 1 天，至多 100 年（ts-fsrs 的 maximum_interval 口径） */
/**
 * 间隔上限规范化：正整数 1–36500，非法值回退默认 90。
 * 注意：这里允许到 36500，而 SM-2 自己的硬天花板是 365 天——
 * 超出的部分由 `sm2.resolveMaxDays` 收紧，两处不重复夹取（口径统一在 sm2.js）。
 * 非法值回退 90 而非 365：老设置里没有这个字段时，希望拿到的是当前推荐默认值。
 */
function normMaxInterval(v) {
  const n = parseInt(v, 10);
  if (!n || n < 1) return 90;
  return Math.min(n, 36500);
}

function getSettings() {
  let s = null;
  try {
    const saved = wx.getStorageSync(KEY_SETTINGS);
    if (saved && typeof saved === 'object') s = saved;
  } catch (e) {}
  if (!s) s = defaultSettings();
  return {
    // dark 未显式选择过（旧版默认 false 无手动记录）→ 跟随新版默认暗黑；显式关过则尊重用户选择
    dark: s.dark === undefined ? true : !!s.dark,
    haptic: s.haptic === undefined ? true : !!s.haptic,
    studyCount: normStudyCount(s.studyCount),
    newPerDay: normNewPerDay(s.newPerDay),
    reviewPerDay: normReviewPerDay(s.reviewPerDay),
    examDate: normExamDate(s.examDate),
    requestRetention: normRetention(s.requestRetention),
    maxIntervalDays: normMaxInterval(s.maxIntervalDays)
  };
}

function setSettings(patch) {
  const s = Object.assign(getSettings(), patch || {});
  if (patch && patch.studyCount !== undefined) s.studyCount = normStudyCount(patch.studyCount);
  if (patch && patch.newPerDay !== undefined) s.newPerDay = normNewPerDay(patch.newPerDay);
  if (patch && patch.reviewPerDay !== undefined) s.reviewPerDay = normReviewPerDay(patch.reviewPerDay);
  if (patch && patch.examDate !== undefined) s.examDate = normExamDate(patch.examDate);
  if (patch && patch.requestRetention !== undefined) s.requestRetention = normRetention(patch.requestRetention);
  if (patch && patch.maxIntervalDays !== undefined) s.maxIntervalDays = normMaxInterval(patch.maxIntervalDays);
  try {
    wx.setStorageSync(KEY_SETTINGS, s);
  } catch (e) {}
  applyNavBar(s.dark);
  return s;
}

function applyNavBar(dark) {
  try {
    wx.setNavigationBarColor({
      frontColor: '#ffffff',
      backgroundColor: dark ? '#0B132B' : '#051C2C'
    });
    wx.setBackgroundColor({ backgroundColor: dark ? '#0B132B' : '#F4F6F9' });
    wx.setTabBarStyle({
      color: dark ? '#64748B' : '#8A94A6',
      selectedColor: dark ? '#38BDF8' : '#00629B',
      backgroundColor: dark ? '#0F1D40' : '#FFFFFF',
      borderStyle: dark ? 'black' : 'white'
    });
  } catch (e) {}
}

function haptic() {
  const s = getSettings();
  if (!s.haptic) return;
  try {
    wx.vibrateShort({ type: 'light' });
  } catch (e) {}
}

/* ---------------- 全量导出 / 导入（云同步与本地备份共用） ---------------- */

function safeGet(key, fallback) {
  try {
    const v = wx.getStorageSync(key);
    return v === '' || v === undefined || v === null ? fallback : v;
  } catch (e) {
    return fallback;
  }
}

function safeSet(key, val) {
  try {
    wx.setStorageSync(key, val);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * 导出全部用户数据为可序列化对象。
 * 卡片含全部 SM-2 学习进度；不含题库代码本身（题库随代码包内置，不参与同步）。
 */
function exportAll() {
  return {
    v: 1,
    exportedAt: Date.now(),
    cards: getCards(),
    stats: getStats(),
    settings: getSettings(),
    sessions: safeGet(KEY_SESSIONS, {}),
    flipHintShown: safeGet(KEY_FLIP_HINT, 0)
  };
}

/**
 * 全量覆盖导入（用于「下载云端进度」或恢复备份）。
 * 逐项写回，任何单项失败不影响其余项。
 */
function importAll(data) {
  if (!data || typeof data !== 'object') return { ok: false, reason: 'bad-data' };
  // 前向兼容守卫：本版只认识 v1。若备份来自更新的版本（v2+），
  // 宁可整包拒绝，也不要半量写入——半量写入会把新字段静默丢掉，
  // 用户看到的是"恢复成功"，实际丢了学习历史。
  const v = Number(data.v);
  if (v && v > SUPPORTED_SCHEMA_VERSION) {
    return { ok: false, reason: 'version-too-new', version: v, supported: SUPPORTED_SCHEMA_VERSION };
  }
  const r = { ok: true, written: [], failed: [] };
  if (Array.isArray(data.cards)) {
    // 走分片写入：单键直写会在大题库时抛错（>1MB），而恢复备份必须如实报错，
    // 否则用户看到的是「恢复成功」、实际卡片全丢。
    // 其余项仍按原契约继续写（任何单项失败不影响其余项）。
    const w = writeCards(data.cards);
    if (w.ok) r.written.push('cards');
    else { r.ok = false; r.failed.push('cards'); r.cardWrite = w; }
  }
  if (data.stats && typeof data.stats === 'object') {
    if (safeSet(KEY_STATS, data.stats)) r.written.push('stats');
  }
  if (data.settings && typeof data.settings === 'object') {
    const merged = Object.assign(defaultSettings(), data.settings);
    if (safeSet(KEY_SETTINGS, merged)) r.written.push('settings');
  }
  if (data.sessions && typeof data.sessions === 'object') {
    if (safeSet(KEY_SESSIONS, data.sessions)) r.written.push('sessions');
  }
  if (data.flipHintShown !== undefined) {
    if (safeSet(KEY_FLIP_HINT, data.flipHintShown ? 1 : 0)) r.written.push('flipHintShown');
  }
  return r;
}

module.exports = {
  todayStr: todayStr,
  KEY_SESSIONS: KEY_SESSIONS,
  KEY_FLIP_HINT: KEY_FLIP_HINT,
  // —— 卡片分片存储（2026-09-10 新增）——
  // 回归/真机脚本用这几个常量与纯函数自行推算待写入的分片，
  // 不再硬编码键名，避免实现改名后脚本静默失效。
  KEY_CARDS_LEGACY: cardShards.LEGACY_KEY,
  KEY_CARDS_META: cardShards.META_KEY,
  KEY_CARDS_SHARD_PREFIX: cardShards.SHARD_KEY_PREFIX,
  CARD_SHARDS: cardShards,
  readCardsRaw: readCardsRaw,
  verifyCardStorage: verifyCardStorage,
  getLastCardWrite: function () { return _lastCardWrite; },
  getLastImportReport: function () { return _lastImportReport; },
  getCards: getCards,
  setCards: setCards,
  clearAllCards: clearAllCards,
  updateCard: updateCard,
  importCards: importCards,
  scanDuplicates: scanDuplicates,
  renameDeck: renameDeck,
  resetCards: resetCards,
  getStats: getStats,
  setStats: setStats,
  incrementReviewed: incrementReviewed,
  recordStudy: recordStudy,
  toggleFavorite: toggleFavorite,
  recordWrong: recordWrong,
  removeWrong: removeWrong,
  clearWrong: clearWrong,
  getSettings: getSettings,
  setSettings: setSettings,
  // 每日配额 / 备考覆盖率（2026-09-10 新增）
  DEFAULT_DECK_NAME: DEFAULT_DECK_NAME,
  daysToExam: daysToExam,
  getDailyQuota: getDailyQuota,
  bumpDailyCount: bumpDailyCount,
  getTodayTask: getTodayTask,
  getExamPlan: getExamPlan,
  pickQueue: pickQueue,
  applyNavBar: applyNavBar,
  haptic: haptic,
  exportAll: exportAll,
  importAll: importAll
};
