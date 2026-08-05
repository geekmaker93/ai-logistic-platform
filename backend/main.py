from __future__ import annotations

import os
import json
import base64
import hashlib
import hmac
import re
import smtplib
import time
import traceback
from pathlib import Path
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from enum import Enum
from math import inf
from typing import Literal, cast
from uuid import uuid4
from urllib.parse import quote, urlencode, urlparse
from urllib.request import Request as UrlRequest, urlopen
from urllib.error import URLError

from fastapi import FastAPI, Header, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy import JSON, Boolean, DateTime, Float, Integer, String, Text, UniqueConstraint, create_engine, or_, select, text
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

try:
	import stripe
except Exception:  # pragma: no cover - handled by runtime guard
	stripe = None


def load_local_env_file(env_path: Path) -> None:
	if not env_path.exists():
		return

	for raw_line in env_path.read_text(encoding="utf-8").splitlines():
		line = raw_line.strip()
		if not line or line.startswith("#") or "=" not in line:
			continue
		key, value = line.split("=", 1)
		key = key.strip()
		if not key:
			continue
		value = value.strip().strip('"').strip("'")
		os.environ.setdefault(key, value)


load_local_env_file(Path(__file__).resolve().parent / ".env")


DEFAULT_CARRIER_BASE_LOCATION = "Not set"
GOOGLE_MAPS_API_KEY = os.getenv("GOOGLE_MAPS_API_KEY", "").strip()
GOOGLE_DISTANCE_MATRIX_URL = os.getenv(
	"GOOGLE_DISTANCE_MATRIX_URL",
	"https://maps.googleapis.com/maps/api/distancematrix/json",
).strip()
GOOGLE_DIRECTIONS_URL = os.getenv(
	"GOOGLE_DIRECTIONS_URL",
	"https://maps.googleapis.com/maps/api/directions/json",
).strip()
GOOGLE_GEOCODE_URL = os.getenv(
	"GOOGLE_GEOCODE_URL",
	"https://maps.googleapis.com/maps/api/geocode/json",
).strip()
GOOGLE_PLACES_AUTOCOMPLETE_URL = os.getenv(
	"GOOGLE_PLACES_AUTOCOMPLETE_URL",
	"https://maps.googleapis.com/maps/api/place/autocomplete/json",
).strip()
GOOGLE_PLACES_DETAILS_URL = os.getenv(
	"GOOGLE_PLACES_DETAILS_URL",
	"https://maps.googleapis.com/maps/api/place/details/json",
).strip()
OPENWEATHER_API_KEY = os.getenv("OPENWEATHER_API_KEY", "").strip()
OPENWEATHER_URL = os.getenv(
	"OPENWEATHER_URL",
	"https://api.openweathermap.org/data/2.5/weather",
).strip()
EIA_API_KEY = os.getenv("EIA_API_KEY", "").strip()
EIA_GAS_PRICE_URL = os.getenv(
	"EIA_GAS_PRICE_URL",
	"https://api.eia.gov/v2/petroleum/pri/gnd/data/",
).strip()
EIA_DUOAREA = os.getenv("EIA_DUOAREA", "R1X").strip()
EIA_PRODUCT = os.getenv("EIA_PRODUCT", "EPD2D").strip()
GAS_PRICE_FALLBACK_USD_PER_LITER = float(os.getenv("GAS_PRICE_FALLBACK_USD_PER_LITER", "1.2"))
DRIVER_SESSION_NOT_FOUND_DETAIL = "Driver session not found."
FRONTEND_BASE_URL = os.getenv("FRONTEND_BASE_URL", "https://lynkxpress.com").strip()
STRIPE_SECRET_KEY = os.getenv("STRIPE_SECRET_KEY", "").strip()
STRIPE_CLIENT_PRICE_ID = os.getenv("STRIPE_CLIENT_PRICE_ID", "").strip()
STRIPE_CARRIER_PRICE_ID = os.getenv("STRIPE_CARRIER_PRICE_ID", "").strip()
SIGNUP_EMAIL_CODE_TTL_MINUTES = int(os.getenv("SIGNUP_EMAIL_CODE_TTL_MINUTES", "10"))
SIGNUP_EMAIL_CODE_DEBUG = os.getenv("SIGNUP_EMAIL_CODE_DEBUG", "").strip().lower() in {"1", "true", "yes", "on"}
SIGNUP_SMTP_HOST = os.getenv("SIGNUP_SMTP_HOST", "").strip()
SIGNUP_SMTP_PORT = int(os.getenv("SIGNUP_SMTP_PORT", "587"))
SIGNUP_SMTP_LOGIN = os.getenv("SIGNUP_SMTP_LOGIN", "").strip()
SIGNUP_SMTP_PASSWORD = os.getenv("SIGNUP_SMTP_PASSWORD", "").strip()
SIGNUP_SMTP_FROM_EMAIL = os.getenv("SIGNUP_SMTP_FROM_EMAIL", SIGNUP_SMTP_LOGIN).strip()
SIGNUP_SMTP_FROM_NAME = os.getenv("SIGNUP_SMTP_FROM_NAME", "FreightAxis").strip()
BREVO_API_KEY = os.getenv("BREVO_API_KEY", "").strip()
RESEND_API_KEY = os.getenv("RESEND_API_KEY", "").strip()
RESEND_FROM_EMAIL = os.getenv("RESEND_FROM_EMAIL", "verification@lynkxpress.com").strip()
RESEND_FROM_NAME = os.getenv("RESEND_FROM_NAME", "FreightAxis").strip()
SIGNUP_EMAIL_ALLOW_RESEND_FALLBACK = os.getenv("SIGNUP_EMAIL_ALLOW_RESEND_FALLBACK", "false").strip().lower() in {"1", "true", "yes", "on"}
PASSWORD_RESET_TOKEN_TTL_MINUTES = int(os.getenv("PASSWORD_RESET_TOKEN_TTL_MINUTES", "60"))
SHIPPER_REVIEW_PERIOD_HOURS = float(os.getenv("SHIPPER_REVIEW_PERIOD_HOURS", "0"))
ADMIN_API_KEY = os.getenv("ADMIN_API_KEY", "").strip()
DIDIT_API_KEY = os.getenv("DIDIT_API_KEY", "").strip()
DIDIT_WORKFLOW_ID = os.getenv("DIDIT_WORKFLOW_ID", "").strip()
DIDIT_API_BASE_URL = os.getenv("DIDIT_API_BASE_URL", "https://verification.didit.me/v3").rstrip("/")
MAX_SIGNUP_ID_DOCUMENT_BYTES = 5 * 1024 * 1024
ALLOWED_SIGNUP_ID_MIME_TYPES = {"application/pdf", "image/jpeg", "image/png"}
QUOTE_STATUS_PENDING = "pending"
AUTH_RATE_LIMIT_WINDOW_SECONDS = int(os.getenv("AUTH_RATE_LIMIT_WINDOW_SECONDS", "60"))
AUTH_RATE_LIMIT_MAX_REQUESTS = int(os.getenv("AUTH_RATE_LIMIT_MAX_REQUESTS", "6"))
AUTH_SESSION_COOKIE_NAME = os.getenv("AUTH_SESSION_COOKIE_NAME", "ai_logistics_session")
AUTH_SESSION_COOKIE_SECRET = os.getenv("AUTH_SESSION_COOKIE_SECRET", "local-dev-session-secret").strip()
AUTH_SESSION_COOKIE_SECURE = os.getenv("AUTH_SESSION_COOKIE_SECURE", "false").strip().lower() in {"1", "true", "yes", "on"}
AUTH_SESSION_COOKIE_MAX_AGE_SECONDS = int(os.getenv("AUTH_SESSION_COOKIE_MAX_AGE_SECONDS", str(7 * 24 * 60 * 60)))
QUOTE_STATUS_ACCEPTED = "accepted"
QUOTE_STATUS_PAID = "paid"
PAYOUT_STATUS_PENDING = "pending"
PAYOUT_STATUS_RELEASED = "released"
PAYOUT_STATUS_PENDING_CONNECT = "pending_connect_account"
POD_STATUS_PENDING = "pending"
POD_STATUS_UPLOADED = "uploaded"
POD_STATUS_CARRIER_CONFIRMED = "carrier_confirmed"
POD_STATUS_REVIEWED = "reviewed"

if stripe is not None and STRIPE_SECRET_KEY:
	stripe.api_key = STRIPE_SECRET_KEY


class ShipmentStatus(str, Enum):
	offered = "offered"
	awaiting_payment = "awaiting_payment"
	active = "active"
	delivered = "delivered"
	rejected = "rejected"
	# Legacy statuses retained for backward compatibility.
	pending = "pending"
	accepted = "accepted"
	in_transit = "in_transit"


class OptimizationMode(str, Enum):
	fastest = "fastest"
	fuel_efficient = "fuel_efficient"
	lowest_cost = "lowest_cost"
	weather_safe = "weather_safe"
	eco = "eco"


class CarrierRecommendationRequest(BaseModel):
	origin: str = Field(min_length=2, max_length=140)
	destination: str = Field(min_length=2, max_length=140)
	weight_kg: float = Field(gt=0, le=50000)
	urgency: Literal["low", "normal", "high"] = "normal"
	vehicle_needs: str | None = Field(default=None, max_length=120)


class ShipmentCreateRequest(BaseModel):
	client_name: str = Field(min_length=2, max_length=120)
	cargo_type: str = Field(min_length=2, max_length=120)
	origin: str = Field(min_length=2, max_length=140)
	origin_place_id: str | None = Field(default=None, min_length=5, max_length=200)
	destination: str = Field(min_length=2, max_length=140)
	destination_place_id: str | None = Field(default=None, min_length=5, max_length=200)
	weight_kg: float = Field(gt=0, le=50000)
	time_window: str = Field(min_length=3, max_length=140)
	vehicle_needs: str | None = Field(default=None, max_length=120)
	urgency: Literal["low", "normal", "high"] = "normal"


class DispatchMatch(BaseModel):
	carrier_id: str
	carrier_name: str
	distance_km: float
	score: int
	eta_minutes: int
	available_trucks: int
	vehicle_fit: str
	distance_source: Literal["google_maps", "mixed", "heuristic"] = "heuristic"
	maps_directions_url: str | None = None


class CarrierDetailResponse(BaseModel):
	carrier_id: str
	carrier_name: str
	company_name: str
	contact_name: str | None
	phone: str | None
	address: str | None
	bio: str | None
	base_location: str
	service_regions: list[str]
	available_trucks: int
	vehicle_types: list[str]
	max_weight_kg: float
	rating: float
	is_verified_profile: bool


class QuoteBreakdown(BaseModel):
	total_usd: float
	base_freight_usd: float
	urgency_surcharge_usd: float
	distance_surcharge_usd: float
	service_fee_usd: float
	estimated_delivery_time: str
	notes: str


class RouteOption(BaseModel):
	name: str
	distance_km: float
	estimated_hours: float
	fuel_liters: float
	toll_usd: float
	weather_risk: float = Field(ge=0, le=1)
	traffic_delay_minutes: int = Field(ge=0)
	score: float
	recommendation_reason: str


class ShipmentRecord(BaseModel):
	id: str
	load_number: str
	client_name: str
	carrier_name: str | None
	assigned_driver_id: str | None
	cargo_type: str
	origin: str
	destination: str
	weight_kg: float
	time_window: str
	vehicle_needs: str | None
	urgency: Literal["low", "normal", "high"]
	status: ShipmentStatus
	quote_status: Literal["pending", "accepted", "paid"]
	carrier_offer_amount: float | None
	shipper_approved_amount: float | None
	payment_status: str
	dispatch_matches: list[DispatchMatch]
	quote_breakdown: QuoteBreakdown | None
	created_at: datetime
	updated_at: datetime
	selected_route: RouteOption | None
	status_history: list[dict[str, str]]
	estimated_arrival: datetime | None
	payment_intent_id: str | None
	payment_completed_at: datetime | None
	invoice_number: str | None
	invoice_generated_at: datetime | None
	payout_status: str | None
	payout_transfer_id: str | None
	pod_status: str
	pod_uploaded_at: datetime | None
	pod_confirmed_at: datetime | None
	payout_release_eligible_at: datetime | None


class CarrierQuoteDetailsInput(BaseModel):
	mileage: float | None = Field(default=None, gt=0, le=5000)
	urgency: Literal["low", "normal", "high"] | None = None
	urgency_surcharge_usd: float | None = Field(default=None, ge=0, le=1000000)
	distance_surcharge_usd: float | None = Field(default=None, ge=0, le=1000000)
	service_fee_usd: float | None = Field(default=None, ge=0, le=1000000)
	estimated_delivery_time: str | None = Field(default=None, max_length=80)
	notes: str | None = Field(default=None, max_length=240)


class AcceptShipmentRequest(BaseModel):
	carrier_name: str = Field(min_length=2, max_length=120)
	offer_amount: float = Field(gt=0, le=1000000)
	note: str | None = Field(default=None, max_length=240)
	quote_details: CarrierQuoteDetailsInput | None = None


class AcceptQuoteRequest(BaseModel):
	note: str | None = Field(default=None, max_length=240)


class AssignShipmentDriverRequest(BaseModel):
	driver_id: str = Field(min_length=8, max_length=64)


class RejectShipmentRequest(BaseModel):
	reason: str | None = Field(default=None, max_length=240)


class OptimizeRouteRequest(BaseModel):
	mode: OptimizationMode = OptimizationMode.lowest_cost


class RouteAnalysisResponse(BaseModel):
	shipment_id: str
	client_name: str
	carrier_name: str | None
	origin: str
	destination: str
	cargo_type: str
	weight_kg: float
	time_window: str
	urgency: Literal["low", "normal", "high"]
	mode: OptimizationMode
	fuel_price_usd_per_liter: float
	fuel_price_source: Literal["eia_live", "fallback"]
	routes: list[RouteOption]
	best_route: RouteOption
	selected_route: RouteOption | None


class UpdateStatusRequest(BaseModel):
	status: ShipmentStatus
	note: str | None = Field(default=None, max_length=240)


class ReleasePaymentRequest(BaseModel):
	note: str | None = Field(default=None, max_length=240)


class SendCarrierInviteRequest(BaseModel):
	carrier_id: str = Field(min_length=2, max_length=120)
	note: str | None = Field(default=None, max_length=240)


class CarrierRatingSubmitRequest(BaseModel):
	shipment_id: str = Field(min_length=8, max_length=64)
	rating: int = Field(ge=1, le=5)
	use_again: bool = True
	review: str | None = Field(default=None, max_length=400)


class CarrierRatingResponse(BaseModel):
	id: str
	shipment_id: str
	client_name: str
	carrier_name: str
	carrier_id: str | None
	rating: int
	use_again: bool
	review: str | None
	created_at: datetime
	updated_at: datetime


class ClientCarrierHistoryResponse(BaseModel):
	carrier_name: str
	carrier_id: str | None
	total_shipments: int
	delivered_shipments: int
	last_shipment_id: str
	last_delivered_shipment_id: str | None
	last_lane: str
	last_shipment_at: datetime
	average_rating: float | None
	latest_rating: int | None
	latest_review: str | None
	would_use_again: bool | None


class RebookCarrierShipmentRequest(BaseModel):
	carrier_id: str = Field(min_length=2, max_length=120)
	template_shipment_id: str = Field(min_length=8, max_length=64)
	note: str | None = Field(default=None, max_length=240)


class AuthSignupRequest(BaseModel):
	full_name: str = Field(min_length=2, max_length=120)
	company_name: str = Field(min_length=2, max_length=120)
	phone: str | None = Field(default=None, max_length=32)
	bio: str | None = Field(default=None, max_length=400)
	tax_id: str | None = Field(default=None, max_length=32)
	dot_number: str | None = Field(default=None, max_length=32)
	didit_session_id: str | None = Field(default=None, min_length=8, max_length=120)
	id_document_name: str | None = Field(default=None, max_length=180)
	id_document_mime_type: str | None = Field(default=None, max_length=80)
	id_document_base64: str | None = Field(default=None, max_length=9000000)
	vehicle_types: list[str] | None = None
	base_location: str | None = Field(default=None, max_length=140)
	service_regions: list[str] | None = None
	email: str = Field(min_length=4, max_length=320)
	password: str = Field(min_length=8, max_length=120)
	email_verification_code: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")
	role: Literal["client", "carrier", "driver"]


class DiditSessionRequest(BaseModel):
	full_name: str = Field(min_length=2, max_length=120)
	email: str = Field(min_length=4, max_length=320)
	role: Literal["client", "carrier", "driver"]


class DiditSessionResponse(BaseModel):
	session_id: str
	url: str


class AuthSignupVerificationCodeRequest(BaseModel):
	email: str = Field(min_length=4, max_length=320)
	role: Literal["client", "carrier", "driver"]


class AuthSignupVerifyEmailCodeRequest(AuthSignupVerificationCodeRequest):
	verification_code: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")


class AuthSignupVerificationCodeResponse(BaseModel):
	detail: str
	debug_code: str | None = None


class AuthPasswordResetRequest(BaseModel):
	email: str = Field(min_length=4, max_length=320)
	role: Literal["client", "carrier", "driver"]


class AuthPasswordResetConfirmRequest(BaseModel):
	email: str = Field(min_length=4, max_length=320)
	token: str = Field(min_length=16, max_length=128)
	new_password: str = Field(min_length=8, max_length=120)
	role: Literal["client", "carrier", "driver"]


class AuthPasswordResetResponse(BaseModel):
	detail: str


class AuthLoginRequest(BaseModel):
	email: str = Field(min_length=4, max_length=320)
	password: str = Field(min_length=1, max_length=120)
	role: Literal["client", "carrier", "driver"]


class AuthSessionResponse(BaseModel):
	role: Literal["client", "carrier", "driver"]
	display_name: str
	full_name: str
	company_name: str
	email: str
	created_at: datetime
	subscription_active: bool
	subscription_status: str | None
	subscription_plan: str | None
	subscription_current_period_end: datetime | None


class SignupApplicationResponse(BaseModel):
	role: Literal["client", "carrier", "driver"]
	full_name: str
	company_name: str
	email: str
	approval_status: Literal["pending_review", "active", "rejected"]
	created_at: datetime


class SignupApplicationSummaryResponse(SignupApplicationResponse):
	user_id: str


class SignupIdentitySubmissionSummaryResponse(BaseModel):
	id: str
	user_id: str
	role: Literal["client", "carrier", "driver"]
	full_name: str
	company_name: str
	document_name: str
	document_mime_type: str
	created_at: datetime


class SignupIdentitySubmissionDetailResponse(SignupIdentitySubmissionSummaryResponse):
	document_base64: str


class CarrierSettingsPayload(BaseModel):
	available_trucks: int | None = Field(default=None, ge=0, le=10000)
	base_location: str | None = Field(default=None, min_length=2, max_length=140)
	base_location_place_id: str | None = Field(default=None, min_length=5, max_length=200)
	service_regions: list[str] | None = None
	service_region_place_ids: list[str] | None = None
	vehicle_types: list[str] | None = None
	max_weight_kg: float | None = Field(default=None, gt=0, le=50000)
	fuel_efficiency_kmpl: float | None = Field(default=None, gt=0.1, le=30)
	idle_fuel_lph: float | None = Field(default=None, ge=0, le=20)
	maintenance_cost_per_km_usd: float | None = Field(default=None, ge=0, le=10)
	driver_cost_per_hour_usd: float | None = Field(default=None, ge=0, le=300)
	toll_discount_pct: float | None = Field(default=None, ge=0, le=100)
	fuel_price_adjustment_pct: float | None = Field(default=None, ge=-100, le=200)
	empty_mile_factor_pct: float | None = Field(default=None, ge=0, le=200)


class CarrierSettingsResponse(BaseModel):
	available_trucks: int
	base_location: str
	service_regions: list[str]
	vehicle_types: list[str]
	max_weight_kg: float
	fuel_efficiency_kmpl: float
	idle_fuel_lph: float
	maintenance_cost_per_km_usd: float
	driver_cost_per_hour_usd: float
	toll_discount_pct: float
	fuel_price_adjustment_pct: float
	empty_mile_factor_pct: float
	updated_at: datetime


class AuthProfileResponse(BaseModel):
	role: Literal["client", "carrier", "driver"]
	display_name: str
	full_name: str
	company_name: str
	email: str
	tax_id: str | None
	dot_number: str | None
	phone: str | None
	address: str | None
	bio: str | None
	created_at: datetime
	updated_at: datetime
	subscription_active: bool
	subscription_status: str | None
	subscription_plan: str | None
	subscription_current_period_end: datetime | None
	carrier_profile: CarrierSettingsResponse | None


class BillingPlanResponse(BaseModel):
	role: Literal["client", "carrier"]
	name: str
	price_usd: float
	price_id: str | None


class BillingStatusResponse(BaseModel):
	role: Literal["client", "carrier"]
	subscription_active: bool
	subscription_status: str | None
	subscription_plan: str | None
	subscription_current_period_end: datetime | None
	subscription_cancel_at_period_end: bool = False


class BillingCheckoutRequest(BaseModel):
	return_url: str | None = Field(default=None, max_length=500)
	success_url: str | None = Field(default=None, max_length=500)
	cancel_url: str | None = Field(default=None, max_length=500)


class BillingCheckoutResponse(BaseModel):
	client_secret: str | None = None
	checkout_url: str


class ShipmentPaymentCheckoutRequest(BaseModel):
	return_url: str | None = Field(default=None, max_length=500)
	success_url: str | None = Field(default=None, max_length=500)
	cancel_url: str | None = Field(default=None, max_length=500)
	embedded: bool = True


class BillingPaymentMethodSetupRequest(BaseModel):
	instrument_type: Literal["card", "bank_account"] = "card"
	success_url: str | None = Field(default=None, max_length=500)
	cancel_url: str | None = Field(default=None, max_length=500)


class BillingPaymentMethodRemoveRequest(BaseModel):
	instrument_type: Literal["card", "bank_account"] = "card"


class BillingPayoutOnboardingRequest(BaseModel):
	return_url: str | None = Field(default=None, max_length=500)
	refresh_url: str | None = Field(default=None, max_length=500)


class BillingPaymentMethodStatusResponse(BaseModel):
	role: Literal["client", "carrier"]
	stripe_customer_ready: bool
	has_card: bool
	has_bank_account: bool
	card_last4: str | None = None


class BillingPayoutAccountStatusResponse(BaseModel):
	role: Literal["carrier"]
	has_connect_account: bool
	connect_account_id: str | None
	payouts_enabled: bool
	charges_enabled: bool
	onboarding_complete: bool


class AuthProfileUpdateRequest(BaseModel):
	full_name: str | None = Field(default=None, min_length=2, max_length=120)
	company_name: str | None = Field(default=None, min_length=2, max_length=120)
	tax_id: str | None = Field(default=None, max_length=32)
	dot_number: str | None = Field(default=None, max_length=32)
	phone: str | None = Field(default=None, max_length=32)
	address: str | None = Field(default=None, max_length=180)
	address_place_id: str | None = Field(default=None, min_length=5, max_length=200)
	bio: str | None = Field(default=None, max_length=400)
	carrier_profile: CarrierSettingsPayload | None = None


class DriverApplicationProfilePayload(BaseModel):
	first_name: str = Field(min_length=1, max_length=80)
	last_name: str = Field(min_length=1, max_length=80)
	phone: str = Field(min_length=7, max_length=32)
	address: str = Field(min_length=3, max_length=180)
	zip_code: str = Field(min_length=3, max_length=16)
	cdl_information: str = Field(min_length=2, max_length=240)
	years_experience: int = Field(ge=0, le=80)
	qualifications: str = Field(default="", max_length=2000)
	endorsements: str = Field(default="", max_length=1000)
	availability_notes: str = Field(default="", max_length=600)
	truck_type: str = Field(default="", max_length=120)
	trailer_type: str = Field(default="", max_length=120)
	capacity: str = Field(default="", max_length=120)
	vehicle_information: str = Field(default="", max_length=500)
	availability_status: Literal["available", "on_load", "unavailable"]
	resume_name: str | None = Field(default=None, max_length=180)
	resume_mime_type: str | None = Field(default=None, max_length=100)
	resume_base64: str | None = Field(default=None, max_length=9000000)


class DriverApplicationProfileResponse(DriverApplicationProfilePayload):
	email: str
	updated_at: datetime


class CarrierDriverTokenRequest(BaseModel):
	driver_name: str = Field(min_length=2, max_length=120)
	driver_mobile: str = Field(min_length=7, max_length=32)


class CarrierDriverSummaryResponse(BaseModel):
	id: str
	driver_name: str
	driver_mobile: str
	token_expires_at: datetime | None
	last_login_at: datetime | None
	tracking_started_at: datetime | None
	last_tracking_at: datetime | None
	created_at: datetime
	updated_at: datetime


class CarrierDriverTokenResponse(BaseModel):
	driver: CarrierDriverSummaryResponse
	login_token: str


class DriverLoginRequest(BaseModel):
	login_token: str = Field(min_length=6, max_length=64)


class DriverSessionResponse(BaseModel):
	driver_id: str
	driver_name: str
	driver_mobile: str
	carrier_name: str
	carrier_email: str


class DriverTrackingRequest(BaseModel):
	driver_id: str = Field(min_length=8, max_length=64)


class DriverTrackingResponse(BaseModel):
	driver_id: str
	status: Literal["tracking_started"]
	tracked_at: datetime


class DriverTrackingUpdateRequest(BaseModel):
	driver_id: str = Field(min_length=8, max_length=64)
	shipment_id: str | None = Field(default=None, min_length=8, max_length=64)
	latitude: float | None = Field(default=None, ge=-90, le=90)
	longitude: float | None = Field(default=None, ge=-180, le=180)
	accuracy_m: float | None = Field(default=None, ge=0, le=10000)
	speed_kph: float | None = Field(default=None, ge=0, le=300)
	heading_deg: float | None = Field(default=None, ge=0, le=360)
	timestamp: datetime | None = None
	note: str | None = Field(default=None, max_length=200)


class DriverTrackingUpdateResponse(BaseModel):
	driver_id: str
	tracked_at: datetime
	latitude: float | None
	longitude: float | None
	note: str | None


class DriverCurrentShipmentResponse(BaseModel):
	driver_id: str
	tracking_started_at: datetime | None
	last_tracking_at: datetime | None
	shipment: ShipmentRecord | None


class DriverDocumentUploadRequest(BaseModel):
	driver_id: str = Field(min_length=8, max_length=64)
	document_name: str = Field(min_length=2, max_length=140)
	document_type: str = Field(default="general", min_length=2, max_length=64)
	notes: str | None = Field(default=None, max_length=400)
	content_text: str | None = Field(default=None, max_length=4000)
	file_mime_type: str | None = Field(default=None, max_length=100)
	file_base64: str | None = Field(default=None, max_length=6000000)


class DriverDocumentRecordResponse(BaseModel):
	id: str
	driver_id: str
	driver_name: str
	driver_mobile: str
	carrier_name: str
	document_name: str
	document_type: str
	notes: str | None
	content_text: str | None
	file_mime_type: str | None
	file_base64: str | None
	created_at: datetime


class CarrierTrackingHistoryPointResponse(BaseModel):
	latitude: float
	longitude: float
	tracked_at: datetime
	note: str | None


class CarrierShipmentLiveTrackingResponse(BaseModel):
	shipment_id: str
	shipment_origin: str
	shipment_destination: str
	shipment_status: ShipmentStatus
	driver_id: str
	driver_name: str
	current_latitude: float | None
	current_longitude: float | None
	current_location_label: str | None
	last_update_at: datetime | None
	distance_remaining_km: float | None
	eta_minutes_remaining: int | None
	eta_arrival_at: datetime | None
	tracking_status: Literal["Live", "No signal"]
	eta_source: Literal["google_maps", "heuristic", "unavailable"]
	maps_directions_url: str | None
	history: list[CarrierTrackingHistoryPointResponse]


class AddressSuggestion(BaseModel):
	place_id: str
	description: str


class ResolvedAddress(BaseModel):
	place_id: str
	formatted_address: str
	physical_address: str
	city: str
	state: str
	postal_code: str


class ActorRole(str, Enum):
	client = "client"
	carrier = "carrier"


class CarrierProfile(BaseModel):
	id: str
	name: str
	base_location: str
	service_regions: list[str]
	rating: float
	available_trucks: int
	max_weight_kg: float
	vehicle_types: list[str]


class Base(DeclarativeBase):
	pass


class TemporaryUploadBase(DeclarativeBase):
	pass


class TemporaryUploadModel(TemporaryUploadBase):
	__tablename__ = "temporary_uploads"

	id: Mapped[str] = mapped_column(String(64), primary_key=True)
	file_name: Mapped[str] = mapped_column(String(180), nullable=False)
	mime_type: Mapped[str] = mapped_column(String(100), nullable=False)
	file_base64: Mapped[str] = mapped_column(Text, nullable=False)
	created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class ShipmentModel(Base):
	__tablename__ = "shipments"

	id: Mapped[str] = mapped_column(String(64), primary_key=True)
	client_name: Mapped[str] = mapped_column(String(120), nullable=False)
	carrier_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
	assigned_driver_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
	cargo_type: Mapped[str] = mapped_column(String(120), nullable=False)
	origin: Mapped[str] = mapped_column(String(140), nullable=False)
	destination: Mapped[str] = mapped_column(String(140), nullable=False)
	weight_kg: Mapped[float] = mapped_column(Float, nullable=False)
	time_window: Mapped[str | None] = mapped_column(String(140), nullable=True)
	vehicle_needs: Mapped[str | None] = mapped_column(String(120), nullable=True)
	urgency: Mapped[str] = mapped_column(String(16), nullable=False)
	status: Mapped[str] = mapped_column(String(24), nullable=False)
	quote_status: Mapped[str | None] = mapped_column(String(24), nullable=True)
	carrier_offer_amount: Mapped[float | None] = mapped_column(Float, nullable=True)
	shipper_approved_amount: Mapped[float | None] = mapped_column(Float, nullable=True)
	payment_status: Mapped[str | None] = mapped_column(String(24), nullable=True)
	dispatch_matches: Mapped[list[dict] | None] = mapped_column(JSON, nullable=True)
	quote_breakdown: Mapped[dict | None] = mapped_column(JSON, nullable=True)
	created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
	updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
	selected_route: Mapped[dict | None] = mapped_column(JSON, nullable=True)
	status_history: Mapped[list[dict[str, str]]] = mapped_column(JSON, nullable=False, default=list)
	estimated_arrival: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
	payment_intent_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
	payment_completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
	invoice_number: Mapped[str | None] = mapped_column(String(24), nullable=True)
	invoice_generated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
	payout_status: Mapped[str | None] = mapped_column(String(32), nullable=True)
	payout_transfer_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
	pod_status: Mapped[str | None] = mapped_column(String(24), nullable=True)
	pod_uploaded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
	pod_confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
	payout_release_eligible_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class UserModel(Base):
	__tablename__ = "users"
	__table_args__ = (UniqueConstraint("email", "role", name="uq_users_email_role"),)

	id: Mapped[str] = mapped_column(String(64), primary_key=True)
	full_name: Mapped[str] = mapped_column(String(120), nullable=False)
	company_name: Mapped[str] = mapped_column(String(120), nullable=False)
	tax_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
	tax_id_digits: Mapped[str | None] = mapped_column(String(16), nullable=True)
	dot_number: Mapped[str | None] = mapped_column(String(32), nullable=True)
	dot_number_digits: Mapped[str | None] = mapped_column(String(16), nullable=True)
	email: Mapped[str] = mapped_column(String(320), nullable=False)
	password_hash: Mapped[str] = mapped_column(String(256), nullable=False)
	role: Mapped[str] = mapped_column(String(16), nullable=False)
	phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
	address: Mapped[str | None] = mapped_column(String(180), nullable=True)
	bio: Mapped[str | None] = mapped_column(String(400), nullable=True)
	stripe_customer_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
	stripe_connect_account_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
	subscription_status: Mapped[str | None] = mapped_column(String(32), nullable=True)
	subscription_plan: Mapped[str | None] = mapped_column(String(16), nullable=True)
	subscription_current_period_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
	approval_status: Mapped[str] = mapped_column(String(24), nullable=False, default="active")
	created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
	updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class DriverApplicationModel(Base):
	__tablename__ = "driver_applications"

	user_id: Mapped[str] = mapped_column(String(64), primary_key=True)
	first_name: Mapped[str] = mapped_column(String(80), nullable=False)
	last_name: Mapped[str] = mapped_column(String(80), nullable=False)
	phone: Mapped[str] = mapped_column(String(32), nullable=False)
	address: Mapped[str] = mapped_column(String(180), nullable=False)
	zip_code: Mapped[str] = mapped_column(String(16), nullable=False)
	cdl_information: Mapped[str] = mapped_column(String(240), nullable=False)
	years_experience: Mapped[int] = mapped_column(nullable=False, default=0)
	qualifications: Mapped[str] = mapped_column(String(2000), nullable=False, default="")
	endorsements: Mapped[str] = mapped_column(String(1000), nullable=False, default="")
	availability_notes: Mapped[str] = mapped_column(String(600), nullable=False, default="")
	truck_type: Mapped[str] = mapped_column(String(120), nullable=False, default="")
	trailer_type: Mapped[str] = mapped_column(String(120), nullable=False, default="")
	capacity: Mapped[str] = mapped_column(String(120), nullable=False, default="")
	vehicle_information: Mapped[str] = mapped_column(String(500), nullable=False, default="")
	availability_status: Mapped[str] = mapped_column(String(16), nullable=False, default="available")
	resume_name: Mapped[str | None] = mapped_column(String(180), nullable=True)
	resume_mime_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
	resume_base64: Mapped[str | None] = mapped_column(Text, nullable=True)
	resume_temporary_upload_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
	updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class CarrierSettingsModel(Base):
	__tablename__ = "carrier_settings"

	id: Mapped[str] = mapped_column(String(64), primary_key=True)
	user_id: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
	carrier_name: Mapped[str] = mapped_column(String(120), nullable=False)
	available_trucks: Mapped[int] = mapped_column(nullable=False, default=1)
	base_location: Mapped[str] = mapped_column(String(140), nullable=False, default=DEFAULT_CARRIER_BASE_LOCATION)
	service_regions: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
	vehicle_types: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
	max_weight_kg: Mapped[float] = mapped_column(Float, nullable=False, default=20000.0)
	fuel_efficiency_kmpl: Mapped[float] = mapped_column(Float, nullable=False, default=4.8)
	idle_fuel_lph: Mapped[float] = mapped_column(Float, nullable=False, default=2.5)
	maintenance_cost_per_km_usd: Mapped[float] = mapped_column(Float, nullable=False, default=0.12)
	driver_cost_per_hour_usd: Mapped[float] = mapped_column(Float, nullable=False, default=28.0)
	toll_discount_pct: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
	fuel_price_adjustment_pct: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
	empty_mile_factor_pct: Mapped[float] = mapped_column(Float, nullable=False, default=10.0)
	updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class CarrierDriverModel(Base):
	__tablename__ = "carrier_drivers"
	__table_args__ = (UniqueConstraint("carrier_user_id", "driver_mobile", name="uq_carrier_driver_mobile"),)

	id: Mapped[str] = mapped_column(String(64), primary_key=True)
	carrier_user_id: Mapped[str] = mapped_column(String(64), nullable=False)
	carrier_name: Mapped[str] = mapped_column(String(120), nullable=False)
	driver_name: Mapped[str] = mapped_column(String(120), nullable=False)
	driver_mobile: Mapped[str] = mapped_column(String(32), nullable=False)
	login_token_hash: Mapped[str | None] = mapped_column(String(256), nullable=True)
	token_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
	last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
	tracking_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
	last_tracking_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
	created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
	updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class DriverDocumentModel(Base):
	__tablename__ = "driver_documents"

	id: Mapped[str] = mapped_column(String(64), primary_key=True)
	carrier_user_id: Mapped[str] = mapped_column(String(64), nullable=False)
	carrier_name: Mapped[str] = mapped_column(String(120), nullable=False)
	driver_id: Mapped[str] = mapped_column(String(64), nullable=False)
	driver_name: Mapped[str] = mapped_column(String(120), nullable=False)
	driver_mobile: Mapped[str] = mapped_column(String(32), nullable=False)
	document_name: Mapped[str] = mapped_column(String(140), nullable=False)
	document_type: Mapped[str] = mapped_column(String(64), nullable=False)
	notes: Mapped[str | None] = mapped_column(String(400), nullable=True)
	content_text: Mapped[str | None] = mapped_column(String(4000), nullable=True)
	file_mime_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
	file_base64: Mapped[str | None] = mapped_column(Text, nullable=True)
	temporary_upload_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
	created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class SignupIdentityDocumentModel(Base):
	__tablename__ = "signup_identity_documents"

	id: Mapped[str] = mapped_column(String(64), primary_key=True)
	user_id: Mapped[str] = mapped_column(String(64), nullable=False)
	role: Mapped[str] = mapped_column(String(16), nullable=False)
	full_name: Mapped[str] = mapped_column(String(120), nullable=False)
	company_name: Mapped[str] = mapped_column(String(120), nullable=False)
	document_name: Mapped[str] = mapped_column(String(180), nullable=False)
	document_mime_type: Mapped[str] = mapped_column(String(80), nullable=False)
	document_base64: Mapped[str] = mapped_column(Text, nullable=False)
	temporary_upload_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
	persona_inquiry_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
	didit_session_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
	created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class SignupEmailVerificationModel(Base):
	__tablename__ = "signup_email_verifications"
	__table_args__ = (UniqueConstraint("email", "role", name="uq_signup_email_verifications_email_role"),)

	id: Mapped[str] = mapped_column(String(64), primary_key=True)
	email: Mapped[str] = mapped_column(String(320), nullable=False)
	role: Mapped[str] = mapped_column(String(16), nullable=False)
	code_hash: Mapped[str] = mapped_column(String(256), nullable=False)
	expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
	created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class PasswordResetTokenModel(Base):
	__tablename__ = "password_reset_tokens"
	__table_args__ = (UniqueConstraint("user_id", name="uq_password_reset_tokens_user_id"),)

	id: Mapped[str] = mapped_column(String(64), primary_key=True)
	user_id: Mapped[str] = mapped_column(String(64), nullable=False)
	token_hash: Mapped[str] = mapped_column(String(256), nullable=False)
	expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
	used: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
	created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class CarrierRatingModel(Base):
	__tablename__ = "carrier_ratings"
	__table_args__ = (UniqueConstraint("shipment_id", "client_name", name="uq_carrier_ratings_shipment_client"),)

	id: Mapped[str] = mapped_column(String(64), primary_key=True)
	shipment_id: Mapped[str] = mapped_column(String(64), nullable=False)
	client_name: Mapped[str] = mapped_column(String(120), nullable=False)
	carrier_name: Mapped[str] = mapped_column(String(120), nullable=False)
	carrier_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
	rating: Mapped[int] = mapped_column(Integer, nullable=False)
	use_again: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
	review: Mapped[str | None] = mapped_column(String(400), nullable=True)
	created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
	updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class DriverTrackingEventModel(Base):
	__tablename__ = "driver_tracking_events"

	id: Mapped[str] = mapped_column(String(64), primary_key=True)
	driver_id: Mapped[str] = mapped_column(String(64), nullable=False)
	carrier_user_id: Mapped[str] = mapped_column(String(64), nullable=False)
	shipment_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
	latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
	longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
	accuracy_m: Mapped[float | None] = mapped_column(Float, nullable=True)
	speed_kph: Mapped[float | None] = mapped_column(Float, nullable=True)
	heading_deg: Mapped[float | None] = mapped_column(Float, nullable=True)
	note: Mapped[str | None] = mapped_column(String(200), nullable=True)
	created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


carrier_directory: list[CarrierProfile] = [
	CarrierProfile(
		id="northstar-freight",
		name="Northstar Freight",
		base_location="Dallas, TX",
		service_regions=["Dallas", "Fort Worth", "Austin", "Houston", "San Antonio"],
		rating=4.9,
		available_trucks=14,
		max_weight_kg=42000,
		vehicle_types=["dry_van", "flatbed", "reefer"],
	),
	CarrierProfile(
		id="gulfline-cargo",
		name="Gulfline Cargo",
		base_location="Houston, TX",
		service_regions=["Houston", "Galveston", "Beaumont", "Austin"],
		rating=4.8,
		available_trucks=10,
		max_weight_kg=38000,
		vehicle_types=["dry_van", "reefer"],
	),
	CarrierProfile(
		id="lone-star-transport",
		name="Lone Star Transport",
		base_location="Austin, TX",
		service_regions=["Austin", "San Antonio", "Dallas", "Waco"],
		rating=4.7,
		available_trucks=12,
		max_weight_kg=45000,
		vehicle_types=["dry_van", "flatbed"],
	),
	CarrierProfile(
		id="pacific-rim-logistics",
		name="Pacific Rim Logistics",
		base_location="Phoenix, AZ",
		service_regions=["Phoenix", "Tucson", "El Paso", "Dallas"],
		rating=4.6,
		available_trucks=9,
		max_weight_kg=36000,
		vehicle_types=["dry_van", "power_only"],
	),
	CarrierProfile(
		id="coastal-route-lines",
		name="Coastal Route Lines",
		base_location="Atlanta, GA",
		service_regions=["Atlanta", "Birmingham", "Charlotte", "Houston"],
		rating=4.5,
		available_trucks=11,
		max_weight_kg=40000,
		vehicle_types=["dry_van", "reefer", "flatbed"],
	),
]


app = FastAPI(title="AI Logistics MVP API", version="0.2.0")

allowed_origins = [FRONTEND_BASE_URL] if FRONTEND_BASE_URL else []
parsed_frontend = urlparse(FRONTEND_BASE_URL)
if parsed_frontend.scheme and parsed_frontend.hostname:
	allowed_origins.append(f"{parsed_frontend.scheme}://{parsed_frontend.hostname}")
	if parsed_frontend.hostname in {"127.0.0.1", "localhost"}:
		other_host = "localhost" if parsed_frontend.hostname == "127.0.0.1" else "127.0.0.1"
		allowed_origins.extend([
			f"{parsed_frontend.scheme}://{parsed_frontend.hostname}:3000",
			f"{parsed_frontend.scheme}://{other_host}:3000",
			f"{parsed_frontend.scheme}://{parsed_frontend.hostname}:3001",
			f"{parsed_frontend.scheme}://{other_host}:3001",
		])
	else:
		allowed_origins.extend([
			f"{parsed_frontend.scheme}://{parsed_frontend.hostname}:3000",
			f"{parsed_frontend.scheme}://{parsed_frontend.hostname}:3001",
		])
allowed_origins = list(dict.fromkeys([origin for origin in allowed_origins if origin]))
if not allowed_origins:
		allowed_origins = ["https://lynkxpress.com", "http://127.0.0.1:3000", "http://localhost:3000", "http://localhost:3001"]
app.add_middleware(
	CORSMiddleware,
	allow_origins=allowed_origins,
	allow_origin_regex=r"http://(localhost|127\.0\.0\.1)(:[0-9]+)?",
	allow_credentials=True,
	allow_methods=["*"],
	allow_headers=["*"],
)
DEFAULT_DB_PATH = Path(__file__).resolve().parent / "logistics.db"
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{DEFAULT_DB_PATH.as_posix()}")
DEFAULT_TEMP_UPLOAD_DB_PATH = Path(__file__).resolve().parent / "temporary_uploads.db"
TEMP_UPLOAD_DATABASE_URL = os.getenv("TEMP_UPLOAD_DATABASE_URL", f"sqlite:///{DEFAULT_TEMP_UPLOAD_DB_PATH.as_posix()}")
engine = create_engine(
	DATABASE_URL,
	connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {},
)
SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)
temporary_upload_engine = create_engine(
	TEMP_UPLOAD_DATABASE_URL,
	connect_args={"check_same_thread": False} if TEMP_UPLOAD_DATABASE_URL.startswith("sqlite") else {},
)
TemporaryUploadSession = sessionmaker(bind=temporary_upload_engine, autocommit=False, autoflush=False)


def utc_now() -> datetime:
	return datetime.now(timezone.utc)


def normalize_datetime_to_utc(value: datetime) -> datetime:
	if value.tzinfo is None:
		return value.replace(tzinfo=timezone.utc)
	return value.astimezone(timezone.utc)


def normalize_email(email: str) -> str:
	return email.strip().lower()


def hash_password(password: str) -> str:
	salt = os.urandom(16).hex()
	digest = hashlib.scrypt(
		password.encode("utf-8"),
		salt=bytes.fromhex(salt),
		n=2**14,
		r=8,
		p=1,
		dklen=64,
	).hex()
	return f"scrypt${salt}${digest}"


def verify_password(password: str, stored_hash: str) -> bool:
	parts = stored_hash.split("$")
	if len(parts) == 2:
		algorithm = "pbkdf2"
		salt, expected_digest = parts
	elif len(parts) == 3:
		algorithm, salt, expected_digest = parts
	else:
		return False
	try:
		if algorithm == "scrypt":
			calculated = hashlib.scrypt(
				password.encode("utf-8"),
				salt=bytes.fromhex(salt),
				n=2**14,
				r=8,
				p=1,
				dklen=64,
			).hex()
		elif algorithm == "pbkdf2":
			calculated = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt), 120_000).hex()
		else:
			return False
	except ValueError:
		return False
	return hmac.compare_digest(calculated, expected_digest)


def is_valid_email(email: str) -> bool:
	return bool(re.match(r"^[^\s@]+@[^\s@]+\.[^\s@]+$", email))


def get_client_ip(request: Request) -> str:
	if request.client is None or request.client.host is None:
		return "unknown"
	return request.client.host


def enforce_auth_rate_limit(request: Request, endpoint: str) -> None:
	now = time.monotonic()
	window_start = now - AUTH_RATE_LIMIT_WINDOW_SECONDS
	client_key = (get_client_ip(request), endpoint)
	attempts = _auth_rate_limit_store.get(client_key, [])
	attempts = [stamp for stamp in attempts if stamp >= window_start]
	if len(attempts) >= AUTH_RATE_LIMIT_MAX_REQUESTS:
		raise HTTPException(
			status_code=429,
			detail="Too many requests. Try again in a few minutes.",
		)
	attempts.append(now)
	_auth_rate_limit_store[client_key] = attempts


def create_auth_session_token(user_id: str) -> str:
	expires_at = int(time.time()) + AUTH_SESSION_COOKIE_MAX_AGE_SECONDS
	payload = f"{user_id}:{expires_at}".encode("utf-8")
	signature = hmac.new(AUTH_SESSION_COOKIE_SECRET.encode("utf-8"), payload, hashlib.sha256).hexdigest()
	return f"{user_id}:{expires_at}:{signature}"


def set_auth_session_cookie(response: Response, user_id: str) -> None:
	session_token = create_auth_session_token(user_id)
	response.set_cookie(
		key=AUTH_SESSION_COOKIE_NAME,
		value=session_token,
		httponly=True,
		secure=AUTH_SESSION_COOKIE_SECURE,
		samesite="lax",
		max_age=AUTH_SESSION_COOKIE_MAX_AGE_SECONDS,
		path="/",
	)


def verify_auth_session_token(token: str) -> str | None:
	parts = token.split(":")
	if len(parts) != 3:
		return None
	user_id, expires_at_str, signature = parts
	try:
		expires_at = int(expires_at_str)
	except ValueError:
		return None
	if expires_at < int(time.time()):
		return None
	payload = f"{user_id}:{expires_at}".encode("utf-8")
	expected = hmac.new(AUTH_SESSION_COOKIE_SECRET.encode("utf-8"), payload, hashlib.sha256).hexdigest()
	if not hmac.compare_digest(expected, signature):
		return None
	return user_id


def get_auth_session_user_id(request: Request) -> str | None:
	token = request.cookies.get(AUTH_SESSION_COOKIE_NAME)
	if not token:
		return None
	return verify_auth_session_token(token)


_auth_rate_limit_store: dict[tuple[str, str], list[float]] = {}


def generate_signup_verification_code() -> str:
	return f"{int.from_bytes(os.urandom(4), byteorder='big') % 1_000_000:06d}"


def send_resend_email(recipient_email: str, subject: str, html_content: str, text_content: str) -> None:
	if not RESEND_API_KEY or not RESEND_FROM_EMAIL:
		raise HTTPException(
			status_code=503,
			detail="Resend email sender is not configured. Please set RESEND_API_KEY and RESEND_FROM_EMAIL.",
		)

	payload = json.dumps(
		{
			"from": f"{RESEND_FROM_NAME or 'FreightAxis'} <{RESEND_FROM_EMAIL}>",
			"to": [recipient_email],
			"subject": subject,
			"html": html_content,
			"text": text_content,
		}
	).encode("utf-8")

	request = UrlRequest(
		"https://api.resend.com/emails",
		data=payload,
		headers={
			"Content-Type": "application/json",
			"Accept": "application/json",
			"Accept-Language": "en-US,en;q=0.9",
			"Authorization": f"Bearer {RESEND_API_KEY}",
			"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
		},
		method="POST",
	)

	try:
		response = urlopen(request, timeout=20)
		status_code = response.getcode()
		if status_code >= 400:
			raise HTTPException(
				status_code=503,
				detail="Unable to send verification code email right now. Please try again.",
			)
	except URLError as exc:
		print("[backend] Resend email send failed:", exc)
		traceback.print_exc()
		raise HTTPException(
			status_code=503,
			detail="Unable to send verification code email right now. Please try again.",
		)


def send_signup_verification_email(recipient_email: str, code: str) -> None:
	html_content = (
		"<div style='font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; background: #031227; color: #f8fafc;'>"
		"<h2 style='margin: 0 0 12px; color: #67e8f9;'>Verify your email</h2>"
		"<p style='font-size: 16px; line-height: 1.6;'>Use the 6-digit code below to complete your FreightAxis sign-up.</p>"
		f"<div style='margin: 24px 0; padding: 18px 24px; background: #ffffff; color: #031227; font-size: 32px; font-weight: 700; letter-spacing: 0.35em; text-align: center; border-radius: 12px;'>{code}</div>"
		f"<p style='font-size: 14px; color: #cbd5e1;'>This code expires in {SIGNUP_EMAIL_CODE_TTL_MINUTES} minutes.</p>"
		"<p style='font-size: 14px; color: #cbd5e1;'>If you didn’t request this, you can safely ignore this email.</p>"
		"</div>"
	)
	text_content = (
		"Verify your email for FreightAxis.\n\n"
		"Use this 6-digit verification code to complete your sign-up:\n\n"
		f"{code}\n\n"
		f"This code expires in {SIGNUP_EMAIL_CODE_TTL_MINUTES} minutes.\n\n"
		"If you didn’t request this, you can safely ignore this email."
	)

	smtp_configured = bool(SIGNUP_SMTP_HOST and SIGNUP_SMTP_LOGIN and SIGNUP_SMTP_PASSWORD and SIGNUP_SMTP_FROM_EMAIL)
	if smtp_configured:
		try:
			send_smtp_email(recipient_email, "Your FreightAxis verification code", html_content, text_content)
			return
		except Exception as exc:
			print("[backend] SMTP email send failed, falling back to Resend:", exc)
			traceback.print_exc()

	if SIGNUP_EMAIL_ALLOW_RESEND_FALLBACK and RESEND_API_KEY:
		try:
			send_resend_email(recipient_email, "Your FreightAxis verification code", html_content, text_content)
			return
		except Exception as exc:
			print("[backend] Resend email send failed:", exc)
			traceback.print_exc()

	if not smtp_configured:
		raise HTTPException(
			status_code=503,
			detail="Email verification is not configured. Please set SMTP environment variables or RESEND_API_KEY.",
		)

	raise HTTPException(
		status_code=503,
		detail="Unable to send verification code email right now. Please try again.",
	)


def send_smtp_email(recipient_email: str, subject: str, html_content: str, text_content: str) -> None:
	if not SIGNUP_SMTP_HOST or not SIGNUP_SMTP_LOGIN or not SIGNUP_SMTP_PASSWORD or not SIGNUP_SMTP_FROM_EMAIL:
		raise HTTPException(
			status_code=503,
			detail="SMTP email sender is not configured. Please set SIGNUP_SMTP_HOST, SIGNUP_SMTP_LOGIN, SIGNUP_SMTP_PASSWORD, and SIGNUP_SMTP_FROM_EMAIL.",
		)

	message = EmailMessage()
	message["Subject"] = subject
	message["From"] = f"{SIGNUP_SMTP_FROM_NAME or SIGNUP_SMTP_FROM_EMAIL} <{SIGNUP_SMTP_FROM_EMAIL}>"
	message["To"] = recipient_email
	message.set_content(text_content)
	message.add_alternative(html_content, subtype="html")

	try:
		with smtplib.SMTP(SIGNUP_SMTP_HOST, SIGNUP_SMTP_PORT, timeout=20) as smtp:
			smtp.ehlo()
			smtp.starttls()
			smtp.ehlo()
			smtp.login(SIGNUP_SMTP_LOGIN, SIGNUP_SMTP_PASSWORD)
			smtp.send_message(message)
	except Exception as exc:
		print("[backend] SMTP email send failed:", exc)
		traceback.print_exc()
		raise HTTPException(
			status_code=503,
			detail="Unable to send reset email right now. Please try again.",
		)


def send_brevo_email(recipient_email: str, subject: str, html_content: str, text_content: str) -> None:
	if SIGNUP_EMAIL_ALLOW_RESEND_FALLBACK and RESEND_API_KEY:
		send_resend_email(recipient_email, subject, html_content, text_content)
		return

	if not SIGNUP_SMTP_FROM_EMAIL:
		raise HTTPException(
			status_code=503,
			detail="Email sender is not configured. Please set SIGNUP_SMTP_FROM_EMAIL or RESEND_API_KEY.",
		)

	if not BREVO_API_KEY:
		send_smtp_email(recipient_email, subject, html_content, text_content)
		return

	payload = json.dumps(
		{
			"sender": {
				"name": SIGNUP_SMTP_FROM_NAME or "FreightAxis",
				"email": SIGNUP_SMTP_FROM_EMAIL,
			},
			"to": [{"email": recipient_email}],
			"subject": subject,
			"htmlContent": html_content,
			"textContent": text_content,
		}
	).encode("utf-8")

	request = UrlRequest(
		"https://api.brevo.com/v3/smtp/email",
		data=payload,
		headers={
			"Content-Type": "application/json",
			"Accept": "application/json",
			"api-key": BREVO_API_KEY,
		},
		method="POST",
	)

	try:
		response = urlopen(request, timeout=20)
		status_code = response.getcode()
		if status_code >= 400:
			print(f"[backend] Brevo HTTP send failed status={status_code}")
			raise HTTPException(
				status_code=503,
				detail="Unable to send reset email right now. Please try again.",
			)
	except URLError as exc:
		print("[backend] Brevo HTTP send failed:", exc)
		traceback.print_exc()
		raise HTTPException(
			status_code=503,
			detail="Unable to send reset email right now. Please try again.",
		)


def generate_password_reset_token() -> str:
	return uuid4().hex


def resolve_frontend_base_url(origin: str | None) -> str:
	if origin:
		parsed = urlparse(origin)
		if parsed.scheme in {"http", "https"} and parsed.hostname:
			port = f":{parsed.port}" if parsed.port and parsed.port not in {80, 443} else ""
			return f"{parsed.scheme}://{parsed.hostname}{port}"

	if FRONTEND_BASE_URL:
		return FRONTEND_BASE_URL.rstrip("/")

	return "https://lynkxpress.com"


def send_password_reset_email(recipient_email: str, token: str, role: str, frontend_base_url: str) -> None:
	reset_link = f"{frontend_base_url.rstrip('/')}/reset-password?token={token}&role={role}"
	subject = "Reset your FreightAxis password"
	html_content = (
		"<p>You requested a password reset for your FreightAxis account.</p>"
		f"<p><a href=\"{reset_link}\">Click here to reset your password</a></p>"
		"<p>If you did not request this, you can ignore this email.</p>"
	)
	text_content = (
		"You requested a password reset for your FreightAxis account.\n\n"
		f"Visit the link below to reset your password:\n{reset_link}\n\n"
		"If you did not request this, you can ignore this email."
	)
	send_brevo_email(recipient_email, subject, html_content, text_content)


def should_expose_signup_code_for_debug() -> bool:
	if SIGNUP_EMAIL_CODE_DEBUG:
		return True
	frontend = FRONTEND_BASE_URL.lower()
	return frontend.startswith("http://127.0.0.1") or frontend.startswith("http://localhost")


def verify_and_consume_signup_email_code(
	db: Session,
	*,
	email: str,
	role: Literal["client", "carrier", "driver"],
	verification_code: str,
) -> None:
	verify_signup_email_code(db, email=email, role=role, verification_code=verification_code)
	record = db.scalar(
		select(SignupEmailVerificationModel).where(
			SignupEmailVerificationModel.email == email,
			SignupEmailVerificationModel.role == role,
		)
	)
	if record is not None:
		db.delete(record)


def verify_signup_email_code(
	db: Session,
	*,
	email: str,
	role: Literal["client", "carrier", "driver"],
	verification_code: str,
) -> None:
	record = db.scalar(
		select(SignupEmailVerificationModel).where(
			SignupEmailVerificationModel.email == email,
			SignupEmailVerificationModel.role == role,
		)
	)
	if record is None:
		raise HTTPException(status_code=400, detail="Verification code required. Request a new 6-digit code.")

	if normalize_datetime_to_utc(record.expires_at) < utc_now():
		db.delete(record)
		db.commit()
		raise HTTPException(status_code=400, detail="Verification code expired. Request a new code.")

	if not verify_password(verification_code, record.code_hash):
		raise HTTPException(status_code=400, detail="Invalid verification code.")


def plan_for_role(role: str) -> Literal["client", "carrier", "driver"]:
	return "carrier" if role == "carrier" else "client" if role != "driver" else "driver"


def stripe_price_id_for_role(role: str) -> str:
	return STRIPE_CARRIER_PRICE_ID if role == "carrier" else STRIPE_CLIENT_PRICE_ID


def subscription_is_active(user: UserModel) -> bool:
	status = (user.subscription_status or "").strip().lower()
	if status not in {"active", "trialing"}:
		return False
	if user.subscription_current_period_end is None:
		return True
	normalized_end = (
		user.subscription_current_period_end
		if user.subscription_current_period_end.tzinfo is not None
		else user.subscription_current_period_end.replace(tzinfo=timezone.utc)
	)
	return normalized_end >= utc_now()


def require_subscription_active(user: UserModel) -> None:
	if subscription_is_active(user):
		return
	raise HTTPException(
		status_code=402,
		detail="Subscription required. Please activate your plan to continue.",
	)


def user_to_auth_session(user: UserModel) -> AuthSessionResponse:
	display_name = user.company_name.strip() or user.full_name.strip()
	return AuthSessionResponse(
		role=user.role,  # type: ignore[arg-type]
		display_name=display_name,
		full_name=user.full_name,
		company_name=user.company_name,
		email=user.email,
		created_at=user.created_at,
		subscription_active=subscription_is_active(user),
		subscription_status=user.subscription_status,
		subscription_plan=user.subscription_plan,
		subscription_current_period_end=user.subscription_current_period_end,
	)


def user_to_signup_application(user: UserModel) -> SignupApplicationResponse:
	return SignupApplicationResponse(
		role=user.role,  # type: ignore[arg-type]
		full_name=user.full_name,
		company_name=user.company_name,
		email=user.email,
		approval_status=cast(Literal["pending_review", "active", "rejected"], user.approval_status),
		created_at=user.created_at,
	)


def to_carrier_settings_response(settings: CarrierSettingsModel) -> CarrierSettingsResponse:
	return CarrierSettingsResponse(
		available_trucks=settings.available_trucks,
		base_location=settings.base_location,
		service_regions=list(settings.service_regions or []),
		vehicle_types=list(settings.vehicle_types or []),
		max_weight_kg=settings.max_weight_kg,
		fuel_efficiency_kmpl=settings.fuel_efficiency_kmpl,
		idle_fuel_lph=settings.idle_fuel_lph,
		maintenance_cost_per_km_usd=settings.maintenance_cost_per_km_usd,
		driver_cost_per_hour_usd=settings.driver_cost_per_hour_usd,
		toll_discount_pct=settings.toll_discount_pct,
		fuel_price_adjustment_pct=settings.fuel_price_adjustment_pct,
		empty_mile_factor_pct=settings.empty_mile_factor_pct,
		updated_at=settings.updated_at,
	)


def user_to_auth_profile(user: UserModel, settings: CarrierSettingsModel | None) -> AuthProfileResponse:
	display_name = user.company_name.strip() or user.full_name.strip()
	return AuthProfileResponse(
		role=user.role,  # type: ignore[arg-type]
		display_name=display_name,
		full_name=user.full_name,
		company_name=user.company_name,
		email=user.email,
		tax_id=user.tax_id,
		dot_number=user.dot_number,
		phone=user.phone,
		address=user.address,
		bio=user.bio,
		created_at=user.created_at,
		updated_at=user.updated_at,
		subscription_active=subscription_is_active(user),
		subscription_status=user.subscription_status,
		subscription_plan=user.subscription_plan,
		subscription_current_period_end=user.subscription_current_period_end,
		carrier_profile=to_carrier_settings_response(settings) if settings else None,
	)


def driver_application_to_response(user: UserModel, profile: DriverApplicationModel) -> DriverApplicationProfileResponse:
	temporary_resume = get_temporary_upload(profile.resume_temporary_upload_id)
	return DriverApplicationProfileResponse(
		email=user.email,
		first_name=profile.first_name,
		last_name=profile.last_name,
		phone=profile.phone,
		address=profile.address,
		zip_code=profile.zip_code,
		cdl_information=profile.cdl_information,
		years_experience=profile.years_experience,
		qualifications=profile.qualifications,
		endorsements=profile.endorsements,
		availability_notes=profile.availability_notes,
		truck_type=profile.truck_type,
		trailer_type=profile.trailer_type,
		capacity=profile.capacity,
		vehicle_information=profile.vehicle_information,
		availability_status=profile.availability_status,  # type: ignore[arg-type]
		resume_name=profile.resume_name,
		resume_mime_type=temporary_resume.mime_type if temporary_resume else profile.resume_mime_type,
		resume_base64=temporary_resume.file_base64 if temporary_resume else profile.resume_base64,
		updated_at=profile.updated_at,
	)


def get_user_by_identity(db: Session, email: str, role: str, require_subscription: bool = True) -> UserModel:
	user = db.scalar(select(UserModel).where(UserModel.email == normalize_email(email), UserModel.role == role))
	if user is None:
		raise HTTPException(status_code=404, detail="Account not found.")
	if require_subscription:
		require_subscription_active(user)
	return user


def get_user_by_actor_name(db: Session, role: ActorRole, actor_name: str) -> UserModel:
	name = actor_name.strip()
	user = db.scalar(
		select(UserModel).where(
			UserModel.role == role.value,
			or_(UserModel.company_name == name, UserModel.full_name == name),
		)
	)
	if user is None:
		raise HTTPException(status_code=404, detail="Actor account not found.")
	return user


def require_subscription_for_actor(db: Session, role: ActorRole, actor_name: str) -> UserModel:
	user = get_user_by_actor_name(db, role, actor_name)
	require_subscription_active(user)
	return user


def ensure_stripe_customer_id(db: Session, user: UserModel) -> str:
	require_stripe_ready()
	if user.stripe_customer_id:
		return user.stripe_customer_id

	customer = stripe.Customer.create(  # type: ignore[union-attr]
		email=user.email,
		name=user.company_name.strip() or user.full_name.strip(),
		metadata={"user_id": user.id, "role": user.role},
	)
	user.stripe_customer_id = customer.id
	db.add(user)
	db.commit()
	db.refresh(user)
	return customer.id


def require_stripe_ready() -> None:
	if stripe is None:
		raise HTTPException(status_code=503, detail="Stripe SDK is not installed on the backend.")
	if not STRIPE_SECRET_KEY:
		raise HTTPException(status_code=503, detail="Stripe is not configured on the backend.")


def apply_subscription_snapshot(user: UserModel, stripe_subscription: dict | None) -> None:
	if not stripe_subscription:
		user.subscription_status = "inactive"
		user.subscription_current_period_end = None
		user.subscription_plan = plan_for_role(user.role)
		return

	status = str(stripe_subscription.get("status") or "inactive")
	period_end_raw = stripe_subscription.get("current_period_end")
	period_end = None
	if isinstance(period_end_raw, (int, float)) and period_end_raw > 0:
		period_end = datetime.fromtimestamp(float(period_end_raw), tz=timezone.utc)

	user.subscription_status = status
	user.subscription_current_period_end = period_end
	user.subscription_plan = plan_for_role(user.role)


def sync_user_subscription_from_stripe(db: Session, user: UserModel) -> None:
	if not user.stripe_customer_id:
		apply_subscription_snapshot(user, None)
		db.add(user)
		db.commit()
		db.refresh(user)
		return

	require_stripe_ready()

	price_id = stripe_price_id_for_role(user.role)
	subscriptions = stripe.Subscription.list(  # type: ignore[union-attr]
		customer=user.stripe_customer_id,
		status="all",
		limit=25,
	)
	selected = None
	for item in subscriptions.data:
		price = None
		items = getattr(item, "items", None)
		if items and getattr(items, "data", None):
			first_item = items.data[0]
			price = getattr(first_item, "price", None)
		item_price_id = getattr(price, "id", None) if price is not None else None
		if price_id and item_price_id == price_id and item.status in {"active", "trialing", "past_due"}:
			selected = {
				"status": item.status,
				"current_period_end": getattr(item, "current_period_end", None),
			}
			break
		if selected is None and item.status in {"active", "trialing"}:
			selected = {
				"status": item.status,
				"current_period_end": getattr(item, "current_period_end", None),
			}

	apply_subscription_snapshot(user, selected)
	user.updated_at = utc_now()
	db.add(user)
	db.commit()
	db.refresh(user)


def get_manageable_stripe_subscription(user: UserModel):
	if not user.stripe_customer_id:
		raise HTTPException(status_code=409, detail="No Stripe customer is linked to this account.")

	require_stripe_ready()
	price_id = stripe_price_id_for_role(user.role)
	subscriptions = stripe.Subscription.list(  # type: ignore[union-attr]
		customer=user.stripe_customer_id,
		status="all",
		limit=25,
	)

	fallback = None
	for item in getattr(subscriptions, "data", []) or []:
		items = getattr(item, "items", None)
		first_item = items.data[0] if items and getattr(items, "data", None) else None
		price = getattr(first_item, "price", None) if first_item is not None else None
		item_price_id = getattr(price, "id", None) if price is not None else None
		status = str(getattr(item, "status", "") or "")

		if price_id and item_price_id == price_id and status in {"active", "trialing", "past_due", "unpaid"}:
			return item
		if fallback is None and status in {"active", "trialing"}:
			fallback = item

	if fallback is not None:
		return fallback

	raise HTTPException(status_code=409, detail="No active subscription found to manage.")


def build_billing_status_response(db: Session, user: UserModel, role: Literal["client", "carrier"]) -> BillingStatusResponse:
	cancel_at_period_end = False
	if user.stripe_customer_id and stripe is not None and STRIPE_SECRET_KEY:
		sync_user_subscription_from_stripe(db, user)
		try:
			subscription = get_manageable_stripe_subscription(user)
			cancel_at_period_end = bool(getattr(subscription, "cancel_at_period_end", False))
		except HTTPException:
			cancel_at_period_end = False

	return BillingStatusResponse(
		role=role,
		subscription_active=subscription_is_active(user),
		subscription_status=user.subscription_status,
		subscription_plan=user.subscription_plan,
		subscription_current_period_end=user.subscription_current_period_end,
		subscription_cancel_at_period_end=cancel_at_period_end,
	)


def normalize_driver_name(name: str) -> str:
	text = name.strip()
	if len(text) < 2:
		raise HTTPException(status_code=400, detail="Enter a valid driver name.")
	return text


def normalize_driver_mobile(mobile: str) -> str:
	digits = "".join(ch for ch in mobile if ch.isdigit())
	if len(digits) < 10 or len(digits) > 15:
		raise HTTPException(status_code=400, detail="Enter a valid driver mobile number.")
	return digits


def serialize_carrier_driver(driver: CarrierDriverModel) -> CarrierDriverSummaryResponse:
	return CarrierDriverSummaryResponse(
		id=driver.id,
		driver_name=driver.driver_name,
		driver_mobile=driver.driver_mobile,
		token_expires_at=driver.token_expires_at,
		last_login_at=driver.last_login_at,
		tracking_started_at=driver.tracking_started_at,
		last_tracking_at=driver.last_tracking_at,
		created_at=driver.created_at,
		updated_at=driver.updated_at,
	)


def serialize_driver_document(record: DriverDocumentModel) -> DriverDocumentRecordResponse:
	temporary_upload = get_temporary_upload(record.temporary_upload_id)
	return DriverDocumentRecordResponse(
		id=record.id,
		driver_id=record.driver_id,
		driver_name=record.driver_name,
		driver_mobile=record.driver_mobile,
		carrier_name=record.carrier_name,
		document_name=record.document_name,
		document_type=record.document_type,
		notes=record.notes,
		content_text=record.content_text,
		file_mime_type=temporary_upload.mime_type if temporary_upload else record.file_mime_type,
		file_base64=temporary_upload.file_base64 if temporary_upload else record.file_base64,
		created_at=record.created_at,
	)


def get_or_create_carrier_settings(db: Session, user: UserModel) -> CarrierSettingsModel:
	settings = db.scalar(select(CarrierSettingsModel).where(CarrierSettingsModel.user_id == user.id))
	if settings is not None:
		return settings

	settings = CarrierSettingsModel(
		id=str(uuid4()),
		user_id=user.id,
		carrier_name=user.company_name,
		available_trucks=1,
		base_location=DEFAULT_CARRIER_BASE_LOCATION,
		service_regions=[],
		vehicle_types=["dry_van"],
		max_weight_kg=20000,
		fuel_efficiency_kmpl=4.8,
		idle_fuel_lph=2.5,
		maintenance_cost_per_km_usd=0.12,
		driver_cost_per_hour_usd=28.0,
		toll_discount_pct=0.0,
		fuel_price_adjustment_pct=0.0,
		empty_mile_factor_pct=10.0,
		updated_at=utc_now(),
	)
	db.add(settings)
	db.commit()
	db.refresh(settings)
	return settings


def normalize_region_list(regions: list[str] | None) -> list[str] | None:
	if regions is None:
		return None
	normalized: list[str] = []
	for item in regions:
		text = item.strip()
		if text and text not in normalized:
			normalized.append(text)
	return normalized


def normalize_vehicle_types(values: list[str] | None) -> list[str] | None:
	if values is None:
		return None
	normalized: list[str] = []
	for item in values:
		text = item.strip().lower().replace(" ", "_")
		if text and text not in normalized:
			normalized.append(text)
	return normalized


def build_runtime_carrier_profile(user: UserModel, settings: CarrierSettingsModel | None) -> CarrierProfile:
	carrier_name = (
		settings.carrier_name.strip()
		if settings and settings.carrier_name and settings.carrier_name.strip()
		else user.company_name.strip() or user.full_name.strip()
	)
	return CarrierProfile(
		id=f"db-{user.id}",
		name=carrier_name,
		base_location=(settings.base_location if settings else DEFAULT_CARRIER_BASE_LOCATION),
		service_regions=list((settings.service_regions if settings else []) or []),
		rating=4.6,
		available_trucks=(settings.available_trucks if settings else 1),
		max_weight_kg=(settings.max_weight_kg if settings else 20000.0),
		vehicle_types=list((settings.vehicle_types if settings else ["dry_van"]) or ["dry_van"]),
	)


def get_runtime_carrier_directory() -> list[CarrierProfile]:
	directory: dict[str, CarrierProfile] = {carrier.id: carrier for carrier in carrier_directory}

	with get_session() as db:
		rows = db.execute(
			select(UserModel, CarrierSettingsModel)
			.outerjoin(CarrierSettingsModel, CarrierSettingsModel.user_id == UserModel.id)
			.where(UserModel.role == "carrier")
		).all()

		for user, settings in rows:
			profile = build_runtime_carrier_profile(user, settings)
			directory[profile.id] = profile

	return list(directory.values())


def get_carrier_detail_by_id(carrier_id: str) -> CarrierDetailResponse:
	directory = get_runtime_carrier_directory()
	carrier = next((item for item in directory if item.id == carrier_id), None)
	if carrier is None:
		raise HTTPException(status_code=404, detail="Carrier not found.")

	if carrier_id.startswith("db-"):
		user_id = carrier_id.removeprefix("db-")
		with get_session() as db:
			row = db.execute(
				select(CarrierSettingsModel, UserModel)
				.join(UserModel, CarrierSettingsModel.user_id == UserModel.id)
				.where(UserModel.id == user_id, UserModel.role == "carrier")
			).first()

			if row is not None:
				settings, user = row
				return CarrierDetailResponse(
					carrier_id=carrier.id,
					carrier_name=settings.carrier_name,
					company_name=user.company_name,
					contact_name=user.full_name,
					phone=user.phone,
					address=user.address,
					bio=user.bio,
					base_location=settings.base_location,
					service_regions=list(settings.service_regions or []),
					available_trucks=settings.available_trucks,
					vehicle_types=list(settings.vehicle_types or []),
					max_weight_kg=settings.max_weight_kg,
					rating=carrier.rating,
					is_verified_profile=True,
				)

	return CarrierDetailResponse(
		carrier_id=carrier.id,
		carrier_name=carrier.name,
		company_name=carrier.name,
		contact_name=None,
		phone=None,
		address=None,
		bio=None,
		base_location=carrier.base_location,
		service_regions=carrier.service_regions,
		available_trucks=carrier.available_trucks,
		vehicle_types=carrier.vehicle_types,
		max_weight_kg=carrier.max_weight_kg,
		rating=carrier.rating,
		is_verified_profile=False,
	)


def validate_carrier_signup_inputs(normalized_tax_id: str, normalized_dot_number: str) -> None:
	if not normalized_tax_id:
		raise HTTPException(status_code=400, detail="Enter EIN/Tax ID.")
	if not normalized_dot_number:
		raise HTTPException(status_code=400, detail="Enter USDOT number.")
	if len(normalized_tax_id) != 9 or not normalized_tax_id.isdigit():
		raise HTTPException(
			status_code=400,
			detail="Enter a valid EIN/Tax ID with 9 digits (for example: 12-3456789).",
		)
	if not (6 <= len(normalized_dot_number) <= 8 and normalized_dot_number[0] != "0"):
		raise HTTPException(
			status_code=400,
			detail="Enter a valid USDOT number (6 to 8 digits, numbers only).",
		)


def validate_signup_inputs(
	full_name: str,
	company_name: str,
	email: str,
	password: str,
	is_carrier: bool,
	normalized_tax_id: str,
	normalized_dot_number: str,
) -> None:
	if not full_name or not company_name or not email or not password:
		raise HTTPException(status_code=400, detail="Complete all sign-up fields.")
	if "@" not in email or "." not in email.split("@")[-1]:
		raise HTTPException(status_code=400, detail="Enter a valid email address.")
	if len(password) < 8 or not any(ch.isalpha() for ch in password) or not any(ch.isdigit() for ch in password):
		raise HTTPException(
			status_code=400,
			detail="Password must be at least 8 characters and include letters and numbers.",
		)

	if is_carrier:
		validate_carrier_signup_inputs(normalized_tax_id, normalized_dot_number)


def ensure_signup_uniqueness(
	db: Session,
	email: str,
	role: str,
	is_carrier: bool,
	normalized_tax_id: str,
	normalized_dot_number: str,
) -> None:
	existing = db.scalar(select(UserModel).where(UserModel.email == email, UserModel.role == role))
	if existing is not None:
		raise HTTPException(status_code=409, detail="An account already exists for this email and role.")

	if not is_carrier:
		return

	duplicate_compliance = db.scalar(
		select(UserModel).where(
			UserModel.role == "carrier",
			or_(
				UserModel.tax_id_digits == normalized_tax_id,
				UserModel.dot_number_digits == normalized_dot_number,
			),
		)
	)
	if duplicate_compliance is not None:
		raise HTTPException(status_code=409, detail="Carrier EIN/Tax ID or USDOT number already exists.")


def normalize_signup_document_base64(raw_value: str) -> tuple[str, str | None]:
	trimmed = raw_value.strip()
	if trimmed.startswith("data:") and ";base64," in trimmed:
		header, encoded = trimmed.split(",", 1)
		mime_value = header[5 : header.index(";base64")].strip().lower() or None
		return encoded.strip(), mime_value
	return trimmed, None


def sanitize_uploaded_document_name(raw_name: str) -> str:
	trimmed = raw_name.strip().replace("\\", "/")
	filename = trimmed.split("/")[-1].strip()
	if not filename:
		raise HTTPException(status_code=400, detail="Upload a valid ID document file.")
	return filename[:180]


def validate_signup_identity_document(
	id_document_name: str,
	id_document_mime_type: str,
	id_document_base64: str,
) -> tuple[str, str, str]:
	document_name = sanitize_uploaded_document_name(id_document_name)
	normalized_base64, embedded_mime = normalize_signup_document_base64(id_document_base64)
	mime_type = (id_document_mime_type or embedded_mime or "").strip().lower()
	if not mime_type or mime_type not in ALLOWED_SIGNUP_ID_MIME_TYPES:
		raise HTTPException(
			status_code=400,
			detail="Upload a valid state-issued or driver ID as PDF, PNG, or JPG.",
		)

	try:
		document_bytes = base64.b64decode(normalized_base64, validate=True)
	except ValueError:
		raise HTTPException(status_code=400, detail="ID document could not be read. Re-upload the file.")

	if not document_bytes:
		raise HTTPException(status_code=400, detail="Upload a non-empty ID document.")
	if len(document_bytes) > MAX_SIGNUP_ID_DOCUMENT_BYTES:
		raise HTTPException(status_code=400, detail="ID document must be 5MB or smaller.")

	return document_name, mime_type, base64.b64encode(document_bytes).decode("ascii")


def didit_vendor_data(role: str, email: str) -> str:
	return f"freightaxis:{role}:{normalize_email(email)}"


def create_didit_session(*, full_name: str, email: str, role: Literal["client", "carrier", "driver"], callback: str) -> DiditSessionResponse:
	if not DIDIT_API_KEY or not DIDIT_WORKFLOW_ID:
		raise HTTPException(status_code=503, detail="Identity verification is not configured. Please try again later.")

	name_parts = full_name.strip().split(maxsplit=1)
	payload = {
		"workflow_id": DIDIT_WORKFLOW_ID,
		"vendor_data": didit_vendor_data(role, email),
		"callback": callback,
		"callback_method": "both",
		"metadata": {"role": role, "email": normalize_email(email)},
		"contact_details": {"email": normalize_email(email), "email_lang": "en", "send_notification_emails": False},
		"expected_details": {"first_name": name_parts[0], "last_name": name_parts[1] if len(name_parts) > 1 else ""},
	}
	request = UrlRequest(
		f"{DIDIT_API_BASE_URL}/session/",
		data=json.dumps(payload).encode("utf-8"),
		headers={"x-api-key": DIDIT_API_KEY, "Content-Type": "application/json", "Accept": "application/json"},
		method="POST",
	)
	try:
		with urlopen(request, timeout=15) as response:
			result = json.loads(response.read().decode("utf-8"))
	except (URLError, TimeoutError, ValueError):
		raise HTTPException(status_code=503, detail="Unable to start identity verification. Please try again later.")

	session_id = result.get("session_id") if isinstance(result, dict) else None
	url = result.get("url") if isinstance(result, dict) else None
	if not isinstance(session_id, str) or not isinstance(url, str):
		raise HTTPException(status_code=503, detail="Identity verification returned an invalid session. Please try again later.")
	return DiditSessionResponse(session_id=session_id, url=url)


def verify_didit_session(session_id: str, *, email: str, role: Literal["client", "carrier", "driver"]) -> str:
	if not DIDIT_API_KEY or not DIDIT_WORKFLOW_ID:
		raise HTTPException(status_code=503, detail="Identity verification is not configured. Please try again later.")

	request = UrlRequest(
		f"{DIDIT_API_BASE_URL}/session/{quote(session_id.strip(), safe='')}/decision/",
		headers={"x-api-key": DIDIT_API_KEY, "Accept": "application/json"},
	)
	try:
		with urlopen(request, timeout=15) as response:
			decision = json.loads(response.read().decode("utf-8"))
	except (URLError, TimeoutError, ValueError):
		raise HTTPException(status_code=503, detail="Unable to confirm identity verification. Please try again later.")

	if not isinstance(decision, dict) or decision.get("status", "").strip().lower() != "approved":
		raise HTTPException(status_code=400, detail="Complete identity verification before creating your account.")
	if decision.get("workflow_id") != DIDIT_WORKFLOW_ID:
		raise HTTPException(status_code=400, detail="Identity verification does not match this signup workflow.")
	if decision.get("vendor_data") != didit_vendor_data(role, email):
		raise HTTPException(status_code=400, detail="Identity verification does not match this signup account.")
	return session_id.strip()


def store_temporary_upload(file_name: str, mime_type: str, file_base64: str) -> str:
	upload_id = str(uuid4())
	with TemporaryUploadSession() as temp_db:
		temp_db.add(
			TemporaryUploadModel(
				id=upload_id,
				file_name=file_name,
				mime_type=mime_type,
				file_base64=file_base64,
				created_at=utc_now(),
			)
		)
		temp_db.commit()
	return upload_id


def get_temporary_upload(upload_id: str | None) -> TemporaryUploadModel | None:
	if not upload_id:
		return None
	with TemporaryUploadSession() as temp_db:
		return temp_db.get(TemporaryUploadModel, upload_id)


def migrate_legacy_uploads_to_temporary_storage() -> None:
	with get_session() as db:
		changed = False
		for record in db.scalars(select(DriverDocumentModel)).all():
			if record.file_base64 and not record.temporary_upload_id:
				record.temporary_upload_id = store_temporary_upload(
					record.document_name,
					record.file_mime_type or "application/octet-stream",
					record.file_base64,
				)
				record.file_base64 = None
				changed = True
		for profile in db.scalars(select(DriverApplicationModel)).all():
			if profile.resume_base64 and not profile.resume_temporary_upload_id:
				profile.resume_temporary_upload_id = store_temporary_upload(
					profile.resume_name or "resume",
					profile.resume_mime_type or "application/octet-stream",
					profile.resume_base64,
				)
				profile.resume_base64 = None
				changed = True
		for record in db.scalars(select(SignupIdentityDocumentModel)).all():
			if record.document_base64 and not record.temporary_upload_id:
				record.temporary_upload_id = store_temporary_upload(
					record.document_name,
					record.document_mime_type,
					record.document_base64,
				)
				record.document_base64 = ""
				changed = True
		if changed:
			db.commit()


def require_admin_api_key(x_admin_key: str | None) -> None:
	if not ADMIN_API_KEY:
		raise HTTPException(status_code=503, detail="Admin access is not configured.")
	if not x_admin_key or not hmac.compare_digest(x_admin_key, ADMIN_API_KEY):
		raise HTTPException(status_code=403, detail="Admin access denied.")


def serialize_signup_identity_submission_summary(
	record: SignupIdentityDocumentModel,
) -> SignupIdentitySubmissionSummaryResponse:
	return SignupIdentitySubmissionSummaryResponse(
		id=record.id,
		user_id=record.user_id,
		role=cast(Literal["client", "carrier"], record.role),
		full_name=record.full_name,
		company_name=record.company_name,
		document_name=record.document_name,
		document_mime_type=record.document_mime_type,
		created_at=record.created_at,
	)


def serialize_signup_identity_submission_detail(
	record: SignupIdentityDocumentModel,
) -> SignupIdentitySubmissionDetailResponse:
	summary = serialize_signup_identity_submission_summary(record)
	temporary_upload = get_temporary_upload(record.temporary_upload_id)
	return SignupIdentitySubmissionDetailResponse(
		id=summary.id,
		user_id=summary.user_id,
		role=summary.role,
		full_name=summary.full_name,
		company_name=summary.company_name,
		document_name=summary.document_name,
		document_mime_type=summary.document_mime_type,
		created_at=summary.created_at,
		document_base64=temporary_upload.file_base64 if temporary_upload else record.document_base64,
	)


def serialize_carrier_rating(record: CarrierRatingModel) -> CarrierRatingResponse:
	return CarrierRatingResponse(
		id=record.id,
		shipment_id=record.shipment_id,
		client_name=record.client_name,
		carrier_name=record.carrier_name,
		carrier_id=record.carrier_id,
		rating=record.rating,
		use_again=record.use_again,
		review=record.review,
		created_at=record.created_at,
		updated_at=record.updated_at,
	)


def add_missing_columns(conn, table_name: str, columns: dict[str, str]) -> None:
	for column_name, column_type in columns.items():
		try:
			conn.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {column_type}"))
		except Exception:
			# Column likely exists already.
			pass


def ensure_compatible_schema() -> None:
	# Lightweight migration for local SQLite/Postgres dev without Alembic.
	shipment_columns = {
		"time_window": "VARCHAR(140)",
		"vehicle_needs": "VARCHAR(120)",
		"payment_status": "VARCHAR(24)",
		"dispatch_matches": "JSON",
		"quote_breakdown": "JSON",
		"assigned_driver_id": "VARCHAR(64)",
	}
	user_columns = {
		"phone": "VARCHAR(32)",
		"address": "VARCHAR(180)",
		"bio": "VARCHAR(400)",
		"updated_at": "DATETIME",
		"stripe_customer_id": "VARCHAR(120)",
		"stripe_connect_account_id": "VARCHAR(120)",
		"subscription_status": "VARCHAR(32)",
		"subscription_plan": "VARCHAR(16)",
		"subscription_current_period_end": "DATETIME",
		"approval_status": "VARCHAR(24)",
	}
	shipment_columns.update(
		{
			"quote_status": "VARCHAR(24)",
			"carrier_offer_amount": "FLOAT",
			"shipper_approved_amount": "FLOAT",
			"payment_intent_id": "VARCHAR(120)",
			"payment_completed_at": "DATETIME",
			"invoice_number": "VARCHAR(24)",
			"invoice_generated_at": "DATETIME",
			"payout_status": "VARCHAR(32)",
			"payout_transfer_id": "VARCHAR(120)",
			"pod_status": "VARCHAR(24)",
			"pod_uploaded_at": "DATETIME",
			"pod_confirmed_at": "DATETIME",
			"payout_release_eligible_at": "DATETIME",
		}
	)
	carrier_settings_columns = {
		"fuel_efficiency_kmpl": "FLOAT",
		"idle_fuel_lph": "FLOAT",
		"maintenance_cost_per_km_usd": "FLOAT",
		"driver_cost_per_hour_usd": "FLOAT",
		"toll_discount_pct": "FLOAT",
		"fuel_price_adjustment_pct": "FLOAT",
		"empty_mile_factor_pct": "FLOAT",
	}
	carrier_driver_columns = {
		"last_tracking_at": "DATETIME",
	}
	driver_document_columns = {
		"file_mime_type": "VARCHAR(100)",
		"file_base64": "TEXT",
		"temporary_upload_id": "VARCHAR(64)",
	}
	driver_application_columns = {
		"resume_temporary_upload_id": "VARCHAR(64)",
	}
	signup_identity_document_columns = {
		"temporary_upload_id": "VARCHAR(64)",
		"persona_inquiry_id": "VARCHAR(80)",
		"didit_session_id": "VARCHAR(120)",
	}
	with engine.begin() as conn:
		add_missing_columns(conn, "shipments", shipment_columns)
		add_missing_columns(conn, "users", user_columns)
		add_missing_columns(conn, "carrier_settings", carrier_settings_columns)
		add_missing_columns(conn, "carrier_drivers", carrier_driver_columns)
		add_missing_columns(conn, "driver_documents", driver_document_columns)
		add_missing_columns(conn, "driver_applications", driver_application_columns)
		add_missing_columns(conn, "signup_identity_documents", signup_identity_document_columns)

		try:
			conn.execute(text("UPDATE users SET updated_at = created_at WHERE updated_at IS NULL"))
		except Exception:
			pass
		try:
			conn.execute(text("UPDATE users SET approval_status = 'active' WHERE approval_status IS NULL"))
		except Exception:
			pass

		carrier_defaults = {
			"fuel_efficiency_kmpl": 4.8,
			"idle_fuel_lph": 2.5,
			"maintenance_cost_per_km_usd": 0.12,
			"driver_cost_per_hour_usd": 28.0,
			"toll_discount_pct": 0.0,
			"fuel_price_adjustment_pct": 0.0,
			"empty_mile_factor_pct": 10.0,
		}
		for column_name, default_value in carrier_defaults.items():
			try:
				conn.execute(
					text(f"UPDATE carrier_settings SET {column_name} = :value WHERE {column_name} IS NULL"),
					{"value": default_value},
				)
			except Exception:
				pass


def serialize_shipment(model: ShipmentModel) -> ShipmentRecord:
	route_payload = model.selected_route
	route = RouteOption(**route_payload) if route_payload else None
	history = model.status_history or []
	matches_payload = model.dispatch_matches or []
	quote_payload = model.quote_breakdown
	quote = QuoteBreakdown(**quote_payload) if quote_payload else None

	return ShipmentRecord(
		id=model.id,
		load_number=shipment_load_number(model.id),
		client_name=model.client_name,
		carrier_name=model.carrier_name,
		assigned_driver_id=model.assigned_driver_id,
		cargo_type=model.cargo_type,
		origin=model.origin,
		destination=model.destination,
		weight_kg=model.weight_kg,
		time_window=model.time_window or "ASAP",
		vehicle_needs=model.vehicle_needs,
		urgency=model.urgency,  # type: ignore[arg-type]
		status=ShipmentStatus(model.status),
		quote_status=(model.quote_status or QUOTE_STATUS_PENDING),
		carrier_offer_amount=model.carrier_offer_amount,
		shipper_approved_amount=model.shipper_approved_amount,
		payment_status=model.payment_status or "unpaid",
		dispatch_matches=[DispatchMatch(**item) for item in matches_payload],
		quote_breakdown=quote,
		created_at=model.created_at,
		updated_at=model.updated_at,
		selected_route=route,
		status_history=history,
		estimated_arrival=model.estimated_arrival,
		payment_intent_id=model.payment_intent_id,
		payment_completed_at=model.payment_completed_at,
		invoice_number=model.invoice_number,
		invoice_generated_at=model.invoice_generated_at,
		payout_status=model.payout_status,
		payout_transfer_id=model.payout_transfer_id,
		pod_status=model.pod_status or POD_STATUS_PENDING,
		pod_uploaded_at=model.pod_uploaded_at,
		pod_confirmed_at=model.pod_confirmed_at,
		payout_release_eligible_at=model.payout_release_eligible_at,
	)


def get_session() -> Session:
	return SessionLocal()


def require_actor_context(actor_role: ActorRole | None, actor_name: str | None) -> tuple[ActorRole, str]:
	if actor_role is None or actor_name is None or not actor_name.strip():
		raise HTTPException(status_code=400, detail="Actor context required: provide as and name query params.")
	return actor_role, actor_name.strip()


def ensure_client_access(shipment: ShipmentModel, client_name: str) -> None:
	if shipment.client_name != client_name:
		raise HTTPException(status_code=403, detail="Clients can only access their own shipments.")


def ensure_carrier_assigned(shipment: ShipmentModel, carrier_name: str) -> None:
	if shipment.carrier_name != carrier_name:
		raise HTTPException(status_code=403, detail="Carrier not assigned to this shipment.")


def get_driver_current_shipment(db: Session, driver: CarrierDriverModel) -> ShipmentModel | None:
	statuses = [
		ShipmentStatus.active.value,
		ShipmentStatus.in_transit.value,
		ShipmentStatus.accepted.value,
		ShipmentStatus.awaiting_payment.value,
		ShipmentStatus.delivered.value,
	]
	for status in statuses:
		shipment = db.scalar(
			select(ShipmentModel)
			.where(
				ShipmentModel.carrier_name == driver.carrier_name,
				ShipmentModel.assigned_driver_id == driver.id,
				ShipmentModel.status == status,
			)
			.order_by(ShipmentModel.updated_at.desc())
		)
		if shipment is not None:
			return shipment
	return None


def compute_live_eta_from_coordinates(
	shipment: ShipmentModel,
	latitude: float,
	longitude: float,
) -> tuple[float | None, int | None, Literal["google_maps", "heuristic", "unavailable"]]:
	destination = (shipment.destination or "").strip()
	if not destination:
		return None, None, "unavailable"

	origin = f"{latitude:.6f},{longitude:.6f}"
	google_eta = google_distance_and_eta(origin, destination)
	if google_eta is not None:
		distance_km, eta_minutes = google_eta
		return distance_km, eta_minutes, "google_maps"

	# Keep ETA available when map services are unavailable.
	distance_km, eta_minutes = heuristic_linehaul_distance_and_eta(origin, destination)
	return distance_km, eta_minutes, "heuristic"


def normalize_location_text(location: str) -> str:
	return location.strip().lower()


def location_matches(location: str, carrier: CarrierProfile) -> bool:
	query = normalize_location_text(location)
	if not query:
		return False
	return query in normalize_location_text(carrier.base_location) or any(
		region.lower() in query or query in region.lower() for region in carrier.service_regions
	)


def heuristic_pickup_distance_and_eta(location: str, carrier: CarrierProfile) -> tuple[float, int]:
	if location_matches(location, carrier):
		base_distance = 22
		eta_minutes = 35
	else:
		base_distance = 120 + (abs(hash(f"{location}:{carrier.name}")) % 320)
		eta_minutes = 120 + int(base_distance * 1.6)
	return float(base_distance), eta_minutes


def heuristic_linehaul_distance_and_eta(origin: str, destination: str) -> tuple[float, int]:
	if normalize_location_text(origin) == normalize_location_text(destination):
		return 1.0, 5

	base_distance = 140 + (abs(hash(f"{origin}->{destination}")) % 520)
	eta_minutes = 100 + int(base_distance * 1.45)
	return float(base_distance), eta_minutes


def compute_dispatch_distance_and_eta(
	origin: str,
	destination: str,
	carrier: CarrierProfile,
) -> tuple[float, int, Literal["google_maps", "mixed", "heuristic"]]:
	pickup_google = google_distance_and_eta(carrier.base_location, origin)
	linehaul_google = google_distance_and_eta(origin, destination)

	pickup_distance, pickup_eta = pickup_google or heuristic_pickup_distance_and_eta(origin, carrier)
	linehaul_distance, linehaul_eta = linehaul_google or heuristic_linehaul_distance_and_eta(origin, destination)

	if pickup_google and linehaul_google:
		distance_source: Literal["google_maps", "mixed", "heuristic"] = "google_maps"
	elif pickup_google or linehaul_google:
		distance_source = "mixed"
	else:
		distance_source = "heuristic"

	total_distance = round(pickup_distance + linehaul_distance, 1)
	total_eta = max(1, int(pickup_eta + linehaul_eta))
	return total_distance, total_eta, distance_source


def build_maps_directions_url(origin: str, destination: str, waypoint: str | None = None) -> str | None:
	if not origin.strip() or not destination.strip():
		return None

	params: dict[str, str] = {
		"api": "1",
		"origin": origin,
		"destination": destination,
		"travelmode": "driving",
	}
	if waypoint and waypoint.strip() and waypoint.strip().lower() != DEFAULT_CARRIER_BASE_LOCATION.lower():
		params["waypoints"] = waypoint

	return f"https://www.google.com/maps/dir/?{urlencode(params)}"


def google_distance_call(origin: str, destination: str) -> dict | None:
	params = urlencode(
		{
			"origins": origin,
			"destinations": destination,
			"units": "metric",
			"key": GOOGLE_MAPS_API_KEY,
		}
	)
	request_url = f"{GOOGLE_DISTANCE_MATRIX_URL}?{params}"

	try:
		with urlopen(request_url, timeout=6) as response:
			return json.loads(response.read().decode("utf-8"))
	except (URLError, TimeoutError, ValueError):
		return None


def google_directions_call(origin: str, destination: str) -> dict | None:
	params = urlencode(
		{
			"origin": origin,
			"destination": destination,
			"mode": "driving",
			"alternatives": "true",
			"departure_time": "now",
			"traffic_model": "best_guess",
			"units": "metric",
			"key": GOOGLE_MAPS_API_KEY,
		}
	)
	request_url = f"{GOOGLE_DIRECTIONS_URL}?{params}"

	try:
		with urlopen(request_url, timeout=8) as response:
			return json.loads(response.read().decode("utf-8"))
	except (URLError, TimeoutError, ValueError):
		return None


def google_geocode_call(address: str) -> dict | None:
	params = urlencode(
		{
			"address": address,
			"key": GOOGLE_MAPS_API_KEY,
		}
	)
	request_url = f"{GOOGLE_GEOCODE_URL}?{params}"

	try:
		with urlopen(request_url, timeout=6) as response:
			return json.loads(response.read().decode("utf-8"))
	except (URLError, TimeoutError, ValueError):
		return None


def google_geocode_place_id_call(place_id: str) -> dict | None:
	params = urlencode(
		{
			"place_id": place_id,
			"key": GOOGLE_MAPS_API_KEY,
		}
	)
	request_url = f"{GOOGLE_GEOCODE_URL}?{params}"

	try:
		with urlopen(request_url, timeout=6) as response:
			return json.loads(response.read().decode("utf-8"))
	except (URLError, TimeoutError, ValueError):
		return None


def google_reverse_geocode_call(latitude: float, longitude: float) -> dict | None:
	params = urlencode(
		{
			"latlng": f"{latitude:.6f},{longitude:.6f}",
			"key": GOOGLE_MAPS_API_KEY,
		}
	)
	request_url = f"{GOOGLE_GEOCODE_URL}?{params}"

	try:
		with urlopen(request_url, timeout=6) as response:
			return json.loads(response.read().decode("utf-8"))
	except (URLError, TimeoutError, ValueError):
		return None


def google_places_autocomplete_call(input_text: str, place_types: str = "address") -> dict | None:
	params = urlencode(
		{
			"input": input_text,
			"types": place_types,
			"key": GOOGLE_MAPS_API_KEY,
		}
	)
	request_url = f"{GOOGLE_PLACES_AUTOCOMPLETE_URL}?{params}"

	try:
		with urlopen(request_url, timeout=6) as response:
			return json.loads(response.read().decode("utf-8"))
	except (URLError, TimeoutError, ValueError):
		return None


def google_place_details_call(place_id: str) -> dict | None:
	params = urlencode(
		{
			"place_id": place_id,
			"fields": "formatted_address",
			"key": GOOGLE_MAPS_API_KEY,
		}
	)
	request_url = f"{GOOGLE_PLACES_DETAILS_URL}?{params}"

	try:
		with urlopen(request_url, timeout=6) as response:
			return json.loads(response.read().decode("utf-8"))
	except (URLError, TimeoutError, ValueError):
		return None


def extract_geocoded_formatted_address(payload: dict) -> str | None:
	if payload.get("status") != "OK":
		return None

	results = payload.get("results") or []
	if not isinstance(results, list) or not results:
		return None

	first_result = results[0] if isinstance(results[0], dict) else None
	if not first_result:
		return None

	formatted_address = first_result.get("formatted_address")
	if not isinstance(formatted_address, str) or not formatted_address.strip():
		return None

	return formatted_address.strip()


def extract_autocomplete_suggestions(payload: dict, limit: int = 5) -> list[AddressSuggestion]:
	status = payload.get("status")
	if status not in {"OK", "ZERO_RESULTS"}:
		return []

	predictions = payload.get("predictions") or []
	results: list[AddressSuggestion] = []
	for item in predictions:
		if not isinstance(item, dict):
			continue
		place_id = item.get("place_id")
		description = item.get("description")
		if not isinstance(place_id, str) or not place_id.strip():
			continue
		if not isinstance(description, str) or not description.strip():
			continue
		results.append(AddressSuggestion(place_id=place_id.strip(), description=description.strip()))
		if len(results) >= limit:
			break

	return results


def extract_place_details_formatted_address(payload: dict) -> str | None:
	if payload.get("status") != "OK":
		return None

	result = payload.get("result")
	if not isinstance(result, dict):
		return None

	formatted_address = result.get("formatted_address")
	if not isinstance(formatted_address, str) or not formatted_address.strip():
		return None

	return formatted_address.strip()


def get_first_geocode_result(payload: dict) -> dict | None:
	if payload.get("status") != "OK":
		return None
	results = payload.get("results") or []
	if not isinstance(results, list) or not results:
		return None
	first_result = results[0]
	return first_result if isinstance(first_result, dict) else None


def get_address_components(result: dict) -> list[dict]:
	components = result.get("address_components") or []
	if not isinstance(components, list):
		return []
	return [component for component in components if isinstance(component, dict)]


def normalize_address_component(component: dict) -> tuple[set[str], str, str | None] | None:
	types = component.get("types") or []
	if not isinstance(types, list):
		return None
	long_name = component.get("long_name")
	if not isinstance(long_name, str):
		return None
	short_name = component.get("short_name")
	short_name_value = short_name if isinstance(short_name, str) else None
	return set(types), long_name, short_name_value


def parse_address_component_fields(components: list[dict]) -> dict[str, str]:
	parsed = {
		"street_number": "",
		"route": "",
		"city": "",
		"state": "",
		"postal_code": "",
	}

	for component in components:
		normalized_component = normalize_address_component(component)
		if normalized_component is None:
			continue
		types, long_name, short_name = normalized_component

		if "street_number" in types:
			parsed["street_number"] = long_name
			continue
		if "route" in types:
			parsed["route"] = long_name
			continue
		if "locality" in types and not parsed["city"]:
			parsed["city"] = long_name
			continue
		if "administrative_area_level_1" in types and short_name:
			parsed["state"] = short_name
			continue
		if "postal_code" in types:
			parsed["postal_code"] = long_name

	return parsed


def build_physical_address(street_number: str, route: str) -> str:
	return " ".join(item for item in [street_number, route] if item).strip()


def extract_address_breakdown(payload: dict) -> tuple[str, str, str, str] | None:
	result = get_first_geocode_result(payload)
	if result is None:
		return None
	components = get_address_components(result)
	parsed = parse_address_component_fields(components)
	physical_address = build_physical_address(parsed["street_number"], parsed["route"])
	if not physical_address:
		return None
	if not parsed["city"] or not parsed["state"] or not parsed["postal_code"]:
		return None

	return physical_address, parsed["city"], parsed["state"], parsed["postal_code"]


def extract_geocode_coordinates(payload: dict) -> tuple[float, float] | None:
	result = get_first_geocode_result(payload)
	if result is None:
		return None
	geometry = result.get("geometry")
	if not isinstance(geometry, dict):
		return None
	location = geometry.get("location")
	if not isinstance(location, dict):
		return None
	lat = location.get("lat")
	lng = location.get("lng")
	if not isinstance(lat, (int, float)) or not isinstance(lng, (int, float)):
		return None
	return float(lat), float(lng)


def resolve_address_coordinates(address: str) -> tuple[float, float] | None:
	payload = google_geocode_call(address.strip())
	if payload is None:
		return None
	return extract_geocode_coordinates(payload)


def openweather_call(lat: float, lon: float) -> dict | None:
	if not OPENWEATHER_API_KEY:
		return None
	params = urlencode(
		{
			"lat": f"{lat}",
			"lon": f"{lon}",
			"appid": OPENWEATHER_API_KEY,
			"units": "metric",
		}
	)
	request_url = f"{OPENWEATHER_URL}?{params}"

	try:
		with urlopen(request_url, timeout=6) as response:
			return json.loads(response.read().decode("utf-8"))
	except (URLError, TimeoutError, ValueError):
		return None


def eia_gas_price_call() -> dict | None:
	if not EIA_API_KEY:
		return None

	params = urlencode(
		[
			("api_key", EIA_API_KEY),
			("frequency", "weekly"),
			("data[0]", "value"),
			("facets[duoarea][]", EIA_DUOAREA),
			("facets[product][]", EIA_PRODUCT),
			("sort[0][column]", "period"),
			("sort[0][direction]", "desc"),
			("offset", "0"),
			("length", "1"),
		]
	)
	request_url = f"{EIA_GAS_PRICE_URL}?{params}"

	try:
		with urlopen(request_url, timeout=6) as response:
			return json.loads(response.read().decode("utf-8"))
	except (URLError, TimeoutError, ValueError):
		return None


def extract_eia_price_per_gallon(payload: dict | None) -> float | None:
	if not payload:
		return None
	response = payload.get("response")
	if not isinstance(response, dict):
		return None
	data = response.get("data")
	if not isinstance(data, list) or not data:
		return None
	first = data[0]
	if not isinstance(first, dict):
		return None
	value = first.get("value")
	if isinstance(value, str):
		try:
			value = float(value)
		except ValueError:
			return None
	if not isinstance(value, (int, float)):
		return None
	price = float(value)
	if 0.3 <= price <= 15:
		return price
	return None


def live_fuel_price_per_liter(_address: str) -> tuple[float, Literal["eia_live", "fallback"]]:
	fallback_value = round(max(0.2, GAS_PRICE_FALLBACK_USD_PER_LITER), 3)
	eia_payload = eia_gas_price_call()
	eia_price_per_gallon = extract_eia_price_per_gallon(eia_payload)
	if eia_price_per_gallon is not None:
		price_per_liter = round(max(0.2, min(4.0, eia_price_per_gallon / 3.78541)), 3)
		return price_per_liter, "eia_live"
	return fallback_value, "fallback"


def weather_condition_risk(weather_id: int | None) -> float:
	if weather_id is None:
		return 0.18
	if 200 <= weather_id < 300:
		return 0.66
	if 300 <= weather_id < 400:
		return 0.36
	if 500 <= weather_id < 600:
		return 0.42
	if 600 <= weather_id < 700:
		return 0.48
	if 700 <= weather_id < 800:
		return 0.3
	if weather_id == 800:
		return 0.2
	return 0.26


def weather_metric_risk(value: float, divisor: float, cap: float) -> float:
	return min(cap, value / divisor)


def weather_precipitation_risk(precipitation: dict | None) -> float:
	if not isinstance(precipitation, dict):
		return 0.0
	amount = precipitation.get("1h")
	if isinstance(amount, (int, float)) and amount > 0:
		return min(0.18, float(amount) / 20.0)
	return 0.0


def weather_temperature_risk(temp: float | None) -> float:
	if temp is None:
		return 0.0
	if temp <= -5 or temp >= 38:
		return 0.08
	if temp <= 0 or temp >= 33:
		return 0.04
	return 0.0


def calculate_weather_risk(payload: dict | None) -> float:
	if not payload:
		return 0.35

	weather_items = payload.get("weather") or []
	first_weather = weather_items[0] if isinstance(weather_items, list) and weather_items else None
	weather_id = first_weather.get("id") if isinstance(first_weather, dict) else None
	main = payload.get("main") if isinstance(payload.get("main"), dict) else {}
	wind = payload.get("wind") if isinstance(payload.get("wind"), dict) else {}
	cloud_cover = payload.get("clouds") if isinstance(payload.get("clouds"), dict) else {}

	cloud_value = cloud_cover.get("all", 0)
	cloud_pct = float(cloud_value) if isinstance(cloud_value, (int, float)) else 0.0
	wind_value = wind.get("speed", 0)
	wind_speed = float(wind_value) if isinstance(wind_value, (int, float)) else 0.0
	temp_value = main.get("temp") if isinstance(main, dict) else None
	temp = float(temp_value) if isinstance(temp_value, (int, float)) else None

	risk = 0.18
	risk += weather_condition_risk(weather_id) - 0.18
	risk += weather_metric_risk(wind_speed, 45.0, 0.18)
	risk += weather_metric_risk(cloud_pct, 250.0, 0.12)
	risk += weather_precipitation_risk(payload.get("rain") if isinstance(payload.get("rain"), dict) else None)
	risk += weather_precipitation_risk(payload.get("snow") if isinstance(payload.get("snow"), dict) else None)
	risk += weather_temperature_risk(temp)

	return max(0.0, min(1.0, round(risk, 2)))


def get_live_weather_risk(address: str) -> float | None:
	coords = resolve_address_coordinates(address)
	if coords is None:
		return None
	lat, lon = coords
	payload = openweather_call(lat, lon)
	return calculate_weather_risk(payload)


def resolve_google_place_id_to_address(place_id: str) -> str | None:
	payload = google_geocode_place_id_call(place_id.strip())
	if payload is None:
		return None
	return extract_geocoded_formatted_address(payload)


def resolve_google_place_id_breakdown(place_id: str) -> tuple[str, str, str, str] | None:
	payload = google_geocode_place_id_call(place_id.strip())
	if payload is None:
		return None
	return extract_address_breakdown(payload)


def validate_and_normalize_google_address(
	address: str,
	field_label: str = "address",
	place_id: str | None = None,
	require_place_id: bool = False,
) -> str:
	normalized = address.strip()
	if not normalized:
		raise HTTPException(status_code=400, detail=f"Enter {field_label}.")
	if not GOOGLE_MAPS_API_KEY:
		raise HTTPException(
			status_code=503,
			detail="Google Maps API key is not configured for address validation.",
		)
	if require_place_id and (not place_id or not place_id.strip()):
		raise HTTPException(
			status_code=400,
			detail=f"Select a valid Google Maps {field_label} suggestion.",
		)

	if place_id and place_id.strip():
		formatted_from_place = resolve_google_place_id_to_address(place_id)
		if not formatted_from_place:
			raise HTTPException(
				status_code=400,
				detail=f"Select a valid Google Maps {field_label} suggestion.",
			)
		return formatted_from_place

	payload = google_geocode_call(normalized)
	if payload is None:
		raise HTTPException(status_code=502, detail="Google Maps validation request failed. Please try again.")

	formatted = extract_geocoded_formatted_address(payload)
	if not formatted:
		raise HTTPException(status_code=400, detail=f"Enter a valid {field_label} recognized by Google Maps.")

	return formatted


def extract_distance_duration(payload: dict) -> tuple[float, int] | None:
	if payload.get("status") != "OK":
		return None

	rows = payload.get("rows") or []
	if not rows:
		return None

	elements = rows[0].get("elements") if isinstance(rows[0], dict) else None
	if not elements:
		return None

	element = elements[0] if isinstance(elements[0], dict) else None
	if not element or element.get("status") != "OK":
		return None

	distance_obj = element.get("distance") or {}
	duration_obj = element.get("duration") or {}
	distance_meters = distance_obj.get("value")
	duration_seconds = duration_obj.get("value")
	if not isinstance(distance_meters, (int, float)) or not isinstance(duration_seconds, (int, float)):
		return None

	distance_km = max(1.0, float(distance_meters) / 1000.0)
	eta_minutes = max(1, int(round(float(duration_seconds) / 60.0)))
	return round(distance_km, 1), eta_minutes


def google_distance_and_eta(origin: str, destination: str) -> tuple[float, int] | None:
	if not GOOGLE_MAPS_API_KEY:
		return None
	if not origin.strip() or not destination.strip():
		return None
	if origin.strip().lower() == DEFAULT_CARRIER_BASE_LOCATION.lower():
		return None
	payload = google_distance_call(origin, destination)
	if payload is None:
		return None

	return extract_distance_duration(payload)


def resolve_tracking_location_label(latitude: float, longitude: float) -> str:
	if GOOGLE_MAPS_API_KEY:
		payload = google_reverse_geocode_call(latitude, longitude)
		if payload is not None:
			formatted_address = extract_geocoded_formatted_address(payload)
			if formatted_address:
				return formatted_address

	return "Location unavailable"


def compute_tracking_status(last_update_at: datetime | None) -> Literal["Live", "No signal"]:
	if last_update_at is None:
		return "No signal"

	normalized_last_update = (
		last_update_at
		if last_update_at.tzinfo is not None
		else last_update_at.replace(tzinfo=timezone.utc)
	)

	if utc_now() - normalized_last_update <= timedelta(minutes=2):
		return "Live"

	return "No signal"


def vehicle_need_matches(vehicle_needs: str | None, carrier: CarrierProfile) -> bool:
	if not vehicle_needs or not vehicle_needs.strip():
		return True
	needs = [
		item.strip().lower().replace(" ", "_")
		for item in vehicle_needs.split(",")
		if item.strip()
	]
	if not needs:
		return True

	available = {vehicle.lower() for vehicle in carrier.vehicle_types}

	def matches_single_need(need: str) -> bool:
		if need in available:
			return True

		aliases = {
			"truck": "dry_van",
			"van": "dry_van",
			"refrigerated": "reefer",
			"refrigerator": "reefer",
			"cold_chain": "reefer",
		}
		mapped_need = aliases.get(need, need)
		if mapped_need in available:
			return True

		# Last-pass fuzzy check for free-text input (e.g. "flat bed", "reefer trailer").
		return any(mapped_need in item or item in mapped_need for item in available)

	return any(matches_single_need(need) for need in needs)


def recommend_carriers_for_shipment(payload: CarrierRecommendationRequest) -> list[DispatchMatch]:
	matches: list[DispatchMatch] = []
	urgency_weight = {"low": 0.9, "normal": 1.0, "high": 1.15}[payload.urgency]

	for carrier in get_runtime_carrier_directory():
		if payload.weight_kg > carrier.max_weight_kg:
			continue
		if carrier.available_trucks <= 0:
			continue
		if not vehicle_need_matches(payload.vehicle_needs, carrier):
			continue

		distance_km, eta_minutes, distance_source = compute_dispatch_distance_and_eta(
			payload.origin,
			payload.destination,
			carrier,
		)
		is_local = location_matches(payload.origin, carrier) or location_matches(payload.destination, carrier)
		base_score = int((carrier.rating * 18) + (carrier.available_trucks * 1.5))
		distance_penalty = int(distance_km * 0.9 * urgency_weight)
		location_bonus = 18 if is_local else 4
		score = max(1, min(99, base_score - distance_penalty + location_bonus))
		vehicle_fit = payload.vehicle_needs.strip() if payload.vehicle_needs else "standard"
		maps_url = build_maps_directions_url(payload.origin, payload.destination, carrier.base_location)
		matches.append(
			DispatchMatch(
				carrier_id=carrier.id,
				carrier_name=carrier.name,
				distance_km=round(distance_km, 1),
				score=score,
				eta_minutes=eta_minutes,
				available_trucks=carrier.available_trucks,
				vehicle_fit=vehicle_fit,
				distance_source=distance_source,
				maps_directions_url=maps_url,
			)
		)

	matches.sort(key=lambda item: (-item.score, item.distance_km, -item.available_trucks))
	return matches


def quote_for_shipment(shipment: ShipmentModel, carrier_name: str) -> QuoteBreakdown:
	carrier_match = next((m for m in (shipment.dispatch_matches or []) if m.get("carrier_name") == carrier_name), None)
	distance_km = float(carrier_match.get("distance_km", 40)) if carrier_match else 40.0
	distance_miles = max(10.0, distance_km * 0.621371)

	requested_vehicle = "standard"
	if shipment.vehicle_needs:
		requested_vehicle = shipment.vehicle_needs.split(",", 1)[0].strip().lower() or "standard"

	if requested_vehicle in {"truck", "van"}:
		requested_vehicle = "dry_van"
	if requested_vehicle in {"refrigerated", "refrigerator", "cold_chain"}:
		requested_vehicle = "reefer"

	linehaul_rate_per_mile = {
		"dry_van": 2.35,
		"reefer": 2.85,
		"flatbed": 2.65,
		"step_deck": 2.75,
		"power_only": 1.95,
		"box_truck": 2.15,
		"tanker": 3.10,
		"lowboy": 4.00,
		"hotshot": 2.40,
		"standard": 2.35,
	}.get(requested_vehicle, 2.35)

	minimum_linehaul = {
		"dry_van": 650.0,
		"reefer": 775.0,
		"flatbed": 800.0,
		"step_deck": 850.0,
		"power_only": 550.0,
		"box_truck": 450.0,
		"tanker": 950.0,
		"lowboy": 1200.0,
		"hotshot": 500.0,
		"standard": 650.0,
	}.get(requested_vehicle, 650.0)

	base_freight = round(max(distance_miles * linehaul_rate_per_mile, minimum_linehaul), 2)

	diesel_usd_per_gallon = 4.05
	baseline_diesel_usd_per_gallon = 2.50
	fuel_surcharge_per_mile = max(0.0, (diesel_usd_per_gallon - baseline_diesel_usd_per_gallon) / 6.0)
	fuel_surcharge = distance_miles * fuel_surcharge_per_mile

	heavy_weight_accessorial = 0.0
	if shipment.weight_kg > 15000:
		heavy_weight_accessorial = 75.0
	if shipment.weight_kg > 22000:
		heavy_weight_accessorial = 165.0
	if shipment.weight_kg > 30000:
		heavy_weight_accessorial = 280.0

	distance_surcharge = round(fuel_surcharge + heavy_weight_accessorial, 2)

	urgency_pct = {"low": 0.0, "normal": 0.04, "high": 0.12}[shipment.urgency]
	urgency_surcharge = round(base_freight * urgency_pct, 2)

	service_fee = 0.0
	total = round(base_freight + urgency_surcharge + distance_surcharge + service_fee, 2)
	eta_hours = round(max(4.0, distance_miles / 47 + 1.8), 1)
	return QuoteBreakdown(
		total_usd=total,
		base_freight_usd=base_freight,
		urgency_surcharge_usd=urgency_surcharge,
		distance_surcharge_usd=distance_surcharge,
		service_fee_usd=service_fee,
		estimated_delivery_time=f"{eta_hours} hours",
		notes="Market benchmark estimate (linehaul + fuel/accessorial + urgency). Carrier-adjusted offer becomes the official quote.",
	)


def shipment_offer_amount(shipment: ShipmentModel) -> float | None:
	if shipment.carrier_offer_amount is not None:
		return float(shipment.carrier_offer_amount)
	if shipment.shipper_approved_amount is not None:
		return float(shipment.shipper_approved_amount)
	if shipment.quote_breakdown is not None:
		quote = QuoteBreakdown(**shipment.quote_breakdown)
		return float(quote.total_usd)
	return None


def shipment_load_number(shipment_id: str) -> str:
	digits = int(hashlib.sha256(shipment_id.encode("utf-8")).hexdigest()[:10], 16) % 100000
	return f"FX-{digits:05d}"


def generate_invoice_number(db: Session, issued_at: datetime) -> str:
	year = issued_at.year
	prefix = f"INV-{year}-"
	values = db.scalars(select(ShipmentModel.invoice_number).where(ShipmentModel.invoice_number.like(f"{prefix}%"))).all()
	max_serial = 0
	for value in values:
		if not value or not value.startswith(prefix):
			continue
		serial_text = value[len(prefix):]
		if serial_text.isdigit():
			max_serial = max(max_serial, int(serial_text))
	return f"{prefix}{max_serial + 1:06d}"


def ensure_paid_invoice(db: Session, shipment: ShipmentModel, paid_at: datetime) -> None:
	if shipment.invoice_number:
		if shipment.invoice_generated_at is None:
			shipment.invoice_generated_at = paid_at
		return

	shipment.invoice_number = generate_invoice_number(db, paid_at)
	shipment.invoice_generated_at = paid_at


def get_shipment_carrier_id(shipment: ShipmentModel) -> str | None:
	carrier_name = (shipment.carrier_name or "").strip()
	if not carrier_name:
		return None

	for item in (shipment.dispatch_matches or []):
		if item.get("carrier_name") == carrier_name and item.get("carrier_id"):
			return str(item.get("carrier_id"))

	normalized_name = carrier_name.lower()
	for carrier in get_runtime_carrier_directory():
		if carrier.name.strip().lower() == normalized_name:
			return carrier.id

	return None


def set_shipment_status_note(shipment: ShipmentModel, status: str, note: str) -> None:
	history = list(shipment.status_history or [])
	history.append({"status": status, "timestamp": utc_now().isoformat(), "note": note})
	shipment.status_history = history


def create_or_update_payment_intent_for_shipment(db: Session, shipment: ShipmentModel) -> str:
	amount = shipment_offer_amount(shipment)
	if amount is None:
		raise HTTPException(status_code=409, detail="No offer amount is available for this shipment.")

	amount_cents = max(50, int(round(amount * 100)))
	if stripe is None or not STRIPE_SECRET_KEY:
		payment_intent_id = shipment.payment_intent_id or f"pi_test_{shipment.id[:12]}"
		shipment.payment_intent_id = payment_intent_id
		return payment_intent_id

	if shipment.payment_intent_id:
		intent = stripe.PaymentIntent.retrieve(shipment.payment_intent_id)  # type: ignore[union-attr]
		if getattr(intent, "amount", amount_cents) != amount_cents:
			intent = stripe.PaymentIntent.create(  # type: ignore[union-attr]
				amount=amount_cents,
				currency="usd",
				automatic_payment_methods={"enabled": True, "allow_redirects": "never"},
				metadata={"shipment_id": shipment.id, "client_name": shipment.client_name, "carrier_name": shipment.carrier_name or ""},
			)
			shipment.payment_intent_id = intent.id
		return shipment.payment_intent_id

	intent = stripe.PaymentIntent.create(  # type: ignore[union-attr]
		amount=amount_cents,
		currency="usd",
		automatic_payment_methods={"enabled": True, "allow_redirects": "never"},
		metadata={"shipment_id": shipment.id, "client_name": shipment.client_name, "carrier_name": shipment.carrier_name or ""},
	)
	shipment.payment_intent_id = intent.id
	return intent.id


def release_carrier_payout_if_ready(db: Session, shipment: ShipmentModel) -> None:
	if shipment.payment_status != "paid":
		return
	if shipment.status != ShipmentStatus.delivered.value:
		return
	if (shipment.pod_status or POD_STATUS_PENDING) != POD_STATUS_REVIEWED:
		return
	if shipment.payout_status == PAYOUT_STATUS_RELEASED:
		return
	if not shipment.carrier_name:
		return

	carrier_user = db.scalar(select(UserModel).where(UserModel.company_name == shipment.carrier_name, UserModel.role == "carrier"))
	if carrier_user is None:
		shipment.payout_status = PAYOUT_STATUS_PENDING_CONNECT
		return

	amount = shipment_offer_amount(shipment)
	if amount is None:
		shipment.payout_status = PAYOUT_STATUS_PENDING
		return

	if stripe is not None and STRIPE_SECRET_KEY and carrier_user.stripe_connect_account_id:
		try:
			transfer = stripe.Transfer.create(  # type: ignore[union-attr]
				amount=max(50, int(round(amount * 100))),
				currency="usd",
				destination=carrier_user.stripe_connect_account_id,
				metadata={"shipment_id": shipment.id, "carrier_user_id": carrier_user.id},
			)
			shipment.payout_transfer_id = transfer.id
			shipment.payout_status = PAYOUT_STATUS_RELEASED
			return
		except Exception as error:
			shipment.payout_transfer_id = None
			shipment.payout_status = PAYOUT_STATUS_PENDING
			set_shipment_status_note(
				shipment,
				shipment.status,
				"Stripe payout transfer failed; payout remains pending.",
			)
			shipment.updated_at = utc_now()
			return

	shipment.payout_status = PAYOUT_STATUS_RELEASED


def review_release_eligible_at(confirmed_at: datetime) -> datetime:
	if confirmed_at.tzinfo is None:
		confirmed_at = confirmed_at.replace(tzinfo=timezone.utc)
	review_hours = max(SHIPPER_REVIEW_PERIOD_HOURS, 0.0)
	if review_hours <= 0:
		return confirmed_at
	return confirmed_at + timedelta(hours=review_hours)


def advance_payout_lifecycle_if_ready(db: Session, shipment: ShipmentModel) -> None:
	if shipment.payment_status != "paid":
		return
	if shipment.status != ShipmentStatus.delivered.value:
		return
	if shipment.payout_status == PAYOUT_STATUS_RELEASED:
		return

	pod_status = shipment.pod_status or POD_STATUS_PENDING
	if pod_status != POD_STATUS_CARRIER_CONFIRMED:
		return

	eligible_at = shipment.payout_release_eligible_at
	if eligible_at is None and shipment.pod_confirmed_at is not None:
		eligible_at = review_release_eligible_at(shipment.pod_confirmed_at)
		shipment.payout_release_eligible_at = eligible_at
	elif eligible_at is not None and eligible_at.tzinfo is None:
		eligible_at = eligible_at.replace(tzinfo=timezone.utc)
		shipment.payout_release_eligible_at = eligible_at

	if eligible_at is None or utc_now() < eligible_at:
		return

	shipment.pod_status = POD_STATUS_REVIEWED
	set_shipment_status_note(
		shipment,
		shipment.status,
		"Shipper review window elapsed. POD auto-reviewed and payout released.",
	)
	shipment.updated_at = utc_now()
	release_carrier_payout_if_ready(db, shipment)


def carrier_can_view_offer(shipment: ShipmentModel, carrier_name: str) -> bool:
	if shipment.carrier_name == carrier_name:
		return True
	if shipment.status != ShipmentStatus.offered.value:
		return False
	for match in shipment.dispatch_matches or []:
		if match.get("carrier_name") == carrier_name:
			return True
	return False


def route_candidates(weight_kg: float) -> list[dict[str, float | int | str]]:
	weight_factor = 1 + (weight_kg / 20000)
	return [
		{
			"name": "Highway Corridor",
			"distance_km": 740,
			"base_hours": 10.0,
			"traffic_delay_minutes": 55,
			"fuel_liters": 248 * weight_factor,
			"toll_usd": 145,
			"weather_risk": 0.22,
		},
		{
			"name": "Balanced Regional",
			"distance_km": 785,
			"base_hours": 10.8,
			"traffic_delay_minutes": 30,
			"fuel_liters": 234 * weight_factor,
			"toll_usd": 105,
			"weather_risk": 0.18,
		},
		{
			"name": "Fuel Saver Loop",
			"distance_km": 828,
			"base_hours": 11.6,
			"traffic_delay_minutes": 22,
			"fuel_liters": 220 * weight_factor,
			"toll_usd": 78,
			"weather_risk": 0.27,
		},
	]


def google_route_candidates(origin: str, destination: str, weight_kg: float) -> list[dict[str, float | int | str]]:
	if not GOOGLE_MAPS_API_KEY:
		return []
	if not origin.strip() or not destination.strip():
		return []

	payload = google_directions_call(origin, destination)
	if not payload or payload.get("status") != "OK":
		return []

	weight_factor = 1 + (weight_kg / 20000)
	candidates: list[dict[str, float | int | str]] = []
	for index, route in enumerate((payload.get("routes") or [])[:4]):
		legs = route.get("legs") or []
		if not legs:
			continue

		leg = legs[0]
		distance_meters = float((leg.get("distance") or {}).get("value", 0))
		duration_seconds = float((leg.get("duration") or {}).get("value", 0))
		duration_traffic_seconds = float((leg.get("duration_in_traffic") or {}).get("value", duration_seconds))
		distance_km = max(1.0, distance_meters / 1000.0)
		traffic_delay_minutes = max(0, int(round((duration_traffic_seconds - duration_seconds) / 60.0)))
		summary = str(route.get("summary") or f"Google Route {index + 1}")

		candidates.append(
			{
				"name": summary,
				"distance_km": round(distance_km, 1),
				"base_hours": round(max(0.1, duration_traffic_seconds / 3600.0), 2),
				"traffic_delay_minutes": traffic_delay_minutes,
				"fuel_liters": round(distance_km * (0.17 + (weight_factor * 0.045)), 1),
				"toll_usd": round(distance_km * 0.09 + (traffic_delay_minutes * 0.04), 2),
				"weather_risk": 0.2,
			}
		)

	return candidates
def build_route_options(mode: OptimizationMode, weight_kg: float, urgency: str, origin: str, destination: str) -> list[RouteOption]:
	routes: list[RouteOption] = []
	base_routes = google_route_candidates(origin, destination, weight_kg)
	if not base_routes:
		base_routes = [dict(route) for route in route_candidates(weight_kg)]
	origin_weather = get_live_weather_risk(origin)
	destination_weather = get_live_weather_risk(destination)
	if origin_weather is not None or destination_weather is not None:
		weather_average = (
			(origin_weather if origin_weather is not None else 0.35)
			+ (destination_weather if destination_weather is not None else 0.35)
		) / 2.0
		for route in base_routes:
			duration_factor = min(1.25, max(0.85, float(route["base_hours"]) / 10.0))
			route["weather_risk"] = round(max(0.0, min(1.0, weather_average * duration_factor)), 2)

	for candidate in base_routes:
		score, reason = score_route(candidate, mode, urgency)
		routes.append(
			RouteOption(
				name=str(candidate["name"]),
				distance_km=round(float(candidate["distance_km"]), 1),
				estimated_hours=round(float(candidate["base_hours"]) + (int(candidate["traffic_delay_minutes"]) / 60), 2),
				fuel_liters=round(float(candidate["fuel_liters"]), 1),
				toll_usd=round(float(candidate["toll_usd"]), 2),
				weather_risk=round(float(candidate["weather_risk"]), 2),
				traffic_delay_minutes=int(candidate["traffic_delay_minutes"]),
				score=round(score, 2),
				recommendation_reason=reason,
			)
		)

	routes.sort(key=lambda item: item.score)
	return routes


def score_route(route: dict[str, float | int | str], mode: OptimizationMode, urgency: str) -> tuple[float, str]:
	urgency_bias = {"low": 0.8, "normal": 1.0, "high": 1.35}[urgency]
	eta_hours = float(route["base_hours"]) + (int(route["traffic_delay_minutes"]) / 60)
	fuel = float(route["fuel_liters"])
	weather = float(route["weather_risk"])
	toll = float(route["toll_usd"])

	if mode == OptimizationMode.fastest:
		score = eta_hours * 0.7 * urgency_bias + fuel * 0.1 + weather * 30 + toll * 0.1
		reason = "Best for shortest ETA under current traffic conditions."
	elif mode == OptimizationMode.fuel_efficient:
		score = fuel * 0.7 + eta_hours * 0.2 + weather * 20 + toll * 0.1
		reason = "Best for lowering fuel consumption."
	elif mode == OptimizationMode.weather_safe:
		score = weather * 80 + eta_hours * 0.2 + fuel * 0.1 + toll * 0.1
		reason = "Best route for minimizing weather-related risk."
	elif mode == OptimizationMode.eco:
		emissions_penalty = fuel * 2.68
		score = emissions_penalty * 0.6 + eta_hours * 0.2 + weather * 20 + toll * 0.2
		reason = "Best for reducing projected emissions."
	else:
		score = (fuel * 0.45) + (toll * 0.25) + (eta_hours * 0.2 * urgency_bias) + (weather * 25 * 0.1)
		reason = "Best balance of fuel, tolls, and delivery time."

	return score, reason


def compute_best_route(mode: OptimizationMode, weight_kg: float, urgency: str, origin: str, destination: str) -> RouteOption:
	routes = build_route_options(mode, weight_kg, urgency, origin, destination)
	if not routes:
		raise RuntimeError("Unable to compute route option.")
	return routes[0]


@app.get("/health")
def health() -> dict[str, str]:
	return {"status": "ok", "database": DATABASE_URL.split(":", 1)[0]}


@app.post("/auth/identity-verification/didit-session", response_model=DiditSessionResponse)
def start_didit_session(payload: DiditSessionRequest, request: Request) -> DiditSessionResponse:
	full_name = payload.full_name.strip()
	email = normalize_email(payload.email)
	if not is_valid_email(email):
		raise HTTPException(status_code=400, detail="Enter a valid email address.")
	callback = f"{resolve_frontend_base_url(request.headers.get('origin')).rstrip('/')}/"
	return create_didit_session(full_name=full_name, email=email, role=payload.role, callback=callback)


@app.post("/auth/signup/request-verification-code", response_model=AuthSignupVerificationCodeResponse)
def request_signup_verification_code(payload: AuthSignupVerificationCodeRequest) -> AuthSignupVerificationCodeResponse:
	email = normalize_email(payload.email)
	if not is_valid_email(email):
		raise HTTPException(status_code=400, detail="Enter a valid email address.")

	role = payload.role
	with get_session() as db:
		existing_user = db.scalar(select(UserModel).where(UserModel.email == email, UserModel.role == role))
		if existing_user is not None:
			raise HTTPException(status_code=409, detail="An account already exists for this email and role.")

	code = generate_signup_verification_code()
	try:
		send_signup_verification_email(email, code)
		email_sent = True
	except HTTPException:
		email_sent = False

	with get_session() as db:
		now = utc_now()
		expires_at = now + timedelta(minutes=max(SIGNUP_EMAIL_CODE_TTL_MINUTES, 1))
		record = db.scalar(
			select(SignupEmailVerificationModel).where(
				SignupEmailVerificationModel.email == email,
				SignupEmailVerificationModel.role == role,
			)
		)

		if record is None:
			record = SignupEmailVerificationModel(
				id=str(uuid4()),
				email=email,
				role=role,
				code_hash=hash_password(code),
				expires_at=expires_at,
				created_at=now,
			)
			db.add(record)
		else:
			record.code_hash = hash_password(code)
			record.expires_at = expires_at
			record.created_at = now

		db.commit()

	if not email_sent:
		raise HTTPException(status_code=503, detail="Unable to send verification code email right now. Please try again.")

	return AuthSignupVerificationCodeResponse(
		detail="Verification code sent.",
		debug_code=None,
	)


@app.post("/auth/signup/verify-email-code", response_model=AuthSignupVerificationCodeResponse)
def verify_signup_email_verification_code(payload: AuthSignupVerifyEmailCodeRequest) -> AuthSignupVerificationCodeResponse:
	email = normalize_email(payload.email)
	if not is_valid_email(email):
		raise HTTPException(status_code=400, detail="Enter a valid email address.")
	with get_session() as db:
		verify_signup_email_code(
			db,
			email=email,
			role=payload.role,
			verification_code=payload.email_verification_code.strip(),
		)
	return AuthSignupVerificationCodeResponse(detail="Email verified.")


@app.post("/auth/password-reset/request", response_model=AuthPasswordResetResponse)
def request_password_reset(payload: AuthPasswordResetRequest, request: Request) -> AuthPasswordResetResponse:
	email = normalize_email(payload.email)
	if not is_valid_email(email):
		raise HTTPException(status_code=400, detail="Enter a valid email address.")
	role = payload.role
	frontend_base_url = resolve_frontend_base_url(request.headers.get("origin"))
	with get_session() as db:
		user = db.scalar(select(UserModel).where(UserModel.email == email, UserModel.role == role))
		if user is None:
			return AuthPasswordResetResponse(detail="If an account exists for that email, reset instructions have been sent.")
		token = generate_password_reset_token()
		try:
			send_password_reset_email(email, token, role, frontend_base_url)
		except HTTPException:
			# avoid leaking whether email exists or not
			return AuthPasswordResetResponse(detail="If an account exists for that email, reset instructions have been sent.")

		record = db.scalar(select(PasswordResetTokenModel).where(PasswordResetTokenModel.user_id == user.id))
		now = utc_now()
		expires_at = now + timedelta(minutes=max(PASSWORD_RESET_TOKEN_TTL_MINUTES, 5))
		if record is None:
			record = PasswordResetTokenModel(
				id=str(uuid4()),
				user_id=user.id,
				token_hash=hash_password(token),
				expires_at=expires_at,
				used=False,
				created_at=now,
			)
			db.add(record)
		else:
			record.token_hash = hash_password(token)
			record.expires_at = expires_at
			record.used = False
			record.created_at = now
		db.commit()
		return AuthPasswordResetResponse(detail="If an account exists for that email, reset instructions have been sent.")


@app.post("/auth/password-reset/confirm", response_model=AuthPasswordResetResponse)
def confirm_password_reset(payload: AuthPasswordResetConfirmRequest) -> AuthPasswordResetResponse:
	email = normalize_email(payload.email)
	if not is_valid_email(email):
		raise HTTPException(status_code=400, detail="Enter a valid email address.")
	if len(payload.new_password) < 8:
		raise HTTPException(status_code=400, detail="Password must be at least 8 characters.")
	role = payload.role
	with get_session() as db:
		user = db.scalar(select(UserModel).where(UserModel.email == email, UserModel.role == role))
		if user is None:
			raise HTTPException(status_code=400, detail="Invalid token or password reset request.")
		record = db.scalar(
			select(PasswordResetTokenModel)
			.where(PasswordResetTokenModel.user_id == user.id, PasswordResetTokenModel.used == False, PasswordResetTokenModel.expires_at >= utc_now())
		)
		if record is None or not verify_password(payload.token, record.token_hash):
			raise HTTPException(status_code=400, detail="Invalid token or password reset request.")
		user.password_hash = hash_password(payload.new_password)
		user.updated_at = utc_now()
		record.used = True
		db.commit()
		return AuthPasswordResetResponse(detail="Password has been reset.")


@app.post("/auth/signup", response_model=SignupApplicationResponse)
def signup(payload: AuthSignupRequest, request: Request) -> SignupApplicationResponse:
	enforce_auth_rate_limit(request, "signup")
	full_name = payload.full_name.strip()
	company_name = payload.company_name.strip()
	email = normalize_email(payload.email)
	password = payload.password
	verification_code = payload.email_verification_code.strip()
	role = payload.role
	is_carrier = role == "carrier"
	didit_session_id: str | None = None
	if role in {"client", "carrier", "driver"}:
		if not payload.didit_session_id:
			raise HTTPException(status_code=400, detail="Complete identity verification before creating your account.")
		didit_session_id = verify_didit_session(payload.didit_session_id, email=email, role=role)
	tax_id_raw = (payload.tax_id or "")
	dot_number_raw = (payload.dot_number or "")
	normalized_tax_id = "".join(ch for ch in tax_id_raw if ch.isdigit())
	normalized_dot_number = "".join(ch for ch in dot_number_raw if ch.isdigit())
	normalized_vehicle_types = normalize_vehicle_types(payload.vehicle_types) or ["dry_van"]
	normalized_base_location = (payload.base_location or "").strip() or DEFAULT_CARRIER_BASE_LOCATION
	normalized_service_regions = normalize_region_list(payload.service_regions) or []

	validate_signup_inputs(
		full_name=full_name,
		company_name=company_name,
		email=email,
		password=password,
		is_carrier=is_carrier,
		normalized_tax_id=normalized_tax_id,
		normalized_dot_number=normalized_dot_number,
	)

	with get_session() as db:
		ensure_signup_uniqueness(
			db=db,
			email=email,
			role=role,
			is_carrier=is_carrier,
			normalized_tax_id=normalized_tax_id,
			normalized_dot_number=normalized_dot_number,
		)
		verify_and_consume_signup_email_code(
			db,
			email=email,
			role=role,
			verification_code=verification_code,
		)

		formatted_tax_id = (
			f"{normalized_tax_id[:2]}-{normalized_tax_id[2:]}" if is_carrier and len(normalized_tax_id) == 9 else None
		)

		user = UserModel(
			id=str(uuid4()),
			full_name=full_name,
			company_name=company_name,
			tax_id=formatted_tax_id if is_carrier else None,
			tax_id_digits=normalized_tax_id if is_carrier else None,
			dot_number=normalized_dot_number if is_carrier else None,
			dot_number_digits=normalized_dot_number if is_carrier else None,
			email=email,
			password_hash=hash_password(password),
			role=role,
			phone=(payload.phone or "").strip() or None,
			address=None,
			bio=(payload.bio or "").strip() or None,
			stripe_customer_id=None,
			subscription_status="inactive",
			subscription_plan=plan_for_role(role),
			subscription_current_period_end=None,
			approval_status="pending_review",
			created_at=utc_now(),
			updated_at=utc_now(),
		)
		db.add(user)
		db.commit()
		db.refresh(user)

		if didit_session_id:
			submission = SignupIdentityDocumentModel(
				id=str(uuid4()),
				user_id=user.id,
				role=user.role,
				full_name=user.full_name,
				company_name=user.company_name,
				document_name=f"Didit session {didit_session_id}",
				document_mime_type="application/json",
				document_base64="",
				temporary_upload_id=None,
				persona_inquiry_id=None,
				didit_session_id=didit_session_id,
				created_at=utc_now(),
			)
			db.add(submission)

		if is_carrier:
			settings = CarrierSettingsModel(
				id=str(uuid4()),
				user_id=user.id,
				carrier_name=company_name,
				available_trucks=1,
				base_location=normalized_base_location,
				service_regions=normalized_service_regions,
				vehicle_types=normalized_vehicle_types,
				max_weight_kg=20000,
				fuel_efficiency_kmpl=4.8,
				idle_fuel_lph=2.5,
				maintenance_cost_per_km_usd=0.12,
				driver_cost_per_hour_usd=28.0,
				toll_discount_pct=0.0,
				fuel_price_adjustment_pct=0.0,
				empty_mile_factor_pct=10.0,
				updated_at=utc_now(),
			)
			db.add(settings)

		db.commit()
		return user_to_signup_application(user)


@app.get("/admin/signup-applications", response_model=list[SignupApplicationSummaryResponse])
def list_signup_applications(
	x_admin_key: str | None = Header(default=None, alias="X-Admin-Key"),
) -> list[SignupApplicationSummaryResponse]:
	require_admin_api_key(x_admin_key)
	with get_session() as db:
		users = db.scalars(select(UserModel).order_by(UserModel.created_at.desc())).all()
		return [SignupApplicationSummaryResponse(user_id=user.id, **user_to_signup_application(user).model_dump()) for user in users]


@app.post("/admin/signup-applications/{user_id}/approve", response_model=SignupApplicationResponse)
def approve_signup_application(
	user_id: str,
	x_admin_key: str | None = Header(default=None, alias="X-Admin-Key"),
) -> SignupApplicationResponse:
	require_admin_api_key(x_admin_key)
	with get_session() as db:
		user = db.scalar(select(UserModel).where(UserModel.id == user_id))
		if user is None:
			raise HTTPException(status_code=404, detail="Signup application not found.")
		if user.approval_status == "rejected":
			raise HTTPException(status_code=409, detail="Rejected applications cannot be approved.")
		user.approval_status = "active"
		user.updated_at = utc_now()
		db.commit()
		db.refresh(user)
		return user_to_signup_application(user)


@app.post("/admin/signup-applications/{user_id}/reject", response_model=SignupApplicationResponse)
def reject_signup_application(
	user_id: str,
	x_admin_key: str | None = Header(default=None, alias="X-Admin-Key"),
) -> SignupApplicationResponse:
	require_admin_api_key(x_admin_key)
	with get_session() as db:
		user = db.scalar(select(UserModel).where(UserModel.id == user_id))
		if user is None:
			raise HTTPException(status_code=404, detail="Signup application not found.")
		if user.approval_status == "active":
			raise HTTPException(status_code=409, detail="Active applications cannot be rejected.")
		user.approval_status = "rejected"
		user.updated_at = utc_now()
		db.commit()
		db.refresh(user)
		return user_to_signup_application(user)


@app.get("/admin/signup-id-submissions", response_model=list[SignupIdentitySubmissionSummaryResponse])
def list_signup_id_submissions(
	x_admin_key: str | None = Header(default=None, alias="X-Admin-Key"),
) -> list[SignupIdentitySubmissionSummaryResponse]:
	require_admin_api_key(x_admin_key)
	with get_session() as db:
		rows = db.scalars(
			select(SignupIdentityDocumentModel).order_by(SignupIdentityDocumentModel.created_at.desc())
		).all()
		return [serialize_signup_identity_submission_summary(item) for item in rows]


@app.get("/admin/signup-id-submissions/{submission_id}", response_model=SignupIdentitySubmissionDetailResponse)
def get_signup_id_submission(
	submission_id: str,
	x_admin_key: str | None = Header(default=None, alias="X-Admin-Key"),
) -> SignupIdentitySubmissionDetailResponse:
	require_admin_api_key(x_admin_key)
	with get_session() as db:
		record = db.scalar(select(SignupIdentityDocumentModel).where(SignupIdentityDocumentModel.id == submission_id))
		if record is None:
			raise HTTPException(status_code=404, detail="ID submission not found.")
		return serialize_signup_identity_submission_detail(record)


@app.post("/auth/login", response_model=AuthSessionResponse)
def login(payload: AuthLoginRequest, response: Response, request: Request) -> AuthSessionResponse:
	enforce_auth_rate_limit(request, "login")
	email = normalize_email(payload.email)
	password = payload.password
	role = payload.role

	with get_session() as db:
		user = db.scalar(select(UserModel).where(UserModel.email == email, UserModel.role == role))
		if user is None or not verify_password(password, user.password_hash):
			raise HTTPException(status_code=401, detail="Invalid credentials for the selected role.")
		if user.approval_status == "pending_review":
			raise HTTPException(status_code=403, detail="Your application is pending review.")
		if user.approval_status == "rejected":
			raise HTTPException(status_code=403, detail="Your application was not approved.")

		set_auth_session_cookie(response, user.id)
		return user_to_auth_session(user)


@app.post("/auth/logout")
def logout(response: Response) -> dict[str, str]:
	response.delete_cookie(
		key=AUTH_SESSION_COOKIE_NAME,
		path="/",
	)
	return {"detail": "Signed out."}


def apply_user_profile_updates(user: UserModel, payload: AuthProfileUpdateRequest) -> None:
	if payload.full_name is not None:
		user.full_name = payload.full_name.strip()
	if payload.company_name is not None:
		user.company_name = payload.company_name.strip()
	if payload.phone is not None:
		user.phone = payload.phone.strip() or None
	if payload.address is not None:
		trimmed_address = payload.address.strip()
		user.address = (
			validate_and_normalize_google_address(
				trimmed_address,
				"address",
				payload.address_place_id,
				require_place_id=False,
			)
			if trimmed_address
			else None
		)
	if payload.bio is not None:
		user.bio = payload.bio.strip() or None


def apply_carrier_compliance_updates(db: Session, user: UserModel, payload: AuthProfileUpdateRequest) -> None:
	if payload.tax_id is not None:
		normalized_tax_id = "".join(ch for ch in payload.tax_id if ch.isdigit())
		if not normalized_tax_id:
			raise HTTPException(status_code=400, detail="Enter EIN/Tax ID.")
		if len(normalized_tax_id) != 9:
			raise HTTPException(status_code=400, detail="Enter a valid EIN/Tax ID with 9 digits.")
		duplicate_tax = db.scalar(
			select(UserModel).where(
				UserModel.role == "carrier",
				UserModel.tax_id_digits == normalized_tax_id,
				UserModel.id != user.id,
			)
		)
		if duplicate_tax is not None:
			raise HTTPException(status_code=409, detail="Carrier EIN/Tax ID already exists.")
		user.tax_id_digits = normalized_tax_id
		user.tax_id = f"{normalized_tax_id[:2]}-{normalized_tax_id[2:]}"

	if payload.dot_number is not None:
		normalized_dot = "".join(ch for ch in payload.dot_number if ch.isdigit())
		if not normalized_dot:
			raise HTTPException(status_code=400, detail="Enter USDOT number.")
		if not (6 <= len(normalized_dot) <= 8 and normalized_dot[0] != "0"):
			raise HTTPException(status_code=400, detail="Enter a valid USDOT number (6 to 8 digits).")
		duplicate_dot = db.scalar(
			select(UserModel).where(
				UserModel.role == "carrier",
				UserModel.dot_number_digits == normalized_dot,
				UserModel.id != user.id,
			)
		)
		if duplicate_dot is not None:
			raise HTTPException(status_code=409, detail="Carrier USDOT number already exists.")
		user.dot_number_digits = normalized_dot
		user.dot_number = normalized_dot


def apply_carrier_settings_updates(
	db: Session,
	user: UserModel,
	carrier_payload: CarrierSettingsPayload | None,
) -> CarrierSettingsModel:
	settings = get_or_create_carrier_settings(db, user)
	settings.carrier_name = user.company_name

	if carrier_payload is not None:
		scalar_updates: tuple[tuple[str, str], ...] = (
			("available_trucks", "available_trucks"),
			("max_weight_kg", "max_weight_kg"),
			("fuel_efficiency_kmpl", "fuel_efficiency_kmpl"),
			("idle_fuel_lph", "idle_fuel_lph"),
			("maintenance_cost_per_km_usd", "maintenance_cost_per_km_usd"),
			("driver_cost_per_hour_usd", "driver_cost_per_hour_usd"),
			("toll_discount_pct", "toll_discount_pct"),
			("fuel_price_adjustment_pct", "fuel_price_adjustment_pct"),
			("empty_mile_factor_pct", "empty_mile_factor_pct"),
		)
		for payload_field, settings_field in scalar_updates:
			value = getattr(carrier_payload, payload_field)
			if value is not None:
				setattr(settings, settings_field, value)

		if carrier_payload.base_location is not None:
			settings.base_location = validate_and_normalize_google_address(
				carrier_payload.base_location,
				"base location",
				carrier_payload.base_location_place_id,
				require_place_id=False,
			)

		regions = normalize_region_list(carrier_payload.service_regions)
		if regions is not None:
			settings.service_regions = normalize_and_validate_service_regions(
				regions,
				carrier_payload.service_region_place_ids,
			)

		vehicle_types = normalize_vehicle_types(carrier_payload.vehicle_types)
		if vehicle_types is not None:
			settings.vehicle_types = vehicle_types

	settings.updated_at = utc_now()
	db.add(settings)
	return settings


def normalize_and_validate_service_regions(
	regions: list[str],
	place_ids: list[str] | None,
) -> list[str]:
	resolved_place_ids = place_ids or []
	validated_regions: list[str] = []

	for index, region in enumerate(regions):
		place_id = resolved_place_ids[index].strip() if index < len(resolved_place_ids) and resolved_place_ids[index] else None
		validated_region = validate_and_normalize_google_address(
			region,
			"service region",
			place_id,
		)
		if validated_region not in validated_regions:
			validated_regions.append(validated_region)

	return validated_regions


@app.get("/auth/profile", response_model=AuthProfileResponse)
def get_profile(
	email: str = Query(min_length=4, max_length=320),
	role: Literal["client", "carrier"] = Query(),
) -> AuthProfileResponse:
	with get_session() as db:
		user = get_user_by_identity(db, email, role, require_subscription=False)
		settings = db.scalar(select(CarrierSettingsModel).where(CarrierSettingsModel.user_id == user.id)) if role == "carrier" else None
		return user_to_auth_profile(user, settings)


@app.put("/auth/profile", response_model=AuthProfileResponse)
def update_profile(
	payload: AuthProfileUpdateRequest,
	email: str = Query(min_length=4, max_length=320),
	role: Literal["client", "carrier"] = Query(),
) -> AuthProfileResponse:
	with get_session() as db:
		user = get_user_by_identity(db, email, role, require_subscription=False)
		apply_user_profile_updates(user, payload)

		settings: CarrierSettingsModel | None = None
		if role == "carrier":
			apply_carrier_compliance_updates(db, user, payload)
			settings = apply_carrier_settings_updates(db, user, payload.carrier_profile)

		user.updated_at = utc_now()
		db.add(user)
		db.commit()
		db.refresh(user)
		if settings is not None:
			db.refresh(settings)

		return user_to_auth_profile(user, settings)


@app.get("/driver-application/profile", response_model=DriverApplicationProfileResponse)
def get_driver_application_profile(email: str = Query(min_length=4, max_length=320)) -> DriverApplicationProfileResponse:
	with get_session() as db:
		user = get_user_by_identity(db, email, "driver", require_subscription=False)
		profile = db.scalar(select(DriverApplicationModel).where(DriverApplicationModel.user_id == user.id))
		if profile is None:
			first_name, _, last_name = user.full_name.strip().partition(" ")
			profile = DriverApplicationModel(
				user_id=user.id,
				first_name=first_name or "Driver",
				last_name=last_name or "Profile",
				phone=user.phone or "Not provided",
				address=user.address or "Not provided",
				zip_code="Not set",
				cdl_information="Pending",
				years_experience=0,
				qualifications="",
				endorsements="",
				availability_notes="",
				truck_type="",
				trailer_type="",
				capacity="",
				vehicle_information="",
				availability_status="available",
				updated_at=utc_now(),
			)
			db.add(profile)
			db.commit()
			db.refresh(profile)
		return driver_application_to_response(user, profile)


@app.put("/driver-application/profile", response_model=DriverApplicationProfileResponse)
def update_driver_application_profile(
	payload: DriverApplicationProfilePayload,
	email: str = Query(min_length=4, max_length=320),
) -> DriverApplicationProfileResponse:
	with get_session() as db:
		user = get_user_by_identity(db, email, "driver", require_subscription=False)
		profile = db.scalar(select(DriverApplicationModel).where(DriverApplicationModel.user_id == user.id))
		profile_values = payload.model_dump()
		resume_base64 = profile_values.get("resume_base64")
		if resume_base64:
			profile_values["resume_base64"] = None
			profile_values["resume_temporary_upload_id"] = store_temporary_upload(
				profile_values.get("resume_name") or "resume",
				profile_values.get("resume_mime_type") or "application/octet-stream",
				resume_base64,
			)
		else:
			profile_values["resume_temporary_upload_id"] = None
		if profile is None:
			profile = DriverApplicationModel(user_id=user.id, updated_at=utc_now(), **profile_values)
			db.add(profile)
		else:
			for field_name, value in profile_values.items():
				setattr(profile, field_name, value)
			profile.updated_at = utc_now()

		user.full_name = f"{payload.first_name.strip()} {payload.last_name.strip()}".strip()
		user.phone = payload.phone.strip()
		user.address = payload.address.strip()
		user.updated_at = utc_now()
		db.add(user)
		db.commit()
		db.refresh(profile)
		return driver_application_to_response(user, profile)


@app.get("/billing/subscription-plans", response_model=list[BillingPlanResponse])
def get_subscription_plans() -> list[BillingPlanResponse]:
	return [
		BillingPlanResponse(role="client", name="Shipper", price_usd=25.00, price_id=STRIPE_CLIENT_PRICE_ID or None),
		BillingPlanResponse(role="carrier", name="Carrier", price_usd=49.99, price_id=STRIPE_CARRIER_PRICE_ID or None),
	]


@app.get("/billing/subscription-status", response_model=BillingStatusResponse)
def get_subscription_status(
	email: str = Query(min_length=4, max_length=320),
	role: Literal["client", "carrier"] = Query(),
) -> BillingStatusResponse:
	with get_session() as db:
		user = get_user_by_identity(db, email, role, require_subscription=False)
		return build_billing_status_response(db, user, role)


@app.post("/billing/checkout-session", response_model=BillingCheckoutResponse)
def create_billing_checkout_session(
	payload: BillingCheckoutRequest,
	email: str = Query(min_length=4, max_length=320),
	role: Literal["client", "carrier"] = Query(),
) -> BillingCheckoutResponse:
	require_stripe_ready()
	price_id = stripe_price_id_for_role(role)
	if not price_id:
		raise HTTPException(status_code=503, detail=f"Stripe price is not configured for role: {role}.")

	default_return_url = f"{FRONTEND_BASE_URL.rstrip('/')}/{role}?billing=success"
	return_url = (payload.return_url or payload.success_url or default_return_url).strip()

	with get_session() as db:
		user = get_user_by_identity(db, email, role, require_subscription=False)
		customer_id = ensure_stripe_customer_id(db, user)

		session = stripe.checkout.Session.create(  # type: ignore[union-attr]
			mode="subscription",
			ui_mode="embedded",
			customer=customer_id,
			line_items=[{"price": price_id, "quantity": 1}],
			return_url=return_url,
			allow_promotion_codes=True,
			metadata={"user_id": user.id, "role": user.role},
		)

		client_secret = getattr(session, "client_secret", None)
		if not client_secret:
			raise HTTPException(status_code=502, detail="Stripe embedded checkout session did not return a client secret.")
		return BillingCheckoutResponse(client_secret=client_secret, checkout_url="")


@app.post("/shipments/{shipment_id}/payment-checkout", response_model=BillingCheckoutResponse)
def create_shipment_payment_checkout_session(
	shipment_id: str,
	payload: ShipmentPaymentCheckoutRequest,
	actor_role: ActorRole | None = Query(default=None, alias="as"),
	actor_name: str | None = Query(default=None, alias="name"),
) -> BillingCheckoutResponse:
	role, name = require_actor_context(actor_role, actor_name)
	if role != ActorRole.client:
		raise HTTPException(status_code=403, detail="Only clients can pay for shipments.")
	require_stripe_ready()

	with get_session() as db:
		user = require_subscription_for_actor(db, role, name)
		shipment = get_shipment_model(db, shipment_id)
		ensure_client_access(shipment, name)
		if shipment.quote_status != QUOTE_STATUS_ACCEPTED:
			raise HTTPException(status_code=409, detail="Quote must be accepted before opening payment checkout.")
		if shipment.payment_status == "paid" or shipment.quote_status == QUOTE_STATUS_PAID:
			raise HTTPException(status_code=409, detail="Shipment payment is already completed.")

		amount = shipment_offer_amount(shipment)
		if amount is None:
			raise HTTPException(status_code=409, detail="No offer amount is available for this shipment.")

		amount_cents = max(50, int(round(amount * 100)))
		base_client_url = f"{FRONTEND_BASE_URL.rstrip('/')}/client"
		default_return_url = f"{base_client_url}?shipmentPayment=success&shipmentId={shipment.id}&checkoutSessionId={{CHECKOUT_SESSION_ID}}"
		default_success_url = f"{base_client_url}?shipmentPayment=success&shipmentId={shipment.id}&checkoutSessionId={{CHECKOUT_SESSION_ID}}"
		default_cancel_url = f"{base_client_url}?shipmentPayment=cancel&shipmentId={shipment.id}"
		return_url = (payload.success_url or payload.return_url or default_return_url).strip()
		success_url = (payload.success_url or payload.return_url or default_success_url).strip()
		cancel_url = (payload.cancel_url or default_cancel_url).strip()

		customer_id = ensure_stripe_customer_id(db, user)
		common_session_payload = {
			"mode": "payment",
			"customer": customer_id,
			"line_items": [
				{
					"price_data": {
						"currency": "usd",
						"unit_amount": amount_cents,
						"product_data": {
							"name": f"Shipment Payment {shipment.id[:8].upper()}",
							"description": f"{shipment.origin} -> {shipment.destination}",
						},
					},
					"quantity": 1,
				}
			],
			"metadata": {
				"shipment_id": shipment.id,
				"client_name": shipment.client_name,
				"carrier_name": shipment.carrier_name or "",
			},
			"payment_intent_data": {
				"metadata": {
					"shipment_id": shipment.id,
					"client_name": shipment.client_name,
					"carrier_name": shipment.carrier_name or "",
				}
			},
		}

		if payload.embedded:
			session = stripe.checkout.Session.create(  # type: ignore[union-attr]
				ui_mode="embedded",
				return_url=return_url,
				**common_session_payload,
			)
			client_secret = getattr(session, "client_secret", None)
			if not client_secret:
				raise HTTPException(status_code=502, detail="Stripe embedded checkout session did not return a client secret.")
			return BillingCheckoutResponse(client_secret=client_secret, checkout_url="")

		session = stripe.checkout.Session.create(  # type: ignore[union-attr]
			success_url=success_url,
			cancel_url=cancel_url,
			**common_session_payload,
		)
		if not session.url:
			raise HTTPException(status_code=502, detail="Stripe checkout session did not return a URL.")
		return BillingCheckoutResponse(client_secret=None, checkout_url=session.url)


@app.post("/billing/payment-method-setup-session", response_model=BillingCheckoutResponse)
def create_payment_method_setup_session(
	payload: BillingPaymentMethodSetupRequest,
	email: str = Query(min_length=4, max_length=320),
	role: Literal["client", "carrier"] = Query(),
) -> BillingCheckoutResponse:
	require_stripe_ready()
	frontend_role_path = "carrier" if role == "carrier" else "client"
	base_role_url = f"{FRONTEND_BASE_URL.rstrip('/')}/{frontend_role_path}"
	default_success = f"{base_role_url}?wallet=setup-success&instrument={payload.instrument_type}"
	default_cancel = f"{base_role_url}?wallet=setup-cancel&instrument={payload.instrument_type}"
	success_url = (payload.success_url or default_success).strip()
	cancel_url = (payload.cancel_url or default_cancel).strip()

	with get_session() as db:
		user = get_user_by_identity(db, email, role, require_subscription=False)
		customer_id = ensure_stripe_customer_id(db, user)

		payment_method_types = ["card"]
		setup_intent_data: dict[str, object] = {
			"metadata": {"user_id": user.id, "role": user.role, "instrument_type": payload.instrument_type}
		}
		if payload.instrument_type == "bank_account":
			payment_method_types = ["us_bank_account"]
			setup_intent_data["payment_method_options"] = {
				"us_bank_account": {
					"financial_connections": {"permissions": ["payment_method"]}
				}
			}

		session = stripe.checkout.Session.create(  # type: ignore[union-attr]
			mode="setup",
			customer=customer_id,
			payment_method_types=payment_method_types,
			setup_intent_data=setup_intent_data,
			success_url=success_url,
			cancel_url=cancel_url,
			metadata={"user_id": user.id, "role": user.role, "instrument_type": payload.instrument_type},
		)

		if not session.url:
			raise HTTPException(status_code=502, detail="Stripe setup session did not return a URL.")
		return BillingCheckoutResponse(checkout_url=session.url)


def build_payment_method_status(user: UserModel, role: Literal["client", "carrier"]) -> BillingPaymentMethodStatusResponse:
	if not user.stripe_customer_id or stripe is None or not STRIPE_SECRET_KEY:
		return BillingPaymentMethodStatusResponse(
			role=role,
			stripe_customer_ready=False,
			has_card=False,
			has_bank_account=False,
			card_last4=None,
		)

	cards = stripe.PaymentMethod.list(  # type: ignore[union-attr]
		customer=user.stripe_customer_id,
		type="card",
		limit=1,
	)
	banks = stripe.PaymentMethod.list(  # type: ignore[union-attr]
		customer=user.stripe_customer_id,
		type="us_bank_account",
		limit=1,
	)
	card_items = getattr(cards, "data", []) or []
	bank_items = getattr(banks, "data", []) or []
	primary_card = card_items[0] if card_items else None
	card_details = getattr(primary_card, "card", None) if primary_card is not None else None
	card_last4 = str(getattr(card_details, "last4", "") or "")[:4] or None

	return BillingPaymentMethodStatusResponse(
		role=role,
		stripe_customer_ready=True,
		has_card=len(card_items) > 0,
		has_bank_account=len(bank_items) > 0,
		card_last4=card_last4,
	)


@app.get("/billing/payment-method-status", response_model=BillingPaymentMethodStatusResponse)
def get_payment_method_status(
	email: str = Query(min_length=4, max_length=320),
	role: Literal["client", "carrier"] = Query(),
) -> BillingPaymentMethodStatusResponse:
	with get_session() as db:
		user = get_user_by_identity(db, email, role, require_subscription=False)
		return build_payment_method_status(user, role)


@app.post("/billing/payment-method-remove", response_model=BillingPaymentMethodStatusResponse)
def remove_payment_method(
	payload: BillingPaymentMethodRemoveRequest,
	email: str = Query(min_length=4, max_length=320),
	role: Literal["client", "carrier"] = Query(),
) -> BillingPaymentMethodStatusResponse:
	require_stripe_ready()
	stripe_payment_method_type = "us_bank_account" if payload.instrument_type == "bank_account" else "card"

	with get_session() as db:
		user = get_user_by_identity(db, email, role, require_subscription=False)
		if not user.stripe_customer_id:
			return build_payment_method_status(user, role)

		methods = stripe.PaymentMethod.list(  # type: ignore[union-attr]
			customer=user.stripe_customer_id,
			type=stripe_payment_method_type,
			limit=100,
		)
		for method in getattr(methods, "data", []) or []:
			method_id = getattr(method, "id", None)
			if method_id:
				stripe.PaymentMethod.detach(method_id)  # type: ignore[union-attr]

		return build_payment_method_status(user, role)


@app.post("/billing/payout-onboarding", response_model=BillingCheckoutResponse)
def create_payout_onboarding_link(
	payload: BillingPayoutOnboardingRequest,
	email: str = Query(min_length=4, max_length=320),
	role: Literal["carrier"] = Query(),
) -> BillingCheckoutResponse:
	require_stripe_ready()
	base_carrier_url = f"{FRONTEND_BASE_URL.rstrip('/')}/carrier"
	return_url = (payload.return_url or f"{base_carrier_url}?wallet=connect-success").strip()
	refresh_url = (payload.refresh_url or f"{base_carrier_url}?wallet=connect-refresh").strip()

	with get_session() as db:
		user = get_user_by_identity(db, email, role, require_subscription=False)
		if not user.stripe_connect_account_id:
			connect_account = stripe.Account.create(  # type: ignore[union-attr]
				type="express",
				country="US",
				email=user.email,
				business_type="company",
				capabilities={"transfers": {"requested": True}},
				metadata={"user_id": user.id, "role": user.role},
			)
			user.stripe_connect_account_id = connect_account.id
			user.updated_at = utc_now()
			db.add(user)
			db.commit()
			db.refresh(user)

		account_link = stripe.AccountLink.create(  # type: ignore[union-attr]
			account=user.stripe_connect_account_id,
			refresh_url=refresh_url,
			return_url=return_url,
			type="account_onboarding",
		)
		if not account_link.url:
			raise HTTPException(status_code=502, detail="Stripe account onboarding link did not return a URL.")
		return BillingCheckoutResponse(checkout_url=account_link.url)


@app.get("/billing/payout-account-status", response_model=BillingPayoutAccountStatusResponse)
def get_payout_account_status(
	email: str = Query(min_length=4, max_length=320),
	role: Literal["carrier"] = Query(),
) -> BillingPayoutAccountStatusResponse:
	with get_session() as db:
		user = get_user_by_identity(db, email, role, require_subscription=False)
		if not user.stripe_connect_account_id or stripe is None or not STRIPE_SECRET_KEY:
			return BillingPayoutAccountStatusResponse(
				role="carrier",
				has_connect_account=False,
				connect_account_id=None,
				payouts_enabled=False,
				charges_enabled=False,
				onboarding_complete=False,
			)

		account = stripe.Account.retrieve(user.stripe_connect_account_id)  # type: ignore[union-attr]
		payouts_enabled = bool(getattr(account, "payouts_enabled", False))
		charges_enabled = bool(getattr(account, "charges_enabled", False))
		details_submitted = bool(getattr(account, "details_submitted", False))
		return BillingPayoutAccountStatusResponse(
			role="carrier",
			has_connect_account=True,
			connect_account_id=user.stripe_connect_account_id,
			payouts_enabled=payouts_enabled,
			charges_enabled=charges_enabled,
			onboarding_complete=details_submitted,
		)


@app.post("/billing/subscription-refresh", response_model=BillingStatusResponse)
def refresh_subscription_status(
	email: str = Query(min_length=4, max_length=320),
	role: Literal["client", "carrier"] = Query(),
) -> BillingStatusResponse:
	with get_session() as db:
		user = get_user_by_identity(db, email, role, require_subscription=False)
		return build_billing_status_response(db, user, role)


@app.post("/billing/subscription-cancel", response_model=BillingStatusResponse)
def cancel_subscription(
	email: str = Query(min_length=4, max_length=320),
	role: Literal["client", "carrier"] = Query(),
) -> BillingStatusResponse:
	"""Schedule cancellation at end of current billing period so access remains active until then."""
	require_stripe_ready()
	with get_session() as db:
		user = get_user_by_identity(db, email, role, require_subscription=False)
		subscription = get_manageable_stripe_subscription(user)
		subscription_id = getattr(subscription, "id", None)
		if not subscription_id:
			raise HTTPException(status_code=502, detail="Stripe subscription ID was not returned.")

		stripe.Subscription.modify(  # type: ignore[union-attr]
			subscription_id,
			cancel_at_period_end=True,
		)

		return build_billing_status_response(db, user, role)


@app.post("/billing/subscription-resume", response_model=BillingStatusResponse)
def resume_subscription(
	email: str = Query(min_length=4, max_length=320),
	role: Literal["client", "carrier"] = Query(),
) -> BillingStatusResponse:
	"""Undo a scheduled cancellation so the subscription auto-renews as normal."""
	require_stripe_ready()
	with get_session() as db:
		user = get_user_by_identity(db, email, role, require_subscription=False)
		subscription = get_manageable_stripe_subscription(user)
		subscription_id = getattr(subscription, "id", None)
		if not subscription_id:
			raise HTTPException(status_code=502, detail="Stripe subscription ID was not returned.")

		stripe.Subscription.modify(  # type: ignore[union-attr]
			subscription_id,
			cancel_at_period_end=False,
		)

		return build_billing_status_response(db, user, role)


@app.get("/carrier/drivers", response_model=list[CarrierDriverSummaryResponse])
def list_carrier_drivers(
	email: str = Query(min_length=4, max_length=320),
	role: Literal["carrier"] = Query(),
) -> list[CarrierDriverSummaryResponse]:
	with get_session() as db:
		user = get_user_by_identity(db, email, role)
		rows = db.scalars(
			select(CarrierDriverModel)
			.where(CarrierDriverModel.carrier_user_id == user.id)
			.order_by(CarrierDriverModel.created_at.desc())
		).all()
		return [serialize_carrier_driver(row) for row in rows]


@app.post("/carrier/drivers/generate-token", response_model=CarrierDriverTokenResponse)
def generate_driver_login_token(
	payload: CarrierDriverTokenRequest,
	email: str = Query(min_length=4, max_length=320),
	role: Literal["carrier"] = Query(),
) -> CarrierDriverTokenResponse:
	with get_session() as db:
		user = get_user_by_identity(db, email, role)
		driver_name = normalize_driver_name(payload.driver_name)
		driver_mobile = normalize_driver_mobile(payload.driver_mobile)
		now = utc_now()

		driver = db.scalar(
			select(CarrierDriverModel).where(
				CarrierDriverModel.carrier_user_id == user.id,
				CarrierDriverModel.driver_mobile == driver_mobile,
			)
		)
		if driver is None:
			driver = CarrierDriverModel(
				id=str(uuid4()),
				carrier_user_id=user.id,
				carrier_name=user.company_name.strip() or user.full_name.strip(),
				driver_name=driver_name,
				driver_mobile=driver_mobile,
				created_at=now,
				updated_at=now,
			)

		login_token = f"DRV-{uuid4().hex[:8].upper()}"
		driver.driver_name = driver_name
		driver.login_token_hash = hash_password(login_token)
		driver.token_expires_at = now + timedelta(days=7)
		driver.updated_at = now

		db.add(driver)
		db.commit()
		db.refresh(driver)

		return CarrierDriverTokenResponse(
			driver=serialize_carrier_driver(driver),
			login_token=login_token,
		)


@app.post("/carrier/drivers/{driver_id}/regenerate-token", response_model=CarrierDriverTokenResponse)
def regenerate_driver_login_token(
	driver_id: str,
	email: str = Query(min_length=4, max_length=320),
	role: Literal["carrier"] = Query(),
) -> CarrierDriverTokenResponse:
	with get_session() as db:
		user = get_user_by_identity(db, email, role)
		driver = db.scalar(
			select(CarrierDriverModel).where(
				CarrierDriverModel.id == driver_id,
				CarrierDriverModel.carrier_user_id == user.id,
			)
		)
		if driver is None:
			raise HTTPException(status_code=404, detail="Driver not found for this carrier.")

		now = utc_now()
		login_token = f"DRV-{uuid4().hex[:8].upper()}"
		driver.login_token_hash = hash_password(login_token)
		driver.token_expires_at = now + timedelta(days=7)
		driver.updated_at = now

		db.add(driver)
		db.commit()
		db.refresh(driver)

		return CarrierDriverTokenResponse(
			driver=serialize_carrier_driver(driver),
			login_token=login_token,
		)


@app.post("/driver/login", response_model=DriverSessionResponse)
def driver_login(payload: DriverLoginRequest) -> DriverSessionResponse:
	now = utc_now()
	now_naive_utc = now.replace(tzinfo=None)

	with get_session() as db:
		candidates = db.scalars(select(CarrierDriverModel)).all()

		for candidate in candidates:
			if not candidate.login_token_hash:
				continue
			if not verify_password(payload.login_token, candidate.login_token_hash):
				continue
			token_expires_at = candidate.token_expires_at
			if token_expires_at is not None and token_expires_at.tzinfo is not None:
				token_expires_at = token_expires_at.astimezone(timezone.utc).replace(tzinfo=None)
			if token_expires_at is None or token_expires_at < now_naive_utc:
				raise HTTPException(status_code=401, detail="Driver token expired. Ask carrier for a new token.")

			carrier_user = db.scalar(select(UserModel).where(UserModel.id == candidate.carrier_user_id, UserModel.role == "carrier"))
			if carrier_user is None:
				raise HTTPException(status_code=404, detail="Carrier account not found for this driver.")
			require_subscription_active(carrier_user)

			candidate.last_login_at = now
			candidate.updated_at = now
			db.add(candidate)
			db.commit()

			return DriverSessionResponse(
				driver_id=candidate.id,
				driver_name=candidate.driver_name,
				driver_mobile=candidate.driver_mobile,
				carrier_name=candidate.carrier_name,
				carrier_email=carrier_user.email,
			)

		raise HTTPException(status_code=401, detail="Invalid driver login credentials.")


@app.post("/driver/start-tracking", response_model=DriverTrackingResponse)
def start_driver_tracking(payload: DriverTrackingRequest) -> DriverTrackingResponse:
	with get_session() as db:
		driver = db.scalar(select(CarrierDriverModel).where(CarrierDriverModel.id == payload.driver_id))
		if driver is None:
			raise HTTPException(status_code=404, detail=DRIVER_SESSION_NOT_FOUND_DETAIL)
		carrier_user = db.scalar(select(UserModel).where(UserModel.id == driver.carrier_user_id, UserModel.role == "carrier"))
		if carrier_user is None:
			raise HTTPException(status_code=404, detail="Carrier account not found for this driver.")
		require_subscription_active(carrier_user)

		now = utc_now()
		driver.tracking_started_at = now
		driver.last_tracking_at = now
		driver.updated_at = now
		db.add(driver)

		shipment = get_driver_current_shipment(db, driver)
		event = DriverTrackingEventModel(
			id=str(uuid4()),
			driver_id=driver.id,
			carrier_user_id=driver.carrier_user_id,
			shipment_id=shipment.id if shipment is not None else None,
			latitude=None,
			longitude=None,
			accuracy_m=None,
			speed_kph=None,
			heading_deg=None,
			note="tracking_started",
			created_at=now,
		)
		db.add(event)
		db.commit()

		return DriverTrackingResponse(driver_id=driver.id, status="tracking_started", tracked_at=now)


@app.post("/driver/tracking-update", response_model=DriverTrackingUpdateResponse)
def update_driver_tracking(payload: DriverTrackingUpdateRequest) -> DriverTrackingUpdateResponse:
	with get_session() as db:
		driver = db.scalar(select(CarrierDriverModel).where(CarrierDriverModel.id == payload.driver_id))
		if driver is None:
			raise HTTPException(status_code=404, detail=DRIVER_SESSION_NOT_FOUND_DETAIL)
		carrier_user = db.scalar(select(UserModel).where(UserModel.id == driver.carrier_user_id, UserModel.role == "carrier"))
		if carrier_user is None:
			raise HTTPException(status_code=404, detail="Carrier account not found for this driver.")
		require_subscription_active(carrier_user)

		now = utc_now()
		event_time = payload.timestamp or now
		if driver.tracking_started_at is None:
			driver.tracking_started_at = event_time
		driver.last_tracking_at = now
		driver.updated_at = now
		db.add(driver)

		shipment = get_driver_current_shipment(db, driver)
		shipment_id = shipment.id if shipment is not None else None
		if payload.shipment_id and payload.shipment_id.strip():
			explicit_shipment = db.get(ShipmentModel, payload.shipment_id.strip())
			if explicit_shipment is None:
				raise HTTPException(status_code=404, detail="Shipment not found.")
			if explicit_shipment.assigned_driver_id != driver.id:
				raise HTTPException(status_code=403, detail="Driver is not assigned to this shipment.")
			shipment_id = explicit_shipment.id

		event = DriverTrackingEventModel(
			id=str(uuid4()),
			driver_id=driver.id,
			carrier_user_id=driver.carrier_user_id,
			shipment_id=shipment_id,
			latitude=payload.latitude,
			longitude=payload.longitude,
			accuracy_m=payload.accuracy_m,
			speed_kph=payload.speed_kph,
			heading_deg=payload.heading_deg,
			note=payload.note.strip() if payload.note else "live_update",
			created_at=event_time,
		)
		db.add(event)
		db.commit()

		return DriverTrackingUpdateResponse(
			driver_id=driver.id,
			tracked_at=now,
			latitude=payload.latitude,
			longitude=payload.longitude,
			note=payload.note,
		)


@app.get("/driver/current-shipment", response_model=DriverCurrentShipmentResponse)
def get_driver_current_shipment_details(driver_id: str = Query(min_length=8, max_length=64)) -> DriverCurrentShipmentResponse:
	with get_session() as db:
		driver = db.scalar(select(CarrierDriverModel).where(CarrierDriverModel.id == driver_id))
		if driver is None:
			raise HTTPException(status_code=404, detail=DRIVER_SESSION_NOT_FOUND_DETAIL)
		carrier_user = db.scalar(select(UserModel).where(UserModel.id == driver.carrier_user_id, UserModel.role == "carrier"))
		if carrier_user is None:
			raise HTTPException(status_code=404, detail="Carrier account not found for this driver.")
		require_subscription_active(carrier_user)

		shipment = get_driver_current_shipment(db, driver)
		return DriverCurrentShipmentResponse(
			driver_id=driver.id,
			tracking_started_at=driver.tracking_started_at,
			last_tracking_at=driver.last_tracking_at,
			shipment=serialize_shipment(shipment) if shipment is not None else None,
		)


@app.post("/driver/documents/upload", response_model=DriverDocumentRecordResponse)
def upload_driver_document(payload: DriverDocumentUploadRequest) -> DriverDocumentRecordResponse:
	with get_session() as db:
		driver = db.scalar(select(CarrierDriverModel).where(CarrierDriverModel.id == payload.driver_id))
		if driver is None:
			raise HTTPException(status_code=404, detail=DRIVER_SESSION_NOT_FOUND_DETAIL)
		carrier_user = db.scalar(select(UserModel).where(UserModel.id == driver.carrier_user_id, UserModel.role == "carrier"))
		if carrier_user is None:
			raise HTTPException(status_code=404, detail="Carrier account not found for this driver.")
		require_subscription_active(carrier_user)
		temporary_upload_id = (
			store_temporary_upload(
				payload.document_name.strip(),
				payload.file_mime_type.strip(),
				payload.file_base64.strip(),
			)
			if payload.file_mime_type and payload.file_base64
			else None
		)

		record = DriverDocumentModel(
			id=str(uuid4()),
			carrier_user_id=driver.carrier_user_id,
			carrier_name=driver.carrier_name,
			driver_id=driver.id,
			driver_name=driver.driver_name,
			driver_mobile=driver.driver_mobile,
			document_name=payload.document_name.strip(),
			document_type=payload.document_type.strip().lower(),
			notes=payload.notes.strip() if payload.notes else None,
			content_text=payload.content_text.strip() if payload.content_text else None,
			file_mime_type=payload.file_mime_type.strip() if payload.file_mime_type else None,
			file_base64=None,
			temporary_upload_id=temporary_upload_id,
			created_at=utc_now(),
		)
		db.add(record)

		document_type = (payload.document_type or "").strip().lower().replace("-", "_")
		if document_type in {"pod", "proof_of_delivery", "proof of delivery"}:
			shipment = get_driver_current_shipment(db, driver)
			if shipment is not None:
				shipment.pod_status = POD_STATUS_UPLOADED
				shipment.pod_uploaded_at = utc_now()
				shipment.pod_confirmed_at = None
				shipment.payout_release_eligible_at = None
				shipment.updated_at = utc_now()
				set_shipment_status_note(
					shipment,
					shipment.status,
					f"POD uploaded by driver {driver.driver_name}.",
				)
				db.add(shipment)

		db.commit()
		db.refresh(record)

		return serialize_driver_document(record)


@app.get("/carrier/driver-documents", response_model=list[DriverDocumentRecordResponse])
def list_carrier_driver_documents(
	email: str = Query(min_length=4, max_length=320),
	role: Literal["carrier"] = Query(),
) -> list[DriverDocumentRecordResponse]:
	with get_session() as db:
		user = get_user_by_identity(db, email, role)
		rows = db.scalars(
			select(DriverDocumentModel)
			.where(DriverDocumentModel.carrier_user_id == user.id)
			.order_by(DriverDocumentModel.created_at.desc())
		).all()
		return [serialize_driver_document(row) for row in rows]


def build_live_tracking_rows(
	db: Session,
	shipments: list[ShipmentModel],
	history_limit: int,
) -> list[CarrierShipmentLiveTrackingResponse]:
	if not shipments:
		return []

	driver_ids = {shipment.assigned_driver_id for shipment in shipments if shipment.assigned_driver_id}
	driver_map = {
		driver.id: driver
		for driver in db.scalars(
			select(CarrierDriverModel).where(
				CarrierDriverModel.id.in_(list(driver_ids)),
			)
		).all()
	}

	results: list[CarrierShipmentLiveTrackingResponse] = []
	for shipment in shipments:
		driver_id = shipment.assigned_driver_id
		if not driver_id:
			continue

		driver = driver_map.get(driver_id)
		if driver is None:
			continue

		events = db.scalars(
			select(DriverTrackingEventModel)
			.where(
				DriverTrackingEventModel.driver_id == driver.id,
				DriverTrackingEventModel.shipment_id == shipment.id,
			)
			.order_by(DriverTrackingEventModel.created_at.desc())
		).all()

		latest_with_coordinates = next(
			(
				event
				for event in events
				if event.latitude is not None and event.longitude is not None
			),
			None,
		)
		latest_event = events[0] if events else None

		distance_remaining_km: float | None = None
		eta_minutes_remaining: int | None = None
		eta_source: Literal["google_maps", "heuristic", "unavailable"] = "unavailable"
		eta_arrival_at: datetime | None = None
		current_latitude: float | None = None
		current_longitude: float | None = None
		current_location_label: str | None = None
		maps_directions_url: str | None = None

		if latest_with_coordinates is not None:
			current_latitude = latest_with_coordinates.latitude
			current_longitude = latest_with_coordinates.longitude
			current_location_label = resolve_tracking_location_label(
				latest_with_coordinates.latitude,
				latest_with_coordinates.longitude,
			)
			distance_remaining_km, eta_minutes_remaining, eta_source = compute_live_eta_from_coordinates(
				shipment,
				latest_with_coordinates.latitude,
				latest_with_coordinates.longitude,
			)
			if eta_minutes_remaining is not None:
				eta_arrival_at = utc_now() + timedelta(minutes=eta_minutes_remaining)
			maps_directions_url = build_maps_directions_url(
				f"{latest_with_coordinates.latitude:.6f},{latest_with_coordinates.longitude:.6f}",
				shipment.destination,
			)

		if eta_arrival_at is None and shipment.estimated_arrival is not None:
			eta_arrival_at = shipment.estimated_arrival

		history_points = [
			CarrierTrackingHistoryPointResponse(
				latitude=event.latitude,
				longitude=event.longitude,
				tracked_at=event.created_at,
				note=event.note,
			)
			for event in events
			if event.latitude is not None and event.longitude is not None
		][:history_limit]

		results.append(
			CarrierShipmentLiveTrackingResponse(
				shipment_id=shipment.id,
				shipment_origin=shipment.origin,
				shipment_destination=shipment.destination,
				shipment_status=ShipmentStatus(shipment.status),
				driver_id=driver.id,
				driver_name=driver.driver_name,
				current_latitude=current_latitude,
				current_longitude=current_longitude,
				current_location_label=current_location_label,
				last_update_at=latest_event.created_at if latest_event is not None else driver.last_tracking_at,
				distance_remaining_km=distance_remaining_km,
				eta_minutes_remaining=eta_minutes_remaining,
				eta_arrival_at=eta_arrival_at,
				tracking_status=compute_tracking_status(latest_event.created_at if latest_event is not None else driver.last_tracking_at),
				eta_source=eta_source,
				maps_directions_url=maps_directions_url,
				history=history_points,
			)
		)

	return results


@app.get("/carrier/live-tracking", response_model=list[CarrierShipmentLiveTrackingResponse])
def list_carrier_live_tracking(
	email: str = Query(min_length=4, max_length=320),
	role: Literal["carrier"] = Query(),
	history_limit: int = Query(default=20, ge=1, le=200),
) -> list[CarrierShipmentLiveTrackingResponse]:
	with get_session() as db:
		user = get_user_by_identity(db, email, role)
		carrier_name = user.company_name.strip() or user.full_name.strip()

		shipments = db.scalars(
			select(ShipmentModel)
			.where(
				ShipmentModel.carrier_name == carrier_name,
				ShipmentModel.assigned_driver_id.is_not(None),
				ShipmentModel.status.in_(
					[
						ShipmentStatus.awaiting_payment.value,
						ShipmentStatus.active.value,
						ShipmentStatus.in_transit.value,
						ShipmentStatus.accepted.value,
					]
				),
			)
			.order_by(ShipmentModel.updated_at.desc())
		).all()
		return build_live_tracking_rows(db, shipments, history_limit)


@app.get("/client/live-tracking", response_model=list[CarrierShipmentLiveTrackingResponse])
def list_client_live_tracking(
	actor_role: ActorRole | None = Query(default=None, alias="as"),
	actor_name: str | None = Query(default=None, alias="name"),
	history_limit: int = Query(default=20, ge=1, le=200),
) -> list[CarrierShipmentLiveTrackingResponse]:
	role, name = require_actor_context(actor_role, actor_name)
	if role != ActorRole.client:
		raise HTTPException(status_code=403, detail="Only clients can view client live tracking.")

	with get_session() as db:
		require_subscription_for_actor(db, role, name)
		shipments = db.scalars(
			select(ShipmentModel)
			.where(
				ShipmentModel.client_name == name,
				ShipmentModel.assigned_driver_id.is_not(None),
				ShipmentModel.status.in_(
					[
						ShipmentStatus.awaiting_payment.value,
						ShipmentStatus.active.value,
						ShipmentStatus.in_transit.value,
						ShipmentStatus.accepted.value,
					]
				),
			)
			.order_by(ShipmentModel.updated_at.desc())
		).all()

		return build_live_tracking_rows(db, shipments, history_limit)


@app.post("/carriers/recommend", response_model=list[DispatchMatch])
def recommend_carriers(payload: CarrierRecommendationRequest) -> list[DispatchMatch]:
	return recommend_carriers_for_shipment(payload)


@app.get("/maps/address-autocomplete", response_model=list[AddressSuggestion])
def maps_address_autocomplete(
	input: str = Query(min_length=3, max_length=180),
	limit: int = Query(default=5, ge=1, le=10),
	kind: Literal["address", "city"] = Query(default="address"),
) -> list[AddressSuggestion]:
	if not GOOGLE_MAPS_API_KEY:
		raise HTTPException(status_code=503, detail="Google Maps API key is not configured.")

	place_types = "(cities)" if kind == "city" else "address"
	payload = google_places_autocomplete_call(input.strip(), place_types)
	if payload is None:
		raise HTTPException(status_code=502, detail="Google Maps autocomplete request failed.")

	return extract_autocomplete_suggestions(payload, limit)


@app.get("/maps/address-resolve", response_model=ResolvedAddress)
def maps_address_resolve(place_id: str = Query(min_length=5, max_length=200)) -> ResolvedAddress:
	if not GOOGLE_MAPS_API_KEY:
		raise HTTPException(status_code=503, detail="Google Maps API key is not configured.")

	formatted = resolve_google_place_id_to_address(place_id)
	breakdown = resolve_google_place_id_breakdown(place_id)
	if not formatted or not breakdown:
		raise HTTPException(status_code=400, detail="Invalid or unknown Google place ID.")
	physical_address, city, state, postal_code = breakdown

	return ResolvedAddress(
		place_id=place_id.strip(),
		formatted_address=formatted,
		physical_address=physical_address,
		city=city,
		state=state,
		postal_code=postal_code,
	)


@app.get("/carriers/available", response_model=list[DispatchMatch])
def list_available_carriers(location: str = Query(min_length=2, max_length=140)) -> list[DispatchMatch]:
	return recommend_carriers_for_shipment(
		CarrierRecommendationRequest(
			origin=location,
			destination=location,
			weight_kg=10000,
			urgency="normal",
			vehicle_needs=None,
		)
	)


@app.get("/carriers/{carrier_id}", response_model=CarrierDetailResponse)
def get_carrier_detail(carrier_id: str) -> CarrierDetailResponse:
	return get_carrier_detail_by_id(carrier_id)


@app.on_event("startup")
def startup_event() -> None:
	Base.metadata.create_all(bind=engine)
	TemporaryUploadBase.metadata.create_all(bind=temporary_upload_engine)
	ensure_compatible_schema()
	migrate_legacy_uploads_to_temporary_storage()


@app.get("/shipments", response_model=list[ShipmentRecord])
def list_shipments(
	actor_role: ActorRole | None = Query(default=None, alias="as"),
	actor_name: str | None = Query(default=None, alias="name"),
) -> list[ShipmentRecord]:
	role, name = require_actor_context(actor_role, actor_name)
	with get_session() as db:
		require_subscription_for_actor(db, role, name)
		if role == ActorRole.client:
			query = select(ShipmentModel).where(ShipmentModel.client_name == name)
			rows = db.scalars(query.order_by(ShipmentModel.created_at.desc())).all()
			for item in rows:
				advance_payout_lifecycle_if_ready(db, item)
			db.commit()
			for item in rows:
				db.refresh(item)
			return [serialize_shipment(item) for item in rows]

		rows = db.scalars(select(ShipmentModel).order_by(ShipmentModel.created_at.desc())).all()
		visible = [item for item in rows if carrier_can_view_offer(item, name)]
		for item in visible:
			advance_payout_lifecycle_if_ready(db, item)
		db.commit()
		for item in visible:
			db.refresh(item)
		return [serialize_shipment(item) for item in visible]


@app.post("/clients/carrier-ratings", response_model=CarrierRatingResponse)
def submit_carrier_rating(
	payload: CarrierRatingSubmitRequest,
	actor_role: ActorRole | None = Query(default=None, alias="as"),
	actor_name: str | None = Query(default=None, alias="name"),
) -> CarrierRatingResponse:
	role, name = require_actor_context(actor_role, actor_name)
	if role != ActorRole.client:
		raise HTTPException(status_code=403, detail="Only clients can submit carrier ratings.")

	with get_session() as db:
		require_subscription_for_actor(db, role, name)
		shipment = get_shipment_model(db, payload.shipment_id)
		ensure_client_access(shipment, name)
		if shipment.status != ShipmentStatus.delivered.value:
			raise HTTPException(status_code=409, detail="Carrier can be rated only after shipment is delivered.")
		if not shipment.carrier_name:
			raise HTTPException(status_code=409, detail="No carrier was assigned to this shipment.")

		now = utc_now()
		normalized_review = payload.review.strip() if payload.review and payload.review.strip() else None
		carrier_id = get_shipment_carrier_id(shipment)

		record = db.scalar(
			select(CarrierRatingModel).where(
				CarrierRatingModel.shipment_id == shipment.id,
				CarrierRatingModel.client_name == name,
			)
		)
		if record is None:
			record = CarrierRatingModel(
				id=str(uuid4()),
				shipment_id=shipment.id,
				client_name=name,
				carrier_name=shipment.carrier_name,
				carrier_id=carrier_id,
				rating=payload.rating,
				use_again=payload.use_again,
				review=normalized_review,
				created_at=now,
				updated_at=now,
			)
		else:
			record.carrier_name = shipment.carrier_name
			record.carrier_id = carrier_id
			record.rating = payload.rating
			record.use_again = payload.use_again
			record.review = normalized_review
			record.updated_at = now

		db.add(record)
		db.commit()
		db.refresh(record)
		return serialize_carrier_rating(record)


@app.get("/clients/carrier-history", response_model=list[ClientCarrierHistoryResponse])
def list_client_carrier_history(
	actor_role: ActorRole | None = Query(default=None, alias="as"),
	actor_name: str | None = Query(default=None, alias="name"),
) -> list[ClientCarrierHistoryResponse]:
	role, name = require_actor_context(actor_role, actor_name)
	if role != ActorRole.client:
		raise HTTPException(status_code=403, detail="Only clients can view carrier history.")

	with get_session() as db:
		require_subscription_for_actor(db, role, name)
		shipments = db.scalars(
			select(ShipmentModel)
			.where(ShipmentModel.client_name == name, ShipmentModel.carrier_name.is_not(None))
			.order_by(ShipmentModel.updated_at.desc())
		).all()

		rating_rows = db.scalars(
			select(CarrierRatingModel)
			.where(CarrierRatingModel.client_name == name)
			.order_by(CarrierRatingModel.updated_at.desc())
		).all()

		by_carrier: dict[str, dict[str, object]] = {}
		for shipment in shipments:
			carrier_name = (shipment.carrier_name or "").strip()
			if not carrier_name:
				continue
			key = carrier_name.lower()
			group = by_carrier.get(key)
			if group is None:
				group = {
					"carrier_name": carrier_name,
					"total_shipments": 0,
					"delivered_shipments": 0,
					"last_shipment": shipment,
					"last_delivered_shipment": None,
				}
				by_carrier[key] = group

			group["total_shipments"] = int(group["total_shipments"]) + 1
			if shipment.status == ShipmentStatus.delivered.value:
				group["delivered_shipments"] = int(group["delivered_shipments"]) + 1
				if group["last_delivered_shipment"] is None:
					group["last_delivered_shipment"] = shipment

		ratings_by_carrier: dict[str, list[CarrierRatingModel]] = {}
		for row in rating_rows:
			key = row.carrier_name.strip().lower()
			ratings_by_carrier.setdefault(key, []).append(row)

		results: list[ClientCarrierHistoryResponse] = []
		for key, group in by_carrier.items():
			last_shipment = cast(ShipmentModel, group["last_shipment"])
			last_delivered_shipment = cast(ShipmentModel | None, group["last_delivered_shipment"])
			carrier_ratings = ratings_by_carrier.get(key, [])
			average_rating: float | None = None
			latest_rating: int | None = None
			latest_review: str | None = None
			would_use_again: bool | None = None
			carrier_id = get_shipment_carrier_id(last_shipment)

			if carrier_ratings:
				total = sum(item.rating for item in carrier_ratings)
				average_rating = round(total / len(carrier_ratings), 2)
				latest = carrier_ratings[0]
				latest_rating = latest.rating
				latest_review = latest.review
				would_use_again = latest.use_again
				if latest.carrier_id:
					carrier_id = latest.carrier_id

			results.append(
				ClientCarrierHistoryResponse(
					carrier_name=cast(str, group["carrier_name"]),
					carrier_id=carrier_id,
					total_shipments=int(group["total_shipments"]),
					delivered_shipments=int(group["delivered_shipments"]),
					last_shipment_id=last_shipment.id,
					last_delivered_shipment_id=last_delivered_shipment.id if last_delivered_shipment is not None else None,
					last_lane=f"{last_shipment.origin} to {last_shipment.destination}",
					last_shipment_at=last_shipment.updated_at,
					average_rating=average_rating,
					latest_rating=latest_rating,
					latest_review=latest_review,
					would_use_again=would_use_again,
				)
			)

		results.sort(key=lambda item: item.last_shipment_at, reverse=True)
		return results


@app.post("/clients/rebook-carrier", response_model=ShipmentRecord)
def rebook_carrier_from_history(
	payload: RebookCarrierShipmentRequest,
	actor_role: ActorRole | None = Query(default=None, alias="as"),
	actor_name: str | None = Query(default=None, alias="name"),
) -> ShipmentRecord:
	role, name = require_actor_context(actor_role, actor_name)
	if role != ActorRole.client:
		raise HTTPException(status_code=403, detail="Only clients can submit rebook requests.")

	with get_session() as db:
		require_subscription_for_actor(db, role, name)
		template_shipment = get_shipment_model(db, payload.template_shipment_id)
		ensure_client_access(template_shipment, name)

		preferred_carrier = next(
			(item for item in get_runtime_carrier_directory() if item.id == payload.carrier_id),
			None,
		)
		if preferred_carrier is None:
			raise HTTPException(status_code=404, detail="Preferred carrier not found.")

		matches = recommend_carriers_for_shipment(
			CarrierRecommendationRequest(
				origin=template_shipment.origin,
				destination=template_shipment.destination,
				weight_kg=template_shipment.weight_kg,
				urgency=cast(Literal["low", "normal", "high"], template_shipment.urgency),
				vehicle_needs=template_shipment.vehicle_needs,
			)
		)
		preferred_match = next((item for item in matches if item.carrier_id == payload.carrier_id), None)
		if preferred_match is None:
			raise HTTPException(
				status_code=409,
				detail="Preferred carrier is currently unavailable for this lane. Try again later or choose another carrier.",
			)

		now = utc_now()
		status_history = [
			{"status": ShipmentStatus.offered.value, "timestamp": now.isoformat(), "note": "Shipment created from carrier history"},
			{
				"status": ShipmentStatus.offered.value,
				"timestamp": now.isoformat(),
				"note": payload.note or f"Direct rebook request sent to preferred carrier: {preferred_match.carrier_name}.",
			},
		]

		shipment = ShipmentModel(
			id=str(uuid4()),
			client_name=name,
			carrier_name=None,
			cargo_type=template_shipment.cargo_type,
			origin=template_shipment.origin,
			destination=template_shipment.destination,
			weight_kg=template_shipment.weight_kg,
			time_window=template_shipment.time_window,
			vehicle_needs=template_shipment.vehicle_needs,
			urgency=template_shipment.urgency,
			status=ShipmentStatus.offered.value,
			quote_status=QUOTE_STATUS_PENDING,
			carrier_offer_amount=None,
			shipper_approved_amount=None,
			payment_status="unpaid",
			dispatch_matches=[preferred_match.model_dump()],
			quote_breakdown=None,
			created_at=now,
			updated_at=now,
			selected_route=None,
			status_history=status_history,
			estimated_arrival=None,
			payment_intent_id=None,
			payment_completed_at=None,
			invoice_number=None,
			invoice_generated_at=None,
			payout_status=PAYOUT_STATUS_PENDING,
			payout_transfer_id=None,
			pod_status=POD_STATUS_PENDING,
			pod_uploaded_at=None,
			pod_confirmed_at=None,
			payout_release_eligible_at=None,
		)

		db.add(shipment)
		db.commit()
		db.refresh(shipment)
		return serialize_shipment(shipment)


@app.post("/shipments", response_model=ShipmentRecord)
def create_shipment(
	payload: ShipmentCreateRequest,
	actor_role: ActorRole | None = Query(default=None, alias="as"),
	actor_name: str | None = Query(default=None, alias="name"),
) -> ShipmentRecord:
	role, name = require_actor_context(actor_role, actor_name)
	if role != ActorRole.client:
		raise HTTPException(status_code=403, detail="Only clients can create shipments.")
	if payload.client_name != name:
		raise HTTPException(status_code=403, detail="Client identity mismatch for shipment creation.")
	with get_session() as db:
		require_subscription_for_actor(db, role, name)

	origin = validate_and_normalize_google_address(
		payload.origin,
		"origin address",
		payload.origin_place_id,
		require_place_id=True,
	)
	destination = validate_and_normalize_google_address(
		payload.destination,
		"destination address",
		payload.destination_place_id,
		require_place_id=True,
	)

	matches = recommend_carriers_for_shipment(
		CarrierRecommendationRequest(
			origin=origin,
			destination=destination,
			weight_kg=payload.weight_kg,
			urgency=payload.urgency,
			vehicle_needs=payload.vehicle_needs,
		)
	)
	if not matches:
		raise HTTPException(status_code=409, detail="No carriers currently match this shipment.")

	now = utc_now()
	status_history = [
		{"status": ShipmentStatus.offered.value, "timestamp": now.isoformat(), "note": "Shipment created"},
		{
			"status": ShipmentStatus.offered.value,
			"timestamp": now.isoformat(),
			"note": f"Dispatch sent to {len(matches)} matching carriers",
		},
	]

	shipment = ShipmentModel(
		id=str(uuid4()),
		client_name=payload.client_name,
		carrier_name=None,
		cargo_type=payload.cargo_type,
		origin=origin,
		destination=destination,
		weight_kg=payload.weight_kg,
		time_window=payload.time_window,
		vehicle_needs=payload.vehicle_needs,
		urgency=payload.urgency,
		status=ShipmentStatus.offered.value,
		quote_status=QUOTE_STATUS_PENDING,
		carrier_offer_amount=None,
		shipper_approved_amount=None,
		payment_status="unpaid",
		dispatch_matches=[item.model_dump() for item in matches],
		quote_breakdown=None,
		created_at=now,
		updated_at=now,
		selected_route=None,
		status_history=status_history,
		estimated_arrival=None,
		payment_intent_id=None,
		payment_completed_at=None,
		invoice_number=None,
		invoice_generated_at=None,
		payout_status=PAYOUT_STATUS_PENDING,
		payout_transfer_id=None,
		pod_status=POD_STATUS_PENDING,
		pod_uploaded_at=None,
		pod_confirmed_at=None,
		payout_release_eligible_at=None,
	)
	with get_session() as db:
		db.add(shipment)
		db.commit()
		db.refresh(shipment)
		return serialize_shipment(shipment)


@app.post("/shipments/{shipment_id}/carrier-confirm-pod", response_model=ShipmentRecord)
def carrier_confirm_pod(
	shipment_id: str,
	actor_role: ActorRole | None = Query(default=None, alias="as"),
	actor_name: str | None = Query(default=None, alias="name"),
) -> ShipmentRecord:
	role, name = require_actor_context(actor_role, actor_name)
	if role != ActorRole.carrier:
		raise HTTPException(status_code=403, detail="Only carriers can confirm POD.")

	with get_session() as db:
		require_subscription_for_actor(db, role, name)
		shipment = get_shipment_model(db, shipment_id)
		if shipment.carrier_name != name:
			raise HTTPException(status_code=403, detail="Carrier does not have access to confirm POD for this shipment.")
		if shipment.status != ShipmentStatus.delivered.value:
			raise HTTPException(status_code=409, detail="Shipment must be delivered before confirming POD.")
		if shipment.payment_status != "paid":
			raise HTTPException(status_code=409, detail="Shipment payment must be completed before confirming POD.")
		if (shipment.pod_status or POD_STATUS_PENDING) != POD_STATUS_UPLOADED:
			raise HTTPException(status_code=409, detail="Driver must upload POD before carrier confirmation.")

		now = utc_now()
		shipment.pod_status = POD_STATUS_CARRIER_CONFIRMED
		shipment.pod_confirmed_at = now
		shipment.payout_release_eligible_at = review_release_eligible_at(now)
		shipment.updated_at = now
		set_shipment_status_note(
			shipment,
			shipment.status,
			"Carrier confirmed POD. Shipper review window started.",
		)
		advance_payout_lifecycle_if_ready(db, shipment)

		db.add(shipment)
		db.commit()
		db.refresh(shipment)
		return serialize_shipment(shipment)


@app.post("/shipments/{shipment_id}/release-payment", response_model=ShipmentRecord)
def release_payment(
	shipment_id: str,
	payload: ReleasePaymentRequest,
	actor_role: ActorRole | None = Query(default=None, alias="as"),
	actor_name: str | None = Query(default=None, alias="name"),
) -> ShipmentRecord:
	role, name = require_actor_context(actor_role, actor_name)
	if role != ActorRole.client:
		raise HTTPException(status_code=403, detail="Only clients can release carrier payments.")

	with get_session() as db:
		require_subscription_for_actor(db, role, name)
		shipment = get_shipment_model(db, shipment_id)
		ensure_client_access(shipment, name)
		if shipment.status != ShipmentStatus.delivered.value:
			raise HTTPException(status_code=409, detail="Shipment must be marked delivered before releasing payment.")
		if shipment.payment_status != "paid":
			raise HTTPException(status_code=409, detail="Shipment payment must be completed before releasing payout.")
		pod_status = shipment.pod_status or POD_STATUS_PENDING
		if pod_status not in {POD_STATUS_CARRIER_CONFIRMED, POD_STATUS_REVIEWED}:
			raise HTTPException(status_code=409, detail="Carrier must confirm POD before shipper review completion.")
		if shipment.payout_status == PAYOUT_STATUS_RELEASED:
			raise HTTPException(status_code=409, detail="Carrier payout has already been released.")

		shipment.pod_status = POD_STATUS_REVIEWED
		shipment.payout_release_eligible_at = utc_now()
		shipment.updated_at = utc_now()
		release_carrier_payout_if_ready(db, shipment)
		set_shipment_status_note(
			shipment,
			shipment.status,
			payload.note or "Shipper completed POD review early and released carrier payout.",
		)

		db.add(shipment)
		db.commit()
		db.refresh(shipment)
		return serialize_shipment(shipment)


@app.get("/shipments/{shipment_id}", response_model=ShipmentRecord)
def get_shipment(
	shipment_id: str,
	actor_role: ActorRole | None = Query(default=None, alias="as"),
	actor_name: str | None = Query(default=None, alias="name"),
) -> ShipmentRecord:
	role, name = require_actor_context(actor_role, actor_name)
	with get_session() as db:
		require_subscription_for_actor(db, role, name)
		shipment = db.get(ShipmentModel, shipment_id)
		if shipment is None:
			raise HTTPException(status_code=404, detail="Shipment not found")

		if role == ActorRole.client:
			ensure_client_access(shipment, name)
		elif not carrier_can_view_offer(shipment, name):
			raise HTTPException(status_code=403, detail="Carrier does not have access to this job offer.")

		advance_payout_lifecycle_if_ready(db, shipment)
		db.commit()
		db.refresh(shipment)

		return serialize_shipment(shipment)


def get_shipment_model(db: Session, shipment_id: str) -> ShipmentModel:
	shipment = db.get(ShipmentModel, shipment_id)
	if shipment is None:
		raise HTTPException(status_code=404, detail="Shipment not found")
	return shipment


@app.post("/shipments/{shipment_id}/accept", response_model=ShipmentRecord)
def accept_shipment(
	shipment_id: str,
	payload: AcceptShipmentRequest,
	actor_role: ActorRole | None = Query(default=None, alias="as"),
	actor_name: str | None = Query(default=None, alias="name"),
) -> ShipmentRecord:
	role, name = require_actor_context(actor_role, actor_name)
	if role != ActorRole.carrier:
		raise HTTPException(status_code=403, detail="Only carriers can accept shipments.")
	if payload.carrier_name != name:
		raise HTTPException(status_code=403, detail="Carrier identity mismatch for shipment acceptance.")

	with get_session() as db:
		require_subscription_for_actor(db, role, name)
		shipment = get_shipment_model(db, shipment_id)
		if shipment.status != ShipmentStatus.offered.value:
			raise HTTPException(status_code=409, detail="Shipment is no longer accepting offers.")
		if shipment.carrier_name and shipment.carrier_name != name:
			raise HTTPException(status_code=409, detail="Shipment already assigned to a different carrier.")
		if not carrier_can_view_offer(shipment, name):
			raise HTTPException(status_code=403, detail="This carrier was not invited for the shipment offer.")

		shipment.carrier_name = payload.carrier_name
		shipment.assigned_driver_id = None
		shipment.status = ShipmentStatus.offered.value
		shipment.quote_status = QUOTE_STATUS_PENDING
		shipment.carrier_offer_amount = round(payload.offer_amount, 2)
		shipment.shipper_approved_amount = None
		shipment.payment_status = "unpaid"
		shipment.payment_intent_id = None
		shipment.payment_completed_at = None
		shipment.invoice_number = None
		shipment.invoice_generated_at = None
		shipment.payout_status = PAYOUT_STATUS_PENDING
		shipment.payout_transfer_id = None
		shipment.pod_status = POD_STATUS_PENDING
		shipment.pod_uploaded_at = None
		shipment.pod_confirmed_at = None
		shipment.payout_release_eligible_at = None
		benchmark_quote = quote_for_shipment(shipment, payload.carrier_name)
		offer_total = round(payload.offer_amount, 2)
		if payload.quote_details is None:
			shipment.quote_breakdown = QuoteBreakdown(
				total_usd=offer_total,
				base_freight_usd=offer_total,
				urgency_surcharge_usd=0.0,
				distance_surcharge_usd=0.0,
				service_fee_usd=0.0,
				estimated_delivery_time=benchmark_quote.estimated_delivery_time,
				notes=f"Official carrier quote submitted at ${offer_total:.2f}.",
			).model_dump()
		else:
			details = payload.quote_details
			urgency_surcharge = round(float(details.urgency_surcharge_usd or 0.0), 2)
			distance_surcharge = round(float(details.distance_surcharge_usd or 0.0), 2)
			service_fee = round(float(details.service_fee_usd or 0.0), 2)
			base_freight = round(offer_total - urgency_surcharge - distance_surcharge - service_fee, 2)
			if base_freight < 0:
				raise HTTPException(
					status_code=422,
					detail="Offer amount must be greater than or equal to urgency, distance, and service surcharges.",
				)

			estimated_delivery_time = benchmark_quote.estimated_delivery_time
			if details.estimated_delivery_time and details.estimated_delivery_time.strip():
				estimated_delivery_time = details.estimated_delivery_time.strip()

			notes_parts = [f"Official carrier quote submitted at ${offer_total:.2f}."]
			if details.mileage is not None:
				notes_parts.append(f"Mileage: {details.mileage:.1f} mi.")
			notes_parts.append(f"Urgency: {(details.urgency or shipment.urgency).title()}.")
			if details.notes and details.notes.strip():
				notes_parts.append(details.notes.strip())

			shipment.quote_breakdown = QuoteBreakdown(
				total_usd=offer_total,
				base_freight_usd=base_freight,
				urgency_surcharge_usd=urgency_surcharge,
				distance_surcharge_usd=distance_surcharge,
				service_fee_usd=service_fee,
				estimated_delivery_time=estimated_delivery_time,
				notes=" ".join(notes_parts),
			).model_dump()
		shipment.updated_at = utc_now()

		set_shipment_status_note(
			shipment,
			ShipmentStatus.offered.value,
			f"Carrier submitted offer of ${payload.offer_amount:.2f}.",
		)
		if payload.note:
			set_shipment_status_note(shipment, ShipmentStatus.offered.value, payload.note)

		db.add(shipment)
		db.commit()
		db.refresh(shipment)
		return serialize_shipment(shipment)


@app.post("/shipments/{shipment_id}/accept-quote", response_model=ShipmentRecord)
def accept_quote(
	shipment_id: str,
	payload: AcceptQuoteRequest,
	actor_role: ActorRole | None = Query(default=None, alias="as"),
	actor_name: str | None = Query(default=None, alias="name"),
) -> ShipmentRecord:
	role, name = require_actor_context(actor_role, actor_name)
	if role != ActorRole.client:
		raise HTTPException(status_code=403, detail="Only clients can accept quotes.")

	with get_session() as db:
		require_subscription_for_actor(db, role, name)
		shipment = get_shipment_model(db, shipment_id)
		ensure_client_access(shipment, name)
		if shipment.quote_status != QUOTE_STATUS_PENDING:
			raise HTTPException(status_code=409, detail="Quote is not in pending state.")
		if shipment.carrier_offer_amount is None:
			raise HTTPException(status_code=409, detail="No carrier offer has been submitted yet.")

		shipment.quote_status = QUOTE_STATUS_ACCEPTED
		shipment.shipper_approved_amount = shipment.carrier_offer_amount
		shipment.payment_status = "pending_payment"
		shipment.status = ShipmentStatus.awaiting_payment.value
		shipment.updated_at = utc_now()
		create_or_update_payment_intent_for_shipment(db, shipment)
		set_shipment_status_note(
			shipment,
			ShipmentStatus.awaiting_payment.value,
			payload.note or f"Shipper accepted offer of ${shipment.carrier_offer_amount:.2f}. Payment is now pending.",
		)
		db.add(shipment)
		db.commit()
		db.refresh(shipment)
		return serialize_shipment(shipment)


@app.post("/shipments/{shipment_id}/assign-driver", response_model=ShipmentRecord)
def assign_shipment_driver(
	shipment_id: str,
	payload: AssignShipmentDriverRequest,
	actor_role: ActorRole | None = Query(default=None, alias="as"),
	actor_name: str | None = Query(default=None, alias="name"),
) -> ShipmentRecord:
	role, name = require_actor_context(actor_role, actor_name)
	if role != ActorRole.carrier:
		raise HTTPException(status_code=403, detail="Only carriers can assign shipment drivers.")

	with get_session() as db:
		require_subscription_for_actor(db, role, name)
		shipment = get_shipment_model(db, shipment_id)
		ensure_carrier_assigned(shipment, name)
		if shipment.status not in {
			ShipmentStatus.awaiting_payment.value,
			ShipmentStatus.accepted.value,
			ShipmentStatus.active.value,
			ShipmentStatus.in_transit.value,
		}:
			raise HTTPException(status_code=409, detail="Driver assignment is not available for this shipment status.")

		driver = db.scalar(
			select(CarrierDriverModel).where(
				CarrierDriverModel.id == payload.driver_id,
				CarrierDriverModel.carrier_name == name,
			)
		)
		if driver is None:
			raise HTTPException(status_code=404, detail="Driver not found for this carrier.")

		shipment.assigned_driver_id = driver.id
		shipment.updated_at = utc_now()

		history = list(shipment.status_history or [])
		history.append(
			{
				"status": shipment.status,
				"timestamp": shipment.updated_at.isoformat(),
				"note": f"Driver assigned: {driver.driver_name} ({driver.driver_mobile}).",
			}
		)
		shipment.status_history = history

		db.add(shipment)
		db.commit()
		db.refresh(shipment)
		return serialize_shipment(shipment)


@app.post("/shipments/{shipment_id}/reject", response_model=ShipmentRecord)
def reject_shipment(
	shipment_id: str,
	payload: RejectShipmentRequest,
	actor_role: ActorRole | None = Query(default=None, alias="as"),
	actor_name: str | None = Query(default=None, alias="name"),
) -> ShipmentRecord:
	role, name = require_actor_context(actor_role, actor_name)
	if role != ActorRole.carrier:
		raise HTTPException(status_code=403, detail="Only carriers can reject shipment offers.")

	with get_session() as db:
		require_subscription_for_actor(db, role, name)
		shipment = get_shipment_model(db, shipment_id)
		if shipment.status != ShipmentStatus.offered.value:
			raise HTTPException(status_code=409, detail="Shipment is no longer in offer stage.")

		matches = [item for item in (shipment.dispatch_matches or []) if item.get("carrier_name") != name]
		if len(matches) == len(shipment.dispatch_matches or []):
			raise HTTPException(status_code=403, detail="Carrier is not part of this offer pool.")

		shipment.dispatch_matches = matches
		shipment.updated_at = utc_now()
		if not matches:
			shipment.status = ShipmentStatus.rejected.value

		history = list(shipment.status_history or [])
		history.append(
			{
				"status": shipment.status,
				"timestamp": shipment.updated_at.isoformat(),
				"note": payload.reason or f"Offer rejected by {name}",
			}
		)
		shipment.status_history = history

		db.add(shipment)
		db.commit()
		db.refresh(shipment)
		return serialize_shipment(shipment)


@app.post("/shipments/{shipment_id}/confirm-payment", response_model=ShipmentRecord)
def confirm_payment(
	shipment_id: str,
	actor_role: ActorRole | None = Query(default=None, alias="as"),
	actor_name: str | None = Query(default=None, alias="name"),
	checkout_session_id: str | None = Query(default=None, min_length=10, max_length=255),
) -> ShipmentRecord:
	role, name = require_actor_context(actor_role, actor_name)
	if role != ActorRole.client:
		raise HTTPException(status_code=403, detail="Only clients can confirm payment.")

	with get_session() as db:
		require_subscription_for_actor(db, role, name)
		shipment = get_shipment_model(db, shipment_id)
		ensure_client_access(shipment, name)
		if shipment.quote_status != QUOTE_STATUS_ACCEPTED:
			raise HTTPException(status_code=409, detail="Quote must be accepted before payment can be captured.")
		if not shipment.carrier_name:
			raise HTTPException(status_code=409, detail="No carrier accepted this shipment yet.")
		if not checkout_session_id:
			raise HTTPException(status_code=400, detail="checkout_session_id is required to confirm shipment payment.")

		paid_at = utc_now()

		require_stripe_ready()
		session = stripe.checkout.Session.retrieve(  # type: ignore[union-attr]
			checkout_session_id,
			expand=["payment_intent"],
		)
		session_metadata = dict(getattr(session, "metadata", {}) or {})
		if session_metadata.get("shipment_id") != shipment.id:
			raise HTTPException(status_code=403, detail="Checkout session does not belong to this shipment.")
		if getattr(session, "payment_status", "") != "paid":
			raise HTTPException(status_code=409, detail="Checkout payment is not completed yet.")
		payment_intent = getattr(session, "payment_intent", None)
		if isinstance(payment_intent, str) and payment_intent:
			shipment.payment_intent_id = payment_intent
		elif payment_intent is not None and getattr(payment_intent, "id", None):
			shipment.payment_intent_id = str(payment_intent.id)
			created_epoch = getattr(payment_intent, "created", None)
			if isinstance(created_epoch, int):
				paid_at = datetime.fromtimestamp(created_epoch, tz=timezone.utc)

		shipment.payment_status = "paid"
		shipment.status = ShipmentStatus.active.value
		shipment.quote_status = QUOTE_STATUS_PAID
		shipment.payment_completed_at = paid_at
		if shipment.shipper_approved_amount is None:
			shipment.shipper_approved_amount = shipment_offer_amount(shipment)
		ensure_paid_invoice(db, shipment, paid_at)
		shipment.updated_at = utc_now()

		set_shipment_status_note(shipment, ShipmentStatus.active.value, "Client accepted the quote and payment was captured.")

		db.add(shipment)
		db.commit()
		db.refresh(shipment)
		return serialize_shipment(shipment)


@app.post("/shipments/{shipment_id}/invite", response_model=ShipmentRecord)
def invite_carrier_for_shipment(
	shipment_id: str,
	payload: SendCarrierInviteRequest,
	actor_role: ActorRole | None = Query(default=None, alias="as"),
	actor_name: str | None = Query(default=None, alias="name"),
) -> ShipmentRecord:
	role, name = require_actor_context(actor_role, actor_name)
	if role != ActorRole.client:
		raise HTTPException(status_code=403, detail="Only clients can send carrier invites.")

	with get_session() as db:
		require_subscription_for_actor(db, role, name)
		shipment = get_shipment_model(db, shipment_id)
		ensure_client_access(shipment, name)

		match = next(
			(item for item in (shipment.dispatch_matches or []) if item.get("carrier_id") == payload.carrier_id),
			None,
		)
		if match is None:
			raise HTTPException(status_code=400, detail="Carrier is not in this shipment match list.")

		invite_note = payload.note.strip() if payload.note else f"Invite sent to {match.get('carrier_name', payload.carrier_id)}"
		shipment.status_history = [
			*(shipment.status_history or []),
			{
				"status": shipment.status,
				"timestamp": utc_now().isoformat(),
				"note": invite_note,
			},
		]
		shipment.updated_at = utc_now()

		db.add(shipment)
		db.commit()
		db.refresh(shipment)
		return serialize_shipment(shipment)


@app.post("/shipments/{shipment_id}/optimize-route", response_model=ShipmentRecord)
def optimize_route(
	shipment_id: str,
	payload: OptimizeRouteRequest,
	actor_role: ActorRole | None = Query(default=None, alias="as"),
	actor_name: str | None = Query(default=None, alias="name"),
) -> ShipmentRecord:
	role, name = require_actor_context(actor_role, actor_name)
	if role != ActorRole.carrier:
		raise HTTPException(status_code=403, detail="Only carriers can optimize routes.")

	with get_session() as db:
		require_subscription_for_actor(db, role, name)
		shipment = get_shipment_model(db, shipment_id)
		ensure_carrier_assigned(shipment, name)
		if shipment.status not in {
			ShipmentStatus.active.value,
			ShipmentStatus.in_transit.value,
			ShipmentStatus.awaiting_payment.value,
		}:
			raise HTTPException(status_code=409, detail="Route optimization allowed only for accepted or active shipments.")

		best_route = compute_best_route(payload.mode, shipment.weight_kg, shipment.urgency, shipment.origin, shipment.destination)
		shipment.selected_route = best_route.model_dump()
		shipment.estimated_arrival = utc_now() + timedelta(hours=best_route.estimated_hours)
		shipment.updated_at = utc_now()

		history = list(shipment.status_history or [])
		history.append(
			{
				"status": shipment.status,
				"timestamp": shipment.updated_at.isoformat(),
				"note": f"Route optimized in {payload.mode.value} mode",
			}
		)
		shipment.status_history = history

		db.add(shipment)
		db.commit()
		db.refresh(shipment)
		return serialize_shipment(shipment)


@app.get("/shipments/{shipment_id}/route-analysis", response_model=RouteAnalysisResponse)
def route_analysis(
	shipment_id: str,
	mode: OptimizationMode = Query(default=OptimizationMode.lowest_cost),
	actor_role: ActorRole | None = Query(default=None, alias="as"),
	actor_name: str | None = Query(default=None, alias="name"),
) -> RouteAnalysisResponse:
	role, name = require_actor_context(actor_role, actor_name)
	if role != ActorRole.carrier:
		raise HTTPException(status_code=403, detail="Only carriers can analyze routes.")

	with get_session() as db:
		require_subscription_for_actor(db, role, name)
		shipment = get_shipment_model(db, shipment_id)
		if not carrier_can_view_offer(shipment, name):
			raise HTTPException(status_code=403, detail="Carrier not authorized to view this shipment.")

		fuel_price_per_liter, fuel_price_source = live_fuel_price_per_liter(shipment.origin)
		routes = build_route_options(mode, shipment.weight_kg, shipment.urgency, shipment.origin, shipment.destination)
		best_route = routes[0]
		selected_route_payload = shipment.selected_route
		selected_route = RouteOption(**selected_route_payload) if selected_route_payload else None
		return RouteAnalysisResponse(
			shipment_id=shipment.id,
			client_name=shipment.client_name,
			carrier_name=shipment.carrier_name,
			origin=shipment.origin,
			destination=shipment.destination,
			cargo_type=shipment.cargo_type,
			weight_kg=shipment.weight_kg,
			time_window=shipment.time_window or "ASAP",
			urgency=shipment.urgency,  # type: ignore[arg-type]
			mode=mode,
			fuel_price_usd_per_liter=fuel_price_per_liter,
			fuel_price_source=fuel_price_source,
			routes=routes,
			best_route=best_route,
			selected_route=selected_route,
		)


@app.post("/shipments/{shipment_id}/status", response_model=ShipmentRecord)
def update_status(
	shipment_id: str,
	payload: UpdateStatusRequest,
	actor_role: ActorRole | None = Query(default=None, alias="as"),
	actor_name: str | None = Query(default=None, alias="name"),
) -> ShipmentRecord:
	role, name = require_actor_context(actor_role, actor_name)
	if role != ActorRole.carrier:
		raise HTTPException(status_code=403, detail="Only carriers can update shipment status.")

	with get_session() as db:
		require_subscription_for_actor(db, role, name)
		shipment = get_shipment_model(db, shipment_id)
		ensure_carrier_assigned(shipment, name)
		if payload.status == ShipmentStatus.delivered:
			if shipment.status not in {ShipmentStatus.active.value, ShipmentStatus.in_transit.value}:
				raise HTTPException(status_code=409, detail="Shipment must be active before it can be marked delivered.")
			if shipment.payment_status != "paid" or shipment.quote_status != QUOTE_STATUS_PAID:
				raise HTTPException(status_code=409, detail="Shipment payment must be completed before marking delivered.")
		elif shipment.status not in {ShipmentStatus.active.value, ShipmentStatus.in_transit.value}:
			raise HTTPException(status_code=409, detail="Shipment must be active before carrier tracking updates.")

		next_status = payload.status.value
		if payload.status == ShipmentStatus.in_transit:
			next_status = ShipmentStatus.active.value

		shipment.status = next_status
		shipment.updated_at = utc_now()

		set_shipment_status_note(shipment, next_status, payload.note or "Status updated")

		db.add(shipment)
		db.commit()
		db.refresh(shipment)
		return serialize_shipment(shipment)
