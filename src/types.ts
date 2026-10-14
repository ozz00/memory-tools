export type DmaicStage = 
  | 'all' 
  | 'overview' 
  | 'define' 
  | 'measure' 
  | 'analyze' 
  | 'improve' 
  | 'control' 
  | 'lean' 
  | 'dfss';

export type CardType = 'flashcard' | 'single_choice' | 'multiple_choice';

export type CardState = 'new' | 'learning' | 'review' | 'mastered';

export type ReviewRating = 'again' | 'hard' | 'good' | 'easy';

export interface FlashCard {
  id: string;
  front: string;
  back: string;
  explanation?: string;
  options?: string[];
  correctAnswer?: string | string[];
  stage: DmaicStage;
  tags: string[];
  cardType: CardType;
  
  // SM-2 Spaced Repetition Metrics
  interval: number;       // In days (0 = same day review)
  repetitions: number;    // Consecutive correct reviews
  easeFactor: number;     // Multiplier, default 2.5 (min 1.3)
  nextReviewDate: number; // Timestamp in milliseconds
  state: CardState;
  lastReviewed?: number;
  history?: {
    date: number;
    rating: ReviewRating;
  }[];
}

export interface UserStats {
  totalReviewed: number;
  cardsMastered: number;
  cardsLearning: number;
  cardsNew: number;
  streakDays: number;
  lastActiveDate: string;
  wrongCardIds: string[];
  favoriteCardIds: string[];
}

export interface ParseResult {
  success: boolean;
  totalParsed: number;
  cards: FlashCard[];
  deckName?: string;
  message: string;
  error?: string;
}
