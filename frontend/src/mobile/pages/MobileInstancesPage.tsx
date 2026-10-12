import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { GitBranch, Clock, Loader } from 'lucide-react';
import { workflowInstancesApi } from '../../services/workflow';
import type { WorkflowInstance } from '../../types';
import { usePagination } from '../hooks/usePagination';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { getInstanceStatusColor, getInstanceStatusText } from '../utils/workflowStatus';
import PullToRefresh from '../components/PullToRefresh';
import ErrorRetry from '../components/ErrorRetry';
import ListSkeleton from '../components/ListSkeleton';
import EmptyState from '../components/EmptyState';
import FilterTabs from '../components/FilterTabs';
import ListCard from '../components/ListCard';
import SearchBar from '../components/SearchBar';

const MobileInstancesPage: React.FC = () => {
  const navigate = useNavigate();
  const [instances, setInstances] = useState<WorkflowInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState<'all' | 'in_progress' | 'completed'>('all');
  const [searchText, setSearchText] = useState('');
  const [skip, setSkip] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const PAGE_SIZE = 20;
  const debouncedSearch = useDebouncedValue(searchText, 300);

  const fetchInstances = useCallback(async () => {
    setLoading(true);
    setError(false);
    setSkip(0);
    try {
      const params: any = { limit: PAGE_SIZE, skip: 0 };
      if (filter !== 'all') params.status = filter;
      const data = await workflowInstancesApi.list(params);
      const items = Array.isArray(data) ? data : [];
      setInstances(items);
      setHasMore(items.length >= PAGE_SIZE);
    } catch {
      setError(true);
      setInstances([]);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMore) return;
    setLoadingMore(true);
    try {
      const newSkip = skip + PAGE_SIZE;
      const params: any = { limit: PAGE_SIZE, skip: newSkip };
      if (filter !== 'all') params.status = filter;
      const data = await workflowInstancesApi.list(params);
      const items = Array.isArray(data) ? data : [];
      setInstances((prev) => [...prev, ...items]);
      setSkip(newSkip);
      setHasMore(items.length >= PAGE_SIZE);
    } catch {
      // silent fail on load more
    } finally {
      setLoadingMore(false);
    }
  }, [skip, filter, hasMore, loadingMore]);

  const { observerTarget } = usePagination({ onLoadMore: loadMore, threshold: 300 });

  useEffect(() => {
    fetchInstances();
  }, [fetchInstances]);

  const formatTime = (time?: string) => {
    if (!time) return '-';
    const d = new Date(time);
    return d.toLocaleDateString('zh-CN');
  };

  const filteredInstances = instances.filter((instance) => {
    if (!debouncedSearch) return true;
    const keyword = debouncedSearch.toLowerCase();
    return (
      (instance.title || '').toLowerCase().includes(keyword) ||
      ((instance as any).definitionName || '').toLowerCase().includes(keyword)
    );
  });

  return (
    <div className="min-h-screen">
      {/* Search */}
      <div className="sticky top-[52px] z-20 bg-gray-50 dark:bg-gray-900 px-4 py-3 border-b border-gray-100 dark:border-gray-800">
        <SearchBar value={searchText} onChange={setSearchText} placeholder="搜索流程标题或名称..." />
      </div>

      {/* Filter Tabs */}
      <FilterTabs
        topClassName="top-[108px]"
        containerClassName="py-3"
        filters={[
          { key: 'all', label: '全部' },
          { key: 'in_progress', label: '进行中' },
          { key: 'completed', label: '已完成' },
        ]}
        activeKey={filter}
        onChange={(key) => setFilter(key as typeof filter)}
      />

      {/* Instance List */}
      <PullToRefresh onRefresh={fetchInstances}>
      <div className="p-4 space-y-3">
        {loading ? (
          <ListSkeleton count={3} />
        ) : error ? (
          <ErrorRetry onRetry={fetchInstances} />
        ) : filteredInstances.length === 0 ? (
          <EmptyState icon={GitBranch} message="暂无流程实例" />
        ) : (
          filteredInstances.map((instance) => (
            <ListCard
              key={instance.id}
              onClick={() => navigate(`/m/instances/${instance.id}`)}
              title={instance.title || '未命名流程'}
              meta={
                <>
                  {(instance as any).definitionName ? <span>{(instance as any).definitionName}</span> : null}
                  {instance.createdAt ? (
                    <span className="flex items-center gap-1">
                      <Clock size={12} />
                      {formatTime(instance.createdAt)}
                    </span>
                  ) : null}
                </>
              }
              status={<span className={`px-2 py-0.5 text-xs rounded-full ${getInstanceStatusColor(instance.status)}`}>{getInstanceStatusText(instance.status)}</span>}
            >
              {(instance as any).currentNodeName ? (
                <div className="mt-3 pt-3 border-t border-gray-50 dark:border-gray-700">
                  <p className="text-xs text-gray-400">
                    当前节点: <span className="text-gray-600 dark:text-gray-300">{(instance as any).currentNodeName}</span>
                  </p>
                </div>
              ) : null}
            </ListCard>
          ))
        )}
        {/* 分页加载 */}
        {hasMore && !error && instances.length > 0 && (
          <div ref={observerTarget} className="py-6 flex justify-center">
            {loadingMore && <Loader size={20} className="animate-spin text-blue-600" />}
          </div>
        )}
      </div>
      </PullToRefresh>
    </div>
  );
};

export default MobileInstancesPage;
