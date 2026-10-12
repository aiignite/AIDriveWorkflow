/** 通用文件上传/下载 — 工作流表单 file 字段与电子签名图 */
import { API_BASE, fetchWithAuth } from './client';

export interface UploadedFile {
  id: string;
  fileName: string;
  storedName: string;
  purpose: string;
  url: string;
}

export const filesApi = {
  async upload(file: File, purpose: 'files' | 'signatures' = 'files'): Promise<UploadedFile> {
    const form = new FormData();
    form.append('file', file);
    const res = await fetchWithAuth(`/files/upload?purpose=${purpose}`, {
      method: 'POST',
      body: form,
    });
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}));
      throw new Error((detail as { detail?: string }).detail || '上传失败');
    }
    return res.json() as Promise<UploadedFile>;
  },

  /** 带鉴权下载（blob 触发浏览器保存） */
  async download(fileId: string, filename?: string): Promise<void> {
    const res = await fetchWithAuth(`/files/${fileId}`);
    if (!res.ok) throw new Error('下载失败');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || fileId;
    a.click();
    URL.revokeObjectURL(url);
  },

  url(fileId: string): string {
    return `${API_BASE}/files/${fileId}`;
  },
};
