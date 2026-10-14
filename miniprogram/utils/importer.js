/**
 * 题库导入：Anki 导出 TXT / JSON（内部备份用）
 * Anki 桌面端「文件 → 导出 → 笔记纯文本(*.txt)」产物为 Tab 分隔文本，
 * 字段可含 HTML 与 {{cN::}} 挖空。原 .apkg（zip+SQLite）无法在小程序沙箱解析，
 * 配套使用根目录 scripts/apkg2txt.mjs 在电脑端将 .apkg 转为 TXT 后由此通道导入。
 * 阶段自动识别逻辑与 src/utils/ankiParser.ts 保持一致。
 */

function detectDmaicStage(text, tags) {
  var combined = (String(text || '') + ' ' + (tags || []).join(' ')).toLowerCase();

  if (/dfma|dfss|dfmac|设计/.test(combined)) return 'dfss';
  if (/smed|精益|lean|vsm|看板|5s|防错/.test(combined)) return 'lean';
  if (/spc|控制图|控制|control|sop|判异/.test(combined)) return 'control';
  if (/doe|改进|improve|试验设计|响应曲面|全因子/.test(combined)) return 'improve';
  if (/检验|分析|analyze|anova|方差分析|回归|p-value|p值|t检验/.test(combined)) return 'analyze';
  if (/msa|测量|measure|grr|cpk|ppk|过程能力|量具/.test(combined)) return 'measure';
  if (/界定|define|charter|voc|kpov|kpiv|sipoc|立项/.test(combined)) return 'define';
  return 'overview';
}

/**
 * Anki「导出→笔记纯文本」按 CSV 引用规则（QUOTE_MINIMAL）输出：
 * 字段若含换行 / Tab / 引号，则整段被双引号包裹，字段内部引号转义为 ""。
 * 此函数剥掉整段首尾的包裹引号，并把内部 "" 还原为 "；未包裹的普通字段原样返回。
 */
function unquoteField(s) {
  var t = String(s == null ? '' : s);
  if (t.length >= 2 && t.charAt(0) === '"' && t.charAt(t.length - 1) === '"') {
    t = t.slice(1, -1).replace(/""/g, '"');
  }
  return t;
}

/**
 * 清理 Anki 剪贴板截图插件的本地占位标记（如「@image#1:Clipboard_Screenshot.png」）。
 * 这类标记以纯文本形式存在于字段中，指向 collection.media 本地文件，
 * 离开电脑无法显示，直接移除（与 <img src="paste-*.png"> 同策略）。
 */
function stripLocalImages(s) {
  return String(s || '').replace(/@image#\d+:\s*\S*/gi, '').trim();
}

/**
 * 同形字母纠正：Word/题库文档常混入与拉丁字母同形的希腊/西里尔字符
 * （如选项「Β. 3200」的 Β 为希腊 Beta U+0392），不纠正会导致
 * 选项标签匹配（[A-F]）与答案字母提取失败。仅替换 A-H 形态位，不影响中文。
 */
var LOOKALIKE_MAP = {
  'Α': 'A', 'Β': 'B', 'Ε': 'E', 'Ζ': 'Z', 'Η': 'H', 'Κ': 'K',
  'Μ': 'M', 'Ν': 'N', 'Ο': 'O', 'Ρ': 'P', 'Τ': 'T', 'Υ': 'Y', 'Χ': 'X',
  'А': 'A', 'В': 'B', 'С': 'C', 'Е': 'E', 'Н': 'H', 'К': 'K',
  'М': 'M', 'О': 'O', 'Р': 'P', 'Т': 'T', 'Х': 'X'
};
function normalizeLatin(s) {
  return String(s || '').replace(/[ΑΒΕΖΗΚΜΝΟΡΤΥΧАВСЕНКОРТХ]/g, function (c) {
    return LOOKALIKE_MAP[c] || c;
  });
}

function cleanHtml(raw) {
  if (!raw) return '';
  return String(raw)
    // 移除 Anki 资源/样式/脚本块与音频标记
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    // 本地截图占位标记（@image#1:xxx.png）→ 直接移除
    .replace(/@image#\d+:\s*\S*/gi, '')
    // 图片策略：保留可公网访问的网络图（rich-text 可渲染，域名须加 downloadFile 白名单）；
    // 剥除本地媒体引用（Anki collection.media 文件名如 <img src="image.png">，离开电脑无法显示）
    .replace(/<img[^>]*>/gi, function (m) {
      var ms = m.match(/\bsrc\s*=\s*["']([^"']+)["']/i);
      return ms && /^https?:\/\//i.test(ms[1]) ? m : '';
    })
    .replace(/\[sound:[^\]]*\]/gi, '')
    // 挖空 {{c1::答案::额外}} → 高亮
    .replace(/\{\{c\d+::(.*?)(?:::.*?)?\}\}/g, '<span style="background:#fef3c7;color:#78350f;padding:0 6rpx;border-radius:6rpx;">$1</span>')
    .replace(/&nbsp;/g, ' ')
    .replace(/<br\s*\/?>\s*<br\s*\/?>/gi, '<br/>')
    .trim();
}

/**
 * 判断某列是否为「标签列」（Anki 导出勾选 Tags 时追加在行尾，空格分隔）。
 * 启发式：非富文本、无中文标点、token 短小（≤24字符）且总长度 ≤120 才视为标签；
 * 单 token 需为层级标签（含 ::）或 #/字母数字点线加号。
 */
function looksLikeTags(col) {
  if (!col || typeof col !== 'string') return false;
  var t = col.trim();
  if (!t || /[<>]/.test(t)) return false;
  if (/[，。、；：？！“”‘’《》【】（）…—·]/.test(t)) return false;
  if (t.length > 120) return false;
  var tokens = t.split(/\s+/);
  if (tokens.length === 1) {
    return /::/.test(t) || /^#?[\w.+-]+$/.test(t);
  }
  for (var i = 0; i < tokens.length; i++) {
    if (tokens[i].length > 24) return false;
  }
  return true;
}

/** 剥除 HTML 标签与实体，块级标签（开/闭）转换行；返回干净多行纯文本 */
function htmlToText(raw) {
  return String(raw || '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    // 本地截图占位标记（@image#1:xxx.png）→ 直接移除
    .replace(/@image#\d+:\s*\S*/gi, '')
    // 块级标签无论开闭都先独立成行，保证 div 边界处换行（题干与选项首行不粘连）
    .replace(/(<\/?(?:div|p|li|tr|h[1-6]|ul|ol|section|blockquote|table)[^>]*>)/gi, '\n$1')
    // 网络图片在纯文本题干中不可渲染 → 转「[图]」占位，提示此处有图（解析/背面 HTML 仍保留原图）
    .replace(/<img[^>]*>/gi, function (m) {
      var ms = m.match(/\bsrc\s*=\s*["']([^"']+)["']/i);
      return ms && /^https?:\/\//i.test(ms[1]) ? '\n[图]\n' : '';
    })
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<hr[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\r/g, '')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/** 清理题干前缀：去掉「(单选) 3. / 3. / （多选题）8. / 第 1 题： / 第 108 题」等题型标注与题号 */
function stripQuestionPrefix(s) {
  return String(s || '')
    .replace(/^[\s"'“”‘’]+/, '')
    .replace(/^\s*(?:[（(]\s*(?:不定项选择题?|单项选择题?|多项选择题?|选择题?|单选题|多选题|判断题?|单选|多选|不定项)\s*[）)]\s*)?(?:第\s*\d{1,4}\s*题\s*[：:.,．、]?\s*)?(?:\d{1,4}\s*[.、．]\s*)?/, '')
    .trim();
}

/**
 * 题干杂散清理：只剥行首/行尾的杂散引号与空白，保留「(单选)」题型标注与题号
 * （2026-09 需求：题干显示保留 单选/多选 标注；题号另有「第 N 题」徽标与原始题号 qNo）
 */
function trimFrontJunk(s) {
  return String(s || '')
    .replace(/^[\s"'“”‘’]+/, '')
    .replace(/[\s"'“”‘’]+$/, '')
    .trim();
}

/** 选项文本清理：A. 正文，去掉包裹/残留符号 */
function cleanOptionBody(s) {
  return String(s || '')
    .replace(/^[.、．:：\s]+/, '')
    .replace(/[）)\]】>]+$/, '')
    .trim();
}

/**
 * 从题干（或含题干+选项的整段文本）中提取 ABCDEF 选项。
 * 输入可为纯文本或 HTML（Anki「#html:true」导出）：HTML 先转纯文本行。
 * 模式一（多行块）：连续行以「A. / B、」等标签开头；一旦选项块开始，
 *   遇到首个非选项内容行即停止（防止把解析段里的「选项分析」重复收进来）。
 * 模式二（单行内联）：「A. xx B. xx」同行排布。
 * 返回的 question / options 均为剥净标签的纯文本。
 */
function extractChoiceOptions(text) {
  var isHtml = /<\/?[a-z][^>]*>/i.test(String(text || ''));
  var src = normalizeLatin(isHtml ? htmlToText(text) : stripLocalImages(String(text || '')));
  // 多行块模式
  var lines = src.split(/\r?\n/);
  var opts = [];
  var blockStarted = false;
  var firstIdx = -1;
  var pos = 0;
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var m = line.match(/^\s*([A-F])\s*[.、．,，:：]\s*(.+)$/);
    if (m) {
      blockStarted = true;
      if (firstIdx < 0) firstIdx = pos + line.indexOf(m[1]);
      opts.push(m[1] + '. ' + cleanOptionBody(m[2]));
    } else if (blockStarted) {
      if (line.trim()) break; // 选项块结束：其后是解析/答案正文
    }
    pos += line.length + 1;
  }
  if (opts.length >= 2) {
    opts.sort(function (a, b) { return a.charAt(0) < b.charAt(0) ? -1 : 1; }); // 源文档乱序（A/C/B/D）→ 按字母归位
    var q1 = trimFrontJunk(src.slice(0, firstIdx));
    return { question: q1 || trimFrontJunk(src), options: opts };
  }
  // 单行内联模式（题干与选项同行，如纯文本「A. xx B. xx」）
  opts = [];
  var re = /([A-F])[.、．:：]/g;
  var m2;
  while ((m2 = re.exec(src)) !== null) {
    var prev = m2.index > 0 ? src.charAt(m2.index - 1) : '\n';
    if (/[A-Za-z0-9]/.test(prev)) continue;
    opts.push({ idx: m2.index, label: m2[1] });
  }
  if (opts.length >= 2) {
    var out = [];
    for (var j = 0; j < opts.length; j++) {
      var start = opts[j].idx;
      var end = j + 1 < opts.length ? opts[j + 1].idx : src.length;
      var body = src.slice(start + 1, end).replace(/^[.、．:：]\s*/, '').trim();
      out.push(opts[j].label + '. ' + cleanOptionBody(body));
    }
    out.sort(function (a, b) { return a.charAt(0) < b.charAt(0) ? -1 : 1; });
    var q2 = trimFrontJunk(src.slice(0, opts[0].idx));
    return { question: q2 || trimFrontJunk(src), options: out };
  }
  return { question: trimFrontJunk(src) };
}

/** 归一化答案字母串：A-F 内去重保序；含越界字符/超长返回 '' */
function normLetters(seg) {
  var letters = String(seg || '').match(/[A-Fa-f]/g) || [];
  if (!letters.length || letters.length > 6) return '';
  var seen = {}, out = [];
  for (var i = 0; i < letters.length; i++) {
    var u = letters[i].toUpperCase();
    if ('ABCDEF'.indexOf(u) < 0) return '';
    if (!seen[u]) { seen[u] = 1; out.push(u); }
  }
  return out.join('');
}

/**
 * 从背面/解析文本中提取正确答案（如「正确答案：ABD」「答案为 C」「Answer: B」）。
 * 返回去重保序的大写字母串（如 'ABD'）；未找到返回 ''。
 * 覆盖三类常见真题格式：
 *   ① 带关键词：「答案：B」「【答案】B」「正确答案为 B」「答案 (B)」「答案解析：选 B」
 *   ② 关键词后跟长解析，答案夹在句首（如「答案解析：B。因为…」）
 *   ③ 背面短行本身就是裸答案：「B」「(ABD)」「C、」「D」
 */
function extractCorrectAnswer(back, front) {
  var backText = normalizeLatin(String(back || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' '));
  var plain = backText + ' ' + normalizeLatin(String(front || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' '));
  // —— ① 带关键词（兼容【】/（）包裹与“选/选择/为是”衔接）——
  var kw = plain.match(/(?:正确答案|参考答案|标准答案|答案|应选|正确选项|Answer)/i);
  if (kw) {
    var after = plain.slice(kw.index + kw[0].length);
    // a) 关键词后直接跟“答案语段”：吃掉间隔/标点/“选”/左包裹符后抓字母串。
    //    三级尝试（防止把后文英文单词首字母并入，如「答案: B DPMO=...」误判为 BD）：
    //    连写串 ABD → 顿号列表 A、B、D → 单字母 B（后随非字母）
    var a = after
      .replace(/^[\s:：，,、为是=]+/, '')
      .replace(/^(?:选|选择)/, '')
      .replace(/^[【\[〔（(】\]〕）)]+/, '');
    var ans = '';
    var mMulti = a.match(/^([A-Fa-f]{2,6})(?![A-Za-z])/);
    var mList = a.match(/^([A-Fa-f](?:[\s,，、.]+[A-Fa-f])+)(?![A-Za-z])/);
    var mSingle = a.match(/^([A-Fa-f])(?![A-Za-z])/);
    if (mMulti) ans = normLetters(mMulti[1]);
    else if (mList) ans = normLetters(mList[1]);
    else if (mSingle) ans = normLetters(mSingle[1]);
    if (ans) return ans;
    // b) 关键词后接整段解析，答案在标点之后的句首（如“答案解析：B。因为…”）
    var m2 = after.match(/[：:，,为是=]\s*(?:选|选择)?\s*[【\[〔（(]?\s*([A-Fa-f])/);
    if (m2) {
      var ans2 = normLetters(m2[1]);
      if (ans2) return ans2;
    }
  }
  // —— ④ 解析段内含“应选/选择 B”等表述（仅对背面扫描，降低题干误判风险）——
  var m4 = backText.match(/(?:应)?选(?:择)?\s*[：:为是（(]?\s*([A-Fa-f])(?![A-Za-z])/);
  if (m4) {
    var ans4 = normLetters(m4[1]);
    if (ans4) return ans4;
  }
  // —— ③ 背面前几行存在“整行=裸答案”的短行（B / (ABD) / C、/ D）——
  var lines = backText.split(/\r?\n/);
  for (var li = 0; li < lines.length && li < 4; li++) {
    var t = lines[li].replace(/&nbsp;/g, ' ').trim();
    if (!t) continue;
    // 去除包裹/点号等外壳后，若整行仅由 A-F 与分隔符组成 → 视为裸答案
    var m3 = t.replace(/[【\[〔（(】\]〕）)>、.．:：\s]+/g, ' ').trim().match(/^([A-Fa-f][A-Fa-f ]*)$/);
    if (m3) {
      var ans3 = normLetters(m3[1]);
      if (ans3) return ans3;
    }
  }
  return '';
}

/** 提取原始题号：题干开头的「(单选) 3. / 27. / （多选题）8.」中的数字；无则返回 0 */
function extractQuestionNo(frontText) {
  var m = String(frontText || '')
    .replace(/^\s*[「"'\s]+/, '')
    .match(/^\s*[（(]?\s*(?:不定项选择题?|单项选择题?|多项选择题?|选择题?|单选题|多选题|判断题?|单选|多选|不定项)?\s*[）)]?\s*(\d{1,4})\s*[.、．]/);
  return m ? parseInt(m[1], 10) : 0;
}

/**
 * 截取背面中「答案」关键词之前的部分：多字段模板里选项列位于答案之前，
 * 答案之后的 A:/B: 段是解析评注（「A:错误，数值计算不匹配」）而非选项，
 * 提取选项时必须截掉，否则会把评注误抓为选项。
 */
function cutBackAtAnswer(s) {
  var t = String(s || '');
  var m = t.match(/【?\s*答案\s*】?|正确答案|参考答案|Answer/i);
  return m && m.index > 0 ? t.slice(0, m.index) : (m ? '' : t);
}

/** 选项正文是否为解析评注（「错误，数值…」句式），而非真实选项 */
function isCommentOption(opt) {
  var body = String(opt || '').replace(/^[A-Fa-f]\s*[.、．:：]\s*/, '');
  return /^(?:错误|正确|不对|不正确|都不是|以上都)[，,。：:]/.test(body);
}

function makeCard(front, back, tags, index) {
  var rawFront = cleanHtml(unquoteField(front));
  var rawBack = cleanHtml(unquoteField(back));
  var rawTags = (tags && tags.length) ? tags : ['导入'];
  var qNo = extractQuestionNo(htmlToText(rawFront));
  // 标签列约定（Anki TXT 导出产物）：qNo:N → 还原为卡片的题号字段
  //   例：「qNo:27 type:single_choice stage:control」
  // 优先级：正面题干前缀 > 标签列 > 0（避免「同题重复导出」时 qNo 丢失）
  var qNoFromTag = 0;
  for (var ti = 0; ti < rawTags.length; ti++) {
    var tm = String(rawTags[ti] || '').match(/^qNo:(\d{1,5})$/);
    if (tm) { qNoFromTag = parseInt(tm[1], 10); break; }
  }
  if (!qNo && qNoFromTag) qNo = qNoFromTag;
  // 先从正面列提选项；正面为纯题干（选项/答案/解析独立成列的 Anki 多字段模板）
  // 时提不到，则回退到背面区域找选项块
  var picked = extractChoiceOptions(rawFront);
  var hasOptions = picked.options && picked.options.length > 0;
  var question = picked.question || '';
  if (!hasOptions) {
    // 背面回退只在「答案」关键词之前找选项（其后 A:/B: 是解析评注，不是选项）
    var picked2 = extractChoiceOptions(cutBackAtAnswer(rawBack));
    if (picked2.options && picked2.options.length > 0) {
      picked = picked2;
      hasOptions = true;
      if (!question) question = picked2.question || '';
    }
  }
  if (!question) question = picked.question || '';
  var stage = detectDmaicStage(rawFront + ' ' + rawBack, rawTags);
  var correct = hasOptions ? extractCorrectAnswer(rawBack, question) : '';
  return {
    id: 'import-' + Date.now() + '-' + index + '-' + Math.random().toString(36).slice(2, 6),
    front: question || htmlToText(rawFront),
    back: rawBack,
    qNo: qNo || undefined,
    options: hasOptions ? picked.options : undefined,
    correctAnswer: correct || undefined,
    stage: stage,
    tags: rawTags,
    cardType: hasOptions ? (correct.length > 1 ? 'multiple_choice' : 'single_choice') : 'flashcard',
    interval: 0,
    repetitions: 0,
    easeFactor: 2.5,
    nextReviewDate: Date.now(),
    state: 'new'
  };
}

/**
 * 解析入口：优先走 CSV 状态机（Anki 官方导出是严格 CSV——引号包裹字段可跨行，
 * 逐行启发式会把「front 字段的续行」误判为上一题背面导致整批错位）；
 * CSV 路径 0 卡或非引号包裹的普通格式时，回退到逐行启发式组装。
 */
function parseText(content) {
  var src = String(content).replace(/^\uFEFF/, ''); // 去 BOM
  var byCsv = parseTextCsv(src);
  if (byCsv.success) return byCsv;
  var byHeur = parseTextHeuristic(src);
  return byHeur;
}

/** 读取 #separator: 文件头 → 分隔符（默认 Tab） */
function detectSeparator(src) {
  var m = src.match(/^#\s*separator\s*:\s*(.+)\s*$/m);
  if (!m) return '\t';
  var v = m[1].toLowerCase();
  if (v === 'tab' || v === '\\t') return '\t';
  if (v === 'comma' || v === ',') return ',';
  if (v === 'semicolon' || v === ';') return ';';
  if (v === 'pipe' || v === '|') return '|';
  if (v === 'space') return ' ';
  return '\t';
}

/**
 * CSV 状态机解析：双引号包裹的字段内可含换行/分隔符，"" 为转义引号。
 * 返回 [{ fields: [...], quoted: 首字段是否引号包裹 }]
 */
function parseCsvRecords(src, sep) {
  var recs = [];
  var cur = [], field = '', inQ = false, firstQuoted = false;
  var i = 0, n = src.length;

  function endRecord() {
    cur.push(field);
    field = '';
    var rec = cur;
    cur = [];
    var hasContent = false;
    for (var k = 0; k < rec.length; k++) {
      if (String(rec[k]).trim()) { hasContent = true; break; }
    }
    if (hasContent && !(firstQuoted === false && /^\s*#/.test(String(rec[0])))) {
      recs.push({ fields: rec, quoted: firstQuoted });
    }
    firstQuoted = false;
  }

  while (i < n) {
    var ch = src.charAt(i);
    if (inQ) {
      if (ch === '"') {
        if (src.charAt(i + 1) === '"') { field += '"'; i += 2; continue; } // "" → 字面引号
        inQ = false; i++; continue;                                        // 闭引号
      }
      field += ch; i++; continue; // 引号内换行/分隔符均属字段内容
    }
    if (ch === '"') {
      if (field === '' && cur.length === 0) firstQuoted = true;
      inQ = true; i++; continue;
    }
    if (ch === sep) { cur.push(field); field = ''; i++; continue; }
    if (ch === '\r') { i++; continue; }
    if (ch === '\n') { endRecord(); i++; continue; }
    field += ch; i++;
  }
  if (field !== '' || cur.length) endRecord();
  return recs;
}

/** 由已解包的 CSV 字段数组构建卡片；字段不足/无有效内容返回 false 计入跳过 */
function buildCardFromFields(fields, cards) {
  if (!fields || fields.length < 2) return false;
  var front = String(fields[0]).trim();
  var backParts = fields.slice(1);
  var tags = [];
  var last = String(backParts[backParts.length - 1]).trim();
  if (backParts.length > 1 && looksLikeTags(last)) {
    tags = last.split(/\s+/).filter(Boolean);
    backParts.pop();
  }
  var back = backParts.map(function (s) { return String(s).trim(); }).join('<br/>');
  if (!front || !back) return false;
  cards.push(makeCard(front, back, tags, cards.length));
  return true;
}

/** CSV 路径：仅当多数记录为引号包裹格式时才采信（纯文本无引号导出走启发式） */
function parseTextCsv(src) {
  try {
    var sep = detectSeparator(src);
    var recs = parseCsvRecords(src, sep);
    if (!recs.length) return { success: false };
    var quotedCount = 0;
    for (var i = 0; i < recs.length; i++) { if (recs[i].quoted) quotedCount++; }
    if (quotedCount < recs.length / 2) return { success: false }; // 非引号包裹格式 → 交给启发式

    var cards = [], skipped = 0;
    for (var j = 0; j < recs.length; j++) {
      if (!buildCardFromFields(recs[j].fields, cards)) skipped++;
    }
    if (!cards.length) return { success: false };
    return {
      success: true, totalParsed: cards.length, cards: cards,
      message: '成功解析 ' + cards.length + ' 张 Anki 卡片' + (skipped ? '（跳过 ' + skipped + ' 行）' : '')
    };
  } catch (e) {
    return { success: false };
  }
}

/**
 * 启发式回退路径：纯文本（无引号包裹）导出的逐行组装。
 * 格式：每条笔记一行，字段以 Tab 分隔；字段为原始 HTML。
 * 若勾选「包含标签」，行尾追加一列空格分隔的标签。
 * 兼容三列手写格式：正面[TAB]背面[TAB]标签（空格分隔）。
 *
 * 记录组装采用「Tab 行锚点 + 续行归属启发式」，兼容两类易碎布局：
 *   ① 纯文本题面跨物理行：题干与选项行（无 Tab）在 Tab 行之前，需并入该记录；
 *   ② 富文本字段内换行折行（无 Tab 的背面续行），需并入当前记录而非拆散。
 * 启发式规则：
 *   - 形如「新题开头」（(单选)/题号/含（）/含？）的行 => 结束上一条、开启下一条；
 *   - 形如「上一题背面续文」（解析/答案/【/HTML 标签开头等）=> 并入当前记录；
 *   - 其余无 Tab 行：当前有记录则并入，无记录则缓冲等待 Tab 行；
 *   - 含 Tab 行：非续文时视为新记录锚点（先结算上一条）；续文形态（如
 *     「解析：…\t标签列」折行后仍带 Tab）则并入当前记录整体结算。
 */
function parseTextHeuristic(content) {
  try {
    var src = String(content);
    var rawLines = src.split(/\r?\n/);
    var cards = [];
    var skipped = 0;
    var current = null; // 正在累积的一条记录
    var buf = [];       // 尚无 Tab 归属的前置行（题面折行部分）

    function handleRecord(whole) {
      // 先解 CSV 包裹引号（字段被引号包裹时内部 "" 为转义引号），再做标签判定与字段归并
      var fields = whole.split('\t').map(function (s) { return unquoteField(s.trim()); });
      if (fields.length < 2) { skipped++; return; }
      // 字段归并：front=首列；back=其后若干列（多为 HTML 说明）
      // 若「末列像标签」且非富文本，则从 back 拆出 tags（兼容导出含标签与手写三列）
      var front = fields[0];
      var backParts = fields.slice(1);
      var tags = [];
      var last = backParts[backParts.length - 1];
      if (backParts.length > 1 && looksLikeTags(last)) {
        tags = last.split(/\s+/).filter(Boolean);
        backParts.pop();
      }
      // 多列（如含 Extra 备注字段）用 <br/> 衔接，保留结构供 rich-text 渲染
      var back = backParts.join('<br/>');
      if (!front || !back) { skipped++; return; }
      cards.push(makeCard(front, back, tags, cards.length));
    }

    for (var i = 0; i < rawLines.length; i++) {
      var line = rawLines[i];
      var t = line.trim();
      if (!t) continue;
      if (/^#/.test(t)) continue; // Anki 文件头（#separator / #html 等）

      if (line.indexOf('\t') < 0) {
        // 无 Tab 行
        if (current && looksLikeQuestionStart(t)) {
          handleRecord(current);      // 新题开头：结算上一条
          current = null;
          buf = [line];
        } else if (current && looksLikeBackLine(t)) {
          current += '\n' + line;     // 上一题背面续文（答案/解析等）
        } else if (current) {
          current += '\n' + line;     // HTML 折行等一般续行
        } else {
          buf.push(line);              // 题面折行：先缓冲
        }
        continue;
      }

      // 含 Tab 行：非上一题续文 → 新记录锚点（结算上一条后重开）
      // 续文判定用 looksLikeBackMarker 而非 looksLikeBackLine：后者的「HTML 标签开头」
      // 规则只适用于无 Tab 折行，用在这里会把 front 为 HTML 的每一行都判成续文
      // ⇒ 整份文件塌成一张卡（详见 looksLikeBackLine 注释）
      if (current && !looksLikeBackMarker(t)) {
        handleRecord(current);
        current = null;
      }
      var lead = buf.length ? buf.join('\n') + '\n' + line : line;
      current = current ? current + '\n' + line : lead;
      buf = [];
    }
    if (current) handleRecord(current);          // 结算最后一条
    else if (buf.length) skipped += buf.length;  // 尾部游离行

    if (cards.length === 0) {
      return {
        success: false, totalParsed: 0, cards: [],
        message: '未能提取到有效卡片。请确认是 Anki「导出→笔记纯文本(*.txt)」格式：每行正面与背面用 Tab 制表符分隔' + (skipped ? '（有 ' + skipped + ' 行因字段不足被跳过）' : '。')
      };
    }
    return { success: true, totalParsed: cards.length, cards: cards, message: '成功解析 ' + cards.length + ' 张 Anki 卡片' + (skipped ? '（跳过 ' + skipped + ' 行）' : '') };
  } catch (err) {
    return { success: false, totalParsed: 0, cards: [], message: '解析失败：' + (err.message || '未知格式错误') };
  }
}

/** 行首形似「新题开头」（新记录起点），触发上一条结算 */
function looksLikeQuestionStart(line) {
  var s = String(line || '');
  if (/^\s*[（(]?\s*(?:单选|多选|判断题?|不定项选择?|单项选择?|多项选择?)/.test(s)) return true;
  if (/^\s*\d{1,4}\s*[.、．]\s*\S/.test(s)) return true;
  var head = s.slice(0, 60);
  if (/[（(]\s*[）)]/.test(head)) return true; // 题干空括号（ ）
  if (/[？?]/.test(head)) return true;           // 问句
  return false;
}

/**
 * 行首是**显式的背面文字标记**（解析/答案/【…/因此…）——这类续文无论是否带 Tab
 * 都应并入上一条记录。
 */
function looksLikeBackMarker(line) {
  var s = String(line || '').trim();
  if (!s) return false;
  return /^(?:解析|答案|参考答案|正确答案|【|…|注[：:]|说明[：:]|提示[：:]|考点|分析[：:]|故|因此|所以)/.test(s);
}

/**
 * 无 Tab 行的判定：显式文字标记，或 HTML 标签折行，都算上一题的续文。
 *
 * 🔴 只可用于**无 Tab 行**。含 Tab 行是「一条笔记」的锚点，若也套用 HTML 规则，
 * 则 front 以标签开头的每一行（Anki `#html:true` 导出极常见：`<div>题干…`）
 * 都会被判成上一条的续文 ⇒ **整份文件塌成一张卡**。
 * 实测：4 行 Tab 记录、front 均以 `<div>` 开头 → 解析出 1 张（back 被拼成 255 字符）。
 * 含 Tab 行的续文判定必须走 looksLikeBackMarker。
 */
function looksLikeBackLine(line) {
  var s = String(line || '').trim();
  if (!s) return false;
  return looksLikeBackMarker(s) || /^<[a-z]/.test(s);
}

/** 解析 JSON 数组（导出格式或手工编制） */
function parseJson(content) {
  try {
    var data = JSON.parse(content);
    var list = Array.isArray(data) ? data : (data && Array.isArray(data.cards) ? data.cards : null);
    if (!list) return { success: false, totalParsed: 0, cards: [], message: 'JSON 结构应为卡片数组，或含 cards 字段的对象' };

    var cards = list.map(function (item, i) {
      var base = makeCard(item.front, item.back, item.tags, i);
      var hasOptions = (item.options && item.options.length > 0) || (base.options && base.options.length > 0);
      return {
        id: item.id || base.id,
        // 透传用户数据字段：deck（题集分组）/ qNo（原卷题号）/ localImages（手动补图）
        // 早期版本恢复备份时会丢这三个字段，导致多题集并成一套、题号与补图丢失
        deck: item.deck || undefined,
        qNo: item.qNo || base.qNo || undefined,
        localImages: (item.localImages && item.localImages.length) ? item.localImages : undefined,
        front: item.front !== undefined ? cleanHtml(item.front) : base.front,
        back: item.back !== undefined ? cleanHtml(item.back) : base.back,
        explanation: item.explanation,
        options: item.options || base.options,
        correctAnswer: (item.correctAnswer !== undefined && String(item.correctAnswer).trim())
          ? item.correctAnswer
          : (hasOptions
              ? (extractCorrectAnswer(cleanHtml(item.back || ''), cleanHtml(item.front || '')) || undefined)
              : undefined),
        stage: item.stage || base.stage,
        tags: item.tags || base.tags,
        cardType: item.cardType || (hasOptions ? 'single_choice' : 'flashcard'),
        interval: item.interval || 0,
        repetitions: item.repetitions || 0,
        easeFactor: item.easeFactor || 2.5,
        nextReviewDate: item.nextReviewDate || Date.now(),
        state: item.state || 'new'
      };
    });

    if (cards.length === 0) return { success: false, totalParsed: 0, cards: [], message: 'JSON 中未发现卡片数据' };
    return { success: true, totalParsed: cards.length, cards: cards, message: '成功解析 ' + cards.length + ' 张卡片' };
  } catch (err) {
    return { success: false, totalParsed: 0, cards: [], message: 'JSON 解析失败：' + err.message };
  }
}

/**
 * Anki TXT 导出（与 parseText 对称，分文件 + 丢 SM-2 进度）。
 * 设计原则：
 *   - 按 deck 分文件 → 每个 txt 头写 #deck:xxx，可直接拖入 Anki 桌面端
 *   - 字段内换行/Tab/双引号用 CSV QUOTE_MINIMAL 包裹（与 Anki 桌面端导出一致）
 *   - 丢 SM-2/收藏/错题标记（这些字段无法编码进 TXT，且与「JSON 备份」职责分离）
 *
 * 返回 [{ deck, text, count }]，由 page 端写文件 + 调 shareFileMessage。
 */
function exportAnkiTxt(cards) {
  var groups = {};
  var order = [];
  for (var i = 0; i < cards.length; i++) {
    var c = cards[i] || {};
    var deck = (c.deck && String(c.deck).trim()) || '默认牌组';
    if (!groups[deck]) { groups[deck] = []; order.push(deck); }
    groups[deck].push(c);
  }
  var files = [];
  for (var k = 0; k < order.length; k++) {
    var deck = order[k];
    var lines = [];
    lines.push('#separator:tab');
    lines.push('#html:true');
    lines.push('#deck:' + deck);
    lines.push('#columns:front back tags');
    var arr = groups[deck];
    for (var j = 0; j < arr.length; j++) {
      lines.push(cardToAnkiRow(arr[j]));
    }
    files.push({ deck: deck, text: lines.join('\n') + '\n', count: arr.length });
  }
  return { files: files, total: cards.length };
}

/** CSV QUOTE_MINIMAL：含 tab/换行/CR/双引号的字段才包双引号，内部引号转 "" */
function csvQuote(field) {
  var s = String(field == null ? '' : field);
  if (/[\t\r\n"]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/** 提取选项字母：'A. xxx' → 'A'，用于答案回写到背面 */
function optionLetter(opt) {
  var m = String(opt || '').match(/^\s*([A-Z])\s*[.、．:：]/);
  return m ? m[1] : '';
}

/** 一张卡片 → 一行 Anki TXT */
function cardToAnkiRow(c) {
  // 正面：题干 + 选项（不写题号前缀，避免与原文重复；题号走标签列 qNo:N）
  var frontParts = [];
  frontParts.push(c.front || '');
  if (Array.isArray(c.options) && c.options.length) {
    var optLines = c.options.map(function (o) {
      return String(o).replace(/^([A-Z])\s*[.、．:：]\s*/, '$1. ');
    });
    frontParts.push('\n' + optLines.join('\n'));
  }
  var front = frontParts.join('');

  // 背面：原 back + 答案（若 back 已包含答案则不重复）
  var back = c.back || '';
  if (c.correctAnswer && !backMentionsAnswer(back, c.correctAnswer)) {
    var ans = String(c.correctAnswer).trim();
    back += '\n<hr><b>答案</b>：' + ans;
  }

  // 标签列：qNo:N type:xxx stage:xxx（被 makeCard 的「标签列约定」反向解析回题号）
  var tags = [];
  if (c.qNo) tags.push('qNo:' + c.qNo);
  tags.push('type:' + (c.cardType || 'flashcard'));
  if (c.stage) tags.push('stage:' + c.stage);

  return csvQuote(front) + '\t' + csvQuote(back) + '\t' + tags.join(' ');
}

/** 检测背面是否已含「答案：X」之类的标记，避免重复写 */
function backMentionsAnswer(back, ans) {
  if (!back || !ans) return false;
  var esc = String(ans).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('答案[::\\s]+' + esc).test(back);
}

/* ---------------- 内容指纹：导入去重（2026-09-10） ----------------
 *
 * 背景：导入卡的 id 由 `Date.now() + 随机串` 生成，**不含内容**，
 * 所以同一个文件重新上传一次就是 100% 重复（id 全新 ⇒ 按 id 去重完全失效）。
 * 这里给出「内容指纹」作为第二重判定，供 store.scanDuplicates / importCards 使用。
 */

/**
 * 归一化噪声字符：空白 + 中英文标点。
 * 只用于比对，**不要**拿它覆盖 front —— 它是有损的（题号、标点都会消失）。
 * 刻意**不**包含 `≤ ≥ ± × ÷ √ ≠ ≈ %` 等数学符号，它们承载题意。
 */
var DEDUP_NOISE_RE = /[\s，。、；：？！""''‘’“”《》〈〉【】〔〕（）()\[\]{}<>·．.,;:?!"'`~!@#$%^&*_+=|\\/\-—－…]/g;

/**
 * 题干归一化。收敛同一道题的各种写法：
 * HTML 标签/实体、`@image` 残留、本地媒体、题号与「(单选)」标注、
 * 同形希腊/西里尔字母、全角字母数字、大小写、全部空白与标点。
 */
function dedupNormalize(raw) {
  var s = htmlToText(raw);
  // 先做全角→半角，让「(单选题) 第１题：」这种回忆版写法也能被 stripQuestionPrefix 一次剥干净
  s = s.replace(/[\uff01-\uff5e]/g, function (ch) {
    return String.fromCharCode(ch.charCodeAt(0) - 0xfee0);
  }).replace(/\u3000/g, ' ');
  s = stripQuestionPrefix(s);
  s = stripLocalImages(s);
  s = normalizeLatin(s);
  s = s.toLowerCase();
  // 残余噪声清理
  s = s.replace(DEDUP_NOISE_RE, '');
  return s;
}

/** 归一化后的最小可判定长度：更短的一律不参与去重（空题干/残卡绝不互相吞并） */
var DEDUP_MIN_LEN = 4;

/**
 * 内容指纹。返回 null = 「无法判定」，调用方必须当作「不重复」原样保留。
 *
 * 键 = 归一化题干 + 归一化选项串。两个刻意的取舍：
 * ① **不含答案与解析**：同一道题在不同来源里答案可能缺失或写法不同，
 *    不该因此判成两道题（重传/换源是主场景，答案缺失很常见）。
 * ② **含选项**：题干有时只是一句「下列说法正确的是？」，内容全在选项里；
 *    只比题干会把一批互不相同的题误判成同一道。
 */
function contentKey(card) {
  if (!card || typeof card !== 'object') return null;
  var f = dedupNormalize(card.front);
  if (f.length < DEDUP_MIN_LEN) return null;
  var key = f;
  var opts = card.options;
  if (opts && opts.length) {
    var parts = [];
    for (var i = 0; i < opts.length; i++) {
      var t = opts[i];
      parts.push(dedupNormalize(typeof t === 'string' ? t : (t && (t.text || t.body)) || ''));
    }
    key += '\u0001' + parts.join('\u0002');
  }
  return key;
}

module.exports = {
  contentKey: contentKey,
  dedupNormalize: dedupNormalize,
  DEDUP_MIN_LEN: DEDUP_MIN_LEN,
  parseText: parseText,
  parseJson: parseJson,
  detectDmaicStage: detectDmaicStage,
  extractChoiceOptions: extractChoiceOptions,
  extractCorrectAnswer: extractCorrectAnswer,
  extractQuestionNo: extractQuestionNo,
  isCommentOption: isCommentOption,
  cutBackAtAnswer: cutBackAtAnswer,
  unquoteField: unquoteField,
  stripLocalImages: stripLocalImages,
  stripQuestionPrefix: stripQuestionPrefix,
  trimFrontJunk: trimFrontJunk,
  cleanHtml: cleanHtml,
  htmlToText: htmlToText,
  exportAnkiTxt: exportAnkiTxt
};
