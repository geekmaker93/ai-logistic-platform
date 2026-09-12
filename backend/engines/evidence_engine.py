from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Mapping


@dataclass(frozen=True)
class EvidenceAssessment:
    data_quality_score: float
    anomaly_score: float
    validation_status: str
    issues: tuple[str, ...]


CRITICAL_FIELDS = ("origin", "destination", "distance_km", "eta_minutes")
NON_NEGATIVE_FIELDS = ("distance_km", "eta_minutes", "fuel_liters", "fuel_cost_usd", "toll_usd", "operating_cost_usd")


def assess_evidence(record: Mapping[str, Any], now: datetime | None = None, stale_after_days: int = 365) -> EvidenceAssessment:
    """Keep anomalous history auditable; only invalid critical data is rejected."""
    issues: list[str] = []
    critical_missing = [field for field in CRITICAL_FIELDS if record.get(field) is None]
    if critical_missing:
        issues.append(f"missing_critical:{','.join(critical_missing)}")
    invalid = False
    for field in NON_NEGATIVE_FIELDS:
        value = record.get(field)
        if value is None:
            continue
        try:
            if float(value) < 0:
                invalid = True
                issues.append(f"invalid_negative:{field}")
        except (TypeError, ValueError):
            invalid = True
            issues.append(f"invalid_number:{field}")
    anomaly = float(record.get("anomaly_score") or 0.0)
    if anomaly > 0.5:
        issues.append("outlier_retained")
    created_at = record.get("created_at")
    if isinstance(created_at, datetime):
        timestamp = created_at if created_at.tzinfo else created_at.replace(tzinfo=timezone.utc)
        if ((now or datetime.now(timezone.utc)) - timestamp).days > stale_after_days:
            issues.append("stale")
    completeness = 1.0 - (len(critical_missing) / len(CRITICAL_FIELDS))
    quality = max(0.0, completeness - (0.35 if invalid else 0.0) - min(0.30, anomaly * 0.30) - (0.10 if "stale" in issues else 0.0))
    status = "invalid" if invalid or critical_missing else ("review" if issues else "valid")
    return EvidenceAssessment(round(quality, 4), round(min(1.0, max(0.0, anomaly)), 4), status, tuple(issues))


def evidence_confidence(relevance: float | None, quality: float | None, source_reliability: float | None, recency: float | None, historical_accuracy: float | None) -> float | None:
    """Weighted mean over measured components; unavailable scores are not invented."""
    components = ((relevance, 0.30), (quality, 0.25), (source_reliability, 0.15), (recency, 0.15), (historical_accuracy, 0.15))
    available = [(max(0.0, min(1.0, value)), weight) for value, weight in components if value is not None]
    if not available:
        return None
    return round(sum(value * weight for value, weight in available) / sum(weight for _value, weight in available), 4)


def rank_validated_evidence(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Retain auditable records elsewhere, but rank only non-invalid evidence."""
    return sorted(
        (record for record in records if record.get("validation_status") != "invalid"),
        key=lambda record: record.get("confidence_score") or 0.0,
        reverse=True,
    )