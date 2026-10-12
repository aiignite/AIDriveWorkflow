import { describe, expect, it } from 'vitest';
import type { WorkflowAssigneeConfig } from '../../types';
import {
  buildAssigneeConfigFromHandlers,
  defaultCompletionCondition,
  formatHandlersBadge,
  normalizeHandlers,
  validateAssigneeHandlers,
} from './assigneeHandlers';

const maps = {
  users: [
    { id: 'u1', name: 'jinchao', realName: '金超' },
    { id: 'u2', name: 'lisi', realName: '李四' },
  ],
  sysRoles: [{ id: 'r1', name: '质量工程师' }],
  projectRoles: [{ id: 'pr1', name: '项目经理' }],
  departments: [{ id: 'd1', name: '工艺部' }],
};

describe('normalizeHandlers', () => {
  it('converts legacy single assigneeType/value to one handler', () => {
    const config: WorkflowAssigneeConfig = {
      assigneeType: 'role',
      assigneeValue: 'r1',
    };
    expect(normalizeHandlers(config)).toEqual([{ type: 'role', value: 'r1' }]);
  });

  it('prefers handlers array when present', () => {
    const config: WorkflowAssigneeConfig = {
      assigneeType: 'user',
      assigneeValue: 'u1',
      handlers: [
        { type: 'user', value: 'u1', label: '金超' },
        { type: 'role', value: 'r1' },
      ],
    };
    expect(normalizeHandlers(config)).toHaveLength(2);
    expect(normalizeHandlers(config)[1].type).toBe('role');
  });

  it('returns empty for missing config', () => {
    expect(normalizeHandlers(undefined)).toEqual([]);
    expect(normalizeHandlers(null)).toEqual([]);
  });
});

describe('validateAssigneeHandlers', () => {
  it('requires at least one handler', () => {
    expect(validateAssigneeHandlers(undefined)).toMatch(/未配置/);
    expect(validateAssigneeHandlers({ assigneeType: 'user', handlers: [] })).toMatch(/未配置/);
  });

  it('rejects user without value', () => {
    expect(validateAssigneeHandlers({ assigneeType: 'user' })).toMatch(/缺少选择值/);
  });

  it('requires value for role/user/department/project_role', () => {
    expect(
      validateAssigneeHandlers({
        assigneeType: 'role',
        handlers: [{ type: 'role' }],
      }),
    ).toMatch(/缺少选择值/);
  });

  it('accepts initiator without value', () => {
    expect(
      validateAssigneeHandlers({
        assigneeType: 'initiator',
        handlers: [{ type: 'initiator' }],
      }),
    ).toBeNull();
  });
});

describe('formatHandlersBadge', () => {
  it('shows single handler name', () => {
    expect(
      formatHandlersBadge({ assigneeType: 'user', assigneeValue: 'u1' }, maps),
    ).toBe('金超');
  });

  it('shows two handlers joined', () => {
    expect(
      formatHandlersBadge(
        {
          assigneeType: 'user',
          handlers: [
            { type: 'user', value: 'u1' },
            { type: 'role', value: 'r1' },
          ],
        },
        maps,
      ),
    ).toBe('金超 + 系统:质量工程师');
  });

  it('shows +N for three or more', () => {
    expect(
      formatHandlersBadge(
        {
          assigneeType: 'user',
          handlers: [
            { type: 'user', value: 'u1' },
            { type: 'role', value: 'r1' },
            { type: 'project_role', value: 'pr1' },
          ],
        },
        maps,
      ),
    ).toBe('金超 + 系统:质量工程师 +1');
  });
});

describe('buildAssigneeConfigFromHandlers', () => {
  it('writes handlers and legacy first fields', () => {
    const cfg = buildAssigneeConfigFromHandlers(
      [
        { type: 'user', value: 'u1', label: '金超' },
        { type: 'role', value: 'r1' },
      ],
      'all',
    );
    expect(cfg.handlers).toHaveLength(2);
    expect(cfg.assigneeType).toBe('user');
    expect(cfg.assigneeValue).toBe('u1');
    expect(cfg.multiInstance).toBe(true);
    expect(cfg.completionCondition).toBe('all');
  });
});

describe('defaultCompletionCondition', () => {
  it('defaults legacy project_role to any', () => {
    expect(
      defaultCompletionCondition({
        assigneeType: 'project_role',
        assigneeValue: 'pr1',
      }),
    ).toBe('any');
  });

  it('defaults new handlers config to all', () => {
    expect(
      defaultCompletionCondition({
        assigneeType: 'project_role',
        handlers: [{ type: 'project_role', value: 'pr1' }],
      }),
    ).toBe('all');
  });

  it('respects explicit completionCondition', () => {
    expect(
      defaultCompletionCondition({
        assigneeType: 'role',
        assigneeValue: 'r1',
        completionCondition: 'any',
      }),
    ).toBe('any');
  });
});
