import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, CheckCircle2, Loader2, XCircle, UserPlus, Hand,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { workflowTasksApi, workflowInstancesApi } from '../../services/workflow';
import type { WorkflowTaskItem } from '../../types';
import PullToRefresh from '../components/PullToRefresh';
import ErrorRetry from '../components/ErrorRetry';

const MobileTaskDetailPage: React.FC = () => {
  const { taskId } = useParams<{ taskId: string }>();
  const navigate = useNavigate();
  const [task, setTask] = useState<WorkflowTaskItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [comment, setComment] = useState('');
  const [showDelegate, setShowDelegate] = useState(false);
  const [delegateUserId, setDelegateUserId] = useState('');

  const load = useCallback(async () => {
    if (!taskId) return;
    setLoading(true);
    setError(false);
    try {
      const data = await workflowTasksApi.get(taskId);
      setTask(data);
      setComment(data.comment || '');
    } catch {
      setError(true);
      setTask(null);
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    load();
  }, [load]);

  const runAction = async (
    label: string,
    action: () => Promise<unknown>,
    goBack = true,
  ) => {
    setSaving(true);
    try {
      await action();
      toast.success(`${label}成功`);
      if (goBack) navigate('/m/tasks');
      else await load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : `${label}失败`);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="animate-spin text-blue-500" />
      </div>
    );
  }

  if (error || !task) {
    return (
      <div className="p-4">
        <button type="button" onClick={() => navigate('/m/tasks')} className="mb-4 inline-flex items-center gap-1 text-sm">
          <ArrowLeft size={16} /> 返回
        </button>
        <ErrorRetry onRetry={load} message="任务不存在或无权查看" />
      </div>
    );
  }

  const canAct = task.status === 'pending' || task.status === 'claimed';
  const canClaim = task.status === 'pending' && !task.assignee;

  return (
    <div className="flex flex-col min-h-full">
      <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center gap-2 sticky top-0 bg-white dark:bg-gray-900 z-10">
        <button type="button" onClick={() => navigate('/m/tasks')} aria-label="返回">
          <ArrowLeft size={18} />
        </button>
        <h1 className="text-base font-semibold flex-1 truncate">审批详情</h1>
        {task.instanceId && (
          <button
            type="button"
            className="text-xs text-blue-600"
            onClick={() => navigate(`/m/instances/${task.instanceId}`)}
          >
            流程
          </button>
        )}
      </div>

      <div className={`flex-1 overflow-auto p-4 ${canAct ? 'pb-[calc(11rem+env(safe-area-inset-bottom,0px))]' : 'pb-6'}`}>
        <PullToRefresh onRefresh={load}>
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{task.name}</h2>
            <p className="text-sm text-gray-500 mt-1">{task.instanceTitle || task.definitionName}</p>
            {task.taskNumber && (
              <p className="text-xs text-gray-400 mt-0.5">编号 {task.taskNumber}</p>
            )}
          </div>

          <div className="rounded-xl border border-gray-100 dark:border-gray-800 p-3 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">状态</span>
              <span>{task.status}</span>
            </div>
            {task.assignee && (
              <div className="flex justify-between">
                <span className="text-gray-500">处理人</span>
                <span>{task.assignee.name}</span>
              </div>
            )}
            {task.dueDate && (
              <div className="flex justify-between">
                <span className="text-gray-500">截止</span>
                <span>{new Date(task.dueDate).toLocaleString('zh-CN')}</span>
              </div>
            )}
            {task.entityType && (
              <div className="flex justify-between">
                <span className="text-gray-500">业务对象</span>
                <span className="truncate max-w-[60%] text-right">{task.entityType}</span>
              </div>
            )}
          </div>

          {canAct && (
            <div>
              <label className="text-xs text-gray-500 mb-1 block">审批意见</label>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={3}
                placeholder="选填审批意见"
                className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          )}

          {showDelegate && canAct && (
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3 space-y-2">
              <label className="text-xs text-gray-500">目标用户 ID</label>
              <input
                value={delegateUserId}
                onChange={(e) => setDelegateUserId(e.target.value)}
                placeholder="粘贴用户 UUID"
                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm"
              />
              <button
                type="button"
                disabled={saving || !delegateUserId.trim()}
                onClick={() =>
                  runAction('委派', () =>
                    workflowTasksApi.delegate(task.id, {
                      targetUserId: delegateUserId.trim(),
                      comment: comment || undefined,
                    }),
                  )
                }
                className="w-full py-2 rounded-lg bg-blue-600 text-white text-sm disabled:opacity-50"
              >
                确认委派
              </button>
              <p className="text-[10px] text-gray-400">
                完整用户选择器请在桌面端处理；移动端支持粘贴目标用户 ID。
              </p>
            </div>
          )}

          {!canAct && (
            <button
              type="button"
              onClick={async () => {
                if (!task.instanceId) return;
                try {
                  await workflowInstancesApi.get(task.instanceId);
                  navigate(`/m/instances/${task.instanceId}`);
                } catch {
                  toast.error('无法打开流程实例');
                }
              }}
              className="w-full py-3 rounded-xl bg-gray-100 dark:bg-gray-800 text-sm text-gray-600"
            >
              查看流程进度
            </button>
          )}
        </div>
        </PullToRefresh>
      </div>

      {/* 固定在底栏上方，避免被 Tab 遮挡 */}
      {canAct && (
        <div className="fixed left-0 right-0 z-30 px-4 pt-3 pb-3 bg-white/95 dark:bg-gray-900/95 backdrop-blur border-t border-gray-100 dark:border-gray-800 bottom-[calc(3.75rem+env(safe-area-inset-bottom,0px))]">
          <div className="grid grid-cols-2 gap-2 max-w-lg mx-auto">
            {canClaim && (
              <button
                type="button"
                disabled={saving}
                onClick={() => runAction('认领', () => workflowTasksApi.claim(task.id), false)}
                className="col-span-2 flex items-center justify-center gap-2 py-3 rounded-xl bg-blue-50 dark:bg-blue-900/30 text-blue-600 font-medium text-sm disabled:opacity-50"
              >
                <Hand size={16} /> 认领任务
              </button>
            )}
            <button
              type="button"
              disabled={saving}
              onClick={() =>
                runAction('通过', () =>
                  workflowTasksApi.complete(task.id, { result: 'approved', comment: comment || undefined }),
                )
              }
              className="flex items-center justify-center gap-2 py-3 rounded-xl bg-green-600 text-white font-medium text-sm disabled:opacity-50"
            >
              <CheckCircle2 size={16} /> 通过
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                if (!comment.trim()) {
                  toast.error('驳回请填写意见');
                  return;
                }
                runAction('驳回', () =>
                  workflowTasksApi.reject(task.id, { result: 'rejected', comment }),
                );
              }}
              className="flex items-center justify-center gap-2 py-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 font-medium text-sm disabled:opacity-50"
            >
              <XCircle size={16} /> 驳回
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => setShowDelegate((v) => !v)}
              className="col-span-2 flex items-center justify-center gap-2 py-3 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 font-medium text-sm"
            >
              <UserPlus size={16} /> 委派
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default MobileTaskDetailPage;
