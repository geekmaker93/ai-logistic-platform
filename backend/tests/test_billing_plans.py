import unittest
from unittest.mock import patch

from main import get_subscription_plans


class BillingPlanTests(unittest.TestCase):
	def test_carrier_plan_uses_configured_stripe_price_id_and_new_amount(self) -> None:
		with patch("main.STRIPE_CARRIER_PRICE_ID", "price_1TiN2uDayLwbDNokjNffkZsi"):
			plans = get_subscription_plans()

		carrier_plan = next(plan for plan in plans if plan.role == "carrier")
		self.assertEqual(carrier_plan.price_usd, 49.99)
		self.assertEqual(carrier_plan.price_id, "price_1TiN2uDayLwbDNokjNffkZsi")

	def test_shipper_plan_is_unchanged(self) -> None:
		plans = get_subscription_plans()
		shipper_plan = next(plan for plan in plans if plan.role == "client")

		self.assertEqual(shipper_plan.price_usd, 25.00)


if __name__ == "__main__":
	unittest.main()
