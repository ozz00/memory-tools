/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { WeChatSimulator } from './components/WeChatSimulator';
import { AdminBackstageModal } from './components/AdminBackstageModal';
import { INITIAL_CARDS } from './data/defaultCards';
import { FlashCard, UserStats, DmaicStage } from './types';

// ⚠️ 这是**旧 React 原型**，只用于开发期的界面比稿，不是线上形态。
// key 名与小程序端相同，但走的是浏览器 localStorage（5MB 总量、无单键限制），
// 命名空间完全独立 —— 小程序已在 2026-09-10 改为**分片存储**（miniprogram/utils/cardShards.js），
// 本文件**有意不跟随**，不要因为「两边 key 名一样」就以为存储结构同步。
const STORAGE_KEY_CARDS = 'caq_6sigma_flashcards_v1';
const STORAGE_KEY_STATS = 'caq_6sigma_user_stats_v1';

export default function App() {
  const [cards, setCards] = useState<FlashCard[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_CARDS);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch (e) {
      console.error('Failed to load cards from storage', e);
    }
    return INITIAL_CARDS;
  });

  const [stats, setStats] = useState<UserStats>(() => {
    const todayStr = new Date().toISOString().split('T')[0];
    try {
      const saved = localStorage.getItem(STORAGE_KEY_STATS);
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          ...parsed,
          lastActiveDate: todayStr,
        };
      }
    } catch (e) {
      console.error('Failed to load stats from storage', e);
    }

    return {
      totalReviewed: 12,
      cardsMastered: 3,
      cardsLearning: 5,
      cardsNew: 4,
      streakDays: 4,
      lastActiveDate: todayStr,
      wrongCardIds: ['caq-bb-005'],
      favoriteCardIds: ['caq-bb-004', 'caq-bb-009'],
    };
  });

  const [selectedStage, setSelectedStage] = useState<DmaicStage>('all');
  const [isAdminOpen, setIsAdminOpen] = useState(false);

  // Sync cards to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_CARDS, JSON.stringify(cards));
    } catch (e) {
      console.error('Failed to persist cards', e);
    }
  }, [cards]);

  // Sync stats to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_STATS, JSON.stringify(stats));
    } catch (e) {
      console.error('Failed to persist stats', e);
    }
  }, [stats]);

  // Handle individual card update from SM-2 rating
  const handleUpdateCard = (updatedCard: FlashCard) => {
    setCards(prev => prev.map(c => (c.id === updatedCard.id ? updatedCard : c)));
    setStats(prev => ({
      ...prev,
      totalReviewed: prev.totalReviewed + 1,
    }));
  };

  // Handle batch import from admin backstage
  const handleImportCards = (newCards: FlashCard[], mode: 'append' | 'replace') => {
    if (mode === 'replace') {
      setCards(newCards);
    } else {
      // Append without duplicating IDs
      setCards(prev => {
        const existingIds = new Set(prev.map(c => c.id));
        const filteredNew = newCards.filter(c => !existingIds.has(c.id));
        return [...prev, ...filteredNew];
      });
    }
  };

  // Reset to default cards
  const handleResetDefault = () => {
    setCards(INITIAL_CARDS);
  };

  // Toggle favorite
  const handleToggleFavorite = (id: string) => {
    setStats(prev => {
      const exists = prev.favoriteCardIds.includes(id);
      return {
        ...prev,
        favoriteCardIds: exists
          ? prev.favoriteCardIds.filter(x => x !== id)
          : [...prev.favoriteCardIds, id],
      };
    });
  };

  // Record wrong answer in quiz
  const handleRecordWrong = (id: string) => {
    setStats(prev => {
      if (prev.wrongCardIds.includes(id)) return prev;
      return {
        ...prev,
        wrongCardIds: [...prev.wrongCardIds, id],
      };
    });
  };

  // Remove card from wrongCardIds when answered correctly during review/retake
  const handleRemoveWrong = (id: string) => {
    setStats(prev => ({
      ...prev,
      wrongCardIds: prev.wrongCardIds.filter(x => x !== id),
    }));
  };

  // Clear all wrong cards
  const handleClearAllWrong = () => {
    setStats(prev => ({
      ...prev,
      wrongCardIds: [],
    }));
  };

  return (
    <div className="min-h-screen bg-slate-900">
      <WeChatSimulator
        cards={cards}
        stats={stats}
        onUpdateCard={handleUpdateCard}
        selectedStage={selectedStage}
        onSelectStage={setSelectedStage}
        favorites={stats.favoriteCardIds}
        onToggleFavorite={handleToggleFavorite}
        onRecordWrong={handleRecordWrong}
        onRemoveWrong={handleRemoveWrong}
        onClearAllWrong={handleClearAllWrong}
        onOpenAdmin={() => setIsAdminOpen(true)}
      />

      <AdminBackstageModal
        isOpen={isAdminOpen}
        onClose={() => setIsAdminOpen(false)}
        cards={cards}
        onImportCards={handleImportCards}
        onResetDefault={handleResetDefault}
      />
    </div>
  );
}
