import React, { useState } from 'react';
import { 
  Wifi, 
  Battery, 
  MoreHorizontal, 
  Circle, 
  BookOpen, 
  FileCheck, 
  BarChart2, 
  Smartphone, 
  Monitor,
  Shield,
  Layers,
  Sparkles,
  Settings as SettingsIcon,
  Moon,
  Sun
} from 'lucide-react';
import { AnkiCardView } from './AnkiCardView';
import { QuizModeView } from './QuizModeView';
import { StatsDashboard } from './StatsDashboard';
import { SettingsView } from './SettingsView';
import { WrongNotebookModal } from './WrongNotebookModal';
import { FlashCard, UserStats, DmaicStage } from '../types';

interface WeChatSimulatorProps {
  cards: FlashCard[];
  stats: UserStats;
  onUpdateCard: (updatedCard: FlashCard) => void;
  selectedStage: DmaicStage;
  onSelectStage: (stage: DmaicStage) => void;
  favorites: string[];
  onToggleFavorite: (id: string) => void;
  onRecordWrong: (id: string) => void;
  onRemoveWrong: (id: string) => void;
  onClearAllWrong?: () => void;
  onOpenAdmin: () => void;
}

export const WeChatSimulator: React.FC<WeChatSimulatorProps> = ({
  cards,
  stats,
  onUpdateCard,
  selectedStage,
  onSelectStage,
  favorites,
  onToggleFavorite,
  onRecordWrong,
  onRemoveWrong,
  onClearAllWrong,
  onOpenAdmin,
}) => {
  const [activeTab, setActiveTab] = useState<'anki' | 'quiz' | 'stats' | 'settings'>('anki');
  const [viewMode, setViewMode] = useState<'mobile' | 'desktop'>('mobile');
  const [showWechatMenu, setShowWechatMenu] = useState(false);
  const [isWrongNotebookOpen, setIsWrongNotebookOpen] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [versionTapCount, setVersionTapCount] = useState(0);

  // Secret trigger: tap version 3 times
  const handleVersionTap = () => {
    const next = versionTapCount + 1;
    if (next >= 3) {
      setVersionTapCount(0);
      onOpenAdmin();
    } else {
      setVersionTapCount(next);
      setTimeout(() => setVersionTapCount(0), 1500);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-start p-2 md:p-6 select-none font-sans">
      {/* Top Device & Control Bar */}
      <header className="w-full max-w-4xl flex items-center justify-between py-2 px-4 mb-2 text-white text-xs">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-emerald-500 flex items-center justify-center font-bold text-white shadow-xs">
            6σ
          </div>
          <div>
            <span className="font-bold text-slate-100 block text-xs md:text-sm">六西格玛黑带备考宝典 · 原生微信小程序</span>
            <span className="text-[10px] text-slate-400">考生端纯净模式 · Anki 间隔重复 SM-2</span>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          {/* Quick theme toggle in simulator top bar */}
          <button
            onClick={() => setIsDarkMode(prev => !prev)}
            className="p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 transition"
            title={isDarkMode ? '切换浅色模式' : '切换暗黑夜间模式'}
          >
            {isDarkMode ? <Sun className="w-3.5 h-3.5 text-amber-400" /> : <Moon className="w-3.5 h-3.5 text-indigo-400" />}
          </button>

          {/* View mode toggle */}
          <div className="bg-slate-800 p-1 rounded-xl flex items-center gap-1 border border-slate-700">
            <button
              onClick={() => setViewMode('mobile')}
              className={`px-2.5 py-1 rounded-lg text-xs flex items-center gap-1 transition ${
                viewMode === 'mobile' ? 'bg-emerald-600 text-white font-medium' : 'text-slate-400 hover:text-white'
              }`}
              title="手机真机仿真视图"
            >
              <Smartphone className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">手机视图</span>
            </button>
            <button
              onClick={() => setViewMode('desktop')}
              className={`px-2.5 py-1 rounded-lg text-xs flex items-center gap-1 transition ${
                viewMode === 'desktop' ? 'bg-emerald-600 text-white font-medium' : 'text-slate-400 hover:text-white'
              }`}
              title="宽屏视图"
            >
              <Monitor className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">全屏宽屏</span>
            </button>
          </div>

          {/* Admin entrance button */}
          <button
            onClick={onOpenAdmin}
            className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs flex items-center gap-1.5 transition"
            title="打开静默导入后台"
          >
            <Shield className="w-3.5 h-3.5 text-emerald-400" />
            <span>管理后台</span>
          </button>
        </div>
      </header>

      {/* Main Container: Mobile phone frame or desktop responsive card */}
      <main className={`w-full transition-all duration-300 flex justify-center ${
        viewMode === 'mobile' ? 'max-w-[400px]' : 'max-w-4xl'
      }`}>
        <div className={`w-full rounded-3xl shadow-2xl overflow-hidden border flex flex-col h-[740px] relative transition-colors duration-200 ${
          isDarkMode ? 'dark bg-slate-900 border-slate-800 shadow-emerald-950/20' : 'bg-white border-slate-800'
        }`}>
          
          {/* WECHAT MINI PROGRAM STATUS BAR */}
          <div className={`px-5 pt-3 pb-1 flex items-center justify-between text-xs font-semibold transition-colors duration-200 ${
            isDarkMode ? 'bg-slate-900 text-slate-200' : 'bg-white text-slate-950'
          }`}>
            <span className="font-mono text-[11px] font-bold">09:41</span>
            <div className={`flex items-center gap-1.5 ${isDarkMode ? 'text-slate-300' : 'text-slate-950'}`}>
              <Wifi className="w-3.5 h-3.5" />
              <span className="text-[10px] font-mono font-bold">5G</span>
              <Battery className="w-4 h-4" />
            </div>
          </div>

          {/* WECHAT NAVIGATION BAR WITH MINI-PROGRAM CAPSULE */}
          <div className={`px-4 py-2 flex items-center justify-between border-b relative transition-colors duration-200 ${
            isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
          }`}>
            <div className="flex items-center gap-1.5">
              <h1 className={`text-xs md:text-sm font-black ${isDarkMode ? 'text-slate-100' : 'text-slate-950'}`}>
                六西格玛黑带 Anki
              </h1>
              <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-200 text-slate-950 dark:bg-emerald-950/60 dark:text-emerald-300 font-bold border border-slate-300/80">
                CAQ题库
              </span>
            </div>

            {/* WeChat Mini Program standard capsule: [ ••• | ⭕ ] */}
            <div className={`flex items-center border rounded-full px-2.5 py-1 gap-3 shadow-2xs transition-colors ${
              isDarkMode ? 'bg-slate-800/90 border-slate-700 text-slate-300' : 'border-slate-300 bg-slate-100/90 text-slate-800'
            }`}>
              <button 
                onClick={() => setShowWechatMenu(prev => !prev)}
                className={`transition ${isDarkMode ? 'hover:text-white' : 'hover:text-black'}`} 
                title="小程序选项"
              >
                <MoreHorizontal className="w-4 h-4" />
              </button>
              <div className={`w-[1px] h-3 ${isDarkMode ? 'bg-slate-700' : 'bg-slate-300'}`} />
              <button 
                onClick={() => setActiveTab('settings')} 
                className={`transition ${isDarkMode ? 'hover:text-white' : 'hover:text-black'}`} 
                title="设定"
              >
                <Circle className="w-3 h-3" />
              </button>
            </div>

            {/* WeChat Menu Action Sheet (Hidden simulated menu) */}
            {showWechatMenu && (
              <div className={`absolute right-4 top-12 z-40 rounded-xl shadow-lg border py-1.5 text-xs w-44 backdrop-blur-md ${
                isDarkMode ? 'bg-slate-800/95 border-slate-700 text-slate-200' : 'bg-white/95 border-gray-100 text-gray-700'
              }`}>
                <button
                  onClick={() => {
                    setShowWechatMenu(false);
                    alert('已分享当前六西格玛黑带备考卡组给好友！');
                  }}
                  className={`w-full px-3.5 py-2 text-left transition ${
                    isDarkMode ? 'hover:bg-slate-700' : 'hover:bg-gray-50'
                  }`}
                >
                  转发分享到微信群
                </button>
                <button
                  onClick={() => {
                    setShowWechatMenu(false);
                    setIsWrongNotebookOpen(true);
                  }}
                  className="w-full px-3.5 py-2 text-left hover:bg-gray-50 dark:hover:bg-slate-700 transition text-red-600 font-medium flex items-center justify-between"
                >
                  <span>错题本 · 专项重练</span>
                  <span className="text-[10px] px-1 rounded bg-red-100 text-red-700 font-mono">
                    {stats.wrongCardIds.length}
                  </span>
                </button>
                <button
                  onClick={() => {
                    setShowWechatMenu(false);
                    setActiveTab('settings');
                  }}
                  className={`w-full px-3.5 py-2 text-left transition font-medium flex items-center justify-between ${
                    isDarkMode ? 'hover:bg-slate-700 text-slate-200' : 'hover:bg-gray-50 text-gray-800'
                  }`}
                >
                  <span>系统设定 & 使用引导</span>
                  <SettingsIcon className="w-3.5 h-3.5 text-gray-400" />
                </button>
                <button
                  onClick={() => {
                    setShowWechatMenu(false);
                    onOpenAdmin();
                  }}
                  className="w-full px-3.5 py-2 text-left hover:bg-gray-50 dark:hover:bg-slate-700 transition text-emerald-600 font-medium flex items-center justify-between"
                >
                  <span>管理后台 (静默导入)</span>
                  <span className="text-[10px] px-1 rounded bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300">管理</span>
                </button>
                <button
                  onClick={() => setShowWechatMenu(false)}
                  className={`w-full px-3.5 py-2 text-left transition ${
                    isDarkMode ? 'hover:bg-slate-700 text-slate-400' : 'hover:bg-gray-50 text-gray-400'
                  }`}
                >
                  取消
                </button>
              </div>
            )}
          </div>

          {/* MAIN TAB CONTENT AREA (Candidate View) */}
          <div className={`flex-1 overflow-hidden relative transition-colors duration-200 ${
            isDarkMode ? 'bg-slate-900' : 'bg-white'
          }`}>
            {activeTab === 'anki' && (
              <AnkiCardView
                cards={cards}
                onUpdateCard={onUpdateCard}
                selectedStage={selectedStage}
                onSelectStage={onSelectStage}
                favorites={favorites}
                onToggleFavorite={onToggleFavorite}
                isDarkMode={isDarkMode}
              />
            )}

            {activeTab === 'quiz' && (
              <QuizModeView
                cards={cards}
                selectedStage={selectedStage}
                onSelectStage={onSelectStage}
                onRecordWrong={onRecordWrong}
                wrongCardIds={stats.wrongCardIds}
                onRemoveWrong={onRemoveWrong}
              />
            )}

            {activeTab === 'stats' && (
              <StatsDashboard
                cards={cards}
                stats={stats}
                onSelectStage={stage => {
                  onSelectStage(stage);
                  setActiveTab('anki');
                }}
                onOpenWrongCards={() => {
                  setIsWrongNotebookOpen(true);
                }}
                onOpenFavorites={() => {
                  onSelectStage('all');
                  setActiveTab('anki');
                }}
              />
            )}

            {activeTab === 'settings' && (
              <SettingsView
                isDarkMode={isDarkMode}
                onToggleDarkMode={() => setIsDarkMode(prev => !prev)}
                cards={cards}
                stats={stats}
                onOpenAdmin={onOpenAdmin}
                onOpenWrongNotebook={() => setIsWrongNotebookOpen(true)}
              />
            )}
          </div>

          {/* WECHAT MINI-PROGRAM BOTTOM TABBAR (4 Tabs: Anki, Quiz, Stats, Settings) */}
          <nav className={`border-t px-4 py-2 flex items-center justify-around text-xs select-none transition-colors duration-200 ${
            isDarkMode ? 'bg-[#0F1D40] border-slate-800' : 'bg-white border-slate-300'
          }`}>
            {/* Tab 1: Anki Memory */}
            <button
              onClick={() => setActiveTab('anki')}
              className={`flex flex-col items-center gap-0.5 transition cursor-pointer ${
                activeTab === 'anki' 
                  ? 'text-[#051C2C] dark:text-sky-400 font-black' 
                  : isDarkMode ? 'text-slate-400 hover:text-slate-200' : 'text-slate-700 hover:text-slate-950 font-semibold'
              }`}
            >
              <BookOpen className="w-5 h-5" />
              <span className="text-[11px]">今日记忆</span>
            </button>

            {/* Tab 2: Quiz */}
            <button
              onClick={() => setActiveTab('quiz')}
              className={`flex flex-col items-center gap-0.5 transition cursor-pointer ${
                activeTab === 'quiz' 
                  ? 'text-[#051C2C] dark:text-sky-400 font-black' 
                  : isDarkMode ? 'text-slate-400 hover:text-slate-200' : 'text-slate-700 hover:text-slate-950 font-semibold'
              }`}
            >
              <FileCheck className="w-5 h-5" />
              <span className="text-[11px]">真题测验</span>
            </button>

            {/* Tab 3: Stats */}
            <button
              onClick={() => setActiveTab('stats')}
              className={`flex flex-col items-center gap-0.5 transition cursor-pointer ${
                activeTab === 'stats' 
                  ? 'text-[#051C2C] dark:text-sky-400 font-black' 
                  : isDarkMode ? 'text-slate-400 hover:text-slate-200' : 'text-slate-700 hover:text-slate-950 font-semibold'
              }`}
            >
              <BarChart2 className="w-5 h-5" />
              <span className="text-[11px]">备考看板</span>
            </button>

            {/* Tab 4: Settings (设定 - 齿轮图标，最右侧) */}
            <button
              onClick={() => setActiveTab('settings')}
              id="bottom-nav-settings"
              className={`flex flex-col items-center gap-0.5 transition cursor-pointer ${
                activeTab === 'settings' 
                  ? 'text-[#051C2C] dark:text-sky-400 font-black' 
                  : isDarkMode ? 'text-slate-400 hover:text-slate-200' : 'text-slate-700 hover:text-slate-950 font-semibold'
              }`}
            >
              <SettingsIcon className={`w-5 h-5 transition-transform duration-300 ${activeTab === 'settings' ? 'rotate-45' : ''}`} />
              <span className="text-[11px]">设定</span>
            </button>
          </nav>

          {/* Bottom Home Indicator Bar (iOS style) & Discreet secret trigger */}
          <div className={`pb-2 pt-1 flex flex-col items-center justify-center transition-colors duration-200 ${
            isDarkMode ? 'bg-slate-900' : 'bg-white'
          }`}>
            <div 
              onClick={handleVersionTap}
              className={`text-[9px] cursor-pointer transition ${
                isDarkMode ? 'text-slate-600 hover:text-slate-400' : 'text-gray-300 hover:text-gray-400'
              }`}
              title="连击3次可唤醒管理员后台"
            >
              CAQ 6σ Black Belt v1.2.0
            </div>
            <div className={`w-28 h-1 rounded-full mt-1 ${isDarkMode ? 'bg-slate-700' : 'bg-gray-300'}`} />
          </div>

        </div>
      </main>

      {/* Dedicated Wrong Notebook Modal with Retake Practice Mode */}
      <WrongNotebookModal
        isOpen={isWrongNotebookOpen}
        onClose={() => setIsWrongNotebookOpen(false)}
        cards={cards}
        wrongCardIds={stats.wrongCardIds}
        onRemoveWrong={onRemoveWrong}
        onClearAllWrong={onClearAllWrong}
      />
    </div>
  );
};
