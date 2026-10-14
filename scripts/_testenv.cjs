/**
 * 测试环境准备：把项目内的 .js 复制到临时目录改 .cjs 再加载。
 *
 * 为什么需要：根 package.json 为 type:module，Node 下直接 require 项目内 .js
 * 会被当作 ESM 解析而失败；小程序侧无此问题。
 *
 * 用法：
 *   const env = require('./_testenv.cjs').resolve();
 *   const importer = require(env.IMP);
 *   const store = require(env.STO);
 *
 * 调度链路（scheduler / sm2 / fsrs）用 prepare()：
 *   const env = require('./_testenv.cjs').prepare();
 *   const scheduler = require(env.SCH);
 *
 * 若已设置 IMP_PATH / STO_PATH 环境变量则优先用之（兼容旧调用方式）——
 * 该快捷路径不含调度链路产物，需要 scheduler 的脚本请直接用 prepare()。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const abs = (p) => p.replace(/\\/g, '/');

function prepare() {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'caq_env_'));
  const IMP = path.join(T, 'importer.cjs');
  const DC = path.join(T, 'defaultCards.cjs');
  const SC = path.join(T, 'sampleCards.cjs');
  const BL = path.join(T, 'builtinLocal.cjs');
  const STO = path.join(T, 'store.cjs');
  const CS = path.join(T, 'cardShards.cjs');
  const SM2 = path.join(T, 'sm2.cjs');
  const FSR = path.join(T, 'fsrs.cjs');
  const SCH = path.join(T, 'scheduler.cjs');

  fs.copyFileSync(path.join(ROOT, 'miniprogram/utils/importer.js'), IMP);
  fs.copyFileSync(path.join(ROOT, 'miniprogram/data/sampleCards.js'), SC);
  fs.copyFileSync(path.join(ROOT, 'miniprogram/data/builtinLocal.js'), BL);
  // 卡片分片规划（纯函数，无相对 require）——store 依赖它，必须一并复制
  fs.copyFileSync(path.join(ROOT, 'miniprogram/utils/cardShards.js'), CS);

  // defaultCards 内部相对 require → 指向临时副本
  fs.writeFileSync(
    DC,
    fs.readFileSync(path.join(ROOT, 'miniprogram/data/defaultCards.js'), 'utf8')
      .replace(/require\('\.\/builtinLocal\.js'\)/, "require('" + abs(BL) + "')")
      .replace(/require\('\.\/sampleCards\.js'\)/, "require('" + abs(SC) + "')"),
    'utf8'
  );

  // store 内部相对 require → 指向临时副本
  fs.writeFileSync(
    STO,
    fs.readFileSync(path.join(ROOT, 'miniprogram/utils/store.js'), 'utf8')
      .replace(/require\('\.\/importer\.js'\)/, "require('" + abs(IMP) + "')")
      .replace(/require\('\.\/cardShards\.js'\)/, "require('" + abs(CS) + "')")
      .replace(/require\('\.\.\/data\/defaultCards\.js'\)/, "require('" + abs(DC) + "')"),
    'utf8'
  );

  // 调度链路：sm2 / fsrs 无相对 require，直接复制；scheduler 的三处相对 require 改绝对路径
  fs.copyFileSync(path.join(ROOT, 'miniprogram/utils/sm2.js'), SM2);
  fs.copyFileSync(path.join(ROOT, 'miniprogram/utils/fsrs.js'), FSR);
  fs.writeFileSync(
    SCH,
    fs.readFileSync(path.join(ROOT, 'miniprogram/utils/scheduler.js'), 'utf8')
      .replace(/require\('\.\/sm2\.js'\)/g, "require('" + abs(SM2) + "')")
      .replace(/require\('\.\/fsrs\.js'\)/g, "require('" + abs(FSR) + "')")
      .replace(/require\('\.\/store\.js'\)/g, "require('" + abs(STO) + "')"),
    'utf8'
  );

  return { T, IMP, DC, SC, BL, STO, CS, SM2, FSR, SCH };
}

function resolve() {
  if (process.env.IMP_PATH && process.env.STO_PATH) {
    return { T: null, IMP: process.env.IMP_PATH, STO: process.env.STO_PATH };
  }
  if (process.env.IMP_PATH) {
    return { T: null, IMP: process.env.IMP_PATH, STO: null };
  }
  return prepare();
}

/**
 * 内存版 wx storage mock。
 *
 * 为什么要这个：卡片改为**分片存储**后不再写在单一 key `caq_6sigma_flashcards_v1` 上，
 * 老测试若还盯着那个 key 断言「已回写存储」，会永远读到空 —— 明明是绿的假象。
 * 这里统一从**存储语义**取回卡片（分片优先、旧键兜底），断言就不再依赖具体键名。
 *
 * @param {object} store 已 require 的 store 模块（借它拿键名前缀，避免测试里再抄一份）
 * @param {object} seed  预置存储内容，如 { 'caq_6sigma_flashcards_v1': [card] }
 */
function memWx(store, seed, opts) {
  const mem = Object.assign({}, seed || {});
  const S = store.CARD_SHARDS;
  // strict：存取都过一遍 JSON 序列化，模拟真实存储的「值语义」。
  // 不加这一层，mock 里存的是对象引用，写入方之后任何就地修改都会「透过存储」生效，
  // 反而掩盖 bug（真实 API 绝不会这样）。
  const strict = !!(opts && opts.strict);
  const clone = function (v) {
    if (v === undefined) return v;
    try { return JSON.parse(JSON.stringify(v)); } catch (e) { return v; }
  };
  const api = {
    mem: mem,
    // 语义化读取：分片优先，回退旧键
    readCards: function () {
      const meta = mem[S.META_KEY];
      if (meta && Number(meta.v) === S.SCHEMA_VERSION) {
        const out = [];
        for (let i = 0; i < Number(meta.count); i++) {
          const part = mem[S.shardKey(i)];
          if (!Array.isArray(part)) return null;
          for (let j = 0; j < part.length; j++) out.push(part[j]);
        }
        return out;
      }
      const legacy = mem[S.LEGACY_KEY];
      return Array.isArray(legacy) ? legacy : null;
    },
    // 各分片的字节数与卡数，用于「单片不超预算」类断言
    shardInfo: function () {
      const meta = mem[S.META_KEY];
      const out = [];
      if (!meta) return out;
      for (let i = 0; i < Number(meta.count); i++) {
        const part = mem[S.shardKey(i)] || [];
        out.push({ index: i, cards: part.length, bytes: S.byteLen(JSON.stringify(part)) });
      }
      return out;
    },
    hasLegacyKey: function () { return mem[S.LEGACY_KEY] !== undefined; },
    getStorageSync: function (k) {
      const v = mem[k];
      return v === undefined ? '' : (strict ? clone(v) : v);
    },
    setStorageSync: function (k, v) { mem[k] = strict ? clone(v) : v; },
    removeStorageSync: function (k) { delete mem[k]; },
    // 显式不提供 getStorageInfoSync：让 store 走「按上一轮片数推导上界」的兜底分支
    // （真机上该 API 存在，两条分支都要有回归覆盖，见 regress_card_shards.cjs）
  };
  return api;
}

module.exports = { prepare, resolve, memWx };
