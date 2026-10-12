import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, Bell, GitBranch, ListChecks, Plus } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { getLoggedInUserDisplayName } from '../../utils/userDisplay';
import { workflowInstancesApi, workflowTasksApi } from '../../services/workflow';
import { notificationsApi } from '../../services/system/notifications';
import PullToRefresh from '../components/PullToRefresh';

interface Summary {
  pendingCount: number;
  urgentCount: number;
  unreadNotifications: number;
  inProgressInstances: number;
}

const MobileHomePage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [summary, setSummary] = useState<Summary>({
    pendingCount: 0,
    urgentCount: 0,
    unreadNotifications: 0,
    inProgressInstances: 0,
  });
  const [loading, setLoading] = useState(true);

  const fetchSummary = useCallback(async () => {
    setLoading(true);
    try {
      const [taskSummary, notifSummary, instances] = await Promise.all([
        workflowTasksApi.summary().catch(() => ({ pending: 0, urgent: 0 })),
        notificationsApi.summary().catch(() => ({ total: 0, unread: 0 })),
        workflowInstancesApi.list({ status: 'running' }).catch(() => []),
      ]);
      setSummary({
        pendingCount: (taskSummary as { pending?: number }).pending ?? 0,
        urgentCount: (taskSummary as { urgent?: number; overdue?: number }).urgent
          ?? (taskSummary as { overdue?: number }).overdue
          ?? 0,
        unreadNotifications: (notifSummary as { unread?: number }).unread ?? 0,
        inProgressInstances: Array.isArray(instances) ? instances.length : 0,
      });
    } catch {
      // fallback to zeros
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  const greeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return '早上好';
    if (hour < 18) return '下午好';
    return '晚上好';
  };

  const statCards = [
    { label: '待办数', value: summary.pendingCount, color: 'blue' },
    { label: '紧急待办', value: summary.urgentCount, color: 'red' },
    { label: '未读通知', value: summary.unreadNotifications, color: 'orange' },
    { label: '进行中流程', value: summary.inProgressInstances, color: 'green' },
  ];

  const quickLinks = [
    { title: '我的待办', path: '/m/tasks', icon: ListChecks, badge: summary.pendingCount },
    { title: '流程实例', path: '/m/instances', icon: GitBranch, badge: null },
    { title: '通知', path: '/workflows?tab=tasks', icon: Bell, badge: summary.unreadNotifications },
  ];

  return (
    <PullToRefresh onRefresh={fetchSummary}>
    <div className="p-4 space-y-4">
      <div className="bg-gradient-to-r from-blue-500 to-blue-600 rounded-2xl p-4 text-white shadow-lg">
        <p className="text-sm opacity-90">{greeting()}</p>
        <h2 className="text-xl font-bold mt-1">{getLoggedInUserDisplayName(user)}</h2>
        <p className="text-xs opacity-75 mt-1">AIDriveWorkflow 移动工作台</p>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">快捷入口</h3>
          <button
            type="button"
            onClick={() => navigate('/workflows?tab=definitions')}
            className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400"
          >
            <Plus size={14} /> 发起流程
          </button>
        </div>
        <div className="divide-y divide-gray-50 dark:divide-gray-700">
          {quickLinks.map(({ title, path, icon: Icon, badge }) => (
            <button
              key={title}
              type="button"
              onClick={() => navigate(path)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 active:bg-gray-100 dark:active:bg-gray-700 transition-all"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center">
                  <Icon size={18} className="text-blue-600 dark:text-blue-400" />
                </div>
                <span className="text-sm font-medium text-gray-700 dark:text-gray-200">{title}</span>
              </div>
              {badge !== null && badge > 0 && (
                <span className="bg-red-500 text-white text-xs px-2 py-0.5 rounded-full">{badge}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {statCards.map(({ label, value, color }) => (
          <div
            key={label}
            className="bg-white dark:bg-gray-800 rounded-xl p-3 shadow-sm border border-gray-100 dark:border-gray-700"
          >
            <p className={`text-xs text-${color}-500 font-medium`}>{label}</p>
            <p className={`text-2xl font-bold text-${color}-600 dark:text-${color}-400 mt-1`}>
              {loading ? <span className="inline-block w-8 h-7 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" /> : value}
            </p>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 text-xs text-gray-400 px-2">
        <AlertCircle size={12} />
        <span>下拉刷新 · 点击待办直接处理</span>
      </div>
    </div>
    </PullToRefresh>
  );
};

export default MobileHomePage;
