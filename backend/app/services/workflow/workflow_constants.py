"""Shared workflow engine constants."""
from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

# Built-in state-machine actions delegated to the external engine when configured.
ENGINE_MANAGED_ACTIONS: frozenset[str] = frozenset({"submit", "approve", "reject"})

# Supported reject_action values on approval nodes.
VALID_REJECT_ACTIONS: frozenset[str] = frozenset({
    "terminate",
    "back_to_start",
    "back_to_previous",
})

# Legacy seed / designer aliases → engine-supported values.
REJECT_ACTION_ALIASES: dict[str, str] = {
    "back_to_draft": "back_to_start",
}


def normalize_reject_action(reject_action: str | None) -> str:
    """Map legacy reject_action values to supported engine behavior."""
    if not reject_action:
        return "terminate"
    normalized = REJECT_ACTION_ALIASES.get(reject_action, reject_action)
    if normalized not in VALID_REJECT_ACTIONS:
        logger.warning(
            "Unknown reject_action %r; falling back to terminate",
            reject_action,
        )
        return "terminate"
    return normalized
