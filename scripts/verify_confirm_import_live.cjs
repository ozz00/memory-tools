/**
 * 「确认导入」按钮的可点性与反馈 —— 真机/模拟器验证（需开发者工具处于自动化模式）
 *
 * 背景（2026-09-12 真机反馈）：该按钮原先用 `disabled="{{!parseResult || !parseResult.success}}"`，
 * 而 <button disabled> **完全不派发 bindtap** ⇒ 用户点上去「毫无反应」，连 handler 里的
 * 兜底 toast 都不会执行，被误判为「按钮坏了」。
 *
 * 另外暴露出一条**真实死路**：txt 标签下的文本框允许手动粘贴 Anki TXT
 * （placeholder 明确写了「粘贴多张卡片请直接全量粘贴」），但该标签**没有任何解析入口**
 * ⇒ parseResult 永远为空 ⇒ 按钮永远置灰 ⇒ 粘了内容也导入不了。
 *
 * 本脚本验证四条不变量：
 *   1. 按钮**没有** disabled 属性（防回归到「点了没反应」）
 *   2. 空文本框时点击 → 给出**可操作的** toast（而不是静默）
 *   3. 文本框有内容但未解析时点击 → **就地解析**成功（打通手动粘贴路径）
 *   4. 内容格式不对时点击 → 弹「解析失败」并**明确不导入**
 *
 * 全程不写库：把 wx.showModal 打成 no-op，任何导入流程都停在弹窗、不会落盘；
 * 收尾仍按惯例备份 / 还原题库以防万一。
 *
 * 不纳入 run_all.sh（需要 IDE 自动化端口）。
 * 用法：WB_AUTO_WS=ws://127.0.0.1:9420 node scripts/verify_confirm_import_live.cjs
 */
const automator = require('miniprogram-automator');
const path = require('path');

const PORT = process.env.AUTO_PORT || 9420;
const ROOT = '/Users/jackyzhao/Documents/Myapp/CAQ-tester/CAQ--main';
const OUT = path.join(ROOT, '.workbuddy/screenshots');

const { makeCardIO } = require('./_liveenv.cjs');

let pass = 0, fail = 0;
const check = (n, c, d) => {
  if (c) { pass++; console.log('  ok  ' + n + (d !== undefined ? '  [' + d + ']' : '')); }
  else { fail++; console.log('FAIL  ' + n + (d !== undefined ? '  [' + d + ']' : '')); }
};

/** 一份「能解析成功」的最小 Anki TXT */
const GOOD_TXT = [
  '#separator:tab',
  '#html:true',
  '什么是 DMAIC？\tDefine-Measure-Analyze-Improve-Control，六西格玛改进的五个阶段',
  '过程能力指数 Cpk 越大越好吗？\t在中心化前提下越大越好，反映过程满足规格的能力'
].join('\n');

/** 一份「解析不出卡片」的文本 */
const BAD_TXT = '这不是卡片格式\n没有制表符分隔\n也没有任何可识别的结构';

(async () => {
  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:' + PORT });
  const io = makeCardIO(mp);

  const backupCards = await io.readCards();
  console.log('备份：卡片 ' + backupCards.length + ' 张');

  try {
    await mp.reLaunch('/pages/admin/index');
    await new Promise((r) => setTimeout(r, 1500));

    /* ── 1. 按钮不应带 disabled 属性 ── */
    console.log('\n── 1. 按钮可点性（DOM） ──');
    const page = await mp.currentPage();
    let btnFound = false, hasDisabled = null, btnText = '';
    try {
      const buttons = await page.$$('button');
      for (const b of buttons) {
        const t = (await b.text()) || '';
        if (t.indexOf('确认导入') >= 0) {
          btnFound = true; btnText = t.trim();
          const attr = await b.attribute('disabled');
          hasDisabled = attr === true || attr === 'true' || attr === '' || attr === 'disabled';
          break;
        }
      }
    } catch (e) {
      btnFound = false;
    }
    check('1.1 找到「确认导入」按钮', btnFound === true, btnText || '未找到');
    check('1.2 按钮不带 disabled 属性', hasDisabled === false,
      hasDisabled === null ? '未能读取属性' : String(hasDisabled));

    /* ── 2. 空文本框点击 → 必须给出可操作提示 ── */
    console.log('\n── 2. 空文本框点击：应提示「先选文件或粘贴内容」 ──');
    const emptyCase = await mp.evaluate(() => {
      const pages = getCurrentPages();
      const p = pages[pages.length - 1];
      const cap = { toast: null, modal: null };
      const oT = wx.showToast, oM = wx.showModal;
      wx.showToast = function (o) { cap.toast = { title: o.title, icon: o.icon }; };
      wx.showModal = function (o) { cap.modal = { title: o.title }; };
      p.setData({
        tab: 'txt', rawText: '', parseResult: null, deckName: '',
        cardsCount: require('utils/store.js').getCards().length
      });
      p.confirmImport();
      wx.showToast = oT; wx.showModal = oM;
      return { cap: cap, route: p.route, parseResult: p.data.parseResult };
    });
    check('2.1 当前在管理页', emptyCase.route === 'pages/admin/index', emptyCase.route);
    check('2.2 给出了 toast（而不是静默无反应）', !!emptyCase.cap.toast,
      emptyCase.cap.toast && emptyCase.cap.toast.title);
    check('2.3 toast 文案可操作（提到「导入」或「粘贴」）',
      !!emptyCase.cap.toast && /导入|粘贴/.test(emptyCase.cap.toast.title),
      emptyCase.cap.toast && emptyCase.cap.toast.title);
    check('2.4 未误弹解析失败框', !emptyCase.cap.modal, emptyCase.cap.modal && emptyCase.cap.modal.title);

    await new Promise((r) => setTimeout(r, 400));
    await mp.screenshot({ path: path.join(OUT, 'confirm_import_empty_toast.png') });

    /* ── 3. 手动粘贴路径：有内容但未解析 → 就地解析 ── */
    console.log('\n── 3. 粘贴内容后点击：应就地解析出卡片 ──');
    const pasteCase = await mp.evaluate((txt) => {
      const pages = getCurrentPages();
      const p = pages[pages.length - 1];
      const cap = { toast: null, modal: null };
      const oT = wx.showToast, oM = wx.showModal;
      wx.showToast = function (o) { cap.toast = { title: o.title }; };
      // 打成 no-op：即使走到「确认牌组名称」，也不会真的写库
      wx.showModal = function (o) { cap.modal = { title: o.title }; };
      p.setData({ tab: 'txt', rawText: txt, parseResult: null, deckName: '' });
      const before = require('utils/store.js').getCards().length;
      p.confirmImport();
      wx.showToast = oT; wx.showModal = oM;
      return {
        cards: p.data.parseResult && p.data.parseResult.cards ? p.data.parseResult.cards.length : 0,
        success: !!(p.data.parseResult && p.data.parseResult.success),
        modal: cap.modal, before: before,
        after: require('utils/store.js').getCards().length
      };
    }, GOOD_TXT);
    check('3.1 就地解析成功', pasteCase.success === true, 'success=' + pasteCase.success);
    check('3.2 解析出 2 张卡片', pasteCase.cards === 2, pasteCase.cards + ' 张');
    check('3.3 走到命名弹窗（未静默丢弃）',
      !!pasteCase.modal && /名称/.test(pasteCase.modal.title || ''),
      pasteCase.modal && pasteCase.modal.title);
    check('3.4 未写库（弹窗被拦住）', pasteCase.before === pasteCase.after,
      pasteCase.before + ' → ' + pasteCase.after);

    /* ── 4. 格式不对 → 明确拒绝并给出格式说明 ── */
    console.log('\n── 4. 格式错误点击：应弹「解析失败」且不导入 ──');
    const badCase = await mp.evaluate((txt) => {
      const pages = getCurrentPages();
      const p = pages[pages.length - 1];
      const cap = { toast: null, modal: null };
      const oT = wx.showToast, oM = wx.showModal;
      wx.showToast = function (o) { cap.toast = { title: o.title }; };
      wx.showModal = function (o) { cap.modal = { title: o.title, content: o.content }; };
      p.setData({ tab: 'txt', rawText: txt, parseResult: null, deckName: '' });
      const before = require('utils/store.js').getCards().length;
      p.confirmImport();
      wx.showToast = oT; wx.showModal = oM;
      return { modal: cap.modal, before: before, after: require('utils/store.js').getCards().length };
    }, BAD_TXT);
    check('4.1 弹出了「解析失败」', !!badCase.modal && /解析失败/.test(badCase.modal.title || ''),
      badCase.modal && badCase.modal.title);
    check('4.2 文案说明了正确格式（制表符/正面+背面）',
      !!badCase.modal && /制表符|TAB|正面/i.test(badCase.modal.content || ''),
      badCase.modal && String(badCase.modal.content).slice(0, 40));
    check('4.3 未写库', badCase.before === badCase.after, badCase.before + ' → ' + badCase.after);

    await new Promise((r) => setTimeout(r, 400));
    await mp.screenshot({ path: path.join(OUT, 'confirm_import_parse_fail.png') });

  } finally {
    console.log('\n── 还原题库 ──');
    if (backupCards.length) await io.writeCards(backupCards);
    const after = await io.readCards();
    console.log('还原后：卡片 ' + after.length + ' 张（备份 ' + backupCards.length + ' 张）');
    await mp.disconnect();
  }

  console.log('\n确认导入按钮（真机）：通过 ' + pass + ' / 失败 ' + fail);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('运行异常：', (e && e.stack) || e);
  process.exit(1);
});
