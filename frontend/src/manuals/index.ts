/**
 * 模块使用说明书注册表（AIDriveWorkflow 仅保留工作流手册）
 */
import type { ManualData } from '../components/ManualViewer';

export async function loadManual(moduleKey: string): Promise<ManualData | null> {
  switch (moduleKey) {
    case 'workflow':
      return (await import('./workflow')).workflowManual;
    default:
      return null;
  }
}

export { workflowManual } from './workflow';
