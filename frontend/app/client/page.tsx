"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
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

function paymentStateLabel(paymentStatus: string): string {
  if (paymentStatus === "paid") {
    return "Settled";
  }
  if (paymentStatus === "pending_client_confirmation") {
    return "Pending client confirmation";
  }
  return "Not paid";
}

function podStatusLabel(podStatus: string): string {
  if (podStatus === "uploaded") {
    return "Uploaded";
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

function transactionKindForShipment(shipment: Shipment): "purchase" | "void" {
  return shipment.payment_status === "paid" ? "purchase" : "void";
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

function voidReasonForShipment(shipment: Shipment): string {
  if (shipment.status === "rejected") {
    return "Offer pool exhausted or declined";
  }
  if (shipment.payment_status === "pending_client_confirmation") {
    return "Awaiting payment confirmation";
  }
  return "Payment not captured";
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
  const [activeTab, setActiveTab] = useState<"dashboard" | "tracking" | "create" | "carrier_history" | "transactions" | "documents" | "profile" | "subscription">("dashboard");
  const [subscriptionPlans, setSubscriptionPlans] = useState<BillingPlan[]>([]);
  const [subscriptionStatus, setSubscriptionStatus] = useState<BillingStatus | null>(null);
  const [paymentMethodStatus, setPaymentMethodStatus] = useState<BillingPaymentMethodStatus | null>(null);
  const [subscriptionLoading, setSubscriptionLoading] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
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
    kind: "purchase" | "void";
    detail: string;
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
      setMessage(error instanceof Error ? error.message : "Failed to load subscription status.");
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
      const response = await createSubscriptionCheckoutSession(session.email, "client", {
        success_url: `${origin}/client?billing=success`,
        cancel_url: `${origin}/client?billing=cancel`,
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

  const invoiceShipments = useMemo(
    () => myShipments.filter((shipment) => shipment.quote_breakdown !== null),
    [myShipments]
  );

  const invoiceTransactions = useMemo(
    () =>
      invoiceShipments.map((shipment, index) => {
        const kind = transactionKindForShipment(shipment);
        const referencePrefix = kind === "purchase" ? "PUR" : "VOID";
        return {
          shipment,
          invoiceId: `INV-${new Date(shipment.created_at).getFullYear()}-${String(index + 1).padStart(4, "0")}`,
          transactionRef: `${referencePrefix}-${shipment.id.slice(0, 8).toUpperCase()}`,
          kind,
          detail: kind === "purchase" ? "Payment captured" : voidReasonForShipment(shipment),
        };
      }),
    [invoiceShipments]
  );

  const ownTransactions = useMemo(
    () =>
      invoiceTransactions.map((item) => ({
        ...item,
        amountUsd: item.shipment.shipper_approved_amount ?? item.shipment.carrier_offer_amount ?? item.shipment.quote_breakdown?.total_usd ?? 0,
      })),
    [invoiceTransactions]
  );

  function buildInvoiceDocument(params: {
    invoiceId: string;
    transactionRef: string;
    kind: "purchase" | "void";
    detail: string;
    shipment: Shipment;
  }): string {
    const { invoiceId, transactionRef, kind, detail, shipment } = params;
    const quote = shipment.quote_breakdown;
    if (!quote) {
      return "No invoice data available.";
    }

    return [
      `Invoice ID: ${invoiceId}`,
      `Transaction Ref: ${transactionRef}`,
      `Transaction Type: ${kind === "purchase" ? "Purchase" : "Void"}`,
      `Payment State: ${paymentStateLabel(shipment.payment_status)}`,
      `Transaction Detail: ${detail}`,
      `Issued Date: ${new Date(shipment.created_at).toLocaleDateString()}`,
      "",
      `Shipper: ${shipment.client_name}`,
      `Carrier: ${shipment.carrier_name || "Pending assignment"}`,
      `Route: ${shipment.origin} to ${shipment.destination}`,
      `Cargo: ${shipment.cargo_type}`,
      `Weight: ${toLbFromKg(shipment.weight_kg).toLocaleString()} lb (${shipment.weight_kg.toLocaleString()} kg)`,
      "",
      `Base Freight: $${quote.base_freight_usd.toFixed(2)}`,
      `Urgency Surcharge: $${quote.urgency_surcharge_usd.toFixed(2)}`,
      `Distance Surcharge: $${quote.distance_surcharge_usd.toFixed(2)}`,
      `Service Fee: $${quote.service_fee_usd.toFixed(2)}`,
      `Total: $${quote.total_usd.toFixed(2)}`,
      `ETA: ${quote.estimated_delivery_time}`,
      ...(quote.notes ? [`Notes: ${quote.notes}`] : []),
    ].join("\n");
  }

  function onDownloadInvoice(params: {
    invoiceId: string;
    transactionRef: string;
    kind: "purchase" | "void";
    detail: string;
    shipment: Shipment;
  }) {
    const safeInvoiceId = params.invoiceId.replace(/[^a-zA-Z0-9-_]/g, "_");
    const content = buildInvoiceDocument(params);
    downloadPdfDocument(`${safeInvoiceId}.pdf`, content);
  }

  function onViewInvoice(params: {
    invoiceId: string;
    transactionRef: string;
    kind: "purchase" | "void";
    detail: string;
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
      const response = await createShipmentPaymentCheckoutSession(
        shipmentId,
        { role: "client", displayName: session.displayName },
        {
          success_url: `${origin}/client?shipmentPayment=success&shipmentId=${encodeURIComponent(shipmentId)}&checkoutSessionId={CHECKOUT_SESSION_ID}`,
          cancel_url: `${origin}/client?shipmentPayment=cancel&shipmentId=${encodeURIComponent(shipmentId)}`,
        }
      );
      const openedPopup = openStripeHostedFlow(response.checkout_url);
      setShipmentCheckoutLoadingId(null);
      if (openedPopup) {
        setMessage("Payment checkout opened in a popup. Complete payment there, then refresh shipments.");
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
        "Shipper reviewed POD and released carrier payout."
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
    <main className="min-h-screen bg-slate-100 p-6 text-slate-900 md:p-10">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8">
        <header className="rounded-3xl bg-indigo-900 p-8 text-white shadow-lg">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-3xl font-semibold md:text-4xl">Shipment Dispatch and Tracking</h1>
              <p className="mt-3 max-w-3xl text-indigo-100">
                Create shipment requests, send offers to matching carriers, and confirm payment before activation.
              </p>
            </div>
            <div className="flex gap-2">
              <div className="relative" ref={accountMenuRef}>
                <button
                  type="button"
                  onClick={() => setAccountMenuOpen((prev) => !prev)}
                  aria-label="Open my account menu"
                  aria-expanded={accountMenuOpen}
                  className="flex items-center gap-2 rounded-lg border border-indigo-200/50 px-3 py-2 text-sm font-semibold hover:bg-white/20"
                >
                  <span>My Account</span>
                  <ProfileIcon className="h-5 w-5" />
                </button>
                {accountMenuOpen && (
                  <div className="absolute right-0 top-12 z-20 w-52 rounded-xl border border-indigo-200 bg-white p-2 text-slate-900 shadow-xl">
                    <button
                      type="button"
                      onClick={() => {
                        setActiveTab("profile");
                        setAccountMenuOpen(false);
                      }}
                      className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-100"
                    >
                      Profile
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveTab("subscription");
                        setAccountMenuOpen(false);
                      }}
                      className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-100"
                    >
                      Subscription
                    </button>
                  </div>
                )}
              </div>
              <button
                onClick={signOut}
                className="rounded-lg border border-indigo-200/50 px-4 py-2 text-sm font-semibold hover:bg-white/20"
              >
                Sign Out
              </button>
              <a className="rounded-lg bg-white/15 px-4 py-2 text-sm font-semibold hover:bg-white/25" href="/">
                Home
              </a>
            </div>
          </div>
        </header>

        {message && <p className="rounded-xl border border-indigo-300 bg-indigo-50 px-4 py-3 text-sm text-indigo-900">{message}</p>}

        <section className="rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-200 md:p-4">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setActiveTab("dashboard")}
              className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
                activeTab === "dashboard"
                  ? "bg-indigo-700 text-white"
                  : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
              }`}
            >
              Dashboard
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("tracking")}
              className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
                activeTab === "tracking"
                  ? "bg-indigo-700 text-white"
                  : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
              }`}
            >
              Tracking
            </button>
            <button
              type="button"
              onClick={() => { setActiveTab("create"); setCreateStep("form"); setCreatedMatchResult(null); setCarrierDetail(null); }}
              className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
                activeTab === "create"
                  ? "bg-indigo-700 text-white"
                  : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
              }`}
            >
              Create Shipment
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("carrier_history")}
              className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
                activeTab === "carrier_history"
                  ? "bg-indigo-700 text-white"
                  : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
              }`}
            >
              Carrier History & Rebook
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("transactions")}
              className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
                activeTab === "transactions"
                  ? "bg-indigo-700 text-white"
                  : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
              }`}
            >
              Transaction History
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("documents")}
              className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
                activeTab === "documents"
                  ? "bg-indigo-700 text-white"
                  : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
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
                {checkoutLoading ? "Redirecting..." : "Subscribe for $25.00"}
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

        {activeTab === "subscription" && (
          <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
            <h2 className="text-xl font-semibold">Subscription</h2>
            <p className="mt-1 text-sm text-slate-600">Manage your shipper plan access.</p>
            <div className="mt-4 rounded-lg border border-slate-200 p-4 text-sm">
              <p><span className="font-semibold">Plan:</span> {shipperPlan?.name || "Shipper"}</p>
              <p><span className="font-semibold">Price:</span> ${shipperPlan?.price_usd.toFixed(2) || "25.00"}/month</p>
              <p><span className="font-semibold">Status:</span> {subscriptionStatus?.subscription_status || "inactive"}</p>
              <p>
                <span className="font-semibold">Access:</span> {isSubscriptionActive ? "Active" : "Locked until subscribed"}
              </p>
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
            </div>
          </section>
        )}

        {!isSubscriptionActive && activeTab !== "subscription" && null}

        {isSubscriptionActive && (activeTab === "dashboard" || activeTab === "tracking") && (
          <section className="space-y-6">
            {activeTab === "dashboard" && (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
                  <p className="text-xs uppercase tracking-wider text-slate-500">Total</p>
                  <p className="mt-2 text-2xl font-semibold text-slate-900">{dashboardStats.total}</p>
                </div>
                <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
                  <p className="text-xs uppercase tracking-wider text-slate-500">Awaiting Payment</p>
                  <p className="mt-2 text-2xl font-semibold text-amber-600">{dashboardStats.awaitingPayment}</p>
                </div>
                <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
                  <p className="text-xs uppercase tracking-wider text-slate-500">Active</p>
                  <p className="mt-2 text-2xl font-semibold text-emerald-600">{dashboardStats.active}</p>
                </div>
                <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
                  <p className="text-xs uppercase tracking-wider text-slate-500">Delivered</p>
                  <p className="mt-2 text-2xl font-semibold text-indigo-600">{dashboardStats.delivered}</p>
                </div>
              </div>
            )}

            {activeTab === "dashboard" && (
              <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4 text-xs text-indigo-900">
                <p className="font-semibold uppercase tracking-wide">Payment Release Flow</p>
                <p className="mt-1">
                  Accept quote, then pay shipment, then driver delivers, then driver uploads POD, then you review POD, then click Release Payment, then carrier gets paid.
                </p>
              </div>
            )}

            <article className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold">{activeTab === "tracking" ? "Shipment Tracking" : "My Shipments"}</h2>
                <div className="flex items-center gap-2">
                  {activeTab === "tracking" && (
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
                  )}
                  {activeTab === "tracking" && (
                    <button
                      onClick={() => void loadLiveTracking()}
                      className="rounded-lg border border-indigo-300 px-3 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-50"
                    >
                      {trackingLoading ? "Tracking..." : "Refresh Tracking"}
                    </button>
                  )}
                  <button
                    onClick={() => void loadShipments()}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    {loading ? "Refreshing..." : "Refresh"}
                  </button>
                </div>
              </div>

              <div className="mt-5 space-y-4">
                {myShipments.length === 0 && (
                  <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
                    No shipments found yet.
                  </p>
                )}

                {activeTab === "tracking" && liveTrackingRows.length === 0 && myShipments.length > 0 && (
                  <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
                    No live tracking updates available for your shipments yet.
                  </p>
                )}

                {myShipments
                  .filter((shipment) => activeTab !== "tracking" || !selectedTrackingRow || shipment.id === selectedTrackingRow.shipment_id)
                  .map((shipment) => (
                  <div key={shipment.id} className="rounded-xl border border-slate-200 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <h3 className="font-semibold text-slate-900">
                          {shipment.origin} to {shipment.destination}
                        </h3>
                        <p className="text-sm text-slate-600">
                          {shipment.cargo_type} • {toLbFromKg(shipment.weight_kg).toLocaleString()} lb ({shipment.weight_kg.toLocaleString()} kg) • {shipment.time_window}
                        </p>
                      </div>
                      <span className="rounded-full bg-indigo-100 px-3 py-1 text-xs font-semibold text-indigo-700">
                        {statusLabel[shipment.status]}
                      </span>
                    </div>

                    {(shipment.carrier_offer_amount !== null || shipment.quote_breakdown) && (
                      <div className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
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
                        className="mt-3 rounded-lg bg-indigo-700 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-600"
                      >
                        Accept Quote
                      </button>
                    )}

                    {shipment.quote_status === "accepted" && shipment.payment_status !== "paid" && (
                      <button
                        type="button"
                        onClick={() => void onConfirmAndPay(shipment.id)}
                        disabled={shipmentCheckoutLoadingId === shipment.id}
                        className="mt-3 rounded-lg bg-emerald-700 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-600"
                      >
                        {shipmentCheckoutLoadingId === shipment.id ? "Opening Checkout..." : "Pay Now"}
                      </button>
                    )}

                    {shipment.payment_status === "paid" && shipment.status === "delivered" && shipment.pod_status === "uploaded" && shipment.payout_status !== "released" && (
                      <button
                        type="button"
                        onClick={() => void onReleasePayment(shipment.id)}
                        disabled={releasePaymentLoadingId === shipment.id}
                        className="mt-3 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                      >
                        {releasePaymentLoadingId === shipment.id ? "Releasing..." : "Release Payment"}
                      </button>
                    )}

                    {shipment.payment_status === "paid" && shipment.status === "delivered" && shipment.pod_status === "pending" && (
                      <p className="mt-3 text-xs font-semibold text-amber-700">Waiting for driver POD upload before payment release.</p>
                    )}

                    <div className="mt-3 grid gap-1 text-xs text-slate-500 sm:grid-cols-2">
                      <p>POD Status: <span className="font-semibold text-slate-700">{podStatusLabel(shipment.pod_status)}</span></p>
                      <p>Payout: <span className="font-semibold text-slate-700">{payoutStatusLabel(shipment.payout_status)}</span></p>
                    </div>

                    <div className="mt-3 text-xs text-slate-500">
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
          <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-xl font-semibold">Profile</h2>
              <button
                onClick={() => void saveProfile()}
                disabled={profileSaving || !session?.email}
                className="rounded-lg bg-indigo-700 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-600 disabled:opacity-50"
              >
                {profileSaving ? "Saving..." : "Save Profile"}
              </button>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {profile ? `Last updated ${new Date(profile.updated_at).toLocaleString()}` : "Load your profile to edit account details."}
            </p>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <input
                value={profileForm.full_name}
                onChange={(event) => setProfileForm((prev) => ({ ...prev, full_name: event.target.value }))}
                placeholder="Full name"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-indigo-700"
              />
              <input
                value={profileForm.company_name}
                onChange={(event) => setProfileForm((prev) => ({ ...prev, company_name: event.target.value }))}
                placeholder="Company name"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-indigo-700"
              />
              <input
                value={profileForm.phone}
                onChange={(event) => setProfileForm((prev) => ({ ...prev, phone: event.target.value }))}
                placeholder="Phone"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-indigo-700"
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
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-indigo-700"
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
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-indigo-700"
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
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 outline-none focus:border-indigo-700"
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
                className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-indigo-700"
              />
              <select
                value={profileForm.country}
                onChange={(event) => {
                  setStreetPlaceId(null);
                  setCityPlaceId(null);
                  setProfileForm((prev) => ({ ...prev, country: event.target.value }));
                }}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 outline-none focus:border-indigo-700"
              >
                <option value="US">US</option>
              </select>
              <textarea
                value={profileForm.bio}
                onChange={(event) => setProfileForm((prev) => ({ ...prev, bio: event.target.value }))}
                placeholder="Short company bio"
                rows={3}
                className="md:col-span-2 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-indigo-700"
              />
            </div>

            <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <h3 className="text-sm font-semibold text-slate-900">Stripe Wallet</h3>
              <p className="mt-1 text-xs text-slate-600">
                Link a card or bank account for faster quote payments and checkout confirmation.
              </p>
              <div className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
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
                  className="rounded-lg border border-indigo-300 bg-white px-3 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-60"
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
                  className="rounded-lg border border-indigo-300 bg-white px-3 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-60"
                >
                  {walletSetupLoading === "bank_account" ? "Opening Stripe..." : "Link Bank Account"}
                </button>
                <button
                  type="button"
                  onClick={() => void loadSubscriptionState(true)}
                  disabled={subscriptionLoading}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                >
                  Refresh Wallet Status
                </button>
              </div>
            </div>
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
                    No invoice documents yet. Create shipments and wait for quotes to see invoice summaries.
                  </p>
                )}

                {invoiceTransactions.map(({ shipment, invoiceId, transactionRef, kind, detail }) => {
                  const quote = shipment.quote_breakdown!;
                  const amountUsd = shipment.shipper_approved_amount ?? shipment.carrier_offer_amount ?? quote.total_usd;
                  const isPaid = shipment.payment_status === "paid";

                  return (
                    <div key={shipment.id} className="rounded-xl border border-slate-200 bg-white p-5">
                      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Invoice</p>
                          <p className="mt-1 text-lg font-bold text-slate-900">{invoiceId}</p>
                          <p className="mt-0.5 text-xs text-slate-500">Issued {new Date(shipment.created_at).toLocaleDateString()}</p>
                        </div>
                        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${isPaid ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                          {isPaid ? "PAID" : "UNPAID"}
                        </span>
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
                          <p className="text-xs font-semibold uppercase text-slate-400">Route</p>
                          <p className="mt-1 text-slate-700">{shipment.origin} to {shipment.destination}</p>
                        </div>
                        <div>
                          <p className="text-xs font-semibold uppercase text-slate-400">Cargo</p>
                          <p className="mt-1 text-slate-700">{shipment.cargo_type} • {toLbFromKg(shipment.weight_kg).toLocaleString()} lb</p>
                        </div>
                        <div>
                          <p className="text-xs font-semibold uppercase text-slate-400">Transaction Type</p>
                          <p className={`mt-1 font-semibold ${kind === "purchase" ? "text-emerald-700" : "text-rose-700"}`}>
                            {kind === "purchase" ? "Purchase" : "Void"}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs font-semibold uppercase text-slate-400">Transaction Ref</p>
                          <p className="mt-1 text-slate-700">{transactionRef}</p>
                        </div>
                      </div>

                      <div className="mt-3 flex justify-end">
                        <button
                          type="button"
                          onClick={() => onViewInvoice({ invoiceId, transactionRef, kind, detail, shipment })}
                          className="rounded-md border border-indigo-300 px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-50"
                        >
                          View Invoice
                        </button>
                      </div>

                      <div className="mt-4 rounded-lg bg-slate-50 p-3">
                        <div className="space-y-1 text-sm">
                          <div className="flex justify-between text-slate-600"><span>Base freight</span><span>${quote.base_freight_usd.toFixed(2)}</span></div>
                          <div className="flex justify-between text-slate-600"><span>Urgency surcharge</span><span>${quote.urgency_surcharge_usd.toFixed(2)}</span></div>
                          <div className="flex justify-between text-slate-600"><span>Distance surcharge</span><span>${quote.distance_surcharge_usd.toFixed(2)}</span></div>
                          <div className="flex justify-between text-slate-600"><span>Service fee</span><span>${quote.service_fee_usd.toFixed(2)}</span></div>
                          <div className="mt-2 flex justify-between border-t border-slate-200 pt-2 font-bold text-slate-900"><span>Total</span><span>${amountUsd.toFixed(2)}</span></div>
                        </div>
                      </div>

                      <div className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
                        <p>
                          <span className="font-semibold text-slate-700">Payment State:</span> {paymentStateLabel(shipment.payment_status)}
                        </p>
                        <p>
                          <span className="font-semibold text-slate-700">Transaction Detail:</span> {detail}
                        </p>
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
                      <p className="mt-1 text-xs text-slate-500">Ref {selectedInvoice.transactionRef}</p>
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
                      <p className="text-xs font-semibold uppercase text-slate-400">Route</p>
                      <p className="mt-1 text-slate-700">{selectedInvoice.shipment.origin} to {selectedInvoice.shipment.destination}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase text-slate-400">Transaction</p>
                      <p className={`mt-1 font-semibold ${selectedInvoice.kind === "purchase" ? "text-emerald-700" : "text-rose-700"}`}>
                        {selectedInvoice.kind === "purchase" ? "Purchase" : "Void"}
                      </p>
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
                    <p><span className="font-semibold text-slate-700">Payment State:</span> {paymentStateLabel(selectedInvoice.shipment.payment_status)}</p>
                    <p><span className="font-semibold text-slate-700">Transaction Detail:</span> {selectedInvoice.detail}</p>
                  </div>

                  <div className="mt-5 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        onDownloadInvoice({
                          invoiceId: selectedInvoice.invoiceId,
                          transactionRef: selectedInvoice.transactionRef,
                          kind: selectedInvoice.kind,
                          detail: selectedInvoice.detail,
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
