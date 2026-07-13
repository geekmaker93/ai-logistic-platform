"use client";

import { useEffect, useRef, useState } from "react";
import {
  clearAuthLiteSession,
  clearDriverPortalSession,
  getAuthLiteSession,
  setAuthLiteSession,
  setDriverPortalSession,
} from "@/lib/auth-lite";
import GlobeMarketJourneyBackground from "@/app/components/globe-market-journey-background";
import LiveChatSupport from "@/app/components/live-chat-support";
import { AuthRole, driverLogin, loginAccount, requestPasswordReset, requestSignupVerificationCode, signupAccount } from "@/lib/logistics-api";
import { trackEvent } from "@/lib/telemetry";

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

type LoginRole = "client" | "carrier" | "driver";
type LandingView = "landing" | "pricing" | "resources" | "about" | "login" | "signup" | "signup_verify" | "forgot_password";
type PricingSubscription = "shipper" | "carrier";
type ResourceSection = "events";

type LoginState = {
  email: string;
  password: string;
  role: LoginRole;
};

type SignupState = {
  fullName: string;
  companyName: string;
  taxId: string;
  dotNumber: string;
  vehicleTypes: string[];
  email: string;
  password: string;
  confirmPassword: string;
  emailVerificationCode: string;
  role: "client" | "carrier";
};

type SubmitState = null | "login" | "signup" | "signup_code" | "forgot_password";

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return "Request failed. Please try again.";
}

function getSignupValidationMessage(params: {
  form: SignupState;
  normalizedTaxId: string;
  normalizedDotNumber: string;
}): string | null {
  const { form, normalizedTaxId, normalizedDotNumber } = params;
  const fullName = form.fullName.trim();
  const companyName = form.companyName.trim();
  const email = form.email.trim().toLowerCase();
  const password = form.password;
  const isCarrier = form.role === "carrier";

  if (!fullName || !companyName || !email || !password) return "Complete all sign-up fields.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Enter a valid email address.";
  if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return "Password must be at least 8 characters and include letters and numbers.";
  }
  if (password !== form.confirmPassword) return "Passwords do not match.";
  if (isCarrier && !form.taxId.trim()) return "Enter EIN/Tax ID.";
  if (isCarrier && !normalizedDotNumber) return "Enter USDOT number.";
  if (isCarrier && !/^\d{9}$/.test(normalizedTaxId)) {
    return "Enter a valid EIN/Tax ID with 9 digits (for example: 12-3456789).";
  }
  if (isCarrier && !/^[1-9]\d{5,7}$/.test(normalizedDotNumber)) {
    return "Enter a valid USDOT number (6 to 8 digits, numbers only).";
  }

  return null;
}

function getAboutStyles() {
  return {
    shell: "space-y-6",
    label: "font-semibold text-slate-500",
    title: "text-slate-950",
    copy: "text-slate-700",
    card: "rounded-2xl border border-slate-200 bg-slate-50 p-4",
    cardCopy: "text-slate-600",
    pill: "rounded-full border border-slate-300 bg-white px-3 py-1.5 text-slate-800",
  };
}

function getLoginRoleClass(role: LoginRole, selected: boolean): string {
  if (!selected) {
    return "border border-slate-600 bg-[#061B34] text-slate-200 hover:bg-[#0A2648]";
  }

  if (role === "client") return "bg-indigo-500 text-white";
  if (role === "carrier") return "bg-emerald-500 text-white";
  return "bg-amber-500 text-white";
}

function getLoginRoleLabel(role: LoginRole): string {
  if (role === "client") return "Shipper";
  if (role === "carrier") return "Carrier";
  return "Driver";
}

function resolveDashboardPath(role: LoginRole): string {
  if (role === "carrier") return "/carrier";
  if (role === "driver") return "/driver";
  return "/client";
}

function navigateToDashboard(role: LoginRole): void {
  globalThis.window.location.assign(resolveDashboardPath(role));
}

function resolveProfilePath(role: LoginRole): string {
  if (role === "driver") return "/driver";
  return `${resolveDashboardPath(role)}?account=profile`;
}

function NavBrand(props: Readonly<{ isAboutView: boolean; onOpenLanding: () => void }>) {
  const { isAboutView, onOpenLanding } = props;

  return (
    <button
      type="button"
      onClick={onOpenLanding}
      className={`cursor-pointer text-sm font-semibold tracking-wide transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70 ${isAboutView ? "text-slate-900 hover:text-slate-700" : "text-cyan-200 hover:text-cyan-100"}`}
    >
      LynkXpress
    </button>
  );
}

function NavTabs(props: Readonly<{
  isAboutView: boolean;
  onOpenPricing: () => void;
  onOpenShipperSubscription: () => void;
  onOpenCarrierSubscription: () => void;
  onOpenResources: () => void;
  onOpenAbout: () => void;
}>) {
  const { isAboutView, onOpenPricing, onOpenShipperSubscription, onOpenCarrierSubscription, onOpenResources, onOpenAbout } = props;
  const tabClass = isAboutView
    ? "text-slate-700 hover:border-slate-300 hover:bg-slate-100"
    : "text-slate-200 hover:border-cyan-300/40 hover:bg-cyan-500/10";
  const [pricingMenuOpen, setPricingMenuOpen] = useState(false);
  const [resourcesMenuOpen, setResourcesMenuOpen] = useState(false);
  const [supportMenuOpen, setSupportMenuOpen] = useState(false);
  const pricingMenuRef = useRef<HTMLDivElement | null>(null);
  const resourcesMenuRef = useRef<HTMLDivElement | null>(null);
  const supportMenuRef = useRef<HTMLDivElement | null>(null);

  function closePricingMenuIfOutside(target: EventTarget | null) {
    if (!pricingMenuRef.current || pricingMenuRef.current.contains(target as Node)) {
      return;
    }
    setPricingMenuOpen(false);
  }

  function closeResourcesMenuIfOutside(target: EventTarget | null) {
    if (!resourcesMenuRef.current || resourcesMenuRef.current.contains(target as Node)) {
      return;
    }
    setResourcesMenuOpen(false);
  }

  function closeSupportMenuIfOutside(target: EventTarget | null) {
    if (!supportMenuRef.current || supportMenuRef.current.contains(target as Node)) {
      return;
    }
    setSupportMenuOpen(false);
  }

  useEffect(() => {
    function handlePricingMenuPointerDown(event: PointerEvent) {
      closePricingMenuIfOutside(event.target);
    }

    function handleResourcesMenuPointerDown(event: PointerEvent) {
      closeResourcesMenuIfOutside(event.target);
    }

    function handleSupportMenuPointerDown(event: PointerEvent) {
      closeSupportMenuIfOutside(event.target);
    }

    globalThis.document.addEventListener("pointerdown", handlePricingMenuPointerDown, true);
    globalThis.document.addEventListener("pointerdown", handleResourcesMenuPointerDown, true);
    globalThis.document.addEventListener("pointerdown", handleSupportMenuPointerDown, true);
    return () => {
      globalThis.document.removeEventListener("pointerdown", handlePricingMenuPointerDown, true);
      globalThis.document.removeEventListener("pointerdown", handleResourcesMenuPointerDown, true);
      globalThis.document.removeEventListener("pointerdown", handleSupportMenuPointerDown, true);
    };
  }, []);

  return (
    <div className="order-3 flex w-full gap-2 overflow-x-auto pb-1 text-sm md:order-2 md:ml-8 md:w-auto md:overflow-visible md:pb-0">
      <div className="relative" ref={pricingMenuRef}>
        <button
          type="button"
          onClick={() => {
            onOpenPricing();
            setPricingMenuOpen((prev) => !prev);
          }}
          onMouseEnter={() => setPricingMenuOpen(true)}
          className={`whitespace-nowrap rounded-full border border-transparent px-3 py-1.5 transition ${tabClass}`}
        >
          Pricing
        </button>

        {pricingMenuOpen && (
          <div
            role="menu"
            tabIndex={-1}
            aria-label="Pricing options"
            onMouseLeave={() => setPricingMenuOpen(false)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setPricingMenuOpen(false);
              }
            }}
            className={`absolute left-0 top-11 z-30 w-60 rounded-xl p-2 shadow-xl ${isAboutView ? "border border-slate-200 bg-white" : "border border-cyan-300/20 bg-[#041a34]"}`}
          >
            <button
              type="button"
              onClick={() => {
                onOpenShipperSubscription();
                setPricingMenuOpen(false);
              }}
              className={`w-full rounded-lg px-3 py-2 text-left text-sm transition ${isAboutView ? "text-slate-800 hover:bg-slate-100" : "text-slate-100 hover:bg-cyan-500/20"}`}
            >
              Shipper Subscription
            </button>
            <button
              type="button"
              onClick={() => {
                onOpenCarrierSubscription();
                setPricingMenuOpen(false);
              }}
              className={`w-full rounded-lg px-3 py-2 text-left text-sm transition ${isAboutView ? "text-slate-800 hover:bg-slate-100" : "text-slate-100 hover:bg-cyan-500/20"}`}
            >
              Carrier Subscription
            </button>
          </div>
        )}
      </div>
      <div className="relative" ref={resourcesMenuRef}>
        <button
          type="button"
          onClick={() => {
            setResourcesMenuOpen((prev) => !prev);
          }}
          onMouseEnter={() => setResourcesMenuOpen(true)}
          className={`whitespace-nowrap rounded-full border border-transparent px-3 py-1.5 transition ${tabClass}`}
        >
          Resources
        </button>

        {resourcesMenuOpen && (
          <div
            role="menu"
            tabIndex={-1}
            aria-label="Resources options"
            onMouseLeave={() => setResourcesMenuOpen(false)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setResourcesMenuOpen(false);
              }
            }}
            className={`absolute left-0 top-11 z-30 w-60 rounded-xl p-2 shadow-xl ${isAboutView ? "border border-slate-200 bg-white" : "border border-cyan-300/20 bg-[#041a34]"}`}
          >
            <button
              type="button"
              onClick={() => {
                onOpenResources();
                setResourcesMenuOpen(false);
              }}
              className={`w-full rounded-lg px-3 py-2 text-left text-sm transition ${isAboutView ? "text-slate-800 hover:bg-slate-100" : "text-slate-100 hover:bg-cyan-500/20"}`}
            >
              Events
            </button>
          </div>
        )}
      </div>
      <div className="relative" ref={supportMenuRef}>
        <button
          type="button"
          onClick={() => {
            setSupportMenuOpen((prev) => !prev);
          }}
          onMouseEnter={() => setSupportMenuOpen(true)}
          className={`whitespace-nowrap rounded-full border border-transparent px-3 py-1.5 transition ${tabClass}`}
        >
          Support
        </button>

        {supportMenuOpen && (
          <div
            role="menu"
            tabIndex={-1}
            aria-label="Support options"
            onMouseLeave={() => setSupportMenuOpen(false)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setSupportMenuOpen(false);
              }
            }}
            className={`absolute left-0 top-11 z-30 w-60 rounded-xl p-2 shadow-xl ${isAboutView ? "border border-slate-200 bg-white" : "border border-cyan-300/20 bg-[#041a34]"}`}
          >
            <button
              type="button"
              onClick={() => {
                setSupportMenuOpen(false);
              }}
              className={`w-full rounded-lg px-3 py-2 text-left text-sm transition ${isAboutView ? "text-slate-800 hover:bg-slate-100" : "text-slate-100 hover:bg-cyan-500/20"}`}
            >
              File a Claim
            </button>
            <button
              type="button"
              onClick={() => {
                setSupportMenuOpen(false);
              }}
              className={`w-full rounded-lg px-3 py-2 text-left text-sm transition ${isAboutView ? "text-slate-800 hover:bg-slate-100" : "text-slate-100 hover:bg-cyan-500/20"}`}
            >
              Dispute a Charge
            </button>
          </div>
        )}
      </div>
      <button type="button" onClick={onOpenAbout} className={`whitespace-nowrap rounded-full border border-transparent px-3 py-1.5 transition ${tabClass}`}>
        About
      </button>
    </div>
  );
}

function SignedInControls(props: Readonly<{ isAboutView: boolean; activeSessionName: string; onOpenProfile: () => void; onSignOut: () => void }>) {
  const { isAboutView, activeSessionName, onOpenProfile, onSignOut } = props;

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onOpenProfile}
        className={`rounded-full px-3 py-1.5 text-xs ${isAboutView ? "border border-slate-200 bg-slate-100 text-slate-700" : "border border-cyan-300/25 bg-cyan-500/10 text-cyan-100"}`}
        title="Open account profile"
      >
        {activeSessionName}
      </button>
      <button
        type="button"
        onClick={onSignOut}
        className={`rounded-full px-3 py-1.5 text-sm transition ${isAboutView ? "border border-slate-300 text-slate-700 hover:bg-slate-100" : "border border-cyan-300/40 text-cyan-100 hover:bg-cyan-500/15"}`}
      >
        Sign Out
      </button>
    </div>
  );
}

function SignedOutControls(props: Readonly<{
  isAboutView: boolean;
  loginMenuOpen: boolean;
  loginMenuRef: React.RefObject<HTMLDivElement | null>;
  onToggleLoginMenu: () => void;
  onOpenRoleLogin: (role: LoginRole) => void;
  onCreateAccount: () => void;
}>) {
  const { isAboutView, loginMenuOpen, loginMenuRef, onToggleLoginMenu, onOpenRoleLogin, onCreateAccount } = props;

  return (
    <div className="relative ml-auto" ref={loginMenuRef}>
      <button
        type="button"
        onClick={onToggleLoginMenu}
        onMouseEnter={onToggleLoginMenu}
        onFocus={onToggleLoginMenu}
        aria-expanded={loginMenuOpen}
        className={`rounded-full px-4 py-1.5 text-sm font-semibold transition ${isAboutView ? "border border-slate-300 text-slate-700 hover:bg-slate-100" : "border border-cyan-300/40 text-cyan-100 hover:bg-cyan-500/15"}`}
      >
        Login
      </button>

      {loginMenuOpen && (
        <div className={`absolute right-0 top-12 z-20 w-60 rounded-xl p-2 shadow-xl ${isAboutView ? "border border-slate-200 bg-white" : "border border-cyan-300/20 bg-[#041a34]"}`}>
          <button type="button" onClick={() => onOpenRoleLogin("client")} className={`w-full rounded-lg px-3 py-2 text-left text-sm transition ${isAboutView ? "text-slate-800 hover:bg-slate-100" : "text-slate-100 hover:bg-cyan-500/20"}`}>
            Shipper Login
          </button>
          <button type="button" onClick={() => onOpenRoleLogin("carrier")} className={`w-full rounded-lg px-3 py-2 text-left text-sm transition ${isAboutView ? "text-slate-800 hover:bg-slate-100" : "text-slate-100 hover:bg-cyan-500/20"}`}>
            Carrier Login
          </button>
          <button type="button" onClick={() => onOpenRoleLogin("driver")} className={`w-full rounded-lg px-3 py-2 text-left text-sm transition ${isAboutView ? "text-slate-800 hover:bg-slate-100" : "text-slate-100 hover:bg-cyan-500/20"}`}>
            Driver Login
          </button>
          <div className={`my-2 border-t ${isAboutView ? "border-slate-200" : "border-slate-600/70"}`} />
          <button type="button" onClick={onCreateAccount} className={`w-full rounded-lg px-3 py-2 text-left text-sm font-semibold transition ${isAboutView ? "text-slate-900 hover:bg-slate-100" : "text-cyan-200 hover:bg-cyan-500/20"}`}>
            Create Account
          </button>
        </div>
      )}
    </div>
  );
}

function TopNavigation(props: Readonly<{
  isAboutView: boolean;
  activeSessionName: string | null;
  loginMenuOpen: boolean;
  loginMenuRef: React.RefObject<HTMLDivElement | null>;
  onOpenLanding: () => void;
  onOpenPricing: () => void;
  onOpenShipperSubscription: () => void;
  onOpenCarrierSubscription: () => void;
  onOpenResources: () => void;
  onOpenAbout: () => void;
  onToggleLoginMenu: () => void;
  onOpenRoleLogin: (role: LoginRole) => void;
  onCreateAccount: () => void;
  onOpenProfile: () => void;
  onSignOut: () => void;
}>) {
  const {
    isAboutView,
    activeSessionName,
    loginMenuOpen,
    loginMenuRef,
    onOpenLanding,
    onOpenPricing,
    onOpenShipperSubscription,
    onOpenCarrierSubscription,
    onOpenResources,
    onOpenAbout,
    onToggleLoginMenu,
    onOpenRoleLogin,
    onCreateAccount,
    onOpenProfile,
    onSignOut,
  } = props;

  const headerClass = isAboutView ? "border border-slate-200 bg-white/95" : "border border-cyan-300/20 bg-[#031227]/70";

  return (
    <header className="mx-auto w-full max-w-6xl px-6 pt-6 md:px-10">
      <nav className={`flex flex-wrap items-center gap-3 rounded-2xl px-4 py-3 backdrop-blur-sm md:flex-nowrap md:px-5 ${headerClass}`}>
        <NavBrand isAboutView={isAboutView} onOpenLanding={onOpenLanding} />
        <NavTabs
          isAboutView={isAboutView}
          onOpenPricing={onOpenPricing}
          onOpenShipperSubscription={onOpenShipperSubscription}
          onOpenCarrierSubscription={onOpenCarrierSubscription}
          onOpenResources={onOpenResources}
          onOpenAbout={onOpenAbout}
        />
        {activeSessionName ? (
          <SignedInControls isAboutView={isAboutView} activeSessionName={activeSessionName} onOpenProfile={onOpenProfile} onSignOut={onSignOut} />
        ) : (
          <SignedOutControls
            isAboutView={isAboutView}
            loginMenuOpen={loginMenuOpen}
            loginMenuRef={loginMenuRef}
            onToggleLoginMenu={onToggleLoginMenu}
            onOpenRoleLogin={onOpenRoleLogin}
            onCreateAccount={onCreateAccount}
          />
        )}
      </nav>
    </header>
  );
}

function LandingPanel(props: Readonly<{ message: string }>) {
  const { message } = props;

  return (
    <>
      <p className="text-xs uppercase tracking-[0.22em] text-cyan-300">Intelligent Freight Network</p>
      <h1 className="mt-3 text-3xl font-semibold text-white md:text-5xl">LynkXpress</h1>
      <p className="mt-4 text-sm leading-6 text-slate-200 md:text-base">
        Digital freight coordination for shippers and carriers with route intelligence and real-time operations.
      </p>
      {message && (
        <p className="mt-4 rounded-xl border border-amber-300/50 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          {message}
        </p>
      )}
    </>
  );
}

function PricingPanel(props: Readonly<{ activeSubscription: PricingSubscription; onSelectSubscription: (subscription: PricingSubscription) => void }>) {
  const { activeSubscription, onSelectSubscription } = props;

  return (
    <div className="mt-8 space-y-8 text-slate-900 md:mt-10">
      <div>
        <p className="text-xs uppercase tracking-[0.22em] text-cyan-700">Pricing</p>
        <h2 className="mt-3 text-3xl font-semibold text-slate-950 md:text-5xl">Subscription Models</h2>
        <p className="mt-4 max-w-3xl text-sm leading-6 text-slate-700 md:text-base">
          Choose the model that matches how your team operates.
        </p>
      </div>

      <div className="space-y-4">
        <div id="shipper-subscription" className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
          <button type="button" onClick={() => onSelectSubscription("shipper")} className="w-full text-left">
            <span className="text-xs font-bold uppercase tracking-[0.24em] text-cyan-700">Shipper Subscription</span>
            <span className="mt-2 block text-xl font-semibold text-slate-950">Built for teams that move freight every day</span>
          </button>
          {activeSubscription === "shipper" && (
            <p className="mt-3 text-sm leading-6 text-slate-700">
              Tools for shipment creation, carrier selection, status visibility, and payment handling in one workflow.
            </p>
          )}
        </div>

        <div id="carrier-subscriptions" className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
          <button type="button" onClick={() => onSelectSubscription("carrier")} className="w-full text-left">
            <span className="text-xs font-bold uppercase tracking-[0.24em] text-cyan-700">Carrier Subscriptions</span>
            <span className="mt-2 block text-xl font-semibold text-slate-950">Designed for carriers that want steady load access</span>
          </button>
          {activeSubscription === "carrier" && (
            <p className="mt-3 text-sm leading-6 text-slate-700">
              Access to available shipments, driver coordination, real-time updates, and a streamlined operating experience.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function ResourcesPanel(props: Readonly<{ section: ResourceSection; onSelectSection: (section: ResourceSection) => void }>) {
  const { section, onSelectSection } = props;
  const isEventsSelected = section === "events";

  return (
    <div
      className="mt-8 overflow-hidden rounded-[32px] border border-cyan-200/60 text-white shadow-[0_24px_80px_rgba(8,15,35,0.25)] md:mt-10"
      style={{ backgroundImage: "url('/events-background.png')", backgroundPosition: "center", backgroundSize: "cover" }}
    >
      <div className="bg-slate-950/72 px-5 py-6 md:px-8 md:py-8">
        <div className="space-y-8">
          <div>
            <h2 className="mt-3 text-3xl font-semibold text-white md:text-5xl">Events</h2>
            <p className="mt-4 max-w-3xl text-sm leading-6 text-slate-200 md:text-base">Browse updates and announcements from LynkXpress.</p>
          </div>

          <div className="grid gap-6 lg:grid-cols-[0.38fr_0.62fr]">
            <aside className="rounded-3xl border border-white/12 bg-white/10 p-5 backdrop-blur-sm">
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-cyan-100/80">Events List</p>
              <div className="mt-4 space-y-3">
                <button
                  type="button"
                  onClick={() => onSelectSection("events")}
                  className={`w-full rounded-xl border px-4 py-3 text-left text-sm transition ${isEventsSelected ? "border-cyan-300 bg-white text-slate-950" : "border-white/15 bg-slate-950/35 text-slate-100 hover:bg-white/12"}`}
                >
                  AI Shipment System & Ship Manager Pro Released
                </button>
              </div>
            </aside>

            <article className="rounded-3xl border border-white/12 bg-slate-950/50 p-6 shadow-sm backdrop-blur-sm md:p-8">
              <h3 className="text-2xl font-bold text-white">AI Shipment System & Ship Manager Pro Released</h3>
              <p className="mt-4 text-sm leading-7 text-slate-200 md:text-base">
                LynkXpress has officially launched its new AI-powered shipment software alongside <strong className="font-semibold text-white">Ship Manager Pro</strong>, a major upgrade to its core logistics operations system.
              </p>
              <p className="mt-4 text-sm leading-7 text-slate-200 md:text-base">
                The AI Shipment System introduces intelligent shipment processing, helping optimize load creation, carrier selection, and workflow efficiency across the platform. It is designed to reduce manual decision-making and improve overall operational speed through structured automation and data-driven logic.
              </p>
              <p className="mt-4 text-sm leading-7 text-slate-200 md:text-base">
                <strong className="font-semibold text-white">Ship Manager Pro</strong> enhances shipment control and visibility for shippers, providing a centralized dashboard to manage active loads, monitor real-time status updates, assign carriers, and oversee end-to-end delivery performance within a single interface.
              </p>
              <p className="mt-4 text-sm leading-7 text-slate-200 md:text-base">
                Together, these systems mark a significant step toward a more intelligent and fully integrated freight management ecosystem within LynkXpress.
              </p>
              <div className="mt-6 space-y-1 rounded-2xl border border-white/12 bg-white/10 p-4 text-sm text-slate-100">
                <p>
                  <strong className="font-semibold text-white">Released:</strong> June 2026
                </p>
                <p>
                  <strong className="font-semibold text-white">Status:</strong> Active across platform users
                </p>
              </div>
            </article>
          </div>
        </div>
      </div>
    </div>
  );
}

function AboutPanel(props: Readonly<{ onBackToHome: () => void }>) {
  const styles = getAboutStyles();

  return (
    <div className="mt-8 space-y-12 text-slate-900 md:mt-10">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className={`text-xs uppercase tracking-[0.22em] ${styles.label}`}>About Us</p>
          <p className="mt-2 text-sm text-slate-600">Company overview, values, and roadmap</p>
        </div>
        <button
          type="button"
          onClick={props.onBackToHome}
          className="rounded-full border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
        >
          Back to Home
        </button>
      </div>

      <div className="space-y-12">
        <section className="space-y-4">
          <p className="text-xs font-bold uppercase tracking-[0.26em] text-cyan-700">Transforming Logistics Through Intelligent Connectivity</p>
          <h2 className={`max-w-4xl text-3xl font-bold leading-tight md:text-5xl ${styles.title}`}>
            Built to connect shippers, carriers, and drivers in one streamlined system.
          </h2>
          <p className={`max-w-4xl text-base leading-8 md:text-lg ${styles.copy}`}>
            <strong className="font-semibold text-slate-950">LynkXpress</strong> is a technology-driven logistics platform built to connect shippers, carriers, and drivers through a single, streamlined ecosystem. Our mission is to simplify freight transportation by eliminating inefficiencies, reducing manual processes, and providing greater visibility throughout the shipment lifecycle.
          </p>
          <p className={`max-w-4xl text-base leading-8 md:text-lg ${styles.copy}`}>
            Our platform enables businesses to create shipments, connect with qualified carriers, assign drivers, monitor shipment progress, upload proof-of-delivery documents, and process payments securely-all within one centralized system.
          </p>
          <p className={`max-w-4xl text-base leading-8 md:text-lg ${styles.copy}`}>
            By combining modern logistics technology with intelligent automation, we help transportation professionals spend less time managing paperwork and more time moving freight efficiently.
          </p>
        </section>

        <section className="space-y-5">
          <h3 className="text-2xl font-bold text-slate-950">At a Glance</h3>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              ["Headquarters", "New York, NY, USA"],
              ["Industry", "Logistics Technology"],
              ["Business Model", "Software as a Service (SaaS)"],
              ["Service Area", "United States"],
              ["Platform Users", "Shippers, Carriers, Drivers"],
              ["Core Services", "Shipment management, tracking, driver access, payments"],
              ["Operating Style", "Cloud-based, secure, workflow-driven"],
            ].map(([label, value]) => (
              <div key={label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">{label}</p>
                <p className={`mt-2 text-sm leading-6 text-slate-700`}>{value}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-4">
          <h3 className="text-2xl font-bold text-slate-950">Mission</h3>
          <p className={`max-w-4xl text-base leading-8 ${styles.copy}`}>
            We help transportation teams spend less time on paperwork and more time moving freight efficiently.
          </p>
          <p className={`max-w-4xl text-base leading-8 ${styles.copy}`}>
            The platform is built to improve visibility, reduce manual steps, and support better decision-making throughout the shipment lifecycle.
          </p>
        </section>

        <section className="space-y-4">
          <h3 className="text-2xl font-bold text-slate-950">Customer Success</h3>
          <p className={`max-w-4xl text-base leading-8 ${styles.copy}`}>
            Our success is directly tied to the success of our users. We are dedicated to creating meaningful value for every shipper, carrier, and driver who relies on our platform.
          </p>
        </section>

        <section className="space-y-5">
          <h3 className="text-2xl font-bold text-slate-950">Our Values</h3>
          <div className="grid gap-4 md:grid-cols-3">
            {[
              ["Innovation", "We believe technology should solve real-world logistics challenges. We continuously seek innovative ways to improve efficiency, visibility, and operational performance across the transportation industry."],
              ["Trust", "Successful logistics operations are built on dependable relationships. We are committed to fostering transparency, accountability, and confidence throughout every interaction on our platform."],
              ["Efficiency", "Time is one of the industry's most valuable resources. Every feature we develop is designed to reduce friction, streamline workflows, and help users accomplish more with less effort."],
            ].map(([title, copy]) => (
              <div key={title} className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                <p className="text-sm font-bold text-slate-950">{title}</p>
                <p className={`mt-2 text-sm leading-6 ${styles.cardCopy}`}>{copy}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-4">
          <h3 className="text-2xl font-bold text-slate-950">Locations</h3>
          <p className="text-base leading-8 text-slate-700">
            Headquartered in <strong className="font-semibold text-slate-950">New York, NY</strong>
          </p>
          <p className={`max-w-4xl text-base leading-8 ${styles.copy}`}>
            We operate from a major transportation and business hub, supporting shippers and carriers across the United States through a secure, cloud-based logistics ecosystem.
          </p>
        </section>

        <section className="space-y-5">
          <h3 className="text-2xl font-bold text-slate-950">Core Services</h3>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[
              "Shipment Management",
              "Carrier Network Access",
              "Driver Portal Access",
              "Real-Time Tracking",
              "Digital Proof of Delivery",
              "Secure Payment Processing",
              "Workflow Automation",
            ].map((item) => (
              <li key={item} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm leading-6 text-slate-700 shadow-sm">
                {item}
              </li>
            ))}
          </ul>
        </section>

        <section className="space-y-4">
          <h3 className="text-2xl font-bold text-slate-950">Looking Ahead</h3>
          <p className={`max-w-4xl text-base leading-8 ${styles.copy}`}>
            Our long-term vision is to build one of the most intelligent and connected logistics ecosystems in the transportation industry.
          </p>
          <p className={`text-sm font-bold uppercase tracking-[0.22em] text-slate-500`}>Future development includes</p>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[
              "AI-powered carrier matching",
              "Predictive route optimization",
              "Advanced shipment analytics",
              "Automated compliance monitoring",
              "Intelligent load recommendations",
              "Expanded carrier network capabilities",
              "Smarter logistics decision support",
            ].map((item) => (
              <li key={item} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-700">
                {item}
              </li>
            ))}
          </ul>
          <p className={`max-w-4xl text-base leading-8 ${styles.copy}`}>
            We believe the future of logistics will be shaped by intelligent automation, real-time visibility, and stronger connectivity between every participant in the supply chain.
          </p>
        </section>

      </div>
    </div>
  );
}

function LoginPanel(props: Readonly<{
  loginForm: LoginState;
  showLoginPassword: boolean;
  submitting: SubmitState;
  onLoginFormChange: (updater: (prev: LoginState) => LoginState) => void;
  onTogglePassword: () => void;
  onLogin: () => void;
  onBack: () => void;
  onForgotPassword: () => void;
  onSetRole: (role: LoginRole) => void;
}>) {
  const { loginForm, showLoginPassword, submitting, onLoginFormChange, onTogglePassword, onLogin, onBack, onForgotPassword, onSetRole } = props;

  return (
    <div className="mt-6 space-y-4">
      <p className="text-xs uppercase tracking-wider text-slate-300">Login</p>
      {loginForm.role !== "driver" && (
        <input
          type="email"
          value={loginForm.email}
          onChange={(event) => onLoginFormChange((prev) => ({ ...prev, email: event.target.value }))}
          placeholder="Email"
          className="w-full rounded-xl border border-slate-600 bg-[#061B34] px-4 py-3 text-sm text-white outline-none ring-cyan-300 placeholder:text-slate-400 focus:ring-2"
        />
      )}

      <div className="relative">
        <input
          type={showLoginPassword ? "text" : "password"}
          value={loginForm.password}
          onChange={(event) => onLoginFormChange((prev) => ({ ...prev, password: event.target.value }))}
          placeholder={loginForm.role === "driver" ? "Driver token" : "Password"}
          className="w-full rounded-xl border border-slate-600 bg-[#061B34] px-4 py-3 pr-20 text-sm text-white outline-none ring-cyan-300 placeholder:text-slate-400 focus:ring-2"
        />
        <button
          type="button"
          onClick={onTogglePassword}
          aria-label={showLoginPassword ? "Hide password" : "Show password"}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-cyan-200 hover:text-cyan-100"
        >
          {showLoginPassword ? (
            <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 3l18 18" />
              <path d="M10.58 10.58a2 2 0 0 0 2.83 2.83" />
              <path d="M9.88 5.09A10.94 10.94 0 0 1 12 4.91c5.05 0 8.27 4.55 9 5.68a1 1 0 0 1 0 1.09 17.35 17.35 0 0 1-3.04 3.36" />
              <path d="M6.61 6.61A17.37 17.37 0 0 0 3 10.59a1 1 0 0 0 0 1.09c.73 1.13 3.95 5.68 9 5.68a10.5 10.5 0 0 0 4.24-.84" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12Z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          )}
        </button>
      </div>

      <p className="text-xs uppercase tracking-wider text-slate-300">Login As</p>
      <div className="grid gap-3 sm:grid-cols-3">
        {(["client", "carrier", "driver"] as LoginRole[]).map((role) => (
          <button
            key={role}
            onClick={() => onSetRole(role)}
            className={`rounded-xl px-4 py-3 text-sm font-semibold transition ${getLoginRoleClass(role, loginForm.role === role)}`}
          >
            {getLoginRoleLabel(role)}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-3">
        <button onClick={onLogin} disabled={submitting === "login"} className="rounded-xl bg-white px-4 py-3 text-sm font-semibold text-[#031227] hover:bg-slate-100">
          {submitting === "login" ? "Signing In..." : "Continue to Dashboard"}
        </button>
        {loginForm.role !== "driver" && (
          <button onClick={onForgotPassword} className="rounded-xl border border-slate-500 px-4 py-3 text-sm font-semibold text-slate-200 hover:bg-white/10">
            Forgot password
          </button>
        )}
        <button onClick={onBack} className="rounded-xl border border-slate-500 px-4 py-3 text-sm font-semibold text-slate-200 hover:bg-white/10">
          Back
        </button>
      </div>
    </div>
  );
}

function ForgotPasswordPanel(props: Readonly<{
  email: string;
  submitting: SubmitState;
  onEmailChange: (value: string) => void;
  onSubmit: () => void;
  onBack: () => void;
}>) {
  const { email, submitting, onEmailChange, onSubmit, onBack } = props;

  return (
    <div className="mt-6 space-y-4">
      <p className="text-xs uppercase tracking-wider text-slate-300">Reset Password</p>
      <p className="text-sm text-slate-200">
        Enter the email address associated with your account. We will send password reset instructions if the account exists.
      </p>
      <input
        type="email"
        value={email}
        onChange={(event) => onEmailChange(event.target.value)}
        placeholder="Email"
        className="w-full rounded-xl border border-slate-600 bg-[#061B34] px-4 py-3 text-sm text-white outline-none ring-cyan-300 placeholder:text-slate-400 focus:ring-2"
      />
      <div className="flex flex-wrap gap-3">
        <button onClick={onSubmit} disabled={submitting === "forgot_password"} className="rounded-xl bg-white px-4 py-3 text-sm font-semibold text-[#031227] hover:bg-slate-100 disabled:opacity-60">
          {submitting === "forgot_password" ? "Sending..." : "Send Reset Link"}
        </button>
        <button onClick={onBack} className="rounded-xl border border-slate-500 px-4 py-3 text-sm font-semibold text-slate-200 hover:bg-white/10">
          Back to Login
        </button>
      </div>
    </div>
  );
}

function SignupPanel(props: Readonly<{
  signupForm: SignupState;
  submitting: SubmitState;
  onSignupFormChange: (updater: (prev: SignupState) => SignupState) => void;
  onToggleVehicleType: (value: string) => void;
  onContinue: () => void;
  onBack: () => void;
}>) {
  const { signupForm, submitting, onSignupFormChange, onToggleVehicleType, onContinue, onBack } = props;

  return (
    <div className="mt-6 space-y-4">
      <p className="text-xs uppercase tracking-wider text-slate-300">Create Account</p>
      <input
        value={signupForm.fullName}
        onChange={(event) => onSignupFormChange((prev) => ({ ...prev, fullName: event.target.value }))}
        placeholder="Full name"
        className="w-full rounded-xl border border-slate-600 bg-[#061B34] px-4 py-3 text-sm text-white outline-none ring-cyan-300 placeholder:text-slate-400 focus:ring-2"
      />
      <input
        value={signupForm.companyName}
        onChange={(event) => onSignupFormChange((prev) => ({ ...prev, companyName: event.target.value }))}
        placeholder="Company name"
        className="w-full rounded-xl border border-slate-600 bg-[#061B34] px-4 py-3 text-sm text-white outline-none ring-cyan-300 placeholder:text-slate-400 focus:ring-2"
      />

      {signupForm.role === "carrier" && (
        <>
          <input
            value={signupForm.taxId}
            onChange={(event) => onSignupFormChange((prev) => ({ ...prev, taxId: event.target.value }))}
            placeholder="EIN / Tax ID"
            className="w-full rounded-xl border border-slate-600 bg-[#061B34] px-4 py-3 text-sm text-white outline-none ring-cyan-300 placeholder:text-slate-400 focus:ring-2"
          />
          <input
            value={signupForm.dotNumber}
            onChange={(event) => onSignupFormChange((prev) => ({ ...prev, dotNumber: event.target.value }))}
            placeholder="USDOT number"
            className="w-full rounded-xl border border-slate-600 bg-[#061B34] px-4 py-3 text-sm text-white outline-none ring-cyan-300 placeholder:text-slate-400 focus:ring-2"
          />
          <div className="rounded-xl border border-slate-600 bg-[#061B34] p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-300">Truck Types</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {truckTypeOptions.map((option) => (
                <label key={option.value} className="flex items-center gap-2 rounded px-2 py-1 text-sm text-slate-100 hover:bg-[#0A2648]">
                  <input
                    type="checkbox"
                    checked={signupForm.vehicleTypes.includes(option.value)}
                    onChange={() => onToggleVehicleType(option.value)}
                    className="h-4 w-4 rounded border-slate-500 text-emerald-500 focus:ring-emerald-500"
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
            <p className="mt-2 text-xs text-slate-300">Select one or more truck types for your carrier profile.</p>
          </div>
        </>
      )}

      <input
        type="email"
        value={signupForm.email}
        onChange={(event) => onSignupFormChange((prev) => ({ ...prev, email: event.target.value }))}
        placeholder="Email"
        className="w-full rounded-xl border border-slate-600 bg-[#061B34] px-4 py-3 text-sm text-white outline-none ring-cyan-300 placeholder:text-slate-400 focus:ring-2"
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <input
          type="password"
          value={signupForm.password}
          onChange={(event) => onSignupFormChange((prev) => ({ ...prev, password: event.target.value }))}
          placeholder="Password"
          className="w-full rounded-xl border border-slate-600 bg-[#061B34] px-4 py-3 text-sm text-white outline-none ring-cyan-300 placeholder:text-slate-400 focus:ring-2"
        />
        <input
          type="password"
          value={signupForm.confirmPassword}
          onChange={(event) => onSignupFormChange((prev) => ({ ...prev, confirmPassword: event.target.value }))}
          placeholder="Confirm password"
          className="w-full rounded-xl border border-slate-600 bg-[#061B34] px-4 py-3 text-sm text-white outline-none ring-cyan-300 placeholder:text-slate-400 focus:ring-2"
        />
      </div>

      <p className="text-xs uppercase tracking-wider text-slate-300">Sign Up As</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <button
          onClick={() => onSignupFormChange((prev) => ({ ...prev, role: "client" }))}
          className={`rounded-xl px-4 py-3 text-sm font-semibold transition ${signupForm.role === "client" ? "bg-indigo-500 text-white" : "border border-slate-600 bg-[#061B34] text-slate-200 hover:bg-[#0A2648]"}`}
        >
          Shipper
        </button>
        <button
          onClick={() => onSignupFormChange((prev) => ({ ...prev, role: "carrier" }))}
          className={`rounded-xl px-4 py-3 text-sm font-semibold transition ${signupForm.role === "carrier" ? "bg-emerald-500 text-white" : "border border-slate-600 bg-[#061B34] text-slate-200 hover:bg-[#0A2648]"}`}
        >
          Carrier
        </button>
      </div>

      <button onClick={onContinue} disabled={submitting !== null} className="rounded-xl bg-cyan-500 px-4 py-3 text-sm font-semibold text-[#031227] hover:bg-cyan-400 disabled:opacity-60">
        {submitting === "signup_code" ? "Sending Code..." : "Continue"}
      </button>

      <button onClick={onBack} className="rounded-xl border border-slate-500 px-4 py-3 text-sm font-semibold text-slate-200 hover:bg-white/10">
        Back
      </button>
    </div>
  );
}

function SignupVerificationPanel(props: Readonly<{
  signupForm: SignupState;
  submitting: SubmitState;
  debugCode: string | null;
  onSignupFormChange: (updater: (prev: SignupState) => SignupState) => void;
  onVerify: () => void;
  onSendCode: () => void;
  onBackToForm: () => void;
}>) {
  const { signupForm, submitting, debugCode, onSignupFormChange, onVerify, onSendCode, onBackToForm } = props;

  return (
    <div className="mt-6 space-y-4">
      <p className="text-xs uppercase tracking-wider text-slate-300">Verify Email</p>
      <p className="text-sm text-slate-200">
        Enter the 6-digit code sent to <span className="font-semibold text-cyan-200">{signupForm.email.trim().toLowerCase()}</span>.
      </p>
      <input
        value={signupForm.emailVerificationCode}
        onChange={(event) => onSignupFormChange((prev) => ({ ...prev, emailVerificationCode: event.target.value.replace(/\D/g, "").slice(0, 6) }))}
        placeholder="6-digit verification code"
        maxLength={6}
        className="w-full rounded-xl border border-slate-600 bg-[#061B34] px-4 py-3 text-sm text-white outline-none ring-cyan-300 placeholder:text-slate-400 focus:ring-2"
      />
      <p className="text-sm text-slate-300">
        Verify your email to continue. Click the button below to send a 6-digit code, then enter it here.
      </p>
      {debugCode && (
        <div className="rounded-xl border border-cyan-300/40 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-100">
          <p className="font-semibold">Local test code</p>
          <p className="mt-1 text-lg font-mono tracking-[0.3em] text-cyan-50">{debugCode}</p>
        </div>
      )}

      <button onClick={onVerify} disabled={submitting !== null} className="rounded-xl bg-cyan-500 px-4 py-3 text-sm font-semibold text-[#031227] hover:bg-cyan-400 disabled:opacity-60">
        {submitting === "signup" ? "Verifying..." : "Verify & Create Account"}
      </button>

      <div className="flex flex-wrap gap-3">
        <button
          onClick={onSendCode}
          disabled={submitting !== null}
          className="rounded-xl border border-cyan-400/60 px-4 py-3 text-sm font-semibold text-cyan-100 hover:bg-cyan-500/15 disabled:opacity-60"
        >
          {submitting === "signup_code" ? "Sending..." : "Send Code"}
        </button>
        <button onClick={onBackToForm} disabled={submitting !== null} className="rounded-xl border border-slate-500 px-4 py-3 text-sm font-semibold text-slate-200 hover:bg-white/10 disabled:opacity-60">
          Back to Form
        </button>
      </div>
    </div>
  );
}

function PageShell(props: Readonly<{
  view: LandingView;
  isAboutView: boolean;
  activeSessionName: string | null;
  message: string;
  loginMenuOpen: boolean;
  loginMenuRef: React.RefObject<HTMLDivElement | null>;
  showLoginPassword: boolean;
  loginForm: LoginState;
  signupForm: SignupState;
  pricingSubscription: PricingSubscription;
  resourceSection: ResourceSection;
  submitting: SubmitState;
  onOpenLanding: () => void;
  onOpenPricing: () => void;
  onOpenShipperSubscription: () => void;
  onOpenCarrierSubscription: () => void;
  onOpenResources: () => void;
  onOpenAbout: () => void;
  onToggleLoginMenu: () => void;
  onOpenRoleLogin: (role: LoginRole) => void;
  onCreateAccount: () => void;
  onOpenProfile: () => void;
  onSignOut: () => void;
  onToggleShowLoginPassword: () => void;
  onLogin: () => void;
  onForgotPassword: () => void;
  onSubmitForgotPassword: () => void;
  onEmailChange: (value: string) => void;
  onBackToLogin: () => void;
  onLoginFormChange: (updater: (prev: LoginState) => LoginState) => void;
  onSignupFormChange: (updater: (prev: SignupState) => SignupState) => void;
  onToggleVehicleType: (value: string) => void;
  onRequestSignupCode: () => void;
  onBackToSignupForm: () => void;
  signupDebugCode: string | null;
  onSelectPricingSubscription: (subscription: PricingSubscription) => void;
  onSelectResourceSection: (section: ResourceSection) => void;
  onSignup: () => void;
  onBeginSignupVerification: () => void;
  onBackToLanding: () => void;
}>) {
  const {
    view,
    isAboutView,
    activeSessionName,
    message,
    loginMenuOpen,
    loginMenuRef,
    showLoginPassword,
    loginForm,
    signupForm,
    pricingSubscription,
    resourceSection,
    submitting,
    onOpenLanding,
    onOpenPricing,
    onOpenShipperSubscription,
    onOpenCarrierSubscription,
    onOpenResources,
    onOpenAbout,
    onToggleLoginMenu,
    onOpenRoleLogin,
    onCreateAccount,
    onSignOut,
    onToggleShowLoginPassword,
    onLogin,
    onForgotPassword,
    onSubmitForgotPassword,
    onEmailChange,
    onBackToLogin,
    onLoginFormChange,
    onSignupFormChange,
    onToggleVehicleType,
    onRequestSignupCode,
    onBackToSignupForm,
    signupDebugCode,
    onSelectPricingSubscription,
    onSelectResourceSection,
    onSignup,
    onBeginSignupVerification,
    onBackToLanding,
  } = props;

  const isPricingView = view === "pricing";
  const isResourcesView = view === "resources";
  let mainClass = "relative min-h-screen overflow-hidden bg-[#020B16] text-white";
  if (isAboutView) {
    mainClass = "relative min-h-screen overflow-hidden bg-white text-slate-900";
  } else if (isPricingView) {
    mainClass = "relative min-h-screen overflow-hidden bg-black text-white";
  } else if (isResourcesView) {
    mainClass = "relative min-h-screen overflow-hidden bg-white text-slate-900";
  }

  let content: React.ReactNode;
  if (view === "about") {
    content = (
      <div className="w-full px-0 md:px-2 lg:px-4">
        <AboutPanel onBackToHome={onBackToLanding} />
      </div>
    );
  } else if (view === "pricing") {
    content = (
      <section className="w-full max-w-5xl rounded-3xl border border-slate-300 bg-slate-100 p-7 text-slate-900 shadow-[0_20px_80px_rgba(0,0,0,0.12)] md:p-9">
        <PricingPanel activeSubscription={pricingSubscription} onSelectSubscription={onSelectPricingSubscription} />
      </section>
    );
  } else if (view === "resources") {
    content = (
      <div className="w-full px-0 md:px-2 lg:px-4">
        <ResourcesPanel section={resourceSection} onSelectSection={onSelectResourceSection} />
      </div>
    );
  } else {
    content = (
      <section className="w-full max-w-xl rounded-3xl border border-cyan-300/25 bg-[#031227]/75 p-7 text-white shadow-[0_20px_80px_rgba(0,0,0,0.45)] backdrop-blur-sm md:p-9">
        {view === "landing" && <LandingPanel message={message} />}
        {view !== "landing" && message && (
          <p className="mb-4 rounded-xl border border-amber-300/50 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
            {message}
          </p>
        )}
        {view === "login" && (
          <LoginPanel
            loginForm={loginForm}
            showLoginPassword={showLoginPassword}
            submitting={submitting}
            onLoginFormChange={onLoginFormChange}
            onTogglePassword={onToggleShowLoginPassword}
            onLogin={onLogin}
            onBack={onBackToLanding}
            onForgotPassword={onForgotPassword}
            onSetRole={onOpenRoleLogin}
          />
        )}
        {view === "forgot_password" && (
          <ForgotPasswordPanel
            email={loginForm.email}
            submitting={submitting}
            onEmailChange={onEmailChange}
            onSubmit={onSubmitForgotPassword}
            onBack={onBackToLogin}
          />
        )}
        {view === "signup" && (
          <SignupPanel
            signupForm={signupForm}
            submitting={submitting}
            onSignupFormChange={onSignupFormChange}
            onToggleVehicleType={onToggleVehicleType}
            onContinue={onBeginSignupVerification}
            onBack={onBackToLanding}
          />
        )}
        {view === "signup_verify" && (
          <SignupVerificationPanel
            signupForm={signupForm}
            submitting={submitting}
            debugCode={signupDebugCode}
            onSignupFormChange={onSignupFormChange}
            onVerify={onSignup}
            onSendCode={onRequestSignupCode}
            onBackToForm={onBackToSignupForm}
          />
        )}
      </section>
    );
  }

  return (
    <main className={mainClass}>
      {!isAboutView && !isPricingView && !isResourcesView && (
        <>
          <GlobeMarketJourneyBackground />
          <div className="absolute inset-0 bg-gradient-to-b from-[#020B16]/35 via-[#020B16]/70 to-[#020B16]/90" />
        </>
      )}

      <div className="relative z-10 flex min-h-screen flex-col">
        <TopNavigation
          isAboutView={isAboutView}
          activeSessionName={activeSessionName}
          loginMenuOpen={loginMenuOpen}
          loginMenuRef={loginMenuRef}
          onOpenLanding={onOpenLanding}
          onOpenPricing={onOpenPricing}
          onOpenShipperSubscription={onOpenShipperSubscription}
          onOpenCarrierSubscription={onOpenCarrierSubscription}
          onOpenResources={onOpenResources}
          onOpenAbout={onOpenAbout}
          onToggleLoginMenu={onToggleLoginMenu}
          onOpenRoleLogin={onOpenRoleLogin}
          onCreateAccount={onCreateAccount}
          onOpenProfile={props.onOpenProfile}
          onSignOut={onSignOut}
        />

        <div className={`mx-auto flex w-full flex-1 items-center p-6 pt-8 md:p-10 ${isAboutView || isPricingView || isResourcesView ? "max-w-7xl items-start" : "max-w-6xl items-center"}`}>
          {content}
        </div>
      </div>
    </main>
  );
}

export default function Home() {
  const [view, setView] = useState<LandingView>("landing");
  const [loginMenuOpen, setLoginMenuOpen] = useState(false);
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [pricingSubscription, setPricingSubscription] = useState<PricingSubscription>("shipper");
  const [resourceSection, setResourceSection] = useState<ResourceSection>("events");
  const [loginForm, setLoginForm] = useState<LoginState>({
    email: "",
    password: "",
    role: "client",
  });
  const [signupForm, setSignupForm] = useState<SignupState>({
    fullName: "",
    companyName: "",
    taxId: "",
    dotNumber: "",
    vehicleTypes: ["dry_van"],
    email: "",
    password: "",
    confirmPassword: "",
    emailVerificationCode: "",
    role: "client",
  });
  const [activeSessionName, setActiveSessionName] = useState<string | null>(null);
  const [activeSessionRole, setActiveSessionRole] = useState<LoginRole | null>(null);
  const [message, setMessage] = useState("");
  const [signupDebugCode, setSignupDebugCode] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<SubmitState>(null);
  const loginMenuRef = useRef<HTMLDivElement | null>(null);

  function openRoleLogin(role: LoginRole) {
    setMessage("");
    setView("login");
    setLoginMenuOpen(false);
    setLoginForm((prev) => ({ ...prev, role }));
  }

  function openAboutSection() {
    setMessage("");
    setView("about");
    setLoginMenuOpen(false);
  }

  function signOut() {
    clearAuthLiteSession();
    clearDriverPortalSession();
    setActiveSessionName(null);
    setActiveSessionRole(null);
    trackEvent("auth.sign_out");
  }

  function openActiveProfile() {
    if (!activeSessionRole) {
      return;
    }
    globalThis.window.location.assign(resolveProfilePath(activeSessionRole));
  }

  function openLanding() {
    setView("landing");
    setMessage("");
  }
  function openPricing() {
    setView("pricing");
    setMessage("");
  }
  function openResources() {
    setView("resources");
    setResourceSection("events");
    setMessage("");
  }
  function openShipperSubscription() {
    setView("pricing");
    setPricingSubscription("shipper");
    setMessage("");
  }
  function openCarrierSubscription() {
    setView("pricing");
    setPricingSubscription("carrier");
    setMessage("");
  }

  useEffect(() => {
    const kickoff = setTimeout(() => {
      const session = getAuthLiteSession();
      if (session) {
        setActiveSessionName(session.displayName);
        setActiveSessionRole(session.role);
      }
    }, 0);

    return () => clearTimeout(kickoff);
  }, []);

  useEffect(() => {
    function handleDocumentClick(event: MouseEvent) {
      if (!loginMenuRef.current || loginMenuRef.current.contains(event.target as Node)) {
        return;
      }
      setLoginMenuOpen(false);
    }

    globalThis.document.addEventListener("click", handleDocumentClick);
    return () => globalThis.document.removeEventListener("click", handleDocumentClick);
  }, []);

  function forgotPassword() {
    if (loginForm.role === "driver") {
      return;
    }
    setMessage("");
    setView("forgot_password");
  }

  async function submitForgotPassword() {
    const email = loginForm.email.trim().toLowerCase();
    if (!email) {
      setMessage("Enter your email address to reset your password.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setMessage("Enter a valid email address.");
      return;
    }

    const role: AuthRole = loginForm.role === "driver" ? "client" : loginForm.role;

    setSubmitting("forgot_password");
    try {
      await requestPasswordReset({ email, role });
      setMessage("If an account exists for that email, reset instructions have been sent.");
      setView("login");
    } catch (error: unknown) {
      setMessage(getErrorMessage(error));
    } finally {
      setSubmitting(null);
    }
  }

  async function login() {
    try {
      setSubmitting("login");

      if (loginForm.role === "driver") {
        const loginToken = loginForm.password.trim();
        if (!loginToken) {
          setMessage("Enter your driver token.");
          return;
        }
        const session = await driverLogin({ login_token: loginToken });
        setDriverPortalSession(session);
        setAuthLiteSession("driver", session.driver_name, session.carrier_email);
        setActiveSessionName(session.driver_name);
        setActiveSessionRole("driver");
        trackEvent("auth.sign_in", { role: "driver", displayName: session.driver_name });
        setMessage("");
        navigateToDashboard("driver");
        return;
      }

      const email = loginForm.email.trim().toLowerCase();
      if (!email || !loginForm.password.trim()) {
        setMessage("Enter your email and password.");
        return;
      }

      const account = await loginAccount({
        email,
        password: loginForm.password,
        role: loginForm.role,
      });

      setAuthLiteSession(account.role, account.display_name, account.email);
      setActiveSessionName(account.display_name);
      setActiveSessionRole(account.role);
      trackEvent("auth.sign_in", { role: account.role, displayName: account.display_name });
      setMessage("");
      navigateToDashboard(account.role);
    } catch (error: unknown) {
      setMessage(getErrorMessage(error));
    } finally {
      setSubmitting(null);
    }
  }

  function validateSignupForm(): { email: string; normalizedTaxId: string; normalizedDotNumber: string } | null {
    const email = signupForm.email.trim().toLowerCase();
    const normalizedTaxId = signupForm.taxId.trim().replace(/\D/g, "");
    const normalizedDotNumber = signupForm.dotNumber.trim().replace(/\D/g, "");

    const validationMessage = getSignupValidationMessage({
      form: signupForm,
      normalizedTaxId,
      normalizedDotNumber,
    });
    if (validationMessage) {
      setMessage(validationMessage);
      return null;
    }

    return { email, normalizedTaxId, normalizedDotNumber };
  }

  async function beginSignupVerification() {
    const validated = validateSignupForm();
    if (!validated) {
      return;
    }

    setSignupForm((prev) => ({ ...prev, emailVerificationCode: "" }));
    setSignupDebugCode(null);
    setView("signup_verify");
    setMessage("Verify your email to continue.");
  }

  async function signup() {
    const fullName = signupForm.fullName.trim();
    const companyName = signupForm.companyName.trim();
    const taxId = signupForm.taxId.trim();
    const dotNumber = signupForm.dotNumber.trim();
    const email = signupForm.email.trim().toLowerCase();
    const password = signupForm.password;
    const verificationCode = signupForm.emailVerificationCode.trim();
    const isCarrier = signupForm.role === "carrier";
    const carrierVehicleTypes = signupForm.vehicleTypes.length > 0 ? signupForm.vehicleTypes : ["dry_van"];
    if (!validateSignupForm()) {
      return;
    }

    if (!/^\d{6}$/.test(verificationCode)) {
      setMessage("Enter the 6-digit verification code sent to your email.");
      return;
    }

    try {
      setSubmitting("signup");
      const account = await signupAccount({
        full_name: fullName,
        company_name: companyName,
        tax_id: isCarrier ? taxId : null,
        dot_number: isCarrier ? dotNumber : null,
        id_document_name: "legacy-signup-id.txt",
        id_document_mime_type: "text/plain",
        id_document_base64: "bGVnYWN5LXNpZ251cC1pZA==",
        vehicle_types: isCarrier ? carrierVehicleTypes : null,
        email,
        password,
        email_verification_code: verificationCode,
        role: signupForm.role,
      });

      setAuthLiteSession(account.role, account.display_name, account.email);
      setActiveSessionName(account.display_name);
      setActiveSessionRole(account.role);
      setSignupDebugCode(null);
      trackEvent("auth.sign_up", { role: account.role, displayName: account.display_name });
      setMessage("");
      navigateToDashboard(account.role);
    } catch (error: unknown) {
      setMessage(getErrorMessage(error));
    } finally {
      setSubmitting(null);
    }
  }

  async function requestSignupCode() {
    const validated = validateSignupForm();
    if (!validated) {
      return;
    }

    try {
      setSubmitting("signup_code");
      const response = await requestSignupVerificationCode({ email: validated.email, role: signupForm.role });
      setSignupDebugCode(response.debug_code ?? null);
      setMessage(
        response.debug_code
          ? `Verification code sent. Local test code: ${response.debug_code}`
          : "Verification code sent. Check your email and enter the 6-digit code to continue."
      );
    } catch (error: unknown) {
      setMessage(getErrorMessage(error));
    } finally {
      setSubmitting(null);
    }
  }

  function toggleSignupCarrierVehicleType(value: string) {
    setSignupForm((prev) => ({
      ...prev,
      vehicleTypes: prev.vehicleTypes.includes(value) ? prev.vehicleTypes.filter((item) => item !== value) : [...prev.vehicleTypes, value],
    }));
  }

  return (
    <>
      <PageShell
        view={view}
        isAboutView={view === "about"}
        activeSessionName={activeSessionName}
        message={message}
        loginMenuOpen={loginMenuOpen}
        loginMenuRef={loginMenuRef}
        showLoginPassword={showLoginPassword}
        loginForm={loginForm}
        signupForm={signupForm}
        pricingSubscription={pricingSubscription}
        resourceSection={resourceSection}
        submitting={submitting}
        onOpenLanding={openLanding}
        onOpenPricing={openPricing}
        onOpenShipperSubscription={openShipperSubscription}
        onOpenCarrierSubscription={openCarrierSubscription}
        onOpenResources={openResources}
        onOpenAbout={openAboutSection}
        onToggleLoginMenu={() => setLoginMenuOpen((prev) => !prev)}
        onOpenRoleLogin={openRoleLogin}
        onCreateAccount={() => {
          setLoginMenuOpen(false);
          setMessage("");
          setView("signup");
        }}
        onOpenProfile={openActiveProfile}
        onSignOut={signOut}
        onToggleShowLoginPassword={() => setShowLoginPassword((prev) => !prev)}
        onLogin={login}
        onForgotPassword={forgotPassword}
        onSubmitForgotPassword={submitForgotPassword}
        onEmailChange={(value) => setLoginForm((prev) => ({ ...prev, email: value }))}
        onBackToLogin={() => setView("login")}
        onLoginFormChange={setLoginForm}
        onSignupFormChange={setSignupForm}
        onToggleVehicleType={toggleSignupCarrierVehicleType}
        onRequestSignupCode={requestSignupCode}
        onBackToSignupForm={() => {
          setSignupDebugCode(null);
          setView("signup");
          setMessage("");
        }}
        signupDebugCode={signupDebugCode}
        onSelectPricingSubscription={setPricingSubscription}
        onSelectResourceSection={setResourceSection}
        onSignup={signup}
        onBeginSignupVerification={beginSignupVerification}
        onBackToLanding={() => {
          setSignupDebugCode(null);
          setMessage("");
          setView("landing");
        }}
      />
      <LiveChatSupport />
    </>
  );
}





