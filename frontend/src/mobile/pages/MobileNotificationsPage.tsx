import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Info, CheckCircle, AlertTriangle, XCircle } from 'lucide-react';
import { notificationsApi, type NotificationItem } from '../../services/system/notifications';
import toast from 'react-hot-toast';
import PullToRefresh from '../components/PullToRefresh';
import ErrorRetry from '../components/ErrorRetry';
import SwipeToDelete from '../components/SwipeToDelete';
import EmptyState from '../components/EmptyState';

const typeIcons: Record<string, React.ReactNode> = {
  info: <Info size={16} className="text-blue-500" />,
  success: <CheckCircle size={16} className="text-green-500" />,
  warning: <AlertTriangle size={16} className="text-orange-500" />,
  error: <XCircle size={16} className="text-red-500" />,
};

const MobileNotificationsPage: React.FC = () => {
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const params = filter === 'unread' ? { read: false } : {};
      const data = await notificationsApi.list(params);
      setNotifications(Array.isArray(data) ? data : []);
    } catch {
      setError(true);
      setNotifications([]);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  const handleMarkAsRead = async (id: string) => {
    try {
      await notificationsApi.markAsRead(id);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read: true } : n))
      );
    } catch {
      toast.error('操作失败');
    }
  };

  const handleMarkAllAsRead = async () => {
    try {
      await notificationsApi.markAllAsRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      toast.success('已全部标为已读');
    } catch {
      toast.error('操作失败');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await notificationsApi.delete(id);
      setNotifications((prev) => prev.filter((n) => n.id !== id));
      toast.success('已删除');
    } catch {
      toast.error('操作失败');
    }
  };

  const handleNotificationClick = (notification: NotificationItem) => {
    if (!notification.read) {
      handleMarkAsRead(notification.id);
    }
    const url = notification.relatedItemUrl;
    if (url && url.startsWith('/m/')) {
      navigate(url);
      return;
    }
    const type = (notification.relatedItemType || '').toLowerCase();
    const id = notification.relatedItemId;
    if (!id) return;

    if (
      type === 'workflow_task' ||
      type === 'workflow-task' ||
      type.endsWith('_task') ||
      type === 'task'
    ) {
      navigate(`/m/tasks/${id}`);
      return;
    }
    if (
      type === 'workflow_instance' ||
      type === 'workflow-instance' ||
      type.endsWith('_instance') ||
      type === 'instance'
    ) {
      navigate(`/m/instances/${id}`);
      return;
    }
    if (type.includes('material')) {
      navigate(`/m/materials/${id}`);
      return;
    }
    if (type.includes('document')) {
      navigate(`/m/documents/${id}`);
      return;
    }
    if (type.includes('equipment')) {
      navigate(`/m/equipment/${id}`);
      return;
    }
    if (type.includes('project')) {
      navigate(`/m/projects/${id}`);
    }
  };

  const formatTime = (time: string) => {
    const d = new Date(time);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return '刚刚';
    if (minutes < 60) return `${minutes}分钟前`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}小时前`;
    return d.toLocaleDateString('zh-CN');
  };

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-white dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bell size={18} className="text-gray-600 dark:text-gray-300" />
          <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
            {filter === 'all' ? '全部通知' : '未读通知'}
          </span>
          {unreadCount > 0 && (
            <span className="bg-red-500 text-white text-xs px-1.5 py-0.5 rounded-full">{unreadCount}</span>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setFilter(filter === 'all' ? 'unread' : 'all')}
            className="text-xs text-blue-600 dark:text-blue-400 font-medium"
          >
            {filter === 'all' ? '只看未读' : '显示全部'}
          </button>
          {unreadCount > 0 && (
            <button onClick={handleMarkAllAsRead} className="text-xs text-gray-500">
              全部已读
            </button>
          )}
        </div>
      </div>

      {/* Notification List */}
      <PullToRefresh onRefresh={fetchNotifications}>
      <div className="divide-y divide-gray-50 dark:divide-gray-800">
        {loading ? (
          <div className="p-4 space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="animate-pulse flex gap-3">
                <div className="w-8 h-8 bg-gray-200 dark:bg-gray-700 rounded-full" />
                <div className="flex-1">
                  <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4 mb-2" />
                  <div className="h-3 bg-gray-100 dark:bg-gray-600 rounded w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <ErrorRetry onRetry={fetchNotifications} />
        ) : notifications.length === 0 ? (
          <EmptyState icon={Bell} message="暂无通知" />
        ) : (
          notifications.map((notification) => (
            <SwipeToDelete key={notification.id} onDelete={() => handleDelete(notification.id)}>
            <div
              onClick={() => handleNotificationClick(notification)}
              className={`px-4 py-3 active:bg-gray-100 dark:active:bg-gray-800/70 transition-colors ${
                !notification.read ? 'bg-blue-50/50 dark:bg-blue-900/10' : ''
              }`}
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5">{typeIcons[notification.type] || typeIcons.info}</div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium truncate ${
                    !notification.read ? 'text-gray-800 dark:text-gray-100' : 'text-gray-600 dark:text-gray-300'
                  }`}>
                    {notification.title}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{notification.message}</p>
                  <p className="text-xs text-gray-400 mt-1">{formatTime(notification.createdAt)}</p>
                </div>
                {!notification.read && (
                  <div className="w-2 h-2 bg-blue-500 rounded-full mt-2" />
                )}
              </div>
            </div>
            </SwipeToDelete>
          ))
        )}
      </div>
      </PullToRefresh>
    </div>
  );
};

export default MobileNotificationsPage;
