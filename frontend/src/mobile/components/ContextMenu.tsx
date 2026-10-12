import React, { useState, useRef } from 'react';

export interface ContextMenuAction {
  label: string;
  icon?: React.ReactNode;
  color?: 'default' | 'danger';
  onClick: () => void;
}

interface ContextMenuProps {
  actions: ContextMenuAction[];
  children: React.ReactNode;
}

const ContextMenu: React.FC<ContextMenuProps> = ({ actions, children }) => {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const longPressTimer = useRef<NodeJS.Timeout | null>(null);
  const elementRef = useRef<HTMLDivElement>(null);

  const handleTouchStart = () => {
    longPressTimer.current = setTimeout(() => {
      const rect = elementRef.current?.getBoundingClientRect();
      if (rect) {
        setPos({ x: rect.left, y: rect.top });
        setVisible(true);
      }
    }, 500); // 500ms 长按
  };

  const handleTouchEnd = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
    }
  };

  const handleActionClick = (action: ContextMenuAction) => {
    action.onClick();
    setVisible(false);
  };

  return (
    <>
      <div
        ref={elementRef}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onContextMenu={(e) => {
          e.preventDefault();
          setPos({ x: e.clientX, y: e.clientY });
          setVisible(true);
        }}
      >
        {children}
      </div>

      {visible && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setVisible(false)}
          />

          {/* Menu */}
          <div
            className="fixed z-50 bg-white dark:bg-gray-800 rounded-lg shadow-lg min-w-[160px]"
            style={{
              left: `${Math.min(pos.x, window.innerWidth - 180)}px`,
              top: `${pos.y + 30}px`,
            }}
          >
            {actions.map((action, i) => (
              <button
                key={i}
                onClick={() => handleActionClick(action)}
                className={`w-full px-4 py-2 text-sm text-left flex items-center gap-2 ${
                  action.color === 'danger'
                    ? 'text-red-600 dark:text-red-400 active:bg-red-50 dark:active:bg-red-900/20'
                    : 'text-gray-700 dark:text-gray-300 active:bg-gray-100 dark:active:bg-gray-700'
                }`}
              >
                {action.icon && <span>{action.icon}</span>}
                {action.label}
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
};

export default ContextMenu;
