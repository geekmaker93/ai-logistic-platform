"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { jsPDF } from "jspdf";
import {
  autocompleteAddress,
  AuthProfile,
  ActorContext,
  BillingPlan,
  BillingPaymentMethodStatus,
  BillingStatus,
  PaymentInstrumentType,
  type AddressSuggestion,
  CarrierDetail,
  CarrierRating,
  ClientCarrierHistoryItem,
  CarrierLiveTrackingItem,
  confirmShipmentPaymentWithCheckoutSession,
  acceptShipmentQuote,
  createPaymentMethodSetupSession,
  createSubscriptionCheckoutSession,
  createShipmentPaymentCheckoutSession,
  createShipment,
  DispatchMatch,
  getCarrierDetail,
  getPaymentMethodStatus,
  getSubscriptionStatus,
  getUserProfile,
  listClientLiveTracking,
  listClientCarrierHistory,
  listSubscriptionPlans,
  listShipments,
  rebookCarrierFromHistory,
  cancelSubscription,
  resumeSubscription,
  refreshSubscriptionStatus,
  releaseShipmentPayment,
  removePaymentMethod,
  resolveAddressPlace,
  sendCarrierInvite,
  submitCarrierRating,
  Shipment,
  statusLabel,
  updateUserProfile,
  validateUsStreetAddress,
} from "@/lib/logistics-api";
import AddressAutocompleteInput from "@/app/components/address-autocomplete-input";
import StripeEmbeddedCheckout from "@/app/components/stripe-embedded-checkout";
import { AuthLiteSession, clearAuthLiteSession, getAuthLiteSession, setAuthLiteSession } from "@/lib/auth-lite";
import { trackEvent } from "@/lib/telemetry";

const LiveTrackingMap = dynamic(() => import("@/app/components/live-tracking-map"), {
  ssr: false,
});

const KG_PER_LB = 0.45359237;
const LB_PER_KG = 2.20462262;
const DEFAULT_COUNTRY_CODE = "US";
const US_STATE_CODES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
];

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

function shipmentStatusBadgeClass(status: Shipment["status"]): string {
  if (status === "delivered") {
    return "border border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (status === "active" || status === "in_transit") {
    return "border border-sky-200 bg-sky-50 text-sky-700";
  }
  if (status === "awaiting_payment") {
    return "border border-amber-200 bg-amber-50 text-amber-700";
  }
  return "border border-indigo-200 bg-indigo-50 text-indigo-700";
}

function buildActivityPath(values: number[]): string {
  const width = 320;
  const height = 120;
  const maxValue = Math.max(...values, 1);

  return values.map((value, index) => {
    const x = values.length === 1 ? width / 2 : (index / (values.length - 1)) * width;
    const y = height - (value / maxValue) * 88 - 12;
    return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
}

function DashboardStatCard(props: Readonly<{
  label: string;
  value: string | number;
  detail: string;
  accentClass: string;
  progressClass: string;
  progress: number;
}>) {
  const { label, value, detail, accentClass, progressClass, progress } = props;

  return (
    <div className="shipper-premium-card shipper-card-hover rounded-[28px] p-5">
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

function ShipperActivityChart(props: Readonly<{
  labels: string[];
  values: number[];
}>) {
  const { labels, values } = props;
  const path = buildActivityPath(values);

  return (
    <div className="relative overflow-hidden rounded-[28px] border border-white/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(238,242,255,0.82))] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]">
      <div className="shipper-grid-glow absolute inset-0 opacity-60" />
      <div className="relative z-10">
        <p className="text-xs font-semibold uppercase tracking-[0.26em] text-slate-500">Shipping velocity</p>
        <div className="mt-4 rounded-[24px] bg-slate-950 px-4 py-4 text-white shadow-[0_18px_45px_rgba(15,23,42,0.28)]">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-[0.22em] text-cyan-200/80">Recent activity</p>
              <p className="mt-2 text-3xl font-semibold tracking-tight">{Math.max(...values, 0)}</p>
            </div>
            <p className="max-w-[180px] text-right text-xs leading-5 text-slate-300">A compact view of recent shipment movement and completion momentum.</p>
          </div>
          <svg viewBox="0 0 320 120" className="mt-4 h-32 w-full" role="img" aria-label="Recent shipment activity chart">
            <defs>
              <linearGradient id="shipperActivityStroke" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#67e8f9" />
                <stop offset="100%" stopColor="#818cf8" />
              </linearGradient>
              <linearGradient id="shipperActivityFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgba(103, 232, 249, 0.26)" />
                <stop offset="100%" stopColor="rgba(15, 23, 42, 0)" />
              </linearGradient>
            </defs>
            <path d={path} fill="none" stroke="url(#shipperActivityStroke)" strokeWidth="4" strokeLinecap="round" />
            {values.map((value, index) => {
              const x = values.length === 1 ? 160 : (index / (values.length - 1)) * 320;
              const y = 120 - (value / Math.max(...values, 1)) * 88 - 12;
              return (
                <g key={`activity-point-${index}-${labels[index] ?? "label"}-${value}`}>
                  <circle cx={x} cy={y} r="5" fill="#0f172a" stroke="#67e8f9" strokeWidth="3" />
                </g>
              );
            })}
          </svg>
          <div className="mt-2 grid grid-cols-6 gap-2 text-[11px] uppercase tracking-[0.18em] text-slate-400">
            {labels.map((label, index) => (
              <span key={`activity-label-${index}-${label}`} className="truncate text-center">{label}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function toKgFromLb(weightLb: number): number {
  return Number((weightLb * KG_PER_LB).toFixed(2));
}

function toLbFromKg(weightKg: number): number {
  return Number((weightKg * LB_PER_KG).toFixed(0));
}

function toKgFromLbRounded(weightLb: number): number {
  return Number((weightLb * KG_PER_LB).toFixed(0));
}

const cargoTypeOptions = [
  "General Merchandise",
  "Electronics",
  "Automotive Parts",
  "Pharmaceuticals",
  "Food and Beverages",
  "Fresh Produce",
  "Frozen Goods",
  "Chemicals (Non-Hazardous)",
  "Hazardous Materials",
  "Construction Materials",
  "Industrial Machinery",
  "Steel and Metals",
  "Textiles and Apparel",
  "Furniture",
  "Paper and Packaging",
  "Consumer Packaged Goods",
  "Medical Equipment",
  "Oversized Cargo",
  "Livestock Feed",
  "Other",
] as const;

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

const STRIPE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim() || "";

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

function podStatusLabel(podStatus: string): string {
  if (podStatus === "uploaded") {
    return "Uploaded";
  }
  if (podStatus === "carrier_confirmed") {
    return "Carrier Confirmed";
  }
  if (podStatus === "reviewed") {
    return "Reviewed";
  }
  return "Pending";
}

function payoutStatusLabel(payoutStatus: string | null): string {
  if (payoutStatus === "released") {
    return "Released";
  }
  if (payoutStatus === "pending_connect_account") {
    return "Pending carrier bank setup";
  }
  return "Pending";
}

  function pendingQuoteAmount(shipment: Shipment): number | null {
    if (shipment.shipper_approved_amount !== null) {
      return shipment.shipper_approved_amount;
    }
    if (shipment.carrier_offer_amount !== null) {
      return shipment.carrier_offer_amount;
    }
    return shipment.quote_breakdown?.total_usd ?? null;
  }

function distanceSourceLabel(source: DispatchMatch["distance_source"]): string {
  if (source === "google_maps") {
    return "Google Maps";
  }
  if (source === "mixed") {
    return "Google + heuristic";
  }
  return "Heuristic";
}

function formatRemainingDistance(distanceKm: number | null): string {
  if (distanceKm === null || distanceKm === undefined) {
    return "Pending";
  }
  return `${distanceKm.toFixed(1)} km`;
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
  const normalizedCountry = country.trim().toUpperCase() || DEFAULT_COUNTRY_CODE;
  const stateAndZip = [normalizedState, normalizedPostalCode].filter(Boolean).join(" ").trim();
  return [normalizedStreet, normalizedCity, stateAndZip, normalizedCountry].filter(Boolean).join(", ");
}

function buildPathWithQuery(pathname: string, query: string): string {
  if (!query) {
    return pathname;
  }
  return pathname + "?" + query;
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

export default function ClientPortalPage() {
  const router = useRouter();
  const [session, setSession] = useState<AuthLiteSession | null>(null);
  const [ready, setReady] = useState(false);
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [loading, setLoading] = useState(false);
  const [trackingLoading, setTrackingLoading] = useState(false);
  const [createdMatchResult, setCreatedMatchResult] = useState<{ shipmentId: string; matches: DispatchMatch[] } | null>(null);
  const [createStep, setCreateStep] = useState<"form" | "matches">("form");
  const [carrierDetail, setCarrierDetail] = useState<CarrierDetail | null>(null);
  const [carrierDetailLoading, setCarrierDetailLoading] = useState(false);
  const [inviteSendingCarrierId, setInviteSendingCarrierId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [profile, setProfile] = useState<AuthProfile | null>(null);
  const [profileSaving, setProfileSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<"dashboard" | "metrics" | "tracking" | "create" | "carrier_history" | "transactions" | "documents" | "profile" | "subscription">("dashboard");
  const [subscriptionPlans, setSubscriptionPlans] = useState<BillingPlan[]>([]);
  const [subscriptionStatus, setSubscriptionStatus] = useState<BillingStatus | null>(null);
  const [paymentMethodStatus, setPaymentMethodStatus] = useState<BillingPaymentMethodStatus | null>(null);
  const [subscriptionLoading, setSubscriptionLoading] = useState(false);
  const [subscriptionActionLoading, setSubscriptionActionLoading] = useState<"cancel" | "resume" | null>(null);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [embeddedCheckout, setEmbeddedCheckout] = useState<{
    clientSecret: string;
    title: string;
  } | null>(null);
  const [walletSetupLoading, setWalletSetupLoading] = useState<PaymentInstrumentType | null>(null);
  const [walletRemoveLoading, setWalletRemoveLoading] = useState(false);
  const [shipmentCheckoutLoadingId, setShipmentCheckoutLoadingId] = useState<string | null>(null);
  const [releasePaymentLoadingId, setReleasePaymentLoadingId] = useState<string | null>(null);
  const [carrierHistory, setCarrierHistory] = useState<ClientCarrierHistoryItem[]>([]);
  const [carrierHistoryLoading, setCarrierHistoryLoading] = useState(false);
  const [ratingDraftsByCarrier, setRatingDraftsByCarrier] = useState<Record<string, { rating: number; useAgain: boolean; review: string }>>({});
  const [ratingSubmittingCarrier, setRatingSubmittingCarrier] = useState<string | null>(null);
  const [rebookingCarrier, setRebookingCarrier] = useState<string | null>(null);
  const [selectedInvoice, setSelectedInvoice] = useState<{
    invoiceId: string;
    transactionRef: string;
    paymentDate: string;
    shipment: Shipment;
  } | null>(null);
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
  });
  const [formData, setFormData] = useState({
    cargo_type: "",
    origin: "",
    destination: "",
    weight_lb: "26000",
    time_window: "Today 9:00 AM - 3:00 PM",
    vehicle_needs: [] as string[],
    urgency: "normal" as "low" | "normal" | "high",
  });
  const [originPlaceId, setOriginPlaceId] = useState<string | null>(null);
  const [destinationPlaceId, setDestinationPlaceId] = useState<string | null>(null);
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
  const [liveTrackingRows, setLiveTrackingRows] = useState<CarrierLiveTrackingItem[]>([]);
  const [selectedTrackingShipmentId, setSelectedTrackingShipmentId] = useState<string>("");
  const [selectedTransitShipmentId, setSelectedTransitShipmentId] = useState<string | null>(null);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const kickoff = setTimeout(() => {
      const nextSession = getAuthLiteSession("client");
      if (nextSession?.role !== "client") {
        setReady(true);
        return;
      }
      setSession(nextSession);
      setReady(true);
    }, 0);

    return () => clearTimeout(kickoff);
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
      const actor: ActorContext = { role: "client", displayName: session.displayName };
      const data = await listShipments(actor);
      setShipments(data);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to load shipments.");
    } finally {
      setLoading(false);
    }
  }, [session]);

  const loadLiveTracking = useCallback(async () => {
    if (!session) {
      return;
    }

    setTrackingLoading(true);
    try {
      const actor: ActorContext = { role: "client", displayName: session.displayName };
      const rows = await listClientLiveTracking(actor);
      setLiveTrackingRows(rows);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to load live tracking.");
    } finally {
      setTrackingLoading(false);
    }
  }, [session]);

  const loadCarrierHistory = useCallback(async () => {
    if (!session) {
      return;
    }

    setCarrierHistoryLoading(true);
    try {
      const actor: ActorContext = { role: "client", displayName: session.displayName };
      const rows = await listClientCarrierHistory(actor);
      setCarrierHistory(rows);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to load carrier history.");
    } finally {
      setCarrierHistoryLoading(false);
    }
  }, [session]);

  const loadSubscriptionState = useCallback(async (refresh = false) => {
    if (!session?.email) {
      return;
    }

    setSubscriptionLoading(true);
    try {
      const [plans, status] = await Promise.all([
        listSubscriptionPlans(),
        refresh ? refreshSubscriptionStatus(session.email, "client") : getSubscriptionStatus(session.email, "client"),
      ]);
      setSubscriptionPlans(plans);
      setSubscriptionStatus(status);

      // Keep subscription checks fast; wallet status can load in the background.
      void getPaymentMethodStatus(session.email, "client")
        .then((walletStatus) => {
          setPaymentMethodStatus(walletStatus);
        })
        .catch(() => {
          // Ignore wallet fetch failures here to avoid blocking subscription access.
        });
    } catch (error) {
      if (!(error instanceof Error && error.message === "Subscription required. Please activate your plan to continue.")) {
        setMessage(error instanceof Error ? error.message : "Failed to load subscription status.");
      }
    } finally {
      setSubscriptionLoading(false);
    }
  }, [session]);

  const cancelClientSubscription = useCallback(async () => {
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
      const status = await cancelSubscription(session.email, "client");
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

  const resumeClientSubscription = useCallback(async () => {
    if (!session?.email || subscriptionActionLoading) {
      return;
    }

    setSubscriptionActionLoading("resume");
    try {
      const status = await resumeSubscription(session.email, "client");
      setSubscriptionStatus(status);
      setMessage("Subscription resumed. It will auto-renew as normal.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to resume subscription.");
    } finally {
      setSubscriptionActionLoading(null);
    }
  }, [session, subscriptionActionLoading]);

  const startSubscriptionCheckout = useCallback(async () => {
    if (!session?.email || checkoutLoading) {
      return;
    }

    setCheckoutLoading(true);
    try {
      const origin = globalThis.window.location.origin;
      const response = await createSubscriptionCheckoutSession(session.email, "client", {
        return_url: `${origin}/client?billing=success`,
      });
      setCheckoutLoading(false);
      if (response.client_secret) {
        setEmbeddedCheckout({
          clientSecret: response.client_secret,
          title: "Subscribe for $25.00 / month",
        });
        setMessage("Checkout is ready below.");
      } else {
        setMessage("Stripe did not return an embedded checkout secret.");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to start checkout.");
      setCheckoutLoading(false);
    }
  }, [checkoutLoading, session]);

  const startWalletSetup = useCallback(async (instrumentType: PaymentInstrumentType) => {
    if (!session?.email || walletSetupLoading) {
      return;
    }

    setWalletSetupLoading(instrumentType);
    setMessage("");
    try {
      const origin = globalThis.window.location.origin;
      const response = await createPaymentMethodSetupSession(session.email, "client", {
        instrument_type: instrumentType,
        success_url: `${origin}/client?wallet=setup-success&instrument=${instrumentType}`,
        cancel_url: `${origin}/client?wallet=setup-cancel&instrument=${instrumentType}`,
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
      const nextStatus = await removePaymentMethod(session.email, "client", { instrument_type: "card" });
      setPaymentMethodStatus(nextStatus);
      setMessage("Linked card removed from your profile wallet.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to remove linked card.");
    } finally {
      setWalletRemoveLoading(false);
    }
  }, [session, walletRemoveLoading]);

  useEffect(() => {
    if (!ready || !session) {
      return;
    }

    const kickoff = setTimeout(() => {
      void loadShipments();
    }, 0);

    const timer = setInterval(() => {
      void loadShipments();
    }, 15000);

    return () => {
      clearTimeout(kickoff);
      clearInterval(timer);
    };
  }, [ready, session, loadShipments]);

  useEffect(() => {
    if (!ready || !session || activeTab !== "tracking") {
      return;
    }

    const kickoff = setTimeout(() => {
      void loadLiveTracking();
    }, 0);

    const timer = setInterval(() => {
      void loadLiveTracking();
    }, 30000);

    return () => {
      clearTimeout(kickoff);
      clearInterval(timer);
    };
  }, [ready, session, activeTab, loadLiveTracking]);

  useEffect(() => {
    if (!carrierHistory.length) {
      return;
    }

    setRatingDraftsByCarrier((prev) => {
      const next = { ...prev };
      for (const item of carrierHistory) {
        if (!next[item.carrier_name]) {
          next[item.carrier_name] = {
            rating: item.latest_rating ?? 5,
            useAgain: item.would_use_again ?? true,
            review: item.latest_review ?? "",
          };
        }
      }
      return next;
    });
  }, [carrierHistory]);

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
      setMessage("Stripe " + instrumentLabel + " setup completed.");
      setWalletSetupLoading(null);
    } else if (walletState === "setup-cancel") {
      setMessage("Stripe wallet setup canceled.");
      setWalletSetupLoading(null);
    }

    if (billingState || walletState) {
      params.delete("billing");
      params.delete("wallet");
      params.delete("instrument");
      const nextQuery = params.toString();
      const nextUrl = buildPathWithQuery(globalThis.window.location.pathname, nextQuery);
      globalThis.window.history.replaceState({}, "", nextUrl);
    }

    void loadSubscriptionState(shouldRefresh);
  }, [ready, session, loadSubscriptionState]);

  useEffect(() => {
    if (!ready || !session || activeTab !== "carrier_history") {
      return;
    }

    void loadCarrierHistory();
  }, [ready, session, activeTab, loadCarrierHistory]);

  useEffect(() => {
    if (!ready || !session) {
      return;
    }

    const params = new URLSearchParams(globalThis.window.location.search);
    const shipmentPaymentState = params.get("shipmentPayment");
    const shipmentId = params.get("shipmentId");
    const checkoutSessionId = params.get("checkoutSessionId");
    if (!shipmentPaymentState) {
      return;
    }

    const clearPaymentQuery = () => {
      params.delete("shipmentPayment");
      params.delete("shipmentId");
      params.delete("checkoutSessionId");
      const nextQuery = params.toString();
      const nextUrl = buildPathWithQuery(globalThis.window.location.pathname, nextQuery);
      globalThis.window.history.replaceState({}, "", nextUrl);
    };

    const deferMessage = (text: string) => {
      setTimeout(() => {
        setMessage(text);
      }, 0);
    };

    if (shipmentPaymentState === "cancel") {
      deferMessage("Shipment payment checkout was canceled.");
      clearPaymentQuery();
      return;
    }

    if (shipmentPaymentState !== "success" || !shipmentId || !checkoutSessionId) {
      deferMessage("Shipment payment callback is missing required checkout details.");
      clearPaymentQuery();
      return;
    }

    deferMessage("Payment received. Finalizing shipment...");
    void (async () => {
      try {
        await confirmShipmentPaymentWithCheckoutSession(
          shipmentId,
          checkoutSessionId,
          { role: "client", displayName: session.displayName }
        );
        trackEvent("shipment.payment_confirmed", { role: "client", shipmentId });
        setMessage("Payment confirmed. Shipment is now active and tracking has started.");
        await loadShipments();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Failed to finalize shipment payment.");
      } finally {
        clearPaymentQuery();
      }
    })();
  }, [ready, session, loadShipments]);

  useEffect(() => {
    if (activeTab !== "tracking") {
      setSelectedTransitShipmentId(null);
    }
  }, [activeTab]);

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
    if (!ready || !session?.email) {
      return;
    }

    const sessionEmail = session.email;

    const kickoff = setTimeout(() => {
      void (async () => {
        try {
          const data = await getUserProfile(sessionEmail, "client");
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
          });
          setStreetPlaceId(null);
          setCityPlaceId(null);
          setStreetSuggestions([]);
          setCitySuggestions([]);
          setStreetOpen(false);
          setCityOpen(false);
        } catch (error) {
          setMessage(error instanceof Error ? error.message : "Failed to load profile.");
        }
      })();
    }, 0);

    return () => clearTimeout(kickoff);
  }, [ready, session]);

  useEffect(() => {
    const street = profileForm.street.trim();
    if (street.length < 3) {
      setStreetSuggestions([]);
      setStreetLoading(false);
      return;
    }

    const queryWithContext = [street, profileForm.city.trim(), profileForm.state.trim()].filter(Boolean).join(", ");
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
          country: DEFAULT_COUNTRY_CODE,
        }));
        setCityPlaceId(match.place_id);
        setCityOpen(false);
      } catch {
        setCityPlaceId(match.place_id);
        setCityOpen(false);
      }
    })();
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
          country: DEFAULT_COUNTRY_CODE,
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

  function updateShipmentField<K extends keyof typeof formData>(field: K, value: (typeof formData)[K]) {
    if (createdMatchResult) {
      setCreatedMatchResult(null);
      setCreateStep("form");
    }
    if (carrierDetail) {
      setCarrierDetail(null);
    }
    if (field === "origin") {
      setOriginPlaceId(null);
    }
    if (field === "destination") {
      setDestinationPlaceId(null);
    }
    setFormData((prev) => ({ ...prev, [field]: value }));
  }

  function toggleVehicleNeed(value: string) {
    const exists = formData.vehicle_needs.includes(value);
    const nextValues = exists
      ? formData.vehicle_needs.filter((item) => item !== value)
      : [...formData.vehicle_needs, value];
    updateShipmentField("vehicle_needs", nextValues);
  }

  const myShipments = useMemo(() => {
    if (!session) {
      return [];
    }

    return shipments
      .filter((shipment) => shipment.client_name.toLowerCase() === session.displayName.toLowerCase())
      .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
  }, [shipments, session]);

  const dashboardStats = useMemo(() => {
    return {
      total: myShipments.length,
      awaitingPayment: myShipments.filter((shipment) => shipment.status === "awaiting_payment").length,
      active: myShipments.filter((shipment) => shipment.status === "active").length,
      delivered: myShipments.filter((shipment) => shipment.status === "delivered").length,
    };
  }, [myShipments]);

  const dashboardRevenue = useMemo(
    () => myShipments.reduce((sum, shipment) => sum + (pendingQuoteAmount(shipment) ?? 0), 0),
    [myShipments]
  );

  const deliveredRevenue = useMemo(
    () => myShipments
      .filter((shipment) => shipment.status === "delivered")
      .reduce((sum, shipment) => sum + (pendingQuoteAmount(shipment) ?? 0), 0),
    [myShipments]
  );

  const dashboardMix = useMemo(() => {
    const total = Math.max(myShipments.length, 1);
    return [
      {
        label: "Awaiting payment",
        value: dashboardStats.awaitingPayment,
        percent: Math.round((dashboardStats.awaitingPayment / total) * 100),
        barClass: "bg-gradient-to-r from-amber-400 to-orange-500",
      },
      {
        label: "In motion",
        value: dashboardStats.active,
        percent: Math.round((dashboardStats.active / total) * 100),
        barClass: "bg-gradient-to-r from-cyan-400 to-sky-500",
      },
      {
        label: "Delivered",
        value: dashboardStats.delivered,
        percent: Math.round((dashboardStats.delivered / total) * 100),
        barClass: "bg-gradient-to-r from-emerald-400 to-teal-500",
      },
    ];
  }, [dashboardStats, myShipments.length]);

  const shipmentActivityChart = useMemo(() => {
    const recentShipments = [...myShipments]
      .sort((a, b) => new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime())
      .slice(-6);

    if (recentShipments.length === 0) {
      return {
        labels: ["Jan", "Feb", "Mar", "Apr", "May", "Jun"],
        values: [1, 2, 1, 3, 2, 4],
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
        if (shipment.status === "awaiting_payment") {
          return 3;
        }
        if (shipment.status === "accepted") {
          return 2;
        }
        return 1;
      }),
    };
  }, [myShipments]);

  const profileCompletion = useMemo(() => {
    const checks = [
      profileForm.full_name,
      profileForm.company_name,
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

  const shipperAnalytics = useMemo(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const thisMonthShipments = myShipments.filter((s) => new Date(s.created_at) >= monthStart);
    
    // Total spend this month (sum of all quoted amounts)
    const totalSpendThisMonth = thisMonthShipments.reduce((sum, s) => sum + (pendingQuoteAmount(s) ?? 0), 0);
    
    // Loads completed this month
    const loadsCompletedThisMonth = thisMonthShipments.filter((s) => s.status === "delivered").length;
    
    // Average transit time
    const completedWithTiming = thisMonthShipments
      .filter((s) => s.status === "delivered" && s.estimated_arrival && s.created_at)
      .map((s) => {
        const createdTime = new Date(s.created_at).getTime();
        const arrivalTime = new Date(s.estimated_arrival!).getTime();
        return (arrivalTime - createdTime) / (1000 * 60 * 60); // hours
      });
    
    const avgTransitHours = completedWithTiming.length > 0
      ? completedWithTiming.reduce((a, b) => a + b, 0) / completedWithTiming.length
      : 0;
    
    // Average cost per mile (estimate: total spend / estimated total miles)
    const completedWithMiles = thisMonthShipments.filter((s) => s.status === "delivered");
    const estimatedTotalMiles = completedWithMiles.reduce((sum, s) => {
      // Rough estimate: assume 0.5 miles per lb for cargo weight
      const estimatedMiles = Math.max((s.weight_kg * 2.2) * 0.5, 100);
      return sum + estimatedMiles;
    }, 0);
    
    const avgCostPerMile = estimatedTotalMiles > 0
      ? (totalSpendThisMonth / estimatedTotalMiles)
      : 0;
    
    return {
      totalSpendThisMonth,
      loadsCompletedThisMonth,
      avgTransitHours,
      avgCostPerMile,
    };
  }, [myShipments]);

  const liveTrackingByShipmentId = useMemo(() => {
    const map: Record<string, CarrierLiveTrackingItem> = {};
    for (const row of liveTrackingRows) {
      map[row.shipment_id] = row;
    }
    return map;
  }, [liveTrackingRows]);

  const isSubscriptionActive = subscriptionStatus?.subscription_active ?? Boolean(session?.subscriptionActive);
  const shipperPlan = useMemo(
    () => subscriptionPlans.find((plan) => plan.role === "client") || null,
    [subscriptionPlans]
  );

  const selectedTransitTracking = useMemo(() => {
    if (!selectedTransitShipmentId) {
      return null;
    }
    return liveTrackingByShipmentId[selectedTransitShipmentId] || null;
  }, [liveTrackingByShipmentId, selectedTransitShipmentId]);

  const selectedTrackingRow = useMemo(() => {
    if (!liveTrackingRows.length) {
      return null;
    }
    return liveTrackingRows.find((row) => row.shipment_id === selectedTrackingShipmentId) ?? liveTrackingRows[0];
  }, [liveTrackingRows, selectedTrackingShipmentId]);

  const invoiceTransactions = useMemo(
    () =>
      myShipments
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
          invoiceId: shipment.invoice_number!,
          transactionRef: shipment.payment_intent_id!,
          paymentDate: shipment.payment_completed_at || shipment.invoice_generated_at || shipment.updated_at,
          amountUsd,
          freightChargeUsd,
          platformFeeUsd: quote.service_fee_usd,
          detail: "Payment captured via Stripe",
        };
      }),
    [myShipments]
  );

  const ownTransactions = useMemo(
    () =>
      invoiceTransactions.map((item) => ({
        ...item,
        kind: "purchase" as const,
      })),
    [invoiceTransactions]
  );

  function buildInvoiceDocument(params: {
    invoiceId: string;
    transactionRef: string;
    paymentDate: string;
    shipment: Shipment;
  }): string {
    const { invoiceId, transactionRef, paymentDate, shipment } = params;
    const quote = shipment.quote_breakdown;
    if (!quote) {
      return "No invoice data available.";
    }

    const freightChargeUsd = quote.base_freight_usd + quote.urgency_surcharge_usd + quote.distance_surcharge_usd;
    const platformFeeUsd = quote.service_fee_usd;
    const totalPaidUsd = shipment.shipper_approved_amount ?? shipment.carrier_offer_amount ?? quote.total_usd;

    return [
      `Invoice #: ${invoiceId}`,
      `Load #: ${shipment.load_number}`,
      "Status: PAID",
      "",
      `Shipper: ${shipment.client_name}`,
      `Carrier: ${shipment.carrier_name || "Pending assignment"}`,
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
    invoiceId: string;
    transactionRef: string;
    paymentDate: string;
    shipment: Shipment;
  }) {
    const safeInvoiceId = params.invoiceId.replace(/[^a-zA-Z0-9-_]/g, "_");
    const content = buildInvoiceDocument(params);
    downloadPdfDocument(`${safeInvoiceId}.pdf`, content);
  }

  function onViewInvoice(params: {
    invoiceId: string;
    transactionRef: string;
    paymentDate: string;
    shipment: Shipment;
  }) {
    setSelectedInvoice(params);
  }

  function signOut() {
    clearAuthLiteSession("client");
    setSession(null);
    trackEvent("auth.sign_out", { role: "client" });
    globalThis.window.location.assign("/");
  }

  async function submitShipment() {
    if (!session) {
      setMessage("Session missing. Please sign in again.");
      return;
    }

    setMessage("");
    try {
      if (!originPlaceId || !destinationPlaceId) {
        setMessage("Choose pickup and delivery addresses from Google Maps suggestions.");
        return;
      }

      const created = await createShipment({
        client_name: session.displayName,
        cargo_type: formData.cargo_type.trim(),
        origin: formData.origin.trim(),
        origin_place_id: originPlaceId,
        destination: formData.destination.trim(),
        destination_place_id: destinationPlaceId,
        weight_kg: toKgFromLb(Number(formData.weight_lb)),
        time_window: formData.time_window.trim(),
        vehicle_needs: formData.vehicle_needs.length > 0 ? formData.vehicle_needs.join(",") : null,
        urgency: formData.urgency,
      }, { role: "client", displayName: session.displayName });

      trackEvent("shipment.create", {
        role: "client",
        clientName: session.displayName,
        shipmentId: created.id,
      });

      setCreatedMatchResult({ shipmentId: created.id, matches: created.dispatch_matches });
      setCreateStep("matches");
      setCarrierDetail(null);

      setFormData({
        cargo_type: "",
        origin: "",
        destination: "",
        weight_lb: "26000",
        time_window: "Today 9:00 AM - 3:00 PM",
        vehicle_needs: [],
        urgency: "normal",
      });
      setOriginPlaceId(null);
      setDestinationPlaceId(null);
      setActiveTab("create");
      setMessage(`Shipment created and dispatched to ${created.dispatch_matches.length} carriers.`);
      await loadShipments();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to create shipment.");
    }
  }

  async function onConfirmAndPay(shipmentId: string) {
    if (!session) {
      setMessage("Session missing. Please sign in again.");
      return;
    }

    if (shipmentCheckoutLoadingId) {
      return;
    }

    setMessage("");
    setShipmentCheckoutLoadingId(shipmentId);
    try {
      const origin = globalThis.window.location.origin;
      const useEmbeddedCheckout = Boolean(STRIPE_PUBLISHABLE_KEY);
      const response = await createShipmentPaymentCheckoutSession(
        shipmentId,
        { role: "client", displayName: session.displayName },
        useEmbeddedCheckout
          ? {
              return_url: `${origin}/client?shipmentPayment=success&shipmentId=${encodeURIComponent(shipmentId)}&checkoutSessionId={CHECKOUT_SESSION_ID}`,
              embedded: true,
            }
          : {
              success_url: `${origin}/client?shipmentPayment=success&shipmentId=${encodeURIComponent(shipmentId)}&checkoutSessionId={CHECKOUT_SESSION_ID}`,
              cancel_url: `${origin}/client?shipmentPayment=cancel&shipmentId=${encodeURIComponent(shipmentId)}`,
              embedded: false,
            }
      );
      setShipmentCheckoutLoadingId(null);
      if (response.client_secret) {
        const shipment = shipments.find((item) => item.id === shipmentId);
        setEmbeddedCheckout({
          clientSecret: response.client_secret,
          title: shipment ? `Pay ${shipment.origin} to ${shipment.destination}` : "Pay shipment invoice",
        });
        setMessage("Checkout is ready below.");
      } else if (response.checkout_url) {
        const openedPopup = openStripeHostedFlow(response.checkout_url);
        setMessage(
          openedPopup
            ? "Stripe checkout opened in a popup. Complete payment there, then return to this page."
            : "Redirecting to Stripe checkout..."
        );
      } else {
        setMessage("Stripe did not return a checkout session payload.");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to open payment checkout.");
      setShipmentCheckoutLoadingId(null);
    }
  }

  async function onAcceptQuote(shipmentId: string) {
    if (!session) {
      setMessage("Session missing. Please sign in again.");
      return;
    }

    setMessage("");
    try {
      await acceptShipmentQuote(shipmentId, { role: "client", displayName: session.displayName });
      trackEvent("shipment.quote_accepted", { role: "client", shipmentId });
      setMessage("Quote accepted. Complete payment to activate the shipment.");
      await loadShipments();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to accept quote.");
    }
  }

  async function onReleasePayment(shipmentId: string) {
    if (!session || releasePaymentLoadingId) {
      return;
    }

    setReleasePaymentLoadingId(shipmentId);
    setMessage("");
    try {
      await releaseShipmentPayment(
        shipmentId,
        { role: "client", displayName: session.displayName },
        "Shipper completed POD review and released carrier payout early."
      );
      trackEvent("shipment.payment_released", { role: "client", shipmentId });
      setMessage("Carrier payment released.");
      await loadShipments();
      await loadCarrierHistory();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to release carrier payment.");
    } finally {
      setReleasePaymentLoadingId(null);
    }
  }

  async function onViewCarrier(match: DispatchMatch) {
    setCarrierDetailLoading(true);
    try {
      const detail = await getCarrierDetail(match.carrier_id);
      setCarrierDetail(detail);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to load carrier details.");
    } finally {
      setCarrierDetailLoading(false);
    }
  }

  async function onSendInvite(match: DispatchMatch) {
    if (!session) {
      setMessage("Session missing. Please sign in again.");
      return;
    }
    if (!createdMatchResult?.shipmentId) {
      setMessage("Create shipment first, then send offer to a specific carrier.");
      return;
    }

    setInviteSendingCarrierId(match.carrier_id);
    try {
      await sendCarrierInvite(
        createdMatchResult.shipmentId,
        match.carrier_id,
        { role: "client", displayName: session.displayName },
        `Shipper sent offer to ${match.carrier_name} from match panel.`
      );
      setMessage(`Offer sent to ${match.carrier_name}.`);
      await loadShipments();
      await loadCarrierHistory();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to send offer.");
    } finally {
      setInviteSendingCarrierId(null);
    }
  }

  function updateCarrierRatingDraft(
    carrierName: string,
    patch: Partial<{ rating: number; useAgain: boolean; review: string }>
  ) {
    setRatingDraftsByCarrier((prev) => {
      const existing = prev[carrierName] ?? { rating: 5, useAgain: true, review: "" };
      return {
        ...prev,
        [carrierName]: {
          ...existing,
          ...patch,
        },
      };
    });
  }

  async function onSubmitCarrierRating(item: ClientCarrierHistoryItem) {
    if (!session) {
      setMessage("Session missing. Please sign in again.");
      return;
    }
    if (!item.last_delivered_shipment_id) {
      setMessage("Carrier ratings require a delivered shipment.");
      return;
    }

    const draft = ratingDraftsByCarrier[item.carrier_name] ?? {
      rating: item.latest_rating ?? 5,
      useAgain: item.would_use_again ?? true,
      review: item.latest_review ?? "",
    };

    setRatingSubmittingCarrier(item.carrier_name);
    try {
      const actor: ActorContext = { role: "client", displayName: session.displayName };
      const saved: CarrierRating = await submitCarrierRating(
        {
          shipment_id: item.last_delivered_shipment_id,
          rating: draft.rating,
          use_again: draft.useAgain,
          review: draft.review.trim() || undefined,
        },
        actor
      );
      setMessage(`Saved ${saved.rating}-star rating for ${item.carrier_name}.`);
      await loadCarrierHistory();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to save carrier rating.");
    } finally {
      setRatingSubmittingCarrier(null);
    }
  }

  async function onRebookCarrier(item: ClientCarrierHistoryItem) {
    if (!session) {
      setMessage("Session missing. Please sign in again.");
      return;
    }
    if (!item.carrier_id) {
      setMessage("This carrier cannot be rebooked yet because its carrier ID is missing.");
      return;
    }

    setRebookingCarrier(item.carrier_name);
    setMessage("");
    try {
      const actor: ActorContext = { role: "client", displayName: session.displayName };
      const created = await rebookCarrierFromHistory(
        {
          carrier_id: item.carrier_id,
          template_shipment_id: item.last_delivered_shipment_id || item.last_shipment_id,
          note: `Rebook requested from carrier history for ${item.carrier_name}.`,
        },
        actor
      );
      trackEvent("shipment.rebook_from_history", {
        role: "client",
        shipmentId: created.id,
        carrier: item.carrier_name,
      });
      setCreatedMatchResult({ shipmentId: created.id, matches: created.dispatch_matches });
      setCreateStep("matches");
      setActiveTab("create");
      setCarrierDetail(null);
      setMessage(`New shipment request sent with preferred carrier ${item.carrier_name}.`);
      await loadShipments();
      await loadCarrierHistory();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to rebook carrier from history.");
    } finally {
      setRebookingCarrier(null);
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
      };
      if (addressChanged) {
        payload.address = normalizedAddress;
        payload.address_place_id = streetPlaceId || cityPlaceId || undefined;
      }

      const updated = await updateUserProfile(session.email, "client", payload);
      setProfile(updated);
      setStreetPlaceId(null);
      setCityPlaceId(null);

      const refreshedSession = setAuthLiteSession("client", updated.display_name, updated.email);
      setSession(refreshedSession);
      setMessage("Profile updated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to update profile.");
    } finally {
      setProfileSaving(false);
    }
  }

  const sideMatches = useMemo(
    () =>
      [...(createdMatchResult?.matches || [])].sort(
        (a, b) => b.score - a.score || b.available_trucks - a.available_trucks || a.distance_km - b.distance_km
      ),
    [createdMatchResult]
  );

  if (!ready) {
    return null;
  }

  return (
    <main className="shipper-portal-shell min-h-screen px-4 py-6 text-slate-900 md:px-8 md:py-10">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8">
        <header className="shipper-hero-card shipper-fade-up rounded-[36px] bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.18),_transparent_24%),linear-gradient(135deg,#0b1220_0%,#1a1745_46%,#0b5f59_100%)] p-8 text-white md:p-10">
          <div className="relative z-10 grid gap-8 xl:grid-cols-[1.35fr_0.85fr] xl:items-start">
            <div>
              <div className="inline-flex rounded-full border border-white/15 bg-white/10 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.28em] text-cyan-100">
                Shipper workspace
              </div>
              <h1 className="mt-5 max-w-4xl text-4xl font-semibold tracking-[-0.03em] text-white md:text-5xl">
                Dispatch, pay, and track freight from one polished command center.
              </h1>
              <p className="mt-4 max-w-3xl text-base leading-7 text-slate-200 md:text-lg">
                Access the LynkXpress network to create shipment requests, compare carrier offers, release payments, and monitor live movement with a dashboard that feels client-ready instead of back-office.
              </p>
              <div className="mt-6 flex flex-wrap gap-3 text-sm text-white/90">
                <div className="rounded-full border border-white/12 bg-white/10 px-4 py-2">{profile?.company_name || session?.displayName || "LynkXpress shipper account"}</div>
                <div className="rounded-full border border-white/12 bg-white/10 px-4 py-2">{dashboardStats.total} total shipments</div>
                <div className="rounded-full border border-white/12 bg-white/10 px-4 py-2">{formatUsdCompact(dashboardRevenue)} quoted volume</div>
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
                    <div className="absolute right-0 top-14 z-20 w-56 rounded-2xl border border-indigo-200/60 bg-white p-2 text-slate-900 shadow-2xl shadow-slate-900/20">
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
                <Link className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-900 transition hover:bg-cyan-50" href="/">
                  Home
                </Link>
              </div>

              <div className="grid w-full gap-4 sm:grid-cols-2 xl:w-[360px]">
                <div className="rounded-[28px] border border-white/12 bg-white/10 p-5 backdrop-blur-sm">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-100/80">Profile readiness</p>
                  <p className="mt-3 text-3xl font-semibold">{profileCompletion}%</p>
                  <p className="mt-2 text-sm leading-6 text-slate-200">Your shipper profile, routing details, and billing footprint are visible at a glance.</p>
                </div>
                <div className="rounded-[28px] border border-white/12 bg-white/10 p-5 backdrop-blur-sm">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-emerald-100/80">Delivered value</p>
                  <p className="mt-3 text-3xl font-semibold">{formatUsdCompact(deliveredRevenue)}</p>
                  <p className="mt-2 text-sm leading-6 text-slate-200">Completed shipment spend that has already moved through the platform.</p>
                </div>
              </div>
            </div>
          </div>
        </header>

        {message && <p className="shipper-premium-card shipper-fade-up rounded-[24px] border border-cyan-200 bg-cyan-50/90 px-5 py-4 text-sm font-medium text-cyan-950">{message}</p>}

        <section className="shipper-premium-card shipper-fade-up rounded-[30px] p-4 md:p-5">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setActiveTab("dashboard")}
              className={`shipper-tab-pill rounded-full px-4 py-2.5 text-sm font-semibold transition ${
                activeTab === "dashboard"
                  ? "bg-slate-950 text-white shadow-lg shadow-slate-900/15"
                  : "border border-slate-300/80 bg-white/90 text-slate-700 hover:bg-slate-100"
              }`}
            >
              Dashboard
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("metrics")}
              className={`shipper-tab-pill rounded-full px-4 py-2.5 text-sm font-semibold transition ${
                activeTab === "metrics"
                  ? "bg-slate-950 text-white shadow-lg shadow-slate-900/15"
                  : "border border-slate-300/80 bg-white/90 text-slate-700 hover:bg-slate-100"
              }`}
            >
              Metrics
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("tracking")}
              className={`shipper-tab-pill rounded-full px-4 py-2.5 text-sm font-semibold transition ${
                activeTab === "tracking"
                  ? "bg-slate-950 text-white shadow-lg shadow-slate-900/15"
                  : "border border-slate-300/80 bg-white/90 text-slate-700 hover:bg-slate-100"
              }`}
            >
              Tracking
            </button>
            <button
              type="button"
              onClick={() => { setActiveTab("create"); setCreateStep("form"); setCreatedMatchResult(null); setCarrierDetail(null); }}
              className={`shipper-tab-pill rounded-full px-4 py-2.5 text-sm font-semibold transition ${
                activeTab === "create"
                  ? "bg-slate-950 text-white shadow-lg shadow-slate-900/15"
                  : "border border-slate-300/80 bg-white/90 text-slate-700 hover:bg-slate-100"
              }`}
            >
              Create Shipment
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("carrier_history")}
              className={`shipper-tab-pill rounded-full px-4 py-2.5 text-sm font-semibold transition ${
                activeTab === "carrier_history"
                  ? "bg-slate-950 text-white shadow-lg shadow-slate-900/15"
                  : "border border-slate-300/80 bg-white/90 text-slate-700 hover:bg-slate-100"
              }`}
            >
              Carrier History & Rebook
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("transactions")}
              className={`shipper-tab-pill rounded-full px-4 py-2.5 text-sm font-semibold transition ${
                activeTab === "transactions"
                  ? "bg-slate-950 text-white shadow-lg shadow-slate-900/15"
                  : "border border-slate-300/80 bg-white/90 text-slate-700 hover:bg-slate-100"
              }`}
            >
              Transaction History
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("documents")}
              className={`shipper-tab-pill rounded-full px-4 py-2.5 text-sm font-semibold transition ${
                activeTab === "documents"
                  ? "bg-slate-950 text-white shadow-lg shadow-slate-900/15"
                  : "border border-slate-300/80 bg-white/90 text-slate-700 hover:bg-slate-100"
              }`}
            >
              My Documents
            </button>
          </div>
        </section>

        {!isSubscriptionActive && (
          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-6 shadow-sm">
            <h2 className="text-xl font-semibold text-amber-900">Subscription Required</h2>
            <p className="mt-2 text-sm text-amber-800">
              A shipper subscription is required before using platform features.
            </p>
            <div className="mt-4 rounded-xl border border-amber-300 bg-white p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Plan</p>
              <p className="mt-1 text-lg font-semibold text-slate-900">{shipperPlan?.name || "Shipper"} - ${shipperPlan?.price_usd.toFixed(2) || "25.00"}/month</p>
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
                {checkoutLoading ? "Opening secure checkout..." : "Subscribe for $25.00"}
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

        {embeddedCheckout && (
          <StripeEmbeddedCheckout
            clientSecret={embeddedCheckout.clientSecret}
            publishableKey={STRIPE_PUBLISHABLE_KEY}
            title={embeddedCheckout.title}
            onClose={() => setEmbeddedCheckout(null)}
          />
        )}

        {activeTab === "subscription" && (
          <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
            <h2 className="text-xl font-semibold">Subscription</h2>
            <p className="mt-1 text-sm text-slate-600">Manage your shipper plan access.</p>
            <div className="mt-4 rounded-lg border border-slate-200 p-4 text-sm space-y-1">
              <p><span className="font-semibold">Plan:</span> {shipperPlan?.name || "Shipper"}</p>
              <p><span className="font-semibold">Price:</span> ${shipperPlan?.price_usd.toFixed(2) || "25.00"}/month</p>
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
                  onClick={() => void cancelClientSubscription()}
                  disabled={subscriptionActionLoading !== null}
                  className="rounded-lg border border-rose-300 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-60"
                >
                  {subscriptionActionLoading === "cancel" ? "Canceling..." : "Cancel Subscription"}
                </button>
              )}
              {isSubscriptionActive && subscriptionStatus?.subscription_cancel_at_period_end && (
                <button
                  type="button"
                  onClick={() => void resumeClientSubscription()}
                  disabled={subscriptionActionLoading !== null}
                  className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-60"
                >
                  {subscriptionActionLoading === "resume" ? "Resuming..." : "Resume Subscription"}
                </button>
              )}
            </div>
          </section>
        )}

        {!isSubscriptionActive && activeTab !== "subscription" && null}

        {isSubscriptionActive && (activeTab === "dashboard" || activeTab === "tracking") && (
          <section className="space-y-6">
            {activeTab === "dashboard" && (
              <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
                <div className="space-y-6 shipper-fade-up">
                  <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                    <DashboardStatCard
                      label="Total"
                      value={dashboardStats.total}
                      detail="Loads created across your active shipper account."
                      accentClass="bg-slate-950 text-white"
                      progressClass="bg-gradient-to-r from-slate-700 via-slate-900 to-black"
                      progress={dashboardStats.total === 0 ? 10 : 100}
                    />
                    <DashboardStatCard
                      label="Awaiting Payment"
                      value={dashboardStats.awaitingPayment}
                      detail="Quotes accepted and waiting for confirmed funds."
                      accentClass="bg-amber-50 text-amber-700"
                      progressClass="bg-gradient-to-r from-amber-400 to-orange-500"
                      progress={dashboardMix[0]?.percent || 10}
                    />
                    <DashboardStatCard
                      label="Active"
                      value={dashboardStats.active}
                      detail="Shipments currently in motion or in active execution."
                      accentClass="bg-sky-50 text-sky-700"
                      progressClass="bg-gradient-to-r from-cyan-400 to-sky-500"
                      progress={dashboardMix[1]?.percent || 10}
                    />
                    <DashboardStatCard
                      label="Delivered"
                      value={dashboardStats.delivered}
                      detail="Completed freight with payment and delivery history."
                      accentClass="bg-emerald-50 text-emerald-700"
                      progressClass="bg-gradient-to-r from-emerald-400 to-teal-500"
                      progress={dashboardMix[2]?.percent || 10}
                    />
                  </section>

                  <article className="shipper-premium-card shipper-card-hover rounded-[30px] p-6 md:p-7">
                    <div className="relative z-10 flex flex-wrap items-start justify-between gap-6">
                      <div className="max-w-2xl">
                        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">Operations overview</p>
                        <h2 className="mt-3 text-2xl font-semibold tracking-[-0.03em] text-slate-950 md:text-[2rem]">Your freight portfolio feels active, not administrative.</h2>
                        <p className="mt-3 text-sm leading-7 text-slate-600 md:text-base">
                          Surface payment risk, route momentum, and delivery throughput in one view so every shipment state feels intentional.
                        </p>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="rounded-[24px] border border-slate-200 bg-white/80 px-4 py-4 shadow-sm">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Quoted volume</p>
                          <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">{formatUsdCompact(dashboardRevenue)}</p>
                        </div>
                        <div className="rounded-[24px] border border-slate-200 bg-white/80 px-4 py-4 shadow-sm">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Delivered value</p>
                          <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">{formatUsdCompact(deliveredRevenue)}</p>
                        </div>
                      </div>
                    </div>
                  </article>

                </div>

                <aside className="shipper-fade-up space-y-6">
                  <ShipperActivityChart labels={shipmentActivityChart.labels} values={shipmentActivityChart.values} />
                  <div className="shipper-premium-card shipper-card-hover rounded-[30px] p-6">
                    <div className="relative z-10">
                      <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">Shipment mix</p>
                      <div className="mt-5 space-y-4">
                        {dashboardMix.map((item) => (
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
            )}

            <article className="shipper-premium-card shipper-fade-up rounded-[30px] p-6 md:p-7">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">Shipment ledger</p>
                  <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-slate-950">{activeTab === "tracking" ? "Shipment Tracking" : "My Shipments"}</h2>
                </div>
                <div className="flex items-center gap-2">
                  {activeTab === "tracking" && (
                    <select
                      value={selectedTrackingRow?.shipment_id || ""}
                      onChange={(event) => setSelectedTrackingShipmentId(event.target.value)}
                      className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 shadow-sm"
                    >
                      {liveTrackingRows.length === 0 && <option value="">No tracked shipments</option>}
                      {liveTrackingRows.map((row) => (
                        <option key={row.shipment_id} value={row.shipment_id}>
                          {row.shipment_origin} to {row.shipment_destination} ({row.driver_name})
                        </option>
                      ))}
                    </select>
                  )}
                  {activeTab === "tracking" && (
                    <button
                      onClick={() => void loadLiveTracking()}
                      className="rounded-full border border-indigo-300 px-4 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-50"
                    >
                      {trackingLoading ? "Tracking..." : "Refresh Tracking"}
                    </button>
                  )}
                  <button
                    onClick={() => void loadShipments()}
                    className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    {loading ? "Refreshing..." : "Refresh"}
                  </button>
                </div>
              </div>

              <div className="mt-5 space-y-4">
                {myShipments.length === 0 && (
                  <p className="rounded-[24px] border border-dashed border-slate-300 bg-white/70 p-8 text-center text-sm text-slate-500">
                    No shipments found yet.
                  </p>
                )}

                {activeTab === "tracking" && liveTrackingRows.length === 0 && myShipments.length > 0 && (
                  <p className="rounded-[24px] border border-dashed border-slate-300 bg-white/70 p-8 text-center text-sm text-slate-500">
                    No live tracking updates available for your shipments yet.
                  </p>
                )}

                {myShipments
                  .filter((shipment) => activeTab !== "tracking" || !selectedTrackingRow || shipment.id === selectedTrackingRow.shipment_id)
                  .map((shipment) => (
                  <div key={shipment.id} className="shipper-premium-card shipper-card-hover rounded-[28px] p-5 md:p-6">
                    <div className="relative z-10">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">{shipment.load_number}</p>
                        <h3 className="mt-2 text-lg font-semibold tracking-[-0.02em] text-slate-950 md:text-xl">
                          {shipment.origin} to {shipment.destination}
                        </h3>
                        <p className="mt-2 text-sm leading-6 text-slate-600">
                          {shipment.cargo_type} • {toLbFromKg(shipment.weight_kg).toLocaleString()} lb ({shipment.weight_kg.toLocaleString()} kg) • {shipment.time_window}
                        </p>
                      </div>
                      <span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${shipmentStatusBadgeClass(shipment.status)}`}>
                        {statusLabel[shipment.status]}
                      </span>
                      </div>

                      {(shipment.carrier_offer_amount !== null || shipment.quote_breakdown) && (
                        <div className="mt-5 rounded-[22px] border border-amber-200/70 bg-[linear-gradient(180deg,rgba(255,251,235,0.95),rgba(254,243,199,0.55))] p-4 text-sm text-amber-950">
                        <p className="font-semibold">
                          Carrier Offer: ${pendingQuoteAmount(shipment)?.toFixed(2) ?? "0.00"}
                        </p>
                        <p>Quote status: {shipment.quote_status}</p>
                        {shipment.quote_breakdown && (
                          <>
                            <p>
                              Official Quote: ${shipment.quote_breakdown.total_usd.toFixed(2)} • ETA {shipment.quote_breakdown.estimated_delivery_time}
                            </p>
                            <p>
                              Base ${shipment.quote_breakdown.base_freight_usd.toFixed(2)} • Urgency ${shipment.quote_breakdown.urgency_surcharge_usd.toFixed(2)} • Distance ${shipment.quote_breakdown.distance_surcharge_usd.toFixed(2)}
                            </p>
                          </>
                        )}
                        </div>
                      )}

                      {shipment.quote_status === "pending" && shipment.carrier_offer_amount !== null && (
                        <button
                          type="button"
                          onClick={() => void onAcceptQuote(shipment.id)}
                          className="mt-4 rounded-full bg-indigo-700 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-600"
                        >
                          Accept Quote
                        </button>
                      )}

                      {shipment.quote_status === "accepted" && shipment.payment_status !== "paid" && (
                        <button
                          type="button"
                          onClick={() => void onConfirmAndPay(shipment.id)}
                          disabled={shipmentCheckoutLoadingId === shipment.id}
                          className="mt-4 rounded-full bg-emerald-700 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-600"
                        >
                          {shipmentCheckoutLoadingId === shipment.id ? "Opening secure checkout..." : "Pay Now"}
                        </button>
                      )}

                      {shipment.payment_status === "paid" && shipment.status === "delivered" && shipment.pod_status === "carrier_confirmed" && shipment.payout_status !== "released" && (
                        <button
                          type="button"
                          onClick={() => void onReleasePayment(shipment.id)}
                          disabled={releasePaymentLoadingId === shipment.id}
                          className="mt-4 rounded-full bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                        >
                          {releasePaymentLoadingId === shipment.id ? "Releasing..." : "Complete Review and Release Now"}
                        </button>
                      )}

                    {shipment.payment_status === "paid" && shipment.status === "delivered" && shipment.pod_status === "pending" && (
                      <p className="mt-3 text-xs font-semibold text-amber-700">Waiting for driver POD upload before payment release.</p>
                    )}

                    {shipment.payment_status === "paid" && shipment.status === "delivered" && shipment.pod_status === "uploaded" && shipment.payout_status !== "released" && (
                      <p className="mt-3 text-xs font-semibold text-amber-700">Waiting for carrier POD confirmation before shipper review.</p>
                    )}

                    {shipment.payment_status === "paid" && shipment.status === "delivered" && shipment.pod_status === "carrier_confirmed" && shipment.payout_status !== "released" && (
                      <p className="mt-3 text-xs font-semibold text-indigo-700">
                        Review window active.
                        {shipment.payout_release_eligible_at ? ` Auto-release at ${new Date(shipment.payout_release_eligible_at).toLocaleString()}.` : ""}
                      </p>
                    )}

                      <div className="mt-5 grid gap-3 rounded-[22px] bg-slate-50/90 p-4 text-xs text-slate-500 sm:grid-cols-2 lg:grid-cols-4">
                      <p>POD Status: <span className="font-semibold text-slate-700">{podStatusLabel(shipment.pod_status)}</span></p>
                      <p>Payout: <span className="font-semibold text-slate-700">{payoutStatusLabel(shipment.payout_status)}</span></p>
                        <p>Payment: <span className="font-semibold text-slate-700">{shipment.payment_status}</span></p>
                        <p>Carrier: <span className="font-semibold text-slate-700">{shipment.carrier_name || "Awaiting acceptance"}</span></p>
                      </div>

                      <div className="mt-4 text-xs text-slate-500">
                      Carrier: {shipment.carrier_name || "Awaiting carrier acceptance"}
                      {shipment.estimated_arrival ? ` • ETA ${new Date(shipment.estimated_arrival).toLocaleString()}` : ""}
                      </div>

                      {activeTab === "tracking" && (() => {
                      const tracking = liveTrackingByShipmentId[shipment.id];
                      if (!tracking) {
                        return null;
                      }

                      return (
                        <div className="mt-3 rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-xs text-indigo-900">
                          <p className="font-semibold uppercase tracking-wide">Shipment Status</p>
                          <p className="mt-1">Driver: {tracking.driver_name}</p>
                          <div className="mt-2 grid gap-3 lg:grid-cols-[1fr_220px]">
                            <div>
                              <p className="text-[11px] font-semibold uppercase tracking-wide text-indigo-700">Current Location</p>
                              <p>{tracking.current_location_label || "Location unavailable"}</p>
                              <p className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-indigo-700">Last Updated</p>
                              <p>
                                {tracking.last_update_at
                                  ? new Date(tracking.last_update_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
                                  : "Pending"}
                              </p>
                              <p>Estimated Arrival: {tracking.eta_arrival_at ? new Date(tracking.eta_arrival_at).toLocaleTimeString() : "Pending"}</p>
                              <p>Distance Remaining: {formatRemainingDistance(tracking.distance_remaining_km)}</p>
                              <p className={tracking.tracking_status === "Live" ? "font-semibold text-emerald-700" : "font-semibold text-amber-700"}>
                                Tracking Status: {tracking.tracking_status}
                              </p>
                            </div>
                            <div className="overflow-hidden rounded-md border border-indigo-200 bg-white">
                              <LiveTrackingMap
                                currentLatitude={tracking.current_latitude}
                                currentLongitude={tracking.current_longitude}
                                history={tracking.history}
                                heightClassName="h-36"
                              />
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => setSelectedTransitShipmentId(tracking.shipment_id)}
                            className="mt-3 rounded-md border border-indigo-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
                          >
                            View Transit
                          </button>
                        </div>
                      );
                      })()}
                    </div>
                  </div>
                ))}
              </div>
            </article>

            {activeTab === "tracking" && selectedTransitShipmentId && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
                <div className="max-h-[92vh] w-full max-w-6xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
                  <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-4">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-slate-500">Live Transit</p>
                      <p className="mt-1 text-sm text-slate-700">
                        {selectedTransitTracking
                          ? `${selectedTransitTracking.shipment_origin} to ${selectedTransitTracking.shipment_destination}`
                          : "Tracking data is no longer available for this shipment."}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void loadLiveTracking()}
                        className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                      >
                        {trackingLoading ? "Refreshing..." : "Refresh"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedTransitShipmentId(null)}
                        className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                      >
                        Close
                      </button>
                    </div>
                  </div>

                  {!selectedTransitTracking && (
                    <p className="mt-4 rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
                      No live tracking available yet for this shipment.
                    </p>
                  )}

                  {selectedTransitTracking && (
                    <div className="mt-5 grid gap-5 xl:grid-cols-[2fr_1fr]">
                      <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
                        <LiveTrackingMap
                          currentLatitude={selectedTransitTracking.current_latitude}
                          currentLongitude={selectedTransitTracking.current_longitude}
                          history={selectedTransitTracking.history}
                          heightClassName="h-[460px]"
                        />
                      </div>

                      <div className="space-y-4">
                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                          <p className="text-xs uppercase tracking-wide text-slate-500">Shipment Status</p>
                          <p className="mt-1 font-semibold text-slate-900">Driver: {selectedTransitTracking.driver_name}</p>
                          <div className="mt-3 space-y-2">
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Current Location</p>
                              <p>{selectedTransitTracking.current_location_label || "Location unavailable"}</p>
                            </div>
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Last Updated</p>
                              <p>
                                {selectedTransitTracking.last_update_at
                                  ? new Date(selectedTransitTracking.last_update_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
                                  : "Pending"}
                              </p>
                            </div>
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Estimated Arrival</p>
                              <p>{selectedTransitTracking.eta_arrival_at ? new Date(selectedTransitTracking.eta_arrival_at).toLocaleTimeString() : "Pending"}</p>
                            </div>
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Distance Remaining</p>
                              <p>{formatRemainingDistance(selectedTransitTracking.distance_remaining_km)}</p>
                            </div>
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Tracking Status</p>
                              <p className={selectedTransitTracking.tracking_status === "Live" ? "text-emerald-700 font-semibold" : "text-amber-700 font-semibold"}>
                                {selectedTransitTracking.tracking_status}
                              </p>
                            </div>
                          </div>
                          {selectedTransitTracking.maps_directions_url && (
                            <a
                              href={selectedTransitTracking.maps_directions_url}
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
                            {selectedTransitTracking.history.length === 0 && (
                              <p className="text-xs text-slate-500">No GPS ping history yet.</p>
                            )}
                            {selectedTransitTracking.history.map((point) => (
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
                  )}
                </div>
              </div>
            )}
          </section>
        )}

        {activeTab === "profile" && (
          <section className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
            <article className="shipper-premium-card shipper-fade-up rounded-[30px] p-6 md:p-7">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">Account profile</p>
                  <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-slate-950">Make your shipper identity feel enterprise-ready.</h2>
                </div>
                <button
                  onClick={() => void saveProfile()}
                  disabled={profileSaving || !session?.email}
                  className="rounded-full bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  {profileSaving ? "Saving..." : "Save Profile"}
                </button>
              </div>
              <p className="mt-3 text-sm leading-7 text-slate-600">
                {profile ? `Last updated ${new Date(profile.updated_at).toLocaleString()}` : "Load your profile to edit account details."}
              </p>
              <div className="mt-6 grid gap-4 md:grid-cols-2">
              <input
                value={profileForm.full_name}
                onChange={(event) => setProfileForm((prev) => ({ ...prev, full_name: event.target.value }))}
                placeholder="Full name"
                className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 outline-none focus:border-indigo-700"
              />
              <input
                value={profileForm.company_name}
                onChange={(event) => setProfileForm((prev) => ({ ...prev, company_name: event.target.value }))}
                placeholder="Company name"
                className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 outline-none focus:border-indigo-700"
              />
              <input
                value={profileForm.phone}
                onChange={(event) => setProfileForm((prev) => ({ ...prev, phone: event.target.value }))}
                placeholder="Phone"
                className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 outline-none focus:border-indigo-700"
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
                  className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 outline-none focus:border-indigo-700"
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
                  className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 outline-none focus:border-indigo-700"
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
                className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 outline-none focus:border-indigo-700"
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
                className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 outline-none focus:border-indigo-700"
              />
              <select
                value={profileForm.country}
                onChange={(event) => {
                  setStreetPlaceId(null);
                  setCityPlaceId(null);
                  setProfileForm((prev) => ({ ...prev, country: event.target.value }));
                }}
                className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 outline-none focus:border-indigo-700"
              >
                <option value="US">US</option>
              </select>
              <textarea
                value={profileForm.bio}
                onChange={(event) => setProfileForm((prev) => ({ ...prev, bio: event.target.value }))}
                placeholder="Short company bio"
                rows={3}
                className="md:col-span-2 w-full rounded-[24px] border border-slate-300 bg-white px-4 py-3 outline-none focus:border-indigo-700"
              />
              </div>
            </article>

            <aside className="shipper-fade-up space-y-6">
              <div className="shipper-premium-card shipper-card-hover rounded-[30px] p-6">
                <div className="relative z-10">
                  <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">Identity snapshot</p>
                  <div className="mt-4 rounded-[26px] bg-slate-950 p-5 text-white shadow-[0_18px_45px_rgba(15,23,42,0.28)]">
                    <p className="text-[11px] uppercase tracking-[0.24em] text-cyan-200/80">Profile completion</p>
                    <p className="mt-2 text-4xl font-semibold tracking-tight">{profileCompletion}%</p>
                    <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/15">
                      <div className="h-full rounded-full bg-gradient-to-r from-cyan-300 to-indigo-400" style={{ width: `${Math.max(12, profileCompletion)}%` }} />
                    </div>
                    <p className="mt-4 text-sm leading-6 text-slate-300">Complete identity, location, and billing details so carrier conversations and checkout flows feel frictionless.</p>
                  </div>
                  <div className="mt-5 grid gap-3 text-sm text-slate-600">
                    <div className="rounded-[22px] border border-slate-200 bg-white/80 px-4 py-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Primary contact</p>
                      <p className="mt-2 font-semibold text-slate-950">{profileForm.full_name || "Not set"}</p>
                    </div>
                    <div className="rounded-[22px] border border-slate-200 bg-white/80 px-4 py-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Company</p>
                      <p className="mt-2 font-semibold text-slate-950">{profileForm.company_name || "Not set"}</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="shipper-premium-card shipper-card-hover rounded-[30px] p-6">
                <div className="relative z-10">
                  <h3 className="text-lg font-semibold tracking-[-0.02em] text-slate-950">Stripe Wallet</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    Link a card or bank account for faster quote payments and checkout confirmation.
                  </p>
                  <div className="mt-5 grid gap-3 text-sm text-slate-600 sm:grid-cols-2">
                    <div className="rounded-[22px] border border-slate-200 bg-white/80 px-4 py-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Card</p>
                      <p className="mt-2 font-semibold text-slate-950">
                        {paymentMethodStatus?.has_card ? "Linked" : "Not linked"}
                        {paymentMethodStatus?.card_last4 ? ` •••• ${paymentMethodStatus.card_last4}` : ""}
                      </p>
                    </div>
                    <div className="rounded-[22px] border border-slate-200 bg-white/80 px-4 py-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Bank account</p>
                      <p className="mt-2 font-semibold text-slate-950">{paymentMethodStatus?.has_bank_account ? "Linked" : "Not linked"}</p>
                    </div>
                  </div>
                  <div className="mt-5 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void startWalletSetup("card")}
                  disabled={walletSetupLoading !== null || walletRemoveLoading}
                  className="rounded-full border border-indigo-300 bg-white px-4 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-60"
                >
                  {walletSetupLoading === "card" ? "Opening Stripe..." : "Link Card"}
                </button>
                <button
                  type="button"
                  onClick={() => void removeLinkedCard()}
                  disabled={walletRemoveLoading || !paymentMethodStatus?.has_card || walletSetupLoading !== null}
                  className="rounded-full border border-rose-300 bg-white px-4 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60"
                >
                  {walletRemoveLoading ? "Removing Card..." : "Remove Card"}
                </button>
                <button
                  type="button"
                  onClick={() => void startWalletSetup("bank_account")}
                  disabled={walletSetupLoading !== null || walletRemoveLoading}
                  className="rounded-full border border-indigo-300 bg-white px-4 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-60"
                >
                  {walletSetupLoading === "bank_account" ? "Opening Stripe..." : "Link Bank Account"}
                </button>
                <button
                  type="button"
                  onClick={() => void loadSubscriptionState(true)}
                  disabled={subscriptionLoading}
                  className="rounded-full border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                >
                  Refresh Wallet Status
                </button>
                  </div>
                </div>
              </div>
            </aside>
          </section>
        )}

        {isSubscriptionActive && activeTab === "metrics" && (
          <section className="space-y-6">
            <div className="shipper-premium-card shipper-fade-up rounded-[30px] p-6 md:p-7">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">Performance metrics</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-slate-950">This month performance snapshot</h2>
            </div>

            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <div className="shipper-premium-card shipper-card-hover rounded-[24px] p-5 text-center">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Total spend this month</p>
                <p className="mt-3 text-3xl font-bold tracking-tight text-slate-950">{formatUsdCompact(shipperAnalytics.totalSpendThisMonth)}</p>
                <p className="mt-2 text-xs text-slate-600">Sum of all quoted shipments</p>
              </div>
              <div className="shipper-premium-card shipper-card-hover rounded-[24px] p-5 text-center">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Loads completed</p>
                <p className="mt-3 text-3xl font-bold tracking-tight text-emerald-600">{shipperAnalytics.loadsCompletedThisMonth}</p>
                <p className="mt-2 text-xs text-slate-600">Delivered this month</p>
              </div>
              <div className="shipper-premium-card shipper-card-hover rounded-[24px] p-5 text-center">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Avg transit time</p>
                <p className="mt-3 text-3xl font-bold tracking-tight text-sky-600">{Math.round(shipperAnalytics.avgTransitHours)}h</p>
                <p className="mt-2 text-xs text-slate-600">Hours per shipment</p>
              </div>
              <div className="shipper-premium-card shipper-card-hover rounded-[24px] p-5 text-center">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Avg cost per mile</p>
                <p className="mt-3 text-3xl font-bold tracking-tight text-amber-600">${shipperAnalytics.avgCostPerMile.toFixed(2)}</p>
                <p className="mt-2 text-xs text-slate-600">Cost efficiency metric</p>
              </div>
            </section>
          </section>
        )}

        {isSubscriptionActive && activeTab === "create" && createStep === "form" && (
          <section className="mx-auto w-full max-w-2xl">
            <article className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
              <h2 className="text-xl font-semibold">Create Shipment Request</h2>
              <p className="mt-1 text-xs text-slate-500">Fill in shipment details and dispatch to see matched carriers.</p>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void submitShipment();
                }}
                className="mt-5 space-y-4"
              >
                <AddressAutocompleteInput
                  value={formData.origin}
                  placeId={originPlaceId}
                  onValueChange={(next) => updateShipmentField("origin", next)}
                  onPlaceIdChange={setOriginPlaceId}
                  placeholder="Pickup location"
                  inputClassName="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-indigo-700"
                />
                <AddressAutocompleteInput
                  value={formData.destination}
                  placeId={destinationPlaceId}
                  onValueChange={(next) => updateShipmentField("destination", next)}
                  onPlaceIdChange={setDestinationPlaceId}
                  placeholder="Delivery location"
                  inputClassName="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-indigo-700"
                />
                <div className="grid grid-cols-2 gap-3">
                  <select
                    required
                    value={formData.cargo_type}
                    onChange={(event) => updateShipmentField("cargo_type", event.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-indigo-700"
                  >
                    <option value="">Select cargo type</option>
                    {cargoTypeOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                  <div className="relative">
                    <input
                      required
                      type="number"
                      min={1}
                      value={formData.weight_lb}
                      onChange={(event) => updateShipmentField("weight_lb", event.target.value)}
                      placeholder="Weight (lb)"
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 pr-12 outline-none focus:border-indigo-700"
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-500">
                      lb
                    </span>
                    <p className="mt-1 text-[11px] text-slate-500">
                      ~ {Number(formData.weight_lb) > 0 ? toKgFromLbRounded(Number(formData.weight_lb)).toLocaleString() : "0"} kg
                    </p>
                  </div>
                </div>
                <input
                  required
                  value={formData.time_window}
                  onChange={(event) => updateShipmentField("time_window", event.target.value)}
                  placeholder="Time window (e.g. Today 9:00 AM - 3:00 PM)"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-indigo-700"
                />
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <div className="rounded-lg border border-slate-300 bg-white p-2">
                      <p className="mb-2 text-xs font-medium text-slate-700">Truck types (optional)</p>
                      <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                        {truckTypeOptions.map((option) => (
                          <label key={option.value} className="flex items-center gap-2 rounded px-2 py-1 hover:bg-slate-50">
                            <input
                              type="checkbox"
                              checked={formData.vehicle_needs.includes(option.value)}
                              onChange={() => toggleVehicleNeed(option.value)}
                              className="h-4 w-4 rounded border-slate-300 text-indigo-700 focus:ring-indigo-700"
                            />
                            <span className="text-sm text-slate-700">{option.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                    <p className="text-xs text-slate-500">Select one or more truck types.</p>
                  </div>
                  <select
                    value={formData.urgency}
                    onChange={(event) => updateShipmentField("urgency", event.target.value as "low" | "normal" | "high")}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-indigo-700"
                  >
                    <option value="low">Low urgency</option>
                    <option value="normal">Normal urgency</option>
                    <option value="high">High urgency</option>
                  </select>
                </div>

                <button
                  type="submit"
                  className="w-full rounded-lg bg-indigo-700 px-4 py-3 text-sm font-semibold text-white hover:bg-indigo-600"
                >
                  Create Shipment & Dispatch Job Offers
                </button>
              </form>
            </article>
          </section>
        )}

        {isSubscriptionActive && activeTab === "create" && createStep === "matches" && createdMatchResult && (
          <section className="space-y-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">Matched Carriers</h2>
                <p className="mt-1 text-sm text-slate-500">
                  {sideMatches.length} carriers matched and ranked by score for your shipment.
                </p>
              </div>
              <button
                type="button"
                onClick={() => { setCreateStep("form"); setCreatedMatchResult(null); setCarrierDetail(null); }}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
              >
                ← New Shipment
              </button>
            </div>

            <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
              <div className="space-y-3">
                {sideMatches.map((match, index) => {
                  const isSelectedCarrier = carrierDetail?.carrier_id === match.carrier_id;
                  const matchCardClass = isSelectedCarrier
                    ? "rounded-xl border border-indigo-400 bg-indigo-50/50 p-4"
                    : "rounded-xl border border-slate-200 bg-white p-4";

                  return (
                  <div
                    key={match.carrier_id}
                    className={matchCardClass}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-slate-900">{match.carrier_name}</p>
                        {index === 0 && (
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                            Best Match
                          </span>
                        )}
                      </div>
                      <p className="text-sm font-semibold text-indigo-700">{match.score}/99</p>
                    </div>
                    <div className="mt-2 h-2 w-full rounded-full bg-slate-200">
                      <div
                        className="h-2 rounded-full bg-indigo-600"
                        style={{ width: `${Math.max(4, Math.min(100, match.score))}%` }}
                      />
                    </div>
                    <p className="mt-2 text-xs text-slate-500">
                      {match.distance_km.toFixed(1)} km away • ETA {match.eta_minutes} min • {match.available_trucks} trucks available • {match.vehicle_fit}
                    </p>
                    <p className="mt-1 text-[11px] text-slate-400">
                      Distance source: {distanceSourceLabel(match.distance_source)}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void onViewCarrier(match)}
                        className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                      >
                        View Carrier
                      </button>
                      <button
                        type="button"
                        onClick={() => void onSendInvite(match)}
                        disabled={inviteSendingCarrierId === match.carrier_id}
                        className="rounded-md bg-indigo-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-600 disabled:opacity-50"
                      >
                        {inviteSendingCarrierId === match.carrier_id ? "Sending Offer..." : "Send Offer"}
                      </button>
                      {match.maps_directions_url && (
                        <a
                          href={match.maps_directions_url}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-md border border-indigo-300 px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-50"
                        >
                          Open Map
                        </a>
                      )}
                    </div>
                  </div>
                  );
                })}
              </div>

              <aside className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                {carrierDetailLoading && (
                  <p className="text-sm text-cyan-700">Loading carrier profile...</p>
                )}
                {!carrierDetailLoading && !carrierDetail && (
                  <div className="flex h-full flex-col items-center justify-center gap-2 py-12 text-center">
                    <p className="text-sm font-semibold text-slate-700">Carrier Details</p>
                    <p className="text-xs text-slate-400">Click &quot;View Carrier&quot; on any match to see full profile details here.</p>
                  </div>
                )}
                {!carrierDetailLoading && carrierDetail && (
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h3 className="font-semibold text-slate-900">{carrierDetail.carrier_name}</h3>
                        <p className="text-xs text-slate-500">{carrierDetail.company_name}</p>
                      </div>
                      <span className="rounded-full bg-indigo-100 px-2 py-1 text-xs font-semibold text-indigo-700">
                        ★ {carrierDetail.rating.toFixed(1)}
                      </span>
                    </div>
                    <div className="mt-4 space-y-2 text-sm">
                      <div className="flex justify-between border-b border-slate-100 pb-2">
                        <span className="text-slate-500">Trucks available</span>
                        <span className="font-semibold">{carrierDetail.available_trucks}</span>
                      </div>
                      <div className="flex justify-between border-b border-slate-100 pb-2">
                        <span className="text-slate-500">Vehicle types</span>
                        <span className="font-semibold text-right max-w-[180px]">{carrierDetail.vehicle_types.join(", ") || "Not set"}</span>
                      </div>
                      <div className="flex justify-between border-b border-slate-100 pb-2">
                        <span className="text-slate-500">Base location</span>
                        <span className="font-semibold text-right max-w-[180px]">{carrierDetail.base_location}</span>
                      </div>
                      <div className="flex justify-between border-b border-slate-100 pb-2">
                        <span className="text-slate-500">Service regions</span>
                        <span className="font-semibold text-right max-w-[180px]">{carrierDetail.service_regions.join(", ") || "Not set"}</span>
                      </div>
                      <div className="flex justify-between border-b border-slate-100 pb-2">
                        <span className="text-slate-500">Max weight</span>
                        <span className="font-semibold">{carrierDetail.max_weight_kg.toLocaleString()} kg</span>
                      </div>
                      {carrierDetail.contact_name && (
                        <div className="flex justify-between border-b border-slate-100 pb-2">
                          <span className="text-slate-500">Contact</span>
                          <span className="font-semibold">{carrierDetail.contact_name}</span>
                        </div>
                      )}
                      {carrierDetail.phone && (
                        <div className="flex justify-between border-b border-slate-100 pb-2">
                          <span className="text-slate-500">Phone</span>
                          <span className="font-semibold">{carrierDetail.phone}</span>
                        </div>
                      )}
                      {carrierDetail.address && (
                        <div className="flex justify-between border-b border-slate-100 pb-2">
                          <span className="text-slate-500">Address</span>
                          <span className="font-semibold text-right max-w-[180px]">{carrierDetail.address}</span>
                        </div>
                      )}
                      {carrierDetail.bio && (
                        <p className="pt-1 text-xs text-slate-500">{carrierDetail.bio}</p>
                      )}
                    </div>
                  </div>
                )}
              </aside>
            </div>
          </section>
        )}

        {isSubscriptionActive && activeTab === "carrier_history" && (
          <section className="space-y-6">
            <article className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold">Carrier History and Rebook</h2>
                  <p className="mt-1 text-xs text-slate-500">Rate carriers and submit a new request with a carrier from your history.</p>
                </div>
                <button
                  onClick={() => void loadCarrierHistory()}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                >
                  {carrierHistoryLoading ? "Refreshing..." : "Refresh"}
                </button>
              </div>

              <div className="mt-5 space-y-3">
                {carrierHistory.length === 0 && (
                  <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
                    No carrier history yet. Complete shipments with carriers to build your reusable network.
                  </p>
                )}

                {carrierHistory.map((item) => {
                  const draft = ratingDraftsByCarrier[item.carrier_name] ?? {
                    rating: item.latest_rating ?? 5,
                    useAgain: item.would_use_again ?? true,
                    review: item.latest_review ?? "",
                  };

                  return (
                    <div key={`${item.carrier_name}-${item.last_shipment_id}`} className="rounded-xl border border-slate-200 bg-white p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">{item.carrier_name}</p>
                          <p className="mt-1 text-xs text-slate-500">
                            Last lane: {item.last_lane} • {new Date(item.last_shipment_at).toLocaleDateString()}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            Shipments: {item.total_shipments} total • {item.delivered_shipments} delivered
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            Avg rating: {item.average_rating == null ? "Not rated yet" : `${item.average_rating.toFixed(2)} / 5`}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => void onRebookCarrier(item)}
                          disabled={rebookingCarrier === item.carrier_name || !item.carrier_id}
                          className="rounded-md bg-indigo-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-600 disabled:opacity-50"
                        >
                          {rebookingCarrier === item.carrier_name ? "Submitting..." : "Use Carrier Again"}
                        </button>
                      </div>

                      <div className="mt-4 grid gap-3 md:grid-cols-[120px_1fr_auto]">
                        <div className="text-xs font-semibold text-slate-600">
                          <span>Rating</span>
                          <select
                            value={draft.rating}
                            onChange={(event) => updateCarrierRatingDraft(item.carrier_name, { rating: Number(event.target.value) })}
                            className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm"
                          >
                            {[5, 4, 3, 2, 1].map((score) => (
                              <option key={score} value={score}>
                                {score} Star{score > 1 ? "s" : ""}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="text-xs font-semibold text-slate-600">
                          <span>Review</span>
                          <textarea
                            value={draft.review}
                            onChange={(event) => updateCarrierRatingDraft(item.carrier_name, { review: event.target.value })}
                            placeholder="Share feedback about this carrier"
                            rows={2}
                            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-700"
                          />
                        </div>
                        <div className="flex flex-col justify-end gap-2">
                          <label className="flex items-center gap-2 text-xs text-slate-700">
                            <input
                              type="checkbox"
                              checked={draft.useAgain}
                              onChange={(event) => updateCarrierRatingDraft(item.carrier_name, { useAgain: event.target.checked })}
                              className="h-4 w-4 rounded border-slate-300"
                            />
                            <span>Use again</span>
                          </label>
                          <button
                            type="button"
                            onClick={() => void onSubmitCarrierRating(item)}
                            disabled={!item.last_delivered_shipment_id || ratingSubmittingCarrier === item.carrier_name}
                            className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                          >
                            {ratingSubmittingCarrier === item.carrier_name ? "Saving..." : "Save Rating"}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </article>
          </section>
        )}

        {isSubscriptionActive && activeTab === "transactions" && (
          <section className="space-y-6">
            <article className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold">Own Transaction History</h2>
                  <p className="mt-1 text-xs text-slate-500">Your payment activity separated from invoice records.</p>
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
            </article>
          </section>
        )}

        {isSubscriptionActive && activeTab === "documents" && (
          <section className="space-y-6">
            <article className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold">Invoices</h2>
                  <p className="mt-1 text-xs text-slate-500">Generated invoice summaries for your quoted shipments.</p>
                </div>
                <button
                  onClick={() => void loadShipments()}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                >
                  {loading ? "Refreshing..." : "Refresh"}
                </button>
              </div>

              <div className="mt-5 space-y-3">
                {invoiceTransactions.length === 0 && (
                  <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
                    No paid invoices yet. Completed Stripe payments will appear here automatically.
                  </p>
                )}

                {invoiceTransactions.map(({ shipment, invoiceId, transactionRef, paymentDate, amountUsd, freightChargeUsd, platformFeeUsd }) => {
                  const quote = shipment.quote_breakdown!;

                  return (
                    <div key={shipment.id} className="rounded-xl border border-slate-200 bg-white p-5">
                      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Invoice</p>
                          <p className="mt-1 text-lg font-bold text-slate-900">{invoiceId}</p>
                          <p className="mt-0.5 text-xs text-slate-500">Payment Date {new Date(paymentDate).toLocaleDateString()}</p>
                        </div>
                        <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">PAID</span>
                      </div>

                      <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                        <div>
                          <p className="text-xs font-semibold uppercase text-slate-400">Shipper</p>
                          <p className="mt-1 font-medium text-slate-800">{shipment.client_name}</p>
                        </div>
                        <div>
                          <p className="text-xs font-semibold uppercase text-slate-400">Carrier</p>
                          <p className="mt-1 font-medium text-slate-800">{shipment.carrier_name || "Pending assignment"}</p>
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
                          onClick={() => onViewInvoice({ invoiceId, transactionRef, paymentDate, shipment })}
                          className="rounded-md border border-indigo-300 px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-50"
                        >
                          View Invoice
                        </button>
                      </div>

                      <div className="mt-4 rounded-lg bg-slate-50 p-3">
                        <div className="space-y-1 text-sm">
                          <div className="flex justify-between text-slate-600"><span>Freight charge</span><span>${freightChargeUsd.toFixed(2)}</span></div>
                          <div className="flex justify-between text-slate-600"><span>Platform fee</span><span>${platformFeeUsd.toFixed(2)}</span></div>
                          <div className="mt-2 flex justify-between border-t border-slate-200 pt-2 font-bold text-slate-900"><span>Total paid</span><span>${amountUsd.toFixed(2)}</span></div>
                        </div>
                      </div>

                      {quote.notes && <p className="mt-2 text-xs text-slate-400">{quote.notes}</p>}
                    </div>
                  );
                })}
              </div>
            </article>

            {selectedInvoice && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
                <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
                  <div className="flex items-start justify-between gap-3 border-b border-slate-200 pb-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Invoice Preview</p>
                      <h3 className="mt-1 text-xl font-bold text-slate-900">{selectedInvoice.invoiceId}</h3>
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
                      <p className="text-xs font-semibold uppercase text-slate-400">Shipper</p>
                      <p className="mt-1 font-medium text-slate-800">{selectedInvoice.shipment.client_name}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase text-slate-400">Carrier</p>
                      <p className="mt-1 font-medium text-slate-800">{selectedInvoice.shipment.carrier_name || "Pending assignment"}</p>
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
                        <div className="mt-2 flex justify-between border-t border-slate-200 pt-2 font-bold text-slate-900"><span>Total</span><span>${(selectedInvoice.shipment.shipper_approved_amount ?? selectedInvoice.shipment.carrier_offer_amount ?? selectedInvoice.shipment.quote_breakdown.total_usd).toFixed(2)}</span></div>
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
                          invoiceId: selectedInvoice.invoiceId,
                          transactionRef: selectedInvoice.transactionRef,
                          paymentDate: selectedInvoice.paymentDate,
                          shipment: selectedInvoice.shipment,
                        })
                      }
                      className="rounded-md border border-indigo-300 px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-50"
                    >
                      Download PDF
                    </button>
                  </div>
                </div>
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
