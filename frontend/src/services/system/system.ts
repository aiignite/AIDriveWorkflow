/** 系统数据服务 — 用户/角色/部门（供设计器处理人选择、用户管理） */
import { api } from '../client';

export interface SystemUser {
  id: string;
  name: string;
  email: string;
  position?: string | null;
  departmentId?: string | null;
  roleId?: string | null;
  managerId?: string | null;
  status: string;
  signatureImage?: string | null;
}

export interface SystemRole {
  id: string;
  name: string;
  description?: string | null;
  isDefault?: boolean;
}

export interface SystemDepartment {
  id: string;
  name: string;
  description?: string | null;
  parentId?: string | null;
  managerId?: string | null;
  level?: number;
  sortOrder?: number;
}

export const systemApi = {
  users: () => api.get<SystemUser[]>('/system/users'),
  roles: () => api.get<SystemRole[]>('/system/roles'),
  departments: () => api.get<SystemDepartment[]>('/system/departments'),
  createRole: (data: { name: string; description?: string; isDefault?: boolean }) =>
    api.post<SystemRole>('/system/roles', data),
  deleteRole: (id: string) => api.delete(`/system/roles/${id}`),
  createDepartment: (data: { name: string; description?: string; parentId?: string; managerId?: string; sortOrder?: number }) =>
    api.post<SystemDepartment>('/system/departments', data),
  updateDepartment: (id: string, data: { name?: string; description?: string; managerId?: string; sortOrder?: number }) =>
    api.patch<SystemDepartment>(`/system/departments/${id}`, data),
  deleteDepartment: (id: string) => api.delete(`/system/departments/${id}`),
  updateUserOrg: (id: string, data: { position?: string; roleId?: string; departmentId?: string; managerId?: string; status?: string; role?: string; password?: string }) =>
    api.patch<SystemUser>(`/system/users/${id}/org`, data),
};
