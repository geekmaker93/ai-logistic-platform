from __future__ import annotations

from datetime import datetime
from typing import Any, Callable, Sequence
from uuid import uuid4

from sqlalchemy.orm import Session

from engines.evidence_engine import assess_evidence, evidence_confidence


def record_route_options(
    db: Session,
    route_model: Callable[..., Any],
    metadata_model: Callable[..., Any],
    shipment_id: str,
    origin: str,
    destination: str,
    weight_kg: float,
    optimization_mode: str,
    fuel_price_usd_per_liter: float | None,
    routes: Sequence[Any],
    selected_name: str | None,
    created_at: datetime,
) -> list[Any]:
    """Persist every deterministic candidate as a point-in-time snapshot."""
    records: list[Any] = []
    for route in routes:
        economic = route.economic or {}
        record = route_model(
            id=str(uuid4()), shipment_id=shipment_id, route_id=str(uuid4()), route_name=route.name,
            origin=origin, destination=destination, weight_kg=weight_kg, distance_km=route.distance_km,
            eta_minutes=round(route.estimated_hours * 60), fuel_liters=route.fuel_liters,
            fuel_price_usd_per_liter=fuel_price_usd_per_liter,
            fuel_cost_usd=economic.get("fuel_cost_usd"), toll_usd=route.toll_usd,
            weather_risk=route.weather_risk, maintenance_cost_usd=economic.get("maintenance_cost_usd"),
            operating_cost_usd=economic.get("carrier_profit_cost_usd"),
            total_operating_cost_usd=economic.get("total_operating_cost_usd"),
            cost_per_km_usd=economic.get("cost_per_km_usd"), optimization_mode=optimization_mode,
            deterministic_score=route.score, selected=selected_name is not None and route.name == selected_name, created_at=created_at,
        )
        assessment = assess_evidence({
            "origin": origin, "destination": destination, "distance_km": record.distance_km,
            "eta_minutes": record.eta_minutes, "fuel_liters": record.fuel_liters,
            "created_at": created_at,
        }, now=created_at)
        db.add(record)
        db.add(metadata_model(
            id=str(uuid4()), record_id=record.id, relevance_score=None,
            data_quality_score=assessment.data_quality_score, source_reliability_score=None,
            recency_score=1.0, historical_accuracy_score=None, anomaly_score=assessment.anomaly_score,
            confidence_score=evidence_confidence(None, assessment.data_quality_score, None, 1.0, None),
            validation_status=assessment.validation_status, last_validated_at=created_at,
        ))
        records.append(record)
    return records


def record_actual_outcome(record: Any, payload: Any, completed_at: datetime) -> None:
    """Only save carrier-supplied actuals; omitted fields remain NULL."""
    record.actual_eta_minutes = payload.actual_eta_minutes
    record.actual_fuel_liters = payload.actual_fuel_liters
    record.actual_operating_cost_usd = payload.actual_operating_cost_usd
    record.actual_delivery_time = payload.actual_delivery_time
    record.outcome_status = payload.outcome_status
    record.completed_at = completed_at