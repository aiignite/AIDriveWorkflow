/**
 * useAIChat — AI 侧栏聊天逻辑（流式、工具结果、工作流写操作确认、附件）
 */
import { useCallback, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import {
  aiApi,
  buildChatPageContext,
  type PageAIContext,
} from '../services/ai/ai';
import { workflowInstancesApi, workflowTasksApi } from '../services/workflow';
import type { MessageAttachmentItem } from '../components/ai/MessageAttachmentGallery';
import { mapApiMessageAttachments, stripAttachmentMarkers } from '../utils/aiAttachmentDisplay';

/** AI 写操作确认载荷（后端 workflow_tools confirm_action） */
export interface WorkflowConfirmAction {
  type: 'start_instance' | 'complete_task';
  // start_instance
  definition_id?: string;
  title?: string;
  variables?: Record<string, unknown>;
  priority?: string;
  // complete_task
  task_id?: string;
  result?: string;
  comment?: string | null;
  form_data?: Record<string, unknown>;
}

export interface WorkflowPendingChange {
  confirmAction: WorkflowConfirmAction;
  summary: Record<string, unknown>;
  applied?: boolean;
  dismissed?: boolean;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  attachments?: MessageAttachmentItem[];
  workflowPendingChange?: WorkflowPendingChange;
  applied?: boolean;
  dismissed?: boolean;
}

export interface SendMessageOptions {
  selectionText?: string;
  attachmentIds?: string[];
  attachments?: MessageAttachmentItem[];
}

export function parseWorkflowPendingChange(result: Record<string, unknown>): WorkflowPendingChange | null {
  const requiresConfirmation = result?.requires_confirmation ?? result?.requiresConfirmation;
  const confirmAction = result?.confirm_action ?? result?.confirmAction;
  if (!requiresConfirmation || !confirmAction || typeof confirmAction !== 'object') return null;
  const action = confirmAction as WorkflowConfirmAction;
  if (action.type !== 'start_instance' && action.type !== 'complete_task') return null;
  return {
    confirmAction: action,
    summary: (result.summary as Record<string, unknown>) ?? {},
  };
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

interface UseAIChatOptions {
  pageAIContext: PageAIContext | null;
  bumpNotesRefresh: () => void;
  selectedAssistant: string;
  conversationId?: string;
  modelId?: string;
  onConversationId?: (id: string) => void;
}

export function useAIChat({
  pageAIContext,
  bumpNotesRefresh,
  selectedAssistant,
  conversationId,
  modelId,
  onConversationId,
}: UseAIChatOptions) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [activeSkill, setActiveSkill] = useState<{ name: string; reason?: string } | null>(null);
  const [applyingIndex, setApplyingIndex] = useState<number | null>(null);
  const [streamingPending, setStreamingPending] = useState<WorkflowPendingChange | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const stopGeneration = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const sendMessage = useCallback(async (
    textOverride?: string,
    options?: SendMessageOptions,
  ) => {
    const text = (textOverride ?? '').trim();
    const attachmentIds = (options?.attachmentIds ?? []).filter(Boolean);
    if ((!text && attachmentIds.length === 0) || loading) return;

    setMessages(prev => [...prev, {
      role: 'user',
      content: text,
      attachments: options?.attachments,
    }]);
    setLoading(true);
    setStreamingContent('');
    setStreamingPending(null);
    setActiveSkill(null);

    const controller = new AbortController();
    abortRef.current = controller;

    let assistantContent = '';
    let pending: WorkflowPendingChange | null = null;
    let aborted = false;

    const ctx = pageAIContext
      ? {
          ...pageAIContext,
          ...(options?.selectionText ? { selectionText: options.selectionText } : {}),
        }
      : null;

    try {
      const stream = aiApi.chatStream({
        message: text || '请查看我上传的附件并回答。',
        assistantName: selectedAssistant,
        conversationId,
        modelId,
        pageContext: buildChatPageContext(ctx),
        attachmentIds: attachmentIds.length > 0 ? attachmentIds : undefined,
        signal: controller.signal,
      });

      for await (const event of stream) {
        if (event.type === 'skill_match' && event.skillName) {
          setActiveSkill({ name: event.skillName, reason: event.reason });
        } else if (event.type === 'content' && event.content) {
          assistantContent += event.content;
          setStreamingContent(assistantContent);
        } else if (event.type === 'tool_result' && event.result) {
          const result = event.result;
          if (result.success === false && result.error) {
            assistantContent += `\n\n⚠️ ${result.error}`;
            setStreamingContent(assistantContent);
          }
          const preview = parseWorkflowPendingChange(result);
          if (preview) {
            pending = preview;
            setStreamingPending(preview);
          }
          if (result.message && typeof result.message === 'string') {
            assistantContent += `\n\n${result.message}`;
            setStreamingContent(assistantContent);
          }
        } else if (event.type === 'done' && event.conversationId) {
          onConversationId?.(event.conversationId);
        } else if (event.type === 'error' && event.content) {
          assistantContent += event.content;
          setStreamingContent(assistantContent);
        }
      }

      const finalContent = assistantContent.trim();
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: finalContent || (
          (options?.attachmentIds?.length ?? 0) > 0
            ? '未能获取模型回复。请确认已选择支持图片的模型（如 Minimax），并重试。'
            : '已完成操作。'
        ),
        workflowPendingChange: pending ?? undefined,
      }]);
      setStreamingContent('');
    } catch (err) {
      if (isAbortError(err)) {
        aborted = true;
        const partial = assistantContent.trim();
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: partial || '（已停止生成）',
          workflowPendingChange: pending ?? undefined,
        }]);
        setStreamingContent('');
        setStreamingPending(null);
      } else {
        toast.error(err instanceof Error ? err.message : 'AI 请求失败');
        setMessages(prev => prev.slice(0, -1));
        setStreamingPending(null);
      }
    } finally {
      abortRef.current = null;
      setLoading(false);
      if (!aborted) {
        setStreamingContent('');
      }
      setActiveSkill(null);
    }
  }, [loading, selectedAssistant, conversationId, modelId, pageAIContext, onConversationId]);

  const applyPendingChange = useCallback(async (pending: WorkflowPendingChange, messageIndex?: number) => {
    if (!pending || pending.applied || pending.dismissed) return;
    if (messageIndex != null) setApplyingIndex(messageIndex);
    try {
      const action = pending.confirmAction;
      if (action.type === 'start_instance') {
        await workflowInstancesApi.start({
          definitionId: String(action.definition_id),
          title: String(action.title ?? '未命名流程'),
          variables: action.variables,
        });
      } else if (action.type === 'complete_task') {
        await workflowTasksApi.complete(String(action.task_id), {
          result: String(action.result ?? 'approved'),
          comment: action.comment ?? undefined,
          formData: action.form_data,
        });
      }
      if (messageIndex != null) {
        setMessages(prev => prev.map((m, i) =>
          i === messageIndex && m.workflowPendingChange
            ? { ...m, workflowPendingChange: { ...m.workflowPendingChange, applied: true } }
            : m,
        ));
      }
      bumpNotesRefresh();
      toast.success(action.type === 'start_instance' ? '流程已发起' : '审批结果已提交');
    } catch {
      toast.error('提交失败');
    } finally {
      if (messageIndex != null) setApplyingIndex(null);
    }
  }, [bumpNotesRefresh]);

  const handleApply = useCallback(async (index: number) => {
    const msg = messages[index];
    const pending = msg?.workflowPendingChange;
    if (!pending || pending.applied || pending.dismissed) return;
    await applyPendingChange(pending, index);
  }, [messages, applyPendingChange]);

  const handleApplyStreaming = useCallback(async () => {
    if (!streamingPending || streamingPending.applied || streamingPending.dismissed) return;
    await applyPendingChange(streamingPending);
    setStreamingPending(prev => prev ? { ...prev, applied: true } : null);
  }, [streamingPending, applyPendingChange]);

  const handleDismiss = useCallback((index: number) => {
    setMessages(prev => prev.map((m, i) =>
      i === index && m.workflowPendingChange
        ? { ...m, workflowPendingChange: { ...m.workflowPendingChange, dismissed: true } }
        : m,
    ));
  }, []);

  const loadMessagesFromHistory = useCallback((raw: Array<{
    role: string;
    content: string;
    toolResults?: Array<{ result: Record<string, unknown> }>;
    attachments?: unknown;
    attachmentIds?: string[];
  }>) => {
    setMessages(raw.map(m => {
      let workflowPendingChange: WorkflowPendingChange | undefined;
      if (m.role === 'assistant' && m.toolResults) {
        for (const tr of m.toolResults) {
          const rawResult = (tr as { result?: Record<string, unknown> }).result ?? tr as Record<string, unknown>;
          const parsed = parseWorkflowPendingChange(rawResult);
          if (parsed && !parsed.applied) {
            workflowPendingChange = parsed;
            break;
          }
        }
      }
      const attachments = mapApiMessageAttachments(m.attachments);
      const displayContent = m.role === 'user' ? stripAttachmentMarkers(m.content) : m.content;
      return {
        role: m.role as 'user' | 'assistant',
        content: displayContent,
        attachments: attachments.length > 0 ? attachments : undefined,
        workflowPendingChange,
      };
    }));
  }, []);

  return {
    messages,
    setMessages,
    loading,
    streamingContent,
    activeSkill,
    applyingIndex,
    sendMessage,
    handleApply,
    handleApplyStreaming,
    handleDismiss,
    loadMessagesFromHistory,
    streamingPending,
    setStreamingPending,
    stopGeneration,
  };
}
