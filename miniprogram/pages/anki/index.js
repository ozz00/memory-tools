const store = require('../../utils/store.js');
const sm2 = require('../../utils/sm2.js');
// 复习评分统一走调度门面：SM-2 生效 + FSRS 影子记录（见 utils/scheduler.js）
const scheduler = require('../../utils/scheduler.js');
const rich = require('../../utils/rich.js');

const DEFAULT_DECK = '默认牌组';
// 持久化键统一由 store.js 集中声明（云同步打包依赖键名一致，勿在此另立常量）
const KEY_FLIP_HINT = store.KEY_FLIP_HINT;
const KEY_SESSIONS = store.KEY_SESSIONS;

/* 会话结构：{ deck, limit, total, batchIds:[], index, updatedAt }
   batchIds = 本轮固定批的卡片 id 快照；index = 已学到的位置（下一张待学下标） */

/**
 * 选项渲染数据（扩展支持多选）：
 * 未判分时仅标记已选（chosen）；判分后正确项标绿 + ✓，错选项标红 + ✗。
 */
function buildOptionList(options, selectedLetters, judged, correctLetters) {
  if (!options || options.length === 0) return [];
  const sel = selectedLetters || [];
  const cor = correctLetters || [];
  return options.map(function (opt) {
    const prefix = (opt.charAt(0) || '').toString();
    let cls = 'anki-option';
    let mark = '';
    if (!judged) {
      if (sel.indexOf(prefix) >= 0) cls += ' chosen';
    } else {
      if (cor.indexOf(prefix) >= 0) {
        cls += ' correct';
        mark = '✓';
      } else if (sel.indexOf(prefix) >= 0) {
        cls += ' wrong';
        mark = '✗';
      }
    }
    return { text: opt, prefix: prefix, cls: cls, mark: mark };
  });
}

/** 解析 correctAnswer（如 'A' 或 'ABD'）为字母数组 */
function parseCorrectLetters(answer) {
  const s = ((answer || 'A') + '').toUpperCase();
  const letters = s.match(/[A-F]/g) || ['A'];
  // 去重保序
  const seen = {};
  return letters.filter(function (l) { if (seen[l]) return false; seen[l] = 1; return true; });
}

/** 两个字母集合是否相等（不计顺序） */
function sameSet(a, b) {
  if (a.length !== b.length) return false;
  const sa = a.slice().sort().join('');
  const sb = b.slice().sort().join('');
  return sa === sb;
}

Page({
  data: {
    mode: 'home',          // 'home' 题集列表 | 'study' 刷题模式
    deckList: [],          // 首页题集列表
    totalCards: 0,
    currentDeck: '',       // 当前刷题的题集名称
    dark: false,
    deck: [],
    index: 0,
    current: null,
    flipped: false,
    completed: false,
    ratings: [],
    isFav: false,
    selectedOption: '',   // 已选选项字母（如 B）
    selectedPrefix: '',   // 提交后用于背面「你的作答」标记
    isSubmitted: false,   // 是否已提交答案
    judgeResult: null,    // 判分反馈：{ right: bool, text }
    optionList: [],       // 选项按钮渲染数据
    showFlipHint: false,  // 底部操作提示：仅首次使用显示
    frontNodes: [],
    backNodes: [],
    backLinks: [],        // 背面提取到的文章链接（点击复制）
    cardImages: [],       // 当前卡补拍/选存的本地图片路径（正反面都显示）
    flipping: false,      // 是否处于翻转动画中
    flipTarget: '',       // 动画方向：flip-to-back / flip-to-front

    /* 复习会话（进入题集按「设置」默认数量直接开启；中途退出保留，下次断点续学） */
    sessionLimit: 0,      // 本轮刷题数量上限（默认取「设置」studyCount；0 = 不限制 / 全部）
    session: null,        // 当前复习会话 { deck, limit, total, batchIds, passed, pending }
    /* 退出复习确认弹窗（学习中点击「题集列表」弹出） */
    showQuit: false,      // 是否显示退出确认
    quitText: '',         // 退出确认提示文案（含当前进度）

    /* 每日配额与今日任务（2026-09-10 新增） */
    todayTask: null,      // 全库今日任务概览 { due, new, total, ... }
    todayDone: 0,         // 今日已完成张数（新卡 + 到期，不含重做）
    todayLeft: 0,         // 当前题集今日剩余待完成张数（完成页提示用）
    todayBacklog: 0,      // 该题集受配额以外仍积压的卡片数（区分「配额做完」与「真的没卡」）
    examPlan: null,       // 备考覆盖率：设置考试日期后才有值
    freeMode: false       // 额外加练：忽略每日配额（完成页手动触发）
  },

  onLoad() {
    const g = getApp().globalData;
    if (g && g.anki && g.anki.selectedStage) {
      this.setData({ selectedStage: g.anki.selectedStage });
    }
  },

  onShow() {
    /* 本地工具：关闭「转发」与「分享到朋友圈」入口（与「备忘录」类目释义一致）。
     * 关闭≠限制用户，只是不提供传播通道；如需恢复，删掉这一行并恢复页面内的
     * onShareAppMessage 即可（分享标题文案见 git 历史）。 */
    wx.hideShareMenu({ menus: ['shareAppMessage', 'shareTimeline'] });
    const settings = store.getSettings();
    store.applyNavBar(settings.dark);
    this.setData({ dark: settings.dark, showFlipHint: !wx.getStorageSync(KEY_FLIP_HINT) });
    if (this.data.mode === 'study') {
      // 刷题模式：隐藏底部导航条，让题目/解析区最大化（返回列表时恢复）
      this.setBarHidden(true);
      if (!this.data.completed) this.refresh(); // 已完成页保持原样，不做重载
      this._startTimer(); // 回到刷题前台：继续累计学习时长
    } else {
      this.setBarHidden(false);
      this.buildHome();
    }
  },

  onHide() {
    // 切走/退出前落库当前会话（队列状态已在每次评分时实时持久化，这里兜底刷新）
    if (this.data.mode === 'study' && this.data.session) {
      this._touchSession();
      this._flushStudySec(); // 离开前台：结算一段学习时长
    }
    const g = getApp().globalData;
    g.anki.selectedStage = 'all';
  },

  /* ============ 首页：题集列表 ============ */

  buildHome() {
    const cards = store.getCards();
    const now = Date.now();
    const groups = {};
    const order = [];
    cards.forEach(function (c) {
      const name = c.deck || DEFAULT_DECK;
      if (!groups[name]) {
        groups[name] = { name: name, total: 0, newCount: 0, dueCount: 0 };
        order.push(name);
      }
      groups[name].total++;
      if (c.state === 'new') groups[name].newCount++;
      else if (c.nextReviewDate <= now) groups[name].dueCount++;
    });
    // 用户导入的题集排在前面，内置题库放最后
    order.sort(function (a, b) {
      if (a === DEFAULT_DECK) return 1;
      if (b === DEFAULT_DECK) return -1;
      return 0;
    });
    const sessions = this._loadSessions();
    const deckList = order.map(function (n, i) {
      const item = Object.assign({ index: i + 1 }, groups[n]);
      // 有未完成复习会话的题集：标注进行中进度（已通过张数/总数，且还有待做）
      const s = sessions[n];
      const passedN = s && Array.isArray(s.passed) ? s.passed.length : 0;
      const pendingN = s && Array.isArray(s.pending) ? s.pending.length : 0;
      if (passedN > 0 && pendingN > 0) {
        item.progress = passedN + '/' + (s.total || s.batchIds.length);
      }
      return item;
    });
    // 今日任务（全库）与备考覆盖率 —— 首页顶部卡片的数据源。
    // 与 refresh() 的批次构建共用 store.getTodayTask / getDailyQuota，
    // 保证「首页显示还剩 N 张」与「点进去实际能拿到 N 张」不会漂移。
    const todayTask = store.getTodayTask();
    const quota = todayTask.quota;
    this.setData({
      deckList: deckList,
      totalCards: cards.length,
      todayTask: todayTask,
      todayDone: quota.newUsed + quota.dueUsed,
      examPlan: store.getExamPlan()
    });
  },

  /* 点击题集：有未完成会话 → 断点续学（不再询问数量）；否则按「设置」默认数量直接开启新一轮 */
  openDeck(e) {
    const name = e.currentTarget.dataset.deck;
    // 1) 有进行中的复习（队列还有待做卡，无论已通过几张）→ 直接续学，不再询问数量
    let s = this._getSession(name);
    if (s && s.batchIds && s.batchIds.length) {
      this._upgradeSession(s); // 旧版会话结构（batchIds+index）升级为 passed+pending
      if (s.pending && s.pending.length) {
        this._persistSession(s);
        store.haptic();
        this.setData({
          session: s,
          sessionLimit: s.limit || 0,
          mode: 'study',
          currentDeck: name,
          selectedStage: 'all',
          index: 0,
          completed: false,
          flipped: false,
          freeMode: false,   // 断点续学回到正常配额模式
          todayLeft: 0
        });
        this.setBarHidden(true); // 进入刷题：隐藏底部导航条，扩大题目区域
        this._startTimer();      // 断点续学：开始累计学习时长
        this.refresh();
        return;
      }
      // 无待做（已全部通过但会话残留）→ 丢弃残留会话，走新批
      this._dropSession(name);
    }
    // 2) 无进行中会话 → 直接按「设置 → 每轮学习卡片数量」默认值开启（默认 30，不再弹窗询问）
    const def = Number(store.getSettings().studyCount) || 30;
    store.haptic();
    this.setData({
      session: null,        // 新一批：由 refresh() 构建固定批并持久化为会话
      sessionLimit: def,
      mode: 'study',
      currentDeck: name,
      selectedStage: 'all',
      index: 0,
      completed: false,
      flipped: false,
      freeMode: false,      // 从首页进入一律走正常配额模式
      todayLeft: 0
    });
    this.setBarHidden(true); // 进入刷题：隐藏底部导航条，扩大题目区域
    this._startTimer();      // 新一轮：开始累计学习时长
    this.refresh();
  },

  /* 事件冒泡占位（阻止点击弹层内部内容关闭弹层） */
  noop() {},

  /* 返回题集列表：
     刷题中途（已有通过张数且还有未通过待做）→ 弹出自定义确认层，保存进度供下次从断点续学；
     已完成 / 刚开始 / 空题集 / 首页 → 不打扰，直接返回 */
  goHome() {
    const sess = this.data.session;
    const inStudy = this.data.mode === 'study' && !this.data.completed;
    const passedN = sess && Array.isArray(sess.passed) ? sess.passed.length : 0;
    const pendingN = sess && Array.isArray(sess.pending) ? sess.pending.length : 0;
    const hasProgress = passedN > 0 && pendingN > 0;
    if (inStudy && hasProgress) {
      store.haptic();
      const totalN = sess.total || sess.batchIds.length;
      this.setData({
        showQuit: true,
        quitText: '当前进度 ' + passedN + '/' + totalN + ' 张。退出将保存进度，下次进入可从断点继续。'
      });
      return;
    }
    // 已完成 → 清除会话；未开始(0/N) → 会话无意义，一并清除
    this._doGoHome(this.data.completed || passedN === 0);
  },

  /* 取消退出：留在原地继续复习 */
  cancelQuit() {
    this.setData({ showQuit: false });
  },

  /* 确认退出：保存进度并返回题集列表（保留会话供下次续学） */
  confirmQuit() {
    this.setData({ showQuit: false });
    this._touchSession();
    this._doGoHome(false);               // 保留会话，供下次续学
  },

  _doGoHome(clearSession) {
    if (clearSession && this.data.currentDeck) this._dropSession(this.data.currentDeck);
    this._flushStudySec(); // 离开刷题：结算学习时长
    this.setData({ mode: 'home', currentDeck: '', session: null, sessionLimit: 0, flipped: false, completed: false, freeMode: false, todayLeft: 0 });
    this.setBarHidden(false); // 返回题集列表：恢复底部导航条
    this.buildHome();
  },

  /* 显示/隐藏自定义底部导航条（custom-tab-bar 组件） */
  setBarHidden(hidden) {
    if (typeof this.getTabBar === 'function') {
      const bar = this.getTabBar();
      if (bar) {
        bar.setData({ hidden: !!hidden });
        bar.sync && bar.sync();
      }
    }
  },

  /* ============ 学习时长统计（进度看板数据源） ============ */

  /* 进入刷题前台：开始累计学习秒数（幂等，重复调用不重置） */
  _startTimer() {
    if (!this._studyStart) this._studyStart = Date.now();
  },

  /* 结算并落库：把自开始以来的前台学习秒数记入今日统计，随后重置 */
  _flushStudySec() {
    if (!this._studyStart) return;
    const sec = (Date.now() - this._studyStart) / 1000;
    this._studyStart = null;
    if (sec >= 1) store.recordStudy(sec);
  },

  /* ============ 复习会话（中断续学 / 进度记录） ============ */

  _loadSessions() {
    try { return wx.getStorageSync(KEY_SESSIONS) || {}; } catch (e) { return {}; }
  },

  _getSession(deck) {
    const map = this._loadSessions();
    return map[deck] || null;
  },

  _persistSession(sess) {
    if (!sess || !sess.deck) return;
    const map = this._loadSessions();
    map[sess.deck] = sess;
    try { wx.setStorageSync(KEY_SESSIONS, map); } catch (e) { /* 存储满/异常时忽略 */ }
  },

  _dropSession(deck) {
    if (!deck) return;
    const map = this._loadSessions();
    if (map[deck]) {
      delete map[deck];
      try { wx.setStorageSync(KEY_SESSIONS, map); } catch (e) { /* ignore */ }
    }
  },

  /* 把当前会话落库并刷新 updatedAt（每次队列变化后调用） */
  _touchSession() {
    const sess = this.data.session;
    if (!sess || !sess.deck) return;
    sess.updatedAt = Date.now();
    this._persistSession(sess);
  },

  /* 旧版会话（batchIds + index，仅计数无重做）升级为 passed + pending 队列：
     passed=已通过（评过良好/简单）卡片 id；pending=仍未通过、待做队列（队首=当前卡）。
     旧数据无法还原「重来/困难」，近似按 index 将已学过的张数视为已通过。 */
  _upgradeSession(sess) {
    if (!sess || sess.pending) return sess;
    const n = Math.min(sess.index || 0, sess.batchIds.length);
    sess.passed = sess.batchIds.slice(0, n);
    sess.pending = sess.batchIds.slice(n);
    sess.index = 0;
    return sess;
  },

  /* ============ 刷题模式 ============ */

  refresh() {
    const cards = store.getCards();
    const favs = store.getStats().favoriteCardIds;
    const deckName = this.data.currentDeck;
    let sess = this.data.session;
    if (sess && sess.batchIds && sess.batchIds.length) this._upgradeSession(sess); // 兼容旧结构

    // —— 无进行中队列：按「今日配额」新建本轮批次 ——
    // 到期复习与新卡**分成两个独立队列**，各自吃自己的配额。
    // 合成一个池（旧逻辑 `due ∪ new` 再 slice）会让排在数组前面的到期卡占满
    // 全部名额、把新卡整批挤掉——实测 900 题每天 1 轮时首轮需 127 天（理论 30 天）。
    if (!sess || !sess.pending || sess.pending.length === 0) {
      const inDeck = cards.filter(function (c) {
        return (c.deck || DEFAULT_DECK) === deckName;
      });
      const stage = this.data.selectedStage || 'all';
      const filtered = stage === 'all'
        ? inDeck
        : inDeck.filter(function (c) { return c.stage === stage; });
      const now = Date.now();

      // 取卡逻辑统一委托 store.pickQueue（到期与新卡分池、各吃各的配额）。
      // 不在此处重写一遍：算法要是抄两份，回归就只能守住其中一份。
      const pickedRes = store.pickQueue(filtered, {
        free: !!this.data.freeMode,
        limit: this.data.sessionLimit,
        now: now
      });
      const ids = pickedRes.ids;
      sess = {
        deck: deckName,
        limit: this.data.sessionLimit || 0,
        total: ids.length,
        batchIds: ids,
        passed: [],   // 已通过（评过良好/简单）的卡
        pending: ids.slice(), // 尚未通过、待做的卡；队首 = 当前卡
        updatedAt: Date.now()
      };
      this.setData({ session: sess });
      this._persistSession(sess);
    }

    // —— 按 pending 队列渲染：未通过的卡重做到队尾后会再次出现在队首之前 ——
    const byId = {};
    cards.forEach(function (c) { byId[c.id] = c; });
    // 剔除已被删除的卡（题库 replace 后），避免 pending 永久卡死
    const validPending = sess.pending.filter(function (id) { return !!byId[id]; });
    if (validPending.length !== sess.pending.length) {
      sess.pending = validPending;
      this._persistSession(sess);
    }
    const activeDeck = validPending.map(function (id) { return byId[id]; });

    // 当前卡 = 队首
    const head = activeDeck[0] || null;
    const headHasOptions = !!(head && head.options && head.options.length);
    const headAnswer = head && head.correctAnswer && String(head.correctAnswer).trim();
    const current = head ? Object.assign({}, head, {
      hasOptions: headHasOptions,
      // 选择题缺正确答案：correctLetters 置空（不再默认按 A 判分），背面警示；按问答卡方式点背面自评
      missingAnswer: headHasOptions && !headAnswer,
      correctLetters: headAnswer ? parseCorrectLetters(head.correctAnswer) : [],
      isMulti: headAnswer ? parseCorrectLetters(head.correctAnswer).length > 1 : false,
      correctAnswerUpper: headAnswer ? String(head.correctAnswer).trim().toUpperCase() : ''
    }) : null;
    if (current) current.correctCount = current.correctLetters.length;

    // 小字必须与实际排期用同一个间隔上限，否则「显示 365 天 / 实际排 90 天」。
    // 上限解析统一走 sm2.resolveMaxDays，不在页面里自己夹取（那是第二套口径）。
    const intervalCap = sm2.resolveMaxDays(store.getSettings().maxIntervalDays);
    const ratings = current ? ['again', 'hard', 'good', 'easy'].map(function (k) {
      const hint = sm2.formatIntervalLabel(current, k, intervalCap);
      const cfg = {
        again: { label: '重来', bg: '#fee2e2', fg: '#7f1d1d', bd: '#fecaca' },
        hard:  { label: '困难', bg: '#fef3c7', fg: '#78350f', bd: '#fde68a' },
        good:  { label: '良好', bg: '#dbeafe', fg: '#1e3a8a', bd: '#bfdbfe' },
        easy:  { label: '简单', bg: '#d1fae5', fg: '#064e3b', bd: '#a7f3d0' }
      }[k];
      return { key: k, label: cfg.label, hint: hint, bg: cfg.bg, fg: cfg.fg, bd: cfg.bd };
    }) : [];

    // 题号映射：优先用导入时提取的原始题号（qNo）；旧卡缺失时按题集内存储顺序编号 1..n
    const noMap = {};
    let seq = 0;
    cards.forEach(function (c) {
      if ((c.deck || DEFAULT_DECK) !== deckName) return;
      seq += 1;
      noMap[c.id] = c.qNo || seq;
    });

    // 今日剩余（受配额限制）与库中积压（不受限制）——空态文案据此区分
    // 「今日配额做完了」和「这个题集真的没卡可做了」。
    const task = store.getTodayTask(deckName);

    this.setData({
      deck: activeDeck,
      index: 0,
      current: current,
      flipped: false,
      flipping: false,
      flipTarget: '',
      selectedOption: '',
      selectedOptions: [],
      selectedPrefix: '',
      isSubmitted: false,
      judgeResult: null,
      optionList: buildOptionList(current ? current.options : [], [], false, current ? current.correctLetters : ['A']),
      completed: activeDeck.length === 0,
      todayLeft: task.total,
      todayBacklog: task.dueAvail + task.newAvail,
      ratings: ratings,
      isFav: current ? favs.indexOf(current.id) >= 0 : false,
      qNoText: current && noMap[current.id] ? '第 ' + noMap[current.id] + ' 张' : '',
      frontNodes: current ? rich.toNodes(current.front) : [],
      backNodes: current ? rich.toNodes(current.back) : [],
      backLinks: current ? rich.extractLinks(current.back) : [],
      cardImages: current ? (current.localImages || []) : []
    });
  },

  /* 选择选项：仅选中高亮（单选可换选，多选可增删），点「提交」才判分 */
  onSelectOption(e) {
    if (this.data.isSubmitted || !this.data.current) return;
    const cur = this.data.current;
    const correct = cur.correctLetters || ['A'];
    const prefix = e.currentTarget.dataset.prefix;
    if (!prefix) return;
    let sel = (this.data.selectedOptions || []).slice();
    if (cur.isMulti) {
      const i = sel.indexOf(prefix);
      if (i >= 0) sel.splice(i, 1); else sel.push(prefix);
    } else {
      sel = [prefix];
    }
    store.haptic();
    this.setData({
      selectedOptions: sel,
      selectedOption: sel[sel.length - 1] || '',
      optionList: buildOptionList(cur.options, sel, false, correct)
    });
  },

  /* 提交答案：判分 → 对错反馈横幅 + ✓/✗ 标记 → 立即翻面看解析 */
  onSubmitAnswer() {
    const cur = this.data.current;
    const sel = this.data.selectedOptions || [];
    if (!cur || !sel.length || this.data.isSubmitted) return;
    // 安全闸：选择题未识别到正确答案时禁止判分（避免旧版默认按 A 判分造成误导）
    const correct = cur.correctLetters || [];
    if (!correct.length) {
      wx.showToast({ title: '这张卡未识别到正确答案，请点卡片翻面查看解析后自评', icon: 'none' });
      return;
    }
    const isRight = sameSet(sel, correct);
    if (isRight) {
      const stats = store.getStats();
      if (stats.wrongCardIds.indexOf(cur.id) >= 0) store.removeWrong(cur.id);
    } else {
      store.recordWrong(cur.id);
    }
    this.setData({
      isSubmitted: true,
      selectedPrefix: sel.slice().sort().join(''),
      judgeResult: {
        right: isRight,
        text: isRight ? '回答正确' : '回答错误，正确答案 ' + (cur.correctAnswer || correct.join(''))
      },
      optionList: buildOptionList(cur.options, sel, true, correct)
    });
    // 立即翻面查看解析，评分按钮随之出现
    this.onFlip();
  },

  /**
   * 点击卡片主体（收口翻转入口）：
   * - 背面：锁定，不允许点击翻回——必须点下方评分按钮（重来/困难/良好/简单）才能进入下一题
   * - 正面·有选项（单选/多选）：不允许点击翻面——必须选答案后点「提交」
   * - 正面·无选项（问答/填空）：点击翻到背面看解析
   */
  onTapCard() {
    if (!this.data.current || this.data.flipping) return;
    if (this.data.flipped) return; // 背面锁定：评分才能前进
    const cur = this.data.current;
    const hasOptions = cur.options && cur.options.length > 0;
    // 正常选择题（有正确答案）：提交才翻面；问答卡 / 缺答案选择题：点正面看背面
    if (hasOptions && cur.correctLetters && cur.correctLetters.length) return;
    this.onFlip();
  },

  onFlip() {
    if (!this.data.current || this.data.flipping) return;
    // 用户首次交互后，操作提示永久隐藏
    if (this.data.showFlipHint) {
      try { wx.setStorageSync(KEY_FLIP_HINT, 1); } catch (e) {}
      this.setData({ showFlipHint: false });
    }
    const next = !this.data.flipped;
    // 阶段 1：仅动画期间启用 3D 合成层
    this.setData({
      flipping: true,
      flipTarget: next ? 'flip-to-back' : 'flip-to-front'
    });
    store.haptic();
    // 阶段 2：动画结束后降级回 2D，改用 opacity 定面，确保文字清晰
    if (this._flipTimer) clearTimeout(this._flipTimer);
    this._flipTimer = setTimeout(() => {
      this.setData({ flipping: false, flipped: next, flipTarget: '' });
      this._flipTimer = null;
    }, 500);
  },

  onUnload() {
    if (this._flipTimer) {
      clearTimeout(this._flipTimer);
      this._flipTimer = null;
    }
    // 页面销毁前兜底落库会话 + 结算学习时长
    if (this.data.mode === 'study' && this.data.session) {
      this._touchSession();
      this._flushStudySec();
    }
  },

  onRate(e) {
    if (!this.data.current) return;
    const rating = e.currentTarget.dataset.rating;
    const cur = this.data.current;

    // 今日配额计数。判定依据是「该卡的 lastReviewed 是否落在今天之内」——
    // 同一张卡因「重来」被反复重做时只消耗 1 个额度，跨天才会再计一次。
    if (!this.data.freeMode) {
      const dayStart = new Date();
      dayStart.setHours(0, 0, 0, 0);
      const countedToday = cur.lastReviewed && cur.lastReviewed >= dayStart.getTime();
      if (!countedToday) store.bumpDailyCount(cur.state === 'new' ? 'new' : 'due');
    }

    // 记忆保留埋点：良好/简单 = 本次复习记住（保留成功），重来/困难 = 未记住
    store.recordStudy(0, rating === 'good' || rating === 'easy');
    const updates = scheduler.applyReview(cur, rating);
    const updated = Object.assign({}, this.data.current, updates);
    store.updateCard(updated);
    store.incrementReviewed(1);
    store.haptic();

    // —— 通过闸门：仅「良好(good)/简单(easy)」= 通过出队；「重来(again)/困难(hard)」= 未通过，放回队尾重做，
    //    直到该卡被评到「良好」及以上才真正过关（反复刷到确认记住为止） ——
    const sess = this.data.session;
    if (sess && sess.pending && sess.pending.length) {
      const curId = sess.pending[0];
      if (rating === 'good' || rating === 'easy') {
        sess.passed = sess.passed || [];
        sess.passed.push(curId);                 // 该卡本轮通过，出队
        sess.pending.shift();
      } else {
        sess.pending.push(sess.pending.shift()); // 重来/困难：移出队首 → 追加队尾，稍后再次出现重做
      }
      sess.updatedAt = Date.now();
      this._persistSession(sess);
      if (sess.pending.length === 0) {
        // 全部通过（每张均评过良好/简单）：本轮完成（此后返回列表时清除会话）
        // 顺带算出「本題集今日还剩多少张」——完成页据此提示继续 or 加练
        const left = store.getTodayTask(this.data.currentDeck);
        this.setData({ completed: true, todayLeft: left.total });
        return;
      }
    }
    this.refresh();
  },

  /* ============ 卡片补图：相册选图/拍照 → 复制到用户数据目录，永久挂到卡片 ============ */

  _ensureImgDir(fsm) {
    const dir = wx.env.USER_DATA_PATH + '/cardimgs';
    try { fsm.accessSync(dir); } catch (e) {
      try { fsm.mkdirSync(dir, true); } catch (e2) { /* ignore */ }
    }
    return dir;
  },

  _findCard(id) {
    const cards = store.getCards();
    for (let i = 0; i < cards.length; i++) {
      if (cards[i].id === id) return cards[i];
    }
    return null;
  },

  _saveCardImages(id, list) {
    const orig = this._findCard(id);
    if (!orig) return false;
    store.updateCard(Object.assign({}, orig, { localImages: list }));
    this.setData({ 'current.localImages': list, cardImages: list });
    return true;
  },

  onAddImage() {
    const cur = this.data.current;
    if (!cur) return;
    wx.chooseMedia({
      count: 9,
      mediaType: ['image'],
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        if (!res.tempFiles || !res.tempFiles.length) return;
        const fsm = wx.getFileSystemManager();
        const dir = this._ensureImgDir(fsm);
        const list = (cur.localImages || []).slice();
        let added = 0;
        res.tempFiles.forEach((f, i) => {
          const m = String(f.tempFilePath).match(/\.(\w+)(\?|$)/);
          const dest = dir + '/' + cur.id + '-' + Date.now() + '-' + i + '.' + (m ? m[1] : 'jpg');
          try {
            fsm.copyFileSync(f.tempFilePath, dest);
            list.push(dest);
            added++;
          } catch (e) { /* 单张失败不阻断其余 */ }
        });
        if (!added) {
          wx.showToast({ title: '图片保存失败', icon: 'none' });
          return;
        }
        this._saveCardImages(cur.id, list);
        wx.showToast({ title: '已补 ' + added + ' 张图', icon: 'success' });
      }
    });
  },

  onPreviewImage(e) {
    const url = e.currentTarget.dataset.url;
    if (!url || !this.data.cardImages.length) return;
    wx.previewImage({ current: url, urls: this.data.cardImages });
  },

  onDeleteImage(e) {
    const url = e.currentTarget.dataset.url;
    const cur = this.data.current;
    if (!url || !cur) return;
    wx.showModal({
      title: '删除这张补图？',
      content: '仅从卡片移除，不影响牌组其它内容。',
      confirmText: '删除',
      confirmColor: '#b91c1c',
      success: (res) => {
        if (!res.confirm) return;
        const list = (cur.localImages || []).filter((p) => p !== url);
        try { wx.getFileSystemManager().unlinkSync(url); } catch (e) { /* ignore */ }
        this._saveCardImages(cur.id, list);
      }
    });
  },

  /* 公众号原文详解：复制链接 → 引导去微信打开（个人主体无 web-view，采用复制通道） */
  onOpenArticle(e) {
    const url = e.currentTarget.dataset.url;
    if (!url) return;
    wx.setClipboardData({
      data: url,
      success: () => {
        wx.showModal({
          title: '链接已复制',
          content: '请打开微信聊天（如「文件传输助手」），粘贴并发送这条链接，点开即可阅读公众号原文。',
          showCancel: false,
          confirmText: '知道了'
        });
      }
    });
  },

  onToggleFav() {
    if (!this.data.current) return;
    const stats = store.toggleFavorite(this.data.current.id);
    this.setData({ isFav: stats.favoriteCardIds.indexOf(this.data.current.id) >= 0 });
  },

  restart() {
    // 再过一遍：整批重置为未通过，重学同一批（含此前通过的全部卡片）
    const sess = this.data.session;
    if (sess && sess.batchIds && sess.batchIds.length) {
      sess.passed = [];
      sess.pending = sess.batchIds.slice();
      sess.updatedAt = Date.now();
      this._persistSession(sess);
    }
    this.setData({ index: 0, completed: false, flipped: false });
    this.refresh();
  },

  /* 完成页「继续今日任务」：丢弃已完成会话，按剩余额度开新一批（配额仍生效） */
  continueToday() {
    if (this.data.currentDeck) this._dropSession(this.data.currentDeck);
    store.haptic();
    this.setData({ session: null, completed: false, todayLeft: 0 });
    this.refresh();
  },

  /* 完成页「额外加练」：忽略每日配额，把该题集剩下的卡继续刷。
     加练不计入今日配额消耗（onRate 里 freeMode 时跳过计数），
     因此回到正常模式后配额不会被这一轮吃掉。 */
  extraPractice() {
    if (this.data.currentDeck) this._dropSession(this.data.currentDeck);
    store.haptic();
    this.setData({ session: null, completed: false, freeMode: true, todayLeft: 0 });
    this.refresh();
  }
});
