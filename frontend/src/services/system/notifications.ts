/** 通知服务 — 工作流任务通知（铃铛 + 移动端），接口形状与 PLM 保持一致 */
import { api } from '../client';

export interface NotificationItem {
  id: string;
  title: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error' | string;
  read: boolean;
  relatedItemId?: string | null;
  relatedItemType?: string | null;
  relatedItemUrl?: string | null;
  createdAt: string;
}

export interface NotificationSummary {
  total: number;
  unread: number;
}

export const notificationsApi = {
  list: (params?: { read?: boolean; type?: string; limit?: number; offset?: number }) => {
    const query = new URLSearchParams();
    if (params?.read !== undefined) query.set('read', String(params.read));
    if (params?.type) query.set('type', params.type);
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.offset) query.set('offset', String(params.offset));
    const qs = query.toString();
    return api.get<NotificationItem[]>(`/notifications${qs ? `?${qs}` : ''}`);
  },
  unreadCount: async (): Promise<number> => {
    const data = await api.get<{ items: NotificationItem[]; unreadCount: number }>('/notifications?limit=1');
    return data.unreadCount ?? 0;
  },
  summary: async (): Promise<NotificationSummary> => {
    const unread = await notificationsApi.unreadCount();
    return { total: -1, unread };
  },
  markAsRead: (id: string) => api.post<{ ok: boolean }>(`/notifications/${id}/read`),
  markAllAsRead: () => api.post<{ ok: boolean }>('/notifications/read-all'),
  delete: (id: string) => api.delete(`/notifications/${id}`),
};
