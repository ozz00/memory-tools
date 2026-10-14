/**
 * 卡片分片存储规划（纯函数，无 wx 依赖）
 *
 * ── 为什么要分片 ──────────────────────────────────────────────────────────
 * 微信对**单个 storage key 设 1MB 上限**（所有 key 合计 10MB），超出时
 * `wx.setStorageSync` 抛错。本项目原先把全部卡片放在一个 key 里，实测单卡均值
 * 1.66KB ⇒ 2316 张 = 3842KB，真机写入必然失败；而旧代码把异常吞掉了，
 * 用户看到的现象是「复习进度不保存」——本地开发者工具不强制该上限，
 * 所以本地测不出来，只有真机才暴露。
 *
 * ── 本模块的边界 ────────────────────────────────────────────────────────
 * 只做「按字节把卡片序列切成若干片」的纯计算，读写 I/O 全部留在 store.js：
 *   - 纯函数 ⇒ Node 回归脚本可以直接 require 同一份实现，真机脚本也用同一套
 *     切分规则算出待写入的分片，测试与实现不会各写一份而漂移。
 *   - 切片依据是**字节预算**而不是「每 N 张」：卡片体积差异很大（带完整解析
 *     HTML 的卡可达数 KB），固定张数会让某一片悄悄顶到 1MB 上限。
 *
 * ── 键名布局 ────────────────────────────────────────────────────────────
 *   caq_6sigma_flashcards_v1      旧版单键（v2 迁移的来源，迁移成功后删除）
 *   caq_6sigma_cards_meta_v2      分片元数据，也是**提交点**（写完全部片才写它）
 *   caq_6sigma_cards_v2_0 … _N    分片本体，拼接顺序即数组顺序
 */

const LEGACY_KEY = 'caq_6sigma_flashcards_v1';
const META_KEY = 'caq_6sigma_cards_meta_v2';
const SHARD_KEY_PREFIX = 'caq_6sigma_cards_v2_';

// 分片元数据结构版本。与 exportAll 的备份版本号（v:1）是两件事，不要混用。
const SCHEMA_VERSION = 2;

/**
 * 目标每片卡数 —— **决定片边界**。
 *
 * 为什么用「固定张数」切而不是「按字节塞满」：真机实测（verify_card_shards_live.cjs）
 * 发现塞满式的贪心切片会让每片都顶到预算上限，改一张卡就会把后续所有边界挤走一位，
 * 导致**一次答题重写全部 11 片**——优化完全失效。真机日志：
 *   FAIL 一次答题只重写少数分片 [11 / 11 片被重写]
 * 改成按下标锚定后，改第 k 张卡只影响它所在的那一片，边界纹丝不动。
 *
 * 取 200 的依据：实测单卡均值 1.66KB ⇒ 单片约 332KB，配合下面的字节预算留足余量，
 * 且一次复习只重写约 330KB（改造前是全库 3.8MB，约 11 倍改善）。
 */
const SHARD_TARGET_CARDS = 200;

/**
 * 单片字节**硬预算**：真上限是 1MB，这里取 700KB。
 *
 * 正常情况下 200 张卡远达不到这个值（均值 1.66KB 时约 332KB），它只在卡片体积
 * 异常大时兜底：某一组超过预算就把**这一组**二分，而不是让某片悄悄顶到 1MB 上限。
 * 注意二分只影响该组及其后的片号，不会波及前面的片。
 */
const SHARD_BUDGET_BYTES = 700 * 1024;

/**
 * 全部卡片的总预算。微信总上限 10MB，留 3MB 给统计/设置/会话等其余 key。
 * 超过即拒绝写入并如实上报，而不是让某一篇静默丢掉。
 */
const MAX_TOTAL_BYTES = 7 * 1024 * 1024;

/** 分片键名。i 为 0 起的分片序号。 */
function shardKey(i) {
  return SHARD_KEY_PREFIX + i;
}

/**
 * 字符串的 UTF-8 字节数。
 *
 * 为什么不用 `str.length`：微信的上限按字节算，而 JSON.stringify 不会转义中文
 * ⇒ 一个汉字在 JS 里是 1 个 length、实际占 3 字节。用 length 会低估 3 倍，
 * 正是「以为没超、其实超了」的典型来源。
 */
function byteLen(s) {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++; } // 代理对（emoji 等）
    else n += 3;
  }
  return n;
}

/** 单张卡片的近似字节数（含其后的一个逗号）。 */
function cardBytes(card) {
  let s;
  try {
    s = JSON.stringify(card);
  } catch (e) {
    s = '{}';
  }
  return byteLen(s === undefined ? '{}' : s) + 1;
}

/** 一组卡片的近似字节数（含 JSON 数组括号）。 */
function groupBytes(group) {
  let s;
  try {
    s = JSON.stringify(group);
  } catch (e) {
    s = '[]';
  }
  return byteLen(s === undefined ? '[]' : s);
}

/**
 * 超预算的组就地二分。仅该组受影响，前面的片边界与片号都不动。
 * 单张卡本身就超预算时不再分（group.length === 1），由 oversize 标记暴露出来。
 */
function pushWithSplit(group, shards, bytes, out) {
  if (!group.length) return;
  const b = groupBytes(group);
  if (b <= SHARD_BUDGET_BYTES || group.length === 1) {
    shards.push(group);
    bytes.push(b);
    if (b > 1024 * 1024) out.push(shards.length - 1);
    return;
  }
  const mid = Math.ceil(group.length / 2);
  pushWithSplit(group.slice(0, mid), shards, bytes, out);
  pushWithSplit(group.slice(mid), shards, bytes, out);
}

/**
 * 把卡片切成若干片。
 *
 * 两步走（顺序不可颠倒）：
 *   ① 按 SHARD_TARGET_CARDS **按下标**切组 —— 边界只取决于下标，
 *      所以单卡内容变化不会引起边界级联位移（这是「只重写 1 片」的前提）。
 *   ② 对超预算的组就地二分 —— 只兜异常大体积的卡，不影响其余组。
 *
 * 返回：
 *   { shards: [[card,...], ...],  // 顺序即原始数组顺序，拼接即可还原
 *     bytes:  [n, ...],          // 每片近似字节数
 *     ser:    [str, ...],        // 每片的 JSON 串，供写入侧复用（省一次全量 stringify）
 *     totalBytes: n,             // 全量近似字节数
 *     oversize: [i, ...] }       // 单片超 1MB 的序号（单卡本身就超大时会出现）
 */
function plan(cards) {
  const list = Array.isArray(cards) ? cards : [];
  const shards = [];
  const bytes = [];
  const oversize = [];

  for (let i = 0; i < list.length; i += SHARD_TARGET_CARDS) {
    pushWithSplit(list.slice(i, i + SHARD_TARGET_CARDS), shards, bytes, oversize);
  }

  const ser = [];
  for (let i = 0; i < shards.length; i++) {
    try {
      ser.push(JSON.stringify(shards[i]));
    } catch (e) {
      ser.push('[]');
    }
  }

  let totalBytes = 2;
  for (let i = 0; i < bytes.length; i++) totalBytes += bytes[i];
  if (shards.length > 1) totalBytes += shards.length - 1; // 片间逗号

  return { shards: shards, bytes: bytes, ser: ser, totalBytes: totalBytes, oversize: oversize };
}

/** 元数据对象（写 meta 时用，保持体积恒定）。 */
function metaOf(planResult, shardCountOverride) {
  const count = shardCountOverride === undefined ? planResult.shards.length : shardCountOverride;
  let total = 0;
  for (let i = 0; i < planResult.shards.length; i++) total += planResult.shards[i].length;
  return { v: SCHEMA_VERSION, count: count, total: total, at: Date.now() };
}

/** 在给定分片数与总量下，1MB 单片上限对应的理论最大容量（供 UI/文档展示）。 */
function capacityHint() {
  return {
    perShardCards: SHARD_TARGET_CARDS,
    budgetKB: Math.round(SHARD_BUDGET_BYTES / 1024),
    maxTotalMB: Math.round(MAX_TOTAL_BYTES / 1024 / 1024)
  };
}

module.exports = {
  LEGACY_KEY: LEGACY_KEY,
  META_KEY: META_KEY,
  SHARD_KEY_PREFIX: SHARD_KEY_PREFIX,
  SCHEMA_VERSION: SCHEMA_VERSION,
  SHARD_TARGET_CARDS: SHARD_TARGET_CARDS,
  SHARD_BUDGET_BYTES: SHARD_BUDGET_BYTES,
  MAX_TOTAL_BYTES: MAX_TOTAL_BYTES,
  shardKey: shardKey,
  byteLen: byteLen,
  cardBytes: cardBytes,
  plan: plan,
  metaOf: metaOf,
  capacityHint: capacityHint
};
