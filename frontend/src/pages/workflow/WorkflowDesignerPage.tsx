import {
    ArrowLeft, CheckCircle, Cog, CornerDownRight, Diamond, GitMerge, Maximize, Minus, MousePointer, Play, Plus, Save, Send, Settings, Square, Trash2, User, X, ZoomIn, ZoomOut
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useApp } from '../../contexts/AppContext';
import { workflowsApi } from '../../services';
import { systemApi } from '../../services/system/system';
import type { WorkflowApprovalConfig, WorkflowAssigneeConfig, WorkflowButton, WorkflowCondition, WorkflowDefinitionDetail, WorkflowEdge, WorkflowFormConfig, WorkflowFormField, WorkflowNode, WorkflowNodeType, WorkflowTimeoutConfig } from '../../types';
import {
  computeEdgePath,
  inferEdgeColorFromLabel,
  strokeDashForLineStyle,
  WORKFLOW_EDGE_COLORS,
  type EdgeLineStyle,
  type EdgeRoutingMode,
} from './workflowCanvasPath';
import { APPROVAL_BUTTON_PRESETS, edgeOptionLabel } from './workflowButtonRoute';
import AssigneeHandlersEditor from './AssigneeHandlersEditor';
import {
  formatHandlersBadge,
  validateAssigneeHandlers,
} from './assigneeHandlers';

/** Service task action config. */
interface ActionConfigLocal {
  serviceType?: string;
  serviceUrl?: string;
  retryOnFailure?: boolean;
  [key: string]: unknown;
}

/** Gateway config. */
interface GatewayConfigLocal {
  defaultEdgeId?: string;
  [key: string]: unknown;
}

/** Extended form config used by the designer (adds formType). */
interface FormConfigLocal extends WorkflowFormConfig {
  formType?: 'default' | 'custom' | 'embedded' | 'approval' | 'feedback' | 'checklist';
}

/** Edge condition with displayMeta for the visual designer. */
interface ConditionLocal extends WorkflowCondition {
  displayMeta?: {
    routingMode?: EdgeRoutingMode;
    color?: string;
    lineStyle?: EdgeLineStyle;
  };
}

/* ─── Constants ─── */
const NODE_TYPES: { type: WorkflowNodeType; label: string; icon: LucideIcon; color: string }[] = [
  { type: 'start', label: '开始', icon: Play, color: 'bg-green-500' },
  { type: 'end', label: '结束', icon: Square, color: 'bg-red-500' },
  { type: 'user_task', label: '人工任务', icon: User, color: 'bg-blue-500' },
  { type: 'approval', label: '审批节点', icon: CheckCircle, color: 'bg-purple-500' },
  { type: 'service_task', label: '服务任务', icon: Cog, color: 'bg-amber-500' },
  { type: 'exclusive_gateway', label: '排他网关', icon: Diamond, color: 'bg-yellow-500' },
  { type: 'parallel_gateway', label: '并行网关', icon: GitMerge, color: 'bg-teal-500' },
];

const NODE_WIDTH = 160;
const NODE_HEIGHT = 72;
const GATEWAY_SIZE = 48;
const EVENT_SIZE = 48;

interface NodeLocal {
  id: string;
  nodeKey: string;
  name: string;
  description?: string;
  nodeType: WorkflowNodeType;
  positionX: number;
  positionY: number;
  sortOrder: number;
  assigneeConfig?: WorkflowAssigneeConfig;
  approvalConfig?: WorkflowApprovalConfig;
  formConfig?: FormConfigLocal;
  actionConfig?: ActionConfigLocal;
  gatewayConfig?: GatewayConfigLocal;
  timeoutConfig?: WorkflowTimeoutConfig;
}

interface EdgeLocal {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  label?: string;
  condition?: ConditionLocal;
  isDefault: boolean;
  sortOrder: number;
  routingMode?: EdgeRoutingMode;
  color?: string;
  lineStyle?: EdgeLineStyle;
}

function buildNewEdge(
  sourceNodeId: string,
  targetNodeId: string,
  sortOrder: number,
  routingMode: EdgeRoutingMode,
): EdgeLocal {
  return {
    id: tmpId(),
    sourceNodeId,
    targetNodeId,
    isDefault: false,
    sortOrder,
    routingMode,
  };
}

const EDGE_COLORS = [
  { label: '默认', value: '', lineStyle: 'solid' as EdgeLineStyle },
  { label: '通过', value: WORKFLOW_EDGE_COLORS.approve, lineStyle: 'solid' as EdgeLineStyle },
  { label: '驳回', value: WORKFLOW_EDGE_COLORS.reject, lineStyle: 'solid' as EdgeLineStyle },
  { label: '条件', value: WORKFLOW_EDGE_COLORS.condition, lineStyle: 'solid' as EdgeLineStyle },
  { label: '默认路径', value: WORKFLOW_EDGE_COLORS.neutral, lineStyle: 'dashed' as EdgeLineStyle },
  { label: '蓝色', value: '#3b82f6', lineStyle: 'solid' as EdgeLineStyle },
  { label: '橙色', value: '#f97316', lineStyle: 'solid' as EdgeLineStyle },
  { label: '紫色', value: '#a855f7', lineStyle: 'solid' as EdgeLineStyle },
];

type DesignerTool = 'select' | 'connect';

interface Props {
  definitionId: string;
  onBack: () => void;
}

/* ─── Helper: generate temp IDs ─── */
let counter = 0;
const tmpId = () => `tmp_${Date.now()}_${++counter}`;

/* ─── WorkflowDesignerPage Component ─── */
const WorkflowDesignerPage: React.FC<Props> = ({ definitionId, onBack }) => {
  const { theme } = useApp();
  const isDark = theme === 'dark';

  // Data
  const [definition, setDefinition] = useState<WorkflowDefinitionDetail | null>(null);
  const [nodes, setNodes] = useState<NodeLocal[]>([]);
  const [edges, setEdges] = useState<EdgeLocal[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [defName, setDefName] = useState('');
  const [defDescription, setDefDescription] = useState('');
  const [defEntityType, setDefEntityType] = useState<string>('');
  const [defEntityViewConfig, setDefEntityViewConfig] = useState<{ fields: { key: string; label: string }[] } | null>(null);
  const [availableEntityFields, setAvailableEntityFields] = useState<{ key: string; type: string }[]>([]);
  const [entityTypeOptions, setEntityTypeOptions] = useState<{ key: string; displayName: string; module: string }[]>([]);

  // Lookup data for assignee config
  const [allUsers, setAllUsers] = useState<{ id: string; name: string; realName?: string; email?: string; departmentId?: string | null; employeeCode?: string | null; status?: string }[]>([]);
  const [allRoles, setAllRoles] = useState<{ id: string; name: string }[]>([]);
  const [allDepartments, setAllDepartments] = useState<{ id: string; name: string }[]>([]);

  // Canvas
  const canvasRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });

  // Tools
  const [activeTool, setActiveTool] = useState<DesignerTool>('select');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  // Node dragging
  const [dragging, setDragging] = useState<{ id: string; offsetX: number; offsetY: number } | null>(null);

  // Edge drawing
  const [drawingEdge, setDrawingEdge] = useState<{ sourceId: string; mouseX: number; mouseY: number } | null>(null);

  // Edge routing
  const [defaultRoutingMode, setDefaultRoutingMode] = useState<EdgeRoutingMode>('orthogonal');

  // Property panel
  const [showProperties, setShowProperties] = useState(true);

  // Name editing
  const [editingName, setEditingName] = useState(false);

  // Minimap
  const [showMinimap, _setShowMinimap] = useState(true);

  /* ─── Load ─── */
  useEffect(() => {
    (async () => {
      try {
        const data = await workflowsApi.get(definitionId);
        setDefinition(data);
        setDefName(data.name);
        setDefDescription(data.description || '');
        setDefEntityType(data.entityType || '');
        setDefEntityViewConfig(data.entityViewConfig || null);
        // Load entity type options
        try {
          const types = await workflowsApi.entityTypes();
          setEntityTypeOptions(types);
        } catch { /* ignore */ }
        setNodes(
          ((data.nodes || []).map((n: WorkflowNode) => ({
            id: n.id,
            nodeKey: n.nodeKey,
            name: n.name,
            description: n.description,
            nodeType: n.nodeType,
            positionX: n.positionX,
            positionY: n.positionY,
            sortOrder: n.sortOrder,
            assigneeConfig: n.assigneeConfig,
            approvalConfig: n.approvalConfig,
            formConfig: n.formConfig,
            actionConfig: n.actionConfig,
            gatewayConfig: n.gatewayConfig,
            timeoutConfig: n.timeoutConfig,
          }))) as any
        );
        setEdges(
          (data.edges || []).map((e: WorkflowEdge) => {
            const display = (e.condition as ConditionLocal)?.displayMeta || {};
            return {
              id: e.id,
              sourceNodeId: e.sourceNodeId,
              targetNodeId: e.targetNodeId,
              label: e.label,
              condition: e.condition,
              isDefault: e.isDefault,
              sortOrder: e.sortOrder,
              routingMode: display.routingMode || undefined,
              color: display.color || undefined,
              lineStyle: display.lineStyle || undefined,
            };
          })
        );
      } catch (err) {
        console.error('Failed to load workflow', err);
      }
      setLoading(false);
    })();
  }, [definitionId]);

  // Load users, roles, departments for assignee config dropdowns
  useEffect(() => {
    (async () => {
      try {
        const [usersData, rolesData, deptsData] = await Promise.all([
          systemApi.users(),
          systemApi.roles(),
          systemApi.departments(),
        ]);
        setAllUsers((usersData || []).map((u: { id: string; name: string; realName?: string; email?: string; departmentId?: string | null; employeeCode?: string | null; status?: string }) => ({
          id: u.id,
          name: u.name,
          realName: u.realName,
          email: u.email,
          departmentId: u.departmentId,
          employeeCode: u.employeeCode,
          status: u.status,
        })));
        setAllRoles((rolesData || []).map((r: { id: string; name: string }) => ({ id: r.id, name: r.name })));
        setAllDepartments((deptsData || []).map((d: { id: string; name: string }) => ({ id: d.id, name: d.name })));
      } catch (err) {
        console.warn('Failed to load lookup data for assignee config', err);
      }
    })();
  }, []);

  // Load available entity fields when entity type changes
  useEffect(() => {
    if (!defEntityType) {
      setAvailableEntityFields([]);
      return;
    }
    (async () => {
      try {
        const data = await workflowsApi.entityFields(defEntityType);
        setAvailableEntityFields(data.fields || []);
      } catch {
        setAvailableEntityFields([]);
      }
    })();
  }, [defEntityType]);

  /* ─── Save ─── */
  const handleSave = async () => {
    if (!definition) return;

    for (const n of nodes) {
      if (n.nodeType !== 'approval' && n.nodeType !== 'user_task') continue;
      const assigneeErr = validateAssigneeHandlers(n.assigneeConfig);
      if (assigneeErr) {
        toast.error(`节点「${n.name}」${assigneeErr}，无法保存`);
        return;
      }
      const buttons = n.formConfig?.buttons || [];
      const outTargetKeys = new Set(
        edges
          .filter(e => e.sourceNodeId === n.id)
          .map(e => nodes.find(x => x.id === e.targetNodeId)?.nodeKey)
          .filter(Boolean) as string[],
      );
      for (const btn of buttons) {
        if (btn.action === 'route' || btn.action === 'complete' || btn.action === 'save') {
          if (!btn.targetNodeKey) {
            toast.error(`节点「${n.name}」按钮「${btn.label || btn.key}」未绑定出边目标，无法保存`);
            return;
          }
          if (!outTargetKeys.has(btn.targetNodeKey)) {
            toast.error(`节点「${n.name}」按钮「${btn.label || btn.key}」绑定的目标节点无效，请重新选择出边`);
            return;
          }
        }
      }
    }

    setSaving(true);
    try {
      await workflowsApi.update(definitionId, {
        name: defName,
        description: defDescription || undefined,
        entityType: defEntityType || undefined,
        entityViewConfig: defEntityViewConfig || null,
      } as any);

      await workflowsApi.saveDesign(definitionId, {
        nodes: nodes.map((n, i) => ({
          nodeKey: n.nodeKey,
          name: n.name,
          description: n.description,
          nodeType: n.nodeType,
          positionX: n.positionX,
          positionY: n.positionY,
          sortOrder: i,
          assigneeConfig: n.assigneeConfig,
          approvalConfig: n.approvalConfig,
          formConfig: n.formConfig,
          actionConfig: n.actionConfig,
          gatewayConfig: n.gatewayConfig,
          timeoutConfig: n.timeoutConfig,
        })),
        edges: edges.map((e, i) => {
          const srcNode = nodes.find(n => n.id === e.sourceNodeId);
          const tgtNode = nodes.find(n => n.id === e.targetNodeId);
          // Merge display metadata into condition
          const baseCondition = e.condition ? { ...e.condition } : {};
          if (e.routingMode || e.color || e.lineStyle) {
            baseCondition.displayMeta = {
              ...(baseCondition.displayMeta || {}),
              ...(e.routingMode ? { routingMode: e.routingMode } : {}),
              ...(e.color ? { color: e.color } : {}),
              ...(e.lineStyle ? { lineStyle: e.lineStyle } : {}),
            };
          } else {
            delete baseCondition.displayMeta;
          }
          return {
            sourceNodeKey: srcNode?.nodeKey || '',
            targetNodeKey: tgtNode?.nodeKey || '',
            label: e.label,
            condition: Object.keys(baseCondition).length > 0 ? baseCondition : undefined,
            isDefault: e.isDefault,
            sortOrder: i,
          };
        }),
      });

      const data = await workflowsApi.get(definitionId);
      setDefinition(data);
      setNodes(data.nodes.map((n: WorkflowNode) => ({
        id: n.id, nodeKey: n.nodeKey, name: n.name, description: n.description,
        nodeType: n.nodeType, positionX: n.positionX, positionY: n.positionY,
        sortOrder: n.sortOrder, assigneeConfig: n.assigneeConfig,
        approvalConfig: n.approvalConfig, formConfig: n.formConfig,
        actionConfig: n.actionConfig, gatewayConfig: n.gatewayConfig,
        timeoutConfig: n.timeoutConfig,
      })) as any);
      setEdges(data.edges.map((e: WorkflowEdge) => {
        const display = (e.condition as ConditionLocal)?.displayMeta || {};
        return {
          id: e.id, sourceNodeId: e.sourceNodeId, targetNodeId: e.targetNodeId,
          label: e.label, condition: e.condition, isDefault: e.isDefault,
          sortOrder: e.sortOrder, routingMode: display.routingMode || undefined,
          color: display.color || undefined, lineStyle: display.lineStyle || undefined,
        };
      }));
      setDirty(false);
    } catch (err: unknown) {
      toast.error('保存失败: ' + (err instanceof Error ? err.message : String(err)));
    }
    setSaving(false);
  };

  const handlePublish = async () => {
    try {
      await handleSave();
      await workflowsApi.publish(definitionId);
      toast.success('发布成功');
      onBack();
    } catch (err: unknown) {
      toast.error('发布失败: ' + (err instanceof Error ? err.message : String(err)));
    }
  };

  /* ─── Node ops ─── */
  const addNode = (type: WorkflowNodeType, dropX?: number, dropY?: number) => {
    const typeLabel = NODE_TYPES.find(t => t.type === type)?.label || type;
    const key = `${type}_${Date.now()}`; // eslint-disable-line react-hooks/purity
    const cx = dropX !== undefined ? dropX : (-panOffset.x + 400) / zoom;
    const cy = dropY !== undefined ? dropY : (-panOffset.y + 250) / zoom;
    const n: NodeLocal = {
      id: tmpId(),
      nodeKey: key,
      name: typeLabel,
      nodeType: type,
      positionX: cx,
      positionY: cy,
      sortOrder: nodes.length,
    };
    setNodes(prev => [...prev, n]);
    setSelectedNodeId(n.id);
    setSelectedEdgeId(null);
    setDirty(true);
  };

  const deleteSelected = () => {
    if (selectedNodeId) {
      setEdges(prev => prev.filter(e => e.sourceNodeId !== selectedNodeId && e.targetNodeId !== selectedNodeId));
      setNodes(prev => prev.filter(n => n.id !== selectedNodeId));
      setSelectedNodeId(null);
      setDirty(true);
    } else if (selectedEdgeId) {
      setEdges(prev => prev.filter(e => e.id !== selectedEdgeId));
      setSelectedEdgeId(null);
      setDirty(true);
    }
  };

  const updateNode = (id: string, patch: Partial<NodeLocal>) => {
    setNodes(prev => prev.map(n => n.id === id ? { ...n, ...patch } : n));
    setDirty(true);
  };

  const updateEdge = (id: string, patch: Partial<EdgeLocal>) => {
    setEdges(prev => prev.map(e => e.id === id ? { ...e, ...patch } : e));
    setDirty(true);
  };

  /* ─── Canvas events ─── */
  const canvasToWorld = (clientX: number, clientY: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: (clientX - rect.left - panOffset.x) / zoom,
      y: (clientY - rect.top - panOffset.y) / zoom,
    };
  };

  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    if (e.target === canvasRef.current || (e.target as HTMLElement).dataset.canvas) {
      setSelectedNodeId(null);
      setSelectedEdgeId(null);
      if (e.button === 1 || (e.button === 0 && activeTool === 'select' && !dragging)) {
        setIsPanning(true);
        setPanStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y });
      }
    }
  };

  const handleCanvasMouseMove = (e: React.MouseEvent) => {
    if (isPanning) {
      setPanOffset({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
      return;
    }
    if (dragging) {
      const world = canvasToWorld(e.clientX, e.clientY);
      updateNode(dragging.id, {
        positionX: world.x - dragging.offsetX,
        positionY: world.y - dragging.offsetY,
      });
      return;
    }
    if (drawingEdge) {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      setDrawingEdge({
        ...drawingEdge,
        mouseX: (e.clientX - rect.left - panOffset.x) / zoom,
        mouseY: (e.clientY - rect.top - panOffset.y) / zoom,
      });
    }
  };

  const handleCanvasMouseUp = () => {
    setIsPanning(false);
    setDragging(null);
    if (drawingEdge) {
      setDrawingEdge(null);
    }
  };

  const handleNodeMouseDown = (e: React.MouseEvent, nodeId: string) => {
    e.stopPropagation();
    setSelectedNodeId(nodeId);
    setSelectedEdgeId(null);

    if (activeTool === 'connect') {
      const node = nodes.find(n => n.id === nodeId);
      if (node) {
        setDrawingEdge({
          sourceId: nodeId,
          mouseX: node.positionX + NODE_WIDTH / 2,
          mouseY: node.positionY + NODE_HEIGHT / 2,
        });
      }
      return;
    }

    const world = canvasToWorld(e.clientX, e.clientY);
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;
    setDragging({
      id: nodeId,
      offsetX: world.x - node.positionX,
      offsetY: world.y - node.positionY,
    });
  };

  const handleNodeMouseUp = (e: React.MouseEvent, nodeId: string) => {
    if (drawingEdge && drawingEdge.sourceId !== nodeId) {
      e.stopPropagation();
      const exists = edges.some(
        edge => edge.sourceNodeId === drawingEdge.sourceId && edge.targetNodeId === nodeId
      );
      if (!exists) {
        setEdges(prev => [
          ...prev,
          buildNewEdge(drawingEdge.sourceId, nodeId, prev.length, defaultRoutingMode),
        ]);
        setDirty(true);
      }
      setDrawingEdge(null);
    }
  };

  /* ─── Port: auto-connect from node port ─── */
  const handlePortMouseDown = (e: React.MouseEvent, nodeId: string) => {
    e.stopPropagation();
    e.preventDefault();
    const node = nodes.find(n => n.id === nodeId);
    if (node) {
      const isGateway = node.nodeType.includes('gateway');
      const isEvent = node.nodeType === 'start' || node.nodeType === 'end';
      setDrawingEdge({
        sourceId: nodeId,
        mouseX: node.positionX + (isEvent ? EVENT_SIZE / 2 : isGateway ? GATEWAY_SIZE / 2 : NODE_WIDTH / 2),
        mouseY: node.positionY + (isEvent ? EVENT_SIZE / 2 : isGateway ? GATEWAY_SIZE / 2 : NODE_HEIGHT / 2),
      });
    }
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setZoom(z => Math.max(0.3, Math.min(2, z + delta)));
  };

  /* ─── Keyboard ─── */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;
        deleteSelected();
      }
      if (e.key === 's' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedNodeId, selectedEdgeId, nodes, edges]);

  /* ─── Node center coords ─── */
  const nodeCenter = (nodeId: string) => {
    const n = nodes.find(nd => nd.id === nodeId);
    if (!n) return { x: 0, y: 0 };
    const isGateway = n.nodeType.includes('gateway');
    const isEvent = n.nodeType === 'start' || n.nodeType === 'end';
    return {
      x: n.positionX + (isEvent ? EVENT_SIZE / 2 : isGateway ? GATEWAY_SIZE / 2 : NODE_WIDTH / 2),
      y: n.positionY + (isEvent ? EVENT_SIZE / 2 : isGateway ? GATEWAY_SIZE / 2 : NODE_HEIGHT / 2),
    };
  };

  /* ─── Edge path computation ─── */
  const getNodeRect = (nodeId: string) => {
    const n = nodes.find(nd => nd.id === nodeId);
    if (!n) return { x: 0, y: 0, w: 0, h: 0 };
    const isGateway = n.nodeType.includes('gateway');
    const isEvent = n.nodeType === 'start' || n.nodeType === 'end';
    const w = isEvent ? EVENT_SIZE : isGateway ? GATEWAY_SIZE : NODE_WIDTH;
    const h = isEvent ? EVENT_SIZE : isGateway ? GATEWAY_SIZE : NODE_HEIGHT;
    return { x: n.positionX, y: n.positionY, w, h };
  };

  const computeEdgePathD = (edge: EdgeLocal): { d: string; labelX: number; labelY: number } => {
    const srcRect = getNodeRect(edge.sourceNodeId);
    const tgtRect = getNodeRect(edge.targetNodeId);
    const mode = edge.routingMode ?? defaultRoutingMode;
    return computeEdgePath({ sourceRect: srcRect, targetRect: tgtRect, routingMode: mode });
  };

  const renderMinimap = () => {
    if (!showMinimap || nodes.length === 0) return null;
    const MINIMAP_W = 180;
    const MINIMAP_H = 120;
    const MINIMAP_PAD = 10;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    nodes.forEach(n => {
      const isGw = n.nodeType.includes('gateway');
      const isEv = n.nodeType === 'start' || n.nodeType === 'end';
      const w = isEv ? EVENT_SIZE : isGw ? GATEWAY_SIZE : NODE_WIDTH;
      const h = isEv ? EVENT_SIZE : isGw ? GATEWAY_SIZE : NODE_HEIGHT;
      if (n.positionX < minX) minX = n.positionX;
      if (n.positionY < minY) minY = n.positionY;
      if (n.positionX + w > maxX) maxX = n.positionX + w;
      if (n.positionY + h > maxY) maxY = n.positionY + h;
    });
    const contentW = Math.max(maxX - minX + MINIMAP_PAD * 4, 100);
    const contentH = Math.max(maxY - minY + MINIMAP_PAD * 4, 60);
    const scaleX = (MINIMAP_W - MINIMAP_PAD * 2) / contentW;
    const scaleY = (MINIMAP_H - MINIMAP_PAD * 2) / contentH;
    const miniScale = Math.min(scaleX, scaleY);
    const ofsX = minX - MINIMAP_PAD * 2;
    const ofsY = minY - MINIMAP_PAD * 2;
    const canvasRect = canvasRef.current?.getBoundingClientRect();
    const vpLeft = (-panOffset.x / zoom - ofsX) * miniScale + MINIMAP_PAD;
    const vpTop = (-panOffset.y / zoom - ofsY) * miniScale + MINIMAP_PAD;
    const vpW = (canvasRect?.width || 600) / zoom * miniScale;
    const vpH = (canvasRect?.height || 400) / zoom * miniScale;

    return (
      <div
        className={`absolute bottom-3 right-3 rounded-lg border shadow-lg overflow-hidden ${isDark ? 'bg-gray-800/90 border-gray-600' : 'bg-white/90 border-gray-300'}`}
        style={{ width: MINIMAP_W, height: MINIMAP_H, zIndex: 20 }}
      >
        <svg width={MINIMAP_W} height={MINIMAP_H}>
          {edges.map(edge => {
            const src = nodes.find(n => n.id === edge.sourceNodeId);
            const tgt = nodes.find(n => n.id === edge.targetNodeId);
            if (!src || !tgt) return null;
            const isGwS = src.nodeType.includes('gateway');
            const isEvS = src.nodeType === 'start' || src.nodeType === 'end';
            const sw = isEvS ? EVENT_SIZE : isGwS ? GATEWAY_SIZE : NODE_WIDTH;
            const sh = isEvS ? EVENT_SIZE : isGwS ? GATEWAY_SIZE : NODE_HEIGHT;
            const isGwT = tgt.nodeType.includes('gateway');
            const isEvT = tgt.nodeType === 'start' || tgt.nodeType === 'end';
            const tw = isEvT ? EVENT_SIZE : isGwT ? GATEWAY_SIZE : NODE_WIDTH;
            const th = isEvT ? EVENT_SIZE : isGwT ? GATEWAY_SIZE : NODE_HEIGHT;
            const x1 = (src.positionX + sw / 2 - ofsX) * miniScale + MINIMAP_PAD;
            const y1 = (src.positionY + sh / 2 - ofsY) * miniScale + MINIMAP_PAD;
            const x2 = (tgt.positionX + tw / 2 - ofsX) * miniScale + MINIMAP_PAD;
            const y2 = (tgt.positionY + th / 2 - ofsY) * miniScale + MINIMAP_PAD;
            return (
              <line
                key={edge.id}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={edge.color || (isDark ? '#4b5563' : '#9ca3af')}
                strokeWidth={0.5}
              />
            );
          })}
          {nodes.map(n => {
            const isGw = n.nodeType.includes('gateway');
            const isEv = n.nodeType === 'start' || n.nodeType === 'end';
            const w = isEv ? EVENT_SIZE : isGw ? GATEWAY_SIZE : NODE_WIDTH;
            const h = isEv ? EVENT_SIZE : isGw ? GATEWAY_SIZE : NODE_HEIGHT;
            const mx = (n.positionX - ofsX) * miniScale + MINIMAP_PAD;
            const my = (n.positionY - ofsY) * miniScale + MINIMAP_PAD;
            const mw = w * miniScale;
            const mh = h * miniScale;
            const isSelected = n.id === selectedNodeId;
            const fill = n.nodeType === 'start' ? '#22c55e' : n.nodeType === 'end' ? '#ef4444'
              : n.nodeType === 'user_task' ? '#3b82f6' : n.nodeType === 'approval' ? '#a855f7'
              : n.nodeType === 'service_task' ? '#f59e0b' : n.nodeType.includes('gateway') ? '#eab308' : '#6b7280';
            if (isEv) {
              return (
                <circle
                  key={n.id}
                  cx={mx + mw / 2}
                  cy={my + mh / 2}
                  r={Math.max(mw / 2, 2)}
                  fill={fill}
                  stroke={isSelected ? '#3b82f6' : 'none'}
                  strokeWidth={1}
                />
              );
            }
            if (isGw) {
              return (
                <rect
                  key={n.id}
                  x={mx}
                  y={my}
                  width={mw}
                  height={mh}
                  fill={fill}
                  rx={1}
                  stroke={isSelected ? '#3b82f6' : 'none'}
                  strokeWidth={1}
                  transform={`rotate(45 ${mx + mw / 2} ${my + mh / 2})`}
                />
              );
            }
            return (
              <rect
                key={n.id}
                x={mx}
                y={my}
                width={mw}
                height={mh}
                fill={fill}
                rx={1}
                stroke={isSelected ? '#3b82f6' : 'none'}
                strokeWidth={1}
              />
            );
          })}
          <rect
            x={vpLeft}
            y={vpTop}
            width={vpW}
            height={vpH}
            fill="transparent"
            stroke="#3b82f6"
            strokeWidth={1}
            strokeDasharray="2 1"
            rx={1}
          />
        </svg>
      </div>
    );
  };

  /* ─── Connection ports helper ─── */
  const renderPorts = (nodeId: string, w: number, h: number) => {
    const portClass = 'absolute w-2 h-2 bg-blue-500 rounded-full border border-white opacity-0 group-hover:opacity-100 z-10 cursor-crosshair transition-opacity hover:scale-150';
    return (
      <>
        <div className={portClass} style={{ left: w / 2 - 4, top: -4 }} onMouseDown={e => handlePortMouseDown(e, nodeId)} />
        <div className={portClass} style={{ left: w, top: h / 2 - 4 }} onMouseDown={e => handlePortMouseDown(e, nodeId)} />
        <div className={portClass} style={{ left: w / 2 - 4, top: h }} onMouseDown={e => handlePortMouseDown(e, nodeId)} />
        <div className={portClass} style={{ left: -4, top: h / 2 - 4 }} onMouseDown={e => handlePortMouseDown(e, nodeId)} />
      </>
    );
  };

  const selectedNode = useMemo(() => nodes.find(n => n.id === selectedNodeId), [nodes, selectedNodeId]);
  const selectedEdge = useMemo(() => edges.find(e => e.id === selectedEdgeId), [edges, selectedEdgeId]);

  const cardBg = isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200';
  const inputBg = isDark ? 'bg-gray-700 border-gray-600 text-white' : 'bg-white border-gray-300 text-gray-900';

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[80vh]">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header toolbar */}
      <div className={`flex items-center justify-between p-3 rounded-t-lg border ${cardBg}`}>
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">
            <ArrowLeft size={18} />
          </button>
          {editingName ? (
            <input
              autoFocus
              value={defName}
              onChange={e => { setDefName(e.target.value); setDirty(true); }}
              onBlur={() => setEditingName(false)}
              onKeyDown={e => e.key === 'Enter' && setEditingName(false)}
              className={`px-2 py-1 rounded border text-lg font-semibold ${inputBg}`}
            />
          ) : (
            <h2
              className={`text-lg font-semibold cursor-pointer hover:text-blue-600 ${isDark ? 'text-white' : 'text-gray-900'}`}
              onClick={() => setEditingName(true)}
            >
              {defName}
              {dirty && <span className="text-amber-500 ml-1">{'\u25CF'}</span>}
            </h2>
          )}
          {definition && (
            <span className={`text-xs px-2 py-0.5 rounded-full ${
              definition.status === 'draft' ? 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
              : definition.status === 'published' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
              : 'bg-yellow-100 text-yellow-700'
            }`}>
              {definition.status === 'draft' ? '草稿' : definition.status === 'published' ? '已发布' : '已归档'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Select / Connect tools */}
          <div className="flex items-center gap-1 border-r pr-2 mr-2">
            <button
              onClick={() => setActiveTool('select')}
              className={`p-1.5 rounded ${activeTool === 'select' ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400' : 'hover:bg-gray-100 dark:hover:bg-gray-700'}`}
              title="选择工具"
            >
              <MousePointer size={16} />
            </button>
            <button
              onClick={() => setActiveTool('connect')}
              className={`p-1.5 rounded ${activeTool === 'connect' ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400' : 'hover:bg-gray-100 dark:hover:bg-gray-700'}`}
              title="连线工具"
            >
              <GitMerge size={16} />
            </button>
          </div>
          {/* Zoom */}
          <button onClick={() => setZoom(z => Math.min(2, z + 0.1))} className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700" title="放大">
            <ZoomIn size={16} />
          </button>
          <span className={`text-xs w-10 text-center ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            {Math.round(zoom * 100)}%
          </span>
          <button onClick={() => setZoom(z => Math.max(0.3, z - 0.1))} className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700" title="缩小">
            <ZoomOut size={16} />
          </button>
          <button onClick={() => { setZoom(1); setPanOffset({ x: 0, y: 0 }); }} className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700" title="重置视图">
            <Maximize size={16} />
          </button>
          {/* Edge routing mode toggle */}
          <div className="flex items-center gap-1 border-l pl-2 ml-2">
            <button
              onClick={() => setDefaultRoutingMode('straight')}
              className={`p-1.5 rounded ${defaultRoutingMode === 'straight' ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400' : 'hover:bg-gray-100 dark:hover:bg-gray-700'}`}
              title="直线连接"
            >
              <Minus size={16} />
            </button>
            <button
              onClick={() => setDefaultRoutingMode('orthogonal')}
              className={`p-1.5 rounded ${defaultRoutingMode === 'orthogonal' ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400' : 'hover:bg-gray-100 dark:hover:bg-gray-700'}`}
              title="折线连接"
            >
              <CornerDownRight size={16} />
            </button>
            <button
              onClick={() => setDefaultRoutingMode('smooth')}
              className={`p-1.5 rounded ${defaultRoutingMode === 'smooth' ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400' : 'hover:bg-gray-100 dark:hover:bg-gray-700'}`}
              title="曲线连接"
            >
              <GitMerge size={16} />
            </button>
          </div>
          {/* Delete */}
          <div className="border-l pl-2 ml-2 flex gap-1">
            {(selectedNodeId || selectedEdgeId) && (
              <button onClick={deleteSelected} className="p-1.5 rounded text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20" title="删除">
                <Trash2 size={16} />
              </button>
            )}
          </div>
          {/* Save / Publish */}
          <div className="border-l pl-2 ml-2 flex gap-1">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm disabled:opacity-50"
            >
              <Save size={14} /> {saving ? '保存中...' : '保存'}
            </button>
            {definition?.status === 'draft' && (
              <button
                onClick={handlePublish}
                className="flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm"
              >
                <Send size={14} /> 发布
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* ─── Left: Node palette ─── */}
        <div className={`w-48 border-l border-b border-r overflow-y-auto ${cardBg}`}>
          <div className={`px-3 py-2 text-xs font-semibold uppercase tracking-wider ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            节点
          </div>
          {NODE_TYPES.map(nt => (
            <div
              key={nt.type}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('application/workflow-node-type', nt.type);
                e.dataTransfer.effectAllowed = 'copy';
              }}
              onClick={() => addNode(nt.type)}
              className="flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 text-left transition-colors cursor-grab active:cursor-grabbing select-none"
            >
              <span className={`p-1 rounded ${nt.color} text-white`}>
                <nt.icon size={14} />
              </span>
              <span className={isDark ? 'text-gray-200' : 'text-gray-700'}>{nt.label}</span>
            </div>
          ))}
        </div>

        {/* ─── Center: Canvas ─── */}
        <div
          ref={canvasRef}
          className={`flex-1 relative overflow-hidden border-b ${isPanning ? 'cursor-grabbing' : activeTool === 'connect' ? 'cursor-crosshair' : 'cursor-default'}
            ${isDark ? 'bg-gray-900 border-gray-700' : 'bg-gray-50 border-gray-200'}`}
          style={{
            backgroundImage: isDark
              ? 'radial-gradient(circle, #374151 1px, transparent 1px)'
              : 'radial-gradient(circle, #d1d5db 1px, transparent 1px)',
            backgroundSize: `${20 * zoom}px ${20 * zoom}px`,
            backgroundPosition: `${panOffset.x}px ${panOffset.y}px`,
          }}
          onMouseDown={handleCanvasMouseDown}
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={handleCanvasMouseUp}
          onMouseLeave={handleCanvasMouseUp}
          onWheel={handleWheel}
          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
          onDrop={(e) => {
            e.preventDefault();
            const nodeType = e.dataTransfer.getData('application/workflow-node-type') as WorkflowNodeType;
            if (nodeType) {
              const world = canvasToWorld(e.clientX, e.clientY);
              const isGw = nodeType.includes('gateway');
              const isEv = nodeType === 'start' || nodeType === 'end';
              const ox = isEv ? EVENT_SIZE / 2 : isGw ? GATEWAY_SIZE / 2 : NODE_WIDTH / 2;
              const oy = isEv ? EVENT_SIZE / 2 : isGw ? GATEWAY_SIZE / 2 : NODE_HEIGHT / 2;
              addNode(nodeType, world.x - ox, world.y - oy);
            }
          }}
          data-canvas="true"
        >
          <div
            style={{
              transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoom})`,
              transformOrigin: '0 0',
              position: 'absolute',
              top: 0,
              left: 0,
              width: '5000px',
              height: '5000px',
            }}
          >
            {/* ─── SVG layer for edges ─── */}
            <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ overflow: 'visible' }}>
              <defs>
                <marker id="arrowhead" markerWidth="10" markerHeight="8" refX="10" refY="4" orient="auto">
                  <polygon points="0 0, 10 4, 0 8" fill={isDark ? '#9ca3af' : '#6b7280'} />
                </marker>
                <marker id="arrowhead-selected" markerWidth="10" markerHeight="8" refX="10" refY="4" orient="auto">
                  <polygon points="0 0, 10 4, 0 8" fill="#3b82f6" />
                </marker>
              </defs>
              {edges.map(edge => {
                const { d, labelX, labelY } = computeEdgePathD(edge);
                const isSelected = edge.id === selectedEdgeId;
                const lineStyle = edge.isDefault && !edge.lineStyle ? 'dashed' : edge.lineStyle;
                const edgeColor = edge.color || (isDark ? '#6b7280' : '#9ca3af');
                const activeColor = isSelected ? '#3b82f6' : edgeColor;
                const markerId = `arrow-${edge.id.replace(/[^a-zA-Z0-9]/g, '')}`;
                const dash = strokeDashForLineStyle(lineStyle);
                return (
                  <g key={edge.id}>
                    <defs>
                      <marker id={markerId} markerWidth="10" markerHeight="8" refX="10" refY="4" orient="auto">
                        <polygon points="0 0, 10 4, 0 8" fill={activeColor} />
                      </marker>
                    </defs>
                    <path
                      d={d}
                      fill="none"
                      stroke="transparent"
                      strokeWidth="12"
                      style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
                      onClick={(ev) => { ev.stopPropagation(); setSelectedEdgeId(edge.id); setSelectedNodeId(null); }}
                    />
                    <path
                      d={d}
                      fill="none"
                      stroke={activeColor}
                      strokeWidth={isSelected ? 2.5 : 2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeDasharray={dash}
                      markerEnd={`url(#${markerId})`}
                      className="pointer-events-none"
                    />
                    {edge.label && (
                      <>
                        <rect
                          x={labelX - 28}
                          y={labelY - 18}
                          width={56}
                          height={16}
                          rx={4}
                          fill={isDark ? '#1f2937' : '#ffffff'}
                          opacity={0.92}
                          className="pointer-events-none"
                        />
                        <text
                          x={labelX}
                          y={labelY - 7}
                          textAnchor="middle"
                          fontSize="11"
                          fill={activeColor}
                          className="pointer-events-none"
                        >
                          {edge.label}
                        </text>
                      </>
                    )}
                    {edge.isDefault && (
                      <text
                        x={labelX}
                        y={labelY + 14}
                        textAnchor="middle"
                        fontSize="9"
                        fill={isDark ? '#6b7280' : '#9ca3af'}
                        className="pointer-events-none"
                      >
                        默认
                      </text>
                    )}
                  </g>
                );
              })}
              {drawingEdge && (() => {
                const src = nodeCenter(drawingEdge.sourceId);
                return (
                  <line
                    x1={src.x}
                    y1={src.y}
                    x2={drawingEdge.mouseX}
                    y2={drawingEdge.mouseY}
                    stroke="#3b82f6"
                    strokeWidth={2}
                    strokeDasharray="6 3"
                    markerEnd="url(#arrowhead-selected)"
                  />
                );
              })()}
            </svg>

            {renderMinimap()}

            {/* ─── HTML layer for nodes ─── */}
            {nodes.map(node => {
              const isSelected = node.id === selectedNodeId;
              const isEvent = node.nodeType === 'start' || node.nodeType === 'end';
              const isGateway = node.nodeType.includes('gateway');
              const typeInfo = NODE_TYPES.find(t => t.type === node.nodeType);

              if (isEvent) {
                const isStart = node.nodeType === 'start';
                return (
                  <div
                    key={node.id}
                    className="absolute group"
                    style={{ left: node.positionX, top: node.positionY, width: EVENT_SIZE, height: EVENT_SIZE }}
                    onMouseDown={e => handleNodeMouseDown(e, node.id)}
                    onMouseUp={e => handleNodeMouseUp(e, node.id)}
                  >
                    {renderPorts(node.id, EVENT_SIZE, EVENT_SIZE)}
                    <div
                      className={`relative w-full h-full rounded-full flex items-center justify-center cursor-move text-white
                        ${isSelected ? 'ring-2 ring-blue-500 ring-offset-2' : ''}
                        shadow-md hover:shadow-lg transition-shadow`}
                    >
                      {isStart ? (
                        <div className="w-full h-full rounded-full bg-green-500 border-2 border-green-600 flex items-center justify-center">
                          <Play size={20} />
                        </div>
                      ) : (
                        <div className="w-full h-full rounded-full bg-red-500 flex items-center justify-center">
                          <div className="w-[80%] h-[80%] rounded-full border-[3px] border-red-700 flex items-center justify-center bg-red-500">
                            <Square size={16} />
                          </div>
                        </div>
                      )}
                    </div>
                    <div className={`text-center text-xs mt-1 whitespace-nowrap ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                      {node.name}
                    </div>
                  </div>
                );
              }

              if (isGateway) {
                return (
                  <div
                    key={node.id}
                    className="absolute group"
                    style={{ left: node.positionX, top: node.positionY, width: GATEWAY_SIZE, height: GATEWAY_SIZE }}
                    onMouseDown={e => handleNodeMouseDown(e, node.id)}
                    onMouseUp={e => handleNodeMouseUp(e, node.id)}
                  >
                    {renderPorts(node.id, GATEWAY_SIZE, GATEWAY_SIZE)}
                    <div
                      className={`w-full h-full flex items-center justify-center cursor-move
                        ${isSelected ? 'ring-2 ring-blue-500 ring-offset-2' : ''}
                        shadow-md hover:shadow-lg transition-shadow`}
                      style={{ transform: 'rotate(45deg)', background: node.nodeType === 'exclusive_gateway' ? '#eab308' : '#14b8a6' }}
                    >
                      <span style={{ transform: 'rotate(-45deg)' }} className="text-white">
                        {node.nodeType === 'exclusive_gateway' ? <X size={20} /> : <Plus size={20} />}
                      </span>
                    </div>
                    <div className={`text-center text-xs mt-1 whitespace-nowrap ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                      {node.name}
                    </div>
                  </div>
                );
              }

              // Rectangle task node
              const assigneeBadge = formatHandlersBadge(node.assigneeConfig, {
                users: allUsers,
                sysRoles: allRoles,
                departments: allDepartments,
              });
              return (
                <div
                  key={node.id}
                  className={`absolute rounded-lg shadow-md hover:shadow-lg transition-shadow cursor-move group
                    ${isSelected ? 'ring-2 ring-blue-500 ring-offset-2' : ''}
                    ${isDark ? 'bg-gray-800 border-gray-600' : 'bg-white border-gray-200'} border`}
                  style={{ left: node.positionX, top: node.positionY, width: NODE_WIDTH, height: NODE_HEIGHT }}
                  onMouseDown={e => handleNodeMouseDown(e, node.id)}
                  onMouseUp={e => handleNodeMouseUp(e, node.id)}
                >
                  {renderPorts(node.id, NODE_WIDTH, NODE_HEIGHT)}
                  <div className={`flex items-center gap-2 px-3 py-1.5 rounded-t-lg text-white text-xs font-medium ${typeInfo?.color || 'bg-gray-500'}`}>
                    {typeInfo && <typeInfo.icon size={12} />}
                    {node.nodeType === 'user_task' ? '人工任务' : node.nodeType === 'approval' ? '审批' : '服务任务'}
                  </div>
                  <div className={`px-3 py-1 text-sm font-medium truncate ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
                    {node.name}
                  </div>
                  {assigneeBadge && (node.nodeType === 'user_task' || node.nodeType === 'approval') && (
                    <div className={`px-3 pb-1.5 text-[10px] truncate ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                      {assigneeBadge}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Empty state */}
          {nodes.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center">
                <GitMerge size={48} className="mx-auto text-gray-400 mb-3" />
                <p className={`text-lg font-medium ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  从左侧面板拖拽节点开始设计
                </p>
                <p className={`text-sm mt-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                  或点击节点类型添加到画布
                </p>
              </div>
            </div>
          )}
        </div>

        {/* ─── Right: Properties panel ─── */}
        {showProperties && (
          <div className={`w-80 border-b border-r overflow-y-auto ${cardBg}`}>
            <div className="flex items-center justify-between px-3 py-2 border-b dark:border-gray-700">
              <span className={`text-xs font-semibold uppercase tracking-wider ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                属性
              </span>
              <button onClick={() => setShowProperties(false)} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700">
                <X size={14} />
              </button>
            </div>

            {selectedNode ? (
              <div className="p-3 space-y-3">
                <div>
                  <label className={`block text-xs font-medium mb-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                    节点名称
                  </label>
                  <input
                    value={selectedNode.name}
                    onChange={e => updateNode(selectedNode.id, { name: e.target.value })}
                    className={`w-full px-2 py-1.5 text-sm rounded border ${inputBg}`}
                  />
                </div>
                <div>
                  <label className={`block text-xs font-medium mb-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                    节点标识
                  </label>
                  <input
                    value={selectedNode.nodeKey}
                    onChange={e => updateNode(selectedNode.id, { nodeKey: e.target.value })}
                    className={`w-full px-2 py-1.5 text-sm rounded border ${inputBg}`}
                  />
                </div>
                <div>
                  <label className={`block text-xs font-medium mb-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                    描述
                  </label>
                  <textarea
                    rows={2}
                    value={selectedNode.description || ''}
                    onChange={e => updateNode(selectedNode.id, { description: e.target.value })}
                    className={`w-full px-2 py-1.5 text-sm rounded border resize-none ${inputBg}`}
                  />
                </div>
                <div>
                  <label className={`block text-xs font-medium mb-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                    类型
                  </label>
                  <div className={`text-sm px-2 py-1.5 rounded ${isDark ? 'bg-gray-700 text-gray-300' : 'bg-gray-100 text-gray-600'}`}>
                    {NODE_TYPES.find(t => t.type === selectedNode.nodeType)?.label || selectedNode.nodeType}
                  </div>
                </div>

                {/* Assignee config for user_task & approval */}
                {(selectedNode.nodeType === 'user_task' || selectedNode.nodeType === 'approval') && (
                  <>
                    <hr className="dark:border-gray-700" />
                    <div className={`text-xs font-semibold uppercase tracking-wider ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                      处理人
                    </div>
                    <AssigneeHandlersEditor
                      value={selectedNode.assigneeConfig}
                      onChange={cfg => updateNode(selectedNode.id, { assigneeConfig: cfg })}
                      users={allUsers}
                      roles={allRoles}
                      departments={allDepartments}
                      isDark={isDark}
                    />
                  </>
                )}

                {/* Approval specific */}
                {selectedNode.nodeType === 'approval' && (
                  <div>
                    <label className={`block text-xs font-medium mb-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                      默认拒绝操作（无自定义按钮时）
                    </label>
                    <select
                      value={selectedNode.approvalConfig?.rejectAction || 'back_to_start'}
                      onChange={e => updateNode(selectedNode.id, {
                        approvalConfig: {
                          ...(selectedNode.approvalConfig || { approvalType: 'single', approvers: [], rejectAction: 'back_to_start' }),
                          rejectAction: e.target.value as WorkflowApprovalConfig['rejectAction'],
                        },
                      })}
                      className={`w-full px-2 py-1.5 text-sm rounded border ${inputBg}`}
                    >
                      <option value="back_to_start">退回发起人</option>
                      <option value="back_to_previous">退回上一步</option>
                      <option value="terminate">终止流程</option>
                    </select>
                  </div>
                )}

                {/* Processing buttons → branch routing */}
                {(selectedNode.nodeType === 'user_task' || selectedNode.nodeType === 'approval') && (() => {
                  const buttons = selectedNode.formConfig?.buttons || [];
                  const outEdges = edges.filter(e => e.sourceNodeId === selectedNode.id);
                  const patchButtons = (next: WorkflowButton[]) => {
                    updateNode(selectedNode.id, {
                      formConfig: {
                        formFields: selectedNode.formConfig?.formFields || [],
                        buttons: next,
                        visibleSections: selectedNode.formConfig?.visibleSections,
                        formType: selectedNode.formConfig?.formType || 'approval',
                      },
                    });
                  };
                  return (
                    <>
                      <hr className="dark:border-gray-700" />
                      <div className={`text-xs font-semibold uppercase tracking-wider ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                        处理按钮
                      </div>
                      <p className={`text-[10px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                        每个按钮可绑定一条出边，或执行退回/作废。办理页将按配置展示。
                      </p>
                      <div className="flex flex-wrap gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            const existingKeys = new Set(buttons.map(b => b.key));
                            const toAdd = APPROVAL_BUTTON_PRESETS.filter(p => !existingKeys.has(p.key));
                            if (toAdd.length === 0) {
                              toast('预设按钮已存在');
                              return;
                            }
                            patchButtons([...buttons, ...toAdd.map(p => ({ ...p }))]);
                          }}
                          className={`text-[10px] px-2 py-1 rounded border ${isDark ? 'border-gray-600 text-gray-300 hover:bg-gray-700' : 'border-gray-300 text-gray-600 hover:bg-gray-100'}`}
                        >
                          插入预设（批准/退回/作废）
                        </button>
                      </div>
                      <div className={`space-y-2 p-2 rounded border ${isDark ? 'bg-gray-700/50 border-gray-600' : 'bg-gray-50 border-gray-200'}`}>
                        {buttons.map((btn, idx) => (
                          <div key={`${btn.key}_${idx}`} className={`space-y-1 p-2 rounded border ${isDark ? 'border-gray-600' : 'border-gray-200'}`}>
                            <div className="flex items-center gap-1">
                              <input
                                value={btn.label}
                                onChange={e => {
                                  const next = [...buttons];
                                  next[idx] = { ...next[idx], label: e.target.value };
                                  patchButtons(next);
                                }}
                                className={`flex-1 px-1.5 py-0.5 text-[11px] rounded border ${inputBg}`}
                                placeholder="按钮文案"
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  const next = [...buttons];
                                  next.splice(idx, 1);
                                  patchButtons(next);
                                }}
                                className="text-red-400 hover:text-red-600 p-0.5"
                                title="删除"
                              >
                                <X size={12} />
                              </button>
                            </div>
                            <div className="flex gap-1">
                              <select
                                value={btn.action}
                                onChange={e => {
                                  const action = e.target.value as WorkflowButton['action'];
                                  const next = [...buttons];
                                  next[idx] = {
                                    ...next[idx],
                                    action,
                                    ...(action !== 'route' && action !== 'complete' && action !== 'save'
                                      ? { targetNodeKey: undefined }
                                      : {}),
                                  };
                                  patchButtons(next);
                                }}
                                className={`flex-1 px-1 py-0.5 text-[10px] rounded border ${inputBg}`}
                              >
                                <option value="route">走支线</option>
                                <option value="back_to_start">退回发起</option>
                                <option value="terminate">作废/终止</option>
                                <option value="delegate">委派</option>
                                <option value="cancel">取消(关闭)</option>
                              </select>
                              <select
                                value={btn.color}
                                onChange={e => {
                                  const next = [...buttons];
                                  next[idx] = { ...next[idx], color: e.target.value as WorkflowButton['color'] };
                                  patchButtons(next);
                                }}
                                className={`w-14 px-0.5 py-0.5 text-[10px] rounded border ${inputBg}`}
                              >
                                <option value="primary">蓝</option>
                                <option value="danger">红</option>
                                <option value="warning">橙</option>
                                <option value="default">灰</option>
                              </select>
                            </div>
                            <div className="flex gap-1">
                              <input
                                value={btn.key}
                                onChange={e => {
                                  const next = [...buttons];
                                  next[idx] = { ...next[idx], key: e.target.value };
                                  patchButtons(next);
                                }}
                                className={`w-20 px-1 py-0.5 text-[10px] rounded border ${inputBg}`}
                                placeholder="key"
                                title="按钮标识"
                              />
                              <input
                                value={btn.result || ''}
                                onChange={e => {
                                  const next = [...buttons];
                                  next[idx] = { ...next[idx], result: e.target.value || undefined };
                                  patchButtons(next);
                                }}
                                className={`flex-1 px-1 py-0.5 text-[10px] rounded border ${inputBg}`}
                                placeholder="result 值"
                                title="写入 variables.result"
                              />
                            </div>
                            {(btn.action === 'route' || btn.action === 'complete' || btn.action === 'save') && (
                              <select
                                value={btn.targetNodeKey || ''}
                                onChange={e => {
                                  const next = [...buttons];
                                  next[idx] = { ...next[idx], targetNodeKey: e.target.value || undefined, action: 'route' };
                                  patchButtons(next);
                                }}
                                className={`w-full px-1 py-0.5 text-[10px] rounded border ${inputBg}`}
                              >
                                <option value="">-- 选择出边目标 --</option>
                                {outEdges.map(e => {
                                  const tgt = nodes.find(n => n.id === e.targetNodeId);
                                  if (!tgt) return null;
                                  return (
                                    <option key={e.id} value={tgt.nodeKey}>
                                      {edgeOptionLabel(e.label, tgt.name, tgt.nodeKey)}
                                    </option>
                                  );
                                })}
                              </select>
                            )}
                            <label className={`flex items-center gap-1 text-[10px] ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                              <input
                                type="checkbox"
                                checked={!!btn.requireComment}
                                onChange={e => {
                                  const next = [...buttons];
                                  next[idx] = { ...next[idx], requireComment: e.target.checked };
                                  patchButtons(next);
                                }}
                                className="w-3 h-3"
                              />
                              意见必填
                            </label>
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={() => {
                            patchButtons([
                              ...buttons,
                              {
                                key: `btn_${buttons.length + 1}`,
                                label: '新按钮',
                                color: 'primary',
                                action: 'route',
                                result: 'approved',
                              },
                            ]);
                          }}
                          className={`flex items-center gap-1 text-xs mt-1 px-2 py-1 rounded w-full justify-center
                            ${isDark ? 'text-green-400 hover:bg-gray-600' : 'text-green-600 hover:bg-gray-100'}`}
                        >
                          <Plus size={10} /> 添加按钮
                        </button>
                        {outEdges.length === 0 && (
                          <p className="text-[10px] text-amber-500">当前节点尚无出边，请先连线后再绑定「走支线」目标。</p>
                        )}
                      </div>
                    </>
                  );
                })()}

                {/* Timeout config */}
                {(selectedNode.nodeType === 'user_task' || selectedNode.nodeType === 'approval') && (
                  <>
                    <hr className="dark:border-gray-700" />
                    <div className={`text-xs font-semibold uppercase tracking-wider mt-2 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                      超时与SLA
                    </div>
                    <div>
                      <label className={`block text-xs font-medium mb-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                        超时（小时），0=不限
                      </label>
                      <input
                        type="number"
                        min={0}
                        value={selectedNode.timeoutConfig?.timeoutHours || 0}
                        onChange={e => updateNode(selectedNode.id, {
                          timeoutConfig: {
                            timeoutHours: parseInt(e.target.value) || 0,
                            timeoutAction: selectedNode.timeoutConfig?.timeoutAction || 'remind',
                          },
                        })}
                        className={`w-full px-2 py-1.5 text-sm rounded border ${inputBg}`}
                      />
                    </div>
                    <div>
                      <label className={`block text-xs font-medium mb-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                        超时操作
                      </label>
                      <select
                        value={selectedNode.timeoutConfig?.timeoutAction || 'remind'}
                        onChange={e => updateNode(selectedNode.id, {
                          timeoutConfig: {
                            timeoutHours: selectedNode.timeoutConfig?.timeoutHours || 0,
                            timeoutAction: e.target.value as WorkflowTimeoutConfig['timeoutAction'],
                          },
                        })}
                        className={`w-full px-2 py-1.5 text-sm rounded border ${inputBg}`}
                      >
                        <option value="remind">发送提醒</option>
                        <option value="escalate">自动上报</option>
                        <option value="auto_complete">自动完成</option>
                        <option value="terminate">终止流程</option>
                      </select>
                    </div>
                  </>
                )}

                {/* Notification config */}
                {(selectedNode.nodeType === 'user_task' || selectedNode.nodeType === 'approval') && (
                  <>
                    <hr className="dark:border-gray-700" />
                    <div className={`text-xs font-semibold uppercase tracking-wider mt-2 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                      通知配置
                    </div>
                    <div className="space-y-1.5">
                      {[
                        { key: 'notifyOnAssign', label: '任务分配时通知' },
                        { key: 'notifyOnComplete', label: '任务完成时通知发起人' },
                        { key: 'notifyOnOverdue', label: '超时时发送提醒' },
                      ].map(opt => (
                        <label key={opt.key} className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            className="w-3.5 h-3.5 rounded"
                            checked={Boolean(selectedNode.actionConfig?.[opt.key] ?? true)}
                            onChange={e => updateNode(selectedNode.id, {
                              actionConfig: {
                                ...(selectedNode.actionConfig || {}),
                                [opt.key]: e.target.checked,
                              }
                            })}
                          />
                          <span className={`text-xs ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>{opt.label}</span>
                        </label>
                      ))}
                    </div>
                  </>
                )}

                {/* Service Task config */}
                {selectedNode.nodeType === 'service_task' && (
                  <>
                    <hr className="dark:border-gray-700" />
                    <div className={`text-xs font-semibold uppercase tracking-wider mt-2 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                      服务配置
                    </div>
                    <div>
                      <label className={`block text-xs font-medium mb-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                        服务类型
                      </label>
                      <select
                        value={selectedNode.actionConfig?.serviceType || 'http'}
                        onChange={e => updateNode(selectedNode.id, {
                          actionConfig: {
                            ...(selectedNode.actionConfig || {}),
                            serviceType: e.target.value,
                          }
                        })}
                        className={`w-full px-2 py-1.5 text-sm rounded border ${inputBg}`}
                      >
                        <option value="http">HTTP 调用</option>
                        <option value="email">发送邮件</option>
                        <option value="status_update">状态更新</option>
                        <option value="custom_script">自定义脚本</option>
                      </select>
                    </div>
                    <div>
                      <label className={`block text-xs font-medium mb-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                        服务URL / 参数
                      </label>
                      <input
                        value={selectedNode.actionConfig?.serviceUrl || ''}
                        onChange={e => updateNode(selectedNode.id, {
                          actionConfig: {
                            ...(selectedNode.actionConfig || {}),
                            serviceUrl: e.target.value,
                          }
                        })}
                        className={`w-full px-2 py-1.5 text-sm rounded border ${inputBg}`}
                        placeholder="https://..."
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        className="w-3.5 h-3.5 rounded"
                        checked={selectedNode.actionConfig?.retryOnFailure ?? false}
                        onChange={e => updateNode(selectedNode.id, {
                          actionConfig: {
                            ...(selectedNode.actionConfig || {}),
                            retryOnFailure: e.target.checked,
                          }
                        })}
                      />
                      <label className={`text-xs ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>失败时自动重试</label>
                    </div>
                  </>
                )}

                {/* Gateway condition config */}
                {selectedNode.nodeType.includes('gateway') && (
                  <>
                    <hr className="dark:border-gray-700" />
                    <div className={`text-xs font-semibold uppercase tracking-wider mt-2 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                      网关配置
                    </div>
                    <div>
                      <label className={`block text-xs font-medium mb-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                        默认出口连线
                      </label>
                      <select
                        value={selectedNode.gatewayConfig?.defaultEdgeId || ''}
                        onChange={e => updateNode(selectedNode.id, {
                          gatewayConfig: { defaultEdgeId: e.target.value || undefined }
                        })}
                        className={`w-full px-2 py-1.5 text-sm rounded border ${inputBg}`}
                      >
                        <option value="">无默认</option>
                        {edges.filter(e => e.sourceNodeId === selectedNode.id).map(e => {
                          const tgt = nodes.find(n => n.id === e.targetNodeId);
                          return <option key={e.id} value={e.id}>{e.label || `→ ${tgt?.name || '未知'}`}</option>;
                        })}
                      </select>
                    </div>
                    <div className={`p-2 rounded text-xs ${isDark ? 'bg-gray-700 text-gray-400' : 'bg-blue-50 text-blue-600'}`}>
                      {selectedNode.nodeType === 'exclusive_gateway'
                        ? '排他网关：根据条件选择唯一出口'
                        : '并行网关：所有出口同时执行'}
                    </div>
                  </>
                )}

                {/* Form view config */}
                {(selectedNode.nodeType === 'user_task' || selectedNode.nodeType === 'approval') && (
                  <>
                    <hr className="dark:border-gray-700" />
                    <div>
                      <label className={`block text-xs font-medium mb-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                        表单模板
                      </label>
                      <select
                        value={selectedNode.formConfig?.formType || 'default'}
                        onChange={e => {
                          const formType = e.target.value;
                          const templates: Record<string, FormConfigLocal> = {
                            default: { formType: 'default', formFields: [], buttons: [] },
                            approval: {
                              formType: 'approval',
                              formFields: [
                                { field: 'result', label: '审批结果', type: 'select', options: [{ label: '同意', value: 'approved' }, { label: '拒绝', value: 'rejected' }], required: true },
                                { field: 'comment', label: '审批意见', type: 'textarea', required: false },
                              ],
                              buttons: [
                                { key: 'approve', label: '同意', color: 'primary', action: 'complete' },
                                { key: 'reject', label: '拒绝', color: 'danger', action: 'reject' },
                              ],
                            },
                            feedback: {
                              formType: 'feedback',
                              formFields: [
                                { field: 'rating', label: '评分', type: 'number', required: true },
                                { field: 'feedback', label: '反馈意见', type: 'textarea', required: false },
                              ],
                              buttons: [
                                { key: 'submit', label: '提交', color: 'primary', action: 'complete' },
                              ],
                            },
                            checklist: {
                              formType: 'checklist',
                              formFields: [
                                { field: 'items', label: '检查项', type: 'checkbox', required: true },
                                { field: 'notes', label: '备注', type: 'textarea', required: false },
                              ],
                              buttons: [
                                { key: 'complete', label: '完成', color: 'primary', action: 'complete' },
                              ],
                            },
                            custom: {
                              formType: 'custom',
                              formFields: selectedNode.formConfig?.formFields || [],
                              buttons: selectedNode.formConfig?.buttons || [],
                            },
                          };
                          updateNode(selectedNode.id, { formConfig: templates[formType] || templates.default });
                        }}
                        className={`w-full px-2 py-1.5 text-sm rounded border ${inputBg}`}
                      >
                        <option value="default">默认表单</option>
                        <option value="approval">审批表单</option>
                        <option value="feedback">反馈表单</option>
                        <option value="checklist">检查清单</option>
                        <option value="custom">自定义表单</option>
                      </select>
                    </div>
                    {selectedNode.formConfig?.formType && selectedNode.formConfig?.formType !== 'default' && (
                      <div>
                        <label className={`block text-xs font-medium mb-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                          表单字段 ({(selectedNode.formConfig?.formFields || []).length})
                        </label>
                        <div className={`space-y-1.5 p-2 rounded border ${isDark ? 'bg-gray-700 border-gray-600' : 'bg-gray-50 border-gray-200'}`}>
                          {(selectedNode.formConfig?.formFields || []).map((field, idx) => (
                            <div key={idx} className={`p-1.5 rounded border ${isDark ? 'bg-gray-800 border-gray-600' : 'bg-white border-gray-200'}`}>
                              <div className="flex items-center gap-1 mb-1">
                                <span className={`flex-1 truncate text-xs font-medium ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                                  {field.label || field.field}
                                </span>
                                <span className={`px-1 py-0.5 rounded text-[10px] ${isDark ? 'bg-gray-600 text-gray-400' : 'bg-gray-200 text-gray-500'}`}>
                                  {field.type}
                                </span>
                                {field.required && <span className="text-red-500 text-[10px]">*</span>}
                              </div>
                              {selectedNode.formConfig?.formType === 'custom' && (
                                <div className="flex gap-1 mt-1">
                                  <input
                                    value={field.label}
                                    onChange={e => {
                                      const fields = [...(selectedNode.formConfig?.formFields || [])];
                                      fields[idx] = { ...fields[idx], label: e.target.value };
                                      updateNode(selectedNode.id, { formConfig: { ...selectedNode.formConfig!, formFields: fields } });
                                    }}
                                    className={`flex-1 px-1.5 py-0.5 text-[11px] rounded border ${inputBg}`}
                                    placeholder="标签"
                                  />
                                  <select
                                    value={field.type}
                                    onChange={e => {
                                      const fields = [...(selectedNode.formConfig?.formFields || [])];
                                      fields[idx] = { ...fields[idx], type: e.target.value as WorkflowFormField['type'] };
                                      updateNode(selectedNode.id, { formConfig: { ...selectedNode.formConfig!, formFields: fields } });
                                    }}
                                    className={`w-16 px-1 py-0.5 text-[11px] rounded border ${inputBg}`}
                                  >
                                    <option value="text">文本</option>
                                    <option value="textarea">多行</option>
                                    <option value="number">数字</option>
                                    <option value="select">选择</option>
                                    <option value="date">日期</option>
                                    <option value="checkbox">勾选</option>
                                    <option value="radio">单选</option>
                                    <option value="file">文件</option>
                                    <option value="user_picker">选人</option>
                                  </select>
                                  <label className="flex items-center gap-0.5 text-[10px]">
                                    <input
                                      type="checkbox"
                                      checked={field.required || false}
                                      onChange={e => {
                                        const fields = [...(selectedNode.formConfig?.formFields || [])];
                                        fields[idx] = { ...fields[idx], required: e.target.checked };
                                        updateNode(selectedNode.id, { formConfig: { ...selectedNode.formConfig!, formFields: fields } });
                                      }}
                                      className="w-3 h-3"
                                    />
                                    <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>必填</span>
                                  </label>
                                  <button
                                    onClick={() => {
                                      const fields = [...(selectedNode.formConfig?.formFields || [])];
                                      fields.splice(idx, 1);
                                      updateNode(selectedNode.id, { formConfig: { ...selectedNode.formConfig!, formFields: fields } });
                                    }}
                                    className="text-red-400 hover:text-red-600"
                                  >
                                    <X size={10} />
                                  </button>
                                </div>
                              )}
                            </div>
                          ))}
                          {selectedNode.formConfig?.formType === 'custom' && (
                            <button
                              onClick={() => {
                                const fields = [...(selectedNode.formConfig?.formFields || [])];
                                fields.push({ field: `field_${fields.length + 1}`, label: '新字段', type: 'text' as const, required: false });
                                updateNode(selectedNode.id, { formConfig: { ...selectedNode.formConfig!, formFields: fields } });
                              }}
                              className={`flex items-center gap-1 text-xs mt-1 px-2 py-1 rounded w-full justify-center
                                ${isDark ? 'text-blue-400 hover:bg-gray-600' : 'text-blue-600 hover:bg-gray-100'}`}
                            >
                              <Plus size={10} /> 添加字段
                            </button>
                          )}
                        </div>
                      </div>
                    )}

                    {selectedNode.formConfig?.formType === 'custom' && (
                      <p className={`text-[10px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                        操作按钮请在上方「处理按钮」面板配置（可绑定出边 / 退回 / 作废）。
                      </p>
                    )}
                  </>
                )}

                <div className="pt-2">
                  <span className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                    位置: ({Math.round(selectedNode.positionX)}, {Math.round(selectedNode.positionY)})
                  </span>
                </div>
              </div>
            ) : selectedEdge ? (
              <div className="p-3 space-y-3">
                <div>
                  <label className={`block text-xs font-medium mb-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                    标签
                  </label>
                  <input
                    value={selectedEdge.label || ''}
                    onChange={e => {
                      const label = e.target.value;
                      const inferred = inferEdgeColorFromLabel(label);
                      updateEdge(selectedEdge.id, {
                        label,
                        ...(inferred ? { color: inferred, lineStyle: 'solid' as EdgeLineStyle } : {}),
                      });
                    }}
                    className={`w-full px-2 py-1.5 text-sm rounded border ${inputBg}`}
                    placeholder="连线标签"
                  />
                </div>
                <div>
                  <label className={`block text-xs font-medium mb-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                    连线样式
                  </label>
                  <select
                    value={selectedEdge.routingMode || defaultRoutingMode}
                    onChange={e => updateEdge(selectedEdge.id, { routingMode: e.target.value as EdgeRoutingMode })}
                    className={`w-full px-2 py-1.5 text-sm rounded border ${inputBg}`}
                  >
                    <option value="straight">直线</option>
                    <option value="orthogonal">折线（圆角）</option>
                    <option value="smooth">曲线</option>
                  </select>
                </div>
                <div>
                  <label className={`block text-xs font-medium mb-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                    线型
                  </label>
                  <select
                    value={selectedEdge.lineStyle || 'solid'}
                    onChange={e => updateEdge(selectedEdge.id, { lineStyle: e.target.value as EdgeLineStyle })}
                    className={`w-full px-2 py-1.5 text-sm rounded border ${inputBg}`}
                  >
                    <option value="solid">实线</option>
                    <option value="dashed">虚线</option>
                    <option value="dotted">点线</option>
                  </select>
                </div>
                <div>
                  <label className={`block text-xs font-medium mb-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                    连线颜色
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {EDGE_COLORS.map(c => (
                      <button
                        key={c.label}
                        onClick={() => updateEdge(selectedEdge.id, {
                          color: c.value || undefined,
                          lineStyle: c.lineStyle,
                        })}
                        className={`w-6 h-6 rounded-full border-2 transition-transform hover:scale-110
                          ${(selectedEdge.color || '') === c.value ? 'border-blue-500 scale-110' : isDark ? 'border-gray-600' : 'border-gray-300'}`}
                        style={{ background: c.value || (isDark ? '#6b7280' : '#9ca3af') }}
                        title={c.label}
                      />
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={selectedEdge.isDefault}
                    onChange={e => updateEdge(selectedEdge.id, {
                      isDefault: e.target.checked,
                      lineStyle: e.target.checked ? 'dashed' : selectedEdge.lineStyle,
                    })}
                    className="w-4 h-4"
                  />
                  <label className={`text-sm ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                    默认路径
                  </label>
                </div>
                <div>
                  <label className={`block text-xs font-medium mb-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                    来源节点
                  </label>
                  <div className={`text-sm px-2 py-1.5 rounded ${isDark ? 'bg-gray-700 text-gray-300' : 'bg-gray-100 text-gray-600'}`}>
                    {nodes.find(n => n.id === selectedEdge.sourceNodeId)?.name || '-'}
                  </div>
                </div>
                <div>
                  <label className={`block text-xs font-medium mb-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                    目标节点
                  </label>
                  <div className={`text-sm px-2 py-1.5 rounded ${isDark ? 'bg-gray-700 text-gray-300' : 'bg-gray-100 text-gray-600'}`}>
                    {nodes.find(n => n.id === selectedEdge.targetNodeId)?.name || '-'}
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-3 space-y-3">
                <div>
                  <label className={`block text-xs font-medium mb-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                    流程名称
                  </label>
                  <input
                    value={defName}
                    onChange={e => { setDefName(e.target.value); setDirty(true); }}
                    className={`w-full px-2 py-1.5 text-sm rounded border ${inputBg}`}
                  />
                </div>
                <div>
                  <label className={`block text-xs font-medium mb-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                    描述
                  </label>
                  <textarea
                    rows={3}
                    value={defDescription}
                    onChange={e => { setDefDescription(e.target.value); setDirty(true); }}
                    className={`w-full px-2 py-1.5 text-sm rounded border resize-none ${inputBg}`}
                    placeholder="流程描述..."
                  />
                </div>
                <div>
                  <label className={`block text-xs font-medium mb-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                    关联业务模块
                  </label>
                  <select
                    value={defEntityType}
                    onChange={e => { setDefEntityType(e.target.value); setDirty(true); setDefEntityViewConfig(null); setAvailableEntityFields([]); }}
                    className={`w-full px-2 py-1.5 text-sm rounded border ${inputBg}`}
                  >
                    <option value="">不关联（通用流程）</option>
                    {(() => {
                      const grouped: Record<string, { key: string; displayName: string }[]> = {};
                      entityTypeOptions.forEach(et => {
                        if (!grouped[et.module]) grouped[et.module] = [];
                        grouped[et.module].push(et);
                      });
                      return Object.entries(grouped).map(([mod, items]) => (
                        <optgroup key={mod} label={mod}>
                          {items.map(item => (
                            <option key={item.key} value={item.key}>
                              {item.displayName}（{item.key}）
                            </option>
                          ))}
                        </optgroup>
                      ));
                    })()}
                  </select>
                  <p className={`mt-1 text-[10px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                    选择后，该模块提交审批时将自动匹配此工作流
                  </p>
                </div>
                {/* Entity View Config — configurable fields for approval display */}
                {defEntityType && availableEntityFields.length > 0 && (
                  <div>
                    <label className={`block text-xs font-medium mb-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                      审批视图字段配置
                    </label>
                    <p className={`mb-2 text-[10px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                      配置审批人在处理任务时看到的实体字段（拖拽排序）
                    </p>
                    {/* Selected fields */}
                    <div className="space-y-1 mb-2">
                      {(defEntityViewConfig?.fields || []).map((f, idx) => (
                        <div key={f.key} className={`flex items-center gap-1 rounded px-2 py-1 text-xs ${isDark ? 'bg-gray-700' : 'bg-blue-50'}`}>
                          <span className={`flex-1 font-medium ${isDark ? 'text-gray-200' : 'text-gray-700'}`}>{f.key}</span>
                          <input
                            type="text"
                            value={f.label}
                            onChange={e => {
                              const updated = [...(defEntityViewConfig?.fields || [])];
                              updated[idx] = { ...updated[idx], label: e.target.value };
                              setDefEntityViewConfig({ fields: updated });
                              setDirty(true);
                            }}
                            className={`w-20 px-1 py-0.5 text-xs rounded border ${inputBg}`}
                            placeholder="标签"
                          />
                          <button
                            onClick={() => {
                              const updated = (defEntityViewConfig?.fields || []).filter((_, i) => i !== idx);
                              setDefEntityViewConfig({ fields: updated });
                              setDirty(true);
                            }}
                            className="text-red-400 hover:text-red-600"
                            title="移除"
                          >×</button>
                        </div>
                      ))}
                    </div>
                    {/* Add field dropdown */}
                    <select
                      value=""
                      onChange={e => {
                        const key = e.target.value;
                        if (!key) return;
                        const existing = (defEntityViewConfig?.fields || []).map(f => f.key);
                        if (existing.includes(key)) return;
                        setDefEntityViewConfig({
                          fields: [...(defEntityViewConfig?.fields || []), { key, label: key }],
                        });
                        setDirty(true);
                      }}
                      className={`w-full px-2 py-1 text-xs rounded border ${inputBg}`}
                    >
                      <option value="">+ 添加字段...</option>
                      {availableEntityFields
                        .filter(f => !(defEntityViewConfig?.fields || []).some(vf => vf.key === f.key))
                        .map(f => (
                          <option key={f.key} value={f.key}>{f.key} ({f.type})</option>
                        ))
                      }
                    </select>
                    {(!defEntityViewConfig || defEntityViewConfig.fields.length === 0) && (
                      <p className={`mt-1 text-[10px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                        未配置时将显示所有字段
                      </p>
                    )}
                  </div>
                )}
                <div className={`p-3 rounded-lg ${isDark ? 'bg-gray-700' : 'bg-gray-50'}`}>
                  <div className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                    <div>节点数: {nodes.length}</div>
                    <div>连线数: {edges.length}</div>
                  </div>
                </div>
                <div className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                  选择一个节点或连线查看属性
                </div>
              </div>
            )}
          </div>
        )}
        {!showProperties && (
          <button
            onClick={() => setShowProperties(true)}
            className={`w-8 border-b border-r flex items-center justify-center hover:bg-gray-100 dark:hover:bg-gray-700 ${cardBg}`}
            title="显示属性面板"
          >
            <Settings size={14} />
          </button>
        )}
      </div>
    </div>
  );
};

export default WorkflowDesignerPage;