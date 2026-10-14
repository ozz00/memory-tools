/* 真机文案合规检查（2026-09-12）
 *
 * 背景：提审前把**用户可见文案**里的「题库 / 刷题 / 题集 / 道题」统一弱化为
 *       「牌组 / 复习 / 张」，避开审核端对「提供题库内容」的联想，
 *       与个人主体的「工具 → 实用工具 → 备忘录」类目保持一致。
 *
 * 本脚本在真机上逐页抓渲染结果，做**双向**断言：
 *   A. 反向：不得再出现红线词（防漏改）
 *   B. 正向：新文案确实生效（防「改了源码但渲染没变」——
 *      改被 require 的模块后不重启开发者工具，就会出现这种假象）
 *
 * 为什么要真机跑：wxml 与页面 JS **不在 Node 回归的覆盖范围内**，
 * 490/490 全绿也可能漏掉文案问题。
 *
 * 用法：
 *   export NODE_PATH=~/.workbuddy/binaries/node/workspace/node_modules
 *   WB_AUTO_WS=ws://127.0.0.1:9420 node scripts/verify_copy_rename_live.cjs
 */

const fs = require('fs');
const path = require('path');

const WS = process.env.WB_AUTO_WS || 'ws://127.0.0.1:9420';

/* 与 miniprogram/config.js 的 CONTACT_EMAIL 保持一致：直接从源码读，
 * 避免脚本里再抄一份造成漂移（留空时相关断言自动跳过）。 */
const CFG_SRC = fs.readFileSync(path.join(__dirname, '../miniprogram/config.js'), 'utf8');
const CFG_EMAIL_M = CFG_SRC.match(/CONTACT_EMAIL\s*=\s*'([^']*)'/);
const CONTACT_EMAIL = CFG_EMAIL_M ? CFG_EMAIL_M[1] : '';

/* 红线词：命中即视为漏改。注意「错题本 / 多选题 / 题干」是保留的功能术语，不在列。 */
const FORBIDDEN = ['题库', '刷题', '题集', '道题', '押题', '真题', '中质协'];

const PAGES = [
  { url: '/pages/anki/index', name: '首页（牌组列表）', expect: ['牌组'] },
  /* 进度页含「牌组」的文案只存在于「今天还没有学习记录」的空状态分支，
     有学习记录时该分支根本不渲染 —— 故本页不设正向断言，只做反向扫词。 */
  { url: '/pages/stats/index', name: '进度看板', expect: [] },
  { url: '/pages/wrong/index', name: '错题本', expect: ['错题本'] },
  /* 设置页顺带验证 config.js 的接线：CONTACT_EMAIL 非空时「关于」区必须把它渲染出来。
     留空会自动隐藏该行，所以这条断言同时能防「填了但没接到 UI」。 */
  {
    url: '/pages/settings/index',
    name: '设置',
    expect: CONTACT_EMAIL ? ['牌组', CONTACT_EMAIL] : ['牌组'],
    /* 邮箱只渲染在「关于本工具」弹窗内（页面正文仅有一个入口行，
       弹窗走 wx:if="{{activeSubModal === 'about'}}"）——
       不点开就扫不到，属于「未渲染即漏检」，必须显式打开。 */
    before: async (page) => {
      const rows = await page.$$('.row.clickable');
      let opened = false;
      for (const r of rows) {
        let t = '';
        try { t = await r.text(); } catch (e) { t = ''; }
        if (t.indexOf('关于本工具') >= 0) { await r.tap(); opened = true; break; }
      }
      await new Promise((res) => setTimeout(res, 900));
      check('设置 「关于本工具」弹窗入口可点开', opened,
        '未找到含「关于本工具」的 .row.clickable（入口文案被改过？）');
    },
  },
  /* 管理页默认停在「卡片导入」tab，「导出 / 清空 / 牌组名称管理」都在
     manage tab 的 wx:if 分支里 —— 不切 tab 就扫不到这批文案，等于漏检。 */
  {
    url: '/pages/admin/index',
    name: '管理控制台',
    expect: ['导出牌组'],
    before: async (page) => {
      const tabs = await page.$$('.tab');
      if (tabs && tabs[1]) {
        await tabs[1].tap();
        await new Promise((r) => setTimeout(r, 900));
      }
    },
  },
];

let pass = 0;
let fail = 0;

function check(name, ok, detail) {
  if (ok) {
    pass++;
    console.log('  PASS  ' + name);
  } else {
    fail++;
    console.log('  FAIL  ' + name + (detail ? '  → ' + detail : ''));
  }
}

(async () => {
  let automator;
  try {
    automator = require('miniprogram-automator');
  } catch (e) {
    automator = require(path.join(
      process.env.HOME || '',
      '.workbuddy/binaries/node/workspace/node_modules/miniprogram-automator'
    ));
  }

  const mp = await automator.connect({ wsEndpoint: WS });
  console.log('已连接自动化端口 ' + WS + '\n');

  for (const spec of PAGES) {
    console.log('▸ ' + spec.name + '   ' + spec.url);
    await mp.reLaunch(spec.url);
    await new Promise((r) => setTimeout(r, 1200));

    const page = await mp.currentPage();
    if (!page) {
      check(spec.name + ' 页面已渲染', false, 'currentPage 取不到页面（可能白屏）');
      console.log('');
      continue;
    }

    /* 先把页面切到「文案真正会显示」的状态，再采集，避免扫到未渲染分支等于漏检 */
    if (spec.before) await spec.before(page);

    /* 可见文本：优先取 .page 根节点；同时并入渲染后的 WXML，
       以便覆盖 placeholder 这类「不可见于 text()」但用户仍能看到的文案。 */
    let visible = '';
    const root = await page.$('.page');
    if (root) {
      try { visible = await root.text(); } catch (e) { visible = ''; }
    }
    let raw = '';
    try { raw = await page.wxml(); } catch (e) { raw = ''; }
    const haystack = visible + '\n' + raw;

    check(spec.name + ' 页面已渲染', haystack.trim().length > 20,
      '渲染内容为空，长度=' + haystack.trim().length);

    const hits = FORBIDDEN.filter((w) => haystack.indexOf(w) >= 0);
    check(spec.name + ' 无红线词', hits.length === 0,
      hits.length ? '命中：' + hits.join(' / ') : '');

    if (spec.expect.length) {
      const missing = spec.expect.filter((w) => haystack.indexOf(w) < 0);
      check(spec.name + ' 新文案已生效（含 ' + spec.expect.join(' / ') + '）',
        missing.length === 0, missing.length ? '未找到：' + missing.join(' / ') : '');
    } else {
      console.log('  SKIP  正向断言（本页无稳定可见的新增文案，仅做反向扫词）');
    }

    console.log('');
  }

  console.log('─'.repeat(54));
  console.log('文案合规检查：通过 ' + pass + ' / 失败 ' + fail + (fail ? '   FAIL' : ''));

  await mp.disconnect();
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('执行失败：' + ((e && e.stack) || e));
  process.exit(2);
});
