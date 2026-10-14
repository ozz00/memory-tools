/**
 * 回归：Anki 导出批次（Word 粘贴畸形 style + 字段跨行 + 选项乱序 + 希腊字母 Β）
 * 运行：node scripts/regress_importer_csv.cjs（依赖自动准备，见 _testenv.cjs）
 */
const importer = require(require('./_testenv.cjs').resolve().IMP);

let pass = 0, fail = 0;
function assert(name, cond, extra) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('FAIL  ' + name + ' => ' + JSON.stringify(extra).slice(0, 300)); }
}

// Word 粘贴产生的畸形 style 前缀（引号嵌套经 CSV 转义后的真实形态）
const ST = '<div style=""font-family: "" times="""" new="""" roman"",="""" ""simsun"",="""" serif;="""" font-size:="""" 10.5pt;="""" line-height:="""" 1.5;="""" color:="""" #000;""="""">';
const OPT = (t) => `<div style=""margin-bottom: 4px;"">${t}</div>`;

// 一条记录：front 字段跨行（收尾引号在下一物理行行首）+ TAB + back 字段
function rec(q, opts, ans, expl) {
  return `"${ST}<p><strong>${q}</strong></p><div class=""options"" style=""margin-top: 10px; text-align: left;"">${opts.map(OPT).join('')}</div></div>\n"` +
    '\t' +
    `"${ST}<div class=""answer"" style=""font-weight: bold; margin-bottom: 10px;"">答案: ${ans}</div><div class=""explanation"" style=""text-align: left;"">${expl}</div></div>"`;
}

const content = [
  '#separator:tab',
  '#html:true',
  rec('(单选)1.确定项目选择及项目优先级是下列哪个角色的责任',
    ['A. 黑带', 'B.黑带大师', 'C.绿带', 'D. 倡导者'], 'D',
    '倡导者负责确定项目选择及优先级。<br>A:黑带主要负责项目执行和改进工作。<br>B:黑带大师负责指导黑带和绿带。<br>C:绿带通常兼职参与改进项目。<br>D:倡导者是高层领导,负责项目选择和资源分配。'),
  rec('(单选)2. 在分析X-R控制图时应',
    ['A.先分析 X 图然后再分析R 图', 'C. X 图和R 图无关,应单独分析', 'B. 先分析R 图然后再分析X 图', 'D.以上答案都不对'], 'B',
    '在分析 X-R 图时,应先分析R图确保过程波动受控。<br>A:错误,若先分析 X图可能被不稳定的波动误导。<br>B:正确,R图反映组内内变异,是分析基础。<br>C:错误,两图关联,不能单独分析。<br>D:错误,B选项正确。'),
  rec('(单选)3.质量管理大师戴明先生在其著名的质量管理十四条中指出“停止依靠检验达成质量的做法”,这句话的含义是:',
    ['A. 企业雇佣了太多的检验人员,对经营来说是不经济的。', 'B.质量是设计和生产出来的,不是检验出来的。', 'C.在大多数情况下,应该由操作人员自己来保证质量,而不是靠检验员保证。', 'D.人工检验的效率和准确率较低,依靠检验是不能保证质量的。'], 'B',
    '答 3. 答案B;戴明强调质量应通过设计和生产实现,而非依赖检验。<br>A:错误,焦点是质量源头而非经济性。<br>B:正确,检验是事后措施,无法创造质量。'),
  rec('(单选)4.限制理论(TOC, Theory of Constraint)的主要关注领域是:',
    ['A.顾客需求', 'B.价值流', 'C.准时交付', 'D.消除流程中的“瓶颈”'], 'D',
    'TOC 理论核心是识别和消除流程瓶颈以提升整体效率。<br>D:正确,瓶颈限制系统产出,是TOC核心。'),
  rec('(单选)5.在质量功能展开(QFD)中,质量屋的“屋顶”三角形表示:',
    ['A.工程特征之间的相关性', 'C.工程特性的设计目标', 'B. 顾客需求之间的相关性', 'D.工程特征与顾客需求的相关性'], 'A',
    '质量屋的“屋顶”表示工程特征之间的相关性。<br>A:正确,屋顶三角形展示技术特性间正负相关。'),
  rec('(单选)6.在质量功能展开(QFD, Quality Function Deployment)中,首要的工作是:',
    ['A.客户竞争评估', 'B. 技术竞争评估', 'C.决定客户需求', 'D.评估设计特色'], 'C',
    'QFD 首要步骤是识别并决定客户需求。<br>C:正确,客户需求是 QFD 的输入基础。'),
  // 第 7 题：选项字母为希腊 Beta（U+0392）冒充拉丁 B
  rec('(单选)7.在某检验点,对1000个某零件进行检验,每个零件上有10个缺陷机会,结果共发现16个零件不合格,合计32个缺陷,则DPMO为',
    ['A. 0.0032', 'Β. 3200', 'C. 32000', 'D. 1600'], 'B',
    'DPMO=缺陷数/(单位数*机会数)*百万 = 32/10000*1000000=3200。')
].join('\n');

const r = importer.parseText(content);
assert('P1 解析成功', r.success === true, r);
assert('P2 卡片数 = 7', r.totalParsed === 7, r.totalParsed);

const cs = r.cards || [];
const labels = ['front 保留(单选)+题号', '选项数', '选项顺序', '答案', '无畸形style残留'];
for (let i = 0; i < Math.min(7, cs.length); i++) {
  const c = cs[i];
  const tag = `卡${i + 1}`;
  assert(`${tag} ${labels[0]}`, typeof c.front === 'string' && c.front.length > 4 && !/font-family/.test(c.front) && /^\(单选\)\s*\d+\./.test(c.front), c.front);
  assert(`${tag} ${labels[1]}`, (c.options || []).length === 4, c.options);
  if (c.options && c.options.length === 4) {
    const seq = c.options.map(o => o.charAt(0)).join('');
    assert(`${tag} ${labels[2]}`, seq === 'ABCD', seq);
  }
  assert(`${tag} ${labels[3]}`, c.correctAnswer === ['D', 'B', 'B', 'D', 'A', 'C', 'B'][i], c.correctAnswer);
  const backPlain = String(c.back || '').replace(/<[^>]+>/g, ''); // 残渣只存在于标签属性中，剥标签后正文应干净
  assert(`${tag} ${labels[4]}`, !/font-family|times=|simsun/.test(c.front + backPlain), backPlain.slice(0, 120));
  assert(`${tag} cardType`, c.cardType === 'single_choice', c.cardType);
}

// 卡 7 专项：希腊 Β → 拉丁 B
const c7 = cs[6];
if (c7 && c7.options) {
  assert('卡7 希腊Β归一为B. 3200', c7.options.some(o => o.indexOf('B. 3200') === 0), c7.options);
}

// ── 原始题号提取（qNo）──
for (let i = 0; i < Math.min(7, cs.length); i++) {
  assert(`卡${i + 1} qNo=${i + 1}`, cs[i].qNo === i + 1, cs[i].qNo);
}
const qnA = importer.parseText('27. 质量成本包括哪些。\t答案: 预防成本、鉴定成本、故障成本');
assert('裸题号 27. 提取', qnA.cards[0] && qnA.cards[0].qNo === 27, qnA.cards[0] && qnA.cards[0].qNo);
const qnB = importer.parseText('（多选题）8.下列属于质量工具的有\tA. 排列图 B. 因果图');
assert('（多选题）8. 提取', qnB.cards[0] && qnB.cards[0].qNo === 8, qnB.cards[0] && qnB.cards[0].qNo);
const qnC = importer.parseText('无编号题干。\t答案: X');
assert('无编号 qNo 缺省', qnC.cards[0] && !qnC.cards[0].qNo, qnC.cards[0] && qnC.cards[0].qNo);

// ── 背面回退提取：答案后的解析评注不得被抓为选项 ──
const onlyComments = importer.parseText('7.在某检验点,则DPMO为\t答案：B\nDPMO计算为3200。<br>A:错误，数值计算不匹配。<br>B:正确，计算无误。<br>C:错误，数值过大。<br>D:错误，数值过小。');
assert('C1 评注不被抓为选项', onlyComments.cards[0] && !(onlyComments.cards[0].options && onlyComments.cards[0].options.length), onlyComments.cards[0] && onlyComments.cards[0].options);
const optsBeforeAnswer = importer.parseText('9.质量屋屋顶表示\t<div>A. 工程特征相关性</div><div>B. 顾客需求相关性</div><div>C. 设计目标</div><div>D. 市场需求</div>\t【答案】A<br>解析：屋顶表示工程特征之间的相关性。<br>B:错误。');
assert('C2 多字段模板答案前选项仍可提', optsBeforeAnswer.cards[0] && optsBeforeAnswer.cards[0].options && optsBeforeAnswer.cards[0].options.length === 4, optsBeforeAnswer.cards[0] && optsBeforeAnswer.cards[0].options);
assert('C3 该卡答案正确', optsBeforeAnswer.cards[0] && optsBeforeAnswer.cards[0].correctAnswer === 'A', optsBeforeAnswer.cards[0] && optsBeforeAnswer.cards[0].correctAnswer);
// 真实「正确/错误」判断选项（无标点续句）不受评注判定影响
assert('C4 isCommentOption 判别', importer.isCommentOption('A. 错误，数值计算不匹配。') === true && importer.isCommentOption('A. 正确') === false && importer.isCommentOption('B. 3200') === false);

// ── 回退路径：纯文本无引号多行格式（启发式）仍可用 ──
const plain = [
  '(单选)10.关于项目特许任务书，下列说法不正确的是（）。',
  'A. 特许任务书是正式批准项目的文件',
  'B. 特许任务书由项目经理编制',
  'C. 特许任务书明确项目目标',
  'D. 特许任务书指定资源\tB',
  '解析：项目特许任务书由管理层或发起人发布。'
].join('\n');
const rp = importer.parseText(plain);
assert('F1 纯文本回退解析成功', rp.success === true, rp);
assert('F2 纯文本答案/选项正确', rp.cards && rp.cards[0] && rp.cards[0].correctAnswer === 'B' && rp.cards[0].options.length === 4, rp.cards && rp.cards[0]);

// ── F3/F4：front 以 HTML 标签开头、且整行无引号包裹（每行一条记录）──
// 坑：启发式里「行首为 HTML 标签 ⇒ 上一题续文」这条规则是为**无 Tab 折行**设计的。
// 若含 Tab 的记录行也套用它，则每一条记录都会被并入上一条 ⇒ 整份文件塌成一张卡。
// 实测（修复前）：4 行输入只解析出 1 张，back 被拼成 255 字符。
const htmlRows = ['#separator:tab', '#html:true'];
for (let i = 1; i <= 4; i++) {
  htmlRows.push(
    '<div>(单选)' + i + '．第 ' + i + ' 题：题干？</div><div>A. 甲</div><div>B. 乙</div>'
    + '\t答案：B 解析：第 ' + i + ' 题解析。\tqNo:' + i
  );
}
const htmlFront = importer.parseText(htmlRows.join('\n') + '\n');
assert('F3 HTML 开头的 Tab 记录不塌成一张卡', htmlFront.cards.length === 4, htmlFront.cards.length);
assert('F4 每条记录的解析各归其卡', htmlFront.cards.length === 4
  && htmlFront.cards[3].back.indexOf('第 4 题解析') >= 0
  && htmlFront.cards[3].back.indexOf('第 1 题解析') < 0,
  htmlFront.cards[3] && htmlFront.cards[3].back);

// ── F5：含 Tab 的**显式文字续文**（「解析：…\t标签列」折行）仍须并入上一条 ──
const tabCont = importer.parseText('10.质量屋屋顶表示\t<div>A. 甲</div><div>B. 乙</div>\n解析：屋顶表示工程特征之间的相关性。\tnote');
assert('F5 含 Tab 的文字续文仍并入上一条', tabCont.cards.length === 1, tabCont.cards.length);
assert('F6 续文内容未丢失', tabCont.cards[0] && tabCont.cards[0].back.indexOf('屋顶表示工程特征') >= 0, tabCont.cards[0] && tabCont.cards[0].back);

// ── 上一批格式（单行、逐字段引号包裹）回归 ──
const prevLine = '"<div>(单选)9.六西格玛管理强调以（）为关注焦点。</div><div>A. 顾客</div><div>B. 过程</div><div>C. 供应商</div><div>D. 员工</div>"\t"<div>【答案】A<br/>【解析】六西格玛管理以顾客为关注焦点。</div>"';
const rprev = importer.parseText(prevLine);
assert('G1 上一批单行格式兼容', rprev.success === true && rprev.cards.length === 1, rprev);
assert('G2 上一批选项/答案提取', rprev.cards[0] && rprev.cards[0].correctAnswer === 'A' && rprev.cards[0].options.length === 4, rprev.cards[0]);

console.log('\nCSV 批次回归：通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
