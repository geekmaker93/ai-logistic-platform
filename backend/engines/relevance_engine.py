from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Mapping


@dataclass(frozen=True)
class RelevanceConfig:
    """Weights are normalized over signals available in both records."""

    geographic: float = 0.30
    weight: float = 0.15
    route: float = 0.15
    optimization_mode: float = 0.10
    weather: float = 0.05
    temporal: float = 0.10
    recency: float = 0.15
    recency_half_life_days: float = 90.0


def score_relevance(
    request: Mapping[str, Any], record: Mapping[str, Any], config: RelevanceConfig = RelevanceConfig(), now: datetime | None = None
) -> tuple[float, dict[str, float]]:
    """Compare request and history only where both sides provide a value."""
    signals: dict[str, tuple[float, float]] = {}
    origin = text_similarity(request.get("origin"), record.get("origin"))
    destination = text_similarity(request.get("destination"), record.get("destination"))
    if origin is not None and destination is not None:
        signals["geographic"] = ((origin + destination) / 2, config.geographic)
    add_numeric_similarity(signals, "weight", request.get("weight_kg"), record.get("weight_kg"), config.weight)
    route = text_similarity(request.get("route_name"), record.get("route_name"))
    if route is not None:
        signals["route"] = (route, config.route)
    mode = exact_similarity(request.get("optimization_mode"), record.get("optimization_mode"))
    if mode is not None:
        signals["optimization_mode"] = (mode, config.optimization_mode)
    add_numeric_similarity(signals, "weather", request.get("weather_risk"), record.get("weather_risk"), config.weather)
    temporal = exact_similarity(request.get("time_window"), record.get("time_window"))
    if temporal is not None:
        signals["temporal"] = (temporal, config.temporal)
    created_at = parse_datetime(record.get("created_at"))
    if created_at is not None:
        age_days = max(0.0, ((now or datetime.now(timezone.utc)) - created_at).total_seconds() / 86400)
        signals["recency"] = (0.5 ** (age_days / config.recency_half_life_days), config.recency)
    total_weight = sum(weight for _value, weight in signals.values())
    score = sum(value * weight for value, weight in signals.values()) / total_weight if total_weight else 0.0
    return round(score, 4), {name: round(value, 4) for name, (value, _weight) in signals.items()}


def add_numeric_similarity(signals: dict[str, tuple[float, float]], name: str, left: Any, right: Any, weight: float) -> None:
    try:
        left_value, right_value = float(left), float(right)
    except (TypeError, ValueError):
        return
    scale = max(abs(left_value), abs(right_value), 1.0)
    signals[name] = (max(0.0, 1.0 - abs(left_value - right_value) / scale), weight)


def exact_similarity(left: Any, right: Any) -> float | None:
    if left is None or right is None:
        return None
    return 1.0 if str(left).strip().casefold() == str(right).strip().casefold() else 0.0


def text_similarity(left: Any, right: Any) -> float | None:
    if left is None or right is None:
        return None
    left_tokens = set(str(left).casefold().split())
    right_tokens = set(str(right).casefold().split())
    if not left_tokens or not right_tokens:
        return None
    return len(left_tokens & right_tokens) / len(left_tokens | right_tokens)


def parse_datetime(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
        except ValueError:
            return None
    return None