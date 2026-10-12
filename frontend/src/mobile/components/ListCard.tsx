import React from 'react';
import { ChevronRight } from 'lucide-react';
import ContextMenu, { type ContextMenuAction } from './ContextMenu';

interface ListCardProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  meta?: React.ReactNode;
  status?: React.ReactNode;
  onClick?: () => void;
  rightExtra?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  contextMenuActions?: ContextMenuAction[];
}

const ListCard: React.FC<ListCardProps> = ({
  title,
  subtitle,
  meta,
  status,
  onClick,
  rightExtra,
  children,
  className,
  contextMenuActions,
}) => {
  const card = (
    <button
      onClick={onClick}
      className={`w-full bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-gray-100 dark:border-gray-700 text-left active:scale-[0.98] active:bg-gray-50 dark:active:bg-gray-700 transition-all ${className ?? ''}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">{title}</p>
          {subtitle ? <p className="text-xs text-gray-500 mt-1 truncate">{subtitle}</p> : null}
          {meta ? <div className="flex items-center gap-3 mt-2 text-xs text-gray-400">{meta}</div> : null}
        </div>
        <div className="flex flex-col items-end gap-2">
          {status}
          {rightExtra}
          <ChevronRight size={16} className="text-gray-300" />
        </div>
      </div>
      {children}
    </button>
  );

  if (contextMenuActions && contextMenuActions.length > 0) {
    return <ContextMenu actions={contextMenuActions}>{card}</ContextMenu>;
  }

  return card;
};

export default ListCard;
