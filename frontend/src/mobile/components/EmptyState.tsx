import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { Inbox } from 'lucide-react';

interface EmptyStateProps {
  icon?: LucideIcon;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
}

const EmptyState: React.FC<EmptyStateProps> = ({
  icon: Icon = Inbox,
  message = '暂无数据',
  actionLabel,
  onAction,
}) => (
  <div className="text-center py-12">
    <Icon size={32} className="text-gray-300 mx-auto mb-2" />
    <p className="text-gray-400 text-sm">{message}</p>
    {actionLabel && onAction && (
      <button
        onClick={onAction}
        className="mt-3 text-sm text-blue-500 font-medium"
      >
        {actionLabel}
      </button>
    )}
  </div>
);

export default EmptyState;
