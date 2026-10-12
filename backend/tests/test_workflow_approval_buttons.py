"""审批节点处理按钮 → 支线路由 / 终止 / 退回。"""
from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.workflow.workflow_service import WorkflowEngine


def _edge(*, source_id, target_id, is_default: bool = False, condition=None):
    e = MagicMock()
    e.id = uuid.uuid4()
    e.source_node_id = source_id
    e.target_node_id = target_id
    e.is_default = is_default
    e.condition = condition
    return e


def _node(*, node_key: str, node_type: str = "approval", form_config=None, approval_config=None):
    n = MagicMock()
    n.id = uuid.uuid4()
    n.node_key = node_key
    n.node_type = node_type
    n.form_config = form_config
    n.approval_config = approval_config
    n.assignee_config = None
    return n


@pytest.mark.asyncio
def _stub_db_execute(db, scalars_all=None):
    """db.execute 返回 MagicMock（py3.12 AsyncMock 子属性默认也是 AsyncMock，
    scalars().all() 会拿到协程），统一配置为可链式调用的普通 MagicMock。"""
    result = MagicMock()
    result.scalars.return_value.all.return_value = list(scalars_all or [])
    result.scalars.return_value.first.return_value = None
    result.scalar_one_or_none.return_value = None
    result.scalar_one.return_value = None
    db.execute = AsyncMock(return_value=result)
    return db


async def test_button_route_advances_only_matching_outgoing_edge():
    """不同 button_key 只进入 targetNodeKey 对应出边。"""
    db = _stub_db_execute(AsyncMock())

    start = _node(node_key="start", node_type="start")
    approve = _node(
        node_key="approve",
        form_config={
            "buttons": [
                {
                    "key": "approve",
                    "label": "发送批准",
                    "action": "route",
                    "result": "approved",
                    "targetNodeKey": "next_ok",
                },
                {
                    "key": "alt",
                    "label": "走备选",
                    "action": "route",
                    "result": "alt",
                    "target_node_key": "next_alt",
                },
            ],
        },
    )
    next_ok = _node(node_key="next_ok", node_type="user_task")
    next_alt = _node(node_key="next_alt", node_type="user_task")
    end = _node(node_key="end", node_type="end")

    edges = [
        _edge(source_id=start.id, target_id=approve.id),
        _edge(source_id=approve.id, target_id=next_ok.id),
        _edge(source_id=approve.id, target_id=next_alt.id),
        _edge(source_id=next_ok.id, target_id=end.id),
        _edge(source_id=next_alt.id, target_id=end.id),
    ]

    instance = MagicMock()
    instance.id = uuid.uuid4()
    instance.definition_id = uuid.uuid4()
    instance.variables = {}
    instance.current_node_ids = [str(approve.id)]
    instance.entity_type = None
    instance.entity_id = None

    task = MagicMock()
    task.id = uuid.uuid4()
    task.instance_id = instance.id
    task.node_id = approve.id
    task.instance = instance
    task.status = "claimed"

    defn = MagicMock()
    defn.nodes = [start, approve, next_ok, next_alt, end]
    defn.edges = edges

    engine = WorkflowEngine(db)
    engine.load_definition_full = AsyncMock(return_value=defn)
    entered: list[str] = []

    async def _enter(_inst, _defn, node):
        entered.append(node.node_key)

    engine._enter_node = _enter  # type: ignore[method-assign]

    with patch(
        "app.services.workflow.workflow_service._write_log",
        new_callable=AsyncMock,
    ), patch(
        "app.services.workflow.approval_signatures.record_task_signature",
        new_callable=AsyncMock,
    ):
        await engine.complete_task(
            task=task,
            result="approved",
            actor_id=uuid.uuid4(),
            button_key="approve",
            target_node_key="next_alt",  # client tamper — server uses button config
        )

    assert task.result == "approved"
    assert instance.variables.get("button_key") == "approve"
    assert instance.variables.get("button_target_node_key") == "next_ok"
    assert entered == ["next_ok"]


@pytest.mark.asyncio
async def test_button_terminate_ends_instance():
    db = _stub_db_execute(AsyncMock())
    approve = _node(
        node_key="approve",
        form_config={
            "buttons": [
                {"key": "void", "label": "作废", "action": "terminate", "result": "void"},
            ],
        },
    )
    instance = MagicMock()
    instance.id = uuid.uuid4()
    instance.definition_id = uuid.uuid4()
    instance.variables = {}
    instance.current_node_ids = [str(approve.id)]
    instance.entity_type = "bgt_budgets"
    instance.entity_id = uuid.uuid4()

    task = MagicMock()
    task.id = uuid.uuid4()
    task.instance_id = instance.id
    task.node_id = approve.id
    task.instance = instance
    task.status = "claimed"

    defn = MagicMock()
    defn.nodes = [approve]
    defn.edges = []

    engine = WorkflowEngine(db)
    engine.load_definition_full = AsyncMock(return_value=defn)

    with patch(
        "app.services.workflow.workflow_service._write_log",
        new_callable=AsyncMock,
    ), patch(
        "app.services.workflow.approval_signatures.record_task_signature",
        new_callable=AsyncMock,
    ), patch(
        "app.services.workflow.workflow_integration.handle_workflow_completion",
        new_callable=AsyncMock,
    ) as mock_completion:
        await engine.complete_task(
            task=task,
            result="approved",
            actor_id=uuid.uuid4(),
            button_key="void",
        )

    assert task.result == "void"
    assert instance.status == "terminated"
    mock_completion.assert_awaited_once_with(db, instance, result="void")


@pytest.mark.asyncio
async def test_button_back_to_start_reenters_first_task():
    db = _stub_db_execute(AsyncMock())
    start = _node(node_key="start", node_type="start")
    first = _node(node_key="draft", node_type="user_task")
    approve = _node(
        node_key="approve",
        form_config={
            "buttons": [
                {
                    "key": "return",
                    "label": "退回申请",
                    "action": "back_to_start",
                    "result": "returned",
                },
            ],
        },
    )
    edges = [
        _edge(source_id=start.id, target_id=first.id),
        _edge(source_id=first.id, target_id=approve.id),
    ]

    instance = MagicMock()
    instance.id = uuid.uuid4()
    instance.definition_id = uuid.uuid4()
    instance.variables = {}
    instance.current_node_ids = [str(approve.id)]
    instance.entity_type = None
    instance.entity_id = None

    task = MagicMock()
    task.id = uuid.uuid4()
    task.instance_id = instance.id
    task.node_id = approve.id
    task.instance = instance
    task.status = "claimed"

    defn = MagicMock()
    defn.nodes = [start, first, approve]
    defn.edges = edges

    engine = WorkflowEngine(db)
    engine.load_definition_full = AsyncMock(return_value=defn)
    entered: list[str] = []

    async def _enter(_inst, _defn, node):
        entered.append(node.node_key)

    engine._enter_node = _enter  # type: ignore[method-assign]

    with patch(
        "app.services.workflow.workflow_service._write_log",
        new_callable=AsyncMock,
    ), patch(
        "app.services.workflow.approval_signatures.record_task_signature",
        new_callable=AsyncMock,
    ):
        await engine.complete_task(
            task=task,
            result="rejected",
            actor_id=uuid.uuid4(),
            button_key="return",
        )

    assert task.result == "returned"
    assert entered == ["draft"]


@pytest.mark.asyncio
async def test_no_button_legacy_reject_terminate_still_works():
    """未配置按钮时 rejected + reject_action=terminate 走旧路径。"""
    db = _stub_db_execute(AsyncMock())
    approve = _node(
        node_key="approve",
        form_config={"buttons": []},
        approval_config={"reject_action": "terminate"},
    )
    instance = MagicMock()
    instance.id = uuid.uuid4()
    instance.definition_id = uuid.uuid4()
    instance.variables = {}
    instance.current_node_ids = []
    instance.entity_type = "bgt_budgets"
    instance.entity_id = uuid.uuid4()

    task = MagicMock()
    task.id = uuid.uuid4()
    task.instance_id = instance.id
    task.node_id = approve.id
    task.instance = instance
    task.status = "pending"

    defn = MagicMock()
    defn.nodes = [approve]
    defn.edges = []

    engine = WorkflowEngine(db)
    engine.load_definition_full = AsyncMock(return_value=defn)

    with patch(
        "app.services.workflow.workflow_service._write_log",
        new_callable=AsyncMock,
    ), patch(
        "app.services.workflow.approval_signatures.record_task_signature",
        new_callable=AsyncMock,
    ), patch(
        "app.services.workflow.workflow_integration.handle_workflow_completion",
        new_callable=AsyncMock,
    ) as mock_completion:
        await engine.complete_task(
            task=task,
            result="rejected",
            actor_id=uuid.uuid4(),
            comment="不符合要求",
        )

    assert instance.status == "terminated"
    mock_completion.assert_awaited_once_with(db, instance, result="rejected")
