/**
 * workflowAIActions — 按页面上下文生成 AI 快捷操作（对齐 AIDriveNote 的 noteAIActions 模式）
 */
import type { QuickAction } from '../services/ai/ai';

export type WorkflowAIPageKind = 'dashboard' | 'definitions' | 'instances' | 'my-tasks' | 'designer' | 'instance-detail' | 'task-handle';

interface WorkflowAIContext {
  pageKind?: WorkflowAIPageKind;
  entityLabel?: string;
  entityHint?: string;
}

export function workflowQuickActions(ctx?: WorkflowAIContext): QuickAction[] {
  const kind = ctx?.pageKind;
  const label = ctx?.entityLabel;

  if (kind === 'task-handle') {
    return [
      { label: '审批要点分析', prompt: `请分析这个审批任务的关键要点和风险，帮我判断如何处理。${ctx?.entityHint ? `\n\n任务上下文：${ctx.entityHint}` : ''}` },
      { label: '生成审批意见', prompt: '请根据当前任务的上下文，生成一段简洁专业的审批意见（50字以内）。' },
      { label: '查看我的待办', prompt: '查看我的待办任务列表。' },
    ];
  }
  if (kind === 'instance-detail') {
    return [
      { label: '流程进度解读', prompt: `请解读这个流程实例的当前进度、已完成的节点和下一步。${label ? `\n\n流程：${label}` : ''}` },
      { label: '预测审批走向', prompt: '根据流程定义和当前状态，预测这个流程后续会经过哪些节点、由谁审批。' },
      { label: '查询我的流程', prompt: '查询我发起的流程实例列表。' },
    ];
  }
  if (kind === 'definitions' || kind === 'designer') {
    return [
      { label: '列出可用流程', prompt: '列出当前所有已发布的流程定义，并简要说明各自用途。' },
      { label: '流程设计建议', prompt: '我想设计一个通用的多级审批流程（含驳回与条件分支），请给出节点与网关的设计建议。' },
    ];
  }
  if (kind === 'my-tasks') {
    return [
      { label: '查看我的待办', prompt: '查看我的待办审批任务列表。' },
      { label: '待办统计', prompt: '我有多少待办？紧急的有哪几条？' },
    ];
  }
  // dashboard / instances / 默认
  return [
    { label: '查询流程状态', prompt: '查询我最近发起的流程实例及其当前状态。' },
    { label: '查看我的待办', prompt: '查看我的待办审批任务列表。' },
    { label: '有哪些流程', prompt: '列出当前所有已发布的流程定义模板。' },
    { label: '发起流程', prompt: '帮我发起一个审批流程，先列出可选的流程模板。' },
  ];
}
