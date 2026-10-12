import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation, Outlet } from 'react-router-dom';
import { Bell, GitBranch, Home, WifiOff } from 'lucide-react';
import { useApp } from '../../contexts/AppContext';
import { notificationsApi } from '../../services/system/notifications';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import PwaInstallPrompt from '../components/PwaInstallPrompt';

const POLL_MS = 60_000;

/** 与 PLM MobileShell 相同的底部 Tab 布局；菜单为 AIDriveWorkflow 静态三项 */
const MOBILE_TABS = [
  { id: 'tab-home', title: '首页', path: '/m/home', icon: Home },
  { id: 'tab-tasks', title: '待办', path: '/m/tasks', icon: GitBranch },
  { id: 'tab-instances', title: '实例', path: '/m/instances', icon: GitBranch },
  { id: 'tab-notifications', title: '通知', path: '/m/notifications', icon: Bell },
];

const MobileShell: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { theme } = useApp();
  const [unreadCount, setUnreadCount] = useState(0);
  const { online } = useNetworkStatus();
  const [isTablet, setIsTablet] = useState(() => window.innerWidth >= 768);

  const isActive = (path: string) => {
    const base = path.split('?')[0];
    return location.pathname === base || location.pathname.startsWith(`${base}/`);
  };

  useEffect(() => {
    const fetchUnread = async () => {
      try {
        const count = await notificationsApi.unreadCount();
        setUnreadCount(count);
      } catch { /* ignore */ }
    };
    fetchUnread();
    const interval = setInterval(fetchUnread, POLL_MS);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const handleResize = () => setIsTablet(window.innerWidth >= 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const mainTabPaths = MOBILE_TABS.map((t) => t.path);
  const isMainTab = mainTabPaths.some((p) => location.pathname === p);

  return (
    <div className={`min-h-screen ${theme === 'dark' ? 'bg-gray-900 text-white' : 'bg-gray-50 text-gray-900'}`}>
      <div className={isTablet ? 'max-w-3xl mx-auto border-x border-gray-100 dark:border-gray-800 min-h-screen' : ''}>
      {!online && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-orange-500 text-white px-4 py-2 flex items-center gap-2 text-sm">
          <WifiOff size={14} />
          <span>无网络连接</span>
        </div>
      )}
      {isMainTab && (
        <header className={`sticky z-30 bg-white dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700 px-4 py-3 flex items-center justify-between safe-area-top ${
          !online ? 'top-9' : 'top-0'
        }`}>
          <h1 className="text-lg font-semibold">移动工作台</h1>
          <span className="text-xs text-gray-400">{new Date().toLocaleDateString('zh-CN')}</span>
        </header>
      )}

      <main className="pb-[calc(5.5rem+env(safe-area-inset-bottom,0px))] min-h-dvh">
        <div key={location.pathname} className="animate-fade-in">
          {children ?? <Outlet />}
        </div>
      </main>

      <PwaInstallPrompt />

      <nav className={`fixed bottom-0 ${isTablet ? 'left-1/2 -translate-x-1/2 max-w-3xl w-full' : 'left-0 right-0'} bg-white dark:bg-gray-800 border-t border-gray-100 dark:border-gray-700 px-2 py-1 z-40 safe-area-bottom`}>
        <div className="flex justify-around items-center max-w-lg mx-auto">
          {MOBILE_TABS.map((tab) => {
            const Icon = tab.icon;
            const active = isActive(tab.path);
            const isNotif = tab.path.includes('notifications');
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => navigate(tab.path)}
                className={`relative flex flex-col items-center gap-0.5 py-2 px-3 min-w-[60px] rounded-lg transition-colors group ${
                  active
                    ? 'text-blue-600 dark:text-blue-400'
                    : 'text-gray-400 dark:text-gray-500'
                }`}
                role="link"
                aria-label={tab.title}
              >
                <Icon size={22} strokeWidth={active ? 2.5 : 2} />
                {isNotif && unreadCount > 0 && (
                  <span className="absolute -top-0.5 right-1 min-w-[16px] h-4 px-1 text-[10px] font-bold bg-red-500 text-white rounded-full flex items-center justify-center">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
                <span className="text-[10px] font-medium">{tab.title}</span>
                {active && (
                  <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-6 h-0.5 bg-blue-600 dark:bg-blue-400 rounded-full" />
                )}
              </button>
            );
          })}
        </div>
      </nav>
      </div>
    </div>
  );
};

export default MobileShell;
