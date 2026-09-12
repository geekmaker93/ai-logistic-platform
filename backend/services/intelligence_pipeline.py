from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Mapping

from sqlalchemy import select
from sqlalchemy.orm import Session

from engines.context_builder import build_validated_context
from engines.decision_engine import build_decision_summary
from engines.evidence_engine import assess_evidence, evidence_confidence, rank_validated_evidence
from engines.ml_engine import RouteOutcomePredictor
from engines.relevance_engine import score_relevance


def build_route_intelligence(
    db: Session,
    route_model: Any,
    metadata_model: Any,
    request: Mapping[str, Any],
    deterministic_winner: Mapping[str, Any],
) -> dict[str, Any]:
    """Retrieve broadly, validate strictly, then create advisory-only outputs."""
    now = datetime.now(timezone.utc)
    historical = list(db.scalars(select(route_model).where(route_model.completed_at.is_not(None))))
    validated: list[dict[str, Any]] = []
    training_rows: list[dict[str, Any]] = []
    for row in historical:
        record = row_to_dict(row)
        relevance, relevance_components = score_relevance(request, record, now=now)
        assessment = assess_evidence(record, now=now)
        accuracy = historical_accuracy(record)
        recency = relevance_components.get("recency")
        confidence = evidence_confidence(relevance, assessment.data_quality_score, None, recency, accuracy)
        metadata = db.scalar(select(metadata_model).where(metadata_model.record_id == row.id))
        if metadata is not None:
            metadata.relevance_score = relevance
            metadata.data_quality_score = assessment.data_quality_score
            metadata.recency_score = recency
            metadata.historical_accuracy_score = accuracy
            metadata.anomaly_score = assessment.anomaly_score
            metadata.confidence_score = confidence
            metadata.validation_status = assessment.validation_status
            metadata.last_validated_at = now
        record.update({
            "relevance_score": relevance, "data_quality_score": assessment.data_quality_score,
            "historical_accuracy_score": accuracy, "confidence_score": confidence,
            "validation_status": assessment.validation_status,
        })
        if assessment.validation_status != "invalid":
            validated.append(record)
        if assessment.validation_status == "valid":
            training_rows.append(record)
    ranked = rank_validated_evidence(validated)[:10]
    predictor = RouteOutcomePredictor()
    training_status = predictor.train(training_rows)
    prediction = predictor.predict(deterministic_winner, ranked[0].get("confidence_score") if ranked else None)
    context = build_validated_context(
        "Explain the deterministic route analysis.", request, request, deterministic_winner,
        ranked, {"status": prediction.status, "predictions": prediction.predictions, "confidence": prediction.confidence},
    )
    decision = build_decision_summary(request.get("optimization_mode", "unknown"), deterministic_winner, prediction.__dict__, ranked[0].get("confidence_score") if ranked else None)
    db.commit()
    return {
        "training_status": training_status,
        "evidence_count": len(ranked),
        "evidence_confidence": ranked[0].get("confidence_score") if ranked else None,
        "prediction": prediction.__dict__,
        "decision": decision,
        "context": context,
    }


def historical_accuracy(record: Mapping[str, Any]) -> float | None:
    pairs = ((record.get("eta_minutes"), record.get("actual_eta_minutes")), (record.get("fuel_liters"), record.get("actual_fuel_liters")), (record.get("total_operating_cost_usd"), record.get("actual_operating_cost_usd")))
    errors = []
    for predicted, actual in pairs:
        if predicted is None or actual is None:
            continue
        try:
            errors.append(min(1.0, abs(float(predicted) - float(actual)) / max(abs(float(actual)), 1.0)))
        except (TypeError, ValueError):
            continue
    return round(1.0 - (sum(errors) / len(errors)), 4) if errors else None


def row_to_dict(row: Any) -> dict[str, Any]:
    return {column.name: getattr(row, column.name) for column in row.__table__.columns}