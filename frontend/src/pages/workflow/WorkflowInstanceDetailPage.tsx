import {
    Activity, ArrowLeft, CheckCircle, Clock, FileText, GitBranch, Maximize2, PauseCircle, Play, RefreshCcw, RotateCw, Timer, XCircle, ZoomIn, ZoomOut
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { useApp } from '../../contexts/AppContext';
import { useAuth } from '../../contexts/AuthContext';
import { workflowInstancesApi, workflowsApi } from '../../services';
import type { WorkflowDefinitionDetail, WorkflowInstanceDetail, WorkflowInstanceLog, WorkflowNode, WorkflowTaskItem } from '../../types';
import { computeEdgePath, strokeDashForLineStyle, type EdgeRoutingMode } from './workflowCanvasPath';

const STATUS_CONFIG: Record<string, { bg: string; label: string; icon: LucideIcon }> = {
  running: { bg: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400', label: '运行中', icon: Play },
  completed: { bg: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400', label: '已完成', icon: CheckCircle },
  terminated: { bg: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400', label: '已终止', icon: XCircle },
  suspended: { bg: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400', label: '已挂起', icon: PauseCircle },
  pending: { bg: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400', label: '待处理', icon: Clock },
  claimed: { bg: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400', label: '处理中', icon: RefreshCcw },
};

const EVENT_TYPE_CONFIG: Record<string, { label: string; color: string; icon: LucideIcon }> = {
  instance_started: { label: '流程启动', color: 'bg-green-500', icon: Play },
  instance_completed: { label: '流程完成', color: 'bg-green-600', icon: CheckCircle },
  instance_rejected: { label: '流程驳回', color: 'bg-red-500', icon: XCircle },
  instance_suspended: { label: '流程挂起', color: 'bg-yellow-500', icon: PauseCircle },
  instance_resumed: { label: '流程恢复', color: 'bg-blue-500', icon: Play },
  instance_terminated: { label: '流程终止', color: 'bg-red-600', icon: XCircle },
  task_created: { label: '任务创建', color: 'bg-blue-400', icon: FileText },
  task_claimed: { label: '任务认领', color: 'bg-indigo-500', icon: Activity },
  task_completed: { label: '任务完成', color: 'bg-green-500', icon: CheckCircle },
  task_rejected: { label: '任务驳回', color: 'bg-red-400', icon: XCircle },
  task_delegated: { label: '任务委派', color: 'bg-purple-500', icon: RefreshCcw },
  node_entered: { label: '进入节点', color: 'bg-cyan-500', icon: GitBranch },
  node_completed: { label: '节点完成', color: 'bg-teal-500', icon: CheckCircle },
};

// EVENT_TYPE_LABELS removed (unused - derived from EVENT_TYPE_CONFIG if needed)

const TASK_STATUS_LABELS: Record<string, string> = {
  pending: '待处理', claimed: '处理中', completed: '已完成',
  rejected: '已拒绝', delegated: '已委派', cancelled: '已取消',
};

interface Props {
  instanceId: string;
  onBack: () => void;
  onViewTask?: (taskId: string) => void;
}

const WorkflowInstanceDetailPage: React.FC<Props> = ({ instanceId, onBack, onViewTask }) => {
  const { theme } = useApp();
  const isDark = theme === 'dark';
  const { user: currentUser } = useAuth();

  const [instance, setInstance] = useState<WorkflowInstanceDetail | null>(null);
  const [definitionDetail, setDefinitionDetail] = useState<WorkflowDefinitionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'flow' | 'tasks' | 'logs'>('flow');
  const [flowZoom, setFlowZoom] = useState(1);

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await workflowInstancesApi.get(instanceId);
      setInstance(data);
      if (data.definitionId) {
        try {
          const defData = await workflowsApi.get(data.definitionId);
          setDefinitionDetail(defData);
        } catch { /* definition may not be accessible */ }
      }
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadData(); }, [instanceId]);

  /* ─── Node status mapping for flow diagram ─── */
  const nodeStatusMap = useMemo(() => {
    const map: Record<string, 'completed' | 'active' | 'pending' | 'rejected'> = {};
    if (!instance || !definitionDetail) return map;
    const currentNodeIds = instance.currentNodeIds || [];
    const tasks = instance.tasks || [];

    definitionDetail.nodes.forEach(node => {
      const nodeTasks = tasks.filter(t => t.nodeId === node.id);
      const hasCompleted = nodeTasks.some(t => t.status === 'completed');
      const hasRejected = nodeTasks.some(t => t.status === 'rejected');
      const isActive = currentNodeIds.includes(node.id) || nodeTasks.some(t => t.status === 'pending' || t.status === 'claimed');

      if (node.nodeType === 'start') {
        map[node.id] = 'completed';
      } else if (node.nodeType === 'end') {
        map[node.id] = instance.status === 'completed' ? 'completed' : 'pending';
      } else if (hasRejected) {
        map[node.id] = 'rejected';
      } else if (hasCompleted) {
        map[node.id] = 'completed';
      } else if (isActive) {
        map[node.id] = 'active';
      } else {
        map[node.id] = 'pending';
      }
    });
    return map;
  }, [instance, definitionDetail]);

  const handleSuspend = async () => {
    try {
      await workflowInstancesApi.suspend(instanceId);
      const data = await workflowInstancesApi.get(instanceId);
      setInstance(data);
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : '操作失败'); }
  };

  const handleResume = async () => {
    try {
      await workflowInstancesApi.resume(instanceId);
      const data = await workflowInstancesApi.get(instanceId);
      setInstance(data);
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : '操作失败'); }
  };

  const handleTerminate = async () => {
    if (!confirm('确认终止此流程？')) return;
    try {
      await workflowInstancesApi.terminate(instanceId);
      const data = await workflowInstancesApi.get(instanceId);
      setInstance(data);
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : '操作失败'); }
  };

  const cardBg = isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200';

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
    </div>
  );

  if (!instance) return (
    <div className="text-center py-12">
      <p className="text-red-500">加载失败</p>
      <button onClick={onBack} className="mt-2 text-blue-600 underline">返回</button>
    </div>
  );

  const status = STATUS_CONFIG[instance.status] || STATUS_CONFIG.running;
  const StatusIcon = status.icon;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className={`text-xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>
              {instance.title}
            </h1>
            <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${status.bg}`}>
              <StatusIcon size={12} /> {status.label}
            </span>
          </div>
          <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            {instance.instanceNumber} · {instance.definitionName}
          </p>
        </div>
        {instance.status === 'running' && (
          <div className="flex gap-2">
            <button onClick={handleSuspend} className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg border hover:bg-gray-50 dark:hover:bg-gray-700">
              <PauseCircle size={14} /> 挂起
            </button>
            <button onClick={handleTerminate} className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg text-red-500 border border-red-200 hover:bg-red-50 dark:hover:bg-red-900/20">
              <XCircle size={14} /> 终止
            </button>
          </div>
        )}
        {instance.status === 'suspended' && (
          <button onClick={handleResume} className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700">
            <Play size={14} /> 恢复
          </button>
        )}
        <button onClick={loadData} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700" title="刷新">
          <RotateCw size={16} className={isDark ? 'text-gray-400' : 'text-gray-500'} />
        </button>
      </div>

      {/* Info cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className={`p-3 rounded-lg border ${cardBg}`}>
          <div className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>发起人</div>
          <div className={`text-sm font-medium mt-1 ${isDark ? 'text-white' : 'text-gray-900'}`}>
            {instance.initiatedBy?.name || '-'}
          </div>
        </div>
        <div className={`p-3 rounded-lg border ${cardBg}`}>
          <div className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>发起时间</div>
          <div className={`text-sm font-medium mt-1 ${isDark ? 'text-white' : 'text-gray-900'}`}>
            {new Date(instance.startedAt).toLocaleString('zh-CN')}
          </div>
        </div>
        <div className={`p-3 rounded-lg border ${cardBg}`}>
          <div className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            {instance.completedAt ? '完成时间' : '运行时长'}
          </div>
          <div className={`text-sm font-medium mt-1 ${isDark ? 'text-white' : 'text-gray-900'}`}>
            {instance.completedAt
              ? new Date(instance.completedAt).toLocaleString('zh-CN')
              /* eslint-disable react-hooks/purity -- Date.now() for elapsed time */
              : (() => {
                  const durationMs = Date.now() - new Date(instance.startedAt).getTime();
                  const hours = Math.floor(durationMs / 3600000);
                  const days = Math.floor(hours / 24);
                  return days > 0 ? `${days}天${hours % 24}小时` : `${hours}小时`;
                })()
              /* eslint-enable react-hooks/purity */
            }
          </div>
        </div>
        <div className={`p-3 rounded-lg border ${cardBg}`}>
          <div className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>处理耗时</div>
          <div className={`text-sm font-medium mt-1 flex items-center gap-1.5 ${isDark ? 'text-white' : 'text-gray-900'}`}>
            <Timer size={14} className={`${instance.completedAt ? 'text-green-500' : 'text-blue-500'}`} />
            {/* eslint-disable react-hooks/purity -- Date.now() for elapsed time */}
            {(() => {
              const end = instance.completedAt ? new Date(instance.completedAt).getTime() : Date.now();
              const durationMs = end - new Date(instance.startedAt).getTime();
              const totalMins = Math.floor(durationMs / 60000);
              if (totalMins < 60) return `${totalMins}分钟`;
              const hrs = Math.floor(totalMins / 60);
              const days = Math.floor(hrs / 24);
              if (days > 0) return `${days}天${hrs % 24}时${totalMins % 60}分`;
              return `${hrs}时${totalMins % 60}分`;
            })()}
            {/* eslint-enable react-hooks/purity */}
          </div>
        </div>
        <div className={`p-3 rounded-lg border ${cardBg}`}>
          <div className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>任务进度</div>
          <div className="mt-1">
            {(() => {
              const tasks = instance.tasks || [];
              const total = tasks.length;
              const completed = tasks.filter(t => t.status === 'completed' || t.status === 'rejected').length;
              const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
              return (
                <div className="flex items-center gap-2">
                  <div className={`flex-1 h-2 rounded-full overflow-hidden ${isDark ? 'bg-gray-700' : 'bg-gray-200'}`}>
                    <div className={`h-full rounded-full transition-all ${
                      pct === 100 ? 'bg-green-500' : pct > 60 ? 'bg-blue-500' : pct > 0 ? 'bg-amber-500' : 'bg-gray-400'
                    }`} style={{ width: `${pct}%` }} />
                  </div>
                  <span className={`text-xs font-medium ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>{completed}/{total}</span>
                </div>
              );
            })()}
          </div>
        </div>
        {instance.entityType && (
          <div className={`p-3 rounded-lg border ${cardBg}`}>
            <div className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>关联实体</div>
            <div className={`text-sm font-medium mt-1 ${isDark ? 'text-white' : 'text-gray-900'}`}>
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${isDark ? 'bg-indigo-900/30 text-indigo-400' : 'bg-indigo-100 text-indigo-700'}`}>
                {instance.entityType}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className={`flex gap-1 p-1 rounded-lg ${isDark ? 'bg-gray-800' : 'bg-gray-100'}`}>
        {[
          { id: 'flow' as const, label: '流程图', icon: <Activity size={14} /> },
          { id: 'tasks' as const, label: '任务列表', icon: <FileText size={14} /> },
          { id: 'logs' as const, label: '操作日志', icon: <Clock size={14} /> },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1 px-4 py-2 rounded-md text-sm font-medium transition-colors flex-1 justify-center 
              ${activeTab === tab.id
                ? 'bg-white text-blue-600 shadow-sm dark:bg-gray-700 dark:text-blue-400'
                : isDark ? 'text-gray-400 hover:text-gray-200' : 'text-gray-600 hover:text-gray-900'
              }`}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* Flow Diagram */}
      {activeTab === 'flow' && (
        <div className={`rounded-lg border overflow-hidden ${cardBg}`}>
          {!definitionDetail ? (
            <div className="text-center py-12">
              <Activity size={40} className="mx-auto text-gray-400 mb-3" />
              <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>无法加载流程定义图</p>
            </div>
          ) : (() => {
            const wfNodes = definitionDetail.nodes;
            const wfEdges = definitionDetail.edges;
            if (wfNodes.length === 0) return <div className="text-center py-8 text-gray-400 text-sm">无节点数据</div>;

            const NODE_W = 160;
            const NODE_H = 56;
            const EVENT_R = 22;
            const GW_S = 38;
            const PAD = 40;

            // Compute bounds
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            wfNodes.forEach(n => {
              const isEv = n.nodeType === 'start' || n.nodeType === 'end';
              const isGw = n.nodeType.includes('gateway');
              const w = isEv ? EVENT_R * 2 : isGw ? GW_S : NODE_W;
              const h = isEv ? EVENT_R * 2 : isGw ? GW_S : NODE_H;
              if (n.positionX < minX) minX = n.positionX;
              if (n.positionY < minY) minY = n.positionY;
              if (n.positionX + w > maxX) maxX = n.positionX + w;
              if (n.positionY + h > maxY) maxY = n.positionY + h;
            });
            const svgW = maxX - minX + PAD * 2;
            const svgH = maxY - minY + PAD * 2;
            const ofsX = minX - PAD;
            const ofsY = minY - PAD;

            const getNodeRect = (n: WorkflowNode) => {
              const isEv = n.nodeType === 'start' || n.nodeType === 'end';
              const isGw = n.nodeType.includes('gateway');
              const w = isEv ? EVENT_R * 2 : isGw ? GW_S : NODE_W;
              const h = isEv ? EVENT_R * 2 : isGw ? GW_S : NODE_H;
              return {
                x: n.positionX - ofsX,
                y: n.positionY - ofsY,
                w,
                h,
              };
            };

            const statusColor = (nodeId: string) => {
              const s = nodeStatusMap[nodeId];
              if (s === 'completed') return { fill: '#dcfce7', stroke: '#22c55e', text: '#15803d', badge: '已完成' };
              if (s === 'active') return { fill: '#dbeafe', stroke: '#3b82f6', text: '#1d4ed8', badge: '进行中' };
              if (s === 'rejected') return { fill: '#fef2f2', stroke: '#ef4444', text: '#b91c1c', badge: '已拒绝' };
              return { fill: isDark ? '#1f2937' : '#f9fafb', stroke: isDark ? '#4b5563' : '#d1d5db', text: isDark ? '#9ca3af' : '#6b7280', badge: '待处理' };
            };

            return (
              <div className="overflow-auto relative" style={{ maxHeight: 500 }}>
                {/* Legend + Zoom controls */}
                <div className="flex items-center justify-between px-4 py-2 border-b dark:border-gray-700 sticky top-0 z-10" style={{ background: isDark ? '#1f2937' : '#fff' }}>
                  <div className="flex items-center gap-4">
                    <span className={`text-xs font-medium ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>图例：</span>
                    {[
                      { color: '#22c55e', label: '已完成' },
                      { color: '#3b82f6', label: '进行中' },
                      { color: '#ef4444', label: '已拒绝' },
                      { color: isDark ? '#4b5563' : '#d1d5db', label: '待处理' },
                    ].map(l => (
                      <span key={l.label} className="flex items-center gap-1 text-xs">
                        <span className="w-3 h-3 rounded-sm border-2" style={{ borderColor: l.color, background: l.color + '30' }} />
                        <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>{l.label}</span>
                      </span>
                    ))}
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => setFlowZoom(z => Math.max(0.5, z - 0.1))}
                      className={`p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-600 ${isDark ? 'text-gray-400' : 'text-gray-500'}`} title="缩小">
                      <ZoomOut size={14} />
                    </button>
                    <span className={`text-xs w-10 text-center ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{Math.round(flowZoom * 100)}%</span>
                    <button onClick={() => setFlowZoom(z => Math.min(2, z + 0.1))}
                      className={`p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-600 ${isDark ? 'text-gray-400' : 'text-gray-500'}`} title="放大">
                      <ZoomIn size={14} />
                    </button>
                    <button onClick={() => setFlowZoom(1)}
                      className={`p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-600 ${isDark ? 'text-gray-400' : 'text-gray-500'}`} title="重置">
                      <Maximize2 size={14} />
                    </button>
                  </div>
                </div>
                <svg width={Math.max(svgW, 400) * flowZoom} height={Math.max(svgH, 200) * flowZoom} viewBox={`0 0 ${Math.max(svgW, 400)} ${Math.max(svgH, 200)}`}>
                  <defs>
                    <marker id="flow-arrow" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
                      <polygon points="0 0, 8 3, 0 6" fill={isDark ? '#6b7280' : '#9ca3af'} />
                    </marker>
                    <marker id="flow-arrow-done" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
                      <polygon points="0 0, 8 3, 0 6" fill="#22c55e" />
                    </marker>
                    <marker id="flow-arrow-active" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
                      <polygon points="0 0, 8 3, 0 6" fill="#3b82f6" />
                    </marker>
                    {/* Pulse animation for active nodes */}
                    <filter id="glow-blue">
                      <feGaussianBlur stdDeviation="3" result="coloredBlur" />
                      <feMerge><feMergeNode in="coloredBlur" /><feMergeNode in="SourceGraphic" /></feMerge>
                    </filter>
                  </defs>

                  {/* Edges */}
                  {wfEdges.map(edge => {
                    const src = wfNodes.find(n => n.id === edge.sourceNodeId);
                    const tgt = wfNodes.find(n => n.id === edge.targetNodeId);
                    if (!src || !tgt) return null;
                    const displayMeta = (edge.condition as {
                      displayMeta?: { routingMode?: EdgeRoutingMode; lineStyle?: string; color?: string };
                    })?.displayMeta;
                    const routingMode = displayMeta?.routingMode || 'straight';
                    const { d, labelX, labelY } = computeEdgePath({
                      sourceRect: getNodeRect(src),
                      targetRect: getNodeRect(tgt),
                      routingMode,
                    });
                    const srcStatus = nodeStatusMap[src.id];
                    const tgtStatus = nodeStatusMap[tgt.id];
                    const edgeDone = srcStatus === 'completed' && (tgtStatus === 'completed' || tgtStatus === 'active');
                    const edgeActive = srcStatus === 'completed' && tgtStatus === 'active';
                    const stroke = edgeActive ? '#3b82f6' : edgeDone ? '#22c55e' : displayMeta?.color || (isDark ? '#4b5563' : '#d1d5db');
                    const markerId = `flow-arrow-${edge.id.replace(/[^a-zA-Z0-9]/g, '')}`;
                    const dash = edgeActive
                      ? '6 3'
                      : strokeDashForLineStyle(displayMeta?.lineStyle as 'solid' | 'dashed' | 'dotted' | undefined)
                        || (edge.isDefault ? '8 4' : undefined);
                    return (
                      <g key={edge.id}>
                        <defs>
                          <marker id={markerId} markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
                            <polygon points="0 0, 8 3, 0 6" fill={stroke} />
                          </marker>
                        </defs>
                        <path
                          d={d}
                          fill="none"
                          stroke={stroke}
                          strokeWidth={edgeActive ? 2.5 : edgeDone ? 2 : 1.5}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeDasharray={dash}
                          markerEnd={`url(#${markerId})`}
                        />
                        {edge.label && (
                          <text x={labelX} y={labelY - 6} textAnchor="middle" fontSize="10" fill={stroke}>{edge.label}</text>
                        )}
                      </g>
                    );
                  })}

                  {/* Nodes */}
                  {wfNodes.map(n => {
                    const isEv = n.nodeType === 'start' || n.nodeType === 'end';
                    const isGw = n.nodeType.includes('gateway');
                    const sc = statusColor(n.id);
                    const isActive = nodeStatusMap[n.id] === 'active';
                    const x = n.positionX - ofsX;
                    const y = n.positionY - ofsY;

                    if (isEv) {
                      const cx = x + EVENT_R;
                      const cy = y + EVENT_R;
                      return (
                        <g key={n.id} filter={isActive ? 'url(#glow-blue)' : undefined}>
                          <circle cx={cx} cy={cy} r={EVENT_R} fill={sc.fill} stroke={sc.stroke} strokeWidth={2.5}>
                            {isActive && <animate attributeName="r" values={`${EVENT_R};${EVENT_R + 3};${EVENT_R}`} dur="1.5s" repeatCount="indefinite" />}
                          </circle>
                          <text x={cx} y={cy + 4} textAnchor="middle" fontSize="11" fontWeight="bold" fill={sc.text}>
                            {n.nodeType === 'start' ? '▶' : '■'}
                          </text>
                          <text x={cx} y={cy + EVENT_R + 14} textAnchor="middle" fontSize="10" fill={sc.text}>{n.name}</text>
                        </g>
                      );
                    }

                    if (isGw) {
                      const cx = x + GW_S / 2;
                      const cy = y + GW_S / 2;
                      const half = GW_S / 2;
                      return (
                        <g key={n.id} filter={isActive ? 'url(#glow-blue)' : undefined}>
                          <polygon points={`${cx},${cy - half} ${cx + half},${cy} ${cx},${cy + half} ${cx - half},${cy}`}
                            fill={sc.fill} stroke={sc.stroke} strokeWidth={2} />
                          <text x={cx} y={cy + 4} textAnchor="middle" fontSize="11" fontWeight="bold" fill={sc.text}>
                            {n.nodeType === 'exclusive_gateway' ? '✕' : '+'}
                          </text>
                          <text x={cx} y={cy + half + 14} textAnchor="middle" fontSize="10" fill={sc.text}>{n.name}</text>
                        </g>
                      );
                    }

                    // Task/Approval/Service rectangle
                    const taskForNode = (instance?.tasks || []).find(t => t.nodeId === n.id);
                    const canClick = isActive && taskForNode && onViewTask && currentUser && taskForNode.assignee?.id === currentUser.id;
                    return (
                      <g key={n.id} filter={isActive ? 'url(#glow-blue)' : undefined}
                        style={canClick ? { cursor: 'pointer' } : undefined}
                        onClick={canClick ? () => onViewTask(taskForNode.id) : undefined}>
                        <rect x={x} y={y} width={NODE_W} height={NODE_H} rx={8} fill={sc.fill} stroke={sc.stroke} strokeWidth={2}>
                          {isActive && <animate attributeName="stroke-width" values="2;3.5;2" dur="1.5s" repeatCount="indefinite" />}
                        </rect>
                        {/* Type bar top */}
                        <rect x={x} y={y} width={NODE_W} height={18} rx={8} fill={sc.stroke} />
                        <rect x={x} y={y + 10} width={NODE_W} height={8} fill={sc.stroke} />
                        <text x={x + NODE_W / 2} y={y + 13} textAnchor="middle" fontSize="9" fontWeight="600" fill="white">
                          {n.nodeType === 'user_task' ? '人工任务' : n.nodeType === 'approval' ? '审批节点' : '服务任务'}
                        </text>
                        {/* Name */}
                        <text x={x + NODE_W / 2} y={y + 36} textAnchor="middle" fontSize="12" fontWeight="500" fill={sc.text}>
                          {n.name.length > 12 ? n.name.substring(0, 12) + '...' : n.name}
                        </text>
                        {/* Status badge */}
                        <text x={x + NODE_W / 2} y={y + NODE_H + 14} textAnchor="middle" fontSize="9" fill={sc.stroke} fontWeight="500">
                          {sc.badge}{taskForNode?.assignee?.name ? ` · ${taskForNode.assignee.name}` : ''}
                        </text>
                      </g>
                    );
                  })}
                </svg>
              </div>
            );
          })()}
        </div>
      )}

      {/* Tasks */}
      {activeTab === 'tasks' && (
        <div className={`rounded-lg border overflow-hidden ${cardBg}`}>
          {(!instance.tasks || instance.tasks.length === 0) ? (
            <div className="text-center py-8">
              <FileText size={36} className="mx-auto text-gray-400 mb-2" />
              <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>暂无任务</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className={isDark ? 'bg-gray-700/50' : 'bg-gray-50'}>
                  <th className="text-left px-4 py-2.5 font-medium">编号</th>
                  <th className="text-left px-4 py-2.5 font-medium">名称</th>
                  <th className="text-left px-4 py-2.5 font-medium">状态</th>
                  <th className="text-left px-4 py-2.5 font-medium">处理人</th>
                  <th className="text-left px-4 py-2.5 font-medium">结果</th>
                  <th className="text-left px-4 py-2.5 font-medium">时间</th>
                  {onViewTask && <th className="text-left px-4 py-2.5 font-medium">操作</th>}
                </tr>
              </thead>
              <tbody>
                {instance.tasks.map((task: WorkflowTaskItem) => {
                  const isMyTask = currentUser && task.assignee?.id === currentUser.id;
                  const isActionable = isMyTask && (task.status === 'pending' || task.status === 'claimed');
                  return (
                    <tr key={task.id} className={`border-t ${
                      isMyTask
                        ? isDark
                          ? 'border-amber-700/50 bg-amber-900/10'
                          : 'border-amber-200 bg-amber-50/60'
                        : isDark ? 'border-gray-700' : 'border-gray-200'
                    }`}>
                      <td className="px-4 py-2.5 font-mono text-xs">{task.taskNumber}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1.5">
                          {task.name}
                          {isMyTask && (
                            <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                              isDark ? 'bg-amber-900/30 text-amber-400' : 'bg-amber-100 text-amber-700'
                            }`}>我的</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          STATUS_CONFIG[task.status]?.bg || 'bg-gray-100 text-gray-600'
                        }`}>
                          {TASK_STATUS_LABELS[task.status] || task.status}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">{task.assignee?.name || '-'}</td>
                      <td className="px-4 py-2.5">{task.result || '-'}</td>
                      <td className="px-4 py-2.5 text-xs">{new Date(task.createdAt).toLocaleString('zh-CN')}</td>
                      {onViewTask && (
                        <td className="px-4 py-2.5">
                          {isActionable && (
                            <button
                              onClick={() => onViewTask(task.id)}
                              className={`flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg font-medium transition-colors ${
                                isDark
                                  ? 'bg-amber-900/30 text-amber-400 hover:bg-amber-900/50'
                                  : 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                              }`}
                            >
                              <CheckCircle size={12} /> 去处理
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Logs */}
      {activeTab === 'logs' && (
        <div className={`rounded-lg border ${cardBg}`}>
          {(!instance.logs || instance.logs.length === 0) ? (
            <div className="text-center py-8">
              <Clock size={36} className="mx-auto text-gray-400 mb-2" />
              <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>暂无日志</p>
            </div>
          ) : (
            <div className="relative pl-6 py-2">
              {/* Vertical timeline line */}
              <div className={`absolute left-[1.45rem] top-0 bottom-0 w-0.5 ${isDark ? 'bg-gray-700' : 'bg-gray-200'}`} />
              {instance.logs.map((log: WorkflowInstanceLog, i: number) => {
                const config = EVENT_TYPE_CONFIG[log.eventType];
                const LogIcon = config?.icon || GitBranch;
                const dotColor = config?.color || 'bg-gray-400';
                const isInstance = log.eventType?.startsWith('instance_');
                return (
                  <div key={i} className={`relative flex items-start gap-3 px-4 py-3 ${
                    i < instance.logs.length - 1 ? '' : ''
                  }`}>
                    {/* Timeline dot */}
                    <div className={`relative z-10 flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center ${dotColor}`}>
                      <LogIcon size={12} className="text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-sm font-semibold ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
                          {config?.label || log.eventType}
                        </span>
                        {isInstance && (
                          <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                            isDark ? 'bg-gray-700 text-gray-300' : 'bg-gray-100 text-gray-600'
                          }`}>流程事件</span>
                        )}
                        <span className={`ml-auto text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                          {new Date(log.createdAt).toLocaleString('zh-CN')}
                        </span>
                      </div>
                      <div className={`flex items-center gap-2 text-xs mt-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                        <span className="font-medium">{log.actor?.name || '系统'}</span>
                        {log.nodeName && (
                          <>
                            <span>·</span>
                            <span className={`px-1.5 py-0.5 rounded ${isDark ? 'bg-gray-700' : 'bg-gray-100'}`}>{log.nodeName}</span>
                          </>
                        )}
                      </div>
                      {log.details && (
                        <details className="mt-1.5 group">
                          <summary className={`text-xs cursor-pointer select-none ${isDark ? 'text-gray-500 hover:text-gray-300' : 'text-gray-400 hover:text-gray-600'}`}>
                            查看详情
                          </summary>
                          <div className={`mt-1 text-xs font-mono p-2 rounded ${isDark ? 'bg-gray-700 text-gray-300' : 'bg-gray-50 text-gray-600'}`}>
                            {JSON.stringify(log.details, null, 2).substring(0, 300)}
                          </div>
                        </details>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default WorkflowInstanceDetailPage;