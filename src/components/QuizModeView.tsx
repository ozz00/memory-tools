import React, { useState } from 'react';
import { motion } from 'motion/react';
import { CheckCircle2, XCircle, ArrowRight, RotateCcw, Award, Lightbulb } from 'lucide-react';
import { FlashCard, DmaicStage } from '../types';
import { DMAIC_STAGES } from '../data/defaultCards';

interface QuizModeViewProps {
  cards: FlashCard[];
  selectedStage: DmaicStage;
  onSelectStage: (stage: DmaicStage) => void;
  onRecordWrong: (cardId: string) => void;
  wrongCardIds?: string[];
  onRemoveWrong?: (cardId: string) => void;
}

export const QuizModeView: React.FC<QuizModeViewProps> = ({
  cards,
  selectedStage,
  onSelectStage,
  onRecordWrong,
  wrongCardIds = [],
  onRemoveWrong,
}) => {
  // Mode toggle: normal mode or wrong questions practice mode
  const [isWrongOnlyMode, setIsWrongOnlyMode] = useState(false);

  // Filter cards based on current mode
  const quizCards = cards.filter(c => {
    const hasOptions = c.options && c.options.length > 0;
    if (!hasOptions) return false;

    if (isWrongOnlyMode) {
      return wrongCardIds.includes(c.id);
    }
    const stageMatch = selectedStage === 'all' || c.stage === selectedStage;
    return stageMatch;
  });

  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [score, setScore] = useState(0);
  const [completed, setCompleted] = useState(false);
  const [justClearedCurrent, setJustClearedCurrent] = useState(false);

  const currentCard = quizCards[currentIndex];

  const handleSelectOption = (optPrefix: string) => {
    if (isSubmitted) return;
    setSelectedOption(optPrefix);
  };

  const handleSubmitAnswer = () => {
    if (!selectedOption || !currentCard) return;

    setIsSubmitted(true);

    const correct = currentCard.correctAnswer || 'A';
    const isCorrect = selectedOption.toUpperCase() === correct.toUpperCase();

    if (isCorrect) {
      setScore(prev => prev + 1);
      // If answered correctly and this card is in wrongCardIds, auto-remove it!
      if (wrongCardIds.includes(currentCard.id) && onRemoveWrong) {
        onRemoveWrong(currentCard.id);
        setJustClearedCurrent(true);
      }
    } else {
      onRecordWrong(currentCard.id);
    }
  };

  const handleNextQuestion = () => {
    setJustClearedCurrent(false);
    if (currentIndex < quizCards.length - 1) {
      setCurrentIndex(prev => prev + 1);
      setSelectedOption(null);
      setIsSubmitted(false);
    } else {
      setCompleted(true);
    }
  };

  const handleRestart = () => {
    setCurrentIndex(0);
    setSelectedOption(null);
    setIsSubmitted(false);
    setScore(0);
    setCompleted(false);
    setJustClearedCurrent(false);
  };

  if (quizCards.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-center min-h-[420px]">
        <div className={`w-14 h-14 rounded-full flex items-center justify-center mb-3 ${isWrongOnlyMode ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-600'}`}>
          {isWrongOnlyMode ? <CheckCircle2 className="w-7 h-7" /> : <Lightbulb className="w-7 h-7" />}
        </div>
        <h3 className="text-base font-bold text-gray-800 mb-1">
          {isWrongOnlyMode ? '错题已全部清空！' : '该阶段暂无选择题'}
        </h3>
        <p className="text-xs text-gray-500 max-w-xs mb-5">
          {isWrongOnlyMode 
            ? '太棒了！您已在错题重练中攻克消灭了所有易错题，当前题库中暂无待复习错题。' 
            : '当前模块以概念速记卡为主。您可以切换到测量阶段、分析阶段或全科题库进行真题测验。'}
        </p>
        <button
          onClick={() => {
            if (isWrongOnlyMode) {
              setIsWrongOnlyMode(false);
              handleRestart();
            } else {
              onSelectStage('all');
            }
          }}
          className="px-4 py-2 text-xs font-semibold rounded-full bg-emerald-600 text-white shadow-xs hover:bg-emerald-700 transition"
        >
          {isWrongOnlyMode ? '返回全科真题测验' : '查看全科真题 (含选择题)'}
        </button>
      </div>
    );
  }

  if (completed) {
    const accuracy = Math.round((score / quizCards.length) * 100);
    return (
      <div className="flex flex-col items-center justify-center p-6 text-center min-h-[420px]">
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="w-full max-w-sm bg-white rounded-2xl p-6 border border-gray-100 shadow-xs flex flex-col items-center"
        >
          <div className="w-16 h-16 rounded-full bg-amber-50 text-amber-500 flex items-center justify-center mb-3">
            <Award className="w-8 h-8" />
          </div>
          <h3 className="text-base font-bold text-gray-900 mb-1">
            {isWrongOnlyMode ? '错题重练完成' : '测验完成'}
          </h3>
          <p className="text-xs text-gray-500 mb-4">
            {isWrongOnlyMode 
              ? `本次答对 ${score} 道错题，已自动从错题本中移除` 
              : '中国质量协会六西格玛黑带模拟练习'}
          </p>

          <div className="grid grid-cols-2 gap-3 w-full mb-6">
            <div className="p-3 bg-gray-50 rounded-xl">
              <span className="text-xs text-gray-400 block">{isWrongOnlyMode ? '攻克消灭' : '答对题目'}</span>
              <span className="text-lg font-bold text-gray-800">{score} / {quizCards.length}</span>
            </div>
            <div className="p-3 bg-gray-50 rounded-xl">
              <span className="text-xs text-gray-400 block">正确率</span>
              <span className={`text-lg font-bold ${accuracy >= 70 ? 'text-emerald-600' : 'text-amber-600'}`}>
                {accuracy}%
              </span>
            </div>
          </div>

          <div className="w-full flex flex-col gap-2">
            <button
              onClick={handleRestart}
              className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-xl transition flex items-center justify-center gap-1.5 shadow-xs"
            >
              <RotateCcw className="w-4 h-4" />
              <span>{isWrongOnlyMode ? '重新开始错题重练' : '重新测验'}</span>
            </button>
            {isWrongOnlyMode && (
              <button
                onClick={() => {
                  setIsWrongOnlyMode(false);
                  handleRestart();
                }}
                className="w-full py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-medium rounded-xl transition"
              >
                返回全科真题测验
              </button>
            )}
          </div>
        </motion.div>
      </div>
    );
  }

  const correctAns = (currentCard.correctAnswer || 'A').toUpperCase();

  return (
    <div className="flex flex-col h-full select-none">
      {/* Mode Switch Bar: Normal Quiz vs Wrong Question Retake Mode */}
      <div className="px-3 py-1.5 bg-gray-100/90 border-b border-gray-200 flex items-center justify-between">
        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              if (isWrongOnlyMode) {
                setIsWrongOnlyMode(false);
                handleRestart();
              }
            }}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition ${
              !isWrongOnlyMode 
                ? 'bg-white text-emerald-700 font-semibold shadow-2xs' 
                : 'text-gray-500 hover:text-gray-900'
            }`}
          >
            全部真题
          </button>
          <button
            onClick={() => {
              if (!isWrongOnlyMode) {
                setIsWrongOnlyMode(true);
                handleRestart();
              }
            }}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition flex items-center gap-1 ${
              isWrongOnlyMode 
                ? 'bg-red-600 text-white font-semibold shadow-2xs' 
                : 'text-gray-600 hover:text-red-600'
            }`}
          >
            <span>错题重练</span>
            <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono font-bold ${
              isWrongOnlyMode ? 'bg-red-700 text-white' : 'bg-red-100 text-red-600'
            }`}>
              {wrongCardIds.length}
            </span>
          </button>
        </div>

        {isWrongOnlyMode && (
          <span className="text-[11px] text-red-600 font-medium">
            🎯 答对自动移出错题
          </span>
        )}
      </div>

      {/* Stage selector: 2-row fixed layout, only shown in standard mode */}
      {!isWrongOnlyMode && (
        <div className="px-2.5 py-2 border-b border-gray-100 bg-gray-50/90 flex flex-col gap-1.5">
          {/* Row 1: 5 items */}
          <div className="grid grid-cols-5 gap-1.5">
            {DMAIC_STAGES.slice(0, 5).map(stage => {
              const isSelected = selectedStage === stage.id;
              return (
                <button
                  key={stage.id}
                  id={`quiz-stage-${stage.id}`}
                  onClick={() => {
                    onSelectStage(stage.id);
                    handleRestart();
                  }}
                  className={`py-1 px-0.5 rounded-lg text-[11px] font-bold transition text-center whitespace-nowrap overflow-hidden text-ellipsis ${
                    isSelected
                      ? 'bg-[#00629B] text-white font-black shadow-xs'
                      : 'bg-white text-slate-900 border border-slate-300 font-bold hover:bg-slate-100'
                  }`}
                  title={stage.name}
                >
                  {stage.shortName || stage.name}
                </button>
              );
            })}
          </div>

          {/* Row 2: 4 items */}
          <div className="grid grid-cols-4 gap-1.5">
            {DMAIC_STAGES.slice(5).map(stage => {
              const isSelected = selectedStage === stage.id;
              return (
                <button
                  key={stage.id}
                  id={`quiz-stage-${stage.id}`}
                  onClick={() => {
                    onSelectStage(stage.id);
                    handleRestart();
                  }}
                  className={`py-1 px-0.5 rounded-lg text-[11px] font-bold transition text-center whitespace-nowrap overflow-hidden text-ellipsis ${
                    isSelected
                      ? 'bg-[#00629B] text-white font-black shadow-xs'
                      : 'bg-white text-slate-900 border border-slate-300 font-bold hover:bg-slate-100'
                  }`}
                  title={stage.name}
                >
                  {stage.shortName || stage.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Progress header: 11-12px secondary text */}
      <div className="px-4 py-2 flex items-center justify-between text-[12px] text-gray-500 bg-white border-b border-gray-50">
        <span className={`font-medium ${isWrongOnlyMode ? 'text-red-600 font-semibold' : 'text-emerald-700'}`}>
          {isWrongOnlyMode ? '⚡ 错题专练' : '真题练习'}：第 {currentIndex + 1} / {quizCards.length} 题
        </span>
        <div className="flex items-center gap-2">
          {justClearedCurrent && (
            <span className="text-[11px] text-emerald-600 font-bold flex items-center gap-0.5 animate-pulse">
              <CheckCircle2 className="w-3.5 h-3.5" />
              已移出错题本
            </span>
          )}
          <span className="text-gray-400 font-mono text-[11px]">得分: {score}</span>
        </div>
      </div>

      {/* Question container */}
      <div className="flex-1 p-3.5 overflow-y-auto space-y-3">
        <div className="bg-white rounded-2xl p-3.5 border border-gray-100 shadow-xs">
          <div className="flex items-center gap-2 mb-2">
            <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
              单选题
            </span>
            <span className="text-[11px] text-gray-400">
              {currentCard.tags.join(' · ')}
            </span>
          </div>
          {/* Question title: 13-14px primary body text */}
          <h4 
            className="text-[13.5px] md:text-[14.5px] font-bold text-slate-950 leading-relaxed text-left tracking-normal"
            dangerouslySetInnerHTML={{ __html: currentCard.front }}
          />
        </div>

        {/* Options: 13-14px option text */}
        <div className="space-y-2">
          {currentCard.options?.map((option, idx) => {
            const prefix = option.trim().charAt(0).toUpperCase();
            const isChosen = selectedOption === prefix;
            const isThisCorrect = isSubmitted && prefix === correctAns;
            const isThisWrong = isSubmitted && isChosen && prefix !== correctAns;

            let btnStyle = 'bg-white border-slate-300 text-slate-950 font-semibold hover:border-slate-400';
            if (isChosen && !isSubmitted) {
              btnStyle = 'bg-blue-50 border-[#00629B] text-[#051C2C] font-bold';
            } else if (isThisCorrect) {
              btnStyle = 'bg-emerald-50 border-emerald-600 text-emerald-950 font-bold';
            } else if (isThisWrong) {
              btnStyle = 'bg-rose-50 border-rose-500 text-rose-950 font-bold';
            }

            return (
              <button
                key={idx}
                id={`quiz-opt-${idx}`}
                onClick={() => handleSelectOption(prefix)}
                disabled={isSubmitted}
                className={`w-full p-3 rounded-xl border text-left text-[13px] md:text-[14px] leading-relaxed transition flex items-center justify-between ${btnStyle}`}
              >
                <span>{option}</span>
                {isThisCorrect && <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 ml-2" />}
                {isThisWrong && <XCircle className="w-4 h-4 text-red-500 shrink-0 ml-2" />}
              </button>
            );
          })}
        </div>

        {/* Feedback / Explanation on submit */}
        {isSubmitted && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-3.5 rounded-xl bg-slate-50 border border-slate-300 text-left space-y-2"
          >
            <div className="flex items-center gap-1.5 text-[12px] font-bold text-slate-950">
              <Lightbulb className="w-4 h-4 text-amber-600" />
              <span>考点解析（参考答案：{correctAns}）</span>
            </div>
            {/* Explanation body: 13-14px primary text */}
            <div 
              className="text-[13px] md:text-[14px] text-slate-900 font-medium leading-relaxed"
              dangerouslySetInnerHTML={{ __html: currentCard.back }}
            />
          </motion.div>
        )}
      </div>

      {/* Bottom action button */}
      <div className="p-3 bg-white border-t border-gray-100">
        {!isSubmitted ? (
          <button
            id="quiz-submit-btn"
            onClick={handleSubmitAnswer}
            disabled={!selectedOption}
            className={`w-full py-2.5 text-[13px] font-semibold rounded-xl transition ${
              selectedOption
                ? 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-xs'
                : 'bg-gray-100 text-gray-400 cursor-not-allowed'
            }`}
          >
            确认提交
          </button>
        ) : (
          <button
            id="quiz-next-btn"
            onClick={handleNextQuestion}
            className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-[13px] font-semibold rounded-xl transition flex items-center justify-center gap-1 shadow-xs"
          >
            <span>{currentIndex < quizCards.length - 1 ? '下一题' : '查看测验结果'}</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
};
