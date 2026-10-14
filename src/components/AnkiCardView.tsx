import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  RotateCw, 
  CheckCircle2, 
  Star, 
  Sparkles, 
  Clock, 
  Bookmark, 
  ChevronRight,
  BookOpen,
  HelpCircle,
  Volume2
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { FlashCard, ReviewRating, DmaicStage } from '../types';
import { calculateSm2Review, formatIntervalLabel } from '../utils/sm2';
import { DMAIC_STAGES } from '../data/defaultCards';

interface AnkiCardViewProps {
  cards: FlashCard[];
  onUpdateCard: (updatedCard: FlashCard) => void;
  selectedStage: DmaicStage;
  onSelectStage: (stage: DmaicStage) => void;
  favorites: string[];
  onToggleFavorite: (id: string) => void;
  isDarkMode?: boolean;
}

export const AnkiCardView: React.FC<AnkiCardViewProps> = ({
  cards,
  onUpdateCard,
  selectedStage,
  onSelectStage,
  favorites,
  onToggleFavorite,
  isDarkMode = false,
}) => {
  const [isFlipped, setIsFlipped] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [sessionCompleted, setSessionCompleted] = useState(false);

  // Filter cards by stage
  const filteredCards = cards.filter(c => {
    if (selectedStage === 'all') return true;
    return c.stage === selectedStage;
  });

  // Today's study queue: cards due for review or new cards
  const now = Date.now();
  const queueCards = filteredCards.filter(c => c.nextReviewDate <= now || c.state === 'new');
  const activeDeck = queueCards.length > 0 ? queueCards : filteredCards;

  const currentCard = activeDeck[currentIndex] || activeDeck[0];

  useEffect(() => {
    setIsFlipped(false);
    if (currentIndex >= activeDeck.length && activeDeck.length > 0) {
      setCurrentIndex(0);
    }
  }, [selectedStage, activeDeck.length]);

  // Keyboard shortcut listener for efficient desktop study (Space to flip, 1-4 for rating)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (sessionCompleted || !currentCard) return;

      if (e.code === 'Space') {
        e.preventDefault();
        setIsFlipped(prev => !prev);
      } else if (isFlipped) {
        if (e.key === '1') handleRate('again');
        if (e.key === '2') handleRate('hard');
        if (e.key === '3') handleRate('good');
        if (e.key === '4') handleRate('easy');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFlipped, currentCard, sessionCompleted]);

  const handleRate = (rating: ReviewRating) => {
    if (!currentCard) return;

    const updates = calculateSm2Review(currentCard, rating);
    const updatedCard: FlashCard = {
      ...currentCard,
      ...updates,
    };

    onUpdateCard(updatedCard);

    // Progress to next card
    if (currentIndex < activeDeck.length - 1) {
      setIsFlipped(false);
      setCurrentIndex(prev => prev + 1);
    } else {
      // Completed all due cards in current stage
      setSessionCompleted(true);
      confetti({
        particleCount: 80,
        spread: 70,
        origin: { y: 0.6 }
      });
    }
  };

  const restartSession = () => {
    setSessionCompleted(false);
    setCurrentIndex(0);
    setIsFlipped(false);
  };

  const currentStageInfo = DMAIC_STAGES.find(s => s.id === (currentCard?.stage || selectedStage));
  const isFav = currentCard ? favorites.includes(currentCard.id) : false;

  // Counts for Anki top badge
  const newCount = activeDeck.filter(c => c.state === 'new').length;
  const learningCount = activeDeck.filter(c => c.state === 'learning').length;
  const reviewCount = activeDeck.filter(c => c.state === 'review' || c.state === 'mastered').length;

  if (activeDeck.length === 0) {
    return (
      <div className={`flex flex-col h-full justify-between p-4 ${isDarkMode ? 'bg-[#0B132B] text-slate-100' : 'bg-slate-50 text-slate-900'}`}>
        <div className="flex flex-col items-center justify-center text-center my-auto">
          <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center mb-3">
            <CheckCircle2 className="w-7 h-7" />
          </div>
          <h3 className="text-[15px] font-bold mb-1">当前模块考点已全部掌握</h3>
          <p className="text-[12px] text-slate-500 dark:text-slate-400 max-w-xs mb-5">
            该阶段暂无待复习卡片，可切换到其他阶段或开启全科随机巩固。
          </p>
          <button
            onClick={() => onSelectStage('all')}
            className="px-5 py-2 text-[12px] font-semibold rounded-xl bg-[#051C2C] dark:bg-[#00629B] text-white shadow hover:opacity-90 transition cursor-pointer"
          >
            查看全科知识库
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col h-full select-none transition-colors ${
      isDarkMode ? 'bg-[#0B132B] text-slate-100' : 'bg-slate-50/70 text-slate-900'
    }`}>
      {/* Mini Anki Queue Status Bar */}
      <div className={`px-4 py-2 flex items-center justify-between border-b text-[11.5px] transition-colors ${
        isDarkMode ? 'bg-[#0F1D40]/60 border-slate-800 text-slate-300' : 'bg-slate-100/90 border-slate-300/80 text-slate-900 font-semibold'
      }`}>
        <div className="flex items-center gap-2">
          <span 
            className="font-bold"
            style={{ color: isDarkMode ? '#f8fafc' : '#020617' }}
          >
            卡片进度: <b className="font-black" style={{ color: isDarkMode ? '#38bdf8' : '#051C2C' }}>{currentIndex + 1}</b> / {activeDeck.length}
          </span>
          {selectedStage !== 'all' && (
            <button
              onClick={() => onSelectStage('all')}
              className={`px-1.5 py-0.2 rounded text-[10px] font-bold border transition cursor-pointer flex items-center gap-0.5 ${
                isDarkMode 
                  ? 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700' 
                  : 'bg-white text-slate-800 border-slate-300 hover:bg-slate-100'
              }`}
              title="点击恢复全科记忆"
            >
              <span>{DMAIC_STAGES.find(s => s.id === selectedStage)?.name || selectedStage}</span>
              <span className="text-[9px] opacity-70">✕</span>
            </button>
          )}
          <div className="flex items-center gap-1 text-[10.5px] font-mono">
            <span 
              className="px-1.5 py-0.2 rounded font-bold border"
              style={{ 
                backgroundColor: isDarkMode ? '#172554' : '#dbeafe', 
                color: isDarkMode ? '#bfdbfe' : '#1e3a8a',
                borderColor: isDarkMode ? '#1e3a8a' : '#bfdbfe' 
              }}
            >
              新:{newCount}
            </span>
            <span 
              className="px-1.5 py-0.2 rounded font-bold border"
              style={{ 
                backgroundColor: isDarkMode ? '#451a03' : '#fef3c7', 
                color: isDarkMode ? '#fde68a' : '#78350f',
                borderColor: isDarkMode ? '#78350f' : '#fde68a' 
              }}
            >
              学:{learningCount}
            </span>
            <span 
              className="px-1.5 py-0.2 rounded font-bold border"
              style={{ 
                backgroundColor: isDarkMode ? '#052e16' : '#d1fae5', 
                color: isDarkMode ? '#a7f3d0' : '#064e3b',
                borderColor: isDarkMode ? '#064e3b' : '#a7f3d0' 
              }}
            >
              复:{reviewCount}
            </span>
          </div>
        </div>

        {/* Favorite toggle button */}
        {currentCard && (
          <button
            onClick={() => onToggleFavorite(currentCard.id)}
            className={`p-1 rounded-md transition cursor-pointer ${
              isFav 
                ? isDarkMode ? 'text-amber-400 bg-amber-950/40' : 'text-amber-600 bg-amber-50' 
                : isDarkMode ? 'text-slate-400 hover:text-slate-100' : 'text-slate-600 hover:text-slate-950'
            }`}
            title={isFav ? '取消收藏' : '收藏此卡片'}
          >
            <Star className={`w-3.5 h-3.5 ${isFav ? 'fill-amber-500 text-amber-500' : ''}`} />
          </button>
        )}
      </div>

      {/* Main Flashcard Container */}
      <div className="flex-1 px-3.5 py-2 flex flex-col items-center justify-center relative min-h-0 overflow-hidden">
        {sessionCompleted ? (
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className={`w-full max-w-sm rounded-2xl border p-6 text-center shadow-lg transition-colors ${
              isDarkMode ? 'bg-[#142242] border-slate-700 text-slate-100' : 'bg-white border-slate-300 text-slate-950'
            }`}
          >
            <div className="w-12 h-12 rounded-full bg-emerald-500/10 text-emerald-600 flex items-center justify-center mx-auto mb-3">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <h3 className="text-[15px] font-extrabold mb-1 text-slate-950 dark:text-white">今日阶段卡包学习达成！</h3>
            <p className="text-[12px] text-slate-700 dark:text-slate-300 mb-5 font-medium">
              已完成该阶段待复习卡片，SM-2 算法已为您排定下次最佳复习周期。
            </p>
            <div className="flex gap-2">
              <button
                onClick={restartSession}
                className="flex-1 py-2 text-[12px] font-bold rounded-xl border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
              >
                再过一遍
              </button>
              <button
                onClick={() => onSelectStage('all')}
                className="flex-1 py-2 text-[12px] font-bold rounded-xl bg-[#051C2C] dark:bg-[#00629B] text-white hover:opacity-90 transition shadow-xs cursor-pointer"
              >
                全科随机刷
              </button>
            </div>
          </motion.div>
        ) : (
          currentCard && (
            <div 
              className="w-full h-full max-h-[460px] relative cursor-pointer"
              style={{ perspective: 1000 }}
              onClick={() => setIsFlipped(prev => !prev)}
            >
              <AnimatePresence mode="wait" initial={false}>
                {!isFlipped ? (
                  <motion.div
                    key={`front-${currentCard.id}`}
                    initial={{ rotateY: -90, opacity: 0.8 }}
                    animate={{ rotateY: 0, opacity: 1 }}
                    exit={{ rotateY: 90, opacity: 0.8 }}
                    transition={{ duration: 0.2, ease: "easeOut" }}
                    className={`w-full h-full rounded-2xl border shadow-xs p-4 flex flex-col justify-between overflow-y-auto transition-colors ${
                      isDarkMode 
                        ? 'bg-[#142242] border-slate-700 text-slate-100' 
                        : 'bg-white border-slate-300 text-slate-950'
                    }`}
                  >
                    {/* FRONT SIDE */}
                    <div className="flex flex-col h-full justify-between">
                      <div>
                        {/* Top tags & status */}
                        <div className="flex items-center justify-between mb-2.5">
                          <div className="flex items-center gap-1.5">
                            <span className={`px-2 py-0.5 rounded-full text-[10.5px] font-bold text-white ${
                              isDarkMode ? 'bg-[#00629B]' : 'bg-[#051C2C]'
                            }`}>
                              {currentStageInfo?.name || '黑带考点'}
                            </span>
                            {currentCard.tags.slice(0, 2).map((t, idx) => (
                              <span 
                                key={idx} 
                                className={`px-1.5 py-0.5 rounded text-[10.5px] font-bold border ${
                                  isDarkMode 
                                    ? 'bg-slate-700 text-slate-200 border-slate-600' 
                                    : 'bg-slate-100 text-slate-900 border-slate-300'
                                }`}
                                style={{ color: isDarkMode ? '#e2e8f0' : '#0f172a' }}
                              >
                                #{t}
                              </span>
                            ))}
                          </div>
                          <span 
                            className="text-[11.5px] font-bold font-mono"
                            style={{ color: isDarkMode ? '#cbd5e1' : '#1e293b' }}
                          >
                            复利: {currentCard.interval}d
                          </span>
                        </div>

                        {/* Question / Concept */}
                        <div className="my-auto pt-2 text-left">
                          <div 
                            className={`text-[14px] md:text-[15px] font-bold leading-relaxed tracking-normal ${
                              isDarkMode ? 'text-white' : 'text-slate-950'
                            }`}
                            style={{ color: isDarkMode ? '#ffffff' : '#020617' }}
                            dangerouslySetInnerHTML={{ __html: currentCard.front }}
                          />
                        </div>
                      </div>

                      {/* Flip prompt */}
                      <div 
                        className={`pt-2.5 border-t flex items-center justify-center text-[12px] font-bold gap-1.5 ${
                          isDarkMode ? 'border-slate-700' : 'border-slate-200'
                        }`}
                        style={{ color: isDarkMode ? '#38bdf8' : '#00629B' }}
                      >
                        <RotateCw className="w-3.5 h-3.5" />
                        <span>点击卡片或按空格查看答案解析</span>
                      </div>
                    </div>
                  </motion.div>
                ) : (
                  <motion.div
                    key={`back-${currentCard.id}`}
                    initial={{ rotateY: 90, opacity: 0.8 }}
                    animate={{ rotateY: 0, opacity: 1 }}
                    exit={{ rotateY: -90, opacity: 0.8 }}
                    transition={{ duration: 0.2, ease: "easeOut" }}
                    className={`w-full h-full rounded-2xl border shadow-xs p-4 flex flex-col justify-between overflow-y-auto transition-colors ${
                      isDarkMode 
                        ? 'bg-[#142242] border-[#00629B]/50 text-slate-100' 
                        : 'bg-white border-[#00629B]/40 text-slate-950'
                    }`}
                  >
                    {/* BACK SIDE */}
                    <div className="flex flex-col h-full justify-between">
                      <div className="overflow-y-auto pr-1">
                        <div className="flex items-center justify-between mb-2">
                          <span className={`px-2 py-0.5 rounded-full text-[10.5px] font-bold border ${
                            isDarkMode 
                              ? 'bg-blue-950/60 border-blue-800 text-sky-300' 
                              : 'bg-blue-100 border-blue-300 text-[#051C2C]'
                          }`}>
                            考点解析与标准答案
                          </span>
                          <span 
                            className="text-[11.5px] font-mono font-bold"
                            style={{ color: isDarkMode ? '#38bdf8' : '#00629B' }}
                          >
                            EF: {currentCard.easeFactor.toFixed(1)}
                          </span>
                        </div>

                        {/* Answer Content */}
                        <div 
                          className={`text-[13px] md:text-[14px] font-medium leading-relaxed space-y-1.5 text-left ${
                            isDarkMode ? 'text-slate-100' : 'text-slate-950'
                          }`}
                          style={{ color: isDarkMode ? '#f1f5f9' : '#020617' }}
                          dangerouslySetInnerHTML={{ __html: currentCard.back }}
                        />

                        {currentCard.explanation && (
                          <div 
                            className={`mt-2.5 p-2.5 rounded-xl border text-[12px] leading-relaxed text-left font-medium ${
                              isDarkMode 
                                ? 'bg-amber-950/30 border-amber-800/40 text-amber-200' 
                                : 'bg-amber-50/90 border-amber-300/80 text-slate-950'
                            }`}
                            style={{ color: isDarkMode ? '#fde68a' : '#0f172a' }}
                          >
                            <span className={`font-extrabold mr-1 ${isDarkMode ? 'text-amber-200' : 'text-amber-900'}`}>
                              💡 导师点拨：
                            </span>
                            {currentCard.explanation}
                          </div>
                        )}
                      </div>

                      <div 
                        className="pt-2 text-center text-[11.5px] font-medium"
                        style={{ color: isDarkMode ? '#cbd5e1' : '#475569' }}
                      >
                        请在下方评定本次回忆质量以排定下次推送
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )
        )}
      </div>

      {/* Bottom Section: SM-2 Action Bar (Visible when flipped) */}
      {isFlipped && (
        <div className={`p-2.5 pt-1.5 flex flex-col gap-2 border-t transition-colors ${
          isDarkMode ? 'bg-[#0F1D40]/90 border-slate-800' : 'bg-slate-100/90 border-slate-300'
        }`}>
          <div className="grid grid-cols-4 gap-1.5">
            {/* AGAIN */}
            <button
              id="anki-rate-again"
              onClick={() => handleRate('again')}
              className="flex flex-col items-center justify-center py-2 px-1 rounded-xl bg-rose-100/90 hover:bg-rose-200 border border-rose-300 text-rose-950 dark:bg-rose-950/40 dark:border-rose-900/50 dark:text-rose-300 transition cursor-pointer"
            >
              <span className="text-[11.5px] font-black">重来 (1)</span>
              <span className="text-[10px] text-rose-800 dark:text-rose-400 font-bold">{formatIntervalLabel(currentCard, 'again')}</span>
            </button>

            {/* HARD */}
            <button
              id="anki-rate-hard"
              onClick={() => handleRate('hard')}
              className="flex flex-col items-center justify-center py-2 px-1 rounded-xl bg-amber-100/90 hover:bg-amber-200 border border-amber-300 text-amber-950 dark:bg-amber-950/40 dark:border-amber-900/50 dark:text-amber-300 transition cursor-pointer"
            >
              <span className="text-[11.5px] font-black">困难 (2)</span>
              <span className="text-[10px] text-amber-800 dark:text-amber-400 font-bold">{formatIntervalLabel(currentCard, 'hard')}</span>
            </button>

            {/* GOOD */}
            <button
              id="anki-rate-good"
              onClick={() => handleRate('good')}
              className="flex flex-col items-center justify-center py-2 px-1 rounded-xl bg-sky-100/90 hover:bg-sky-200 border border-sky-300 text-[#051C2C] dark:bg-blue-950/40 dark:border-blue-900/50 dark:text-sky-300 transition cursor-pointer"
            >
              <span className="text-[11.5px] font-black">良好 (3)</span>
              <span className="text-[10px] text-[#004B77] dark:text-sky-400 font-bold">{formatIntervalLabel(currentCard, 'good')}</span>
            </button>

            {/* EASY */}
            <button
              id="anki-rate-easy"
              onClick={() => handleRate('easy')}
              className="flex flex-col items-center justify-center py-2 px-1 rounded-xl bg-emerald-100/90 hover:bg-emerald-200 border border-emerald-300 text-emerald-950 dark:bg-emerald-950/40 dark:border-emerald-900/50 dark:text-emerald-300 transition cursor-pointer"
            >
              <span className="text-[11.5px] font-black">简单 (4)</span>
              <span className="text-[10px] text-emerald-800 dark:text-emerald-400 font-bold">{formatIntervalLabel(currentCard, 'easy')}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
