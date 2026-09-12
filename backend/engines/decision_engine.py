from __future__ import annotations

from typing import Any, Mapping


def build_decision_summary(objective: str, deterministic_winner: Mapping[str, Any], ml_prediction: Mapping[str, Any] | None, evidence_confidence: float | None) -> dict[str, Any]:
    """Future strategy hook: summarize tradeoffs without choosing a new route."""
    return {
        "objective": objective,
        "deterministic_winner": dict(deterministic_winner),
        "ml_prediction": dict(ml_prediction or {"status": "unavailable"}),
        "evidence_confidence": evidence_confidence,
        "decision_status": "deterministic_winner_retained",
    }