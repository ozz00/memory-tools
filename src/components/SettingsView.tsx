import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Settings as SettingsIcon, 
  Moon, 
  Sun, 
  HelpCircle, 
  Info, 
  Shield, 
  ChevronRight, 
  Layers, 
  Zap, 
  Volume2, 
  VolumeX,
  AlertCircle,
  FileCheck2,
  TrendingUp,
  BrainCircuit,
  Award
} from 'lucide-react';
import { FlashCard, UserStats } from '../types';

interface SettingsViewProps {
  isDarkMode: boolean;
  onToggleDarkMode: () => void;
  cards: FlashCard[];
  stats: UserStats;
  onOpenAdmin: () => void;
  onOpenWrongNotebook: () => void;
  onResetStats?: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  isDarkMode,
  onToggleDarkMode,
  cards,
  stats,
  onOpenAdmin,
  onOpenWrongNotebook,
}) => {
  const [activeSubModal, setActiveSubModal] = useState<'guide' | 'about' | 'sm2' | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [hapticEnabled, setHapticEnabled] = useState(true);

  return (
    <div className={`flex flex-col h-full overflow-y-auto select-none transition-colors duration-200 ${
      isDarkMode ? 'bg-[#0B132B] text-slate-100' : 'bg-[#F4F6F9] text-[#051C2C]'
    }`}>
      {/* Top Header - McKinsey Executive Blue & Clean Layout */}
      <div className={`px-4 py-3.5 border-b sticky top-0 z-10 backdrop-blur-md transition-colors ${
        isDarkMode ? 'bg-[#0F1D40]/90 border-slate-800' : 'bg-white/95 border-slate-200/80'
      }`}>
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-[#051C2C] text-white flex items-center justify-center shadow-xs">
            <SettingsIcon className="w-3.5 h-3.5" />
          </div>
          <div>
            <h2 className="text-[14px] font-bold tracking-tight text-[#051C2C] dark:text-white leading-tight">
              系统设定
            </h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              备考指引 · 记忆算法 · 界面偏好
            </p>
          </div>
        </div>
      </div>

      <div className="p-3.5 space-y-3.5 flex-1">
        {/* SECTION 1: 视觉与偏好 (Appearance & Preferences) */}
        <div>
          <span className="text-[11px] font-semibold px-1 mb-1.5 block tracking-wider uppercase text-slate-500 dark:text-slate-400">
            视觉与交互偏好
          </span>
          <div className={`rounded-xl border overflow-hidden shadow-2xs divide-y transition-colors ${
            isDarkMode ? 'bg-[#142242] border-slate-700/80 divide-slate-700/60' : 'bg-white border-slate-200/80 divide-slate-100'
          }`}>
            {/* Dark Mode Toggle */}
            <div className="p-3 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                  isDarkMode ? 'bg-[#00629B]/20 text-sky-400' : 'bg-slate-100 text-[#051C2C]'
                }`}>
                  {isDarkMode ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
                </div>
                <div>
                  <span className="text-[13px] font-medium block text-slate-900 dark:text-slate-100">
                    暗黑模式 (深色主题)
                  </span>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    {isDarkMode ? '已开启高对比深蓝夜间护眼模式' : '麦肯锡商务沉稳浅色模式'}
                  </span>
                </div>
              </div>
              <button
                onClick={onToggleDarkMode}
                aria-label="切换深色与浅色模式"
                className={`relative w-11 h-6 rounded-full transition-colors duration-200 focus:outline-hidden ${
                  isDarkMode ? 'bg-[#00629B]' : 'bg-slate-300'
                }`}
              >
                <span
                  className={`inline-block w-4 h-4 transform bg-white rounded-full transition-transform duration-200 translate-y-1 ${
                    isDarkMode ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {/* Audio Feedback Toggle */}
            <div className="p-3 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                  isDarkMode ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'
                }`}>
                  {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4 text-slate-400" />}
                </div>
                <div>
                  <span className="text-[13px] font-medium block text-slate-900 dark:text-slate-100">
                    答题音效提示
                  </span>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    做题提交及掌握卡片时的提示音
                  </span>
                </div>
              </div>
              <button
                onClick={() => setSoundEnabled(prev => !prev)}
                aria-label="切换答题音效"
                className={`relative w-11 h-6 rounded-full transition-colors duration-200 focus:outline-hidden ${
                  soundEnabled ? 'bg-[#00629B]' : 'bg-slate-300'
                }`}
              >
                <span
                  className={`inline-block w-4 h-4 transform bg-white rounded-full transition-transform duration-200 translate-y-1 ${
                    soundEnabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {/* Haptic / Vibration Feel */}
            <div className="p-3 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                  isDarkMode ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-700'
                }`}>
                  <Zap className="w-4 h-4" />
                </div>
                <div>
                  <span className="text-[13px] font-medium block text-slate-900 dark:text-slate-100">
                    交互触感反馈
                  </span>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    卡片翻转与选项点按时的触觉模拟
                  </span>
                </div>
              </div>
              <button
                onClick={() => setHapticEnabled(prev => !prev)}
                aria-label="切换震动反馈"
                className={`relative w-11 h-6 rounded-full transition-colors duration-200 focus:outline-hidden ${
                  hapticEnabled ? 'bg-[#00629B]' : 'bg-slate-300'
                }`}
              >
                <span
                  className={`inline-block w-4 h-4 transform bg-white rounded-full transition-transform duration-200 translate-y-1 ${
                    hapticEnabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
          </div>
        </div>

        {/* SECTION 2: 麦肯锡式结构化说明 (Guides & Architecture) */}
        <div>
          <span className="text-[11px] font-semibold px-1 mb-1.5 block tracking-wider uppercase text-slate-500 dark:text-slate-400">
            方法论与核心引擎
          </span>
          <div className={`rounded-xl border overflow-hidden shadow-2xs divide-y transition-colors ${
            isDarkMode ? 'bg-[#142242] border-slate-700/80 divide-slate-700/60' : 'bg-white border-slate-200/80 divide-slate-100'
          }`}>
            {/* Guide: SM-2 Algorithm Explanation */}
            <button
              onClick={() => setActiveSubModal('sm2')}
              id="settings-open-sm2"
              className={`w-full p-3 flex items-center justify-between text-left transition ${
                isDarkMode ? 'hover:bg-slate-800/60' : 'hover:bg-slate-50'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                  isDarkMode ? 'bg-[#00629B]/20 text-sky-400' : 'bg-blue-50 text-[#00629B]'
                }`}>
                  <BrainCircuit className="w-4 h-4" />
                </div>
                <div>
                  <span className="text-[13px] font-medium block text-slate-900 dark:text-slate-100">
                    SM-2 记忆算法机制
                  </span>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    重来 / 困难 / 良好 / 简单 指数级间隔拆解
                  </span>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-400" />
            </button>

            {/* Guide: How to use this Mini Program */}
            <button
              onClick={() => setActiveSubModal('guide')}
              id="settings-open-guide"
              className={`w-full p-3 flex items-center justify-between text-left transition ${
                isDarkMode ? 'hover:bg-slate-800/60' : 'hover:bg-slate-50'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                  isDarkMode ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-[#051C2C]'
                }`}>
                  <HelpCircle className="w-4 h-4" />
                </div>
                <div>
                  <span className="text-[13px] font-medium block text-slate-900 dark:text-slate-100">
                    六西格玛备考节奏指引
                  </span>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    每日任务闭环：闪卡固化 + 真题实战
                  </span>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-400" />
            </button>

            {/* About the Mini Program */}
            <button
              onClick={() => setActiveSubModal('about')}
              id="settings-open-about"
              className={`w-full p-3 flex items-center justify-between text-left transition ${
                isDarkMode ? 'hover:bg-slate-800/60' : 'hover:bg-slate-50'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                  isDarkMode ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-[#051C2C]'
                }`}>
                  <Info className="w-4 h-4" />
                </div>
                <div>
                  <span className="text-[13px] font-medium block text-slate-900 dark:text-slate-100">
                    关于大纲与认证体系
                  </span>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    中国质量协会 CAQ 知识体系对照 · v1.2.0
                  </span>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-400" />
            </button>
          </div>
        </div>

        {/* SECTION 3: 学习数据与题库管理 (Data & Deck Management) */}
        <div>
          <span className="text-[11px] font-semibold px-1 mb-1.5 block tracking-wider uppercase text-slate-500 dark:text-slate-400">
            题库与管理控制台
          </span>
          <div className={`rounded-xl border overflow-hidden shadow-2xs divide-y transition-colors ${
            isDarkMode ? 'bg-[#142242] border-slate-700/80 divide-slate-700/60' : 'bg-white border-slate-200/80 divide-slate-100'
          }`}>
            {/* Shortcut to Wrong Notebook */}
            <button
              onClick={onOpenWrongNotebook}
              className={`w-full p-3 flex items-center justify-between text-left transition ${
                isDarkMode ? 'hover:bg-slate-800/60' : 'hover:bg-slate-50'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                  isDarkMode ? 'bg-rose-950/40 text-rose-400' : 'bg-rose-50 text-rose-700'
                }`}>
                  <AlertCircle className="w-4 h-4" />
                </div>
                <div>
                  <span className="text-[13px] font-medium block text-slate-900 dark:text-slate-100">
                    错题本专项重练
                  </span>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    当前收录 {stats.wrongCardIds.length} 道疑难点 · 答对即刻消除
                  </span>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-400" />
            </button>

            {/* Admin APKG Import Backstage */}
            <button
              onClick={onOpenAdmin}
              className={`w-full p-3 flex items-center justify-between text-left transition ${
                isDarkMode ? 'hover:bg-slate-800/60' : 'hover:bg-slate-50'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                  isDarkMode ? 'bg-slate-800 text-sky-400' : 'bg-slate-100 text-[#00629B]'
                }`}>
                  <Shield className="w-4 h-4" />
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[13px] font-medium block text-slate-900 dark:text-slate-100">
                      管理控制台 (题库静默导入)
                    </span>
                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 font-mono font-medium">
                      APKG / JSON
                    </span>
                  </div>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    批量导入外部 Anki 卡包与重置题库
                  </span>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-400" />
            </button>
          </div>
        </div>

        {/* Footer info */}
        <div className="text-center pt-2 pb-4 space-y-1">
          <p className="text-[11px] text-slate-400 dark:text-slate-500 font-medium">
            CAQ Six Sigma Black Belt · Executive Preparation Edition
          </p>
          <p className="text-[10px] font-mono text-slate-400 dark:text-slate-600">
            SM-2 Algorithm Engine · McKinsey Business Standards
          </p>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* SUB-MODAL 1: SM-2 记忆算法机制 (McKinsey Consulting Editorial Palette)   */}
      {/* Note: Top-right redundant "关闭" is canceled as explicitly requested      */}
      {/* ========================================================================= */}
      <AnimatePresence>
        {activeSubModal === 'sm2' && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-3.5 bg-black/60 backdrop-blur-xs select-none">
            <motion.div
              initial={{ scale: 0.96, opacity: 0, y: 8 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.96, opacity: 0, y: 8 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className={`w-full max-w-sm rounded-2xl p-5 border shadow-2xl flex flex-col max-h-[85vh] overflow-hidden ${
                isDarkMode 
                  ? 'bg-[#0F1D40] border-slate-700 text-slate-100' 
                  : 'bg-white border-slate-200 text-[#051C2C]'
              }`}
            >
              {/* Header: Clean McKinsey Style, NO redundant close button on top-right */}
              <div className="pb-3 border-b border-slate-200/80 dark:border-slate-700/80 flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-[#051C2C] dark:bg-[#00629B] text-white flex items-center justify-center shadow-xs">
                  <BrainCircuit className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-[15px] font-bold text-[#051C2C] dark:text-white tracking-tight">
                    SM-2 记忆算法机制
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    SuperMemo-2 间隔重复科学记忆模型
                  </p>
                </div>
              </div>

              {/* Body Content: High contrast, authoritative McKinsey palette */}
              <div className="flex-1 overflow-y-auto py-3.5 space-y-3 text-left">
                <p className="text-[12px] text-slate-700 dark:text-slate-300 leading-relaxed">
                  本系统采用国际经典的 SuperMemo-2 (SM-2) 动态间隔算法。通过对知识点难易度与遗忘临界点的精准建模，动态计算最优复习周期：
                </p>

                <div className="space-y-2.5">
                  {/* Tier 1: 重来 (Again - 1分) */}
                  <div className={`p-3 rounded-xl border transition-all ${
                    isDarkMode 
                      ? 'bg-slate-800/80 border-slate-700' 
                      : 'bg-white border-slate-200 shadow-2xs'
                  }`}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-rose-600" />
                        <span className="text-[13px] font-bold text-slate-900 dark:text-slate-100">
                          重来 (Again)
                        </span>
                      </div>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300 font-semibold">
                        1 分 · 完全遗忘
                      </span>
                    </div>
                    <p className="text-[12px] text-slate-600 dark:text-slate-300 leading-relaxed pl-3.5">
                      复利间隔归零，降低易度因子(EF)，进入当前学习队列末尾重新排队。
                    </p>
                  </div>

                  {/* Tier 2: 困难 (Hard - 2分) */}
                  <div className={`p-3 rounded-xl border transition-all ${
                    isDarkMode 
                      ? 'bg-slate-800/80 border-slate-700' 
                      : 'bg-white border-slate-200 shadow-2xs'
                  }`}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-amber-500" />
                        <span className="text-[13px] font-bold text-slate-900 dark:text-slate-100">
                          困难 (Hard)
                        </span>
                      </div>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 font-semibold">
                        2 分 · 勉强回忆
                      </span>
                    </div>
                    <p className="text-[12px] text-slate-600 dark:text-slate-300 leading-relaxed pl-3.5">
                      间隔按保守系数微调延长，轻微降低难度系数，近期将提高巩固频度。
                    </p>
                  </div>

                  {/* Tier 3: 良好 (Good - 3分) - McKinsey Blue Accent */}
                  <div className={`p-3 rounded-xl border transition-all ${
                    isDarkMode 
                      ? 'bg-slate-800/80 border-[#00629B]/50' 
                      : 'bg-white border-[#00629B]/30 shadow-2xs'
                  }`}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-[#00629B]" />
                        <span className="text-[13px] font-bold text-[#051C2C] dark:text-white">
                          良好 (Good)
                        </span>
                      </div>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-100 text-[#00629B] dark:bg-blue-950/60 dark:text-sky-300 font-semibold">
                        3 分 · 正常掌握
                      </span>
                    </div>
                    <p className="text-[12px] text-slate-600 dark:text-slate-300 leading-relaxed pl-3.5">
                      按标准乘数指数级增加记忆间隔（1天 → 6天 → 15天 → 38天），稳步固化。
                    </p>
                  </div>

                  {/* Tier 4: 简单 (Easy - 4分) */}
                  <div className={`p-3 rounded-xl border transition-all ${
                    isDarkMode 
                      ? 'bg-slate-800/80 border-slate-700' 
                      : 'bg-white border-slate-200 shadow-2xs'
                  }`}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-emerald-600" />
                        <span className="text-[13px] font-bold text-slate-900 dark:text-slate-100">
                          简单 (Easy)
                        </span>
                      </div>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 font-semibold">
                        4 分 · 熟练贯通
                      </span>
                    </div>
                    <p className="text-[12px] text-slate-600 dark:text-slate-300 leading-relaxed pl-3.5">
                      赋予额外奖励乘数，显著推迟下次推送时间，将宝贵复习精力留给攻坚考点。
                    </p>
                  </div>
                </div>
              </div>

              {/* Bottom McKinsey Action Button */}
              <div className="pt-2">
                <button
                  onClick={() => setActiveSubModal(null)}
                  className="w-full py-2.5 bg-[#051C2C] hover:bg-[#0A2E4C] dark:bg-[#00629B] dark:hover:bg-[#0077C8] text-white text-[13px] font-semibold rounded-xl transition shadow-xs cursor-pointer tracking-wide"
                >
                  好的，知道了
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ========================================================================= */}
      {/* SUB-MODAL 2: 备考宝典使用引导 (Guide)                                      */}
      {/* Note: Top-right redundant "关闭" is canceled as explicitly requested      */}
      {/* ========================================================================= */}
      <AnimatePresence>
        {activeSubModal === 'guide' && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-3.5 bg-black/60 backdrop-blur-xs select-none">
            <motion.div
              initial={{ scale: 0.96, opacity: 0, y: 8 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.96, opacity: 0, y: 8 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className={`w-full max-w-sm rounded-2xl p-5 border shadow-2xl flex flex-col max-h-[85vh] overflow-hidden ${
                isDarkMode 
                  ? 'bg-[#0F1D40] border-slate-700 text-slate-100' 
                  : 'bg-white border-slate-200 text-[#051C2C]'
              }`}
            >
              {/* Header: Clean McKinsey Style, NO redundant close button */}
              <div className="pb-3 border-b border-slate-200/80 dark:border-slate-700/80 flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-[#051C2C] dark:bg-[#00629B] text-white flex items-center justify-center shadow-xs">
                  <HelpCircle className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-[15px] font-bold text-[#051C2C] dark:text-white tracking-tight">
                    六西格玛备考节奏指引
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    科学闭环 · 提升高频考点转化率
                  </p>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto py-3.5 space-y-3 text-left">
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-700">
                  <div className="flex items-center gap-1.5 text-[#051C2C] dark:text-sky-400 font-bold text-[13px] mb-1">
                    <TrendingUp className="w-4 h-4 text-[#00629B]" />
                    每日任务闭环备考策略
                  </div>
                  <p className="text-[12px] text-slate-600 dark:text-slate-300 leading-relaxed">
                    艾宾浩斯遗忘曲线表明，短频多次复习的长期记忆留存率比考前集中突击高出 320%。建议按如下步骤展开：
                  </p>
                </div>

                <div className="space-y-2.5">
                  <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="w-5 h-5 rounded-full bg-[#051C2C] text-white text-[11px] font-bold flex items-center justify-center">1</span>
                      <span className="font-bold text-[13px] text-slate-900 dark:text-white">今日记忆 (Anki 闪卡)</span>
                    </div>
                    <p className="text-[12px] text-slate-600 dark:text-slate-300 pl-7 leading-relaxed">
                      翻转卡片验证核心公式、定义与 DMAIC 核心工具，根据实际熟练度客观评分。
                    </p>
                  </div>

                  <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="w-5 h-5 rounded-full bg-[#00629B] text-white text-[11px] font-bold flex items-center justify-center">2</span>
                      <span className="font-bold text-[13px] text-slate-900 dark:text-white">真题测验 (实战演练)</span>
                    </div>
                    <p className="text-[12px] text-slate-600 dark:text-slate-300 pl-7 leading-relaxed">
                      沉浸式刷中质协历年真题与计算题，即刻呈现专业解析，错题自动收录入库。
                    </p>
                  </div>

                  <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="w-5 h-5 rounded-full bg-rose-600 text-white text-[11px] font-bold flex items-center justify-center">3</span>
                      <span className="font-bold text-[13px] text-slate-900 dark:text-white">错题重练 (动态消除)</span>
                    </div>
                    <p className="text-[12px] text-slate-600 dark:text-slate-300 pl-7 leading-relaxed">
                      在错题本模式中集中重练，只要答对即可将其移出错题集，直至全部攻克清零。
                    </p>
                  </div>
                </div>
              </div>

              {/* Bottom Action Button */}
              <div className="pt-2">
                <button
                  onClick={() => setActiveSubModal(null)}
                  className="w-full py-2.5 bg-[#051C2C] hover:bg-[#0A2E4C] dark:bg-[#00629B] dark:hover:bg-[#0077C8] text-white text-[13px] font-semibold rounded-xl transition shadow-xs cursor-pointer tracking-wide"
                >
                  我已了解，开始备考
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ========================================================================= */}
      {/* SUB-MODAL 3: 关于认证与大纲 (About)                                        */}
      {/* Note: Top-right redundant "关闭" is canceled as explicitly requested      */}
      {/* ========================================================================= */}
      <AnimatePresence>
        {activeSubModal === 'about' && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-3.5 bg-black/60 backdrop-blur-xs select-none">
            <motion.div
              initial={{ scale: 0.96, opacity: 0, y: 8 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.96, opacity: 0, y: 8 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className={`w-full max-w-sm rounded-2xl p-5 border shadow-2xl flex flex-col max-h-[85vh] overflow-hidden ${
                isDarkMode 
                  ? 'bg-[#0F1D40] border-slate-700 text-slate-100' 
                  : 'bg-white border-slate-200 text-[#051C2C]'
              }`}
            >
              {/* Header: Clean McKinsey Style, NO redundant close button */}
              <div className="pb-3 border-b border-slate-200/80 dark:border-slate-700/80 flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-[#051C2C] dark:bg-[#00629B] text-white flex items-center justify-center shadow-xs">
                  <Award className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-[15px] font-bold text-[#051C2C] dark:text-white tracking-tight">
                    关于大纲与认证体系
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    中国质量协会 (CAQ) 注册六西格玛黑带
                  </p>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto py-3.5 space-y-3.5 text-left">
                <div className="text-center py-2">
                  <div className="w-12 h-12 rounded-xl bg-[#051C2C] text-white flex items-center justify-center mx-auto mb-2 font-serif font-bold text-lg shadow-sm">
                    6σ
                  </div>
                  <h4 className="font-bold text-[14px] text-slate-900 dark:text-white">
                    六西格玛黑带 Anki 备考宝典
                  </h4>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    CAQ Certified Six Sigma Black Belt Body of Knowledge
                  </p>
                </div>

                <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/60 divide-y divide-slate-200/60 dark:divide-slate-700 text-[12px]">
                  <div className="p-2.5 flex justify-between">
                    <span className="text-slate-500 dark:text-slate-400">大纲版本</span>
                    <span className="font-semibold text-slate-900 dark:text-slate-100">CAQ 考试大纲权威对照</span>
                  </div>
                  <div className="p-2.5 flex justify-between">
                    <span className="text-slate-500 dark:text-slate-400">知识图谱</span>
                    <span className="font-semibold text-slate-900 dark:text-slate-100">DMAIC + 精益 + DFSS</span>
                  </div>
                  <div className="p-2.5 flex justify-between">
                    <span className="text-slate-500 dark:text-slate-400">内置卡量</span>
                    <span className="font-semibold text-[#00629B] dark:text-sky-400 font-mono">{cards.length} 张核心考点卡</span>
                  </div>
                  <div className="p-2.5 flex justify-between">
                    <span className="text-slate-500 dark:text-slate-400">运行机制</span>
                    <span className="font-semibold text-slate-900 dark:text-slate-100">离线持久存储 · 支持 APKG 导入</span>
                  </div>
                </div>

                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                  本系统严格按照咨询与专业工程标准构建，助力备考人员利用碎片时间建立稳固知识连接，预祝顺利通过黑带注册考试！
                </p>
              </div>

              {/* Bottom Action Button */}
              <div className="pt-2">
                <button
                  onClick={() => setActiveSubModal(null)}
                  className="w-full py-2.5 bg-[#051C2C] hover:bg-[#0A2E4C] dark:bg-[#00629B] dark:hover:bg-[#0077C8] text-white text-[13px] font-semibold rounded-xl transition shadow-xs cursor-pointer tracking-wide"
                >
                  确定
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
