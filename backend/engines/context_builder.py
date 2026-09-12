from __future__ import annotations

from typing import Any, Mapping, Sequence


def build_validated_context(
    user_question: str,
    intent: Mapping[str, Any],
    shipment: Mapping[str, Any],
    deterministic_result: Mapping[str, Any],
    validated_evidence: Sequence[Mapping[str, Any]],
    ml_prediction: Mapping[str, Any] | None,
) -> dict[str, Any]:
    """Return an explicit allowlist, never a database/session object."""
    return {
        "user_question": user_question,
        "intent": dict(intent),
        "shipment": label_values(shipment, "ESTIMATED"),
        "deterministic_result": label_values(deterministic_result, "HIGH_CONFIDENCE"),
        "validated_evidence": [label_values(record, "HISTORICAL") for record in validated_evidence],
        "ml_prediction": label_values(ml_prediction or {"status": "unavailable"}, "PREDICTED"),
        "rules": [
            "ACTUAL values are not predictions.",
            "The deterministic winner is authoritative and must not be overridden.",
            "Explain uncertainty when evidence or ML status is unavailable.",
        ],
    }


def label_values(values: Mapping[str, Any], default_label: str) -> dict[str, Any]:
    return {"label": values.get("label", default_label), "values": dict(values)}