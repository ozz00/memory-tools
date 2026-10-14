/**
 * 端到端（miniprogram-automator）脚本的存储访问层。
 *
 * 为什么需要：卡片改成分片存储后，不再写在单一 key `caq_6sigma_flashcards_v1` 上。
 * 老脚本用 `wx.getStorageSync(旧键)` 读卡片会**静默拿到空**（真机上是 ''），
 * 断言会以「卡片为 0 张」的形式失败 —— 或被误判成业务 bug。
 *
 * 这里统一提供按存储语义读写卡片的工具：
 *   - 读取沿真实优先级：分片优先 → 旧版单键兜底
 *   - 写入可按分片布局落盘（分片规划用项目内同一份 cardShards.js，避免抄第二份实现）
 *   - verify() 直接回报分片数、单片字节数、缺片情况，供「单片不超 1MB」这类断言
 *
 * 用法：
 *   const { makeCardIO } = require('./_liveenv.cjs');
 *   const io = makeCardIO(mp);
 *   const cards = await io.readCards();
 *   await io.writeCards(cards);
 *   const v = await io.verify();
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

/**
 * 加载项目内的 cardShards.js。
 * 根 package.json 是 type:module，Node 直接 require 项目内 .js 会按 ESM 解析而失败，
 * 所以复制成 .cjs 再加载（与 scripts/_testenv.cjs 同一套办法）。
 */
function loadCardShards() {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'caq_live_'));
  const P = path.join(T, 'cardShards.cjs');
  fs.copyFileSync(path.join(ROOT, 'miniprogram/utils/cardShards.js'), P);
  return require(P);
}

function makeCardIO(mp) {
  const S = loadCardShards();

  /** 读取卡片：分片优先，旧版单键兜底。返回 [] 表示存储里确实没有卡片。 */
  const readCards = () => mp.evaluate(
    (metaKey, prefix, legacyKey, schema) => {
      const m = wx.getStorageSync(metaKey);
      if (m && Number(m.v) === schema) {
        const out = [];
        let ok = true;
        for (let i = 0; i < Number(m.count); i++) {
          const part = wx.getStorageSync(prefix + i);
          if (!Array.isArray(part)) { ok = false; break; }
          for (let j = 0; j < part.length; j++) out.push(part[j]);
        }
        if (ok) return out;
      }
      const L = wx.getStorageSync(legacyKey);
      return Array.isArray(L) ? L : [];
    },
    S.META_KEY, S.SHARD_KEY_PREFIX, S.LEGACY_KEY, S.SCHEMA_VERSION
  );

  /**
   * 按分片布局写入卡片（Node 侧算好切片再落盘）。
   * 逐片发一次 evaluate：一次把 3.8MB 塞进单个调用会顶到 WS 消息上限，
   * 分片发送既避开这个限制，也正好复现 App 内部「一片一个 key」的写法。
   * 最后写 meta 才算提交（与 store.writeCards 的提交语义一致），并顺手清理多余片与旧键。
   */
  const writeCards = async (cards) => {
    const p = S.plan(cards);
    const meta = S.metaOf(p);
    for (let i = 0; i < p.shards.length; i++) {
      await mp.evaluate(
        (key, val) => { wx.setStorageSync(key, val); return true; },
        S.SHARD_KEY_PREFIX + i, p.shards[i]
      );
    }
    await mp.evaluate(
      (metaKey, prefix, legacyKey, m, shardCount) => {
        let keys = [];
        try { keys = (wx.getStorageInfoSync() || {}).keys || []; } catch (e) {}
        for (let i = 0; i < keys.length; i++) {
          const k = String(keys[i]);
          if (k.indexOf(prefix) !== 0) continue;
          const idx = Number(k.slice(prefix.length));
          if (isFinite(idx) && idx >= shardCount) wx.removeStorageSync(k);
        }
        wx.setStorageSync(metaKey, m);
        try { wx.removeStorageSync(legacyKey); } catch (e) {}
        return true;
      },
      S.META_KEY, S.SHARD_KEY_PREFIX, S.LEGACY_KEY, meta, p.shards.length
    );
    return cards;
  };

  /** 就地替换一张卡（保持顺序与分片布局） */
  const replaceCard = (card) => readCards().then((cards) => {
    const next = cards.map((c) => (c && c.id === card.id ? card : c));
    return writeCards(next).then(() => next);
  });

  /**
   * 分片现状诊断：片数、每片字节数/卡数、缺片、是否残留旧键。
   * 字节数在运行时内用 UTF-8 语义计算（中文 3 字节），与微信的上限口径一致。
   */
  const verify = () => mp.evaluate(
    (metaKey, prefix, legacyKey, schema) => {
      const m = wx.getStorageSync(metaKey);
      if (!m || Number(m.v) !== schema) {
        const L = wx.getStorageSync(legacyKey);
        return {
          ok: false, reason: 'not-migrated', schema: m ? Number(m.v) : 0,
          legacyCards: Array.isArray(L) ? L.length : 0
        };
      }
      const byteLen = (s) => {
        let n = 0;
        for (let i = 0; i < s.length; i++) {
          const c = s.charCodeAt(i);
          if (c < 0x80) n += 1;
          else if (c < 0x800) n += 2;
          else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++; }
          else n += 3;
        }
        return n;
      };
      const count = Number(m.count);
      let cards = 0;
      let totalBytes = 0;
      let maxBytes = 0;
      let maxCards = 0;
      const missing = [];
      const perShard = [];
      for (let i = 0; i < count; i++) {
        const part = wx.getStorageSync(prefix + i);
        if (!Array.isArray(part)) { missing.push(i); continue; }
        const b = byteLen(JSON.stringify(part));
        cards += part.length;
        totalBytes += b;
        if (b > maxBytes) maxBytes = b;
        if (part.length > maxCards) maxCards = part.length;
        perShard.push({ index: i, cards: part.length, bytes: b });
      }
      let storageInfo = {};
      try {
        const si = wx.getStorageInfoSync() || {};
        storageInfo = { currentSizeKB: si.currentSize, limitSizeKB: si.limitSize, keys: (si.keys || []).length };
      } catch (e) {}
      let legacyPresent = false;
      try { legacyPresent = wx.getStorageSync(legacyKey) !== ''; } catch (e) {}
      return {
        ok: !missing.length && cards === Number(m.total),
        reason: missing.length ? 'shard-missing' : (cards === Number(m.total) ? '' : 'count-mismatch'),
        schema: Number(m.v),
        count: count,
        cards: cards,
        expected: Number(m.total),
        missing: missing,
        totalBytes: totalBytes,
        maxShardBytes: maxBytes,
        maxShardCards: maxCards,
        perShard: perShard,
        legacyPresent: legacyPresent,
        storageInfo: storageInfo
      };
    },
    S.META_KEY, S.SHARD_KEY_PREFIX, S.LEGACY_KEY, S.SCHEMA_VERSION
  );

  return {
    S,
    readCards,
    writeCards,
    replaceCard,
    verify,
    // 便于脚本直接引用键名做原始操作
    META_KEY: S.META_KEY,
    SHARD_KEY_PREFIX: S.SHARD_KEY_PREFIX,
    LEGACY_KEY: S.LEGACY_KEY
  };
}

module.exports = { loadCardShards, makeCardIO };
