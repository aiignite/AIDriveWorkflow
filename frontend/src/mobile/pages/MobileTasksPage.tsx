import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ListChecks } from 'lucide-react';
import { workflowTasksApi } from '../../services/workflow';
import type { WorkflowTaskItem } from '../../types';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import PullToRefresh from '../components/PullToRefresh';
import ErrorRetry from '../components/ErrorRetry';
import ListSkeleton from '../components/ListSkeleton';
import EmptyState from '../components/EmptyState';
import FilterTabs from '../components/FilterTabs';
import ListCard from '../components/ListCard';
import SearchBar from '../components/SearchBar';

type TaskFilter = 'pending' | 'done' | 'all';

const filters: Array<{ key: TaskFilter; label: string }> = [
  { key: 'pending', label: '待办' },
  { key: 'done', label: '已办' },
  { key: 'all', label: '全部' },
];

const statusLabel: Record<string, string> = {
  pending: '待处理',
  claimed: '处理中',
  completed: '已完成',
  rejected: '已驳回',
  cancelled: '已取消',
};

const MobileTasksPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const rawFilter = searchParams.get('filter') as TaskFilter | null;
  const activeFilter: TaskFilter =
    rawFilter === 'done' || rawFilter === 'all' || rawFilter === 'pending'
      ? rawFilter
      : 'pending';

  const [tasks, setTasks] = useState<WorkflowTaskItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [searchText, setSearchText] = useState('');
  const debouncedSearch = useDebouncedValue(searchText, 300);

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      let data: WorkflowTaskItem[];
      if (activeFilter === 'pending') {
        data = await workflowTasksApi.my();
      } else if (activeFilter === 'done') {
        data = await workflowTasksApi.list({ status: 'completed' });
      } else {
        const [mine, done] = await Promise.all([
          workflowTasksApi.my().catch(() => [] as WorkflowTaskItem[]),
          workflowTasksApi.list({ status: 'completed' }).catch(() => [] as WorkflowTaskItem[]),
        ]);
        const map = new Map<string, WorkflowTaskItem>();
        [...mine, ...done].forEach((t) => map.set(t.id, t));
        data = Array.from(map.values());
      }
      setTasks(Array.isArray(data) ? data : []);
    } catch {
      setError(true);
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, [activeFilter]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const filteredTasks = tasks.filter((task) => {
    if (!debouncedSearch) return true;
    const q = debouncedSearch.toLowerCase();
    return (
      task.name?.toLowerCase().includes(q) ||
      task.instanceTitle?.toLowerCase().includes(q) ||
      task.definitionName?.toLowerCase().includes(q) ||
      task.taskNumber?.toLowerCase().includes(q)
    );
  });

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-3 pb-2">
        <div className="flex items-center gap-2 mb-3">
          <ListChecks size={18} className="text-blue-500" />
          <h1 className="text-base font-semibold">流程待办</h1>
        </div>
        <SearchBar value={searchText} onChange={setSearchText} placeholder="搜索任务 / 流程" />
        <div className="mt-2">
          <FilterTabs
            filters={filters}
            activeKey={activeFilter}
            onChange={(key) => {
              const next = new URLSearchParams(searchParams);
              if (key === 'pending') next.delete('filter');
              else next.set('filter', key);
              setSearchParams(next);
            }}
          />
        </div>
      </div>

      <div className="flex-1 overflow-auto px-4 pb-4">
        <PullToRefresh onRefresh={fetchTasks}>
        {loading ? (
          <ListSkeleton />
        ) : error ? (
          <ErrorRetry onRetry={fetchTasks} />
        ) : filteredTasks.length === 0 ? (
          <EmptyState message="暂无待办任务" />
        ) : (
          <div className="space-y-2">
            {filteredTasks.map((task) => (
              <ListCard
                key={task.id}
                onClick={() => navigate(`/m/tasks/${task.id}`)}
                title={task.name}
                subtitle={task.instanceTitle || task.definitionName || task.taskNumber}
                rightExtra={
                  <span className="text-[10px] text-gray-400">
                    {statusLabel[task.status] || task.status}
                  </span>
                }
              />
            ))}
          </div>
        )}
        </PullToRefresh>
      </div>
    </div>
  );
};

export default MobileTasksPage;
