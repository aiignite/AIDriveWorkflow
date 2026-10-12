"""Tests for workflow constants and reject_action normalization."""
from __future__ import annotations

from app.services.workflow.workflow_constants import (
    ENGINE_MANAGED_ACTIONS,
    normalize_reject_action,
)


def test_engine_managed_actions():
    assert ENGINE_MANAGED_ACTIONS == frozenset({"submit", "approve", "reject"})


def test_normalize_reject_action_aliases():
    assert normalize_reject_action("back_to_draft") == "back_to_start"
    assert normalize_reject_action("terminate") == "terminate"
    assert normalize_reject_action("back_to_previous") == "back_to_previous"


def test_normalize_reject_action_unknown_falls_back():
    assert normalize_reject_action("unknown_action") == "terminate"
    assert normalize_reject_action(None) == "terminate"
