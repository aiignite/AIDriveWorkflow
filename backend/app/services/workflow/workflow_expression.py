"""Safe evaluation of workflow gateway condition expressions."""
from __future__ import annotations

import ast
import logging
from typing import Any

logger = logging.getLogger(__name__)

_ALLOWED_BINOPS: dict[type, Any] = {
    ast.Eq: lambda a, b: a == b,
    ast.NotEq: lambda a, b: a != b,
    ast.Gt: lambda a, b: a is not None and b is not None and a > b,
    ast.GtE: lambda a, b: a is not None and b is not None and a >= b,
    ast.Lt: lambda a, b: a is not None and b is not None and a < b,
    ast.LtE: lambda a, b: a is not None and b is not None and a <= b,
    ast.In: lambda a, b: a in (b if isinstance(b, (list, tuple, set)) else [b]),
    ast.NotIn: lambda a, b: a not in (b if isinstance(b, (list, tuple, set)) else [b]),
}

_ALLOWED_BOOL_OPS: dict[type, Any] = {
    ast.And: all,
    ast.Or: any,
}


def safe_eval_expression(expression: str, variables: dict[str, Any]) -> bool:
    """Evaluate gateway expressions like ``result=="approved"`` against instance variables."""
    if not expression or not expression.strip():
        return False
    try:
        tree = ast.parse(expression.strip(), mode="eval")
        result = _eval_node(tree.body, variables)
        return bool(result)
    except Exception as exc:  # noqa: BLE001 — log and treat as false match
        logger.warning("Failed to evaluate workflow expression %r: %s", expression, exc)
        return False


def _eval_node(node: ast.AST, variables: dict[str, Any]) -> Any:
    if isinstance(node, ast.Constant):
        return node.value
    if isinstance(node, ast.Name):
        if node.id not in variables:
            raise KeyError(node.id)
        return variables[node.id]
    if isinstance(node, ast.Compare):
        left = _eval_node(node.left, variables)
        for op, comparator in zip(node.ops, node.comparators, strict=False):
            right = _eval_node(comparator, variables)
            op_type = type(op)
            if op_type not in _ALLOWED_BINOPS:
                raise ValueError(f"Unsupported comparison operator: {op_type.__name__}")
            if not _ALLOWED_BINOPS[op_type](left, right):
                return False
            left = right
        return True
    if isinstance(node, ast.BoolOp):
        op_type = type(node.op)
        if op_type not in _ALLOWED_BOOL_OPS:
            raise ValueError(f"Unsupported boolean operator: {op_type.__name__}")
        values = [_eval_node(value, variables) for value in node.values]
        return _ALLOWED_BOOL_OPS[op_type](values)
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.Not):
        return not bool(_eval_node(node.operand, variables))
    if isinstance(node, ast.List):
        return [_eval_node(elt, variables) for elt in node.elts]
    if isinstance(node, ast.Tuple):
        return tuple(_eval_node(elt, variables) for elt in node.elts)
    raise ValueError(f"Unsupported expression node: {type(node).__name__}")
