import React from 'react';
import { AlertCircle, RefreshCw, WifiOff } from 'lucide-react';

interface ErrorRetryProps {
  message?: string;
  onRetry: () => void;
  isOffline?: boolean;
}

const ErrorRetry: React.FC<ErrorRetryProps> = ({
  message = '加载失败，请重试',
  onRetry,
  isOffline = false,
}) => (
  <div className="text-center py-12">
    {isOffline ? (
      <WifiOff size={32} className="text-orange-300 mx-auto mb-2" />
    ) : (
      <AlertCircle size={32} className="text-red-300 mx-auto mb-2" />
    )}
    <p className="text-gray-500 text-sm mb-3">
      {isOffline ? '当前无网络连接，请检查您的网络' : message}
    </p>
    <button
      onClick={onRetry}
      className="inline-flex items-center gap-1.5 px-4 py-2 text-sm text-blue-600 bg-blue-50 dark:bg-blue-900/20 dark:text-blue-400 rounded-lg active:bg-blue-100 transition-colors"
    >
      <RefreshCw size={14} />
      {isOffline ? '检查网络' : '重试'}
    </button>
  </div>
);

export default ErrorRetry;
