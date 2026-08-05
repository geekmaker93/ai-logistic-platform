"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { jsPDF } from "jspdf";
import {
  assignShipmentDriver,
  autocompleteAddress,
  AuthProfile,
  ActorContext,
  BillingPlan,
  BillingPaymentMethodStatus,
  BillingPayoutAccountStatus,
  BillingStatus,
  CarrierLiveTrackingItem,
  createPaymentMethodSetupSession,
  createPayoutOnboardingSession,
  createSubscriptionCheckoutSession,
  cancelSubscription,
  resumeSubscription,
  confirmCarrierShipmentPod,
  DriverDocumentRecord,
  CarrierDriverSummary,
  generateDriverLoginToken,
  getSubscriptionStatus,
  getUserProfile,
  regenerateDriverLoginToken,
  getRouteAnalysis,
  getPaymentMethodStatus,
  getPayoutAccountStatus,
  listCarrierDriverDocuments,
  listCarrierDrivers,
  listCarrierLiveTracking,
  listSubscriptionPlans,
  listShipments,
  modeOptions,
  optimizeRoute,
  rejectShipmentOffer,
  removePaymentMethod,
  resolveAddressPlace,
  refreshSubscriptionStatus,
  Shipment,
  statusLabel,
  type PaymentInstrumentType,
  updateShipmentStatus,
  updateUserProfile,
  submitCarrierOffer,
  type CarrierQuoteDetailsPayload,
  type AddressSuggestion,
  type RouteOption,
  type RouteAnalysis,
  validateUsStreetAddress,
} from "@/lib/logistics-api";
import { AuthLiteSession, clearAuthLiteSession, getAuthLiteSession, setAuthLiteSession } from "@/lib/auth-lite";
import { trackEvent } from "@/lib/telemetry";
import {
  loadDriverProfilesFromStorage,
  searchDriversNearZip,
  type DriverProfile,
} from "@/lib/driver-discovery";

const LiveTrackingMap = dynamic(() => import("@/app/components/live-tracking-map"), {
  ssr: false,
});

const LB_PER_KG = 2.20462262;
const DEFAULT_COUNTRY_CODE = "US";
const DEFAULT_DIESEL_PRICE_PER_LITER_USD = 1.2;
const BASELINE_FUEL_EFFICIENCY_KMPL = 4.8;
const US_STATE_CODES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
];

const truckTypeOptions = [
  { value: "dry_van", label: "Dry Van" },
  { value: "reefer", label: "Reefer" },
  { value: "flatbed", label: "Flatbed" },
  { value: "step_deck", label: "Step Deck" },
  { value: "power_only", label: "Power Only" },
  { value: "box_truck", label: "Box Truck" },
  { value: "tanker", label: "Tanker" },
  { value: "lowboy", label: "Lowboy" },
  { value: "hotshot", label: "Hotshot" },
] as const;

function ProfileIcon(props: Readonly<{ className?: string }>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={props.className ?? "h-5 w-5"} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 19c0-3.1 3.1-5 7-5s7 1.9 7 5" />
    </svg>
  );
}

function formatUsdCompact(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: amount >= 10000 ? "compact" : "standard",
    maximumFractionDigits: amount >= 10000 ? 1 : 0,
  }).format(amount);
}

function carrierShipmentStatusBadgeClass(status: Shipment["status"]): string {
  if (status === "delivered") {
    return "border border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (status === "active" || status === "in_transit") {
    return "border border-sky-200 bg-sky-50 text-sky-700";
  }
  if (status === "offered" || status === "awaiting_payment") {
    return "border border-amber-200 bg-amber-50 text-amber-700";
  }
  return "border border-slate-200 bg-slate-100 text-slate-700";
}

function buildCarrierActivityPath(values: number[]): string {
  const width = 320;
  const height = 120;
  const maxValue = Math.max(...values, 1);

  return values.map((value, index) => {
    const x = values.length === 1 ? width / 2 : (index / (values.length - 1)) * width;
    const y = height - (value / maxValue) * 88 - 12;
    return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
}

function buildMetricChartPath(values: number[], width = 280, height = 100): string {
  const maxValue = Math.max(...values, 1);
  const padding = 8;
  
  return values.map((value, index) => {
    const x = values.length === 1 ? width / 2 : (index / (values.length - 1)) * width;
    const y = height - padding - (value / maxValue) * (height - padding * 2);
    return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}

function formatTrendDelta(deltaPct: number): string {
  const arrow = deltaPct >= 0 ? "↑" : "↓";
  return `${arrow} ${Math.abs(deltaPct).toFixed(1)}% from last month`;
}

function trendToneClass(deltaPct: number): string {
  if (deltaPct >= 0) {
    return "border border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  return "border border-rose-200 bg-rose-50 text-rose-700";
}

function driverAvailabilityBadgeClass(availability: DriverProfile["availability"]): string {
  if (availability === "available") {
    return "border border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (availability === "busy") {
    return "border border-amber-200 bg-amber-50 text-amber-700";
  }
  return "border border-slate-200 bg-slate-100 text-slate-700";
}

function MetricSparkline(props: Readonly<{ values: number[]; stroke: string; fillId: string; label: string }>) {
  const { values, stroke, fillId, label } = props;
  const chartValues = values.length > 1 ? values : [0, ...values];
  const path = buildMetricChartPath(chartValues, 160, 48);

  return (
    <svg viewBox="0 0 160 48" className="h-12 w-40" role="img" aria-label={label}>
      <defs>
        <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.35" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={`${path} L160,48 L0,48 Z`} fill={`url(#${fillId})`} />
      <path d={path} fill="none" stroke={stroke} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CarrierStatCard(props: Readonly<{
  label: string;
  value: string | number;
  detail: string;
  accentClass: string;
  progressClass: string;
  progress: number;
}>) {
  const { label, value, detail, accentClass, progressClass, progress } = props;

  return (
    <div className="carrier-premium-card carrier-card-hover rounded-[28px] p-5">
      <div className="relative z-10">
        <div className={`inline-flex rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] ${accentClass}`}>
          {label}
        </div>
        <p className="mt-4 text-3xl font-semibold tracking-tight text-slate-950">{value}</p>
        <p className="mt-2 text-sm leading-6 text-slate-600">{detail}</p>
        <div className="mt-5 h-2 overflow-hidden rounded-full bg-slate-200/80">
          <div className={`h-full rounded-full ${progressClass}`} style={{ width: `${Math.max(10, Math.min(100, progress))}%` }} />
        </div>
      </div>
    </div>
  );
}

function CarrierActivityChart(props: Readonly<{
  labels: string[];
  values: number[];
}>) {
  const { labels, values } = props;
  const path = buildCarrierActivityPath(values);
  const maxValue = Math.max(...values, 1);

  return (
    <div className="relative overflow-hidden rounded-[28px] border border-white/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(236,253,245,0.82))] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]">
      <div className="carrier-grid-glow absolute inset-0 opacity-60" />
      <div className="relative z-10">
        <p className="text-xs font-semibold uppercase tracking-[0.26em] text-slate-500">Dispatch tempo</p>
        <div className="mt-4 rounded-[24px] bg-slate-950 px-4 py-4 text-white shadow-[0_18px_45px_rgba(15,23,42,0.28)]">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-[0.22em] text-emerald-200/80">Recent operations</p>
              <p className="mt-2 text-3xl font-semibold tracking-tight">{maxValue}</p>
            </div>
            <p className="max-w-[180px] text-right text-xs leading-5 text-slate-300">A compact signal for offer flow, execution, and delivered load momentum.</p>
          </div>
          <svg viewBox="0 0 320 120" className="mt-4 h-32 w-full" role="img" aria-label="Recent carrier activity chart">
            <defs>
              <linearGradient id="carrierActivityStroke" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#34d399" />
                <stop offset="100%" stopColor="#38bdf8" />
              </linearGradient>
            </defs>
            <path d={path} fill="none" stroke="url(#carrierActivityStroke)" strokeWidth="4" strokeLinecap="round" />
            {values.map((value, index) => {
              const x = values.length === 1 ? 160 : (index / (values.length - 1)) * 320;
              const y = 120 - (value / maxValue) * 88 - 12;
              return (
                <g key={`carrier-activity-point-${index}-${labels[index] ?? "label"}-${value}`}>
                  <circle cx={x} cy={y} r="5" fill="#0f172a" stroke="#34d399" strokeWidth="3" />
                </g>
              );
            })}
          </svg>
          <div className="mt-2 grid grid-cols-6 gap-2 text-[11px] uppercase tracking-[0.18em] text-slate-400">
            {labels.map((label, index) => (
              <span key={`carrier-activity-label-${index}-${label}`} className="truncate text-center">{label}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function openStripeHostedFlow(url: string): boolean {
  const popupWidth = 560;
  const popupHeight = 760;
  const left = Math.max(0, globalThis.window.screenX + Math.round((globalThis.window.outerWidth - popupWidth) / 2));
  const top = Math.max(0, globalThis.window.screenY + Math.round((globalThis.window.outerHeight - popupHeight) / 2));
  const features = `popup=yes,width=${popupWidth},height=${popupHeight},left=${left},top=${top},resizable=yes,scrollbars=yes`;
  const popup = globalThis.window.open(url, "stripe-hosted-flow", features);

  if (!popup) {
    globalThis.window.location.href = url;
    return false;
  }

  popup.focus();
  return true;
}

type CarrierQuoteDetailDraft = {
  mileage: string;
  urgency: "low" | "normal" | "high";
  urgency_surcharge_usd: string;
  distance_surcharge_usd: string;
  service_fee_usd: string;
  estimated_delivery_time: string;
  notes: string;
};

function createQuoteDetailDraft(shipment: Shipment, existing?: CarrierQuoteDetailDraft): CarrierQuoteDetailDraft {
  if (existing) {
    return existing;
  }

  return {
    mileage: "",
    urgency: shipment.urgency,
    urgency_surcharge_usd: "",
    distance_surcharge_usd: "",
    service_fee_usd: "",
    estimated_delivery_time: shipment.quote_breakdown?.estimated_delivery_time ?? "",
    notes: "",
  };
}

function toLbFromKg(weightKg: number): number {
  return Number((weightKg * LB_PER_KG).toFixed(0));
}

function formatRemainingDistance(distanceKm: number | null): string {
  if (distanceKm === null || distanceKm === undefined) {
    return "Pending";
  }
  return `${distanceKm.toFixed(1)} km`;
}

function weatherRiskTone(risk: number): string {
  if (risk < 0.25) {
    return "bg-emerald-100 text-emerald-800 ring-emerald-200";
  }
  if (risk < 0.5) {
    return "bg-amber-100 text-amber-800 ring-amber-200";
  }
  if (risk < 0.75) {
    return "bg-orange-100 text-orange-800 ring-orange-200";
  }
  return "bg-rose-100 text-rose-800 ring-rose-200";
}

function weatherRiskBarTone(risk: number): string {
  if (risk < 0.25) {
    return "bg-emerald-500";
  }
  if (risk < 0.5) {
    return "bg-amber-500";
  }
  if (risk < 0.75) {
    return "bg-orange-500";
  }
  return "bg-rose-500";
}

function weatherImpactContext(risk: number): { label: string; detail: string; impact: string } {
  const chanceText = `${Math.round(risk * 100)}%`;
  if (risk < 0.25) {
    return {
      label: "Low",
      detail: `Chance of weather disruption along route: ${chanceText}`,
      impact: "Expected impact: Minimal",
    };
  }
  if (risk < 0.5) {
    return {
      label: "Moderate",
      detail: `Chance of rain or slowdowns along route: ${chanceText}`,
      impact: "Expected impact: Minor delays possible",
    };
  }
  if (risk < 0.75) {
    return {
      label: "High",
      detail: `Elevated chance of adverse weather: ${chanceText}`,
      impact: "Expected impact: Potential schedule disruption",
    };
  }
  return {
    label: "Severe",
    detail: `Severe weather probability along route: ${chanceText}`,
    impact: "Expected impact: Major delays likely",
  };
}

type CarrierOperatingProfile = {
  fuel_efficiency_kmpl: number;
  idle_fuel_lph: number;
  maintenance_cost_per_km_usd: number;
  driver_cost_per_hour_usd: number;
  toll_discount_pct: number;
  fuel_price_adjustment_pct: number;
  empty_mile_factor_pct: number;
};

const DEFAULT_OPERATING_PROFILE: CarrierOperatingProfile = {
  fuel_efficiency_kmpl: 4.8,
  idle_fuel_lph: 2.5,
  maintenance_cost_per_km_usd: 0.12,
  driver_cost_per_hour_usd: 28,
  toll_discount_pct: 0,
  fuel_price_adjustment_pct: 0,
  empty_mile_factor_pct: 10,
};

function normalizeOperatingProfile(profile: Partial<CarrierOperatingProfile> | null | undefined): CarrierOperatingProfile {
  return {
    fuel_efficiency_kmpl: Math.min(30, Math.max(0.5, profile?.fuel_efficiency_kmpl ?? DEFAULT_OPERATING_PROFILE.fuel_efficiency_kmpl)),
    idle_fuel_lph: Math.min(20, Math.max(0, profile?.idle_fuel_lph ?? DEFAULT_OPERATING_PROFILE.idle_fuel_lph)),
    maintenance_cost_per_km_usd: Math.min(10, Math.max(0, profile?.maintenance_cost_per_km_usd ?? DEFAULT_OPERATING_PROFILE.maintenance_cost_per_km_usd)),
    driver_cost_per_hour_usd: Math.min(300, Math.max(0, profile?.driver_cost_per_hour_usd ?? DEFAULT_OPERATING_PROFILE.driver_cost_per_hour_usd)),
    toll_discount_pct: Math.min(100, Math.max(0, profile?.toll_discount_pct ?? DEFAULT_OPERATING_PROFILE.toll_discount_pct)),
    fuel_price_adjustment_pct: Math.min(200, Math.max(-100, profile?.fuel_price_adjustment_pct ?? DEFAULT_OPERATING_PROFILE.fuel_price_adjustment_pct)),
    empty_mile_factor_pct: Math.min(200, Math.max(0, profile?.empty_mile_factor_pct ?? DEFAULT_OPERATING_PROFILE.empty_mile_factor_pct)),
  };
}

function adjustedFuelLiters(route: RouteOption, profile: CarrierOperatingProfile): number {
  const efficiencyFactor = BASELINE_FUEL_EFFICIENCY_KMPL / Math.max(0.1, profile.fuel_efficiency_kmpl);
  const emptyMileFactor = 1 + (profile.empty_mile_factor_pct / 100);
  const idleBurnLiters = profile.idle_fuel_lph * (route.traffic_delay_minutes / 60);
  return Number(Math.max(0.1, (route.fuel_liters * efficiencyFactor * emptyMileFactor) + idleBurnLiters).toFixed(2));
}

function calculateFuelCostUsd(route: RouteOption, fuelPricePerLiterUsd: number, profile: CarrierOperatingProfile): number {
  const adjustedPrice = fuelPricePerLiterUsd * (1 + (profile.fuel_price_adjustment_pct / 100));
  return Number((adjustedFuelLiters(route, profile) * adjustedPrice).toFixed(2));
}

function calculateTotalRouteCostUsd(route: RouteOption, fuelPricePerLiterUsd: number, profile: CarrierOperatingProfile): number {
  const fuelCost = calculateFuelCostUsd(route, fuelPricePerLiterUsd, profile);
  const tollCost = Number((route.toll_usd * (1 - (profile.toll_discount_pct / 100))).toFixed(2));
  const maintenanceCost = Number((route.distance_km * profile.maintenance_cost_per_km_usd).toFixed(2));
  const driverCost = Number((route.estimated_hours * profile.driver_cost_per_hour_usd).toFixed(2));
  return Number((fuelCost + tollCost + maintenanceCost + driverCost).toFixed(2));
}

type RouteBenchmarks = {
  minEtaHours: number;
  minFuelLiters: number;
  minWeatherRisk: number;
  minOperationalCostUsd: number;
};

function buildRouteBenchmarks(routes: RouteOption[], fuelPricePerLiterUsd: number, profile: CarrierOperatingProfile): RouteBenchmarks {
  return {
    minEtaHours: Math.min(...routes.map((route) => route.estimated_hours)),
    minFuelLiters: Math.min(...routes.map((route) => adjustedFuelLiters(route, profile))),
    minWeatherRisk: Math.min(...routes.map((route) => route.weather_risk)),
    minOperationalCostUsd: Math.min(...routes.map((route) => calculateTotalRouteCostUsd(route, fuelPricePerLiterUsd, profile))),
  };
}

function calculateEfficiencyScore(route: RouteOption, benchmarks: RouteBenchmarks, fuelPricePerLiterUsd: number, profile: CarrierOperatingProfile): number {
  const etaScore = benchmarks.minEtaHours / Math.max(route.estimated_hours, 0.1);
  const fuelScore = benchmarks.minFuelLiters / Math.max(adjustedFuelLiters(route, profile), 0.1);
  const weatherScore = (1 - route.weather_risk) / Math.max(1 - benchmarks.minWeatherRisk, 0.01);
  const costScore = benchmarks.minOperationalCostUsd / Math.max(calculateTotalRouteCostUsd(route, fuelPricePerLiterUsd, profile), 0.1);
  const weightedScore = (etaScore * 0.35) + (fuelScore * 0.3) + (weatherScore * 0.2) + (costScore * 0.15);
  return Math.max(1, Math.min(100, Math.round(weightedScore * 100)));
}

function routeDecisionLabels(
  route: RouteOption,
  benchmarks: RouteBenchmarks,
  fuelPricePerLiterUsd: number,
  profile: CarrierOperatingProfile,
  isRecommended: boolean
): string[] {
  const labels: string[] = [];
  const operationalCost = calculateTotalRouteCostUsd(route, fuelPricePerLiterUsd, profile);

  if (isRecommended) {
    labels.push("Best Overall Route");
  }
  if (Math.abs(route.estimated_hours - benchmarks.minEtaHours) <= 0.05) {
    labels.push("Fastest");
  }
  if (Math.abs(adjustedFuelLiters(route, profile) - benchmarks.minFuelLiters) <= 0.5) {
    labels.push("Fuel Efficient");
  }
  if (Math.abs(route.weather_risk - benchmarks.minWeatherRisk) <= 0.03) {
    labels.push("Weather Safe");
  }
  if (Math.abs(operationalCost - benchmarks.minOperationalCostUsd) <= 0.75) {
    labels.push("Lowest Cost");
  }

  return labels.length > 0 ? labels : ["Balanced Alternative"];
}

function fuelPriceSourceLabel(source: RouteAnalysis["fuel_price_source"] | undefined): string {
  if (source === "eia_live") {
    return "EIA live";
  }
  return "Fallback baseline";
}

function routeIsNearDuplicate(base: RouteOption, candidate: RouteOption): boolean {
  const distanceDelta = Math.abs(base.distance_km - candidate.distance_km);
  const etaDelta = Math.abs(base.estimated_hours - candidate.estimated_hours);
  const fuelDelta = Math.abs(base.fuel_liters - candidate.fuel_liters);
  const tollDelta = Math.abs(base.toll_usd - candidate.toll_usd);
  const weatherDelta = Math.abs(base.weather_risk - candidate.weather_risk);

  return (
    distanceDelta <= 0.5
    && etaDelta <= 0.15
    && fuelDelta <= 0.5
    && tollDelta <= 0.75
    && weatherDelta <= 0.03
  );
}

function routeDifferenceSummary(reference: RouteOption, candidate: RouteOption): string {
  const minsDiff = Math.round((candidate.estimated_hours - reference.estimated_hours) * 60);
  const kmDiff = Number((candidate.distance_km - reference.distance_km).toFixed(1));
  const fuelDiff = Number((candidate.fuel_liters - reference.fuel_liters).toFixed(1));
  const tollDiff = Number((candidate.toll_usd - reference.toll_usd).toFixed(2));
  const weatherDiff = Math.round((candidate.weather_risk - reference.weather_risk) * 100);

  return `Compared with recommended: ETA ${minsDiff} min • Distance ${kmDiff} km • Fuel ${fuelDiff} L • Tolls $${tollDiff.toFixed(2)} • Weather ${weatherDiff}%`;
}

type DeliveryHealthSummary = {
  healthScore: number;
  healthStatus: string;
  etaMinutes: number;
  predictedArrivalLabel: string;
  arrivalConfidencePct: number;
  onTimeStatus: string;
  timeWindowLabel: string;
  trafficImpactLabel: string;
  currentDelayMinutes: number;
  congestionZone: string;
  weatherRiskLabel: string;
  weatherDelayRangeLabel: string;
  routeRiskLabel: string;
  trafficRiskLabel: string;
  weatherRiskText: string;
  roadClosureRiskLabel: string;
  constructionZones: number;
  estimatedFuelLiters: number;
  estimatedFuelCostUsd: number;
  totalOperatingCostUsd: number;
  cargoSensitivity: string;
  cargoRecommendation: string;
  aiRecommendationTitle: string;
  aiRecommendationBody: string;
};

function trafficImpactLabel(delayMinutes: number): string {
  if (delayMinutes <= 5) {
    return "Low";
  }
  if (delayMinutes <= 12) {
    return "Moderate";
  }
  if (delayMinutes <= 24) {
    return "High";
  }
  return "Severe";
}

function parseTimeWindowToMinutes(timeWindow: string | undefined): { start: number; end: number } | null {
  if (!timeWindow) {
    return null;
  }
  const matches = [...timeWindow.matchAll(/(\d{1,2}):(\d{2})\s*(AM|PM)/gi)];
  if (matches.length < 2) {
    return null;
  }
  const toMinutes = (hourText: string, minuteText: string, meridiem: string): number => {
    const hour12 = Number(hourText);
    const minute = Number(minuteText);
    const normalizedHour = meridiem.toUpperCase() === "PM"
      ? (hour12 % 12) + 12
      : (hour12 % 12);
    return (normalizedHour * 60) + minute;
  };

  const start = toMinutes(matches[0][1], matches[0][2], matches[0][3]);
  const end = toMinutes(matches[1][1], matches[1][2], matches[1][3]);
  return { start, end };
}

function cargoSuitability(cargoType: string, weatherRisk: number): { sensitivity: string; recommendation: string; score: number } {
  const normalized = cargoType.toLowerCase();
  if (normalized.includes("electronic") || normalized.includes("medical") || normalized.includes("pharma")) {
    const score = Math.max(40, 90 - Math.round(weatherRisk * 70));
    let recommendation = "Maintain dry and shock-controlled handling through destination handoff.";
    if (weatherRisk >= 0.5) {
      recommendation = "Avoid severe weather corridor and prioritize dry enclosed capacity.";
    }
    return {
      sensitivity: "High",
      recommendation,
      score,
    };
  }
  if (normalized.includes("food") || normalized.includes("perishable") || normalized.includes("produce")) {
    const score = Math.max(45, 92 - Math.round(weatherRisk * 60));
    return {
      sensitivity: "High",
      recommendation: "Protect temperature integrity and reduce dwell time at stops.",
      score,
    };
  }
  if (normalized.includes("hazmat") || normalized.includes("chemical")) {
    const score = Math.max(50, 90 - Math.round(weatherRisk * 50));
    return {
      sensitivity: "High",
      recommendation: "Use approved hazmat corridors and increase weather monitoring cadence.",
      score,
    };
  }
  if (normalized.includes("furniture") || normalized.includes("metal") || normalized.includes("construction")) {
    return {
      sensitivity: "Low",
      recommendation: "Standard handling is acceptable; monitor schedule variance only.",
      score: 92,
    };
  }
  let recommendation = "Standard handling with periodic route condition checks is sufficient.";
  if (weatherRisk >= 0.55) {
    recommendation = "Use weather-aware routing and minimize idle exposure at destination.";
  }
  return {
    sensitivity: "Moderate",
    recommendation,
    score: Math.max(55, 90 - Math.round(weatherRisk * 45)),
  };
}

function costScoreFromBenchmark(routeBenchmarks: RouteBenchmarks | null, totalOperatingCostUsd: number): number {
  if (!routeBenchmarks) {
    return 80;
  }
  return Math.max(55, Math.min(100, (routeBenchmarks.minOperationalCostUsd / Math.max(totalOperatingCostUsd, 1)) * 100));
}

function constructionZoneCount(delayMinutes: number): number {
  if (delayMinutes >= 22) {
    return 2;
  }
  if (delayMinutes >= 10) {
    return 1;
  }
  return 0;
}

function healthStatusFromScore(score: number): string {
  if (score >= 85) {
    return "Healthy";
  }
  if (score >= 70) {
    return "Watch";
  }
  return "At Risk";
}

function routeRiskLabelFromComposite(routeRiskComposite: number): string {
  if (routeRiskComposite < 30) {
    return "Low";
  }
  if (routeRiskComposite < 55) {
    return "Moderate";
  }
  if (routeRiskComposite < 75) {
    return "High";
  }
  return "Severe";
}

function weatherDelayRange(weatherRisk: number): string {
  if (weatherRisk >= 0.55) {
    return "Potential delay: 10-20 min";
  }
  if (weatherRisk >= 0.3) {
    return "Potential delay: 5-15 min";
  }
  return "Potential delay: 0-5 min";
}

function onTimeStatusFromPrediction(predictedMinutesOfDay: number, parsedWindow: { start: number; end: number } | null): string {
  if (!parsedWindow) {
    return "On Schedule";
  }
  if (predictedMinutesOfDay > parsedWindow.end + 20) {
    return "At Risk";
  }
  if (predictedMinutesOfDay < parsedWindow.start - 30) {
    return "Early Arrival";
  }
  return "On Schedule";
}

function arrivalConfidence(recommendedRoute: RouteOption, delayMinutes: number, alternativeCount: number): number {
  const score = 96 - (recommendedRoute.weather_risk * 25) - (delayMinutes * 0.9) + Math.min(8, alternativeCount * 2);
  return Math.max(45, Math.min(99, Math.round(score)));
}

function aiRecommendationForRoute(recommendedRoute: RouteOption, alternativeRoutes: RouteOption[]): { title: string; body: string } {
  const bestFasterAlternative = alternativeRoutes
    .filter((route) => route.estimated_hours < recommendedRoute.estimated_hours)
    .sort((a, b) => a.estimated_hours - b.estimated_hours)[0];
  let potentialSavingsMinutes = 0;
  if (bestFasterAlternative) {
    potentialSavingsMinutes = Math.max(0, Math.round((recommendedRoute.estimated_hours - bestFasterAlternative.estimated_hours) * 60));
  }

  if (potentialSavingsMinutes >= 10) {
    return {
      title: "Alternative route available with time savings.",
      body: `Traffic congestion has increased. Switching to ${bestFasterAlternative?.name ?? "an alternate route"} can save approximately ${potentialSavingsMinutes} minutes.`,
    };
  }
  if (recommendedRoute.weather_risk >= 0.55) {
    return {
      title: "Weather volatility rising near destination.",
      body: "Keep current route, tighten ETA communications, and monitor the final corridor for developing conditions.",
    };
  }
  return {
    title: "Current route remains optimal.",
    body: "No rerouting required at this time. Monitor traffic and weather in the next 20 minutes.",
  };
}

function buildDeliveryHealthSummary(params: {
  recommendedRoute: RouteOption;
  alternativeRoutes: RouteOption[];
  shipment: Shipment;
  fuelPricePerLiterUsd: number;
  operatingProfile: CarrierOperatingProfile;
  routeBenchmarks: RouteBenchmarks | null;
}): DeliveryHealthSummary {
  const {
    recommendedRoute,
    alternativeRoutes,
    shipment,
    fuelPricePerLiterUsd,
    operatingProfile,
    routeBenchmarks,
  } = params;

  const etaMinutes = Math.max(1, Math.round(recommendedRoute.estimated_hours * 60));
  const predictedArrivalDate = new Date(Date.now() + (etaMinutes * 60 * 1000));
  const predictedArrivalLabel = predictedArrivalDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const currentDelayMinutes = Math.max(0, Math.round(recommendedRoute.traffic_delay_minutes));
  const trafficImpact = trafficImpactLabel(currentDelayMinutes);
  const weatherRiskPct = Math.round(recommendedRoute.weather_risk * 100);
  const weatherRiskLabel = weatherImpactContext(recommendedRoute.weather_risk).label;
  const parsedWindow = parseTimeWindowToMinutes(shipment.time_window);
  const predictedMinutesOfDay = (predictedArrivalDate.getHours() * 60) + predictedArrivalDate.getMinutes();

  const arrivalConfidencePct = arrivalConfidence(recommendedRoute, currentDelayMinutes, alternativeRoutes.length);
  const onTimeStatus = onTimeStatusFromPrediction(predictedMinutesOfDay, parsedWindow);

  const estimatedFuelLiters = adjustedFuelLiters(recommendedRoute, operatingProfile);
  const estimatedFuelCostUsd = calculateFuelCostUsd(recommendedRoute, fuelPricePerLiterUsd, operatingProfile);
  const totalOperatingCostUsd = calculateTotalRouteCostUsd(recommendedRoute, fuelPricePerLiterUsd, operatingProfile);
  const congestionZone = recommendedRoute.name;
  const constructionZones = constructionZoneCount(currentDelayMinutes);
  let roadClosureRiskLabel = "None";
  if (currentDelayMinutes >= 30) {
    roadClosureRiskLabel = "Possible";
  }
  const cargo = cargoSuitability(shipment.cargo_type, recommendedRoute.weather_risk);

  const trafficScore = Math.max(40, 100 - (currentDelayMinutes * 2.2));
  const weatherScore = Math.max(35, 100 - (recommendedRoute.weather_risk * 100));
  const onTimeScore = arrivalConfidencePct;
  const costScore = costScoreFromBenchmark(routeBenchmarks, totalOperatingCostUsd);
  const healthScore = Math.round(
    (trafficScore * 0.24)
    + (weatherScore * 0.24)
    + (onTimeScore * 0.24)
    + (costScore * 0.14)
    + (cargo.score * 0.14)
  );

  const aiRecommendation = aiRecommendationForRoute(recommendedRoute, alternativeRoutes);
  const healthStatus = healthStatusFromScore(healthScore);
  const routeRiskComposite = Math.round((currentDelayMinutes * 1.6) + (recommendedRoute.weather_risk * 55));
  const routeRiskLabel = routeRiskLabelFromComposite(routeRiskComposite);
  let timeWindowLabel = "Not provided";
  if (shipment.time_window) {
    timeWindowLabel = shipment.time_window;
  }

  return {
    healthScore,
    healthStatus,
    etaMinutes,
    predictedArrivalLabel,
    arrivalConfidencePct,
    onTimeStatus,
    timeWindowLabel,
    trafficImpactLabel: trafficImpact,
    currentDelayMinutes,
    congestionZone,
    weatherRiskLabel,
    weatherDelayRangeLabel: weatherDelayRange(recommendedRoute.weather_risk),
    routeRiskLabel,
    trafficRiskLabel: trafficImpact,
    weatherRiskText: `${weatherRiskPct}% weather disruption probability`,
    roadClosureRiskLabel,
    constructionZones,
    estimatedFuelLiters,
    estimatedFuelCostUsd,
    totalOperatingCostUsd,
    cargoSensitivity: cargo.sensitivity,
    cargoRecommendation: cargo.recommendation,
    aiRecommendationTitle: aiRecommendation.title,
    aiRecommendationBody: aiRecommendation.body,
  };
}

function downloadPdfDocument(fileName: string, content: string): void {
  const pdf = new jsPDF({ unit: "pt", format: "a4" });
  const margin = 40;
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const maxLineWidth = pageWidth - margin * 2;
  const lineHeight = 14;

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(11);

  const lines = pdf.splitTextToSize(content, maxLineWidth);
  let y = margin;

  for (const line of lines) {
    if (y > pageHeight - margin) {
      pdf.addPage();
      y = margin;
    }
    pdf.text(line, margin, y);
    y += lineHeight;
  }

  pdf.save(fileName);
}

function parseStreetCityStateZip(address: string | null | undefined): {
  street: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
} {
  const raw = (address || "").trim();
  if (!raw) {
    return { street: "", city: "", state: "", postalCode: "", country: DEFAULT_COUNTRY_CODE };
  }

  const countryRegex = /^(US|USA|United States|United States of America)$/i;
  const stateZipRegex = /^([A-Za-z]{2})\s*(\d{5}(?:-\d{4})?)?$/;
  const parts = raw.split(",").map((item) => item.trim()).filter(Boolean);
  let country = DEFAULT_COUNTRY_CODE;

  if (parts.length > 0 && countryRegex.test(parts.at(-1) ?? "")) {
    parts.pop();
    country = DEFAULT_COUNTRY_CODE;
  }

  const stateZipIndex = parts.findLastIndex((item) => stateZipRegex.test(item));
  const stateZipMatch = stateZipIndex >= 0 ? stateZipRegex.exec(parts[stateZipIndex]) : null;

  const city = stateZipIndex > 0 ? parts[stateZipIndex - 1] : "";
  const street = stateZipIndex > 1 ? parts.slice(0, stateZipIndex - 1).join(", ") : "";

  if (!stateZipMatch) {
    return { street, city, state: "", postalCode: "", country };
  }

  return {
    street,
    city,
    state: stateZipMatch[1]?.toUpperCase() || "",
    postalCode: stateZipMatch[2] || "",
    country,
  };
}

function formatStreetCityStateZip(street: string, city: string, state: string, postalCode: string, country: string): string {
  const normalizedStreet = street.trim();
  const normalizedCity = city.trim();
  const normalizedState = state.trim().toUpperCase();
  const normalizedPostalCode = postalCode.trim();
  const normalizedCountry = (country.trim().toUpperCase() || DEFAULT_COUNTRY_CODE);
  const stateAndZip = [normalizedState, normalizedPostalCode].filter(Boolean).join(" ").trim();
  return [normalizedStreet, normalizedCity, stateAndZip, normalizedCountry].filter(Boolean).join(", ");
}

function parseCitySuggestionDescription(description: string): {
  city: string;
  state: string;
  country: string;
} {
  const parts = description.split(",").map((item) => item.trim()).filter(Boolean);
  const city = parts.at(0) || "";
  const stateRaw = parts.at(1) || "";
  const stateMatch = /^([A-Za-z]{2})\b/.exec(stateRaw);
  const countryRaw = parts.at(-1) || "";
  const country = /^(US|USA|United States|United States of America)$/i.test(countryRaw)
    ? DEFAULT_COUNTRY_CODE
    : (countryRaw.toUpperCase() || DEFAULT_COUNTRY_CODE);

  return {
    city,
    state: stateMatch?.[1]?.toUpperCase() || "",
    country,
  };
}

export default function CarrierPortalPage() {
  const router = useRouter();
  const [session, setSession] = useState<AuthLiteSession | null>(null);
  const [ready, setReady] = useState(false);
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [selectedInvoice, setSelectedInvoice] = useState<{
    invoiceNum: string;
    transactionRef: string;
    paymentDate: string;
    shipment: Shipment;
  } | null>(null);
  const [profile, setProfile] = useState<AuthProfile | null>(null);
  const [profileSaving, setProfileSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<"dashboard" | "metrics" | "tracking" | "queue" | "optimization" | "payments" | "transactions" | "documents" | "drivers" | "profile" | "subscription">("dashboard");
  const [subscriptionPlans, setSubscriptionPlans] = useState<BillingPlan[]>([]);
  const [subscriptionStatus, setSubscriptionStatus] = useState<BillingStatus | null>(null);
  const [subscriptionNotice, setSubscriptionNotice] = useState<string | null>(null);
  const [paymentMethodStatus, setPaymentMethodStatus] = useState<BillingPaymentMethodStatus | null>(null);
  const [payoutAccountStatus, setPayoutAccountStatus] = useState<BillingPayoutAccountStatus | null>(null);
  const [subscriptionLoading, setSubscriptionLoading] = useState(false);
  const [subscriptionActionLoading, setSubscriptionActionLoading] = useState<"pause" | "cancel" | null>(null);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [walletSetupLoading, setWalletSetupLoading] = useState<PaymentInstrumentType | null>(null);
  const [walletRemoveLoading, setWalletRemoveLoading] = useState(false);
  const [connectSetupLoading, setConnectSetupLoading] = useState(false);
  const [optimizationShipmentId, setOptimizationShipmentId] = useState<string>("");
  const [optimizationMode, setOptimizationMode] = useState<(typeof modeOptions)[number]["value"]>("lowest_cost");
  const [routeAnalysis, setRouteAnalysis] = useState<RouteAnalysis | null>(null);
  const [routeAnalysisLoading, setRouteAnalysisLoading] = useState(false);
  const [showAlternativeRoutes, setShowAlternativeRoutes] = useState(false);
  const [selectedRouteName, setSelectedRouteName] = useState<string>("");
  const [carrierDrivers, setCarrierDrivers] = useState<CarrierDriverSummary[]>([]);
  const [driverDocuments, setDriverDocuments] = useState<DriverDocumentRecord[]>([]);
  const [driverOpsLoading, setDriverOpsLoading] = useState(false);
  const [latestGeneratedDriverToken, setLatestGeneratedDriverToken] = useState<string>("");
  const [driverDiscoveryZip, setDriverDiscoveryZip] = useState("10001");
  const [driverDiscoveryRadius, setDriverDiscoveryRadius] = useState(150);
  const [driverDiscoveryResults, setDriverDiscoveryResults] = useState<DriverProfile[]>(() => searchDriversNearZip("10001", 150, loadDriverProfilesFromStorage()));
  const [selectedDiscoveryDriver, setSelectedDiscoveryDriver] = useState<DriverProfile | null>(() => {
    const initialMatches = searchDriversNearZip("10001", 150, loadDriverProfilesFromStorage());
    return initialMatches[0] ?? null;
  });
  const [driverDiscoveryLoading, setDriverDiscoveryLoading] = useState(false);
  const [liveTrackingRows, setLiveTrackingRows] = useState<CarrierLiveTrackingItem[]>([]);
  const [selectedTrackingShipmentId, setSelectedTrackingShipmentId] = useState<string>("");
  const [liveTrackingLoading, setLiveTrackingLoading] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [driverForm, setDriverForm] = useState({
    driver_name: "",
    driver_mobile: "",
  });
  const [driverAssignmentByShipment, setDriverAssignmentByShipment] = useState<Record<string, string>>({});
  const [confirmPodLoadingId, setConfirmPodLoadingId] = useState<string | null>(null);
  const [offerAmountByShipment, setOfferAmountByShipment] = useState<Record<string, string>>({});
  const [quoteDetailsOpenByShipment, setQuoteDetailsOpenByShipment] = useState<Record<string, boolean>>({});
  const [quoteDetailsByShipment, setQuoteDetailsByShipment] = useState<Record<string, CarrierQuoteDetailDraft>>({});
  const [profileForm, setProfileForm] = useState({
    full_name: "",
    company_name: "",
    phone: "",
    street: "",
    city: "",
    state: "",
    postal_code: "",
    country: DEFAULT_COUNTRY_CODE,
    bio: "",
    tax_id: "",
    dot_number: "",
    available_trucks: "1",
    service_regions: [] as string[],
    service_region_state: "",
    service_region_country: "US",
    vehicle_types: ["dry_van"] as string[],
    max_weight_kg: "20000",
    fuel_efficiency_kmpl: "4.8",
    idle_fuel_lph: "2.5",
    maintenance_cost_per_km_usd: "0.12",
    driver_cost_per_hour_usd: "28",
    toll_discount_pct: "0",
    fuel_price_adjustment_pct: "0",
    empty_mile_factor_pct: "10",
  });
  const [streetSuggestions, setStreetSuggestions] = useState<AddressSuggestion[]>([]);
  const [streetPlaceId, setStreetPlaceId] = useState<string | null>(null);
  const [streetLoading, setStreetLoading] = useState(false);
  const [streetOpen, setStreetOpen] = useState(false);
  const [citySuggestions, setCitySuggestions] = useState<AddressSuggestion[]>([]);
  const [cityPlaceId, setCityPlaceId] = useState<string | null>(null);
  const [cityLoading, setCityLoading] = useState(false);
  const [cityOpen, setCityOpen] = useState(false);
  const streetInputWrapRef = useRef<HTMLDivElement | null>(null);
  const cityInputWrapRef = useRef<HTMLDivElement | null>(null);
  const accountMenuRef = useRef<HTMLDivElement | null>(null);
  const alternativesResetKeyRef = useRef<string>("");
  const isSubscriptionActive = subscriptionStatus?.subscription_active ?? Boolean(session?.subscriptionActive);

  useEffect(() => {
    const nextSession = getAuthLiteSession("carrier");
    if (nextSession?.role !== "carrier") {
      setReady(true);
      return;
    }
    setSession(nextSession);
    setReady(true);
  }, []);

  useEffect(() => {
    function handleDocumentClick(event: MouseEvent) {
      if (!accountMenuRef.current || accountMenuRef.current.contains(event.target as Node)) {
        return;
      }
      setAccountMenuOpen(false);
    }

    globalThis.document.addEventListener("click", handleDocumentClick);
    return () => globalThis.document.removeEventListener("click", handleDocumentClick);
  }, []);

  useEffect(() => {
    if (!ready || !session) {
      return;
    }

    const requestedAccountTab = new URLSearchParams(globalThis.window.location.search).get("account");
    if (requestedAccountTab === "profile" || requestedAccountTab === "subscription") {
      setActiveTab(requestedAccountTab);
      router.replace(globalThis.window.location.pathname);
    }
  }, [ready, session]);

  const loadShipments = useCallback(async () => {
    if (!session) {
      return;
    }

    setLoading(true);
    try {
      const actor: ActorContext = { role: "carrier", displayName: session.displayName };
      const data = await listShipments(actor);
      setShipments(data);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to load shipments.");
    } finally {
      setLoading(false);
    }
  }, [session]);

  function handleSearchNearbyDrivers() {
    const zipCode = driverDiscoveryZip.trim();
    if (!zipCode) {
      setMessage("Enter a ZIP code to find nearby drivers.");
      return;
    }

    setDriverDiscoveryLoading(true);
    try {
      const nextResults = searchDriversNearZip(zipCode, driverDiscoveryRadius, loadDriverProfilesFromStorage());
      setDriverDiscoveryResults(nextResults);
      setSelectedDiscoveryDriver(nextResults[0] ?? null);
      setMessage(`Found ${nextResults.length} nearby driver${nextResults.length === 1 ? "" : "s"}.`);
    } finally {
      setDriverDiscoveryLoading(false);
    }
  }

  const loadDriverData = useCallback(async (email: string) => {
    setDriverOpsLoading(true);
    try {
      const [drivers, docs] = await Promise.all([
        listCarrierDrivers(email, "carrier"),
        listCarrierDriverDocuments(email, "carrier"),
      ]);
      setCarrierDrivers(drivers);
      setDriverDocuments(docs);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to load driver access data.");
    } finally {
      setDriverOpsLoading(false);
    }
  }, []);

  const loadLiveTracking = useCallback(async (email: string) => {
    setLiveTrackingLoading(true);
    try {
      const rows = await listCarrierLiveTracking(email, "carrier");
      setLiveTrackingRows(rows);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to load live tracking.");
    } finally {
      setLiveTrackingLoading(false);
    }
  }, []);

  const loadSubscriptionState = useCallback(async (refresh = false) => {
    if (!session?.email) {
      return;
    }

    setSubscriptionLoading(true);
    setSubscriptionNotice(null);
    try {
      const [plans, status] = await Promise.all([
        listSubscriptionPlans(),
        refresh ? refreshSubscriptionStatus(session.email, "carrier") : getSubscriptionStatus(session.email, "carrier"),
      ]);
      setSubscriptionPlans(plans);
      setSubscriptionStatus(status);

      // Keep subscription checks fast; wallet and payout state can load in the background.
      void Promise.all([
        getPaymentMethodStatus(session.email, "carrier"),
        getPayoutAccountStatus(session.email),
      ])
        .then(([walletStatus, payoutStatus]) => {
          setPaymentMethodStatus(walletStatus);
          setPayoutAccountStatus(payoutStatus);
        })
        .catch(() => {
          // Ignore wallet/payout fetch failures here to avoid blocking subscription access.
        });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Failed to load subscription status.";
      if (errorMessage === "Account not found.") {
        setSubscriptionNotice("This email is not linked to a carrier account yet. Sign out and sign back in, or have an admin create the carrier record.");
      } else {
        setMessage(errorMessage);
      }
    } finally {
      setSubscriptionLoading(false);
    }
  }, [session]);

  const startSubscriptionCheckout = useCallback(async () => {
    if (!session?.email || checkoutLoading) {
      return;
    }

    setCheckoutLoading(true);
    try {
      const origin = globalThis.window.location.origin;
      const response = await createSubscriptionCheckoutSession(session.email, "carrier", {
        success_url: `${origin}/carrier?billing=success`,
        cancel_url: `${origin}/carrier?billing=cancel`,
      });
      const openedPopup = openStripeHostedFlow(response.checkout_url);
      setCheckoutLoading(false);
      if (openedPopup) {
        setMessage("Stripe checkout opened in a popup. Complete payment there, then return and click Refresh Status.");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to start checkout.");
      setCheckoutLoading(false);
    }
  }, [checkoutLoading, session]);

  const cancelCarrierSubscription = useCallback(async () => {
    if (!session?.email || subscriptionActionLoading) {
      return;
    }

    const periodEnd = subscriptionStatus?.subscription_current_period_end
      ? new Date(subscriptionStatus.subscription_current_period_end).toLocaleDateString()
      : "the end of your billing period";

    const shouldCancel = globalThis.window.confirm(
      `Cancel subscription? You will keep full access until ${periodEnd}, then it will not renew.`
    );
    if (!shouldCancel) {
      return;
    }

    setSubscriptionActionLoading("cancel");
    try {
      const status = await cancelSubscription(session.email, "carrier");
      setSubscriptionStatus(status);
      const accessUntil = status.subscription_current_period_end
        ? new Date(status.subscription_current_period_end).toLocaleDateString()
        : "the end of your billing period";
      setMessage(`Subscription canceled. You have full access until ${accessUntil}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to cancel subscription.");
    } finally {
      setSubscriptionActionLoading(null);
    }
  }, [session, subscriptionActionLoading, subscriptionStatus]);

  const resumeCarrierSubscription = useCallback(async () => {
    if (!session?.email || subscriptionActionLoading) {
      return;
    }

    setSubscriptionActionLoading("pause");
    try {
      const status = await resumeSubscription(session.email, "carrier");
      setSubscriptionStatus(status);
      setMessage("Subscription resumed. It will auto-renew as normal.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to resume subscription.");
    } finally {
      setSubscriptionActionLoading(null);
    }
  }, [session, subscriptionActionLoading]);

  const startWalletSetup = useCallback(async (instrumentType: PaymentInstrumentType) => {
    if (!session?.email || walletSetupLoading) {
      return;
    }

    setWalletSetupLoading(instrumentType);
    setMessage("");
    try {
      const origin = globalThis.window.location.origin;
      const response = await createPaymentMethodSetupSession(session.email, "carrier", {
        instrument_type: instrumentType,
        success_url: `${origin}/carrier?wallet=setup-success&instrument=${instrumentType}`,
        cancel_url: `${origin}/carrier?wallet=setup-cancel&instrument=${instrumentType}`,
      });
      const openedPopup = openStripeHostedFlow(response.checkout_url);
      setWalletSetupLoading(null);
      if (openedPopup) {
        setMessage("Stripe wallet setup opened in a popup. Complete it there, then return and refresh status.");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to open Stripe wallet setup.");
      setWalletSetupLoading(null);
    }
  }, [session, walletSetupLoading]);

  const removeLinkedCard = useCallback(async () => {
    if (!session?.email || walletRemoveLoading) {
      return;
    }

    setWalletRemoveLoading(true);
    setMessage("");
    try {
      const nextStatus = await removePaymentMethod(session.email, "carrier", { instrument_type: "card" });
      setPaymentMethodStatus(nextStatus);
      setMessage("Linked card removed from your profile wallet.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to remove linked card.");
    } finally {
      setWalletRemoveLoading(false);
    }
  }, [session, walletRemoveLoading]);

  const startPayoutOnboarding = useCallback(async () => {
    if (!session?.email || connectSetupLoading) {
      return;
    }

    setConnectSetupLoading(true);
    setMessage("");
    try {
      const origin = globalThis.window.location.origin;
      const response = await createPayoutOnboardingSession(session.email, {
        return_url: `${origin}/carrier?wallet=connect-success`,
        refresh_url: `${origin}/carrier?wallet=connect-refresh`,
      });
      const openedPopup = openStripeHostedFlow(response.checkout_url);
      setConnectSetupLoading(false);
      if (openedPopup) {
        setMessage("Stripe payout onboarding opened in a popup. Complete it there, then return and refresh status.");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to start payout onboarding.");
      setConnectSetupLoading(false);
    }
  }, [session, connectSetupLoading]);

  async function onGenerateDriverToken() {
    if (!session?.email) {
      setMessage("Session missing. Please sign in again.");
      return;
    }

    setMessage("");
    try {
      const response = await generateDriverLoginToken(
        session.email,
        {
          driver_name: driverForm.driver_name,
          driver_mobile: driverForm.driver_mobile,
        },
        "carrier"
      );
      setLatestGeneratedDriverToken(response.login_token);
      setMessage(`Driver token generated for ${response.driver.driver_name}. Share it securely with the driver.`);
      await loadDriverData(session.email);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to generate driver login token.");
    }
  }

  async function onRegenerateSelectedDriverToken(driverId: string) {
    if (!session?.email) {
      setMessage("Session missing. Please sign in again.");
      return;
    }

    setMessage("");
    try {
      const response = await regenerateDriverLoginToken(session.email, driverId, "carrier");
      setLatestGeneratedDriverToken(response.login_token);
      setDriverForm({
        driver_name: response.driver.driver_name,
        driver_mobile: response.driver.driver_mobile,
      });
      setMessage(`New token generated for ${response.driver.driver_name}. Share it securely with the driver.`);
      await loadDriverData(session.email);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to regenerate driver token.");
    }
  }

  useEffect(() => {
    if (!ready || !session || !isSubscriptionActive) {
      return;
    }

    void loadShipments();

    const timer = setInterval(() => {
      void loadShipments();
    }, 15000);

    return () => {
      clearInterval(timer);
    };
  }, [ready, session, isSubscriptionActive, loadShipments]);

  useEffect(() => {
    if (!ready || !session?.email) {
      return;
    }

    const sessionEmail = session.email;

    void (async () => {
      try {
        const data = await getUserProfile(sessionEmail, "carrier");
        const parsedAddress = parseStreetCityStateZip(data.address);
        setProfile(data);
        setProfileForm({
          full_name: data.full_name,
          company_name: data.company_name,
          phone: data.phone || "",
          street: parsedAddress.street,
          city: parsedAddress.city,
          state: parsedAddress.state,
          postal_code: parsedAddress.postalCode,
          country: parsedAddress.country,
          bio: data.bio || "",
          tax_id: data.tax_id || "",
          dot_number: data.dot_number || "",
          available_trucks: String(data.carrier_profile?.available_trucks ?? 1),
          service_regions: data.carrier_profile?.service_regions || [],
          service_region_state: "",
          service_region_country: "US",
          vehicle_types: data.carrier_profile?.vehicle_types?.length
            ? data.carrier_profile.vehicle_types
            : ["dry_van"],
          max_weight_kg: String(data.carrier_profile?.max_weight_kg ?? 20000),
          fuel_efficiency_kmpl: String(data.carrier_profile?.fuel_efficiency_kmpl ?? DEFAULT_OPERATING_PROFILE.fuel_efficiency_kmpl),
          idle_fuel_lph: String(data.carrier_profile?.idle_fuel_lph ?? DEFAULT_OPERATING_PROFILE.idle_fuel_lph),
          maintenance_cost_per_km_usd: String(data.carrier_profile?.maintenance_cost_per_km_usd ?? DEFAULT_OPERATING_PROFILE.maintenance_cost_per_km_usd),
          driver_cost_per_hour_usd: String(data.carrier_profile?.driver_cost_per_hour_usd ?? DEFAULT_OPERATING_PROFILE.driver_cost_per_hour_usd),
          toll_discount_pct: String(data.carrier_profile?.toll_discount_pct ?? DEFAULT_OPERATING_PROFILE.toll_discount_pct),
          fuel_price_adjustment_pct: String(data.carrier_profile?.fuel_price_adjustment_pct ?? DEFAULT_OPERATING_PROFILE.fuel_price_adjustment_pct),
          empty_mile_factor_pct: String(data.carrier_profile?.empty_mile_factor_pct ?? DEFAULT_OPERATING_PROFILE.empty_mile_factor_pct),
        });
        setStreetPlaceId(null);
        setStreetSuggestions([]);
        setStreetOpen(false);
        setCityPlaceId(null);
        setCitySuggestions([]);
        setCityOpen(false);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Failed to load carrier profile.");
      }
    })();
  }, [ready, session]);

  useEffect(() => {
    if (!ready || !session?.email) {
      return;
    }

    const params = new URLSearchParams(globalThis.window.location.search);
    const billingState = params.get("billing");
    const walletState = params.get("wallet");
    const walletInstrument = params.get("instrument");
    const shouldRefresh = billingState === "success";
    if (billingState === "success") {
      setMessage("Subscription payment received. Refreshing your access...");
    } else if (billingState === "cancel") {
      setMessage("Subscription checkout canceled.");
    }

    if (walletState === "setup-success") {
      const instrumentLabel = walletInstrument === "bank_account" ? "bank account" : "card";
      setMessage(`Stripe ${instrumentLabel} linked.`);
      setWalletSetupLoading(null);
    } else if (walletState === "setup-cancel") {
      setMessage("Stripe wallet setup canceled.");
      setWalletSetupLoading(null);
    } else if (walletState === "connect-success") {
      setMessage("Stripe payout account linked.");
      setConnectSetupLoading(false);
    } else if (walletState === "connect-refresh") {
      setMessage("Stripe payout onboarding was refreshed. Continue onboarding to finish setup.");
      setConnectSetupLoading(false);
    }

    if (billingState || walletState) {
      params.delete("billing");
      params.delete("wallet");
      params.delete("instrument");
      const nextQuery = params.toString();
      const normalizedNextUrl = nextQuery
        ? `${globalThis.window.location.pathname}?${nextQuery}`
        : globalThis.window.location.pathname;
      globalThis.window.history.replaceState({}, "", normalizedNextUrl);
    }

    void loadSubscriptionState(shouldRefresh);
  }, [ready, session, loadSubscriptionState]);

  useEffect(() => {
    const street = profileForm.street.trim();
    if (street.length < 3) {
      setStreetSuggestions([]);
      setStreetLoading(false);
      return;
    }

    const queryWithContext = [street, profileForm.city.trim(), profileForm.state.trim()]
      .filter(Boolean)
      .join(", ");

    const kickoff = setTimeout(() => {
      void (async () => {
        setStreetLoading(true);
        try {
          let results = await autocompleteAddress(queryWithContext, 6, "address");
          if (results.length === 0 && queryWithContext.toLowerCase() !== street.toLowerCase()) {
            results = await autocompleteAddress(street, 6, "address");
          }
          setStreetSuggestions(results);
          setStreetOpen(results.length > 0);
        } catch (error) {
          setStreetSuggestions([]);
          setStreetOpen(false);
          setMessage(error instanceof Error ? error.message : "Failed to load address suggestions.");
        } finally {
          setStreetLoading(false);
        }
      })();
    }, 220);

    return () => clearTimeout(kickoff);
  }, [profileForm.street, profileForm.city, profileForm.state]);

  useEffect(() => {
    const query = profileForm.city.trim();
    if (query.length < 3) {
      setCitySuggestions([]);
      setCityLoading(false);
      return;
    }

    const kickoff = setTimeout(() => {
      void (async () => {
        setCityLoading(true);
        try {
          const results = await autocompleteAddress(query, 6, "city");
          setCitySuggestions(results);
          setCityOpen(results.length > 0);
        } catch (error) {
          setCitySuggestions([]);
          setCityOpen(false);
          setMessage(error instanceof Error ? error.message : "Failed to load city suggestions.");
        } finally {
          setCityLoading(false);
        }
      })();
    }, 220);

    return () => clearTimeout(kickoff);
  }, [profileForm.city]);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!streetInputWrapRef.current?.contains(event.target as Node)) {
        setStreetOpen(false);
      }
      if (!cityInputWrapRef.current?.contains(event.target as Node)) {
        setCityOpen(false);
      }
    }

    globalThis.addEventListener("mousedown", onPointerDown);
    return () => globalThis.removeEventListener("mousedown", onPointerDown);
  }, []);

  function onCityInputChange(nextCity: string) {
    setProfileForm((prev) => ({ ...prev, city: nextCity }));
    setCityOpen(true);
    setStreetPlaceId(null);
    setCityPlaceId(null);

    const match = citySuggestions.find(
      (item) => item.description.toLowerCase() === nextCity.trim().toLowerCase()
    );
    if (!match) {
      return;
    }

    void (async () => {
      try {
        const resolved = await resolveAddressPlace(match.place_id);
        setProfileForm((prev) => ({
          ...prev,
          city: resolved.city || nextCity,
          state: resolved.state || prev.state,
          postal_code: prev.postal_code,
        }));
        setCityPlaceId(match.place_id);
        setCityOpen(false);
      } catch {
        setCityPlaceId(match.place_id);
        setCityOpen(false);
      }
    })();
  }

  function toggleCarrierVehicleType(value: string) {
    setProfileForm((prev) => {
      const exists = prev.vehicle_types.includes(value);
      const nextVehicleTypes = exists
        ? prev.vehicle_types.filter((item) => item !== value)
        : [...prev.vehicle_types, value];
      return { ...prev, vehicle_types: nextVehicleTypes };
    });
  }

  function addServiceRegion() {
    const state = profileForm.service_region_state.trim().toUpperCase();
    const country = profileForm.service_region_country.trim().toUpperCase() || "US";
    if (!state) {
      return;
    }

    const nextRegion = `${state}, ${country}`;
    setProfileForm((prev) => {
      if (prev.service_regions.includes(nextRegion)) {
        return prev;
      }
      return {
        ...prev,
        service_regions: [...prev.service_regions, nextRegion],
        service_region_state: "",
      };
    });
  }

  function removeServiceRegion(region: string) {
    setProfileForm((prev) => ({
      ...prev,
      service_regions: prev.service_regions.filter((item) => item !== region),
    }));
  }

  function chooseCitySuggestion(suggestion: AddressSuggestion) {
    const parsedSuggestion = parseCitySuggestionDescription(suggestion.description);
    setProfileForm((prev) => ({
      ...prev,
      city: parsedSuggestion.city || prev.city,
      state: parsedSuggestion.state || prev.state,
      country: parsedSuggestion.country || prev.country,
    }));
    void (async () => {
      try {
        const resolved = await resolveAddressPlace(suggestion.place_id);
        setProfileForm((prev) => ({
          ...prev,
          city: resolved.city || parsedSuggestion.city || prev.city,
          state: resolved.state || prev.state,
          postal_code: prev.postal_code,
          country: prev.country || DEFAULT_COUNTRY_CODE,
        }));
        setCityPlaceId(suggestion.place_id);
      } catch {
        setProfileForm((prev) => ({
          ...prev,
          city: parsedSuggestion.city || prev.city,
          state: parsedSuggestion.state || prev.state,
          country: parsedSuggestion.country || prev.country,
        }));
        setCityPlaceId(suggestion.place_id);
      } finally {
        setCityOpen(false);
      }
    })();
  }

  function onStreetInputChange(nextStreet: string) {
    setProfileForm((prev) => ({ ...prev, street: nextStreet }));
    setStreetOpen(true);
    setStreetPlaceId(null);
    setCityPlaceId(null);
  }

  function chooseStreetSuggestion(suggestion: AddressSuggestion) {
    void (async () => {
      try {
        const resolved = await resolveAddressPlace(suggestion.place_id);
        setProfileForm((prev) => ({
          ...prev,
          street: resolved.physical_address || prev.street,
          city: resolved.city || prev.city,
          state: resolved.state || prev.state,
          postal_code: resolved.postal_code || prev.postal_code,
          country: DEFAULT_COUNTRY_CODE,
        }));
        setStreetPlaceId(suggestion.place_id);
        setCityPlaceId(suggestion.place_id);
      } catch {
        setStreetPlaceId(suggestion.place_id);
      } finally {
        setStreetOpen(false);
      }
    })();
  }

  const queue = useMemo(
    () => [...shipments].sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at)),
    [shipments]
  );

  const offersForMe = useMemo(
    () => queue.filter((shipment) => shipment.status === "offered" && shipment.carrier_name === null),
    [queue]
  );

  const acceptedByMe = useMemo(() => {
    if (!session) {
      return [];
    }
    return queue.filter(
      (shipment) => shipment.carrier_name?.toLowerCase() === session.displayName.toLowerCase()
    );
  }, [queue, session]);

  const activeShipments = useMemo(
    () => acceptedByMe.filter((s) => s.status === "active"),
    [acceptedByMe]
  );

  const selectedTrackingRow =
    liveTrackingRows.find((row) => row.shipment_id === selectedTrackingShipmentId)
    ?? liveTrackingRows[0]
    ?? null;

  const carrierPlan = useMemo(
    () => subscriptionPlans.find((plan) => plan.role === "carrier") || null,
    [subscriptionPlans]
  );

  const deliveredShipments = useMemo(
    () => acceptedByMe.filter((s) => s.status === "delivered"),
    [acceptedByMe]
  );

  const shipmentsWithQuotes = useMemo(
    () => queue.filter((s) => s.quote_breakdown !== null),
    [queue]
  );

  const optimizationShipments = useMemo(
    () =>
      queue.filter(
        (shipment) =>
          shipment.status === "offered" ||
          shipment.status === "accepted" ||
          shipment.status === "awaiting_payment" ||
          shipment.status === "active" ||
          shipment.status === "in_transit"
      ),
    [queue]
  );

  const selectedOptimizationShipment = useMemo(
    () => optimizationShipments.find((shipment) => shipment.id === optimizationShipmentId) || null,
    [optimizationShipments, optimizationShipmentId]
  );

  const selectedShipperInsights = useMemo(() => {
    if (!selectedOptimizationShipment) {
      return null;
    }

    const sameShipperLoads = queue.filter((shipment) => shipment.client_name === selectedOptimizationShipment.client_name);
    const previousLoads = Math.max(0, sameShipperLoads.length - 1);
    const deliveredLoads = sameShipperLoads.filter((shipment) => shipment.status === "delivered");
    const activeLoads = sameShipperLoads.filter((shipment) => shipment.status === "active" || shipment.status === "in_transit");
    const completionRate = sameShipperLoads.length > 0 ? deliveredLoads.length / sameShipperLoads.length : 0;
    const operationalReliability = Math.round(60 + (completionRate * 40));

    return {
      previousLoads,
      deliveredLoads: deliveredLoads.length,
      activeLoads: activeLoads.length,
      operationalReliability,
    };
  }, [queue, selectedOptimizationShipment]);

  const displayedRouteAnalysis = useMemo(() => {
    if (!routeAnalysis) {
      return null;
    }

    const dedupedRoutes: RouteOption[] = [];
    for (const route of routeAnalysis.routes) {
      const duplicate = dedupedRoutes.some((existing) => routeIsNearDuplicate(existing, route));
      if (!duplicate) {
        dedupedRoutes.push(route);
      }
    }

    const recommended = dedupedRoutes[0] || routeAnalysis.best_route;
    const activeRoute = dedupedRoutes.find((route) => route.name === selectedRouteName) || recommended;
    const alternatives = dedupedRoutes.filter((route) => route.name !== activeRoute.name);
    const hiddenCount = Math.max(0, routeAnalysis.routes.length - dedupedRoutes.length);

    return {
      recommended,
      activeRoute,
      alternatives,
      hiddenCount,
    };
  }, [routeAnalysis, selectedRouteName]);

  const activeFuelPricePerLiterUsd = useMemo(
    () => routeAnalysis?.fuel_price_usd_per_liter ?? DEFAULT_DIESEL_PRICE_PER_LITER_USD,
    [routeAnalysis?.fuel_price_usd_per_liter]
  );

  const activeOperatingProfile = useMemo(
    () => normalizeOperatingProfile({
      fuel_efficiency_kmpl: Number(profileForm.fuel_efficiency_kmpl),
      idle_fuel_lph: Number(profileForm.idle_fuel_lph),
      maintenance_cost_per_km_usd: Number(profileForm.maintenance_cost_per_km_usd),
      driver_cost_per_hour_usd: Number(profileForm.driver_cost_per_hour_usd),
      toll_discount_pct: Number(profileForm.toll_discount_pct),
      fuel_price_adjustment_pct: Number(profileForm.fuel_price_adjustment_pct),
      empty_mile_factor_pct: Number(profileForm.empty_mile_factor_pct),
    }),
    [
      profileForm.fuel_efficiency_kmpl,
      profileForm.idle_fuel_lph,
      profileForm.maintenance_cost_per_km_usd,
      profileForm.driver_cost_per_hour_usd,
      profileForm.toll_discount_pct,
      profileForm.fuel_price_adjustment_pct,
      profileForm.empty_mile_factor_pct,
    ]
  );

  const activeFuelPriceSourceLabel = fuelPriceSourceLabel(routeAnalysis?.fuel_price_source);

  const routeBenchmarks = useMemo(() => {
    if (!displayedRouteAnalysis) {
      return null;
    }
    const allRoutes = [displayedRouteAnalysis.recommended, ...displayedRouteAnalysis.alternatives];
    return buildRouteBenchmarks(allRoutes, activeFuelPricePerLiterUsd, activeOperatingProfile);
  }, [displayedRouteAnalysis, activeFuelPricePerLiterUsd, activeOperatingProfile]);

  const deliveryHealthSummary = useMemo(() => {
    if (!displayedRouteAnalysis || !selectedOptimizationShipment) {
      return null;
    }
    return buildDeliveryHealthSummary({
      recommendedRoute: displayedRouteAnalysis.activeRoute,
      alternativeRoutes: routeAnalysis?.routes.filter((route) => route.name !== displayedRouteAnalysis.activeRoute.name) ?? displayedRouteAnalysis.alternatives,
      shipment: selectedOptimizationShipment,
      fuelPricePerLiterUsd: activeFuelPricePerLiterUsd,
      operatingProfile: activeOperatingProfile,
      routeBenchmarks,
    });
  }, [
    displayedRouteAnalysis,
    selectedOptimizationShipment,
    routeAnalysis,
    activeFuelPricePerLiterUsd,
    activeOperatingProfile,
    routeBenchmarks,
  ]);

  const documentInvoices = useMemo(
    () =>
      acceptedByMe
        .filter(
          (shipment) =>
            shipment.payment_status === "paid"
            && shipment.quote_breakdown !== null
            && shipment.invoice_number !== null
            && shipment.payment_intent_id !== null
        )
        .sort((a, b) => {
          const aTime = new Date(a.payment_completed_at || a.invoice_generated_at || a.updated_at).getTime();
          const bTime = new Date(b.payment_completed_at || b.invoice_generated_at || b.updated_at).getTime();
          return bTime - aTime;
        })
        .map((shipment) => {
          const quote = shipment.quote_breakdown!;
          const amountUsd = shipment.shipper_approved_amount ?? shipment.carrier_offer_amount ?? quote.total_usd;
          const freightChargeUsd = quote.base_freight_usd + quote.urgency_surcharge_usd + quote.distance_surcharge_usd;
          return {
            shipment,
            invoiceNum: shipment.invoice_number!,
            transactionRef: shipment.payment_intent_id!,
            paymentDate: shipment.payment_completed_at || shipment.invoice_generated_at || shipment.updated_at,
            amountUsd,
            freightChargeUsd,
            platformFeeUsd: quote.service_fee_usd,
            detail: "Payment received from shipper via Stripe",
          };
        }),
    [acceptedByMe]
  );

  const ownTransactions = useMemo(
    () =>
      documentInvoices.map((item) => ({
        ...item,
        kind: "purchase" as const,
      })),
    [documentInvoices]
  );

  function buildInvoiceDocument(params: {
    invoiceNum: string;
    transactionRef: string;
    paymentDate: string;
    shipment: Shipment;
  }): string {
    const { invoiceNum, transactionRef, paymentDate, shipment } = params;
    const quote = shipment.quote_breakdown;
    if (!quote) {
      return "No invoice data available.";
    }

    const freightChargeUsd = quote.base_freight_usd + quote.urgency_surcharge_usd + quote.distance_surcharge_usd;
    const platformFeeUsd = quote.service_fee_usd;
    const totalPaidUsd = shipment.shipper_approved_amount ?? shipment.carrier_offer_amount ?? quote.total_usd;

    return [
      `Invoice #: ${invoiceNum}`,
      `Load #: ${shipment.load_number}`,
      "Status: PAID",
      "",
      `Shipper: ${shipment.client_name}`,
      `Carrier: ${shipment.carrier_name ?? session?.displayName ?? "Unknown carrier"}`,
      `Route: ${shipment.origin} -> ${shipment.destination}`,
      "",
      "Description                 Amount",
      `Freight Charge              $${freightChargeUsd.toFixed(2)}`,
      `Platform Fee                $${platformFeeUsd.toFixed(2)}`,
      `Total Paid                  $${totalPaidUsd.toFixed(2)}`,
      "",
      `Payment Date: ${new Date(paymentDate).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`,
      `Transaction ID: ${transactionRef}`,
    ].join("\n");
  }

  function onDownloadInvoice(params: {
    invoiceNum: string;
    transactionRef: string;
    paymentDate: string;
    shipment: Shipment;
  }) {
    const safeInvoiceId = params.invoiceNum.replace(/[^a-zA-Z0-9-_]/g, "_");
    const content = buildInvoiceDocument(params);
    downloadPdfDocument(`${safeInvoiceId}.pdf`, content);
  }

  function onViewInvoice(params: {
    invoiceNum: string;
    transactionRef: string;
    paymentDate: string;
    shipment: Shipment;
  }) {
    setSelectedInvoice(params);
  }

  const totalEarned = useMemo(
    () =>
      acceptedByMe
        .filter((s) => s.payment_status === "paid")
        .reduce((sum, s) => sum + (s.shipper_approved_amount ?? s.carrier_offer_amount ?? s.quote_breakdown?.total_usd ?? 0), 0),
    [acceptedByMe]
  );

  const totalPending = useMemo(
    () =>
      acceptedByMe
        .filter((s) => s.payment_status !== "paid")
        .reduce((sum, s) => sum + (s.shipper_approved_amount ?? s.carrier_offer_amount ?? s.quote_breakdown?.total_usd ?? 0), 0),
    [acceptedByMe]
  );

  const carrierDashboardMix = useMemo(() => {
    const total = Math.max(queue.length, 1);
    return [
      {
        label: "Open offers",
        value: offersForMe.length,
        percent: Math.round((offersForMe.length / total) * 100),
        barClass: "bg-gradient-to-r from-amber-400 to-orange-500",
      },
      {
        label: "In motion",
        value: activeShipments.length,
        percent: Math.round((activeShipments.length / total) * 100),
        barClass: "bg-gradient-to-r from-cyan-400 to-sky-500",
      },
      {
        label: "Delivered",
        value: deliveredShipments.length,
        percent: Math.round((deliveredShipments.length / total) * 100),
        barClass: "bg-gradient-to-r from-emerald-400 to-teal-500",
      },
    ];
  }, [queue.length, offersForMe.length, activeShipments.length, deliveredShipments.length]);

  const carrierActivityChart = useMemo(() => {
    const recentShipments = [...queue]
      .sort((a, b) => new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime())
      .slice(-6);

    if (recentShipments.length === 0) {
      return {
        labels: ["Jan", "Feb", "Mar", "Apr", "May", "Jun"],
        values: [1, 3, 2, 4, 3, 5],
      };
    }

    return {
      labels: recentShipments.map((shipment) => new Date(shipment.updated_at).toLocaleDateString("en-US", { month: "short" })),
      values: recentShipments.map((shipment) => {
        if (shipment.status === "delivered") {
          return 5;
        }
        if (shipment.status === "active" || shipment.status === "in_transit") {
          return 4;
        }
        if (shipment.status === "accepted" || shipment.status === "awaiting_payment") {
          return 3;
        }
        if (shipment.status === "offered") {
          return 2;
        }
        return 1;
      }),
    };
  }, [queue]);

  const carrierProfileCompletion = useMemo(() => {
    const checks = [
      profileForm.full_name,
      profileForm.company_name,
      profileForm.tax_id,
      profileForm.dot_number,
      profileForm.phone,
      profileForm.street,
      profileForm.city,
      profileForm.state,
      profileForm.postal_code,
      profileForm.bio,
    ];
    const complete = checks.filter((value) => value.trim().length > 0).length;
    return Math.round((complete / checks.length) * 100);
  }, [profileForm]);

  const carrierAnalytics = useMemo(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    const inWindow = (isoDate: string, start: Date, end: Date) => {
      const value = new Date(isoDate);
      return value >= start && value < end;
    };

    const serviceFeeOf = (shipment: Shipment) => {
      const raw = shipment.quote_breakdown?.service_fee_usd;
      if (raw === undefined || raw === null) {
        return 0;
      }
      const parsed = Number.parseFloat(raw.toString());
      return Number.isFinite(parsed) ? parsed : 0;
    };

    const marginPctOf = (shipment: Shipment) => {
      const total = shipment.quote_breakdown?.total_usd ?? 0;
      if (total <= 0) {
        return null;
      }
      return (serviceFeeOf(shipment) / total) * 100;
    };

    const onTimePctOf = (shipments: Shipment[]) => {
      const withEta = shipments.filter((s) => s.estimated_arrival);
      if (withEta.length === 0) {
        return 0;
      }
      const onTime = withEta.filter((s) => new Date(s.updated_at) <= new Date(s.estimated_arrival as string)).length;
      return (onTime / withEta.length) * 100;
    };

    const avgMarginOf = (shipments: Shipment[]) => {
      const margins = shipments
        .map(marginPctOf)
        .filter((value): value is number => value !== null);
      if (margins.length === 0) {
        return 0;
      }
      return margins.reduce((sum, value) => sum + value, 0) / margins.length;
    };

    const pctDelta = (current: number, previous: number) => {
      if (Math.abs(previous) < 0.0001) {
        return current === 0 ? 0 : 100;
      }
      return ((current - previous) / Math.abs(previous)) * 100;
    };

    const thisMonthDelivered = deliveredShipments.filter((s) => inWindow(s.created_at, monthStart, nextMonthStart));
    const lastMonthDelivered = deliveredShipments.filter((s) => inWindow(s.created_at, lastMonthStart, monthStart));
    const lastMonthTransit = queue.filter((s) => (s.status === "active" || s.status === "in_transit") && inWindow(s.created_at, lastMonthStart, monthStart));

    const revenueThisMonth = thisMonthDelivered.reduce((sum, s) => sum + serviceFeeOf(s), 0);
    const revenueLastMonth = lastMonthDelivered.reduce((sum, s) => sum + serviceFeeOf(s), 0);
    const loadsInTransit = activeShipments.length;
    const loadsInTransitLastMonth = lastMonthTransit.length;
    const averageMargin = avgMarginOf(thisMonthDelivered);
    const averageMarginLastMonth = avgMarginOf(lastMonthDelivered);
    const onTimeDelivery = onTimePctOf(thisMonthDelivered);
    const onTimeDeliveryLastMonth = onTimePctOf(lastMonthDelivered);

    const monthlyRanges = Array.from({ length: 6 }, (_, offset) => {
      const monthOffset = 5 - offset;
      const start = new Date(now.getFullYear(), now.getMonth() - monthOffset, 1);
      const end = new Date(now.getFullYear(), now.getMonth() - monthOffset + 1, 1);
      return { start, end };
    });

    const sparklineSeries = {
      revenue: monthlyRanges.map(({ start, end }) => deliveredShipments
        .filter((s) => inWindow(s.created_at, start, end))
        .reduce((sum, s) => sum + serviceFeeOf(s), 0)),
      transit: monthlyRanges.map(({ start, end }) => queue
        .filter((s) => (s.status === "active" || s.status === "in_transit") && inWindow(s.created_at, start, end)).length),
      margin: monthlyRanges.map(({ start, end }) => avgMarginOf(deliveredShipments.filter((s) => inWindow(s.created_at, start, end)))),
      onTime: monthlyRanges.map(({ start, end }) => onTimePctOf(deliveredShipments.filter((s) => inWindow(s.created_at, start, end)))),
    };

    return {
      revenueThisMonth,
      loadsInTransit,
      averageMargin,
      onTimeDelivery,
      trends: {
        revenue: pctDelta(revenueThisMonth, revenueLastMonth),
        loadsInTransit: pctDelta(loadsInTransit, loadsInTransitLastMonth),
        averageMargin: pctDelta(averageMargin, averageMarginLastMonth),
        onTimeDelivery: pctDelta(onTimeDelivery, onTimeDeliveryLastMonth),
      },
      sparklineSeries,
    };
  }, [deliveredShipments, queue, activeShipments.length]);

  function signOut() {
    clearAuthLiteSession("carrier");
    setSession(null);
    trackEvent("auth.sign_out", { role: "carrier" });
    globalThis.window.location.assign("/");
  }

  async function onAccept(shipment: Shipment) {
    if (!session) {
      setMessage("Session missing. Please sign in again.");
      return;
    }

    const shipmentId = shipment.id;

    const rawOfferAmount = (offerAmountByShipment[shipmentId] || "").trim();
    const offerAmount = Number(rawOfferAmount);
    if (!rawOfferAmount || !Number.isFinite(offerAmount) || offerAmount <= 0) {
      setMessage("Enter a valid offer amount before submitting.");
      return;
    }

    const draft = quoteDetailsByShipment[shipmentId];
    const hasCustomQuoteDetails = Boolean(
      draft
      && (
        draft.mileage.trim()
        || draft.urgency !== shipment.urgency
        || draft.urgency_surcharge_usd.trim()
        || draft.distance_surcharge_usd.trim()
        || draft.service_fee_usd.trim()
        || draft.estimated_delivery_time.trim()
        || draft.notes.trim()
      )
    );

    let quoteDetails: CarrierQuoteDetailsPayload | undefined;
    if (hasCustomQuoteDetails && draft) {
      const parseOptionalMoneyField = (rawValue: string, fieldLabel: string): number | undefined => {
        if (!rawValue.trim()) {
          return undefined;
        }
        const parsed = Number(rawValue);
        if (!Number.isFinite(parsed) || parsed < 0) {
          throw new Error(`Enter a valid ${fieldLabel} amount.`);
        }
        return Number(parsed.toFixed(2));
      };

      let mileage: number | undefined;
      if (draft.mileage.trim()) {
        const parsedMileage = Number(draft.mileage);
        if (!Number.isFinite(parsedMileage) || parsedMileage <= 0) {
          setMessage("Enter a valid mileage greater than 0.");
          return;
        }
        mileage = Number(parsedMileage.toFixed(1));
      }

      try {
        quoteDetails = {
          mileage,
          urgency: draft.urgency,
          urgency_surcharge_usd: parseOptionalMoneyField(draft.urgency_surcharge_usd, "urgency surcharge"),
          distance_surcharge_usd: parseOptionalMoneyField(draft.distance_surcharge_usd, "distance surcharge"),
          service_fee_usd: parseOptionalMoneyField(draft.service_fee_usd, "service fee"),
          estimated_delivery_time: draft.estimated_delivery_time.trim() || undefined,
          notes: draft.notes.trim() || undefined,
        };
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Invalid quote details.");
        return;
      }
    }

    setMessage("");
    try {
      await submitCarrierOffer(
        shipmentId,
        session.displayName || "Independent Carrier",
        offerAmount,
        { role: "carrier", displayName: session.displayName },
        undefined,
        quoteDetails
      );
      trackEvent("shipment.offer_submitted", { role: "carrier", shipmentId, offerAmount, withQuoteDetails: Boolean(quoteDetails) });
      setOfferAmountByShipment((prev) => ({ ...prev, [shipmentId]: "" }));
      setQuoteDetailsByShipment((prev) => {
        const next = { ...prev };
        delete next[shipmentId];
        return next;
      });
      setQuoteDetailsOpenByShipment((prev) => ({ ...prev, [shipmentId]: false }));
      setMessage(`Offer submitted for $${offerAmount.toFixed(2)}. Waiting for shipper approval.`);
      await loadShipments();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to submit offer.");
    }
  }

  async function onReject(shipmentId: string) {
    if (!session) {
      setMessage("Session missing. Please sign in again.");
      return;
    }

    setMessage("");
    try {
      await rejectShipmentOffer(
        shipmentId,
        "Carrier declined this offer.",
        { role: "carrier", displayName: session.displayName }
      );
      trackEvent("shipment.reject", { role: "carrier", shipmentId });
      setMessage("Offer rejected.");
      await loadShipments();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to reject offer.");
    }
  }

  async function onOptimize(shipmentId: string, mode: (typeof modeOptions)[number]["value"]) {
    if (!session) {
      setMessage("Session missing. Please sign in again.");
      return;
    }

    setMessage("");
    try {
      await optimizeRoute(shipmentId, mode, { role: "carrier", displayName: session.displayName });
      trackEvent("shipment.optimize", { role: "carrier", shipmentId, mode });
      setMessage(`Route optimized with ${mode.replace("_", " ")} mode.`);
      await loadShipments();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to optimize route.");
    }
  }

  const loadRouteAnalysis = useCallback(async (shipmentId: string, mode: (typeof modeOptions)[number]["value"]) => {
    if (!session?.displayName || !shipmentId) {
      setRouteAnalysis(null);
      return;
    }

    setRouteAnalysisLoading(true);
    try {
      const actor: ActorContext = { role: "carrier", displayName: session.displayName };
      const analysis = await getRouteAnalysis(shipmentId, mode, actor);
      setRouteAnalysis(analysis);
    } catch (error) {
      setRouteAnalysis(null);
      setMessage(error instanceof Error ? error.message : "Failed to load route analysis.");
    } finally {
      setRouteAnalysisLoading(false);
    }
  }, [session?.displayName]);

  useEffect(() => {
    if (!isSubscriptionActive || activeTab !== "optimization") {
      return;
    }

    if (!optimizationShipmentId && optimizationShipments.length > 0) {
      setOptimizationShipmentId(optimizationShipments[0].id);
      return;
    }

    if (optimizationShipmentId) {
      void loadRouteAnalysis(optimizationShipmentId, optimizationMode);
    }
  }, [activeTab, optimizationShipmentId, optimizationMode, optimizationShipments, loadRouteAnalysis, isSubscriptionActive]);

  useEffect(() => {
    if (!isSubscriptionActive) {
      return;
    }
    if (session?.email && (activeTab === "drivers" || activeTab === "documents" || activeTab === "queue")) {
      void loadDriverData(session.email);
    }
  }, [activeTab, session?.email, loadDriverData, isSubscriptionActive]);

  useEffect(() => {
    if (!session?.email || !isSubscriptionActive) {
      return;
    }

    const sessionEmail = session.email;

    const shouldShowLiveTracking = activeTab === "tracking";
    if (!shouldShowLiveTracking) {
      return;
    }

    void loadLiveTracking(sessionEmail);
    const timer = setInterval(() => {
      void loadLiveTracking(sessionEmail);
    }, 30000);

    return () => clearInterval(timer);
  }, [activeTab, session?.email, loadLiveTracking, isSubscriptionActive]);

  useEffect(() => {
    if (activeTab !== "tracking") {
      return;
    }

    if (!liveTrackingRows.length) {
      setSelectedTrackingShipmentId("");
      return;
    }

    if (!liveTrackingRows.some((row) => row.shipment_id === selectedTrackingShipmentId)) {
      setSelectedTrackingShipmentId(liveTrackingRows[0].shipment_id);
    }
  }, [activeTab, liveTrackingRows, selectedTrackingShipmentId]);

  useEffect(() => {
    setDriverAssignmentByShipment((prev) => {
      const next: Record<string, string> = {};
      for (const shipment of queue) {
        next[shipment.id] = prev[shipment.id] ?? shipment.assigned_driver_id ?? "";
      }
      return next;
    });
  }, [queue]);

  const driverNameById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const driver of carrierDrivers) {
      map[driver.id] = driver.driver_name;
    }
    return map;
  }, [carrierDrivers]);

  useEffect(() => {
    if (activeTab !== "optimization") {
      return;
    }

    if (optimizationShipmentId && !optimizationShipments.some((shipment) => shipment.id === optimizationShipmentId)) {
      setOptimizationShipmentId(optimizationShipments[0]?.id || "");
      setRouteAnalysis(null);
    }
  }, [activeTab, optimizationShipmentId, optimizationShipments]);

  useEffect(() => {
    const nextKey = `${optimizationShipmentId}:${optimizationMode}`;
    if (alternativesResetKeyRef.current !== nextKey) {
      alternativesResetKeyRef.current = nextKey;
      setShowAlternativeRoutes(false);
      setSelectedRouteName("");
    }
  }, [optimizationShipmentId, optimizationMode, routeAnalysis?.shipment_id]);

  async function onStatus(shipmentId: string, status: "active" | "delivered") {
    if (!session) {
      setMessage("Session missing. Please sign in again.");
      return;
    }

    setMessage("");
    try {
      await updateShipmentStatus(
        shipmentId,
        status,
        undefined,
        { role: "carrier", displayName: session.displayName }
      );
      trackEvent("shipment.status_update", { role: "carrier", shipmentId, status });
      setMessage("Shipment status updated.");
      await loadShipments();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to update status.");
    }
  }

  async function onAssignDriver(shipmentId: string) {
    if (!session) {
      setMessage("Session missing. Please sign in again.");
      return;
    }

    const driverId = (driverAssignmentByShipment[shipmentId] || "").trim();
    if (!driverId) {
      setMessage("Select a driver first.");
      return;
    }

    setMessage("");
    try {
      await assignShipmentDriver(shipmentId, driverId, { role: "carrier", displayName: session.displayName });
      const assignedName = driverNameById[driverId] || "Selected driver";
      setMessage(`Shipment assigned to ${assignedName}.`);
      await loadShipments();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to assign driver.");
    }
  }

  async function onConfirmPod(shipmentId: string) {
    if (!session || confirmPodLoadingId) {
      return;
    }

    setConfirmPodLoadingId(shipmentId);
    setMessage("");
    try {
      await confirmCarrierShipmentPod(shipmentId, { role: "carrier", displayName: session.displayName });
      trackEvent("shipment.pod_confirmed", { role: "carrier", shipmentId });
      setMessage("POD confirmed. Shipper review window started.");
      await loadShipments();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to confirm POD.");
    } finally {
      setConfirmPodLoadingId(null);
    }
  }

  async function saveProfile() {
    if (!session?.email) {
      setMessage("Session email missing. Please sign in again.");
      return;
    }

    setProfileSaving(true);
    setMessage("");
    try {
      const smartyAddress = await validateUsStreetAddress({
        street_address: profileForm.street,
        city: profileForm.city,
        state: profileForm.state,
        postal_code: profileForm.postal_code,
      });
      const nextAddressFields = smartyAddress || {
        street_address: profileForm.street,
        city: profileForm.city,
        state: profileForm.state,
        postal_code: profileForm.postal_code,
        country: profileForm.country,
      };
      if (smartyAddress) {
        setProfileForm((prev) => ({
          ...prev,
          street: smartyAddress.street_address,
          city: smartyAddress.city,
          state: smartyAddress.state,
          postal_code: smartyAddress.postal_code,
          country: smartyAddress.country,
        }));
      }
      const vehicleTypes = profileForm.vehicle_types.length > 0
        ? profileForm.vehicle_types
        : ["dry_van"];
      const serviceRegions = profileForm.service_regions;
      const normalizedAddress = formatStreetCityStateZip(
        nextAddressFields.street_address,
        nextAddressFields.city,
        nextAddressFields.state,
        nextAddressFields.postal_code,
        nextAddressFields.country
      );
      const existingAddress = profile?.address?.trim() || "";

      const addressChanged = normalizedAddress !== existingAddress;

      const payload: Parameters<typeof updateUserProfile>[2] = {
        full_name: profileForm.full_name,
        company_name: profileForm.company_name,
        phone: profileForm.phone,
        bio: profileForm.bio,
        tax_id: profileForm.tax_id,
        dot_number: profileForm.dot_number,
        carrier_profile: {
          available_trucks: Number(profileForm.available_trucks),
          service_regions: serviceRegions,
          vehicle_types: vehicleTypes,
          max_weight_kg: Number(profileForm.max_weight_kg),
          fuel_efficiency_kmpl: Number(profileForm.fuel_efficiency_kmpl),
          idle_fuel_lph: Number(profileForm.idle_fuel_lph),
          maintenance_cost_per_km_usd: Number(profileForm.maintenance_cost_per_km_usd),
          driver_cost_per_hour_usd: Number(profileForm.driver_cost_per_hour_usd),
          toll_discount_pct: Number(profileForm.toll_discount_pct),
          fuel_price_adjustment_pct: Number(profileForm.fuel_price_adjustment_pct),
          empty_mile_factor_pct: Number(profileForm.empty_mile_factor_pct),
          base_location: normalizedAddress || undefined,
          base_location_place_id: streetPlaceId || cityPlaceId || undefined,
        },
      };
      if (addressChanged) {
        payload.address = normalizedAddress || undefined;
        payload.address_place_id = streetPlaceId || cityPlaceId || undefined;
      }

      const updated = await updateUserProfile(session.email, "carrier", payload);

      setProfile(updated);
      const refreshedSession = setAuthLiteSession("carrier", updated.display_name, updated.email);
      setSession(refreshedSession);
      setStreetPlaceId(null);
      setMessage("Carrier profile updated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to update carrier profile.");
    } finally {
      setProfileSaving(false);
    }
  }

  if (!ready) {
    return (
      <main className="min-h-screen bg-slate-100 p-6 text-slate-900 md:p-10">
        <div className="mx-auto w-full max-w-7xl rounded-3xl bg-white p-8 shadow-sm">
          <p className="text-xs uppercase tracking-[0.2em] text-emerald-700">Carrier Portal</p>
          <h1 className="mt-3 text-2xl font-semibold text-slate-900">Loading dispatch workspace...</h1>
          <p className="mt-2 text-sm text-slate-600">Preparing your shipments, offers, and account data.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="carrier-portal-shell min-h-screen px-4 py-6 text-slate-900 md:px-8 md:py-10">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8">
        <header className="carrier-hero-card carrier-fade-up rounded-[36px] p-8 text-white md:p-10">
          <div className="relative z-10 grid gap-8 xl:grid-cols-[1.35fr_0.85fr] xl:items-start">
            <div>
              <div className="inline-flex rounded-full border border-white/15 bg-white/10 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.28em] text-emerald-100">
                Carrier workspace
              </div>
              <h1 className="mt-5 max-w-4xl text-4xl font-semibold tracking-[-0.03em] text-white md:text-5xl">Operate dispatch, pricing, routing, and payouts from one polished command center.</h1>
              <p className="mt-4 max-w-3xl text-base leading-7 text-emerald-50/90 md:text-lg">
                Receive job offers, respond with structured quotes, optimize routes, assign drivers, and manage paid shipments through a carrier experience that feels client-grade.
              </p>
              <div className="mt-6 flex flex-wrap gap-3 text-sm text-white/90">
                <div className="rounded-full border border-white/12 bg-white/10 px-4 py-2">{profile?.company_name || "Carrier account"}</div>
                <div className="rounded-full border border-white/12 bg-white/10 px-4 py-2">{queue.length} loads in pipeline</div>
                <div className="rounded-full border border-white/12 bg-white/10 px-4 py-2">{formatUsdCompact(totalEarned)} earned</div>
              </div>
            </div>

            <div className="flex flex-col gap-4 xl:items-end">
              <div className="flex flex-wrap justify-end gap-2">
                <div className="relative" ref={accountMenuRef}>
                  <button
                    type="button"
                    onClick={() => setAccountMenuOpen((prev) => !prev)}
                    aria-label="Open my account menu"
                    aria-expanded={accountMenuOpen}
                    className="flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/16"
                  >
                    <span>My Account</span>
                    <ProfileIcon className="h-5 w-5" />
                  </button>
                  {accountMenuOpen && (
                    <div className="absolute right-0 top-14 z-20 w-56 rounded-2xl border border-emerald-200/60 bg-white p-2 text-slate-900 shadow-2xl shadow-slate-900/20">
                      <button
                        type="button"
                        onClick={() => {
                          setActiveTab("profile");
                          setAccountMenuOpen(false);
                        }}
                        className="w-full rounded-xl px-3 py-2.5 text-left text-sm hover:bg-slate-100"
                      >
                        Profile
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveTab("subscription");
                          setAccountMenuOpen(false);
                        }}
                        className="w-full rounded-xl px-3 py-2.5 text-left text-sm hover:bg-slate-100"
                      >
                        Subscription
                      </button>
                    </div>
                  )}
                </div>
                <button
                  onClick={signOut}
                  className="rounded-full border border-white/15 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/12"
                >
                  Sign Out
                </button>
                <Link className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-900 transition hover:bg-emerald-50" href="/">
                  Home
                </Link>
              </div>

              <div className="grid w-full gap-4 sm:grid-cols-2 xl:w-[360px]">
                <div className="rounded-[28px] border border-white/12 bg-white/10 p-5 backdrop-blur-sm">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-emerald-100/80">Profile readiness</p>
                  <p className="mt-3 text-3xl font-semibold">{carrierProfileCompletion}%</p>
                  <p className="mt-2 text-sm leading-6 text-emerald-50/85">Keep operations, payout, and compliance details complete for faster driver assignment and shipper trust.</p>
                </div>
                <div className="rounded-[28px] border border-white/12 bg-white/10 p-5 backdrop-blur-sm">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-100/80">Pending revenue</p>
                  <p className="mt-3 text-3xl font-semibold">{formatUsdCompact(totalPending)}</p>
                  <p className="mt-2 text-sm leading-6 text-emerald-50/85">Quoted and accepted work that has not yet fully settled into paid revenue.</p>
                </div>
              </div>
            </div>
          </div>
        </header>

        <nav className="carrier-premium-card carrier-fade-up flex flex-wrap gap-2 rounded-[30px] p-4 md:p-5">
          {([
            { key: "dashboard", label: "Dashboard" },
            { key: "metrics", label: "Metrics" },
            { key: "tracking", label: "Tracking" },
            { key: "queue", label: "Queue & Offers" },
            { key: "optimization", label: "Route Optimization" },
            { key: "payments", label: "Payments" },
            { key: "transactions", label: "Transaction History" },
            { key: "documents", label: "My Documents" },
            { key: "drivers", label: "Drivers" },
          ] as const).map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setActiveTab(key)}
              className={`carrier-tab-pill rounded-full px-4 py-2.5 text-sm font-semibold transition ${
                activeTab === key
                  ? "bg-slate-950 text-white shadow-lg shadow-slate-900/15"
                  : "border border-slate-300/80 bg-white/90 text-slate-700 hover:bg-slate-100"
              }`}
            >
              {label}
            </button>
          ))}
        </nav>

        {message && (
          <p className="carrier-premium-card carrier-fade-up rounded-[24px] border border-emerald-300 bg-emerald-50/90 px-5 py-4 text-sm font-medium text-emerald-950">
            {message}
          </p>
        )}

        {!isSubscriptionActive && !subscriptionNotice && (
          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-6 shadow-sm">
            <h2 className="text-xl font-semibold text-amber-900">Subscription Required</h2>
            <p className="mt-2 text-sm text-amber-800">
              A carrier subscription is required before using platform features.
            </p>
            <div className="mt-4 rounded-xl border border-amber-300 bg-white p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Plan</p>
              <p className="mt-1 text-lg font-semibold text-slate-900">{carrierPlan?.name || "Carrier"} - ${carrierPlan?.price_usd.toFixed(2) || "49.99"}/month</p>
              <p className="mt-1 text-xs text-slate-500">
                Status: {subscriptionStatus?.subscription_status || "inactive"}
                {subscriptionStatus?.subscription_current_period_end
                  ? ` • Renews ${new Date(subscriptionStatus.subscription_current_period_end).toLocaleDateString()}`
                  : ""}
              </p>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void startSubscriptionCheckout()}
                disabled={checkoutLoading || subscriptionLoading}
                className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-500 disabled:opacity-60"
              >
                {checkoutLoading ? "Redirecting..." : "Subscribe for $49.99"}
              </button>
              <button
                type="button"
                onClick={() => void loadSubscriptionState(true)}
                disabled={subscriptionLoading}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
              >
                {subscriptionLoading ? "Checking..." : "Refresh Status"}
              </button>
            </div>
          </section>
        )}

        {!isSubscriptionActive && subscriptionNotice && (
          <section className="rounded-2xl border border-rose-200 bg-rose-50 p-6 shadow-sm">
            <h2 className="text-xl font-semibold text-rose-900">Carrier Account Not Found</h2>
            <p className="mt-2 text-sm text-rose-800">{subscriptionNotice}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void loadSubscriptionState(true)}
                disabled={subscriptionLoading}
                className="rounded-lg border border-rose-300 bg-white px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-60"
              >
                {subscriptionLoading ? "Checking..." : "Refresh Status"}
              </button>
              <button
                type="button"
                onClick={signOut}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
              >
                Sign Out
              </button>
            </div>
          </section>
        )}

        {activeTab === "subscription" && (
          <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
            <h2 className="text-xl font-semibold">Subscription</h2>
            <p className="mt-1 text-sm text-slate-600">Manage your carrier plan access.</p>
            <div className="mt-4 rounded-lg border border-slate-200 p-4 text-sm space-y-1">
              <p><span className="font-semibold">Plan:</span> {carrierPlan?.name || "Carrier"}</p>
              <p><span className="font-semibold">Price:</span> ${carrierPlan?.price_usd.toFixed(2) || "49.99"}/month</p>
              <p><span className="font-semibold">Status:</span> {subscriptionStatus?.subscription_status || "inactive"}</p>
              <p>
                <span className="font-semibold">
                  {subscriptionStatus?.subscription_cancel_at_period_end ? "Access until:" : "Renews:"}
                </span>{" "}
                {subscriptionStatus?.subscription_current_period_end
                  ? new Date(subscriptionStatus.subscription_current_period_end).toLocaleDateString()
                  : "n/a"}
              </p>
              {subscriptionStatus?.subscription_cancel_at_period_end && (
                <p className="text-amber-700 font-medium">
                  Cancellation scheduled — full access remains until the date above.
                </p>
              )}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void loadSubscriptionState(true)}
                disabled={subscriptionLoading}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
              >
                {subscriptionLoading ? "Checking..." : "Refresh Status"}
              </button>
              {isSubscriptionActive && !subscriptionStatus?.subscription_cancel_at_period_end && (
                <button
                  type="button"
                  onClick={() => void cancelCarrierSubscription()}
                  disabled={subscriptionActionLoading !== null}
                  className="rounded-lg border border-rose-300 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-60"
                >
                  {subscriptionActionLoading === "cancel" ? "Canceling..." : "Cancel Subscription"}
                </button>
              )}
              {isSubscriptionActive && subscriptionStatus?.subscription_cancel_at_period_end && (
                <button
                  type="button"
                  onClick={() => void resumeCarrierSubscription()}
                  disabled={subscriptionActionLoading !== null}
                  className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-60"
                >
                  {subscriptionActionLoading === "pause" ? "Resuming..." : "Resume Subscription"}
                </button>
              )}
            </div>
          </section>
        )}

        {isSubscriptionActive && activeTab === "dashboard" && (
          <section className="space-y-6">
            <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
              <div className="space-y-6 carrier-fade-up">
                <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <CarrierStatCard label="Pipeline" value={queue.length} detail="All loads and offers currently visible in your carrier workspace." accentClass="bg-slate-950 text-white" progressClass="bg-gradient-to-r from-slate-700 via-slate-900 to-black" progress={queue.length === 0 ? 10 : 100} />
                  <CarrierStatCard label="Open Offers" value={offersForMe.length} detail="Opportunities still waiting on your pricing or acceptance decision." accentClass="bg-amber-50 text-amber-700" progressClass="bg-gradient-to-r from-amber-400 to-orange-500" progress={carrierDashboardMix[0]?.percent || 10} />
                  <CarrierStatCard label="Active" value={activeShipments.length} detail="Shipments assigned and currently in execution or live movement." accentClass="bg-sky-50 text-sky-700" progressClass="bg-gradient-to-r from-cyan-400 to-sky-500" progress={carrierDashboardMix[1]?.percent || 10} />
                  <CarrierStatCard label="Delivered" value={deliveredShipments.length} detail="Completed work with route history, payout state, and payment traceability." accentClass="bg-emerald-50 text-emerald-700" progressClass="bg-gradient-to-r from-emerald-400 to-teal-500" progress={carrierDashboardMix[2]?.percent || 10} />
                </section>

                <article className="carrier-premium-card carrier-card-hover rounded-[30px] p-6 md:p-7">
                  <div className="relative z-10 flex flex-wrap items-start justify-between gap-6">
                    <div className="max-w-2xl">
                      <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">Operations overview</p>
                      <h2 className="mt-3 text-2xl font-semibold tracking-[-0.03em] text-slate-950 md:text-[2rem]">Your carrier workspace should feel revenue-driving, not clerical.</h2>
                      <p className="mt-3 text-sm leading-7 text-slate-600 md:text-base">Surface load flow, route readiness, and payment momentum in a layout that supports pricing decisions and daily dispatch rhythm.</p>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-[24px] border border-slate-200 bg-white/80 px-4 py-4 shadow-sm">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Earned</p>
                        <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">{formatUsdCompact(totalEarned)}</p>
                      </div>
                      <div className="rounded-[24px] border border-slate-200 bg-white/80 px-4 py-4 shadow-sm">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Pending</p>
                        <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">{formatUsdCompact(totalPending)}</p>
                      </div>
                    </div>
                  </div>
                </article>
              </div>

              <aside className="carrier-fade-up space-y-6">
                <CarrierActivityChart labels={carrierActivityChart.labels} values={carrierActivityChart.values} />
                <div className="carrier-premium-card carrier-card-hover rounded-[30px] p-6">
                  <div className="relative z-10">
                    <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">Load mix</p>
                    <div className="mt-5 space-y-4">
                      {carrierDashboardMix.map((item) => (
                        <div key={item.label}>
                          <div className="flex items-center justify-between gap-3 text-sm">
                            <span className="font-medium text-slate-700">{item.label}</span>
                            <span className="text-slate-500">{item.value} • {item.percent}%</span>
                          </div>
                          <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200/80">
                            <div className={`h-full rounded-full ${item.barClass}`} style={{ width: `${Math.max(8, item.percent)}%` }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </aside>
            </div>

            <div className="carrier-premium-card carrier-fade-up rounded-[30px] p-6 md:p-7">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">Shipment ledger</p>
                  <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-slate-950">All Shipments</h2>
                </div>
                <button
                  onClick={() => void loadShipments()}
                  className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                >
                  {loading ? "Refreshing..." : "Refresh"}
                </button>
              </div>

              <div className="mt-5 space-y-4">
                {queue.length === 0 && (
                  <p className="rounded-[24px] border border-dashed border-slate-300 bg-white/70 p-8 text-center text-sm text-slate-500">
                    No shipments yet.
                  </p>
                )}
                {queue.map((shipment) => (
                  <div key={shipment.id} className="carrier-premium-card carrier-card-hover rounded-[28px] p-5 md:p-6">
                    <div className="relative z-10 flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">{shipment.load_number}</p>
                        <p className="mt-2 text-lg font-semibold tracking-[-0.02em] text-slate-950 md:text-xl">
                          {shipment.origin} to {shipment.destination}
                        </p>
                        <p className="mt-2 text-sm leading-6 text-slate-600">
                          {shipment.client_name} • {shipment.cargo_type} • {toLbFromKg(shipment.weight_kg).toLocaleString()} lb • {shipment.time_window}
                        </p>
                        {shipment.carrier_name && (
                          <p className="mt-1 text-xs font-medium text-emerald-700">Carrier: {shipment.carrier_name}</p>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${carrierShipmentStatusBadgeClass(shipment.status)}`}>
                          {statusLabel[shipment.status]}
                        </span>
                        <span className="text-xs text-slate-400">{new Date(shipment.created_at).toLocaleDateString()}</span>
                      </div>
                    </div>
                    {shipment.quote_breakdown && (
                      <p className="mt-4 rounded-[18px] border border-amber-200/70 bg-[linear-gradient(180deg,rgba(255,251,235,0.95),rgba(254,243,199,0.55))] px-4 py-3 text-xs font-medium text-amber-900">
                        Quote ${shipment.quote_breakdown.total_usd.toFixed(2)} • ETA {shipment.quote_breakdown.estimated_delivery_time}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {isSubscriptionActive && activeTab === "metrics" && (
          <section className="space-y-6">
            <div className="carrier-premium-card carrier-fade-up rounded-[30px] p-6 md:p-7">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">Premium metrics</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-slate-950">Carrier revenue scoreboard</h2>
              <p className="mt-3 text-sm leading-6 text-slate-600">See if you are growing month over month with clear trend signals tied to revenue, movement, margin, and delivery reliability.</p>
            </div>

            <div className="carrier-premium-card rounded-[30px] p-4 md:p-5">
              <div className="grid gap-3">
                <article className="rounded-[24px] border border-slate-200/90 bg-white/85 px-5 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Revenue this month</p>
                      <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">{formatUsdCompact(carrierAnalytics.revenueThisMonth)}</p>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <MetricSparkline values={carrierAnalytics.sparklineSeries.revenue} stroke="#10b981" fillId="revenueSparkline" label="Revenue trend over six months" />
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${trendToneClass(carrierAnalytics.trends.revenue)}`}>{formatTrendDelta(carrierAnalytics.trends.revenue)}</span>
                    </div>
                  </div>
                </article>

                <article className="rounded-[24px] border border-slate-200/90 bg-white/85 px-5 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Loads in transit</p>
                      <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">{carrierAnalytics.loadsInTransit}</p>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <MetricSparkline values={carrierAnalytics.sparklineSeries.transit} stroke="#0ea5e9" fillId="transitSparkline" label="Transit load trend over six months" />
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${trendToneClass(carrierAnalytics.trends.loadsInTransit)}`}>{formatTrendDelta(carrierAnalytics.trends.loadsInTransit)}</span>
                    </div>
                  </div>
                </article>

                <article className="rounded-[24px] border border-slate-200/90 bg-white/85 px-5 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Average margin</p>
                      <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">{carrierAnalytics.averageMargin.toFixed(1)}%</p>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <MetricSparkline values={carrierAnalytics.sparklineSeries.margin} stroke="#f59e0b" fillId="marginSparkline" label="Margin trend over six months" />
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${trendToneClass(carrierAnalytics.trends.averageMargin)}`}>{formatTrendDelta(carrierAnalytics.trends.averageMargin)}</span>
                    </div>
                  </div>
                </article>

                <article className="rounded-[24px] border border-slate-200/90 bg-white/85 px-5 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">On-time delivery</p>
                      <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">{carrierAnalytics.onTimeDelivery.toFixed(1)}%</p>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <MetricSparkline values={carrierAnalytics.sparklineSeries.onTime} stroke="#8b5cf6" fillId="onTimeSparkline" label="On-time delivery trend over six months" />
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${trendToneClass(carrierAnalytics.trends.onTimeDelivery)}`}>{formatTrendDelta(carrierAnalytics.trends.onTimeDelivery)}</span>
                    </div>
                  </div>
                </article>
              </div>
            </div>
          </section>
        )}

        {isSubscriptionActive && activeTab === "queue" && (
          <article className="carrier-premium-card carrier-fade-up rounded-[30px] p-6 md:p-7">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">Queue management</p>
                <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-slate-950">Offer and Shipment Queue</h2>
              </div>
              <button
                onClick={() => void loadShipments()}
                className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
              >
                {loading ? "Refreshing..." : "Refresh"}
              </button>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <div className="carrier-premium-card rounded-[24px] border border-emerald-200 bg-emerald-50/90 p-5">
                <p className="text-xs uppercase tracking-wider text-emerald-700">Offers For You</p>
                <p className="text-2xl font-semibold text-emerald-900">{offersForMe.length}</p>
              </div>
              <div className="carrier-premium-card rounded-[24px] border border-sky-200 bg-sky-50/90 p-5">
                <p className="text-xs uppercase tracking-wider text-emerald-700">Accepted By You</p>
                <p className="text-2xl font-semibold text-emerald-900">{acceptedByMe.length}</p>
              </div>
            </div>

            <div className="mt-5 space-y-4">
              {queue.length === 0 && (
                <p className="rounded-[24px] border border-dashed border-slate-300 bg-white/70 p-8 text-center text-sm text-slate-500">
                  No offers or shipments available.
                </p>
              )}

              {queue.map((shipment) => (
                <div key={shipment.id} className="carrier-premium-card carrier-card-hover rounded-[28px] p-5 md:p-6">
                  <div className="relative z-10">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">{shipment.load_number}</p>
                      <h3 className="mt-2 text-lg font-semibold tracking-[-0.02em] text-slate-950 md:text-xl">
                        {shipment.origin} to {shipment.destination}
                      </h3>
                      <p className="mt-2 text-sm leading-6 text-slate-600">
                        {shipment.client_name} • {shipment.cargo_type} • {toLbFromKg(shipment.weight_kg).toLocaleString()} lb ({shipment.weight_kg.toLocaleString()} kg) • {shipment.time_window}
                      </p>
                    </div>
                    <span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${carrierShipmentStatusBadgeClass(shipment.status)}`}>
                      {statusLabel[shipment.status]}
                    </span>
                  </div>

                  {shipment.quote_breakdown && (
                    <div className="mt-4 rounded-[20px] border border-amber-200/70 bg-[linear-gradient(180deg,rgba(255,251,235,0.95),rgba(254,243,199,0.55))] p-4 text-sm text-amber-900">
                      Estimate ${shipment.quote_breakdown.total_usd.toFixed(2)} • ETA {shipment.quote_breakdown.estimated_delivery_time}
                    </div>
                  )}

                  <div className="mt-4 flex flex-wrap gap-2">
                    {shipment.status === "offered" && (
                      <div className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-slate-50 p-2">
                        <input
                          type="number"
                          min="1"
                          step="0.01"
                          value={offerAmountByShipment[shipment.id] ?? ""}
                          onChange={(event) =>
                            setOfferAmountByShipment((prev) => ({
                              ...prev,
                              [shipment.id]: event.target.value,
                            }))
                          }
                          placeholder="Your offer"
                          className="w-36 rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700"
                        />
                        <button
                          onClick={() => void onAccept(shipment)}
                          className="rounded-md bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-600"
                        >
                          Submit Offer
                        </button>
                        <button
                          onClick={() =>
                            setQuoteDetailsOpenByShipment((prev) => ({
                              ...prev,
                              [shipment.id]: !prev[shipment.id],
                            }))
                          }
                          className="rounded-md border border-emerald-300 bg-white px-3 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-50"
                        >
                          {quoteDetailsOpenByShipment[shipment.id] ? "Hide Quote Details" : "Add Quote Details"}
                        </button>
                        <button
                          onClick={() => void onReject(shipment.id)}
                          className="rounded-md border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                        >
                          Reject Offer
                        </button>

                        {quoteDetailsOpenByShipment[shipment.id] && (
                          <div className="w-full rounded-lg border border-emerald-200 bg-white p-3">
                            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Quote Details For Shipper</p>
                            <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                              <input
                                type="number"
                                min="0"
                                step="0.1"
                                value={quoteDetailsByShipment[shipment.id]?.mileage ?? ""}
                                onChange={(event) =>
                                  setQuoteDetailsByShipment((prev) => {
                                    const current = createQuoteDetailDraft(shipment, prev[shipment.id]);
                                    return {
                                      ...prev,
                                      [shipment.id]: {
                                        ...current,
                                        mileage: event.target.value,
                                      },
                                    };
                                  })
                                }
                                placeholder="Mileage (mi)"
                                className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700"
                              />
                              <select
                                value={quoteDetailsByShipment[shipment.id]?.urgency ?? shipment.urgency}
                                onChange={(event) =>
                                  setQuoteDetailsByShipment((prev) => {
                                    const current = createQuoteDetailDraft(shipment, prev[shipment.id]);
                                    return {
                                      ...prev,
                                      [shipment.id]: {
                                        ...current,
                                        urgency: event.target.value as "low" | "normal" | "high",
                                      },
                                    };
                                  })
                                }
                                className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700"
                              >
                                <option value="low">Urgency: Low</option>
                                <option value="normal">Urgency: Normal</option>
                                <option value="high">Urgency: High</option>
                              </select>
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={quoteDetailsByShipment[shipment.id]?.urgency_surcharge_usd ?? ""}
                                onChange={(event) =>
                                  setQuoteDetailsByShipment((prev) => {
                                    const current = createQuoteDetailDraft(shipment, prev[shipment.id]);
                                    return {
                                      ...prev,
                                      [shipment.id]: {
                                        ...current,
                                        urgency_surcharge_usd: event.target.value,
                                      },
                                    };
                                  })
                                }
                                placeholder="Urgency surcharge ($)"
                                className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700"
                              />
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={quoteDetailsByShipment[shipment.id]?.distance_surcharge_usd ?? ""}
                                onChange={(event) =>
                                  setQuoteDetailsByShipment((prev) => {
                                    const current = createQuoteDetailDraft(shipment, prev[shipment.id]);
                                    return {
                                      ...prev,
                                      [shipment.id]: {
                                        ...current,
                                        distance_surcharge_usd: event.target.value,
                                      },
                                    };
                                  })
                                }
                                placeholder="Distance surcharge ($)"
                                className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700"
                              />
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={quoteDetailsByShipment[shipment.id]?.service_fee_usd ?? ""}
                                onChange={(event) =>
                                  setQuoteDetailsByShipment((prev) => {
                                    const current = createQuoteDetailDraft(shipment, prev[shipment.id]);
                                    return {
                                      ...prev,
                                      [shipment.id]: {
                                        ...current,
                                        service_fee_usd: event.target.value,
                                      },
                                    };
                                  })
                                }
                                placeholder="Service fee ($)"
                                className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700"
                              />
                              <input
                                type="text"
                                value={quoteDetailsByShipment[shipment.id]?.estimated_delivery_time ?? ""}
                                onChange={(event) =>
                                  setQuoteDetailsByShipment((prev) => {
                                    const current = createQuoteDetailDraft(shipment, prev[shipment.id]);
                                    return {
                                      ...prev,
                                      [shipment.id]: {
                                        ...current,
                                        estimated_delivery_time: event.target.value,
                                      },
                                    };
                                  })
                                }
                                placeholder="ETA (e.g., 12.5 hours)"
                                className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700"
                              />
                            </div>
                            <textarea
                              value={quoteDetailsByShipment[shipment.id]?.notes ?? ""}
                              onChange={(event) =>
                                setQuoteDetailsByShipment((prev) => {
                                  const current = createQuoteDetailDraft(shipment, prev[shipment.id]);
                                  return {
                                    ...prev,
                                    [shipment.id]: {
                                      ...current,
                                      notes: event.target.value,
                                    },
                                  };
                                })
                              }
                              placeholder="Quote notes for the shipper"
                              rows={2}
                              className="mt-2 w-full rounded-md border border-slate-300 px-2 py-2 text-xs text-slate-700"
                            />
                          </div>
                        )}
                      </div>
                    )}

                    {shipment.carrier_name?.toLowerCase() === session?.displayName.toLowerCase() && (
                      <>
                        {shipment.status !== "offered" && shipment.status !== "rejected" && shipment.status !== "delivered" && (
                          <div className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-slate-50 p-2">
                            <select
                              value={driverAssignmentByShipment[shipment.id] ?? shipment.assigned_driver_id ?? ""}
                              onChange={(event) =>
                                setDriverAssignmentByShipment((prev) => ({
                                  ...prev,
                                  [shipment.id]: event.target.value,
                                }))
                              }
                              className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700"
                            >
                              <option value="">Select driver</option>
                              {carrierDrivers.map((driver) => (
                                <option key={driver.id} value={driver.id}>
                                  {driver.driver_name} ({driver.driver_mobile})
                                </option>
                              ))}
                            </select>
                            <button
                              onClick={() => void onAssignDriver(shipment.id)}
                              className="rounded-md bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-600"
                            >
                              Assign Driver
                            </button>
                            {shipment.assigned_driver_id && (
                              <span className="text-xs text-emerald-700">
                                Assigned: {driverNameById[shipment.assigned_driver_id] || shipment.assigned_driver_id}
                              </span>
                            )}
                          </div>
                        )}
                        {modeOptions.map((mode) => (
                          <button
                            key={mode.value}
                            onClick={() => void onOptimize(shipment.id, mode.value)}
                            className="rounded-md border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                          >
                            {mode.label}
                          </button>
                        ))}
                        <button
                          onClick={() => void onStatus(shipment.id, "active")}
                          className="rounded-md bg-amber-500 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-400"
                        >
                          Start Tracking
                        </button>
                        <button
                          onClick={() => void onStatus(shipment.id, "delivered")}
                          className="rounded-md bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-500"
                        >
                          Mark Delivered
                        </button>
                        {shipment.payment_status === "paid" && shipment.status === "delivered" && shipment.pod_status === "uploaded" && shipment.payout_status !== "released" && (
                          <button
                            onClick={() => void onConfirmPod(shipment.id)}
                            disabled={confirmPodLoadingId === shipment.id}
                            className="rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                          >
                            {confirmPodLoadingId === shipment.id ? "Confirming POD..." : "Confirm POD"}
                          </button>
                        )}
                      </>
                    )}
                  </div>

                  {shipment.selected_route && (
                    <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
                      <p className="font-semibold text-slate-900">Selected Route: {shipment.selected_route.name}</p>
                      <p>
                        ETA: {shipment.selected_route.estimated_hours} h • Distance: {shipment.selected_route.distance_km} km • Fuel: {shipment.selected_route.fuel_liters} L
                      </p>
                    </div>
                  )}

                  <div className="mt-4 text-xs text-slate-500">
                    Carrier: {shipment.carrier_name || "Offer stage"} • Payment: {shipment.payment_status}
                    {shipment.estimated_arrival ? ` • ETA ${new Date(shipment.estimated_arrival).toLocaleString()}` : ""}
                  </div>
                  {shipment.payout_status === "pending_connect_account" && (
                    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                      <p className="font-semibold">Add a Stripe payout account (bank or debit card) to receive released funds.</p>
                      <button
                        type="button"
                        onClick={() => void startPayoutOnboarding()}
                        disabled={connectSetupLoading}
                        className="rounded-md border border-amber-300 bg-white px-2.5 py-1 font-semibold hover:bg-amber-100 disabled:opacity-60"
                      >
                        {connectSetupLoading ? "Opening Stripe..." : "Add Bank/Debit for Payout"}
                      </button>
                    </div>
                  )}
                  </div>
                </div>
              ))}
            </div>
          </article>
        )}

        {isSubscriptionActive && activeTab === "tracking" && (
          <section className="space-y-6">
            <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold">Live Shipment Map</h2>
                  <p className="mt-1 text-xs text-slate-500">
                    Track active shipments with driver coordinates, ETA, and route history.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={selectedTrackingRow?.shipment_id || ""}
                    onChange={(event) => setSelectedTrackingShipmentId(event.target.value)}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700"
                  >
                    {liveTrackingRows.length === 0 && <option value="">No tracked shipments</option>}
                    {liveTrackingRows.map((row) => (
                      <option key={row.shipment_id} value={row.shipment_id}>
                        {row.shipment_origin} to {row.shipment_destination} ({row.driver_name})
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => {
                      if (session?.email) {
                        void loadLiveTracking(session.email);
                      }
                    }}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    {liveTrackingLoading ? "Refreshing..." : "Refresh"}
                  </button>
                </div>
              </div>

              {liveTrackingRows.length === 0 && (
                <p className="mt-4 rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
                  No live tracking available yet. Ask a driver to start tracking.
                </p>
              )}

              {selectedTrackingRow && (
                <div className="mt-5 rounded-xl border border-slate-200 p-4">
                  <div className="grid gap-5 xl:grid-cols-[2fr_1fr]">
                    <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
                      <LiveTrackingMap
                        currentLatitude={selectedTrackingRow.current_latitude}
                        currentLongitude={selectedTrackingRow.current_longitude}
                        history={selectedTrackingRow.history}
                        heightClassName="h-[460px]"
                      />
                    </div>

                    <div className="space-y-4">
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                        <p className="text-xs uppercase tracking-wide text-slate-500">Shipment Status</p>
                        <p className="mt-1 font-semibold text-slate-900">{selectedTrackingRow.shipment_origin} to {selectedTrackingRow.shipment_destination}</p>
                        <p className="mt-1 text-slate-700">Driver: {selectedTrackingRow.driver_name}</p>
                        <div className="mt-3 space-y-2">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Current Location</p>
                            <p>{selectedTrackingRow.current_location_label || "Location unavailable"}</p>
                          </div>
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Last Updated</p>
                            <p>
                              {selectedTrackingRow.last_update_at
                                ? new Date(selectedTrackingRow.last_update_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
                                : "Pending"}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Estimated Arrival</p>
                            <p>{selectedTrackingRow.eta_arrival_at ? new Date(selectedTrackingRow.eta_arrival_at).toLocaleTimeString() : "Pending"}</p>
                          </div>
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Distance Remaining</p>
                            <p>{formatRemainingDistance(selectedTrackingRow.distance_remaining_km)}</p>
                          </div>
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Tracking Status</p>
                            <p className={selectedTrackingRow.tracking_status === "Live" ? "text-emerald-700 font-semibold" : "text-amber-700 font-semibold"}>
                              {selectedTrackingRow.tracking_status}
                            </p>
                          </div>
                        </div>
                        {selectedTrackingRow.maps_directions_url && (
                          <a
                            href={selectedTrackingRow.maps_directions_url}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-3 inline-block rounded-md border border-emerald-300 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50"
                          >
                            Open Turn-by-Turn Route
                          </a>
                        )}
                      </div>

                      <div className="rounded-xl border border-slate-200 bg-white p-4">
                        <p className="text-xs uppercase tracking-wide text-slate-500">Route Timeline</p>
                        <div className="mt-3 max-h-72 space-y-2 overflow-y-auto">
                          {selectedTrackingRow.history.length === 0 && (
                            <p className="text-xs text-slate-500">No GPS ping history yet.</p>
                          )}
                          {selectedTrackingRow.history.map((point) => (
                            <div key={`${point.tracked_at}-${point.latitude}-${point.longitude}`} className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600">
                              <p className="font-semibold text-slate-800">{new Date(point.tracked_at).toLocaleString()}</p>
                              <p>{point.latitude.toFixed(5)}, {point.longitude.toFixed(5)}</p>
                              <p>{point.note || "live_update"}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {isSubscriptionActive && activeTab === "optimization" && (
          <section className="grid gap-6 lg:grid-cols-[280px_1fr]">
            <aside className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold">Route Optimization</h2>
                  <p className="mt-1 text-xs text-slate-500">Pick a shipment to inspect shipper details and rank routes.</p>
                </div>
                <button
                  type="button"
                  onClick={() => void loadShipments()}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                >
                  {loading ? "Refreshing..." : "Refresh"}
                </button>
              </div>

              <div className="mt-4 space-y-2">
                {optimizationShipments.length === 0 && (
                  <p className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                    No shipments available for route analysis.
                  </p>
                )}
                {optimizationShipments.map((shipment) => {
                  const isSelected = shipment.id === optimizationShipmentId;
                  return (
                    <button
                      key={shipment.id}
                      type="button"
                      onClick={() => {
                        setOptimizationShipmentId(shipment.id);
                        setRouteAnalysis(null);
                      }}
                      className={`w-full rounded-xl border px-4 py-3 text-left transition ${
                        isSelected
                          ? "border-emerald-700 bg-emerald-50"
                          : "border-slate-200 bg-white hover:bg-slate-50"
                      }`}
                    >
                      <p className="text-sm font-semibold text-slate-900">{shipment.origin} to {shipment.destination}</p>
                      <p className="mt-1 text-xs text-slate-500">{shipment.client_name} • {shipment.cargo_type}</p>
                      <p className="mt-1 text-xs text-slate-400">
                        {toLbFromKg(shipment.weight_kg).toLocaleString()} lb • {shipment.time_window}
                      </p>
                    </button>
                  );
                })}
              </div>
            </aside>

            <article className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
              {!selectedOptimizationShipment && (
                <div className="flex min-h-[280px] items-center justify-center rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
                  Select a shipment to see shipper details and route options.
                </div>
              )}

              {selectedOptimizationShipment && (
                <div className="space-y-6">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-wider text-emerald-700">Shipper Information</p>
                      <h3 className="mt-1 text-2xl font-semibold text-slate-900">{selectedOptimizationShipment.client_name}</h3>
                      <p className="mt-1 text-sm text-slate-600">
                        {selectedOptimizationShipment.origin} to {selectedOptimizationShipment.destination}
                      </p>
                    </div>
                    <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-700">
                      <p><span className="font-semibold">Cargo:</span> {selectedOptimizationShipment.cargo_type}</p>
                      <p><span className="font-semibold">Weight:</span> {toLbFromKg(selectedOptimizationShipment.weight_kg).toLocaleString()} lb ({selectedOptimizationShipment.weight_kg.toLocaleString()} kg)</p>
                      <p><span className="font-semibold">Time window:</span> {selectedOptimizationShipment.time_window}</p>
                      <p><span className="font-semibold">Status:</span> {statusLabel[selectedOptimizationShipment.status]}</p>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-3">
                    {modeOptions.map((mode) => (
                      <button
                        key={mode.value}
                        type="button"
                        onClick={() => {
                          setOptimizationMode(mode.value);
                          void loadRouteAnalysis(selectedOptimizationShipment.id, mode.value);
                        }}
                        className={`rounded-xl border px-4 py-3 text-left text-sm font-semibold transition ${
                          optimizationMode === mode.value
                            ? "border-emerald-700 bg-emerald-50 text-emerald-800"
                            : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                        }`}
                      >
                        <span className="block">{mode.label}</span>
                      </button>
                    ))}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void loadRouteAnalysis(selectedOptimizationShipment.id, optimizationMode)}
                      className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-600"
                    >
                      {routeAnalysisLoading ? "Analyzing..." : "Analyze Routes"}
                    </button>
                    {selectedOptimizationShipment.carrier_name?.toLowerCase() === session?.displayName.toLowerCase() && (
                      <button
                        type="button"
                        onClick={() => void onOptimize(selectedOptimizationShipment.id, optimizationMode)}
                        className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                      >
                        Apply Best Route
                      </button>
                    )}
                  </div>

                  {routeAnalysis && displayedRouteAnalysis && (
                    <div className="space-y-4">
                      <div className="rounded-xl bg-emerald-50 p-4">
                        <p className="text-xs uppercase tracking-wider text-emerald-700">
                          {displayedRouteAnalysis.activeRoute.name === displayedRouteAnalysis.recommended.name ? "Recommended Route" : "Selected Route"}
                        </p>
                        <h4 className="mt-1 text-xl font-semibold text-emerald-900">{displayedRouteAnalysis.activeRoute.name}</h4>
                        <p className="mt-1 text-sm text-emerald-900">
                          {displayedRouteAnalysis.activeRoute.recommendation_reason}
                        </p>
                        <p className="mt-2 text-xs font-medium text-emerald-700">
                          Fuel pricing source: {activeFuelPriceSourceLabel} (${activeFuelPricePerLiterUsd.toFixed(3)}/L)
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {routeBenchmarks && routeDecisionLabels(
                            displayedRouteAnalysis.activeRoute,
                            routeBenchmarks,
                            activeFuelPricePerLiterUsd,
                            activeOperatingProfile,
                            true
                          ).map((label) => (
                            <span key={label} className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">
                              {label}
                            </span>
                          ))}
                        </div>
                        {deliveryHealthSummary && (
                          <div className="mt-4 rounded-xl border border-emerald-200 bg-white/85 p-4">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <p className="text-xs uppercase tracking-wider text-emerald-700">Delivery Health Score</p>
                                <p className="mt-1 text-3xl font-bold text-emerald-900">{deliveryHealthSummary.healthScore} / 100</p>
                                <p className="mt-1 text-sm font-semibold text-emerald-800">Status: {deliveryHealthSummary.healthStatus}</p>
                              </div>
                              <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                                <p><span className="font-semibold">ETA:</span> {deliveryHealthSummary.etaMinutes} min</p>
                                <p><span className="font-semibold">Predicted Arrival:</span> {deliveryHealthSummary.predictedArrivalLabel}</p>
                                <p><span className="font-semibold">Arrival Confidence:</span> {deliveryHealthSummary.arrivalConfidencePct}%</p>
                                <p><span className="font-semibold">Window:</span> {deliveryHealthSummary.timeWindowLabel}</p>
                                <p><span className="font-semibold">Status:</span> {deliveryHealthSummary.onTimeStatus}</p>
                              </div>
                            </div>

                            <div className="mt-4 grid gap-3 lg:grid-cols-2">
                              <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-700">
                                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Traffic Conditions</p>
                                <p className="mt-1"><span className="font-semibold">Traffic Impact:</span> {deliveryHealthSummary.trafficImpactLabel}</p>
                                <p><span className="font-semibold">Current Delay:</span> +{deliveryHealthSummary.currentDelayMinutes} min</p>
                                <p><span className="font-semibold">Congestion Zone:</span> {deliveryHealthSummary.congestionZone}</p>
                                <p><span className="font-semibold">Recommendation:</span> {deliveryHealthSummary.aiRecommendationTitle}</p>
                              </div>

                              <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-700">
                                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Weather Risk</p>
                                <p className="mt-1"><span className="font-semibold">Weather Risk:</span> {deliveryHealthSummary.weatherRiskLabel}</p>
                                <p>{deliveryHealthSummary.weatherRiskText}</p>
                                <p>{deliveryHealthSummary.weatherDelayRangeLabel}</p>
                              </div>

                              <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-700">
                                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Operating Cost</p>
                                <p className="mt-1"><span className="font-semibold">Estimated Fuel Usage:</span> {deliveryHealthSummary.estimatedFuelLiters.toFixed(1)} L</p>
                                <p><span className="font-semibold">Estimated Fuel Cost:</span> ${deliveryHealthSummary.estimatedFuelCostUsd.toFixed(2)}</p>
                                <p><span className="font-semibold">Tolls:</span> ${displayedRouteAnalysis.activeRoute.toll_usd.toFixed(2)}</p>
                                <p><span className="font-semibold">Total Operating Cost:</span> ${deliveryHealthSummary.totalOperatingCostUsd.toFixed(2)}</p>
                              </div>

                              <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-700">
                                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Route Risk Analysis</p>
                                <p className="mt-1"><span className="font-semibold">Route Risk:</span> {deliveryHealthSummary.routeRiskLabel}</p>
                                <p><span className="font-semibold">Traffic Risk:</span> {deliveryHealthSummary.trafficRiskLabel}</p>
                                <p><span className="font-semibold">Weather Risk:</span> {deliveryHealthSummary.weatherRiskLabel}</p>
                                <p><span className="font-semibold">Road Closure Risk:</span> {deliveryHealthSummary.roadClosureRiskLabel}</p>
                                <p><span className="font-semibold">Construction Zones:</span> {deliveryHealthSummary.constructionZones}</p>
                              </div>
                            </div>

                            <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-700">
                              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Shipment Suitability</p>
                              <p className="mt-1"><span className="font-semibold">Cargo Sensitivity:</span> {deliveryHealthSummary.cargoSensitivity}</p>
                              <p><span className="font-semibold">Recommendation:</span> {deliveryHealthSummary.cargoRecommendation}</p>
                            </div>

                            <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
                              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">AI Recommendation</p>
                              <p className="mt-1 font-semibold">{deliveryHealthSummary.aiRecommendationTitle}</p>
                              <p className="mt-1">{deliveryHealthSummary.aiRecommendationBody}</p>
                            </div>
                          </div>
                        )}
                        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
                          <div className="rounded-lg bg-white/80 p-3">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">ETA</p>
                            <p className="mt-1 text-lg font-semibold text-emerald-950">{displayedRouteAnalysis.activeRoute.estimated_hours} h</p>
                            <p className="text-xs text-emerald-800">Traffic delay {displayedRouteAnalysis.activeRoute.traffic_delay_minutes} min</p>
                          </div>
                          <div className="rounded-lg bg-white/80 p-3">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">Distance</p>
                            <p className="mt-1 text-lg font-semibold text-emerald-950">{displayedRouteAnalysis.activeRoute.distance_km} km</p>
                            <p className="text-xs text-emerald-800">Weight {toLbFromKg(selectedOptimizationShipment.weight_kg).toLocaleString()} lb</p>
                          </div>
                          <div className="rounded-lg bg-white/80 p-3">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">Fuel Cost</p>
                            <p className="mt-1 text-lg font-semibold text-emerald-950">${calculateFuelCostUsd(displayedRouteAnalysis.activeRoute, activeFuelPricePerLiterUsd, activeOperatingProfile).toFixed(2)}</p>
                            <p className="text-xs text-emerald-800">Fuel used {adjustedFuelLiters(displayedRouteAnalysis.activeRoute, activeOperatingProfile).toFixed(1)} L (profile-adjusted)</p>
                          </div>
                          <div className="rounded-lg bg-white/80 p-3">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">Total Route Cost</p>
                            <p className="mt-1 text-lg font-semibold text-emerald-950">${calculateTotalRouteCostUsd(displayedRouteAnalysis.activeRoute, activeFuelPricePerLiterUsd, activeOperatingProfile).toFixed(2)}</p>
                            <p className="text-xs text-emerald-800">Fuel + tolls + maintenance + driver</p>
                          </div>
                          <div className="rounded-lg bg-white/80 p-3">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">Operational Cost Impact</p>
                            <p className="mt-1 text-lg font-semibold text-emerald-950">
                              ${calculateTotalRouteCostUsd(displayedRouteAnalysis.activeRoute, activeFuelPricePerLiterUsd, activeOperatingProfile).toFixed(2)}
                            </p>
                            <p className="text-xs text-emerald-800">
                              Cost to execute under current fuel/toll conditions
                            </p>
                          </div>
                          <div className="rounded-lg bg-white/80 p-3">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">Efficiency Score</p>
                            <p className="mt-1 text-lg font-semibold text-emerald-950">
                              {routeBenchmarks ? calculateEfficiencyScore(displayedRouteAnalysis.activeRoute, routeBenchmarks, activeFuelPricePerLiterUsd, activeOperatingProfile) : 0} / 100
                            </p>
                            <p className="text-xs text-emerald-800">
                              Best balance of time, fuel, risk, and operational cost
                            </p>
                          </div>
                        </div>
                        <div className="mt-3 flex flex-wrap items-center gap-3">
                          <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ring-1 ${weatherRiskTone(displayedRouteAnalysis.activeRoute.weather_risk)}`}>
                            Weather Risk: {weatherImpactContext(displayedRouteAnalysis.activeRoute.weather_risk).label}
                          </span>
                          <span className="text-sm font-medium text-emerald-950">
                            {weatherImpactContext(displayedRouteAnalysis.activeRoute.weather_risk).detail}
                          </span>
                        </div>
                        <div className="mt-3 h-2 w-full rounded-full bg-emerald-100/70">
                          <div
                            className={`h-2 rounded-full ${weatherRiskBarTone(displayedRouteAnalysis.activeRoute.weather_risk)}`}
                            style={{ width: `${Math.max(8, Math.round(displayedRouteAnalysis.activeRoute.weather_risk * 100))}%` }}
                          />
                        </div>
                        <p className="mt-3 text-sm text-emerald-900">{weatherImpactContext(displayedRouteAnalysis.activeRoute.weather_risk).impact}</p>
                      </div>

                      {displayedRouteAnalysis.hiddenCount > 0 && (
                        <p className="rounded-lg border border-dashed border-slate-300 p-3 text-xs text-slate-600">
                          Hidden {displayedRouteAnalysis.hiddenCount} near-identical route option{displayedRouteAnalysis.hiddenCount === 1 ? "" : "s"} to keep ranking meaningful.
                        </p>
                      )}

                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                        <p className="text-xs uppercase tracking-wider text-slate-500">Shipper Operations Profile</p>
                        <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                          <p className="text-sm text-slate-700"><span className="font-semibold">Operational Reliability:</span> {selectedShipperInsights?.operationalReliability ?? 60}/100</p>
                          <p className="text-sm text-slate-700"><span className="font-semibold">Previous Loads:</span> {selectedShipperInsights?.previousLoads ?? 0}</p>
                          <p className="text-sm text-slate-700"><span className="font-semibold">Completed Loads:</span> {selectedShipperInsights?.deliveredLoads ?? 0}</p>
                          <p className="text-sm text-slate-700"><span className="font-semibold">Active Loads:</span> {selectedShipperInsights?.activeLoads ?? 0}</p>
                          <p className="text-sm text-slate-700"><span className="font-semibold">Cargo Type:</span> {selectedOptimizationShipment.cargo_type}</p>
                        </div>
                      </div>

                      {displayedRouteAnalysis.alternatives.length > 0 && (
                        <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-3">
                          <p className="text-sm text-slate-700">Alternative routes available: {displayedRouteAnalysis.alternatives.length}</p>
                          <button
                            type="button"
                            onClick={() => setShowAlternativeRoutes((prev) => !prev)}
                            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                          >
                            {showAlternativeRoutes ? "Hide Alternatives" : "View Alternatives"}
                          </button>
                        </div>
                      )}

                      {showAlternativeRoutes && displayedRouteAnalysis.alternatives.length > 0 && (
                        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                          {displayedRouteAnalysis.alternatives.map((route, index) => (
                          <div
                            key={route.name}
                            className={`rounded-xl border p-4 ${selectedRouteName === route.name ? "border-emerald-600 bg-emerald-50" : "border-slate-200 bg-white"}`}
                          >
                            <p className="text-xs uppercase tracking-wider text-slate-500">Alternative {index + 1}</p>
                            <h5 className="mt-1 text-lg font-semibold text-slate-900">{route.name}</h5>
                            <p className="mt-1 text-xs text-slate-500">{route.recommendation_reason}</p>
                            {routeBenchmarks && (
                              <div className="mt-2 flex flex-wrap gap-1">
                                {routeDecisionLabels(route, routeBenchmarks, activeFuelPricePerLiterUsd, activeOperatingProfile, false).map((label) => (
                                  <span key={label} className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                                    {label}
                                  </span>
                                ))}
                              </div>
                            )}
                            <button
                              type="button"
                              onClick={() => setSelectedRouteName(route.name)}
                              className="mt-3 rounded-md border border-emerald-700 px-3 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-50"
                            >
                              {selectedRouteName === route.name ? "Selected" : "Select This Route"}
                            </button>
                            <p className="mt-2 text-xs text-slate-500">{routeDifferenceSummary(displayedRouteAnalysis.activeRoute, route)}</p>
                            <div className="mt-3 flex items-center justify-between gap-2">
                              <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ${weatherRiskTone(route.weather_risk)}`}>
                                Weather Risk: {weatherImpactContext(route.weather_risk).label}
                              </span>
                              <span className="text-xs font-semibold text-slate-600">{Math.round(route.weather_risk * 100)}%</span>
                            </div>
                            <div className="mt-2 h-2 w-full rounded-full bg-slate-100">
                              <div
                                className={`h-2 rounded-full ${weatherRiskBarTone(route.weather_risk)}`}
                                style={{ width: `${Math.max(8, Math.round(route.weather_risk * 100))}%` }}
                              />
                            </div>
                            <div className="mt-3 space-y-1 text-sm text-slate-700">
                              <p>ETA: {route.estimated_hours} h</p>
                              <p>Distance: {route.distance_km} km</p>
                              <p>Traffic delay: {route.traffic_delay_minutes} min</p>
                              <p>Fuel Cost: ${calculateFuelCostUsd(route, activeFuelPricePerLiterUsd, activeOperatingProfile).toFixed(2)}</p>
                              <p>Fuel Used: {adjustedFuelLiters(route, activeOperatingProfile).toFixed(1)} L</p>
                              <p>Tolls: ${route.toll_usd.toFixed(2)}</p>
                              <p>Total Route Cost: ${calculateTotalRouteCostUsd(route, activeFuelPricePerLiterUsd, activeOperatingProfile).toFixed(2)}</p>
                              <p>Efficiency Score: {routeBenchmarks ? calculateEfficiencyScore(route, routeBenchmarks, activeFuelPricePerLiterUsd, activeOperatingProfile) : 0} / 100</p>
                              <p className="text-xs text-slate-500">{weatherImpactContext(route.weather_risk).impact}</p>
                            </div>
                          </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {!routeAnalysis && !routeAnalysisLoading && (
                    <p className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                      Click Analyze Routes to calculate traffic, weather, and weight-aware route options.
                    </p>
                  )}
                </div>
              )}
            </article>
          </section>
        )}

        {isSubscriptionActive && activeTab === "payments" && (
          <section className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Total Earned</p>
                <p className="mt-2 text-3xl font-bold text-emerald-700">
                  ${totalEarned.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
                <p className="mt-1 text-xs text-slate-400">Paid shipments</p>
              </div>
              <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Pending Payment</p>
                <p className="mt-2 text-3xl font-bold text-amber-600">
                  ${totalPending.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
                <p className="mt-1 text-xs text-slate-400">Awaiting client payment</p>
              </div>
              <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Quoted Shipments</p>
                <p className="mt-2 text-3xl font-bold text-slate-900">{shipmentsWithQuotes.length}</p>
                <p className="mt-1 text-xs text-slate-400">Have a price quote</p>
              </div>
            </div>

            <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
              <h2 className="text-xl font-semibold">Payment Summary</h2>
              <p className="mt-1 text-xs text-slate-500">All shipments with a generated quote.</p>

              <div className="mt-5 space-y-3">
                {shipmentsWithQuotes.length === 0 && (
                  <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
                    No quoted shipments yet.
                  </p>
                )}
                {shipmentsWithQuotes.map((shipment) => {
                  const q = shipment.quote_breakdown!;
                  const isPaid = shipment.payment_status === "paid";
                  return (
                    <div key={shipment.id} className="rounded-xl border border-slate-200 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="font-semibold text-slate-900">{shipment.origin} to {shipment.destination}</p>
                          <p className="mt-0.5 text-xs text-slate-500">
                            {shipment.client_name} • {shipment.cargo_type} • {new Date(shipment.created_at).toLocaleDateString()}
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <p className="text-lg font-bold text-slate-900">${q.total_usd.toFixed(2)}</p>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                              isPaid ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                            }`}
                          >
                            {isPaid ? "Paid" : "Pending"}
                          </span>
                        </div>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-slate-500 sm:grid-cols-4">
                        <div>
                          <span className="font-medium text-slate-700">Base freight</span>
                          <br />${q.base_freight_usd.toFixed(2)}
                        </div>
                        <div>
                          <span className="font-medium text-slate-700">Urgency</span>
                          <br />${q.urgency_surcharge_usd.toFixed(2)}
                        </div>
                        <div>
                          <span className="font-medium text-slate-700">Distance</span>
                          <br />${q.distance_surcharge_usd.toFixed(2)}
                        </div>
                        <div>
                          <span className="font-medium text-slate-700">Service fee</span>
                          <br />${q.service_fee_usd.toFixed(2)}
                        </div>
                      </div>
                      <p className="mt-2 text-xs text-slate-500">
                        POD: <span className="font-semibold text-slate-700">{shipment.pod_status || "pending"}</span> • Payout: <span className="font-semibold text-slate-700">{shipment.payout_status || "pending"}</span>
                      </p>
                      {shipment.payout_status === "pending_connect_account" && (
                        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                          <p className="font-semibold">Payout account required to receive released funds.</p>
                          <button
                            type="button"
                            onClick={() => void startPayoutOnboarding()}
                            disabled={connectSetupLoading}
                            className="rounded-md border border-amber-300 bg-white px-2.5 py-1 font-semibold hover:bg-amber-100 disabled:opacity-60"
                          >
                            {connectSetupLoading ? "Opening Stripe..." : "Add Bank/Debit for Payout"}
                          </button>
                        </div>
                      )}
                      {shipment.pod_status === "carrier_confirmed" && shipment.payout_release_eligible_at && (
                        <p className="mt-1 text-xs text-indigo-700">
                          Review window active until {new Date(shipment.payout_release_eligible_at).toLocaleString()}.
                        </p>
                      )}
                      {q.notes && <p className="mt-2 text-xs text-slate-400">{q.notes}</p>}
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        )}

        {isSubscriptionActive && activeTab === "transactions" && (
          <section className="space-y-6">
            <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold">Own Transaction History</h2>
                  <p className="mt-1 text-xs text-slate-500">
                    Your payout and void activity separated from invoice records.
                  </p>
                </div>
                <button
                  onClick={() => void loadShipments()}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                >
                  {loading ? "Refreshing..." : "Refresh"}
                </button>
              </div>

              <div className="mt-5 space-y-3">
                {ownTransactions.length === 0 && (
                  <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
                    No transactions yet.
                  </p>
                )}

                {ownTransactions.map(({ shipment, transactionRef, kind, detail, amountUsd }) => (
                  <div key={`txn-${shipment.id}`} className="rounded-xl border border-slate-200 bg-white p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{shipment.origin} to {shipment.destination}</p>
                        <p className="mt-1 text-xs text-slate-500">{new Date(shipment.updated_at).toLocaleString()} • {transactionRef}</p>
                      </div>
                      <div className="text-right">
                        <p className={`text-sm font-semibold ${kind === "purchase" ? "text-emerald-700" : "text-rose-700"}`}>
                          {kind === "purchase" ? "Purchase" : "Void"}
                        </p>
                        <p className="text-lg font-bold text-slate-900">${amountUsd.toFixed(2)}</p>
                      </div>
                    </div>
                    <p className="mt-2 text-xs text-slate-600">
                      <span className="font-semibold text-slate-700">Detail:</span> {detail}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {isSubscriptionActive && activeTab === "documents" && (
          <section className="space-y-6">
            <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold">Driver Uploads</h2>
                  <p className="mt-1 text-xs text-slate-500">
                    Documents uploaded by drivers after token login.
                  </p>
                </div>
                <button
                  onClick={() => {
                    if (session?.email) {
                      void loadDriverData(session.email);
                    }
                  }}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                >
                  {driverOpsLoading ? "Refreshing..." : "Refresh Driver Uploads"}
                </button>
              </div>

              <div className="mt-4 space-y-3">
                {driverDocuments.length === 0 && (
                  <p className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                    No driver uploads yet.
                  </p>
                )}
                {driverDocuments.map((doc) => (
                  <div key={doc.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{doc.document_name}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          Driver {doc.driver_name} • {doc.driver_mobile} • {new Date(doc.created_at).toLocaleString()}
                        </p>
                      </div>
                      <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
                        {doc.document_type}
                      </span>
                    </div>
                    {doc.notes && <p className="mt-2 text-xs text-slate-600"><span className="font-semibold">Notes:</span> {doc.notes}</p>}
                    {doc.content_text && (
                      <pre className="mt-2 overflow-x-auto rounded-lg bg-white p-3 text-xs text-slate-700 ring-1 ring-slate-200">
                        {doc.content_text}
                      </pre>
                    )}
                    {doc.file_base64 && (
                      <a
                        href={`data:${doc.file_mime_type || "application/octet-stream"};base64,${doc.file_base64}`}
                        download={doc.document_name}
                        className="mt-3 inline-flex rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-white"
                      >
                        Download document
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold">Invoices</h2>
                  <p className="mt-1 text-xs text-slate-500">
                    Auto-generated invoices for all quoted shipments you have carried.
                  </p>
                </div>
                <button
                  onClick={() => void loadShipments()}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                >
                  {loading ? "Refreshing..." : "Refresh"}
                </button>
              </div>

              <div className="mt-5 space-y-3">
                {documentInvoices.length === 0 && (
                  <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
                    No paid invoices yet. Completed shipper payments will appear here automatically.
                  </p>
                )}
                {documentInvoices.map(({ shipment, invoiceNum, transactionRef, paymentDate, amountUsd, freightChargeUsd, platformFeeUsd }) => {
                    const q = shipment.quote_breakdown!;
                    return (
                      <div key={shipment.id} className="rounded-xl border border-slate-200 bg-white p-5">
                        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Invoice</p>
                            <p className="mt-1 text-lg font-bold text-slate-900">{invoiceNum}</p>
                            <p className="mt-0.5 text-xs text-slate-500">
                              Payment Date {new Date(paymentDate).toLocaleDateString()}
                            </p>
                          </div>
                          <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">PAID</span>
                        </div>

                        <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                          <div>
                            <p className="text-xs font-semibold uppercase text-slate-400">Bill To</p>
                            <p className="mt-1 font-medium text-slate-800">{shipment.client_name}</p>
                          </div>
                          <div>
                            <p className="text-xs font-semibold uppercase text-slate-400">Carrier</p>
                            <p className="mt-1 font-medium text-slate-800">{shipment.carrier_name ?? session?.displayName}</p>
                          </div>
                          <div>
                            <p className="text-xs font-semibold uppercase text-slate-400">Load</p>
                            <p className="mt-1 text-slate-700">{shipment.load_number}</p>
                          </div>
                          <div>
                            <p className="text-xs font-semibold uppercase text-slate-400">Route</p>
                            <p className="mt-1 text-slate-700">{shipment.origin} to {shipment.destination}</p>
                          </div>
                          <div>
                            <p className="text-xs font-semibold uppercase text-slate-400">Transaction ID</p>
                            <p className="mt-1 text-slate-700">{transactionRef}</p>
                          </div>
                        </div>

                        <div className="mt-3 flex justify-end">
                          <button
                            type="button"
                            onClick={() => onViewInvoice({ invoiceNum: invoiceNum ?? "", transactionRef: transactionRef ?? "", paymentDate, shipment })}
                            className="rounded-md border border-emerald-300 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50"
                          >
                            View Invoice
                          </button>
                        </div>

                        <div className="mt-4 rounded-lg bg-slate-50 p-3">
                          <div className="space-y-1 text-sm">
                            <div className="flex justify-between text-slate-600">
                              <span>Freight charge</span>
                              <span>${freightChargeUsd.toFixed(2)}</span>
                            </div>
                            <div className="flex justify-between text-slate-600">
                              <span>Platform fee</span>
                              <span>${platformFeeUsd.toFixed(2)}</span>
                            </div>
                            <div className="mt-2 flex justify-between border-t border-slate-200 pt-2 font-bold text-slate-900">
                              <span>Total paid</span>
                              <span>${amountUsd.toFixed(2)}</span>
                            </div>
                          </div>
                        </div>

                        {q.notes && <p className="mt-2 text-xs text-slate-400">{q.notes}</p>}
                      </div>
                    );
                  })}
              </div>
            </div>

            {selectedInvoice && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
                <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
                  <div className="flex items-start justify-between gap-3 border-b border-slate-200 pb-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Invoice Preview</p>
                      <h3 className="mt-1 text-xl font-bold text-slate-900">{selectedInvoice.invoiceNum}</h3>
                      <p className="mt-1 text-xs text-slate-500">Transaction ID {selectedInvoice.transactionRef}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedInvoice(null)}
                      className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                    >
                      Close
                    </button>
                  </div>

                  <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                    <div>
                      <p className="text-xs font-semibold uppercase text-slate-400">Bill To</p>
                      <p className="mt-1 font-medium text-slate-800">{selectedInvoice.shipment.client_name}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase text-slate-400">Carrier</p>
                      <p className="mt-1 font-medium text-slate-800">{selectedInvoice.shipment.carrier_name ?? session?.displayName}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase text-slate-400">Load</p>
                      <p className="mt-1 text-slate-700">{selectedInvoice.shipment.load_number}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase text-slate-400">Route</p>
                      <p className="mt-1 text-slate-700">{selectedInvoice.shipment.origin} to {selectedInvoice.shipment.destination}</p>
                    </div>
                  </div>

                  {selectedInvoice.shipment.quote_breakdown && (
                    <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm">
                      <div className="space-y-1">
                        <div className="flex justify-between text-slate-600"><span>Base freight</span><span>${selectedInvoice.shipment.quote_breakdown.base_freight_usd.toFixed(2)}</span></div>
                        <div className="flex justify-between text-slate-600"><span>Urgency surcharge</span><span>${selectedInvoice.shipment.quote_breakdown.urgency_surcharge_usd.toFixed(2)}</span></div>
                        <div className="flex justify-between text-slate-600"><span>Distance surcharge</span><span>${selectedInvoice.shipment.quote_breakdown.distance_surcharge_usd.toFixed(2)}</span></div>
                        <div className="flex justify-between text-slate-600"><span>Service fee</span><span>${selectedInvoice.shipment.quote_breakdown.service_fee_usd.toFixed(2)}</span></div>
                        <div className="mt-2 flex justify-between border-t border-slate-200 pt-2 font-bold text-slate-900"><span>Total</span><span>${selectedInvoice.shipment.quote_breakdown.total_usd.toFixed(2)}</span></div>
                      </div>
                    </div>
                  )}

                  <div className="mt-4 rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-600">
                    <p><span className="font-semibold text-slate-700">Status:</span> PAID</p>
                    <p><span className="font-semibold text-slate-700">Payment Date:</span> {new Date(selectedInvoice.paymentDate).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</p>
                    <p><span className="font-semibold text-slate-700">Transaction ID:</span> {selectedInvoice.transactionRef}</p>
                  </div>

                  <div className="mt-5 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        onDownloadInvoice({
                          invoiceNum: selectedInvoice.invoiceNum,
                          transactionRef: selectedInvoice.transactionRef,
                          paymentDate: selectedInvoice.paymentDate,
                          shipment: selectedInvoice.shipment,
                        })
                      }
                      className="rounded-md border border-emerald-300 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50"
                    >
                      Download PDF
                    </button>
                  </div>
                </div>
              </div>
            )}
          </section>
        )}

        {isSubscriptionActive && activeTab === "drivers" && (
          <section className="space-y-6">
            <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold">Find a Driver</h2>
                  <p className="mt-1 text-xs text-slate-500">
                    Enter a ZIP code to rank nearby drivers by location, availability, and delivery performance.
                  </p>
                </div>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-[1.2fr_0.7fr_auto]">
                <input
                  value={driverDiscoveryZip}
                  onChange={(event) => setDriverDiscoveryZip(event.target.value)}
                  placeholder="ZIP code"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-emerald-700"
                />
                <select
                  value={driverDiscoveryRadius}
                  onChange={(event) => setDriverDiscoveryRadius(Number(event.target.value))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-emerald-700"
                >
                  <option value={75}>75 mi</option>
                  <option value={150}>150 mi</option>
                  <option value={250}>250 mi</option>
                </select>
                <button
                  type="button"
                  onClick={handleSearchNearbyDrivers}
                  disabled={driverDiscoveryLoading}
                  className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-60"
                >
                  {driverDiscoveryLoading ? "Searching..." : "Search Drivers"}
                </button>
              </div>

              <div className="mt-5 grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
                <div className="space-y-3">
                  {driverDiscoveryResults.length === 0 && (
                    <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                      No nearby driver profiles are available yet. Drivers can complete their profile from the driver portal to appear here.
                    </div>
                  )}
                  {driverDiscoveryResults.map((driver) => (
                    <button
                      key={driver.id}
                      type="button"
                      onClick={() => setSelectedDiscoveryDriver(driver)}
                      className={`w-full rounded-xl border p-4 text-left transition ${selectedDiscoveryDriver?.id === driver.id ? "border-emerald-500 bg-emerald-50" : "border-slate-200 bg-white hover:bg-slate-50"}`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">{driver.first_name} {driver.last_name}</p>
                          <p className="mt-1 text-xs text-slate-500">{driver.city}, {driver.state} • {driver.equipment}</p>
                        </div>
                        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${driverAvailabilityBadgeClass(driver.availability)}`}>
                          {driver.availability === "available" && "Available"}
                          {driver.availability === "busy" && "Busy"}
                          {driver.availability === "unavailable" && "Unavailable"}
                        </span>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-500">
                        <span>{driver.cdl_class}</span>
                        <span>{driver.experience_years} yrs</span>
                        <span>{driver.rating.toFixed(1)} ★</span>
                      </div>
                    </button>
                  ))}
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  {selectedDiscoveryDriver ? (
                    <div className="space-y-4">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Driver profile</p>
                        <h3 className="mt-1 text-lg font-semibold text-slate-900">{selectedDiscoveryDriver.first_name} {selectedDiscoveryDriver.last_name}</h3>
                        <p className="mt-1 text-sm text-slate-600">{selectedDiscoveryDriver.address} • {selectedDiscoveryDriver.city}, {selectedDiscoveryDriver.state} {selectedDiscoveryDriver.zip_code}</p>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-600">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-slate-900">Availability</span>
                          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${driverAvailabilityBadgeClass(selectedDiscoveryDriver.availability)}`}>
                            {selectedDiscoveryDriver.availability === "available" && "Available"}
                            {selectedDiscoveryDriver.availability === "busy" && "Busy"}
                            {selectedDiscoveryDriver.availability === "unavailable" && "Unavailable"}
                          </span>
                        </div>
                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                          <p><span className="font-semibold text-slate-700">Equipment:</span> {selectedDiscoveryDriver.equipment}</p>
                          <p><span className="font-semibold text-slate-700">Capacity:</span> {selectedDiscoveryDriver.capacity}</p>
                          <p><span className="font-semibold text-slate-700">CDL:</span> {selectedDiscoveryDriver.cdl_class}</p>
                          <p><span className="font-semibold text-slate-700">Radius:</span> {selectedDiscoveryDriver.operating_radius_miles} mi</p>
                        </div>
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-slate-900">Qualifications</p>
                        <p className="mt-1 text-sm text-slate-600">{selectedDiscoveryDriver.qualifications.join(", ")}</p>
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-slate-900">Performance</p>
                        <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-600">
                          <span className="rounded-full bg-white px-2.5 py-1">{selectedDiscoveryDriver.completed_loads} loads</span>
                          <span className="rounded-full bg-white px-2.5 py-1">{selectedDiscoveryDriver.on_time_delivery_pct}% on time</span>
                          <span className="rounded-full bg-white px-2.5 py-1">{selectedDiscoveryDriver.rating.toFixed(1)} ★ rating</span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-slate-500">Select a driver to review their profile and equipment fit.</p>
                  )}
                </div>
              </div>
            </div>

            <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold">Driver Access</h2>
                  <p className="mt-1 text-xs text-slate-500">
                    Register driver name and mobile, then generate a token to share for driver login.
                  </p>
                </div>
                <Link
                  href="/driver"
                  className="rounded-lg border border-emerald-300 px-3 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-50"
                >
                  Open Driver Login Page
                </Link>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <input
                  value={driverForm.driver_name}
                  onChange={(event) => setDriverForm((prev) => ({ ...prev, driver_name: event.target.value }))}
                  placeholder="Driver name"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-emerald-700"
                />
                <input
                  value={driverForm.driver_mobile}
                  onChange={(event) => setDriverForm((prev) => ({ ...prev, driver_mobile: event.target.value }))}
                  placeholder="Driver mobile"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-emerald-700"
                />
                <button
                  type="button"
                  onClick={() => void onGenerateDriverToken()}
                  className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-600"
                >
                  Generate Driver Token
                </button>
              </div>

              <div className="mt-3 text-xs text-slate-500">
                Use Regenerate Token on any registered driver below if the original token was lost.
              </div>

              {latestGeneratedDriverToken && (
                <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  <p className="font-semibold">Latest Token</p>
                  <p className="mt-1 font-mono tracking-wide">{latestGeneratedDriverToken}</p>
                  <p className="mt-1 text-xs">Share this token securely with the driver.</p>
                </div>
              )}
            </div>

            <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold">Registered Drivers</h3>
                  <p className="mt-1 text-xs text-slate-500">Driver token and activity overview.</p>
                </div>
                <button
                  onClick={() => {
                    if (session?.email) {
                      void loadDriverData(session.email);
                    }
                  }}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                >
                  {driverOpsLoading ? "Refreshing..." : "Refresh"}
                </button>
              </div>

              <div className="mt-4 space-y-3">
                {carrierDrivers.length === 0 && (
                  <p className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                    No drivers registered yet.
                  </p>
                )}
                {carrierDrivers.map((driver) => (
                  <div
                    key={driver.id}
                    className="rounded-xl border border-slate-200 p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{driver.driver_name}</p>
                        <p className="mt-1 text-xs text-slate-500">Mobile {driver.driver_mobile}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void onRegenerateSelectedDriverToken(driver.id)}
                        className="rounded-md border border-emerald-300 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50"
                      >
                        Regenerate Token
                      </button>
                      <div className="text-right text-xs text-slate-500">
                        <p>Token expires: {driver.token_expires_at ? new Date(driver.token_expires_at).toLocaleString() : "No active token"}</p>
                        <p>Last login: {driver.last_login_at ? new Date(driver.last_login_at).toLocaleString() : "Never"}</p>
                        <p>Tracking started: {driver.tracking_started_at ? new Date(driver.tracking_started_at).toLocaleString() : "Not started"}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {activeTab === "profile" && (
          <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-xl font-semibold">Carrier Profile</h2>
              <button
                onClick={() => void saveProfile()}
                disabled={profileSaving || !session?.email}
                className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
              >
                {profileSaving ? "Saving..." : "Save Profile"}
              </button>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {profile ? `Last updated ${new Date(profile.updated_at).toLocaleString()}` : "Load your profile to customize operations."}
            </p>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <input
                value={profileForm.full_name}
                onChange={(event) => setProfileForm((prev) => ({ ...prev, full_name: event.target.value }))}
                placeholder="Full name"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-emerald-700"
              />
              <input
                value={profileForm.company_name}
                onChange={(event) => setProfileForm((prev) => ({ ...prev, company_name: event.target.value }))}
                placeholder="Company name"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-emerald-700"
              />
              <input
                value={profileForm.tax_id}
                onChange={(event) => setProfileForm((prev) => ({ ...prev, tax_id: event.target.value }))}
                placeholder="EIN / Tax ID"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-emerald-700"
              />
              <input
                value={profileForm.dot_number}
                onChange={(event) => setProfileForm((prev) => ({ ...prev, dot_number: event.target.value }))}
                placeholder="USDOT number"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-emerald-700"
              />
              <input
                value={profileForm.phone}
                onChange={(event) => setProfileForm((prev) => ({ ...prev, phone: event.target.value }))}
                placeholder="Phone"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-emerald-700"
              />
              <div ref={streetInputWrapRef} className="relative">
                <input
                  value={profileForm.street}
                  onFocus={() => {
                    if (streetSuggestions.length > 0) {
                      setStreetOpen(true);
                    }
                  }}
                  onChange={(event) => onStreetInputChange(event.target.value)}
                  placeholder="Street"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-emerald-700"
                />
                {streetOpen && (
                  <div className="absolute z-40 mt-1 max-h-52 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                    {streetLoading && <p className="px-3 py-2 text-xs text-slate-500">Searching addresses...</p>}
                    {!streetLoading && streetSuggestions.length === 0 && (
                      <p className="px-3 py-2 text-xs text-slate-500">Type at least 3 letters</p>
                    )}
                    {!streetLoading && streetSuggestions.map((item) => (
                      <button
                        key={item.place_id}
                        type="button"
                        onClick={() => chooseStreetSuggestion(item)}
                        className="block w-full px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-100"
                      >
                        {item.description}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div ref={cityInputWrapRef} className="relative">
                <input
                  value={profileForm.city}
                  onFocus={() => {
                    if (citySuggestions.length > 0) {
                      setCityOpen(true);
                    }
                  }}
                  onChange={(event) => onCityInputChange(event.target.value)}
                  placeholder="City"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-emerald-700"
                />
                {cityOpen && (
                  <div className="absolute z-40 mt-1 max-h-52 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                    {cityLoading && <p className="px-3 py-2 text-xs text-slate-500">Searching cities...</p>}
                    {!cityLoading && citySuggestions.length === 0 && (
                      <p className="px-3 py-2 text-xs text-slate-500">Type at least 3 letters</p>
                    )}
                    {!cityLoading && citySuggestions.map((item) => (
                      <button
                        key={item.place_id}
                        type="button"
                        onClick={() => chooseCitySuggestion(item)}
                        className="block w-full px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-100"
                      >
                        {item.description}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <select
                value={profileForm.state}
                onChange={(event) => {
                  setStreetPlaceId(null);
                  setCityPlaceId(null);
                  setProfileForm((prev) => ({ ...prev, state: event.target.value }));
                }}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 outline-none focus:border-emerald-700"
              >
                <option value="">State</option>
                {US_STATE_CODES.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
              <input
                value={profileForm.postal_code}
                onChange={(event) => {
                  setStreetPlaceId(null);
                  setCityPlaceId(null);
                  setProfileForm((prev) => ({ ...prev, postal_code: event.target.value }));
                }}
                placeholder="ZIP"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-emerald-700"
              />
              <select
                value={profileForm.country}
                onChange={(event) => {
                  setStreetPlaceId(null);
                  setCityPlaceId(null);
                  setProfileForm((prev) => ({ ...prev, country: event.target.value }));
                }}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 outline-none focus:border-emerald-700"
              >
                <option value="US">US</option>
              </select>
              <div className="md:col-span-2 space-y-2 rounded-lg border border-slate-300 bg-white p-3">
                <p className="text-xs font-medium text-slate-700">Service regions (State, Country)</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <select
                    value={profileForm.service_region_state}
                    onChange={(event) => setProfileForm((prev) => ({ ...prev, service_region_state: event.target.value }))}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 outline-none focus:border-emerald-700"
                  >
                    <option value="">State</option>
                    {US_STATE_CODES.map((code) => (
                      <option key={code} value={code}>
                        {code}
                      </option>
                    ))}
                  </select>
                  <select
                    value={profileForm.service_region_country}
                    onChange={(event) => setProfileForm((prev) => ({ ...prev, service_region_country: event.target.value }))}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 outline-none focus:border-emerald-700"
                  >
                    <option value="US">US</option>
                    <option value="CA">CA</option>
                    <option value="MX">MX</option>
                  </select>
                  <button
                    type="button"
                    onClick={addServiceRegion}
                    className="rounded-lg border border-emerald-700 px-3 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-50"
                  >
                    Add Region
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {profileForm.service_regions.length === 0 && (
                    <span className="text-xs text-slate-500">No regions added yet.</span>
                  )}
                  {profileForm.service_regions.map((region) => (
                    <span key={region} className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700">
                      {region}
                      <button
                        type="button"
                        onClick={() => removeServiceRegion(region)}
                        className="font-semibold text-slate-500 hover:text-slate-900"
                        aria-label={`Remove ${region}`}
                      >
                        x
                      </button>
                    </span>
                  ))}
                </div>
              </div>
              <div className="max-w-[180px]">
                <input
                  type="number"
                  min={0}
                  value={profileForm.available_trucks}
                  onChange={(event) => setProfileForm((prev) => ({ ...prev, available_trucks: event.target.value }))}
                  placeholder="Available trucks"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-emerald-700"
                />
              </div>
              <div className="space-y-1">
                <div className="rounded-lg border border-slate-300 bg-white p-2">
                  <p className="mb-2 text-xs font-medium text-slate-700">Truck types</p>
                  <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                    {truckTypeOptions.map((option) => (
                      <label key={option.value} className="flex items-center gap-2 rounded px-2 py-1 hover:bg-slate-50">
                        <input
                          type="checkbox"
                          checked={profileForm.vehicle_types.includes(option.value)}
                          onChange={() => toggleCarrierVehicleType(option.value)}
                          className="h-4 w-4 rounded border-slate-300 text-emerald-700 focus:ring-emerald-700"
                        />
                        <span className="text-sm text-slate-700">{option.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <p className="text-xs text-slate-500">Select one or more truck types.</p>
              </div>
              <input
                type="number"
                min={1}
                value={profileForm.max_weight_kg}
                onChange={(event) => setProfileForm((prev) => ({ ...prev, max_weight_kg: event.target.value }))}
                placeholder="Max weight (kg)"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-emerald-700"
              />
              <div className="md:col-span-2 rounded-lg border border-slate-300 bg-slate-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Operating Profile</p>
                <p className="mt-1 text-xs text-slate-500">
                  These values personalize route cost modeling to your fleet economics.
                </p>
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <label className="space-y-1">
                    <span className="text-xs font-medium text-slate-700">Fuel efficiency (km/L)</span>
                    <input
                      type="number"
                      min={0.5}
                      step={0.1}
                      value={profileForm.fuel_efficiency_kmpl}
                      onChange={(event) => setProfileForm((prev) => ({ ...prev, fuel_efficiency_kmpl: event.target.value }))}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 outline-none focus:border-emerald-700"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-medium text-slate-700">Idle fuel burn (L/h)</span>
                    <input
                      type="number"
                      min={0}
                      step={0.1}
                      value={profileForm.idle_fuel_lph}
                      onChange={(event) => setProfileForm((prev) => ({ ...prev, idle_fuel_lph: event.target.value }))}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 outline-none focus:border-emerald-700"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-medium text-slate-700">Maintenance ($/km)</span>
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={profileForm.maintenance_cost_per_km_usd}
                      onChange={(event) => setProfileForm((prev) => ({ ...prev, maintenance_cost_per_km_usd: event.target.value }))}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 outline-none focus:border-emerald-700"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-medium text-slate-700">Driver cost ($/h)</span>
                    <input
                      type="number"
                      min={0}
                      step={0.5}
                      value={profileForm.driver_cost_per_hour_usd}
                      onChange={(event) => setProfileForm((prev) => ({ ...prev, driver_cost_per_hour_usd: event.target.value }))}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 outline-none focus:border-emerald-700"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-medium text-slate-700">Toll discount (%)</span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      value={profileForm.toll_discount_pct}
                      onChange={(event) => setProfileForm((prev) => ({ ...prev, toll_discount_pct: event.target.value }))}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 outline-none focus:border-emerald-700"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-medium text-slate-700">Fuel price adjustment (%)</span>
                    <input
                      type="number"
                      min={-100}
                      max={200}
                      step={1}
                      value={profileForm.fuel_price_adjustment_pct}
                      onChange={(event) => setProfileForm((prev) => ({ ...prev, fuel_price_adjustment_pct: event.target.value }))}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 outline-none focus:border-emerald-700"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-medium text-slate-700">Empty-mile factor (%)</span>
                    <input
                      type="number"
                      min={0}
                      max={200}
                      step={1}
                      value={profileForm.empty_mile_factor_pct}
                      onChange={(event) => setProfileForm((prev) => ({ ...prev, empty_mile_factor_pct: event.target.value }))}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 outline-none focus:border-emerald-700"
                    />
                  </label>
                </div>
              </div>
              <textarea
                rows={3}
                value={profileForm.bio}
                onChange={(event) => setProfileForm((prev) => ({ ...prev, bio: event.target.value }))}
                placeholder="Carrier summary"
                className="md:col-span-2 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-emerald-700"
              />
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <article className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <h3 className="text-sm font-semibold text-slate-900">Stripe Wallet</h3>
                <p className="mt-1 text-xs text-slate-600">Link a card or bank account for recurring billing and payment methods.</p>
                <div className="mt-3 space-y-1 text-xs text-slate-600">
                  <p>
                    Card linked: <span className="font-semibold text-slate-800">{paymentMethodStatus?.has_card ? "Yes" : "No"}</span>
                    {paymentMethodStatus?.card_last4 ? (
                      <span className="ml-1 text-slate-500">(ending in {paymentMethodStatus.card_last4})</span>
                    ) : null}
                  </p>
                  <p>Bank linked: <span className="font-semibold text-slate-800">{paymentMethodStatus?.has_bank_account ? "Yes" : "No"}</span></p>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void startWalletSetup("card")}
                    disabled={walletSetupLoading !== null || walletRemoveLoading}
                    className="rounded-lg border border-emerald-300 bg-white px-3 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-60"
                  >
                    {walletSetupLoading === "card" ? "Opening Stripe..." : "Link Card"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void removeLinkedCard()}
                    disabled={walletRemoveLoading || !paymentMethodStatus?.has_card || walletSetupLoading !== null}
                    className="rounded-lg border border-rose-300 bg-white px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60"
                  >
                    {walletRemoveLoading ? "Removing Card..." : "Remove Card"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void startWalletSetup("bank_account")}
                    disabled={walletSetupLoading !== null || walletRemoveLoading}
                    className="rounded-lg border border-emerald-300 bg-white px-3 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-60"
                  >
                    {walletSetupLoading === "bank_account" ? "Opening Stripe..." : "Link Bank Account"}
                  </button>
                </div>
              </article>

              <article className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <h3 className="text-sm font-semibold text-slate-900">Carrier Payout Account</h3>
                <p className="mt-1 text-xs text-slate-600">Set up Stripe Connect so released payments can transfer to your bank.</p>
                <div className="mt-3 space-y-1 text-xs text-slate-600">
                  <p>Connect linked: <span className="font-semibold text-slate-800">{payoutAccountStatus?.has_connect_account ? "Yes" : "No"}</span></p>
                  <p>Payouts enabled: <span className="font-semibold text-slate-800">{payoutAccountStatus?.payouts_enabled ? "Yes" : "No"}</span></p>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void startPayoutOnboarding()}
                    disabled={connectSetupLoading}
                    className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-600 disabled:opacity-60"
                  >
                    {connectSetupLoading ? "Opening Stripe..." : "Link Payout Account"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void loadSubscriptionState(true)}
                    disabled={subscriptionLoading}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                  >
                    Refresh Payout Status
                  </button>
                </div>
              </article>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

