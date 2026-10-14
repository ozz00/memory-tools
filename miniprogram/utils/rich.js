/**
 * HTML -> rich-text nodes
 * 小程序不支持 dangerouslySetInnerHTML，改用 rich-text 组件渲染卡片正文。
 * 支持标签：b/strong/i/em/u/span/div/p/br/ul/ol/li/code/h1-h6/sub/sup/del
 * 不支持的标签会被忽略，仅保留其文本内容。
 */

var VOID_TAGS = { br: 1, hr: 1, img: 1 };

var ALLOWED = {
  a: 1, abbr: 1, b: 1, blockquote: 1, br: 1, code: 1, col: 1, colgroup: 1,
  dd: 1, del: 1, div: 1, dl: 1, dt: 1, em: 1, fieldset: 1, h1: 1, h2: 1,
  h3: 1, h4: 1, h5: 1, h6: 1, hr: 1, i: 1, img: 1, ins: 1, label: 1, legend: 1,
  li: 1, ol: 1, p: 1, q: 1, span: 1, strong: 1, sub: 1, sup: 1,
  table: 1, tbody: 1, td: 1, tfoot: 1, th: 1, thead: 1, tr: 1, ul: 1
};

// Anki cloze 高亮 class -> 内联样式
var CLASS_STYLE = [
  { re: /bg-amber|text-amber/, style: 'background:#fef3c7;color:#78350f;padding:0 6rpx;border-radius:6rpx;' },
  { re: /font-semibold|font-bold/, style: 'font-weight:600;' }
];

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, function (m, code) {
      return String.fromCharCode(parseInt(code, 10));
    });
}

function classToStyle(cls) {
  if (!cls) return '';
  var out = '';
  for (var i = 0; i < CLASS_STYLE.length; i++) {
    if (CLASS_STYLE[i].re.test(cls)) out += CLASS_STYLE[i].style;
  }
  return out;
}

function parseAttrs(attrStr) {
  var attrs = {};
  if (!attrStr) return attrs;
  var styleRe = /style\s*=\s*"([^"]*)"/i;
  var classRe = /class\s*=\s*"([^"]*)"/i;
  var srcRe = /src\s*=\s*(?:"([^"]*)"|'([^']*)')/i;
  var hrefRe = /href\s*=\s*(?:"([^"]*)"|'([^']*)')/i;
  var ms = attrStr.match(styleRe);
  var mc = attrStr.match(classRe);
  var mss = attrStr.match(srcRe);
  var mh = attrStr.match(hrefRe);
  var style = (ms ? ms[1] : '') + classToStyle(mc ? mc[1] : '');
  if (style) attrs.style = style;
  var src = mss ? (mss[1] !== undefined ? mss[1] : mss[2]) : '';
  if (src) attrs.src = src;
  var href = mh ? (mh[1] !== undefined ? mh[1] : mh[2]) : '';
  if (href) attrs.href = href;
  return attrs;
}

function pushText(stack, raw) {
  if (!raw) return;
  var text = decodeEntities(raw);
  if (!text) return;
  var top = stack[stack.length - 1];
  top.children.push({ type: 'text', text: text });
}

function toNodes(html) {
  if (!html) return [];
  var source = String(html);
  var nodes = [];
  var stack = [{ name: 'root', children: nodes }];
  var re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
  var last = 0;
  var m;

  while ((m = re.exec(source)) !== null) {
    if (m.index > last) pushText(stack, source.slice(last, m.index));
    last = m.index + m[0].length;

    var closing = m[1] === '/';
    var name = m[2].toLowerCase();
    var selfClose = m[4] === '/';

    if (!ALLOWED[name]) continue;

    if (closing) {
      for (var i = stack.length - 1; i > 0; i--) {
        if (stack[i].name === name) {
          stack.length = i;
          break;
        }
      }
      continue;
    }

    var attrs = parseAttrs(m[3]);
    // 锚点带公网链接 → 渲染为蓝色下划线样式（rich-text 内不可点击，
    // 可点击入口由 extractLinks + 页面「复制链接」按钮承担）
    if (name === 'a' && attrs.href && /^https?:\/\//i.test(attrs.href)) {
      attrs.style = ((attrs.style || '') + ';color:#2563eb;text-decoration:underline;').replace(/^;/, '');
    }
    if (VOID_TAGS[name] || selfClose) {
      if (name === 'img') {
        // 只保留公网网络图（rich-text 可渲染，域名需在 downloadFile 合法域名白名单内）；
        // 本地/相对路径媒体引用（Anki media 文件名）无法加载，继续跳过
        var isrc = (attrs && attrs.src) || '';
        if (/^https?:\/\//i.test(isrc)) {
          var node = {
            name: 'img',
            attrs: {
              src: isrc,
              style: ((attrs.style || '') + ';max-width:100%;height:auto;display:block;').replace(/^;/, '')
            },
            children: []
          };
          stack[stack.length - 1].children.push(node);
        }
        continue;
      }
      stack[stack.length - 1].children.push({ name: name, attrs: attrs });
    } else {
      var node = { name: name, attrs: attrs, children: [] };
      stack[stack.length - 1].children.push(node);
      stack.push(node);
    }
  }
  if (last < source.length) pushText(stack, source.slice(last));

  // 顶层纯文本节点包一层 span，兼容 rich-text 渲染
  return nodes.map(function (n) {
    if (n.type === 'text') return { name: 'span', attrs: {}, children: [n] };
    return n;
  });
}

function toPlainText(html) {
  if (!html) return '';
  return decodeEntities(
    String(html)
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/(p|div|li|h\d)>/gi, ' ')
      .replace(/<[^>]+>/g, '')
  ).replace(/\s+/g, ' ').trim();
}

/**
 * 提取正文中的可访问链接（供「复制链接 → 微信打开」通道使用）：
 * ① 优先 <a href="http(s)://…">标题</a>，标题为链接文案；
 * ② 其次正文文本中的裸 URL（无 <a> 包裹，如纯文本粘贴的公众号链接）。
 * 返回 [{ url, text }]，按出现顺序去重。
 */
function extractLinks(html) {
  var out = [];
  var seen = {};
  var src = String(html || '');
  var re = /<a\s[^>]*href\s*=\s*(?:"([^"]+)"|'([^']+)')([^>]*)>([\s\S]*?)<\/a>/gi;
  var m;
  while ((m = re.exec(src)) !== null) {
    var href = m[1] !== undefined ? m[1] : m[2];
    if (!href || !/^https?:\/\//i.test(href) || seen[href]) continue;
    seen[href] = 1;
    out.push({ url: href, text: toPlainText(m[4]) || href });
  }
  var plain = toPlainText(src);
  var reUrl = /https?:\/\/[^\s"'<>，。；、）】」]+/gi;
  var u;
  while ((u = reUrl.exec(plain)) !== null) {
    var url = u[0].replace(/[.,;!?、，。；]+$/, '');
    if (!seen[url]) {
      seen[url] = 1;
      out.push({ url: url, text: url });
    }
  }
  return out;
}

module.exports = {
  toNodes: toNodes,
  toPlainText: toPlainText,
  extractLinks: extractLinks
};
