import React, { useState } from 'react';
import { 
  X, 
  Upload, 
  FileText, 
  Package, 
  Check, 
  AlertTriangle, 
  Database, 
  Download, 
  RefreshCw, 
  ShieldCheck,
  Code,
  FileCode
} from 'lucide-react';
import { FlashCard, ParseResult } from '../types';
import { parseAnkiApkg, parseAnkiText } from '../utils/ankiParser';

interface AdminBackstageModalProps {
  isOpen: boolean;
  onClose: () => void;
  cards: FlashCard[];
  onImportCards: (newCards: FlashCard[], mode: 'append' | 'replace') => void;
  onResetDefault: () => void;
}

export const AdminBackstageModal: React.FC<AdminBackstageModalProps> = ({
  isOpen,
  onClose,
  cards,
  onImportCards,
  onResetDefault,
}) => {
  const [activeTab, setActiveTab] = useState<'apkg' | 'text' | 'manage' | 'wechat_code'>('apkg');
  const [importMode, setImportMode] = useState<'append' | 'replace'>('append');
  const [isProcessing, setIsProcessing] = useState(false);
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [rawText, setRawText] = useState('');
  const [dragOver, setDragOver] = useState(false);

  if (!isOpen) return null;

  // Handle .apkg or .zip file upload
  const handleFileUpload = async (file: File) => {
    setIsProcessing(true);
    setParseResult(null);

    try {
      const buffer = await file.arrayBuffer();
      // Parse .apkg or .zip
      const result = await parseAnkiApkg(buffer);
      setParseResult(result);
    } catch (err: any) {
      setParseResult({
        success: false,
        totalParsed: 0,
        cards: [],
        message: '解析失败: ' + (err.message || '文件解析错误'),
        error: String(err)
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleTextParse = () => {
    if (!rawText.trim()) return;
    setIsProcessing(true);
    try {
      const result = parseAnkiText(rawText);
      setParseResult(result);
    } catch (err: any) {
      setParseResult({
        success: false,
        totalParsed: 0,
        cards: [],
        message: '文本解析出错: ' + err.message
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleConfirmImport = () => {
    if (!parseResult || parseResult.cards.length === 0) return;
    onImportCards(parseResult.cards, importMode);
    alert(`题库导入成功！已${importMode === 'append' ? '追加' : '重置'} ${parseResult.cards.length} 张卡片。使用者界面已自动同步，全程对考生隐蔽。`);
    setParseResult(null);
    setRawText('');
    onClose();
  };

  // Download export JSON for WeChat Mini Program local bundle
  const handleExportJson = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(cards, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", "wechat_miniprogram_question_bank.json");
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 md:p-6 select-none">
      <div className="bg-white w-full max-w-2xl rounded-2xl shadow-xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="px-5 py-3.5 bg-gray-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs md:text-sm font-bold flex items-center gap-2">
                管理员专属：题库后台静默导入系统
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-normal">
                  普通考生端不可见
                </span>
              </h3>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Feature Navigation Tabs */}
        <div className="px-5 pt-3 border-b border-gray-100 flex gap-4 text-xs font-medium bg-gray-50/50">
          <button
            onClick={() => setActiveTab('apkg')}
            className={`pb-2.5 flex items-center gap-1.5 border-b-2 transition ${
              activeTab === 'apkg'
                ? 'border-emerald-600 text-emerald-600 font-semibold'
                : 'border-transparent text-gray-500 hover:text-gray-900'
            }`}
          >
            <Package className="w-3.5 h-3.5" />
            <span>导入 .apkg / .zip 压缩包</span>
          </button>

          <button
            onClick={() => setActiveTab('text')}
            className={`pb-2.5 flex items-center gap-1.5 border-b-2 transition ${
              activeTab === 'text'
                ? 'border-emerald-600 text-emerald-600 font-semibold'
                : 'border-transparent text-gray-500 hover:text-gray-900'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>导入 Anki 文本 / TSV</span>
          </button>

          <button
            onClick={() => setActiveTab('manage')}
            className={`pb-2.5 flex items-center gap-1.5 border-b-2 transition ${
              activeTab === 'manage'
                ? 'border-emerald-600 text-emerald-600 font-semibold'
                : 'border-transparent text-gray-500 hover:text-gray-900'
            }`}
          >
            <Database className="w-3.5 h-3.5" />
            <span>当前题库管理 ({cards.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('wechat_code')}
            className={`pb-2.5 flex items-center gap-1.5 border-b-2 transition ${
              activeTab === 'wechat_code'
                ? 'border-emerald-600 text-emerald-600 font-semibold'
                : 'border-transparent text-gray-500 hover:text-gray-900'
            }`}
          >
            <Code className="w-3.5 h-3.5" />
            <span>小程序架构方案</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto flex-1 space-y-4">
          {/* TAB 1: APKG / ZIP */}
          {activeTab === 'apkg' && (
            <div className="space-y-4">
              <div className="p-3 bg-blue-50 border border-blue-100 rounded-xl text-xs text-blue-800 leading-relaxed">
                💡 <b>支持直接上传：</b> 您可以将 Anki 导出的 <code>.apkg</code> 原文件直接拖拽到下方（或改名为 <code>.zip</code> 均可识别）。系统会自动解压并在内存中提取 SQLite <code>collection.anki2</code> 数据库，转化为六西格玛 DMAIC 考点卡片。
              </div>

              {/* Drag & Drop Zone */}
              <label 
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                    handleFileUpload(e.dataTransfer.files[0]);
                  }
                }}
                className={`border-2 border-dashed rounded-2xl p-8 flex flex-col items-center justify-center cursor-pointer transition ${
                  dragOver ? 'border-emerald-500 bg-emerald-50/50' : 'border-gray-200 hover:border-emerald-400 bg-gray-50/50'
                }`}
              >
                <input 
                  type="file" 
                  accept=".apkg,.zip" 
                  className="hidden" 
                  onChange={(e) => {
                    if (e.target.files && e.target.files[0]) {
                      handleFileUpload(e.target.files[0]);
                    }
                  }} 
                />
                <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mb-3">
                  <Upload className="w-6 h-6" />
                </div>
                <span className="text-xs font-semibold text-gray-800 mb-1">
                  {isProcessing ? '正在智能解压与解析 SQLite 数据库...' : '点击或将 .apkg / .zip 文件拖拽至此处'}
                </span>
                <span className="text-[11px] text-gray-400">
                  支持 Anki 2.1+ 标准卡包（含 collection.anki2）
                </span>
              </label>

              {/* Import Mode Selector */}
              <div className="flex items-center justify-between p-3 bg-gray-50 rounded-xl text-xs">
                <span className="text-gray-600 font-medium">导入方式：</span>
                <div className="flex gap-4">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input 
                      type="radio" 
                      name="mode_apkg" 
                      checked={importMode === 'append'} 
                      onChange={() => setImportMode('append')}
                      className="text-emerald-600 focus:ring-emerald-500" 
                    />
                    <span>追加到现有题库</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input 
                      type="radio" 
                      name="mode_apkg" 
                      checked={importMode === 'replace'} 
                      onChange={() => setImportMode('replace')}
                      className="text-emerald-600 focus:ring-emerald-500" 
                    />
                    <span>清空并替换整个题库</span>
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: Text / TSV */}
          {activeTab === 'text' && (
            <div className="space-y-3">
              <div className="p-3 bg-amber-50 border border-amber-100 rounded-xl text-xs text-amber-900 leading-relaxed">
                📝 <b>Anki 纯文本导出支持：</b> 在电脑端 Anki 导出时选择“纯文本中的笔记 (*.txt)”。每行一张卡片，正面与背面通过制表符 (Tab) 隔开。粘贴到下方即可快速解析。
              </div>

              <textarea
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                placeholder="例如：
在MSA中，%GRR处于10%~30%之间的判定结果为？	条件接受。依据重要度、成本等综合决定。	MSA 测量
休哈特控制图中判异准则2是连续几点落在中心线同侧？	连续9点落在中心线同一侧。	SPC 控制"
                rows={6}
                className="w-full p-3 text-xs font-mono rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white"
              />

              <div className="flex items-center justify-between">
                <div className="flex gap-3 text-xs">
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input 
                      type="radio" 
                      name="mode_text" 
                      checked={importMode === 'append'} 
                      onChange={() => setImportMode('append')}
                    />
                    <span>追加</span>
                  </label>
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input 
                      type="radio" 
                      name="mode_text" 
                      checked={importMode === 'replace'} 
                      onChange={() => setImportMode('replace')}
                    />
                    <span>覆盖</span>
                  </label>
                </div>

                <button
                  onClick={handleTextParse}
                  disabled={!rawText.trim() || isProcessing}
                  className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-xs font-semibold hover:bg-emerald-700 transition disabled:opacity-50"
                >
                  {isProcessing ? '解析中...' : '解析卡片文本'}
                </button>
              </div>
            </div>
          )}

          {/* TAB 3: Current Bank Management */}
          {activeTab === 'manage' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">当前考生端生效卡片总数：<b>{cards.length}</b> 张</span>
                <div className="flex gap-2">
                  <button
                    onClick={handleExportJson}
                    className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-xs font-medium transition flex items-center gap-1"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>导出题库 JSON</span>
                  </button>
                  <button
                    onClick={() => {
                      if (confirm('确定要重置为默认官方六西格玛黑带精选题库吗？')) {
                        onResetDefault();
                        alert('已成功重置题库！');
                      }
                    }}
                    className="px-3 py-1.5 border border-red-200 text-red-600 hover:bg-red-50 rounded-lg text-xs font-medium transition flex items-center gap-1"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>恢复预设精选题库</span>
                  </button>
                </div>
              </div>

              {/* Cards quick preview list */}
              <div className="border border-gray-100 rounded-xl max-h-60 overflow-y-auto divide-y divide-gray-100">
                {cards.map((c, index) => (
                  <div key={c.id} className="p-2.5 text-xs flex items-start justify-between gap-3 hover:bg-gray-50">
                    <div className="flex-1">
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-50 text-emerald-700 font-medium">
                          #{index + 1}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-gray-100 text-gray-600">
                          {c.stage}
                        </span>
                      </div>
                      <p className="text-gray-900 font-medium line-clamp-1" dangerouslySetInnerHTML={{ __html: c.front }} />
                      <p className="text-gray-500 line-clamp-1 text-[11px]" dangerouslySetInnerHTML={{ __html: c.back }} />
                    </div>
                    <span className="text-[10px] text-gray-400 shrink-0 font-mono">
                      {c.interval}d
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 4: WeChat Architecture Guide */}
          {activeTab === 'wechat_code' && (
            <div className="space-y-3 text-xs text-gray-700 leading-relaxed">
              <div className="p-3 bg-gray-900 text-gray-200 rounded-xl space-y-2 font-mono text-[11px]">
                <div className="text-emerald-400 font-bold">// 微信小程序实现“使用者看不到导入界面”的 2 大业界方案：</div>
                <div>
                  <span className="text-amber-300">方案 1（零服务器离线方案 - 推荐）：</span><br/>
                  在管理后台点击上方【导出题库 JSON】，将生成的 <code>question_bank.json</code> 直接存放在小程序工程的 <code>/data/questions.json</code> 中。发布小程序后，考生小程序启动时直接从本地加载，考生界面完全无导入功能。
                </div>
                <div>
                  <span className="text-blue-300">方案 2（微信云开发鉴权方案）：</span><br/>
                  在云函数中设置 <code>ADMIN_OPENID</code>。只有您的微信 OpenID 登录时，点击特殊菜单才能拉取管理权限；普通考生访问时仅具有 <code>question_bank</code> 集合的只读权限。
                </div>
              </div>
            </div>
          )}

          {/* PARSE RESULT PREVIEW */}
          {parseResult && (
            <div className={`p-4 rounded-xl border ${parseResult.success ? 'bg-emerald-50/70 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
              <div className="flex items-center justify-between mb-2">
                <span className={`text-xs font-bold ${parseResult.success ? 'text-emerald-900' : 'text-red-900'}`}>
                  {parseResult.message}
                </span>
                {parseResult.success && (
                  <span className="text-xs text-emerald-700">
                    解析出 <b>{parseResult.cards.length}</b> 张考点卡片
                  </span>
                )}
              </div>

              {parseResult.success && parseResult.cards.length > 0 && (
                <>
                  <div className="max-h-40 overflow-y-auto space-y-2 mb-3 bg-white p-2.5 rounded-lg border border-emerald-100 text-xs">
                    {parseResult.cards.slice(0, 3).map((card, i) => (
                      <div key={i} className="border-b border-gray-100 pb-1.5 last:border-0">
                        <div className="font-semibold text-gray-800 line-clamp-1">
                          {i + 1}. 正面：{card.front.replace(/<[^>]*>/g, '')}
                        </div>
                        <div className="text-gray-500 text-[11px] line-clamp-1">
                          背面：{card.back.replace(/<[^>]*>/g, '')}
                        </div>
                      </div>
                    ))}
                    {parseResult.cards.length > 3 && (
                      <div className="text-center text-[10px] text-gray-400 pt-1">
                        ...以及其余 {parseResult.cards.length - 3} 张卡片
                      </div>
                    )}
                  </div>

                  <button
                    onClick={handleConfirmImport}
                    className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 shadow-xs"
                  >
                    <Check className="w-4 h-4" />
                    <span>确认灌入系统题库（立即对考生生效）</span>
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3 bg-gray-50 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500">
          <span>当前系统状态：已装载 {cards.length} 张试题卡</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg transition font-medium"
          >
            返回考生视图
          </button>
        </div>
      </div>
    </div>
  );
};
