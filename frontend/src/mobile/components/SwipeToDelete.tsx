import React, { useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';

interface SwipeToDeleteProps {
  onDelete: () => void;
  children: React.ReactNode;
}

const THRESHOLD = 70;

const SwipeToDelete: React.FC<SwipeToDeleteProps> = ({ onDelete, children }) => {
  const startX = useRef(0);
  const currentX = useRef(0);
  const [offset, setOffset] = useState(0);
  const [swiping, setSwiping] = useState(false);

  const handleTouchStart = (e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX;
    currentX.current = startX.current;
    setSwiping(true);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!swiping) return;
    currentX.current = e.touches[0].clientX;
    const diff = startX.current - currentX.current;
    // Only allow left swipe, capped at 80px
    const clamped = Math.max(0, Math.min(80, diff));
    setOffset(clamped);
  };

  const handleTouchEnd = () => {
    setSwiping(false);
    if (offset >= THRESHOLD) {
      setOffset(80); // Keep open
    } else {
      setOffset(0); // Snap back
    }
  };

  const handleDelete = () => {
    setOffset(0);
    onDelete();
  };

  const handleReset = () => {
    setOffset(0);
  };

  return (
    <div className="relative overflow-hidden">
      {/* Delete button behind */}
      <div
        className="absolute right-0 top-0 bottom-0 w-20 bg-red-500 flex items-center justify-center"
        onClick={handleDelete}
      >
        <Trash2 size={20} className="text-white" />
      </div>

      {/* Content on top */}
      <div
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClick={offset > 0 ? handleReset : undefined}
        style={{
          transform: `translateX(-${offset}px)`,
          transition: swiping ? 'none' : 'transform 0.2s ease-out',
        }}
        className="relative bg-white dark:bg-gray-900 z-10"
      >
        {children}
      </div>
    </div>
  );
};

export default SwipeToDelete;
