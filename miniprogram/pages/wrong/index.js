const store = require('../../utils/store.js');
const rich = require('../../utils/rich.js');

// 预计算选项渲染数据（避免 WXML 不支持 .charAt() 等方法调用）
function buildOptionList(options, selectedOption, isSubmitted, correctUpper) {
  if (!options || options.length === 0) return [];
  return options.map(function (opt) {
    const prefix = (opt.charAt(0) || '').toString();
    let cls = 'option';
    if (!isSubmitted) {
      if (prefix === selectedOption) cls += ' chosen';
    } else {
      if (prefix === correctUpper) cls += ' correct';
      else if (prefix === selectedOption) cls += ' wrong';
    }
    return { text: opt, prefix: prefix, cls: cls };
  });
}

Page({
  data: {
    dark: false,
    mode: 'list',         // 'list' | 'practice' | 'finished'
    wrongCards: [],
    practiceDeck: [],
    index: 0,
    current: null,
    selectedOption: null,
    isSubmitted: false,
    isFlipped: false,
    score: 0,
    justCleared: false,
    optionList: [],
    frontNodes: [],
    backNodes: []
  },

  onShow() {
    /* 本地工具：关闭「转发」与「分享到朋友圈」入口（与「备忘录」类目释义一致） */
    wx.hideShareMenu({ menus: ['shareAppMessage', 'shareTimeline'] });
    const s = store.getSettings();
    this.setData({ dark: s.dark });
    store.applyNavBar(s.dark);
    this.rebuildList();
  },

  rebuildList() {
    const all = store.getCards();
    const ids = store.getStats().wrongCardIds || [];
    const list = all.filter(function (c) { return ids.indexOf(c.id) >= 0; });
    list.forEach(function (c) { c.frontText = rich.toPlainText(c.front); });
    this.setData({ wrongCards: list });
  },

  startPractice() {
    if (this.data.wrongCards.length === 0) return;
    this.setData({
      mode: 'practice',
      practiceDeck: this.data.wrongCards.slice(),
      index: 0,
      score: 0,
      selectedOption: null,
      isSubmitted: false,
      isFlipped: false
    });
    this.loadCurrent();
  },

  loadCurrent() {
    const deck = this.data.practiceDeck;
    const cur = deck[this.data.index] || null;
    const correctUpper = cur ? (cur.correctAnswer || 'A').toString().trim().toUpperCase() : 'A';
    this.setData({
      current: cur,
      selectedOption: null,
      isSubmitted: false,
      isFlipped: false,
      justCleared: false,
      frontNodes: cur ? rich.toNodes(cur.front) : [],
      backNodes: cur ? rich.toNodes(cur.back) : [],
      optionList: buildOptionList(cur ? cur.options : [], null, false, correctUpper)
    });
  },

  onSelectOption(e) {
    if (this.data.isSubmitted) return;
    const cur = this.data.current;
    const correctUpper = cur ? (cur.correctAnswer || 'A').toString().trim().toUpperCase() : 'A';
    this.setData({
      selectedOption: e.currentTarget.dataset.prefix,
      optionList: buildOptionList(cur ? cur.options : [], e.currentTarget.dataset.prefix, false, correctUpper)
    });
  },

  submitOption() {
    const cur = this.data.current;
    if (!cur || !this.data.selectedOption) return;
    const correct = (cur.correctAnswer || 'A').toString().trim().toUpperCase();
    const isRight = this.data.selectedOption === correct;
    let score = this.data.score;
    let cleared = false;
    if (isRight) {
      score += 1;
      store.removeWrong(cur.id);
      cleared = true;
    } else {
      store.recordWrong(cur.id);
    }
    this.setData({
      isSubmitted: true,
      score: score,
      justCleared: cleared,
      optionList: buildOptionList(cur.options, this.data.selectedOption, true, correct)
    });
  },

  flip() { this.setData({ isFlipped: !this.data.isFlipped }); },

  markFlashcard(correct) {
    const cur = this.data.current;
    if (!cur) return;
    let score = this.data.score;
    let cleared = false;
    if (correct) {
      score += 1;
      store.removeWrong(cur.id);
      cleared = true;
    }
    this.setData({ score: score, justCleared: cleared });
    this.next();
  },

  next() {
    const next = this.data.index + 1;
    if (next < this.data.practiceDeck.length) {
      this.setData({ index: next });
      this.loadCurrent();
    } else {
      this.setData({ mode: 'finished' });
      this.rebuildList();
    }
  },

  stopPractice() {
    this.setData({ mode: 'list' });
    this.rebuildList();
  },

  clearAll() {
    wx.showModal({
      title: '清空错题本',
      content: '将清空所有错题记录，确定继续？',
      success: (res) => {
        if (res.confirm) {
          store.clearWrong();
          this.rebuildList();
        }
      }
    });
  },

  removeOne(e) {
    store.removeWrong(e.currentTarget.dataset.id);
    this.rebuildList();
  }
});