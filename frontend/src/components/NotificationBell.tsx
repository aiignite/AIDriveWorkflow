/** 通知铃铛 — 未读徽标 + 下拉列表，点击通知跳转关联页面 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck } from 'lucide-react';
import { notificationsApi, type NotificationItem } from '../services/system/notifications';
import { useApp } from '../contexts/AppContext';

const POLL_MS = 60_000;

const NotificationBell: React.FC = () => {
  const navigate = useNavigate();
  const { theme } = useApp();
  const isDark = theme === 'dark';
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      const [list, count] = await Promise.all([
        notificationsApi.list({ limit: 20 }),
        notificationsApi.unreadCount(),
      ]);
      setItems(list);
      setUnread(count);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, POLL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const markAll = async () => {
    await notificationsApi.markAllAsRead().catch(() => {});
    refresh();
  };

  const openItem = async (n: NotificationItem) => {
    if (!n.read) {
      await notificationsApi.markAsRead(n.id).catch(() => {});
      refresh();
    }
    setOpen(false);
    if (n.relatedItemUrl) navigate(n.relatedItemUrl);
  };

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => { setOpen(o => !o); if (!open) refresh(); }}
        className={`p-2 rounded-lg relative ${isDark ? 'hover:bg-gray-700' : 'hover:bg-gray-100'}`}
        title="通知"
      >
        <Bell size={18} className={isDark ? 'text-gray-300' : 'text-gray-600'} />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 text-[10px] font-bold bg-red-500 text-white rounded-full flex items-center justify-center">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className={`absolute right-0 top-11 w-80 max-w-[calc(100vw-2rem)] rounded-xl shadow-2xl border z-50 overflow-hidden ${
          isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
        }`}>
          <div className={`flex items-center justify-between px-4 py-2.5 border-b ${isDark ? 'border-gray-700' : 'border-gray-100'}`}>
            <span className={`text-sm font-semibold ${isDark ? 'text-gray-100' : 'text-gray-800'}`}>通知</span>
            <button
              type="button"
              onClick={markAll}
              className={`flex items-center gap-1 text-xs ${isDark ? 'text-gray-400 hover:text-gray-200' : 'text-gray-500 hover:text-gray-700'}`}
            >
              <CheckCheck size={13} /> 全部已读
            </button>
          </div>
          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 && (
              <p className={`text-xs text-center py-8 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>暂无通知</p>
            )}
            {items.map(n => (
              <button
                key={n.id}
                type="button"
                onClick={() => openItem(n)}
                className={`w-full text-left px-4 py-2.5 border-b last:border-b-0 transition-colors ${
                  isDark ? 'border-gray-700/60 hover:bg-gray-700/40' : 'border-gray-50 hover:bg-gray-50'
                }`}
              >
                <div className="flex items-start gap-2">
                  {!n.read && <span className="mt-1.5 w-2 h-2 rounded-full bg-blue-500 shrink-0" />}
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm font-medium truncate ${isDark ? 'text-gray-100' : 'text-gray-800'}`}>{n.title}</p>
                    <p className={`text-xs line-clamp-2 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{n.message}</p>
                    <p className={`text-[10px] mt-0.5 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                      {n.createdAt ? new Date(n.createdAt).toLocaleString('zh-CN') : ''}
                    </p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default NotificationBell;
