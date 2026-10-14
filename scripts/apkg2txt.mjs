#!/usr/bin/env node
/**
 * apkg2txt — 将 Anki .apkg 卡组解包并转换为「Anki TXT」导入格式
 *
 * 背景：.apkg = zip 压缩包内嵌 SQLite 数据库（collection.anki2/.anki21）。
 * 微信小程序沙箱无法运行 sql.js/WASM，故提供本脚本在电脑端完成解包，
 * 输出与 Anki「导出 → 笔记纯文本」一致的 Tab 分隔文本，供小程序控制台导入。
 *
 * 用法：
 *   node scripts/apkg2txt.mjs <卡组.apkg> [-o 输出.txt]
 *
 * 输出（每行一张卡，Tab 分隔，与 src/utils/ankiParser.ts 语义一致）：
 *   正面	背面	标签1 标签2
 *
 * 依赖：项目根目录 node_modules 中的 jszip 与 sql.js（Web 版已有）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import initSqlJs from 'sql.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* ---------- HTML 清洗（与 miniprogram/utils/importer.js 保持同语义） ---------- */

function cleanHtml(raw) {
  if (!raw) return '';
  return String(raw)
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<img[^>]*>/gi, '')
    .replace(/\[sound:[^\]]*\]/gi, '')
    .replace(/\{\{c\d+::(.*?)(?:::.*?)?\}\}/g, '<span style="background:#fef3c7;color:#78350f;padding:0 6rpx;border-radius:6rpx;">$1</span>')
    .replace(/&nbsp;/g, ' ')
    .replace(/<br\s*\/?>\s*<br\s*\/?>/gi, '<br/>')
    .trim();
}

/* ---------- .apkg 解包 + SQLite 读取 ---------- */

/** 从 .apkg（ArrayBuffer）解析出 [{ front, back, tags }] */
export async function parseApkg(buffer) {
  const zip = await JSZip.loadAsync(buffer);

  // 1) 定位 Anki 集合数据库（新版 .anki21 / 旧版 .anki2）
  let dbFile = zip.file('collection.anki21') || zip.file('collection.anki2');
  if (!dbFile) {
    const candidates = Object.keys(zip.files).filter((f) => /\.anki2(?:1)?$/.test(f));
    if (candidates.length) dbFile = zip.file(candidates[0]);
  }
  if (!dbFile) {
    // 2) 兼容把纯文本 zip 伪装成 .apkg 的情形
    const txt = Object.values(zip.files).find((f) => /\.(txt|tsv|csv)$/i.test(f.name));
    if (txt) return parseTsv(await txt.async('string'));
    throw new Error('未找到 Anki 核心数据库 collection.anki2/.anki21，且压缩包内无文本卡组');
  }

  const SQL = await initSqlJs({
    locateFile: (file) => path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', file)
  });
  const db = new SQL.Database(new Uint8Array(await dbFile.async('arraybuffer')));
  const res = db.exec('SELECT tags, flds FROM notes');
  db.close();

  const rows = res && res[0] && res[0].values;
  if (!rows || !rows.length) throw new Error('数据库内 notes 表为空，无卡片可导出');

  // Anki note 字段以 ASCII 0x1F 分隔，第 1 字段通常为正面
  return rows.map((row, i) => {
    const tags = String(row[0] || '').trim().split(/\s+/).filter(Boolean);
    const fields = String(row[1] || '').split('\x1f').map((s) => s.trim());
    const front = cleanHtml(fields[0] || '');
    const back = cleanHtml(fields[1] || fields[2] || '');
    return { index: i, front, back, tags };
  }).filter((c) => c.front || c.back);
}

/** 容错：zip 内为纯文本（非 sqlite）时按 Tab/CSV 解析 */
function parseTsv(text) {
  return String(text)
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, i) => {
      const f = line.split('\t');
      if (f.length === 1) return { index: i, front: '', back: '', tags: [] }; // 交给上层过滤
      const tags = f.length > 2 ? String(f[f.length - 1]).trim().split(/\s+/).filter(Boolean) : [];
      return { index: i, front: cleanHtml(f[0]), back: cleanHtml(f[1]), tags };
    })
    .filter((c) => c.front || c.back);
}

/* ---------- CLI ---------- */

function usage() {
  console.log('用法: node scripts/apkg2txt.mjs <卡组.apkg> [-o 输出.txt]');
  process.exit(1);
}

function main() {
  const args = process.argv.slice(2);
  const inIdx = args.findIndex((a) => !a.startsWith('-'));
  const inFile = inIdx >= 0 ? args[inIdx] : null;
  let outFile = null;
  const oIdx = args.indexOf('-o');
  if (oIdx >= 0 && args[oIdx + 1]) outFile = args[oIdx + 1];
  if (!inFile) usage();

  const absIn = path.resolve(inFile);
  if (!fs.existsSync(absIn)) {
    console.error('文件不存在: ' + absIn);
    process.exit(1);
  }
  if (!outFile) outFile = absIn.replace(/\.apkg$/i, '') + '.txt';
  const absOut = path.resolve(outFile);

  parseApkg(fs.readFileSync(absIn))
    .then((cards) => {
      if (!cards.length) {
        console.error('未解析出任何卡片。');
        process.exit(1);
      }
      const lines = cards.map((c) => {
        const row = [c.front, c.back];
        if (c.tags.length) row.push(c.tags.join(' '));
        return row.join('\t');
      });
      fs.writeFileSync(absOut, '\uFEFF' + lines.join('\n'), 'utf8');
      console.log('✅ 成功解析 ' + cards.length + ' 张卡片');
      console.log('📄 输出: ' + absOut);
      console.log('➡️  把该 .txt 发到微信「文件传输助手」，在控制台「Anki TXT」标签导入。');
    })
    .catch((err) => {
      console.error('❌ 解析失败: ' + (err && err.message ? err.message : err));
      process.exit(1);
    });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
