import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  AlertCircle, 
  RotateCcw, 
  CheckCircle2, 
  XCircle, 
  Lightbulb, 
  ArrowRight, 
  Sparkles, 
  RotateCw,
  BookOpen,
  Trash2,
  X
} from 'lucide-react';
import { FlashCard } from '../types';

interface WrongNotebookModalProps {
  isOpen: boolean;
  onClose: () => void;
  cards: FlashCard[];
  wrongCardIds: string[];
  onRemoveWrong: (cardId: string) => void;
  onClearAllWrong?: () => void;
}

export const WrongNotebookModal: React.FC<WrongNotebookModalProps> = ({
  isOpen,
  onClose,
  cards,
  wrongCardIds,
  onRemoveWrong,
  onClearAllWrong,
}) => {
  // Practice session state
  const [isPracticing, setIsPracticing] = useState(false);
  const [practiceDeck, setPracticeDeck] = useState<FlashCard[]>([]);
  const [practiceIndex, setPracticeIndex] = useState(0);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isFlipped, setIsFlipped] = useState(false);
  const [sessionScore, setSessionScore] = useState(0);
  const [justRemovedId, setJustRemovedId] = useState<string | null>(null);
  const [practiceFinished, setPracticeFinished] = useState(false);

  if (!isOpen) return null;

  // Find the actual card objects for wrong card IDs currently recorded
  const wrongCards = cards.filter(c => wrongCardIds.includes(c.id));
  const activePracticeCards = isPracticing ? practiceDeck : wrongCards;
  const currentCard = activePracticeCards[practiceIndex];

  const handleStartPractice = () => {
    if (wrongCards.length === 0) return;
    setPracticeDeck([...wrongCards]);
    setIsPracticing(true);
    setPracticeIndex(0);
    setSelectedOption(null);
    setIsSubmitted(false);
    setIsFlipped(false);
    setSessionScore(0);
    setJustRemovedId(null);
    setPracticeFinished(false);
  };

  const handleStopPractice = () => {
    setIsPracticing(false);
    setPracticeFinished(false);
    setSelectedOption(null);
    setIsSubmitted(false);
    setIsFlipped(false);
    setJustRemovedId(null);
  };

  // Submit choice answer
  const handleSubmitOption = () => {
    if (!selectedOption || !currentCard || isSubmitted) return;
    setIsSubmitted(true);

    const correct = (currentCard.correctAnswer || 'A').toString().trim().toUpperCase();
    const isCorrect = selectedOption.trim().toUpperCase() === correct;

    if (isCorrect) {
      setSessionScore(prev => prev + 1);
      setJustRemovedId(currentCard.id);
      // Auto-remove from wrong cards upon correct answer
      onRemoveWrong(currentCard.id);
    }
  };

  // Card self-rating in flashcard mode (did I get it right?)
  const handleMarkFlashcardMastered = (correct: boolean) => {
    if (!currentCard) return;
    if (correct) {
      setSessionScore(prev => prev + 1);
      setJustRemovedId(currentCard.id);
      onRemoveWrong(currentCard.id);
    }
    // Proceed to next
    handleNextCard();
  };

  const handleNextCard = () => {
    setJustRemovedId(null);
    setIsFlipped(false);
    setSelectedOption(null);
    setIsSubmitted(false);

    if (practiceIndex < activePracticeCards.length - 1) {
      setPracticeIndex(prev => prev + 1);
    } else {
      setPracticeFinished(true);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/60 backdrop-blur-xs select-none">
      <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh] border border-gray-100 animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="px-4 py-3 bg-white border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-red-50 text-red-600 flex items-center justify-center font-bold">
              <AlertCircle className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-gray-900">
                {isPracticing ? '错题专项重练' : '错题本'}
              </h2>
              <span className="text-[11px] text-gray-400">
                {isPracticing 
                  ? `进度 ${practiceIndex + 1} / ${activePracticeCards.length} 题 · 答对自动消灭` 
                  : `共收录 ${wrongCards.length} 道高频易错考点`}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1">
            {isPracticing && (
              <button
                onClick={handleStopPractice}
                className="px-2 py-1 text-[11px] rounded-lg text-gray-500 hover:bg-gray-100 transition"
              >
                退出重练
              </button>
            )}
            <button
              onClick={onClose}
              className="w-7 h-7 rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-700 flex items-center justify-center transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        {!isPracticing ? (
          /* LIST / OVERVIEW MODE */
          <div className="flex-1 overflow-y-auto p-4 flex flex-col justify-between">
            {wrongCards.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="w-14 h-14 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mb-3">
                  <CheckCircle2 className="w-7 h-7" />
                </div>
                <h3 className="text-sm font-bold text-gray-900 mb-1">错题本已全部清空！</h3>
                <p className="text-[12px] text-gray-500 max-w-xs mb-4">
                  太棒了！您已消灭所有被收录的错题。在日常背题或测验中做错的题目会自动记录到这里。
                </p>
                <button
                  onClick={onClose}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold shadow-xs transition"
                >
                  返回继续练习
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {/* Banner with action button */}
                <div className="bg-gradient-to-br from-red-500 to-rose-600 rounded-2xl p-4 text-white shadow-xs">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-medium bg-white/20 px-2 py-0.5 rounded-full">
                      中质协六西格玛备考 · 针对性拔高
                    </span>
                    <span className="text-xs font-bold font-mono">
                      {wrongCards.length} 题待攻克
                    </span>
                  </div>
                  <h4 className="text-sm font-bold mb-1">错题专项重练模式</h4>
                  <p className="text-[11px] text-red-100 mb-3 leading-relaxed">
                    仅对错题进行针对性特训，在答对题目后，系统会自动将其从错题列表中消除，帮助攻克薄弱环节。
                  </p>
                  <button
                    onClick={handleStartPractice}
                    className="w-full py-2.5 bg-white hover:bg-red-50 text-red-600 font-bold rounded-xl text-xs shadow-xs transition flex items-center justify-center gap-1.5"
                  >
                    <RotateCcw className="w-4 h-4 text-red-600" />
                    <span>立即开始专项重练 ({wrongCards.length}题)</span>
                  </button>
                </div>

                {/* Wrong cards list preview */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-[11px] text-gray-500 px-1 pt-1">
                    <span>收录题目列表</span>
                    {onClearAllWrong && (
                      <button 
                        onClick={onClearAllWrong}
                        className="text-gray-400 hover:text-red-500 transition flex items-center gap-1"
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>一键清空</span>
                      </button>
                    )}
                  </div>

                  {wrongCards.map((card, idx) => (
                    <div 
                      key={card.id}
                      className="p-3 bg-gray-50/80 rounded-xl border border-gray-100 flex items-start justify-between gap-2"
                    >
                      <div className="flex-1 text-left">
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-red-100 text-red-700">
                            错题 #{idx + 1}
                          </span>
                          <span className="text-[11px] text-gray-400">
                            {card.stage.toUpperCase()} 阶段
                          </span>
                        </div>
                        <p 
                          className="text-[12px] text-gray-800 line-clamp-2 leading-relaxed"
                          dangerouslySetInnerHTML={{ __html: card.front }}
                        />
                      </div>
                      <button
                        onClick={() => onRemoveWrong(card.id)}
                        className="text-gray-300 hover:text-red-500 transition p-1 shrink-0"
                        title="移出错题本"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : practiceFinished ? (
          /* PRACTICE FINISHED SCREEN */
          <div className="p-6 text-center flex flex-col items-center justify-center min-h-[360px]">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="flex flex-col items-center"
            >
              <div className="w-16 h-16 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mb-3">
                <Sparkles className="w-8 h-8 text-emerald-500" />
              </div>
              <h3 className="text-base font-bold text-gray-900 mb-1">本轮重练已完成！</h3>
              <p className="text-[12px] text-gray-500 mb-4">
                本次重练攻克答对并自动移除了 <span className="font-bold text-emerald-600">{sessionScore}</span> 道错题。
              </p>

              <div className="bg-gray-50 rounded-2xl p-4 w-full mb-5 border border-gray-100">
                <div className="flex items-center justify-between text-xs mb-2">
                  <span className="text-gray-500">剩余错题数</span>
                  <span className="font-bold text-gray-800">{wrongCardIds.length} 题</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-500">本次清除率</span>
                  <span className="font-bold text-emerald-600">
                    {wrongCards.length > 0 ? Math.round((sessionScore / wrongCards.length) * 100) : 100}%
                  </span>
                </div>
              </div>

              <div className="flex gap-2 w-full">
                {wrongCardIds.length > 0 ? (
                  <button
                    onClick={handleStartPractice}
                    className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold rounded-xl transition shadow-xs flex items-center justify-center gap-1.5"
                  >
                    <RotateCcw className="w-4 h-4" />
                    <span>继续练习剩余错题</span>
                  </button>
                ) : (
                  <button
                    onClick={handleStopPractice}
                    className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-xl transition shadow-xs"
                  >
                    全部掌握，返回
                  </button>
                )}
                <button
                  onClick={handleStopPractice}
                  className="px-4 py-2.5 border border-gray-200 text-gray-700 text-xs font-medium rounded-xl hover:bg-gray-50 transition"
                >
                  完成
                </button>
              </div>
            </motion.div>
          </div>
        ) : (
          /* ACTIVE PRACTICE SCREEN */
          <div className="flex-1 p-4 overflow-y-auto flex flex-col justify-between">
            {currentCard && (
              <div className="space-y-3">
                {/* Card Top Pill */}
                <div className="flex items-center justify-between text-[11px] text-gray-500">
                  <div className="flex items-center gap-1.5">
                    <span className="px-2 py-0.5 rounded-full font-semibold bg-red-50 text-red-600 border border-red-200">
                      错题 #{practiceIndex + 1}
                    </span>
                    <span className="text-gray-400">
                      {currentCard.cardType === 'single_choice' ? '单选题' : '概念卡片'}
                    </span>
                  </div>
                  {justRemovedId === currentCard.id && (
                    <motion.span 
                      initial={{ scale: 0.8, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      className="text-emerald-600 font-bold flex items-center gap-0.5"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      已自动移出错题本
                    </motion.span>
                  )}
                </div>

                {/* Question Content */}
                <div className="bg-white rounded-2xl p-3.5 border border-gray-200/90 shadow-2xs">
                  <h4 
                    className="text-[13px] md:text-[14px] font-medium text-gray-900 leading-relaxed text-left tracking-normal"
                    dangerouslySetInnerHTML={{ __html: currentCard.front }}
                  />
                </div>

                {/* Question Type 1: Single Choice Options */}
                {currentCard.options && currentCard.options.length > 0 ? (
                  <div className="space-y-2">
                    {currentCard.options.map((option, idx) => {
                      const prefix = option.trim().charAt(0).toUpperCase();
                      const isChosen = selectedOption === prefix;
                      const correctAns = (currentCard.correctAnswer || 'A').toString().trim().toUpperCase();
                      const isThisCorrect = isSubmitted && prefix === correctAns;
                      const isThisWrong = isSubmitted && isChosen && prefix !== correctAns;

                      let btnStyle = 'bg-white border-gray-200 text-gray-700 hover:border-red-200';
                      if (isChosen && !isSubmitted) {
                        btnStyle = 'bg-red-50 border-red-500 text-red-900 font-medium';
                      } else if (isThisCorrect) {
                        btnStyle = 'bg-emerald-100 border-emerald-600 text-emerald-900 font-bold';
                      } else if (isThisWrong) {
                        btnStyle = 'bg-red-50 border-red-500 text-red-900';
                      }

                      return (
                        <button
                          key={idx}
                          onClick={() => !isSubmitted && setSelectedOption(prefix)}
                          disabled={isSubmitted}
                          className={`w-full p-2.5 rounded-xl border text-left text-[13px] leading-relaxed transition flex items-center justify-between ${btnStyle}`}
                        >
                          <span>{option}</span>
                          {isThisCorrect && <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 ml-2" />}
                          {isThisWrong && <XCircle className="w-4 h-4 text-red-500 shrink-0 ml-2" />}
                        </button>
                      );
                    })}

                    {/* Explanation after submission */}
                    {isSubmitted && (
                      <motion.div
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="p-3 rounded-xl bg-gray-50 border border-gray-200 text-left space-y-1.5 mt-2"
                      >
                        <div className="flex items-center gap-1.5 text-[12px] font-bold text-gray-900">
                          <Lightbulb className="w-3.5 h-3.5 text-amber-500" />
                          <span>考点解析（参考答案：{currentCard.correctAnswer}）</span>
                        </div>
                        <div 
                          className="text-[13px] text-gray-700 leading-relaxed"
                          dangerouslySetInnerHTML={{ __html: currentCard.back }}
                        />
                        {currentCard.explanation && (
                          <div className="text-[11px] text-amber-900 bg-amber-50 p-2 rounded-lg border border-amber-200/60 mt-1">
                            {currentCard.explanation}
                          </div>
                        )}
                      </motion.div>
                    )}
                  </div>
                ) : (
                  /* Question Type 2: Flashcard Concept review with flip */
                  <div className="space-y-3">
                    {!isFlipped ? (
                      <button
                        onClick={() => setIsFlipped(true)}
                        className="w-full py-4 px-3 bg-gray-50 border border-dashed border-gray-300 rounded-2xl flex flex-col items-center justify-center text-gray-500 hover:text-emerald-700 hover:border-emerald-300 transition gap-1.5"
                      >
                        <RotateCw className="w-4 h-4" />
                        <span className="text-[12px] font-medium">点击翻转查看背面解析</span>
                      </button>
                    ) : (
                      <div className="p-3.5 bg-emerald-50/50 border border-emerald-200 rounded-2xl text-left space-y-2">
                        <span className="text-[11px] font-bold text-emerald-800 block">
                          背诵要诀与答案解析：
                        </span>
                        <div 
                          className="text-[13px] text-gray-800 leading-relaxed"
                          dangerouslySetInnerHTML={{ __html: currentCard.back }}
                        />
                        {currentCard.explanation && (
                          <div className="text-[11px] text-amber-900 bg-amber-50 p-2 rounded-lg border border-amber-200/60">
                            💡 {currentCard.explanation}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Bottom Actions */}
            <div className="pt-4 border-t border-gray-100">
              {currentCard?.options && currentCard.options.length > 0 ? (
                /* Choice Question Bottom Buttons */
                !isSubmitted ? (
                  <button
                    onClick={handleSubmitOption}
                    disabled={!selectedOption}
                    className={`w-full py-2.5 text-[13px] font-semibold rounded-xl transition ${
                      selectedOption 
                        ? 'bg-red-600 hover:bg-red-700 text-white shadow-xs' 
                        : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                    }`}
                  >
                    确认提交
                  </button>
                ) : (
                  <button
                    onClick={handleNextCard}
                    className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-[13px] font-semibold rounded-xl transition flex items-center justify-center gap-1.5 shadow-xs"
                  >
                    <span>{practiceIndex < wrongCards.length - 1 ? '下一题' : '查看重练结果'}</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                )
              ) : (
                /* Flashcard Self Evaluation Buttons */
                isFlipped && (
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => handleMarkFlashcardMastered(false)}
                      className="py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold rounded-xl transition flex items-center justify-center gap-1"
                    >
                      <XCircle className="w-4 h-4 text-red-500" />
                      <span>仍未掌握 (保留)</span>
                    </button>
                    <button
                      onClick={() => handleMarkFlashcardMastered(true)}
                      className="py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-xl transition flex items-center justify-center gap-1 shadow-xs"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      <span>已掌握 (移出错题)</span>
                    </button>
                  </div>
                )
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  );
};
