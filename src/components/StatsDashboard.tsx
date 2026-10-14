import React from 'react';
import { 
  BarChart3, 
  Flame, 
  Brain, 
  CheckCircle2, 
  Clock, 
  AlertCircle,
  Star,
  Layers,
  ArrowUpRight
} from 'lucide-react';
import { FlashCard, UserStats, DmaicStage } from '../types';
import { DMAIC_STAGES } from '../data/defaultCards';

interface StatsDashboardProps {
  cards: FlashCard[];
  stats: UserStats;
  onSelectStage: (stage: DmaicStage) => void;
  onOpenWrongCards: () => void;
  onOpenFavorites: () => void;
}

export const StatsDashboard: React.FC<StatsDashboardProps> = ({
  cards,
  stats,
  onSelectStage,
  onOpenWrongCards,
  onOpenFavorites,
}) => {
  const total = cards.length;
  const mastered = cards.filter(c => c.state === 'mastered').length;
  const learning = cards.filter(c => c.state === 'learning' || c.state === 'review').length;
  const newCards = cards.filter(c => c.state === 'new').length;

  const masteredRate = total > 0 ? Math.round((mastered / total) * 100) : 0;

  // Calculate DMAIC stage breakdown
  const stageStats = DMAIC_STAGES.filter(s => s.id !== 'all').map(stage => {
    const stageCards = cards.filter(c => c.stage === stage.id);
    const stageMastered = stageCards.filter(c => c.state === 'mastered').length;
    const rate = stageCards.length > 0 ? Math.round((stageMastered / stageCards.length) * 100) : 0;
    return {
      ...stage,
      total: stageCards.length,
      mastered: stageMastered,
      rate,
    };
  });

  return (
    <div className="flex flex-col h-full overflow-y-auto p-4 space-y-4 bg-gray-50/50">
      {/* Top Banner: Streak & Exam Goal */}
      <div className="bg-gradient-to-r from-emerald-600 to-teal-700 rounded-2xl p-4 text-white shadow-xs">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center">
              <Flame className="w-5 h-5 text-amber-300 fill-amber-300" />
            </div>
            <div>
              <span className="text-xs text-emerald-100 block">连续记忆打卡</span>
              <span className="text-sm font-bold">{stats.streakDays} 天连续复习</span>
            </div>
          </div>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/20 text-white font-mono">
            中质协 CAQ 认证标准
          </span>
        </div>
        <p className="text-[11px] text-emerald-100 leading-relaxed">
          基于 Anki 间隔重复 SM-2 算法，按每日任务推进，帮助六西格玛黑带考点形成长期记忆。
        </p>
      </div>

      {/* 4 Stats Cards */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-white p-3 rounded-xl border border-slate-200 text-center shadow-xs">
          <span className="text-[11px] text-slate-700 font-bold block mb-0.5">待学新卡</span>
          <span className="text-base font-black text-blue-700">{newCards}</span>
        </div>
        <div className="bg-white p-3 rounded-xl border border-slate-200 text-center shadow-xs">
          <span className="text-[11px] text-slate-700 font-bold block mb-0.5">复习巩固</span>
          <span className="text-base font-black text-amber-700">{learning}</span>
        </div>
        <div className="bg-white p-3 rounded-xl border border-slate-200 text-center shadow-xs">
          <span className="text-[11px] text-slate-700 font-bold block mb-0.5">熟练掌握</span>
          <span className="text-base font-black text-emerald-700">{mastered}</span>
        </div>
      </div>

      {/* Fast Action Shortcuts: Wrong Notebook & Favorites */}
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={onOpenWrongCards}
          className="flex items-center justify-between p-3 rounded-xl bg-white border border-red-200 hover:bg-red-50/50 transition text-left shadow-xs"
        >
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-red-100 text-red-700 flex items-center justify-center">
              <AlertCircle className="w-4 h-4" />
            </div>
            <div>
              <span className="text-xs font-bold text-slate-950 block">易错题本</span>
              <span className="text-[10px] text-slate-700 font-medium">{stats.wrongCardIds.length} 题待强化</span>
            </div>
          </div>
          <ArrowUpRight className="w-3.5 h-3.5 text-slate-500" />
        </button>

        <button
          onClick={onOpenFavorites}
          className="flex items-center justify-between p-3 rounded-xl bg-white border border-amber-200 hover:bg-amber-50/50 transition text-left shadow-xs"
        >
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center">
              <Star className="w-4 h-4" />
            </div>
            <div>
              <span className="text-xs font-bold text-slate-950 block">我的收藏</span>
              <span className="text-[10px] text-slate-700 font-medium">{stats.favoriteCardIds.length} 张核心卡</span>
            </div>
          </div>
          <ArrowUpRight className="w-3.5 h-3.5 text-slate-500" />
        </button>
      </div>

      {/* DMAIC Stage Mastery Breakdown */}
      <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-black text-slate-950 flex items-center gap-1.5">
            <Layers className="w-4 h-4 text-[#00629B]" />
            <span>DMAIC 知识体系掌握度</span>
          </h4>
          <span className="text-xs text-[#00629B] font-black">综合 {masteredRate}%</span>
        </div>

        <div className="space-y-2.5">
          {stageStats.map(item => (
            <div 
              key={item.id} 
              onClick={() => onSelectStage(item.id)}
              className="cursor-pointer group"
            >
              <div className="flex items-center justify-between text-[11px] mb-1">
                <span className="text-slate-900 font-bold group-hover:text-[#00629B] transition">
                  {item.name} ({item.total}卡)
                </span>
                <span className="text-slate-700 font-mono font-bold">{item.rate}%</span>
              </div>
              <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                <div 
                  className="bg-[#00629B] h-full rounded-full transition-all duration-500"
                  style={{ width: `${item.rate}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Exam Prep Tip */}
      <div className="p-3 bg-emerald-50/60 rounded-xl border border-emerald-100 text-[11px] text-emerald-900 leading-relaxed">
        <span className="font-bold">备考通关建议：</span>
        中质协黑带考试重点在“测量阶段 (MSA/能力分析)”与“改进阶段 (DOE)”。当某张卡片复习间隔达到 21 天以上时，即可视为永久记忆。
      </div>
    </div>
  );
};
