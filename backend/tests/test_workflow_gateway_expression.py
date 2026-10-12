"""Tests for workflow gateway expression evaluation and routing."""
from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.workflow.workflow_expression import safe_eval_expression
from app.services.workflow.workflow_service import (
    WorkflowEngine,
    _evaluate_single_condition,
)


class TestSafeEvalExpression:
    def test_approved_branch(self):
        assert safe_eval_expression('result=="approved"', {"result": "approved"}) is True
        assert safe_eval_expression('result=="approved"', {"result": "rejected"}) is False

    def test_rejected_branch(self):
        assert safe_eval_expression('result=="rejected"', {"result": "rejected"}) is True

    def test_evaluate_single_condition_with_expression(self):
        condition = {"expression": 'result=="approved"'}
        assert _evaluate_single_condition(condition, {"result": "approved"}) is True
        assert _evaluate_single_condition(condition, {"result": "rejected"}) is False

    def test_invalid_expression_returns_false(self):
        assert safe_eval_expression("import os", {"result": "approved"}) is False

    def test_field_operator_still_works(self):
        condition = {"field": "result", "operator": "eq", "value": "approved"}
        assert _evaluate_single_condition(condition, {"result": "approved"}) is True


@pytest.mark.asyncio
async def test_exclusive_gateway_routes_to_approved_edge():
    """Approval completion should follow the expression-matched edge."""
    db = AsyncMock()
    instance = MagicMock()
    instance.id = uuid.uuid4()
    instance.variables = {"result": "approved"}
    instance.current_node_ids = []

    gateway = MagicMock()
    gateway.id = uuid.uuid4()
    gateway.node_type = "exclusive_gateway"
    gateway.name = "Gateway"

    approve_node = MagicMock()
    approve_node.id = uuid.uuid4()
    approve_node.node_type = "end"
    approve_node.name = "Approved End"

    reject_node = MagicMock()
    reject_node.id = uuid.uuid4()
    reject_node.node_type = "end"
    reject_node.name = "Rejected End"

    approve_edge = MagicMock()
    approve_edge.id = uuid.uuid4()
    approve_edge.source_node_id = gateway.id
    approve_edge.target_node_id = approve_node.id
    approve_edge.is_default = False
    approve_edge.condition = {"expression": 'result=="approved"'}
    approve_edge.label = "通过"

    reject_edge = MagicMock()
    reject_edge.id = uuid.uuid4()
    reject_edge.source_node_id = gateway.id
    reject_edge.target_node_id = reject_node.id
    reject_edge.is_default = True
    reject_edge.condition = {"expression": 'result=="rejected"'}
    reject_edge.label = "退回"

    defn = MagicMock()
    defn.nodes = [gateway, approve_node, reject_node]
    defn.edges = [approve_edge, reject_edge]

    engine = WorkflowEngine(db)
    entered: list[uuid.UUID] = []

    async def fake_enter_node(_instance, _defn, node):
        entered.append(node.id)

    with patch.object(engine, "_enter_node", side_effect=fake_enter_node):
        await engine._advance_from_node(instance, defn, gateway)

    assert entered == [approve_node.id]


@pytest.mark.asyncio
async def test_exclusive_gateway_falls_back_to_default_edge():
    db = AsyncMock()
    instance = MagicMock()
    instance.id = uuid.uuid4()
    instance.variables = {"result": "unknown"}
    instance.current_node_ids = []

    gateway = MagicMock()
    gateway.id = uuid.uuid4()
    gateway.node_type = "exclusive_gateway"

    default_node = MagicMock()
    default_node.id = uuid.uuid4()
    default_node.node_type = "end"

    other_node = MagicMock()
    other_node.id = uuid.uuid4()
    other_node.node_type = "end"

    default_edge = MagicMock()
    default_edge.id = uuid.uuid4()
    default_edge.source_node_id = gateway.id
    default_edge.target_node_id = default_node.id
    default_edge.is_default = True
    default_edge.condition = None
    default_edge.label = "default"

    other_edge = MagicMock()
    other_edge.id = uuid.uuid4()
    other_edge.source_node_id = gateway.id
    other_edge.target_node_id = other_node.id
    other_edge.is_default = False
    other_edge.condition = {"expression": 'result=="approved"'}
    other_edge.label = "approved"

    defn = MagicMock()
    defn.nodes = [gateway, default_node, other_node]
    defn.edges = [default_edge, other_edge]

    engine = WorkflowEngine(db)
    entered: list[uuid.UUID] = []

    async def fake_enter_node(_instance, _defn, node):
        entered.append(node.id)

    with patch.object(engine, "_enter_node", side_effect=fake_enter_node):
        await engine._advance_from_node(instance, defn, gateway)

    assert entered == [default_node.id]
