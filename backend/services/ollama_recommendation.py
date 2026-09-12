from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434").rstrip("/")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5:7b").strip()
OLLAMA_TIMEOUT_SECONDS = float(os.getenv("OLLAMA_TIMEOUT_SECONDS", "60"))


@dataclass(frozen=True)
class RouteRecommendation:
	recommended_route: str
	reason: str
	tradeoffs: list[str]
	source: str


def generate_route_recommendation(
	optimization_mode: str,
	winning_route: str,
	routes: list[dict[str, Any]],
) -> RouteRecommendation:
	"""Ask Ollama to explain the deterministic winner without allowing it to select one."""
	fallback = deterministic_fallback(optimization_mode, winning_route, routes)
	if not OLLAMA_MODEL:
		return fallback

	payload = {
		"model": OLLAMA_MODEL,
		"stream": False,
		"format": "json",
		"options": {"temperature": 0.2},
		"messages": [
			{
				"role": "system",
				"content": (
					"You explain a route recommendation. The winning_route was selected by a "
					"deterministic system and is mandatory: do not choose, rename, or challenge it. "
					"Use only supplied facts. Return JSON with recommended_route, reason, and tradeoffs, "
					"where tradeoffs is a JSON array of short strings."
				),
			},
			{
				"role": "user",
				"content": json.dumps(
					{
						"optimization_mode": optimization_mode,
						"winning_route": winning_route,
						"routes": routes,
					},
					separators=(",", ":"),
				),
			},
		],
	}

	try:
		request = Request(
			f"{OLLAMA_BASE_URL}/api/chat",
			data=json.dumps(payload).encode("utf-8"),
			headers={"Content-Type": "application/json"},
			method="POST",
		)
		with urlopen(request, timeout=OLLAMA_TIMEOUT_SECONDS) as response:
			body = json.loads(response.read().decode("utf-8"))
		content = str((body.get("message") or {}).get("content") or "")
		answer = json.loads(content)
		if not isinstance(answer, dict):
			raise ValueError("Ollama response was not a JSON object.")
		reason = str(answer.get("reason") or "").strip()
		tradeoffs = normalize_tradeoffs(answer.get("tradeoffs"))
		if not reason:
			raise ValueError("Ollama response omitted required recommendation fields.")
		return RouteRecommendation(
			recommended_route=winning_route,
			reason=reason,
			tradeoffs=fallback.tradeoffs,
			source="ollama",
		)
	except (HTTPError, URLError, OSError, TimeoutError, ValueError, json.JSONDecodeError):
		return fallback


def normalize_tradeoffs(value: Any) -> list[str]:
	if isinstance(value, list):
		return [str(item).strip() for item in value if str(item).strip()][:5]
	if isinstance(value, dict):
		return [str(item).strip() for item in value.values() if str(item).strip()][:5]
	return []


def deterministic_fallback(
	optimization_mode: str,
	winning_route: str,
	routes: list[dict[str, Any]],
) -> RouteRecommendation:
	winner = next((route for route in routes if route.get("name") == winning_route), {})
	winner_eta = int(round(float(winner.get("eta_minutes") or 0)))
	winner_cost = float(winner.get("cost") or 0)
	tradeoffs: list[str] = []
	for route in routes:
		if route.get("name") == winning_route:
			continue
		eta_difference = int(round(float(route.get("eta_minutes") or 0))) - winner_eta
		cost_difference = float(route.get("cost") or 0) - winner_cost
		if eta_difference < 0:
			tradeoffs.append(f"{abs(eta_difference)} minutes slower than {route.get('name')}.")
		elif cost_difference < 0:
			tradeoffs.append(f"${abs(cost_difference):.2f} more expensive than {route.get('name')}.")

	return RouteRecommendation(
		recommended_route=winning_route,
		reason=f"{winning_route} is the deterministic winner for {optimization_mode.replace('_', ' ')} mode.",
		tradeoffs=tradeoffs[:5],
		source="deterministic_fallback",
	)