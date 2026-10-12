import React, { useState, useRef } from 'react';

interface FastScrollerProps {
  letters: string[];
  onLetterSelect: (letter: string) => void;
}

const FastScroller: React.FC<FastScrollerProps> = ({ letters, onLetterSelect }) => {
  const [activeIndex, setActiveIndex] = useState(-1);
  const scrollerRef = useRef<HTMLDivElement>(null);

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!scrollerRef.current) return;

    const rect = scrollerRef.current.getBoundingClientRect();
    const touch = e.touches[0];
    const index = Math.floor((touch.clientY - rect.top) / (rect.height / letters.length));

    if (index >= 0 && index < letters.length && index !== activeIndex) {
      setActiveIndex(index);
      onLetterSelect(letters[index]);
    }
  };

  const handleTouchEnd = () => {
    setActiveIndex(-1);
  };

  return (
    <div
      ref={scrollerRef}
      className="fixed right-1 top-1/2 -translate-y-1/2 flex flex-col h-32 gap-0.5 select-none"
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {letters.map((letter, i) => (
        <div
          key={letter}
          className={`w-5 h-5 flex items-center justify-center text-xs font-semibold rounded-full transition-colors ${
            i === activeIndex
              ? 'bg-blue-600 text-white scale-125'
              : 'text-gray-500 dark:text-gray-400'
          }`}
        >
          {letter}
        </div>
      ))}
    </div>
  );
};

export default FastScroller;
