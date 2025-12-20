import React, { useState } from 'react';
import { Flashcard } from '../types';
import { ChevronLeft, ChevronRight, RotateCw, ArrowLeft } from 'lucide-react';

interface FlashcardsProps {
  cards: Flashcard[];
  onBack: () => void;
}

export const Flashcards: React.FC<FlashcardsProps> = ({ cards, onBack }) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);

  if (!cards || cards.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 text-center text-slate-500">
        <p>No flashcards generated for this session.</p>
        <button onClick={onBack} className="mt-4 text-teal-600 hover:underline">
          Go back
        </button>
      </div>
    );
  }

  const handleNext = () => {
    setIsFlipped(false);
    setCurrentIndex((prev) => (prev + 1) % cards.length);
  };

  const handlePrev = () => {
    setIsFlipped(false);
    setCurrentIndex((prev) => (prev - 1 + cards.length) % cards.length);
  };

  return (
    <div className="h-full flex flex-col bg-slate-100 relative">
       {/* Header */}
      <div className="bg-white px-4 py-3 flex items-center justify-between border-b border-slate-200">
        <button onClick={onBack} className="flex items-center gap-2 text-slate-600 hover:text-slate-900">
          <ArrowLeft size={20} />
          <span className="font-medium">Back to Text</span>
        </button>
        <div className="text-sm font-bold text-slate-500">
          Card {currentIndex + 1} / {cards.length}
        </div>
      </div>

      {/* Card Area */}
      <div className="flex-1 flex items-center justify-center p-6 overflow-hidden">
        <div 
          className="relative w-full max-w-xl aspect-[3/2] cursor-pointer perspective-1000 group"
          onClick={() => setIsFlipped(!isFlipped)}
        >
          <div className={`
             relative w-full h-full duration-500 preserve-3d transition-transform shadow-xl rounded-2xl
             ${isFlipped ? 'rotate-y-180' : ''}
          `}>
            {/* Front */}
            <div className="absolute inset-0 backface-hidden bg-white rounded-2xl flex flex-col items-center justify-center p-8 text-center border border-slate-200">
               <span className="absolute top-4 left-4 text-xs font-bold text-slate-400 uppercase tracking-widest">Question</span>
               <p className="text-xl md:text-2xl font-medium text-slate-800 dir-rtl" dir="rtl">
                 {cards[currentIndex].question}
               </p>
               <div className="absolute bottom-4 text-xs text-slate-400">Click to flip</div>
            </div>

            {/* Back */}
            <div className="absolute inset-0 backface-hidden rotate-y-180 bg-teal-50 rounded-2xl flex flex-col items-center justify-center p-8 text-center border border-teal-100">
               <span className="absolute top-4 left-4 text-xs font-bold text-teal-600 uppercase tracking-widest">Answer</span>
               <p className="text-lg md:text-xl font-medium text-teal-900 dir-rtl leading-relaxed" dir="rtl">
                 {cards[currentIndex].answer}
               </p>
            </div>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="bg-white p-6 border-t border-slate-200 flex items-center justify-center gap-6">
         <button 
           onClick={handlePrev}
           className="p-3 rounded-full hover:bg-slate-100 text-slate-600 transition-colors"
         >
           <ChevronLeft size={24} />
         </button>
         
         <button 
           onClick={() => setIsFlipped(!isFlipped)}
           className="flex items-center gap-2 px-6 py-2 bg-slate-900 text-white rounded-full font-medium shadow-md hover:bg-slate-800 transition-transform active:scale-95"
         >
           <RotateCw size={16} />
           Flip
         </button>

         <button 
           onClick={handleNext}
           className="p-3 rounded-full hover:bg-slate-100 text-slate-600 transition-colors"
         >
           <ChevronRight size={24} />
         </button>
      </div>
    </div>
  );
};
