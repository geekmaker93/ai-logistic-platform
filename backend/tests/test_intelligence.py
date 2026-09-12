from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest import TestCase

from engines.context_builder import build_validated_context
from engines.evidence_engine import assess_evidence, evidence_confidence, rank_validated_evidence
from engines.ml_engine import RouteOutcomePredictor
from engines.relevance_engine import score_relevance
from services.intelligence_store import record_route_options


class IntelligenceEngineTests(TestCase):
    def test_relevance_prefers_similar_recent_record(self) -> None:
        request = {"origin": "Dallas TX", "destination": "Austin TX", "weight_kg": 1000, "optimization_mode": "lowest_cost"}
        similar, _ = score_relevance(request, {**request, "created_at": datetime.now(timezone.utc)})
        dissimilar, _ = score_relevance(request, {"origin": "Miami FL", "destination": "Seattle WA", "weight_kg": 100, "optimization_mode": "fastest", "created_at": datetime(2020, 1, 1, tzinfo=timezone.utc)})
        self.assertGreater(similar, dissimilar)
        self.assertLessEqual(similar, 1.0)

    def test_missing_critical_fields_are_invalid_without_fabrication(self) -> None:
        assessment = assess_evidence({"origin": "Dallas", "distance_km": None, "eta_minutes": None})
        self.assertEqual(assessment.validation_status, "invalid")
        self.assertIn("missing_critical", " ".join(assessment.issues))

    def test_outlier_is_retained_for_audit_but_down_weighted(self) -> None:
        assessment = assess_evidence({"origin": "Dallas", "destination": "Austin", "distance_km": 300, "eta_minutes": 200, "anomaly_score": 0.9})
        self.assertEqual(assessment.validation_status, "review")
        self.assertLess(assessment.data_quality_score, 1.0)
        self.assertIn("outlier_retained", assessment.issues)

    def test_evidence_ranking_uses_confidence(self) -> None:
        ranked = rank_validated_evidence([
            {"id": "low", "confidence_score": 0.3, "validation_status": "valid"},
            {"id": "invalid", "confidence_score": 0.99, "validation_status": "invalid"},
            {"id": "high", "confidence_score": 0.9, "validation_status": "valid"},
        ])
        self.assertEqual([record["id"] for record in ranked], ["high", "low"])
        self.assertEqual(evidence_confidence(0.9, 0.9, None, None, None), 0.9)

    def test_ml_rejects_insufficient_or_synthetic_training_data(self) -> None:
        predictor = RouteOutcomePredictor(minimum_training_records=2)
        synthetic = [complete_record(index, synthetic=True) for index in range(3)]
        self.assertEqual(predictor.train(synthetic), "insufficient_training_data")
        self.assertEqual(predictor.predict(complete_record(99)).status, "insufficient_training_data")

    def test_ml_predicts_only_after_real_completed_records(self) -> None:
        predictor = RouteOutcomePredictor(minimum_training_records=2)
        self.assertEqual(predictor.train([complete_record(1), complete_record(2), complete_record(3)]), "ready")
        prediction = predictor.predict(complete_record(4), 0.8)
        self.assertEqual(prediction.status, "ready")
        self.assertIn("actual_eta_minutes", prediction.predictions)
        self.assertIsNotNone(prediction.confidence)

    def test_context_is_an_allowlist_not_database_access(self) -> None:
        context = build_validated_context("Why?", {"mode": "lowest_cost"}, {"id": "shipment"}, {"route_name": "Route A"}, [], None)
        self.assertNotIn("database", context)
        self.assertEqual(context["deterministic_result"]["label"], "HIGH_CONFIDENCE")
        self.assertEqual(context["ml_prediction"]["values"]["status"], "unavailable")

    def test_route_recording_keeps_all_candidates_and_nulls(self) -> None:
        session = FakeSession()
        routes = [
            SimpleNamespace(name="Winner", distance_km=10.0, estimated_hours=1.0, fuel_liters=2.0, toll_usd=1.0, weather_risk=0.2, score=1.0, economic=None),
            SimpleNamespace(name="Alternative", distance_km=12.0, estimated_hours=1.2, fuel_liters=2.5, toll_usd=2.0, weather_risk=0.3, score=2.0, economic=None),
        ]
        records = record_route_options(session, FakeRouteRecord, FakeMetadata, "shipment", "A", "B", 100.0, "lowest_cost", None, routes, "Winner", datetime.now(timezone.utc))
        self.assertEqual(len(records), 2)
        self.assertEqual([record.selected for record in records], [True, False])
        self.assertIsNone(records[0].fuel_price_usd_per_liter)
        self.assertIsNone(records[0].fuel_cost_usd)


def complete_record(index: int, synthetic: bool = False) -> dict[str, float | bool]:
    return {
        "distance_km": 100.0 + index, "eta_minutes": 120.0 + index, "fuel_liters": 20.0 + index,
        "weather_risk": 0.2, "weight_kg": 1000.0, "toll_usd": 8.0,
        "actual_eta_minutes": 125.0 + index, "actual_fuel_liters": 21.0 + index,
        "actual_operating_cost_usd": 80.0 + index, "synthetic": synthetic,
    }


class FakeSession:
    def __init__(self) -> None:
        self.added: list[object] = []

    def add(self, value: object) -> None:
        self.added.append(value)


class FakeRouteRecord:
    def __init__(self, **values: object) -> None:
        self.__dict__.update(values)


class FakeMetadata:
    def __init__(self, **values: object) -> None:
        self.__dict__.update(values)