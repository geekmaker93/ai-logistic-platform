from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlencode
from urllib.request import urlopen
from urllib.error import URLError


Coordinate = tuple[float, float]


@dataclass(frozen=True)
class OsrmRoute:
    distance_km: float
    duration_minutes: int


class OsrmClient:
    """Minimal client for the OSRM route service running outside the API process."""

    def __init__(self, base_url: str, timeout_seconds: float = 5.0) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout_seconds = timeout_seconds

    @property
    def enabled(self) -> bool:
        return bool(self.base_url)

    def driving_routes(self, origin: Coordinate, destination: Coordinate) -> list[OsrmRoute]:
        if not self.enabled:
            return []

        origin_latitude, origin_longitude = origin
        destination_latitude, destination_longitude = destination
        coordinates = (
            f"{origin_longitude:.6f},{origin_latitude:.6f};"
            f"{destination_longitude:.6f},{destination_latitude:.6f}"
        )
        query = urlencode({"alternatives": "true", "overview": "false", "steps": "false"})
        request_url = f"{self.base_url}/route/v1/driving/{coordinates}?{query}"

        try:
            with urlopen(request_url, timeout=self.timeout_seconds) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except (URLError, TimeoutError, ValueError):
            return []

        return extract_osrm_routes(payload)


def extract_osrm_routes(payload: Any) -> list[OsrmRoute]:
    if not isinstance(payload, dict) or payload.get("code") != "Ok":
        return []

    routes = payload.get("routes")
    if not isinstance(routes, list):
        return []

    parsed_routes: list[OsrmRoute] = []
    for route in routes:
        if not isinstance(route, dict):
            continue
        distance_meters = route.get("distance")
        duration_seconds = route.get("duration")
        if not isinstance(distance_meters, (int, float)) or not isinstance(duration_seconds, (int, float)):
            continue
        if distance_meters <= 0 or duration_seconds <= 0:
            continue
        parsed_routes.append(
            OsrmRoute(
                distance_km=round(float(distance_meters) / 1000.0, 1),
                duration_minutes=max(1, int(round(float(duration_seconds) / 60.0))),
            )
        )

    return parsed_routes
