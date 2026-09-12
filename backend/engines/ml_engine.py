from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping, Sequence

from sklearn.ensemble import RandomForestRegressor


FEATURES = ("distance_km", "eta_minutes", "fuel_liters", "weather_risk", "weight_kg", "toll_usd")
TARGETS = ("actual_eta_minutes", "actual_fuel_liters", "actual_operating_cost_usd")


@dataclass
class MlPrediction:
    status: str
    predictions: dict[str, float]
    confidence: float | None
    training_records: int


class RouteOutcomePredictor:
    def __init__(self, minimum_training_records: int = 20, random_state: int = 42) -> None:
        self.minimum_training_records = minimum_training_records
        self.random_state = random_state
        self.models: dict[str, RandomForestRegressor] = {}
        self.training_records = 0

    def train(self, records: Sequence[Mapping[str, Any]]) -> str:
        usable = [record for record in records if record.get("synthetic") is not True and all(number(record.get(feature)) is not None for feature in FEATURES)]
        self.training_records = len(usable)
        if len(usable) < self.minimum_training_records:
            self.models = {}
            return "insufficient_training_data"
        features = [[number(record[feature]) for feature in FEATURES] for record in usable]
        self.models = {}
        for target in TARGETS:
            target_rows = [(row, number(record.get(target))) for row, record in zip(features, usable) if number(record.get(target)) is not None]
            if len(target_rows) < self.minimum_training_records:
                continue
            model = RandomForestRegressor(n_estimators=100, random_state=self.random_state, min_samples_leaf=2)
            model.fit([row for row, _target in target_rows], [target for _row, target in target_rows])
            self.models[target] = model
        return "ready" if self.models else "insufficient_training_data"

    def predict(self, route: Mapping[str, Any], evidence_confidence: float | None = None) -> MlPrediction:
        row = [number(route.get(feature)) for feature in FEATURES]
        if not self.models or any(value is None for value in row):
            return MlPrediction("insufficient_training_data", {}, None, self.training_records)
        predictions = {target: round(float(model.predict([row])[0]), 2) for target, model in self.models.items()}
        sample_confidence = min(1.0, self.training_records / (self.minimum_training_records * 3))
        confidence = sample_confidence if evidence_confidence is None else round((sample_confidence + evidence_confidence) / 2, 4)
        return MlPrediction("ready", predictions, confidence, self.training_records)


def number(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None