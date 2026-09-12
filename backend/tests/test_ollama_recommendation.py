from __future__ import annotations

import json
import unittest
from unittest.mock import patch

from services.ollama_recommendation import generate_route_recommendation


class FakeOllamaResponse:
	def __init__(self, content: str) -> None:
		self._content = content

	def __enter__(self) -> "FakeOllamaResponse":
		return self

	def __exit__(self, *_args: object) -> None:
		return None

	def read(self) -> bytes:
		return json.dumps({"message": {"content": self._content}}).encode("utf-8")


class OllamaRecommendationTests(unittest.TestCase):
	def test_ollama_cannot_change_deterministic_route_winner(self) -> None:
		with patch(
			"services.ollama_recommendation.urlopen",
			return_value=FakeOllamaResponse(
				'{"recommended_route":"Faster Route","reason":"Low cost is preferred.","tradeoffs":["20 minutes longer."]}'
			),
		):
			recommendation = generate_route_recommendation("lowest_cost", "Fuel Saver Loop", route_data())

		self.assertEqual(recommendation.recommended_route, "Fuel Saver Loop")
		self.assertEqual(recommendation.reason, "Low cost is preferred.")
		self.assertEqual(recommendation.tradeoffs, ["20 minutes slower than Faster Route."])
		self.assertEqual(recommendation.source, "ollama")

	def test_unavailable_ollama_returns_factual_deterministic_fallback(self) -> None:
		with patch("services.ollama_recommendation.urlopen", side_effect=OSError("offline")):
			recommendation = generate_route_recommendation("lowest_cost", "Fuel Saver Loop", route_data())

		self.assertEqual(recommendation.recommended_route, "Fuel Saver Loop")
		self.assertEqual(recommendation.source, "deterministic_fallback")
		self.assertEqual(recommendation.tradeoffs, ["20 minutes slower than Faster Route."])


def route_data() -> list[dict[str, float | int | str]]:
	return [
		{"name": "Fuel Saver Loop", "cost": 547.41, "eta_minutes": 285},
		{"name": "Faster Route", "cost": 576.56, "eta_minutes": 265},
	]