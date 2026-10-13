"""add hot path indexes

为工作流热路径查询补充索引：
- wfl_tasks: 「我的待办」assignee_id+status 复合索引、instance_id（PG 不会为 FK 自动建索引）
- wfl_instances: status / initiated_by_id / definition_id 单列索引
- wfl_instance_logs: instance_id / task_id 单列索引

Revision ID: a1f2c3d4e5b6
Revises: e50cc5919a4c
Create Date: 2026-10-13
"""
from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision = 'a1f2c3d4e5b6'
down_revision = 'e50cc5919a4c'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 任务表：待办列表与实例详情为最热查询路径
    op.create_index('ix_wfl_tasks_assignee_status', 'wfl_tasks', ['assignee_id', 'status'])
    op.create_index('ix_wfl_tasks_instance_id', 'wfl_tasks', ['instance_id'])
    # 实例表：状态过滤、按发起人查询、按定义统计
    op.create_index('ix_wfl_instances_status', 'wfl_instances', ['status'])
    op.create_index('ix_wfl_instances_initiated_by_id', 'wfl_instances', ['initiated_by_id'])
    op.create_index('ix_wfl_instances_definition_id', 'wfl_instances', ['definition_id'])
    # 日志表：时间线按实例/任务过滤
    op.create_index('ix_wfl_instance_logs_instance_id', 'wfl_instance_logs', ['instance_id'])
    op.create_index('ix_wfl_instance_logs_task_id', 'wfl_instance_logs', ['task_id'])


def downgrade() -> None:
    op.drop_index('ix_wfl_instance_logs_task_id', table_name='wfl_instance_logs')
    op.drop_index('ix_wfl_instance_logs_instance_id', table_name='wfl_instance_logs')
    op.drop_index('ix_wfl_instances_definition_id', table_name='wfl_instances')
    op.drop_index('ix_wfl_instances_initiated_by_id', table_name='wfl_instances')
    op.drop_index('ix_wfl_instances_status', table_name='wfl_instances')
    op.drop_index('ix_wfl_tasks_instance_id', table_name='wfl_tasks')
    op.drop_index('ix_wfl_tasks_assignee_status', table_name='wfl_tasks')
