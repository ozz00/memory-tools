const store = require('../../utils/store.js');
const importer = require('../../utils/importer.js');

/** 简易 HTML → 纯文本（仅用于预览行） */
function plain(s) {
  return String(s || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function buildPreview(cards) {
  return (cards || []).slice(0, 5).map(function (c) {
    var t = plain(c.front);
    var hasOpt = c.options && c.options.length > 0;
    var typeLabel = !hasOpt ? '闪卡' : (String(c.cardType || '').indexOf('multi') >= 0 ? '多选' : '单选');
    return {
      stage: c.stage,
      front: t.slice(0, 60) + (t.length > 60 ? '…' : ''),
      typeLabel: typeLabel,
      optLabel: hasOpt ? (c.options.length + ' 项') : '',
      ansLabel: c.correctAnswer ? ('答案 ' + c.correctAnswer) : (hasOpt ? '⚠ 未识别' : ''),
      ansWarn: hasOpt && !c.correctAnswer
    };
  });
}

/**
 * 从 TXT 文件名推导题集名称：去扩展名、去常见冗余前后缀。
 * 例：CAQ__2018绿带考试真题-单选80题.txt → 2018绿带考试真题-单选80题
 */
function deckNameFromFileName(name) {
  let n = String(name || '').replace(/\.(txt|tsv|csv)$/i, '').trim();
  n = n.replace(/^CAQ[_\s-]*/i, '');   // 去掉 CAQ__ / CAQ- 前缀
  n = n.replace(/[_\s-]*note$/i, '');  // 去掉 note 后缀
  n = n.replace(/\s*[（(]\d+[）)]\s*/g, ''); // 去掉「(1)」
  return n.trim();
}

Page({
  data: {
    dark: false,
    tab: 'txt',            // 'txt' | 'manage'
    importMode: 'append',  // 'append' | 'replace'
    rawText: '',
    deckName: '',
    parseResult: null,
    isProcessing: false,
    cardsCount: 0,
    deckList: []
  },

  /* 入口守卫已移除：卡片导入/导出从设置页直接进入，导入是必经流程。 */
  onLoad() {},

  onShow() {
    const s = store.getSettings();
    this.setData({ dark: s.dark, cardsCount: store.getCards().length });
    store.applyNavBar(s.dark);
    this.refreshDecks();
  },

  /* 题集清单（用于改名 / 核对导入结果） */
  refreshDecks() {
    const map = {};
    store.getCards().forEach(function (c) {
      const k = (c && c.deck) ? c.deck : '未命名';
      map[k] = (map[k] || 0) + 1;
    });
    const list = Object.keys(map).map(function (k) {
      return { name: k, count: map[k] };
    }).sort(function (a, b) { return b.count - a.count; });
    this.setData({ deckList: list });
  },

  /* 重命名题集：同样避开 editable 弹窗把 content 预填进输入框的坑 */
  onRenameDeck(e) {
    const cur = String(e.currentTarget.dataset.name || '');
    wx.showModal({
      title: '重命名牌组',
      content: cur,
      editable: true,
      placeholderText: cur,
      confirmText: '保存',
      cancelText: '取消',
      success: (res) => {
        if (!res.confirm) return;
        let to = String(res.content || '').trim().replace(/\s+/g, ' ');
        if (!to || to === cur) return;
        if (to.length > 30) { wx.showToast({ title: '名称过长', icon: 'none' }); return; }
        const r = store.renameDeck(cur, to);
        this.setData({ cardsCount: store.getCards().length });
        this.refreshDecks();
        wx.showToast({
          title: r.ok ? ('已改名为「' + to + '」' + r.changed + ' 张') : '未找到该牌组',
          icon: r.ok ? 'success' : 'none'
        });
      }
    });
  },

  switchTab(e) {
    this.setData({ tab: e.currentTarget.dataset.tab, rawText: '', parseResult: null });
    if (this.data.tab === 'manage') this.refreshDecks();
  },

  onModeChange(e) {
    this.setData({ importMode: e.currentTarget.dataset.mode });
  },

  onTextInput(e) {
    this.setData({ rawText: e.detail.value });
  },

  onDeckInput(e) {
    this.setData({ deckName: e.detail.value });
  },

  /* -------- Anki TXT 通道 -------- */

  pickTxt() {
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      // 注意：extension 一律不带点（微信官方示例格式），带点会导致部分机型过滤失败、聊天里选不到文件
      extension: ['txt', 'tsv', 'csv', 'json', 'text'],
      success: (res) => {
        const file = res.tempFiles && res.tempFiles[0];
        if (!file) return;
        const fs = wx.getFileSystemManager();
        try {
          const text = fs.readFileSync(file.path, 'utf8');
          // 自动用文件名作为题集名：用户只需在导入时确认，不必手动命名
          const autoName = deckNameFromFileName(file.name);
          this.setData({ rawText: text, deckName: autoName });
          // 上传后自动解析，直达预览
          const r = importer.parseText(text);
          this.setData({ parseResult: Object.assign({}, r, { preview: buildPreview(r.cards) }) });
          wx.showToast({
            title: r.success ? '已解析 ' + r.cards.length + ' 张' : '解析失败',
            icon: r.success ? 'success' : 'none'
          });
          if (!r.success) wx.showModal({ title: '解析失败', content: r.message, showCancel: false });
        } catch (err) {
          wx.showToast({ title: '读取失败', icon: 'error' });
        }
      },
      fail: (err) => {
        const msg = (err && err.errMsg) || '';
        if (/cancel/i.test(msg)) return; // 用户主动取消，不提示
        wx.showModal({
          title: '文件选择不可用',
          content: '当前环境无法打开文件选择（' + msg + '）。\n推荐改用「一键导入剪贴板内容」：电脑上打开 .txt 全选复制，再点该按钮即可。',
          showCancel: false
        });
      }
    });
  },

  /* -------- 管理：JSON 备份恢复 -------- */

  parseJsonNow() {
    if (!this.data.rawText.trim()) {
      wx.showToast({ title: '请先粘贴 JSON 备份', icon: 'none' });
      return;
    }
    this.setData({ isProcessing: true });
    const r = importer.parseJson(this.data.rawText);
    this.setData({ parseResult: Object.assign({}, r, { preview: buildPreview(r.cards) }), isProcessing: false });
  },

  /* -------- 共用：确认导入 / 导出 / 重置 -------- */

  confirmImport() {
    let r = this.data.parseResult;
    if (!r || !r.success || !r.cards || r.cards.length === 0) {
      // wxml 里刻意**没有**用 disabled 拦这个按钮：<button disabled> 不派发 bindtap，
      // 用户点上去会「毫无反应」，误以为按钮坏了（2026-09-12 真机反馈）。
      // 改为始终可点，在这里给出「为什么不能导入 + 下一步该做什么」。
      const text = (this.data.rawText || '').trim();
      if (!text) {
        wx.showToast({
          title: '请先点上方「导入」选择 TXT 文件，或直接把卡片内容粘贴到下方文本框',
          icon: 'none',
          duration: 3000
        });
        return;
      }
      // 文本框里有内容却没解析过（手动粘贴路径，本页此前没有「解析」入口 ⇒ 确认导入永远置灰、
      // 用户被卡死）。这里就地补一次解析：成功则继续导入，失败则明确告知格式问题。
      r = importer.parseText(text);
      this.setData({ parseResult: Object.assign({}, r, { preview: buildPreview(r.cards) }) });
      if (!r.success || !r.cards || r.cards.length === 0) {
        wx.showModal({
          title: '解析失败，未导入任何卡片',
          content: (r.message || '未识别出卡片。') + '\n\n请确认每行是一张卡：正面[TAB]背面（用制表符分隔），或使用「导出 TXT 备份」的格式。',
          showCancel: false
        });
        return;
      }
      // 命名不在这里处理：下方 needName 分支已有「确认牌组名称」的可编辑弹窗兜底
    }
    const deck = (this.data.deckName || '').trim();
    // 卡片自带 deck（JSON 备份恢复场景）时保留原题集归属，
    // 否则会把备份里的多个题集统一盖成一个名字、并成一套
    const needName = r.cards.some((c) => !c.deck);
    const doImport = (deckName, cards, skipDup) => {
      store.importCards(cards, this.data.importMode, { skipDuplicates: skipDup });
      // 这两个结果必须在**再次 getCards() 之前**取：getCards 的惰性同步会再写一次、
      // 把 _lastCardWrite 覆盖成一个「无变化」的成功记录，据此判断会漏报失败。
      const wr = store.getLastCardWrite();
      const rep = store.getLastImportReport();
      // 立即清空题集名：下一批导入必须重新命名，否则会沿用旧名导致两套题并成一套
      this.setData({ parseResult: null, rawText: '', deckName: '', cardsCount: store.getCards().length });
      this.refreshDecks();
      // 写入被拒（超出总量预算 / 分片写失败）时存储**原样未动**，无需回滚，
      // 但绝不能报「已导入」——用户会以为进度存住了，实际什么都没写。
      if (wr && wr.ok === false) {
        const why = wr.reason === 'too-large'
          ? '牌组存储已达上限（约 ' + Math.round((store.CARD_SHARDS.MAX_TOTAL_BYTES / 1048576)) + 'MB）。'
          : '存储写入失败。';
        wx.showModal({
          title: '导入未写入',
          content: why + '本次 ' + cards.length + ' 张没有保存，牌组保持为导入前的状态。请先删除部分牌组或降低牌组规模后重试。',
          showCancel: false
        });
        return;
      }
      const skipped = (rep && rep.skippedDuplicates) || 0;
      const added = (rep && rep.added) || 0;
      // 有跳过时改用 icon:'none'：success 图标的标题只显示 7 个字，会被截断成
      // 「已导入「2018…」，用户看不到「跳过 N 张」这个关键信息。
      if (skipped > 0) {
        wx.showToast({
          title: added > 0
            ? ('已导入 ' + added + ' 张，跳过 ' + skipped + ' 张重复')
            : ('本批 ' + cards.length + ' 张全部重复，未导入'),
          icon: 'none',
          duration: 2600
        });
        return;
      }
      const deckN = cards.reduce(function (m, c) { m[c.deck || '未命名'] = 1; return m; }, {});
      const title = needName
        ? ('已导入「' + deckName + '」' + cards.length + ' 张')
        : ('已恢复 ' + cards.length + ' 张 / ' + Object.keys(deckN).length + ' 个牌组');
      wx.showToast({ title: title, icon: 'success' });
    };

    /**
     * 导入前的去重闸门。
     *
     * 为什么要拦一下：导入卡的 id 含时间戳+随机串 ⇒ 同一文件重传一次就是 100% 重复对子，
     * 而重复的后果是静默的（题库翻倍、复习量翻倍、存储成倍占用）。这里先算清张数再让用户决定。
     */
    const startImport = (deckName) => {
      // 本批次卡片盖上题集名称（首页按此分组）；已有 deck 的原样保留
      const cards = r.cards.map((c) => Object.assign({}, c, { deck: c.deck || deckName }));
      const dup = store.scanDuplicates(cards, this.data.importMode);
      if (dup.dup === 0) { doImport(deckName, cards, true); return; }
      const parts = [];
      if (dup.library > 0) parts.push(dup.library + ' 张与已有卡片相同');
      if (dup.batch > 0) parts.push(dup.batch + ' 张批内重复');
      wx.showModal({
        title: '发现重复卡片',
        content: '本批 ' + dup.total + ' 张中，' + parts.join('、') + '。\n跳过重复项（推荐），或全部导入？',
        confirmText: '跳过重复',
        cancelText: '仍然导入',
        success: (res) => { doImport(deckName, cards, res.confirm === true); },
        // 弹窗异常时按「全部导入」处理：宁可留重复，也不因一次 UI 故障静默丢数据
        fail: () => { doImport(deckName, cards, false); }
      });
    };
    if (needName) {
      const autoName = deck || '导入牌组';
      // 坑：editable:true 时部分真机版本会把 content 预填进输入框（开发者工具里则是纯提示文字），
      // 因此 content 必须只放「默认名称」本身，说明性文字一律挪到 title / toast。
      const HINT_RE = /(确定导入|自动识别|已按文件名|直接点|取消)/;
      wx.showModal({
        title: '确认牌组名称',
        content: autoName,
        editable: true,
        placeholderText: autoName,
        confirmText: '确定导入',
        cancelText: '取消',
        success: (res) => {
          if (!res.confirm) return;
          let name = String(res.content || '').trim().replace(/\s+/g, ' ');
          // 防御：未修改/被预填成提示语/异常超长 → 一律回退到自动识别的名称
          if (!name || name.length > 30 || HINT_RE.test(name)) name = autoName;
          this.setData({ deckName: name });
          startImport(name);
        }
      });
      return;
    }
    startImport(deck);
  },

  exportJson() {
    const cards = store.getCards();
    if (!cards.length) {
      wx.showToast({ title: '牌组是空的，无可导出内容', icon: 'none' });
      return;
    }
    const text = JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), cards: cards }, null, 2);
    // 同时落一份到用户目录：仅靠剪贴板很容易被后续复制冲掉，备份等于没存
    const d = new Date();
    const p = (n) => (n < 10 ? '0' + n : '' + n);
    const stamp = d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
    const fileName = 'caq-backup-' + stamp + '.json';
    let filePath = '';
    try {
      filePath = wx.env.USER_DATA_PATH + '/' + fileName;
      wx.getFileSystemManager().writeFileSync(filePath, text, 'utf8');
    } catch (e) {
      filePath = '';
    }
    wx.setClipboardData({
      data: text,
      success: () => {
        if (filePath && typeof wx.shareFileMessage === 'function') {
          wx.showModal({
            title: '备份已生成',
            content: '共 ' + cards.length + ' 张卡片。已复制到剪贴板；建议点「发到微信」存进文件传输助手长期保留（剪贴板会被后续复制冲掉）。',
            confirmText: '发到微信',
            cancelText: '仅复制',
            success: (res) => {
              if (!res.confirm) return;
              wx.shareFileMessage({
                filePath: filePath,
                fileName: fileName,
                fail: () => wx.showToast({ title: '发送取消，可改用复制内容', icon: 'none' })
              });
            }
          });
          return;
        }
        wx.showModal({
          title: '已复制到剪贴板',
          content: '共 ' + cards.length + ' 张卡片（JSON 备份）。请粘贴到备忘录/文件传输助手保存；恢复时粘贴到「管理 → 恢复 JSON 备份」即可。',
          showCancel: false
        });
      }
    });
  },

  /**
   * 导出 Anki TXT（按题集分文件，丢 SM-2 进度）
   * 流程：importer.exportAnkiTxt → 逐个文件 writeFileSync 到 USER_DATA_PATH
   *       → 弹窗列出文件清单 + 转发第一个到微信（多文件场景受 shareFileMessage 单文件限制）
   */
  exportAnkiTxt() {
    const cards = store.getCards();
    if (!cards.length) {
      wx.showToast({ title: '牌组是空的，无可导出内容', icon: 'none' });
      return;
    }
    const r = importer.exportAnkiTxt(cards);
    if (!r.files.length) {
      wx.showToast({ title: '无可导出文件', icon: 'none' });
      return;
    }

    const d = new Date();
    const p = (n) => (n < 10 ? '0' + n : '' + n);
    const stamp = d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
    const fs = wx.getFileSystemManager();
    const written = []; // [{ deck, filePath, fileName, count }]
    const failed = [];

    for (let i = 0; i < r.files.length; i++) {
      const f = r.files[i];
      // 文件名：caq-anki-{deck 名}-{时间戳}.txt（去掉 deck 名里的不安全字符）
      const safeDeck = String(f.deck).replace(/[\\/:*?"<>|\s]/g, '_').slice(0, 60);
      const fileName = 'caq-anki-' + safeDeck + '-' + stamp + '.txt';
      const filePath = wx.env.USER_DATA_PATH + '/' + fileName;
      try {
        fs.writeFileSync(filePath, f.text, 'utf8');
        written.push({ deck: f.deck, filePath, fileName, count: f.count });
      } catch (e) {
        failed.push(f.deck + '（' + (e.message || '写入失败') + '）');
      }
    }

    if (!written.length) {
      wx.showModal({ title: '导出失败', content: '全部文件写入失败：' + failed.join('；'), showCancel: false });
      return;
    }

    // 把文件清单写入剪贴板（便于用户丢失文件时快速找回）
    const summary = written.map(w => w.fileName + '  (' + w.count + ' 张)').join('\n');
    wx.setClipboardData({
      data: 'Anki TXT 导出文件清单（' + stamp + '）：\n' + summary,
      success: () => {
        // 多文件 → 只能转发第一个；弹窗列出全部清单，提示用户进入文件传输助手找
        if (written.length === 1) {
          wx.showModal({
            title: '已生成 1 个文件',
            content: written[0].fileName + '\n共 ' + written[0].count + ' 张\n（清单已复制到剪贴板）',
            confirmText: '发到微信',
            cancelText: '稍后',
            success: (res) => {
              if (res.confirm && typeof wx.shareFileMessage === 'function') {
                wx.shareFileMessage({
                  filePath: written[0].filePath,
                  fileName: written[0].fileName,
                  fail: () => wx.showToast({ title: '发送取消', icon: 'none' })
                });
              }
            }
          });
          return;
        }
        // 多文件场景
        const listText = written.map((w, i) => (i + 1) + '. ' + w.fileName + ' · ' + w.count + ' 张').join('\n');
        wx.showModal({
          title: '已生成 ' + written.length + ' 个文件',
          content: listText + '\n\n（清单已复制到剪贴板 · 按下「发到微信」转发第一个）',
          confirmText: '发到微信',
          cancelText: '稍后',
          success: (res) => {
            if (res.confirm && typeof wx.shareFileMessage === 'function') {
              wx.shareFileMessage({
                filePath: written[0].filePath,
                fileName: written[0].fileName,
                fail: () => wx.showToast({ title: '发送取消', icon: 'none' })
              });
            }
          }
        });
      }
    });

    if (failed.length) {
      wx.showToast({ title: failed.length + ' 个文件失败', icon: 'none' });
    }
  },

  resetDefault() {
    wx.showModal({
      title: '清空牌组',
      content: '将清空全部卡片（不含错题本、收藏与统计），确定？',
      success: (res) => {
        if (res.confirm) {
          // 真清空：连示例卡一并清掉（用户点「清空」就是想空）
          store.clearAllCards();
          this.setData({ cardsCount: store.getCards().length });
          wx.showToast({ title: '已清空', icon: 'success' });
        }
      }
    });
  }
});
