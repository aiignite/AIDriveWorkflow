import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Clock, User, CheckCircle, XCircle } from 'lucide-react';
import { workflowInstancesApi } from '../../services/workflow';
import ErrorRetry from '../components/ErrorRetry';
import { getInstanceStatusColor, getInstanceStatusText } from '../utils/workflowStatus';

interface WorkflowLog {
  id?: string;
  action?: string;
  comment?: string;
  operatorName?: string;
  createdAt?: string;
}
import toast from 'react-hot-toast';

const MobileInstanceDetailPage: React.FC = () => {
  const { instanceId } = useParams<{ instanceId: string }>();
  const navigate = useNavigate();
  const [instance, setInstance] = useState<any>(null);
  const [logs, setLogs] = useState<WorkflowLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const fetchData = useCallback(async () => {
    if (!instanceId) return;
    setLoading(true);
    setError(false);
    try {
      const [instanceData, logsData] = await Promise.all([
        workflowInstancesApi.get(instanceId),
        workflowInstancesApi.logs(instanceId).catch(() => []),
      ]);
      setInstance(instanceData);
      setLogs(Array.isArray(logsData) ? logsData : []);
    } catch {
      setError(true);
      toast.error('加载失败');
    } finally {
      setLoading(false);
    }
  }, [instanceId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const getLogIcon = (action?: string) => {
    if (action?.includes('approve') || action?.includes('通过')) return <CheckCircle size={14} className="text-green-500" />;
    if (action?.includes('reject') || action?.includes('驳回')) return <XCircle size={14} className="text-red-500" />;
    return <Clock size={14} className="text-gray-400" />;
  };

  const formatTime = (time?: string) => {
    if (!time) return '-';
    return new Date(time).toLocaleString('zh-CN');
  };

  if (loading) {
    return (
      <div className="p-4 space-y-4">
        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 animate-pulse">
          <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-2/3 mb-3" />
          <div className="h-4 bg-gray-100 dark:bg-gray-600 rounded w-1/2" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4">
        <ErrorRetry message="加载流程详情失败" onRetry={fetchData} />
      </div>
    );
  }

  if (!instance) {
    return (
      <div className="p-4 text-center">
        <p className="text-gray-400">流程实例不存在</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-4">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-white dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700 px-4 py-3 flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="p-1 -ml-1">
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-base font-semibold truncate flex-1">流程详情</h1>
      </div>

      <div className="p-4 space-y-4">
        {/* Instance Info */}
        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-gray-100 dark:border-gray-700">
          <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100">
            {instance.title || '未命名流程'}
          </h2>
          <div className="mt-3 space-y-2">
            {(instance as any).definitionName && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">流程名称</span>
                <span className="text-gray-700 dark:text-gray-200">{(instance as any).definitionName}</span>
              </div>
            )}
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">状态</span>
              <span className={`px-2 py-0.5 text-xs rounded-full ${getInstanceStatusColor(instance.status)}`}>
                {getInstanceStatusText(instance.status)}
              </span>
            </div>
            {instance.createdAt && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">发起时间</span>
                <span className="text-gray-700 dark:text-gray-200">{formatTime(instance.createdAt)}</span>
              </div>
            )}
            {(instance as any).currentNodeName && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">当前节点</span>
                <span className="text-gray-700 dark:text-gray-200">{(instance as any).currentNodeName}</span>
              </div>
            )}
          </div>
        </div>

        {/* Timeline */}
        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-gray-100 dark:border-gray-700">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-4">流程时间线</h3>
          {logs.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">暂无时间线记录</p>
          ) : (
            <div className="space-y-4">
              {logs.map((log, index) => (
                <div key={log.id || index} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div className="w-6 h-6 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center">
                      {getLogIcon(log.action)}
                    </div>
                    {index < logs.length - 1 && <div className="w-px h-full min-h-[24px] bg-gray-200 dark:bg-gray-600" />}
                  </div>
                  <div className="flex-1 pb-4">
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-200">{log.action || '系统记录'}</p>
                    {log.comment && <p className="text-xs text-gray-500 mt-0.5">{log.comment}</p>}
                    <div className="flex items-center gap-2 mt-1">
                      {log.operatorName && (
                        <span className="flex items-center gap-1 text-xs text-gray-400">
                          <User size={10} />
                          {log.operatorName}
                        </span>
                      )}
                      <span className="text-xs text-gray-400">{formatTime(log.createdAt)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default MobileInstanceDetailPage;
