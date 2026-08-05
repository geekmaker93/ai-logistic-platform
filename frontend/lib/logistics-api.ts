export type ShipmentStatus =
  | "offered"
  | "awaiting_payment"
  | "active"
  | "delivered"
  | "rejected"
  | "pending"
  | "accepted"
  | "in_transit";

export type OptimizationMode = "fastest" | "fuel_efficient" | "lowest_cost" | "weather_safe" | "eco";
export type ActorContext = { role: "client" | "carrier"; displayName: string };

export type AuthRole = "client" | "carrier" | "driver";

export type AuthSession = {
  role: AuthRole;
  display_name: string;
  full_name: string;
  company_name: string;
  email: string;
  created_at: string;
  subscription_active: boolean;
  subscription_status: string | null;
  subscription_plan: string | null;
  subscription_current_period_end: string | null;
};

export type SignupApplication = {
  role: AuthRole;
  full_name: string;
  company_name: string;
  email: string;
  approval_status: "pending_review" | "active" | "rejected";
  created_at: string;
};

export type CarrierSettings = {
  available_trucks: number;
  base_location: string;
  service_regions: string[];
  vehicle_types: string[];
  max_weight_kg: number;
  fuel_efficiency_kmpl: number;
  idle_fuel_lph: number;
  maintenance_cost_per_km_usd: number;
  driver_cost_per_hour_usd: number;
  toll_discount_pct: number;
  fuel_price_adjustment_pct: number;
  empty_mile_factor_pct: number;
  updated_at: string;
};

export type AuthProfile = {
  role: AuthRole;
  display_name: string;
  full_name: string;
  company_name: string;
  email: string;
  tax_id: string | null;
  dot_number: string | null;
  phone: string | null;
  address: string | null;
  bio: string | null;
  created_at: string;
  updated_at: string;
  subscription_active: boolean;
  subscription_status: string | null;
  subscription_plan: string | null;
  subscription_current_period_end: string | null;
  carrier_profile: CarrierSettings | null;
};

export type DriverApplicationProfile = {
  email: string;
  first_name: string;
  last_name: string;
  phone: string;
  address: string;
  zip_code: string;
  cdl_information: string;
  years_experience: number;
  qualifications: string;
  endorsements: string;
  availability_notes: string;
  truck_type: string;
  trailer_type: string;
  capacity: string;
  vehicle_information: string;
  availability_status: "available" | "on_load" | "unavailable";
  resume_name: string | null;
  resume_mime_type: string | null;
  resume_base64: string | null;
  updated_at: string;
};

export type BillingPlan = {
  role: AuthRole;
  name: string;
  price_usd: number;
  price_id: string | null;
};

export type BillingStatus = {
  role: AuthRole;
  subscription_active: boolean;
  subscription_status: string | null;
  subscription_plan: string | null;
  subscription_current_period_end: string | null;
  subscription_cancel_at_period_end?: boolean;
};

export type BillingCheckoutResponse = {
  client_secret: string | null;
  checkout_url: string;
};

export type PaymentInstrumentType = "card" | "bank_account";

export type BillingPaymentMethodStatus = {
  role: AuthRole;
  stripe_customer_ready: boolean;
  has_card: boolean;
  has_bank_account: boolean;
  card_last4: string | null;
};

export type BillingPayoutAccountStatus = {
  role: "carrier";
  has_connect_account: boolean;
  connect_account_id: string | null;
  payouts_enabled: boolean;
  charges_enabled: boolean;
  onboarding_complete: boolean;
};

export type DispatchMatch = {
  carrier_id: string;
  carrier_name: string;
  distance_km: number;
  score: number;
  eta_minutes: number;
  available_trucks: number;
  vehicle_fit: string;
  distance_source?: "google_maps" | "mixed" | "heuristic";
  maps_directions_url?: string | null;
};

export type CarrierDetail = {
  carrier_id: string;
  carrier_name: string;
  company_name: string;
  contact_name: string | null;
  phone: string | null;
  address: string | null;
  bio: string | null;
  base_location: string;
  service_regions: string[];
  available_trucks: number;
  vehicle_types: string[];
  max_weight_kg: number;
  rating: number;
  is_verified_profile: boolean;
};

export type CarrierRecommendationRequest = {
  origin: string;
  origin_place_id?: string | null;
  destination: string;
  destination_place_id?: string | null;
  weight_kg: number;
  urgency: "low" | "normal" | "high";
  vehicle_needs?: string | null;
};

export type AddressSuggestion = {
  place_id: string;
  description: string;
};

export type ResolvedAddress = {
  place_id: string;
  formatted_address: string;
  physical_address: string;
  city: string;
  state: string;
  postal_code: string;
};

export type StructuredAddress = {
  street_address: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
  formatted_address: string;
};

export type QuoteBreakdown = {
  total_usd: number;
  base_freight_usd: number;
  urgency_surcharge_usd: number;
  distance_surcharge_usd: number;
  service_fee_usd: number;
  estimated_delivery_time: string;
  notes: string;
};

export type CarrierQuoteDetailsPayload = {
  mileage?: number;
  urgency?: "low" | "normal" | "high";
  urgency_surcharge_usd?: number;
  distance_surcharge_usd?: number;
  service_fee_usd?: number;
  estimated_delivery_time?: string;
  notes?: string;
};

export type RouteOption = {
  name: string;
  distance_km: number;
  estimated_hours: number;
  fuel_liters: number;
  toll_usd: number;
  weather_risk: number;
  traffic_delay_minutes: number;
  score: number;
  recommendation_reason: string;
};

export type RouteAnalysis = {
  shipment_id: string;
  client_name: string;
  carrier_name: string | null;
  origin: string;
  destination: string;
  cargo_type: string;
  weight_kg: number;
  time_window: string;
  urgency: "low" | "normal" | "high";
  mode: OptimizationMode;
  fuel_price_usd_per_liter: number;
  fuel_price_source: "eia_live" | "fallback";
  routes: RouteOption[];
  best_route: RouteOption;
  selected_route: RouteOption | null;
};

export type Shipment = {
  id: string;
  load_number: string;
  client_name: string;
  carrier_name: string | null;
  assigned_driver_id: string | null;
  cargo_type: string;
  origin: string;
  destination: string;
  weight_kg: number;
  time_window: string;
  vehicle_needs: string | null;
  urgency: "low" | "normal" | "high";
  status: ShipmentStatus;
  quote_status: "pending" | "accepted" | "paid";
  carrier_offer_amount: number | null;
  shipper_approved_amount: number | null;
  payment_status: string;
  dispatch_matches: DispatchMatch[];
  quote_breakdown: QuoteBreakdown | null;
  created_at: string;
  updated_at: string;
  selected_route: RouteOption | null;
  status_history: Array<{ status: string; timestamp: string; note: string }>;
  estimated_arrival: string | null;
  payment_intent_id: string | null;
  payment_completed_at: string | null;
  invoice_number: string | null;
  invoice_generated_at: string | null;
  payout_status: string | null;
  payout_transfer_id: string | null;
  pod_status: string;
  pod_uploaded_at: string | null;
  pod_confirmed_at: string | null;
  payout_release_eligible_at: string | null;
};

export type CarrierDriverSummary = {
  id: string;
  driver_name: string;
  driver_mobile: string;
  token_expires_at: string | null;
  last_login_at: string | null;
  tracking_started_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CarrierDriverTokenResponse = {
  driver: CarrierDriverSummary;
  login_token: string;
};

export type DriverSession = {
  driver_id: string;
  driver_name: string;
  driver_mobile: string;
  carrier_name: string;
  carrier_email: string;
};

export type DriverTrackingResponse = {
  driver_id: string;
  status: "tracking_started";
  tracked_at: string;
};

export type DriverTrackingUpdateResponse = {
  driver_id: string;
  tracked_at: string;
  latitude: number | null;
  longitude: number | null;
  note: string | null;
};

export type DriverCurrentShipment = {
  driver_id: string;
  tracking_started_at: string | null;
  last_tracking_at: string | null;
  shipment: Shipment | null;
};

export type DriverDocumentRecord = {
  id: string;
  driver_id: string;
  driver_name: string;
  driver_mobile: string;
  carrier_name: string;
  document_name: string;
  document_type: string;
  notes: string | null;
  content_text: string | null;
  file_mime_type: string | null;
  file_base64: string | null;
  created_at: string;
};

export type CarrierTrackingHistoryPoint = {
  latitude: number;
  longitude: number;
  tracked_at: string;
  note: string | null;
};

export type CarrierLiveTrackingItem = {
  shipment_id: string;
  shipment_origin: string;
  shipment_destination: string;
  shipment_status: ShipmentStatus;
  driver_id: string;
  driver_name: string;
  current_latitude: number | null;
  current_longitude: number | null;
  current_location_label: string | null;
  last_update_at: string | null;
  distance_remaining_km: number | null;
  eta_minutes_remaining: number | null;
  eta_arrival_at: string | null;
  tracking_status: "Live" | "No signal";
  eta_source: "google_maps" | "heuristic" | "unavailable";
  maps_directions_url: string | null;
  history: CarrierTrackingHistoryPoint[];
};

export type CarrierRating = {
  id: string;
  shipment_id: string;
  client_name: string;
  carrier_name: string;
  carrier_id: string | null;
  rating: number;
  use_again: boolean;
  review: string | null;
  created_at: string;
  updated_at: string;
};

export type ClientCarrierHistoryItem = {
  carrier_name: string;
  carrier_id: string | null;
  total_shipments: number;
  delivered_shipments: number;
  last_shipment_id: string;
  last_delivered_shipment_id: string | null;
  last_lane: string;
  last_shipment_at: string;
  average_rating: number | null;
  latest_rating: number | null;
  latest_review: string | null;
  would_use_again: boolean | null;
};

function resolveApiBase(): string {
  const configuredBase = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
  if (configuredBase) {
    return configuredBase;
  }
  if (globalThis.window !== undefined) {
    return `http://${globalThis.window.location.hostname}:8000`;
  }
  return "http://127.0.0.1:8000";
}

const API_BASE = resolveApiBase();
const SMARTY_EMBEDDED_KEY = process.env.NEXT_PUBLIC_SMARTY_EMBEDDED_KEY || "";
const SMARTY_US_STREET_URL = "https://us-street.api.smarty.com/street-address";

export const statusLabel: Record<ShipmentStatus, string> = {
  offered: "Offer Sent",
  awaiting_payment: "Awaiting Payment",
  active: "Active",
  delivered: "Delivered",
  rejected: "No Carrier Available",
  pending: "Pending",
  accepted: "Accepted",
  in_transit: "In Transit",
};

export const modeOptions: Array<{ value: OptimizationMode; label: string }> = [
  { value: "lowest_cost", label: "Lowest Cost" },
  { value: "fastest", label: "Fastest Delivery" },
  { value: "fuel_efficient", label: "Fuel Efficient" },
  { value: "weather_safe", label: "Weather Safe" },
  { value: "eco", label: "Eco Friendly" },
];

async function request<T>(path: string, options?: RequestInit, actor?: ActorContext): Promise<T> {
  const url = new URL(`${API_BASE}${path}`);
  if (actor) {
    url.searchParams.set("as", actor.role);
    url.searchParams.set("name", actor.displayName);
  }

  const response = await fetch(url.toString(), {
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    ...options,
  });

  const responseText = await response.text();
  if (!response.ok) {
    try {
      const parsed = JSON.parse(responseText) as { detail?: string };
      if (response.status === 402) {
        throw new Error("Subscription required. Please activate your plan to continue.");
      }
      throw new Error(parsed.detail || responseText || "Request failed.");
    } catch {
      if (response.status === 402) {
        throw new Error("Subscription required. Please activate your plan to continue.");
      }
      throw new Error(responseText || "Request failed.");
    }
  }

  return JSON.parse(responseText) as T;
}

export function signupAccount(payload: {
  full_name: string;
  company_name: string;
  phone?: string | null;
  bio?: string | null;
  tax_id?: string | null;
  dot_number?: string | null;
  didit_session_id?: string | null;
  id_document_name: string;
  id_document_mime_type: string;
  id_document_base64: string;
  vehicle_types?: string[] | null;
  email: string;
  password: string;
  email_verification_code: string;
  role: AuthRole;
}) {
  return request<SignupApplication>("/auth/signup", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function createDiditSession(payload: { full_name: string; email: string; role: AuthRole }) {
  return request<{ session_id: string; url: string }>("/auth/identity-verification/didit-session", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function requestSignupVerificationCode(payload: { email: string; role: AuthRole }) {
  return request<{ detail: string }> ("/auth/signup/request-verification-code", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function verifySignupEmailCode(payload: { email: string; role: AuthRole; verification_code: string }) {
  return request<{ detail: string }>("/auth/signup/verify-email-code", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function requestPasswordReset(payload: { email: string; role: AuthRole }) {
  return request<{ detail: string }>("/auth/password-reset/request", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function confirmPasswordReset(payload: { email: string; role: AuthRole; token: string; new_password: string }) {
  return request<{ detail: string }>("/auth/password-reset/confirm", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function loginAccount(payload: { email: string; password: string; role: AuthRole }) {
  return request<AuthSession>("/auth/login", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getUserProfile(email: string, role: AuthRole) {
  const query = new URLSearchParams({ email, role }).toString();
  return request<AuthProfile>(`/auth/profile?${query}`);
}

export function getDriverApplicationProfile(email: string) {
  const query = new URLSearchParams({ email }).toString();
  return request<DriverApplicationProfile>(`/driver-application/profile?${query}`);
}

export function updateDriverApplicationProfile(
  email: string,
  profile: Omit<DriverApplicationProfile, "email" | "updated_at">
) {
  const query = new URLSearchParams({ email }).toString();
  return request<DriverApplicationProfile>(`/driver-application/profile?${query}`, {
    method: "PUT",
    body: JSON.stringify(profile),
  });
}

export function listSubscriptionPlans() {
  return request<BillingPlan[]>("/billing/subscription-plans");
}

export function getSubscriptionStatus(email: string, role: AuthRole) {
  const query = new URLSearchParams({ email, role }).toString();
  return request<BillingStatus>(`/billing/subscription-status?${query}`);
}

export function refreshSubscriptionStatus(email: string, role: AuthRole) {
  const query = new URLSearchParams({ email, role }).toString();
  return request<BillingStatus>(`/billing/subscription-refresh?${query}`, {
    method: "POST",
  });
}

export function cancelSubscription(email: string, role: AuthRole) {
  const query = new URLSearchParams({ email, role }).toString();
  return request<BillingStatus>(`/billing/subscription-cancel?${query}`, {
    method: "POST",
  });
}

export function resumeSubscription(email: string, role: AuthRole) {
  const query = new URLSearchParams({ email, role }).toString();
  return request<BillingStatus>(`/billing/subscription-resume?${query}`, {
    method: "POST",
  });
}

export function createSubscriptionCheckoutSession(
  email: string,
  role: AuthRole,
  payload?: { return_url?: string; success_url?: string; cancel_url?: string }
) {
  const query = new URLSearchParams({ email, role }).toString();
  return request<BillingCheckoutResponse>(`/billing/checkout-session?${query}`, {
    method: "POST",
    body: JSON.stringify(payload ?? {}),
  });
}

export function createPaymentMethodSetupSession(
  email: string,
  role: AuthRole,
  payload: { instrument_type: PaymentInstrumentType; success_url?: string; cancel_url?: string }
) {
  const query = new URLSearchParams({ email, role }).toString();
  return request<BillingCheckoutResponse>(`/billing/payment-method-setup-session?${query}`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getPaymentMethodStatus(email: string, role: AuthRole) {
  const query = new URLSearchParams({ email, role }).toString();
  return request<BillingPaymentMethodStatus>(`/billing/payment-method-status?${query}`);
}

export function removePaymentMethod(
  email: string,
  role: AuthRole,
  payload: { instrument_type: PaymentInstrumentType }
) {
  const query = new URLSearchParams({ email, role }).toString();
  return request<BillingPaymentMethodStatus>(`/billing/payment-method-remove?${query}`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function createPayoutOnboardingSession(
  email: string,
  payload?: { return_url?: string; refresh_url?: string }
) {
  const query = new URLSearchParams({ email, role: "carrier" }).toString();
  return request<BillingCheckoutResponse>(`/billing/payout-onboarding?${query}`, {
    method: "POST",
    body: JSON.stringify(payload ?? {}),
  });
}

export function getPayoutAccountStatus(email: string) {
  const query = new URLSearchParams({ email, role: "carrier" }).toString();
  return request<BillingPayoutAccountStatus>(`/billing/payout-account-status?${query}`);
}

export function updateUserProfile(
  email: string,
  role: AuthRole,
  payload: {
    full_name?: string;
    company_name?: string;
    tax_id?: string;
    dot_number?: string;
    phone?: string;
    address?: string;
    address_place_id?: string;
    bio?: string;
    carrier_profile?: {
      available_trucks?: number;
      base_location?: string;
      base_location_place_id?: string;
      service_regions?: string[];
      service_region_place_ids?: string[];
      vehicle_types?: string[];
      max_weight_kg?: number;
      fuel_efficiency_kmpl?: number;
      idle_fuel_lph?: number;
      maintenance_cost_per_km_usd?: number;
      driver_cost_per_hour_usd?: number;
      toll_discount_pct?: number;
      fuel_price_adjustment_pct?: number;
      empty_mile_factor_pct?: number;
    };
  }
) {
  const query = new URLSearchParams({ email, role }).toString();
  return request<AuthProfile>(`/auth/profile?${query}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function listShipments(actor: ActorContext) {
  return request<Shipment[]>("/shipments", undefined, actor);
}

export function listCarrierDrivers(email: string, role: "carrier" = "carrier") {
  const query = new URLSearchParams({ email, role }).toString();
  return request<CarrierDriverSummary[]>(`/carrier/drivers?${query}`);
}

export function generateDriverLoginToken(
  email: string,
  payload: { driver_name: string; driver_mobile: string },
  role: "carrier" = "carrier"
) {
  const query = new URLSearchParams({ email, role }).toString();
  return request<CarrierDriverTokenResponse>(`/carrier/drivers/generate-token?${query}`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function regenerateDriverLoginToken(
  email: string,
  driverId: string,
  role: "carrier" = "carrier"
) {
  const query = new URLSearchParams({ email, role }).toString();
  return request<CarrierDriverTokenResponse>(`/carrier/drivers/${encodeURIComponent(driverId)}/regenerate-token?${query}`, {
    method: "POST",
  });
}

export function driverLogin(payload: { login_token: string }) {
  return request<DriverSession>("/driver/login", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function startDriverTracking(payload: { driver_id: string }) {
  return request<DriverTrackingResponse>("/driver/start-tracking", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateDriverTracking(payload: {
  driver_id: string;
  shipment_id?: string;
  latitude?: number;
  longitude?: number;
  accuracy_m?: number;
  speed_kph?: number;
  heading_deg?: number;
  timestamp?: string;
  note?: string;
}) {
  return request<DriverTrackingUpdateResponse>("/driver/tracking-update", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getDriverCurrentShipment(driverId: string) {
  const query = new URLSearchParams({ driver_id: driverId }).toString();
  return request<DriverCurrentShipment>(`/driver/current-shipment?${query}`);
}

export function uploadDriverDocument(payload: {
  driver_id: string;
  document_name: string;
  document_type: string;
  notes?: string;
  content_text?: string;
  file_mime_type?: string;
  file_base64?: string;
}) {
  return request<DriverDocumentRecord>("/driver/documents/upload", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function listCarrierDriverDocuments(email: string, role: "carrier" = "carrier") {
  const query = new URLSearchParams({ email, role }).toString();
  return request<DriverDocumentRecord[]>(`/carrier/driver-documents?${query}`);
}

export function listCarrierLiveTracking(email: string, role: "carrier" = "carrier") {
  const query = new URLSearchParams({ email, role }).toString();
  return request<CarrierLiveTrackingItem[]>(`/carrier/live-tracking?${query}`);
}

export function listClientLiveTracking(actor: ActorContext) {
  return request<CarrierLiveTrackingItem[]>("/client/live-tracking", undefined, actor);
}

export function listClientCarrierHistory(actor: ActorContext) {
  return request<ClientCarrierHistoryItem[]>("/clients/carrier-history", undefined, actor);
}

export function submitCarrierRating(
  payload: { shipment_id: string; rating: number; use_again: boolean; review?: string },
  actor: ActorContext
) {
  return request<CarrierRating>("/clients/carrier-ratings", {
    method: "POST",
    body: JSON.stringify(payload),
  }, actor);
}

export function rebookCarrierFromHistory(
  payload: { carrier_id: string; template_shipment_id: string; note?: string },
  actor: ActorContext
) {
  return request<Shipment>("/clients/rebook-carrier", {
    method: "POST",
    body: JSON.stringify(payload),
  }, actor);
}

export function createShipment(payload: {
  client_name: string;
  cargo_type: string;
  origin: string;
  origin_place_id?: string;
  destination: string;
  destination_place_id?: string;
  weight_kg: number;
  time_window: string;
  vehicle_needs?: string | null;
  urgency: "low" | "normal" | "high";
}, actor: ActorContext) {
  return request<Shipment>("/shipments", {
    method: "POST",
    body: JSON.stringify(payload),
  }, actor);
}

export function recommendCarriersForShipment(payload: CarrierRecommendationRequest) {
  return request<DispatchMatch[]>("/carriers/recommend", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function autocompleteAddress(input: string, limit = 5, kind: "address" | "city" = "address") {
  const query = new URLSearchParams({ input, limit: String(limit), kind }).toString();
  return request<AddressSuggestion[]>(`/maps/address-autocomplete?${query}`);
}

export function resolveAddressPlace(placeId: string) {
  const query = new URLSearchParams({ place_id: placeId }).toString();
  return request<ResolvedAddress>(`/maps/address-resolve?${query}`);
}

export async function validateUsStreetAddress(input: {
  street_address: string;
  city?: string;
  state?: string;
  postal_code?: string;
}): Promise<StructuredAddress | null> {
  if (!SMARTY_EMBEDDED_KEY || !input.street_address.trim()) {
    return null;
  }

  const query = new URLSearchParams({
    key: SMARTY_EMBEDDED_KEY,
    street: input.street_address.trim(),
    candidates: "1",
  });

  if (input.city?.trim()) {
    query.set("city", input.city.trim());
  }
  if (input.state?.trim()) {
    query.set("state", input.state.trim().toUpperCase());
  }
  if (input.postal_code?.trim()) {
    query.set("zipcode", input.postal_code.trim());
  }

  const response = await fetch(`${SMARTY_US_STREET_URL}?${query.toString()}`);
  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as Array<{
    delivery_line_1?: string;
    last_line?: string;
    components?: {
      city_name?: string;
      state_abbreviation?: string;
      zipcode?: string;
    };
  }>;

  const first = payload[0];
  if (!first?.delivery_line_1 || !first?.components?.city_name || !first?.components?.state_abbreviation || !first?.components?.zipcode) {
    return null;
  }

  return {
    street_address: first.delivery_line_1,
    city: first.components.city_name,
    state: first.components.state_abbreviation,
    postal_code: first.components.zipcode,
    country: "US",
    formatted_address: [first.delivery_line_1, first.last_line || `${first.components.city_name}, ${first.components.state_abbreviation} ${first.components.zipcode}`, "US"].filter(Boolean).join(", "),
  };
}

export function getCarrierDetail(carrierId: string) {
  return request<CarrierDetail>(`/carriers/${carrierId}`);
}

export function acceptShipment(): never {
  throw new Error("acceptShipment is deprecated. Use submitCarrierOffer with an explicit amount.");
}

export function submitCarrierOffer(
  shipmentId: string,
  carrierName: string,
  offerAmount: number,
  actor: ActorContext,
  note?: string,
  quoteDetails?: CarrierQuoteDetailsPayload
) {
  return request<Shipment>(`/shipments/${shipmentId}/accept`, {
    method: "POST",
    body: JSON.stringify({ carrier_name: carrierName, offer_amount: offerAmount, note, quote_details: quoteDetails }),
  }, actor);
}

export function acceptShipmentQuote(shipmentId: string, actor: ActorContext, note?: string) {
  return request<Shipment>(`/shipments/${shipmentId}/accept-quote`, {
    method: "POST",
    body: JSON.stringify({ note }),
  }, actor);
}

export function assignShipmentDriver(shipmentId: string, driverId: string, actor: ActorContext) {
  return request<Shipment>(`/shipments/${shipmentId}/assign-driver`, {
    method: "POST",
    body: JSON.stringify({ driver_id: driverId }),
  }, actor);
}

export function rejectShipmentOffer(shipmentId: string, reason: string | undefined, actor: ActorContext) {
  return request<Shipment>(`/shipments/${shipmentId}/reject`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  }, actor);
}

export function confirmShipmentPayment(shipmentId: string, actor: ActorContext) {
  return request<Shipment>(`/shipments/${shipmentId}/confirm-payment`, {
    method: "POST",
  }, actor);
}

export function confirmShipmentPaymentWithCheckoutSession(
  shipmentId: string,
  checkoutSessionId: string,
  actor: ActorContext
) {
  const query = new URLSearchParams({ checkout_session_id: checkoutSessionId }).toString();
  return request<Shipment>(`/shipments/${shipmentId}/confirm-payment?${query}`, {
    method: "POST",
  }, actor);
}

export function createShipmentPaymentCheckoutSession(
  shipmentId: string,
  actor: ActorContext,
  payload?: { return_url?: string; success_url?: string; cancel_url?: string; embedded?: boolean }
) {
  return request<BillingCheckoutResponse>(`/shipments/${shipmentId}/payment-checkout`, {
    method: "POST",
    body: JSON.stringify(payload ?? {}),
  }, actor);
}

export function optimizeRoute(shipmentId: string, mode: OptimizationMode, actor: ActorContext) {
  return request<Shipment>(`/shipments/${shipmentId}/optimize-route`, {
    method: "POST",
    body: JSON.stringify({ mode }),
  }, actor);
}

export function getRouteAnalysis(shipmentId: string, mode: OptimizationMode, actor: ActorContext) {
  const query = new URLSearchParams({ mode }).toString();
  return request<RouteAnalysis>(`/shipments/${shipmentId}/route-analysis?${query}`, undefined, actor);
}

export function updateShipmentStatus(shipmentId: string, status: ShipmentStatus, note: string | undefined, actor: ActorContext) {
  return request<Shipment>(`/shipments/${shipmentId}/status`, {
    method: "POST",
    body: JSON.stringify({ status, note: note || `Status changed to ${statusLabel[status]}` }),
  }, actor);
}

export function releaseShipmentPayment(shipmentId: string, actor: ActorContext, note?: string) {
  return request<Shipment>(`/shipments/${shipmentId}/release-payment`, {
    method: "POST",
    body: JSON.stringify({ note }),
  }, actor);
}

export function confirmCarrierShipmentPod(shipmentId: string, actor: ActorContext) {
  return request<Shipment>(`/shipments/${shipmentId}/carrier-confirm-pod`, {
    method: "POST",
  }, actor);
}

export function sendCarrierInvite(
  shipmentId: string,
  carrierId: string,
  actor: ActorContext,
  note?: string
) {
  return request<Shipment>(`/shipments/${shipmentId}/invite`, {
    method: "POST",
    body: JSON.stringify({ carrier_id: carrierId, note }),
  }, actor);
}
