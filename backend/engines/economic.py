from __future__ import annotations

from dataclasses import asdict, dataclass


KM_PER_MILE = 1.609344


@dataclass(frozen=True)
class EconomicInputs:
	distance_km: float
	estimated_hours: float
	fuel_liters: float
	toll_usd: float
	weather_risk: float
	traffic_delay_minutes: int
	fuel_price_usd_per_liter: float
	fuel_efficiency_kmpl: float = 4.8
	idle_fuel_lph: float = 2.5
	maintenance_cost_per_km_usd: float = 0.12
	driver_cost_per_hour_usd: float = 28.0
	toll_discount_pct: float = 0.0
	fuel_price_adjustment_pct: float = 0.0
	empty_mile_factor_pct: float = 10.0
	include_maintenance_cost: bool = False
	include_driver_time_cost: bool = False
	include_toll_cost: bool = False
	revenue_usd: float | None = None


@dataclass(frozen=True)
class EconomicBreakdown:
	fuel_cost_usd: float
	toll_cost_usd: float
	maintenance_cost_usd: float
	time_cost_usd: float
	weather_risk_cost_usd: float
	total_operating_cost_usd: float
	carrier_profit_cost_usd: float | None
	cost_per_km_usd: float
	cost_per_mile_usd: float
	projected_profit_usd: float | None
	projected_margin_pct: float | None

	def to_dict(self) -> dict[str, float | None]:
		return asdict(self)


def calculate_economic_breakdown(inputs: EconomicInputs) -> EconomicBreakdown:
	"""Return universal route costs plus optional carrier-specific profit costs."""
	has_carrier_economics = (
		inputs.include_maintenance_cost
		or inputs.include_driver_time_cost
		or inputs.include_toll_cost
	)
	operational_fuel_cost = inputs.fuel_liters * inputs.fuel_price_usd_per_liter
	operational_toll_cost = inputs.toll_usd
	operational_cost = operational_fuel_cost + operational_toll_cost
	fuel_efficiency_factor = 4.8 / max(0.1, inputs.fuel_efficiency_kmpl)
	empty_mile_factor = 1 + (inputs.empty_mile_factor_pct / 100)
	idle_fuel_liters = inputs.idle_fuel_lph * (max(0, inputs.traffic_delay_minutes) / 60)
	adjusted_fuel_liters = max(0.1, (inputs.fuel_liters * fuel_efficiency_factor * empty_mile_factor) + idle_fuel_liters)
	adjusted_fuel_price = inputs.fuel_price_usd_per_liter * (1 + (inputs.fuel_price_adjustment_pct / 100))
	fuel_cost = adjusted_fuel_liters * adjusted_fuel_price if has_carrier_economics else operational_fuel_cost
	toll_cost = inputs.toll_usd * (1 - (inputs.toll_discount_pct / 100)) if inputs.include_toll_cost else 0.0
	maintenance_cost = inputs.distance_km * inputs.maintenance_cost_per_km_usd if inputs.include_maintenance_cost else 0.0
	time_cost = inputs.estimated_hours * inputs.driver_cost_per_hour_usd if inputs.include_driver_time_cost else 0.0
	weather_risk_cost = (fuel_cost + toll_cost + maintenance_cost + time_cost) * max(0.0, min(1.0, inputs.weather_risk)) * 0.12
	carrier_profit_cost = fuel_cost + toll_cost + maintenance_cost + time_cost + weather_risk_cost if has_carrier_economics else None
	distance_km = max(0.1, inputs.distance_km)
	projected_profit = inputs.revenue_usd - carrier_profit_cost if inputs.revenue_usd is not None and carrier_profit_cost is not None else None
	projected_margin = (projected_profit / inputs.revenue_usd) * 100 if inputs.revenue_usd and projected_profit is not None else None

	return EconomicBreakdown(
		fuel_cost_usd=round(fuel_cost, 2),
		toll_cost_usd=round(toll_cost, 2),
		maintenance_cost_usd=round(maintenance_cost, 2),
		time_cost_usd=round(time_cost, 2),
		weather_risk_cost_usd=round(weather_risk_cost, 2),
		total_operating_cost_usd=round(operational_cost, 2),
		carrier_profit_cost_usd=round(carrier_profit_cost, 2) if carrier_profit_cost is not None else None,
		cost_per_km_usd=round(operational_cost / distance_km, 2),
		cost_per_mile_usd=round(operational_cost / (distance_km / KM_PER_MILE), 2),
		projected_profit_usd=round(projected_profit, 2) if projected_profit is not None else None,
		projected_margin_pct=round(projected_margin, 1) if projected_margin is not None else None,
	)