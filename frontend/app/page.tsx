"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  clearAuthLiteSession,
  clearDriverPortalSession,
  getAuthLiteSession,
  getDriverPortalSession,
  setAuthLiteSession,
  setDriverPortalSession,
} from "@/lib/auth-lite";
import GlobeMarketJourneyBackground from "@/app/components/globe-market-journey-background";
import LiveChatSupport from "@/app/components/live-chat-support";
import { AuthRole, createDiditSession, driverLogin, loginAccount, requestPasswordReset, requestSignupVerificationCode, signupAccount, verifySignupEmailCode } from "@/lib/logistics-api";
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

type LoginRole = "client" | "carrier" | "driver_token" | "driver";
type LandingView = "landing" | "pricing" | "resources" | "about" | "login" | "signup_role" | "signup" | "signup_verify" | "signup_identity" | "signup_profile" | "signup_review" | "signup_submitted" | "forgot_password";
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
  phone: string;
  profileNotes: string;
  email: string;
  password: string;
  confirmPassword: string;
  emailVerificationCode: string;
  diditSessionId: string;
  diditConsent: boolean;
  idDocumentName: string;
  idDocumentMimeType: string;
  idDocumentBase64: string;
  role: "client" | "carrier" | "driver";
};

type SubmitState = null | "login" | "signup" | "signup_code" | "forgot_password" | "didit";

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
  requireIdentity?: boolean;
}): string | null {
  const { form, normalizedTaxId, normalizedDotNumber, requireIdentity = true } = params;
  const fullName = form.fullName.trim();
  const companyName = form.companyName.trim();
  const email = form.email.trim().toLowerCase();
  const password = form.password;
  const isCarrier = form.role === "carrier";

  if (!fullName || !companyName || !email || !password) return "Complete all sign-up fields.";
  if (!isValidEmailAddress(email)) return "Enter a valid email address.";
  if (!isStrongPassword(password)) {
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
  if (requireIdentity && !form.diditSessionId) {
    return "Complete identity verification to continue.";
  }

  return null;
}

function SignupRolePanel(props: Readonly<{ role: AuthRole; onSelectRole: (role: AuthRole) => void; onContinue: () => void; onBack: () => void }>) {
  const { role, onSelectRole, onContinue, onBack } = props;
  return (
    <div className="mt-6 space-y-4">
      <p className="text-xs uppercase tracking-wider text-slate-300">1. Select Account Type</p>
      <div className="grid gap-3 sm:grid-cols-3">
        {(["client", "carrier", "driver"] as const).map((accountRole) => (
          <button key={accountRole} type="button" onClick={() => onSelectRole(accountRole)} className={`rounded-xl px-4 py-4 text-sm font-semibold transition ${role === accountRole ? "bg-cyan-500 text-[#031227]" : "border border-slate-600 bg-[#061B34] text-slate-200 hover:bg-[#0A2648]"}`}>
            {accountRole === "client" ? "Shipper" : accountRole[0].toUpperCase() + accountRole.slice(1)}
          </button>
        ))}
      </div>
      <button type="button" onClick={onContinue} className="rounded-xl bg-cyan-500 px-4 py-3 text-sm font-semibold text-[#031227] hover:bg-cyan-400">Continue</button>
      <button type="button" onClick={onBack} className="ml-3 rounded-xl border border-slate-500 px-4 py-3 text-sm font-semibold text-slate-200 hover:bg-white/10">Back</button>
    </div>
  );
}

function SignupIdentityPanel(props: Readonly<{ signupForm: SignupState; submitting: SubmitState; onSignupFormChange: (updater: (prev: SignupState) => SignupState) => void; onStart: () => void; onBack: () => void }>) {
  const { signupForm, submitting, onSignupFormChange, onStart, onBack } = props;
  return <div className="mt-6 space-y-4"><p className="text-xs uppercase tracking-wider text-slate-300">4. Identity Verification</p><DiditIdentityVerification role={signupForm.role} sessionId={signupForm.diditSessionId} consent={signupForm.diditConsent} submitting={submitting} onConsentChange={(diditConsent) => onSignupFormChange((prev) => ({ ...prev, diditConsent }))} onStart={onStart} /><button type="button" onClick={onBack} className="rounded-xl border border-slate-500 px-4 py-3 text-sm font-semibold text-slate-200 hover:bg-white/10">Back</button></div>;
}

function SignupProfilePanel(props: Readonly<{ signupForm: SignupState; onSignupFormChange: (updater: (prev: SignupState) => SignupState) => void; onToggleVehicleType: (value: string) => void; onContinue: () => void; onBack: () => void }>) {
  const { signupForm, onSignupFormChange, onToggleVehicleType, onContinue, onBack } = props;
  const notesLabel = signupForm.role === "driver" ? "Driving experience and equipment" : signupForm.role === "client" ? "Freight or shipping needs" : "Operating notes";
  return <div className="mt-6 space-y-4"><p className="text-xs uppercase tracking-wider text-slate-300">5. Role-Specific Profile</p><input value={signupForm.phone} onChange={(event) => onSignupFormChange((prev) => ({ ...prev, phone: event.target.value }))} placeholder="Contact phone" type="tel" className="w-full rounded-xl border border-slate-600 bg-[#061B34] px-4 py-3 text-sm text-white outline-none ring-cyan-300 placeholder:text-slate-400 focus:ring-2" />{signupForm.role === "carrier" ? <div className="rounded-xl border border-slate-600 bg-[#061B34] p-3"><p className="mb-2 text-sm font-semibold text-white">Fleet equipment</p><div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{truckTypeOptions.map((option) => <label key={option.value} className="flex items-center gap-2 text-sm text-slate-100"><input type="checkbox" checked={signupForm.vehicleTypes.includes(option.value)} onChange={() => onToggleVehicleType(option.value)} className="h-4 w-4 rounded border-slate-500 text-emerald-500" /><span>{option.label}</span></label>)}</div></div> : <textarea value={signupForm.profileNotes} onChange={(event) => onSignupFormChange((prev) => ({ ...prev, profileNotes: event.target.value }))} placeholder={notesLabel} maxLength={400} rows={4} className="w-full resize-y rounded-xl border border-slate-600 bg-[#061B34] px-4 py-3 text-sm text-white outline-none ring-cyan-300 placeholder:text-slate-400 focus:ring-2" />}<button type="button" onClick={onContinue} className="rounded-xl bg-cyan-500 px-4 py-3 text-sm font-semibold text-[#031227] hover:bg-cyan-400">Review Application</button><button type="button" onClick={onBack} className="ml-3 rounded-xl border border-slate-500 px-4 py-3 text-sm font-semibold text-slate-200 hover:bg-white/10">Back</button></div>;
}

function SignupReviewPanel(props: Readonly<{ signupForm: SignupState; submitting: SubmitState; onSubmit: () => void; onBack: () => void }>) {
  const { signupForm, submitting, onSubmit, onBack } = props;
  return <div className="mt-6 space-y-4"><p className="text-xs uppercase tracking-wider text-slate-300">6. Review / Approval</p><div className="rounded-xl border border-slate-600 bg-[#061B34] p-4 text-sm text-slate-200"><p className="font-semibold text-white">{signupForm.companyName}</p><p>{signupForm.fullName}</p><p>{signupForm.email.trim().toLowerCase()}</p><p className="mt-3 text-cyan-200">Email and identity verification are complete. Submit your application for activation.</p></div><button type="button" onClick={onSubmit} disabled={submitting !== null} className="rounded-xl bg-cyan-500 px-4 py-3 text-sm font-semibold text-[#031227] hover:bg-cyan-400 disabled:opacity-60">{submitting === "signup" ? "Submitting..." : "Submit for Approval"}</button><button type="button" onClick={onBack} disabled={submitting !== null} className="ml-3 rounded-xl border border-slate-500 px-4 py-3 text-sm font-semibold text-slate-200 hover:bg-white/10">Back</button></div>;
}

function SignupSubmittedPanel(props: Readonly<{ onBackToLogin: () => void }>) {
  const { onBackToLogin } = props;
  return <div className="mt-6 space-y-4"><p className="text-xs uppercase tracking-wider text-slate-300">7. Account Activation</p><div className="rounded-xl border border-cyan-300/40 bg-cyan-500/10 p-4 text-sm text-cyan-50"><p className="font-semibold text-white">Application submitted for review</p><p className="mt-2">Your account will be activated after approval. You can sign in once activation is complete.</p></div><button type="button" onClick={onBackToLogin} className="rounded-xl bg-cyan-500 px-4 py-3 text-sm font-semibold text-[#031227] hover:bg-cyan-400">Back to Login</button></div>;
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
  if (role === "driver_token") return "bg-amber-500 text-white";
  return "bg-orange-600 text-white";
}

function getLoginRoleLabel(role: LoginRole): string {
  if (role === "client") return "Shipper";
  if (role === "carrier") return "Carrier";
  if (role === "driver_token") return "Token Login";
  return "Driver Login";
}

function resolveDashboardPath(role: LoginRole): string {
  if (role === "carrier") return "/carrier";
  if (role === "driver_token") return "/driver";
  if (role === "driver") return "/driver-application";
  return "/client";
}

function resolveProfilePath(role: LoginRole): string {
  if (role === "driver_token") return "/driver";
  if (role === "driver") return "/driver-application";
  return `${resolveDashboardPath(role)}?account=profile`;
}

function isValidEmailAddress(email: string): boolean {
  const atIndex = email.indexOf("@");
  if (atIndex <= 0 || atIndex !== email.lastIndexOf("@")) {
    return false;
  }

  const localPart = email.slice(0, atIndex);
  const domainPart = email.slice(atIndex + 1);
  if (!localPart || !domainPart || domainPart.startsWith(".") || domainPart.endsWith(".")) {
    return false;
  }

  return domainPart.includes(".") && !email.includes(" ");
}

function isStrongPassword(password: string): boolean {
  let hasLetter = false;
  let hasNumber = false;

  for (const character of password) {
    if (character >= "0" && character <= "9") {
      hasNumber = true;
    } else if ((character >= "A" && character <= "Z") || (character >= "a" && character <= "z")) {
      hasLetter = true;
    }

    if (hasLetter && hasNumber) {
      return password.length >= 8;
    }
  }

  return false;
}

function isSixDigitCode(value: string): boolean {
  return value.length === 6 && [...value].every((character) => character >= "0" && character <= "9");
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
  onOpenResources: () => void;
  onOpenAbout: () => void;
}>) {
  const { isAboutView, onOpenPricing, onOpenResources, onOpenAbout } = props;
  const tabClass = isAboutView
    ? "text-slate-700 hover:border-slate-300 hover:bg-slate-100"
    : "text-slate-200 hover:border-cyan-300/40 hover:bg-cyan-500/10";
  const [resourcesMenuOpen, setResourcesMenuOpen] = useState(false);
  const [supportMenuOpen, setSupportMenuOpen] = useState(false);
  const resourcesMenuRef = useRef<HTMLDivElement | null>(null);
  const supportMenuRef = useRef<HTMLDivElement | null>(null);

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
    function handleResourcesMenuPointerDown(event: PointerEvent) {
      closeResourcesMenuIfOutside(event.target);
    }

    function handleSupportMenuPointerDown(event: PointerEvent) {
      closeSupportMenuIfOutside(event.target);
    }

    globalThis.document.addEventListener("pointerdown", handleResourcesMenuPointerDown, true);
    globalThis.document.addEventListener("pointerdown", handleSupportMenuPointerDown, true);
    return () => {
      globalThis.document.removeEventListener("pointerdown", handleResourcesMenuPointerDown, true);
      globalThis.document.removeEventListener("pointerdown", handleSupportMenuPointerDown, true);
    };
  }, []);

  return (
    <div className="order-3 flex w-full gap-2 overflow-x-auto pb-1 text-sm md:order-2 md:ml-8 md:w-auto md:overflow-visible md:pb-0">
      <button type="button" onClick={onOpenPricing} className={`whitespace-nowrap rounded-full border border-transparent px-3 py-1.5 transition ${tabClass}`}>
        Pricing
      </button>
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
          <button type="button" onClick={() => onOpenRoleLogin("driver_token")} className={`w-full rounded-lg px-3 py-2 text-left text-sm transition ${isAboutView ? "text-slate-800 hover:bg-slate-100" : "text-slate-100 hover:bg-cyan-500/20"}`}>
            Token Login
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

function PricingPanel() {
  return (
    <div className="mt-8 space-y-8 text-slate-900 md:mt-10">
      <div className="space-y-3">
        <p className="text-xs uppercase tracking-[0.22em] text-cyan-700">Pricing</p>
        <h2 className="text-3xl font-semibold text-slate-950 md:text-5xl">Subscription Models</h2>
        <p className="max-w-3xl text-sm leading-6 text-slate-700 md:text-base">
          Choose the subscription that matches how your team operates.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <article id="shipper-subscription" className="rounded-3xl border border-cyan-200 bg-white p-6 shadow-[0_20px_60px_rgba(15,23,42,0.08)]">
          <p className="text-xs font-bold uppercase tracking-[0.24em] text-cyan-700">Shipper Subscription</p>
          <h3 className="mt-3 text-2xl font-semibold text-slate-950">Built for teams that move freight every day</h3>
          <p className="mt-3 text-sm leading-6 text-slate-700">
            Tools to create shipments, choose carriers, and keep every load visible from pickup through delivery.
          </p>
          <ul className="mt-5 space-y-3 text-sm leading-6 text-slate-700">
            <li className="flex gap-3"><span className="mt-2 h-2 w-2 rounded-full bg-cyan-500" />Create and manage shipment requests</li>
            <li className="flex gap-3"><span className="mt-2 h-2 w-2 rounded-full bg-cyan-500" />Compare carrier offers in one view</li>
            <li className="flex gap-3"><span className="mt-2 h-2 w-2 rounded-full bg-cyan-500" />Track status updates and live movement</li>
            <li className="flex gap-3"><span className="mt-2 h-2 w-2 rounded-full bg-cyan-500" />Release payments and manage billing flow</li>
            <li className="flex gap-3"><span className="mt-2 h-2 w-2 rounded-full bg-cyan-500" />Monitor delivery performance in one dashboard</li>
          </ul>
        </article>

        <article id="carrier-subscription" className="rounded-3xl border border-cyan-200 bg-white p-6 shadow-[0_20px_60px_rgba(15,23,42,0.08)]">
          <p className="text-xs font-bold uppercase tracking-[0.24em] text-cyan-700">Carrier Subscription</p>
          <h3 className="mt-3 text-2xl font-semibold text-slate-950">Designed for carriers that want steady load access</h3>
          <p className="mt-3 text-sm leading-6 text-slate-700">
            Access available loads, coordinate drivers, and manage your operation with faster updates and less manual work.
          </p>
          <ul className="mt-5 space-y-3 text-sm leading-6 text-slate-700">
            <li className="flex gap-3"><span className="mt-2 h-2 w-2 rounded-full bg-cyan-500" />Browse available shipments and lane opportunities</li>
            <li className="flex gap-3"><span className="mt-2 h-2 w-2 rounded-full bg-cyan-500" />Submit and manage carrier offers</li>
            <li className="flex gap-3"><span className="mt-2 h-2 w-2 rounded-full bg-cyan-500" />Coordinate driver updates in real time</li>
            <li className="flex gap-3"><span className="mt-2 h-2 w-2 rounded-full bg-cyan-500" />Keep shipment status and delivery info in sync</li>
            <li className="flex gap-3"><span className="mt-2 h-2 w-2 rounded-full bg-cyan-500" />Streamline your day with a single operating dashboard</li>
          </ul>
        </article>
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
              "Drive Portal Access",
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
      {loginForm.role !== "driver_token" && (
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
          placeholder={loginForm.role === "driver_token" ? "Driver token" : "Password"}
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
      <div className="grid gap-3 sm:grid-cols-4">
        {(["client", "carrier", "driver_token", "driver"] as LoginRole[]).map((role) => (
          <button
            key={role}
            type="button"
            onClick={() => onSetRole(role)}
            className={`rounded-xl px-4 py-3 text-sm font-semibold transition ${getLoginRoleClass(role, loginForm.role === role)}`}
          >
            {getLoginRoleLabel(role)}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={onLogin} disabled={submitting === "login"} className="rounded-xl bg-white px-4 py-3 text-sm font-semibold text-[#031227] hover:bg-slate-100">
          {submitting === "login" ? "Signing In..." : "Continue to Dashboard"}
        </button>
        {loginForm.role !== "driver_token" && (
          <button type="button" onClick={onForgotPassword} className="rounded-xl border border-slate-500 px-4 py-3 text-sm font-semibold text-slate-200 hover:bg-white/10">
            Forgot password
          </button>
        )}
        <button type="button" onClick={onBack} className="rounded-xl border border-slate-500 px-4 py-3 text-sm font-semibold text-slate-200 hover:bg-white/10">
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
        <button type="button" onClick={onSubmit} disabled={submitting === "forgot_password"} className="rounded-xl bg-white px-4 py-3 text-sm font-semibold text-[#031227] hover:bg-slate-100 disabled:opacity-60">
          {submitting === "forgot_password" ? "Sending..." : "Send Reset Link"}
        </button>
        <button type="button" onClick={onBack} className="rounded-xl border border-slate-500 px-4 py-3 text-sm font-semibold text-slate-200 hover:bg-white/10">
          Back to Login
        </button>
      </div>
    </div>
  );
}

function DiditIdentityVerification(props: Readonly<{
  role: AuthRole;
  sessionId: string;
  consent: boolean;
  submitting: SubmitState;
  onConsentChange: (consent: boolean) => void;
  onStart: () => void;
}>) {
  const { role, sessionId, consent, submitting, onConsentChange, onStart } = props;
  const isCarrier = role === "carrier";
  const isClient = role === "client";
  let label = "Driver";
  let containerClass = "rounded-xl border border-amber-300/30 bg-amber-500/10 p-3";
  let headingClass = "text-sm font-semibold text-amber-100";
  let actionClass = "mt-3 rounded-lg border border-amber-300/40 px-3 py-2 text-sm font-semibold text-amber-100 hover:bg-amber-500/15 disabled:opacity-60";
  let statusClass = "mt-2 text-xs text-amber-100";
  if (isCarrier) {
    label = "Carrier";
    containerClass = "rounded-xl border border-cyan-300/30 bg-cyan-500/10 p-3";
    headingClass = "text-sm font-semibold text-cyan-100";
    actionClass = "mt-3 rounded-lg border border-cyan-300/40 px-3 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-500/15 disabled:opacity-60";
    statusClass = "mt-2 text-xs text-cyan-100";
  } else if (isClient) {
    label = "Shipper";
    containerClass = "rounded-xl border border-indigo-300/30 bg-indigo-500/10 p-3";
    headingClass = "text-sm font-semibold text-indigo-100";
    actionClass = "mt-3 rounded-lg border border-indigo-300/40 px-3 py-2 text-sm font-semibold text-indigo-100 hover:bg-indigo-500/15 disabled:opacity-60";
    statusClass = "mt-2 text-xs text-indigo-100";
  }
  let buttonLabel = "Verify identity";
  let statusMessage = "Identity verification is required before creating this account.";
  if (sessionId) {
    buttonLabel = "Verification complete";
    statusMessage = "Identity verification is complete.";
  } else if (submitting === "didit") {
    buttonLabel = "Opening verification...";
  }

  return (
    <div className={containerClass}>
      <p className={headingClass}>{label} identity verification</p>
      <p className="mt-1 text-xs leading-5 text-slate-300">Verify your government-issued ID securely with Didit.</p>
      {!sessionId && (
        <label className="mt-3 flex items-start gap-2 text-xs leading-5 text-slate-200">
          <input type="checkbox" checked={consent} onChange={(event) => onConsentChange(event.target.checked)} className="mt-1 h-4 w-4 rounded border-slate-500 text-cyan-500 focus:ring-cyan-500" />
          <span>I consent to Didit processing my identity document and biometric data to verify my identity.</span>
        </label>
      )}
      <button type="button" onClick={onStart} disabled={submitting !== null} className={actionClass}>
        {buttonLabel}
      </button>
      <p className={statusClass}>{statusMessage}</p>
    </div>
  );
}

function SignupPanel(props: Readonly<{
  signupForm: SignupState;
  submitting: SubmitState;
  onSignupFormChange: (updater: (prev: SignupState) => SignupState) => void;
  onContinue: () => void;
  onBack: () => void;
}>) {
  const { signupForm, submitting, onSignupFormChange, onContinue, onBack } = props;

  return (
    <div className="mt-6 space-y-4">
      <p className="text-xs uppercase tracking-wider text-slate-300">Create Account</p>
      <input
        value={signupForm.fullName}
        onChange={(event) => onSignupFormChange((prev) => ({ ...prev, fullName: event.target.value }))}
        placeholder="First and last name"
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

      <button type="button" onClick={onContinue} disabled={submitting !== null} className="rounded-xl bg-cyan-500 px-4 py-3 text-sm font-semibold text-[#031227] hover:bg-cyan-400 disabled:opacity-60">
        {submitting === "signup_code" ? "Sending Code..." : "Next"}
      </button>

      <button type="button" onClick={onBack} className="rounded-xl border border-slate-500 px-4 py-3 text-sm font-semibold text-slate-200 hover:bg-white/10">
        Back
      </button>
    </div>
  );
}

function SignupVerificationPanel(props: Readonly<{
  signupForm: SignupState;
  submitting: SubmitState;
  onSignupFormChange: (updater: (prev: SignupState) => SignupState) => void;
  onVerify: () => void;
  onSendCode: () => void;
  onBackToForm: () => void;
}>) {
  const { signupForm, submitting, onSignupFormChange, onVerify, onSendCode, onBackToForm } = props;

  return (
    <div className="mt-6 space-y-4">
      <p className="text-xs uppercase tracking-wider text-slate-300">3. Email 2FA</p>
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

      <button type="button" onClick={onVerify} disabled={submitting !== null} className="rounded-xl bg-cyan-500 px-4 py-3 text-sm font-semibold text-[#031227] hover:bg-cyan-400 disabled:opacity-60">
        {submitting === "signup" ? "Verifying..." : "Verify & Continue"}
      </button>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={onSendCode}
          disabled={submitting !== null}
          className="rounded-xl border border-cyan-400/60 px-4 py-3 text-sm font-semibold text-cyan-100 hover:bg-cyan-500/15 disabled:opacity-60"
        >
          {submitting === "signup_code" ? "Sending..." : "Send Code"}
        </button>
        <button type="button" onClick={onBackToForm} disabled={submitting !== null} className="rounded-xl border border-slate-500 px-4 py-3 text-sm font-semibold text-slate-200 hover:bg-white/10 disabled:opacity-60">
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
  resourceSection: ResourceSection;
  submitting: SubmitState;
  onOpenLanding: () => void;
  onOpenPricing: () => void;
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
  onBackToRoleSelection: () => void;
  onBackToSignupForm: () => void;
  onBackToSignupVerification: () => void;
  onBackToSignupIdentity: () => void;
  onBackToSignupProfile: () => void;
  onSelectResourceSection: (section: ResourceSection) => void;
  onSignup: () => void;
  onStartDiditVerification: () => void;
  onBeginSignupVerification: () => void;
  onContinueRoleSelection: () => void;
  onVerifySignupEmail: () => void;
  onContinueSignupProfile: () => void;
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
    resourceSection,
    submitting,
    onOpenLanding,
    onOpenPricing,
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
    onBackToRoleSelection,
    onBackToSignupForm,
    onBackToSignupVerification,
    onBackToSignupIdentity,
    onBackToSignupProfile,
    onSelectResourceSection,
    onSignup,
    onStartDiditVerification,
    onBeginSignupVerification,
    onContinueRoleSelection,
    onVerifySignupEmail,
    onContinueSignupProfile,
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
        <PricingPanel />
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
            onBack={onBackToRoleSelection}
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
        {view === "signup_role" && <SignupRolePanel role={signupForm.role} onSelectRole={(role) => onSignupFormChange((prev) => ({ ...prev, role, diditSessionId: "", diditConsent: false }))} onContinue={onContinueRoleSelection} onBack={onBackToLanding} />}
        {view === "signup" && (
          <SignupPanel
            signupForm={signupForm}
            submitting={submitting}
            onSignupFormChange={onSignupFormChange}
            onContinue={onBeginSignupVerification}
            onBack={onBackToLanding}
          />
        )}
        {view === "signup_verify" && (
          <SignupVerificationPanel
            signupForm={signupForm}
            submitting={submitting}
            onSignupFormChange={onSignupFormChange}
            onVerify={onVerifySignupEmail}
            onSendCode={onRequestSignupCode}
            onBackToForm={onBackToSignupForm}
          />
        )}
        {view === "signup_identity" && <SignupIdentityPanel signupForm={signupForm} submitting={submitting} onSignupFormChange={onSignupFormChange} onStart={onStartDiditVerification} onBack={onBackToSignupVerification} />}
        {view === "signup_profile" && <SignupProfilePanel signupForm={signupForm} onSignupFormChange={onSignupFormChange} onToggleVehicleType={onToggleVehicleType} onContinue={onContinueSignupProfile} onBack={onBackToSignupIdentity} />}
        {view === "signup_review" && <SignupReviewPanel signupForm={signupForm} submitting={submitting} onSubmit={onSignup} onBack={onBackToSignupProfile} />}
        {view === "signup_submitted" && <SignupSubmittedPanel onBackToLogin={onBackToLogin} />}
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

      {isPricingView && (
        <>
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_14%_18%,rgba(34,211,238,0.18),transparent_30%),radial-gradient(circle_at_82%_16%,rgba(59,130,246,0.18),transparent_26%),radial-gradient(circle_at_50%_100%,rgba(6,182,212,0.14),transparent_34%),linear-gradient(180deg,#020817_0%,#031227_48%,#07192f_100%)]" />
          <div
            className="absolute inset-0 opacity-35"
            style={{
              backgroundImage:
                "linear-gradient(rgba(125,211,252,0.12) 1px, transparent 1px), linear-gradient(90deg, rgba(125,211,252,0.12) 1px, transparent 1px)",
              backgroundSize: "72px 72px",
            }}
          />
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
  const router = useRouter();
  const [view, setView] = useState<LandingView>("landing");
  const [loginMenuOpen, setLoginMenuOpen] = useState(false);
  const [showLoginPassword, setShowLoginPassword] = useState(false);
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
    phone: "",
    profileNotes: "",
    email: "",
    password: "",
    confirmPassword: "",
    emailVerificationCode: "",
    diditSessionId: "",
    diditConsent: false,
    idDocumentName: "",
    idDocumentMimeType: "",
    idDocumentBase64: "",
    role: "client",
  });
  const [activeSessionName, setActiveSessionName] = useState<string | null>(null);
  const [activeSessionRole, setActiveSessionRole] = useState<LoginRole | null>(null);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState<SubmitState>(null);
  const loginMenuRef = useRef<HTMLDivElement | null>(null);

  function navigateToDashboard(role: LoginRole) {
    router.push(resolveDashboardPath(role));
  }

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

  useEffect(() => {
    const kickoff = setTimeout(() => {
      const session = getAuthLiteSession();
      if (session) {
        setActiveSessionName(session.displayName);
        setActiveSessionRole(session.role === "driver" && getDriverPortalSession() ? "driver_token" : session.role);
      }
    }, 0);

    return () => clearTimeout(kickoff);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(globalThis.window.location.search);
    const sessionId = params.get("verificationSessionId");
    const status = params.get("status");
    if (!sessionId) {
      return;
    }

    const kickoff = setTimeout(() => {
      const savedSignup = globalThis.window.sessionStorage.getItem("freightaxis.didit.signup");
      if (savedSignup) {
        try {
          const savedForm = JSON.parse(savedSignup) as SignupState;
          setSignupForm({ ...savedForm, diditSessionId: sessionId });
          setView("signup_profile");
          setMessage(status === "Approved" ? "Identity verification complete. Continue with your role-specific profile." : "Identity verification was submitted. Account creation will continue once Didit approves it.");
        } catch {
          setMessage("Identity verification returned, but your signup details could not be restored. Please start again.");
        }
      }
    }, 0);
    globalThis.window.history.replaceState({}, "", globalThis.window.location.pathname);
    return () => clearTimeout(kickoff);
  }, []);

  useEffect(() => {
    router.prefetch("/client");
    router.prefetch("/carrier");
    router.prefetch("/driver");
  }, [router]);

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
    setMessage("");
    setView("forgot_password");
  }

  async function submitForgotPassword() {
    const email = loginForm.email.trim().toLowerCase();
    if (!email) {
      setMessage("Enter your email address to reset your password.");
      return;
    }
    if (!isValidEmailAddress(email)) {
      setMessage("Enter a valid email address.");
      return;
    }

    const role: AuthRole = loginForm.role === "driver_token" ? "driver" : loginForm.role;

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

      if (loginForm.role === "driver_token") {
        const loginToken = loginForm.password.trim();
        if (!loginToken) {
          setMessage("Enter your driver token.");
          return;
        }
        const session = await driverLogin({ login_token: loginToken });
        setDriverPortalSession(session);
        setAuthLiteSession("driver", session.driver_name, session.carrier_email);
        setActiveSessionName(session.driver_name);
        setActiveSessionRole("driver_token");
        trackEvent("auth.sign_in", { role: "driver", displayName: session.driver_name });
        setMessage("");
        navigateToDashboard("driver_token");
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

      if (account.role === "driver") {
        clearDriverPortalSession();
      }
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

  function validateSignupForm(requireIdentity = true): { email: string; normalizedTaxId: string; normalizedDotNumber: string } | null {
    const email = signupForm.email.trim().toLowerCase();
    const normalizedTaxId = signupForm.taxId.trim().replace(/\D/g, "");
    const normalizedDotNumber = signupForm.dotNumber.trim().replace(/\D/g, "");

    const validationMessage = getSignupValidationMessage({
      form: signupForm,
      normalizedTaxId,
      normalizedDotNumber,
      requireIdentity,
    });
    if (validationMessage) {
      setMessage(validationMessage);
      return null;
    }

    return { email, normalizedTaxId, normalizedDotNumber };
  }

  async function beginSignupVerification() {
    const validated = validateSignupForm(false);
    if (!validated) {
      return;
    }

    try {
      setSubmitting("signup_code");
      await requestSignupVerificationCode({ email: validated.email, role: signupForm.role });
      setSignupForm((prev) => ({ ...prev, emailVerificationCode: "" }));
      setView("signup_verify");
      setMessage("Verification code sent. Check your email and enter the 6-digit code to continue.");
    } catch (error: unknown) {
      setMessage(getErrorMessage(error));
    } finally {
      setSubmitting(null);
    }
  }

  async function verifySignupEmail() {
    const validated = validateSignupForm(false);
    const verificationCode = signupForm.emailVerificationCode.trim();
    if (!validated || !isSixDigitCode(verificationCode)) {
      setMessage("Enter the 6-digit verification code sent to your email.");
      return;
    }
    try {
      setSubmitting("signup");
      await verifySignupEmailCode({ email: validated.email, role: signupForm.role, verification_code: verificationCode });
      setMessage("Email verified. Continue to identity verification.");
      setView("signup_identity");
    } catch (error: unknown) {
      setMessage(getErrorMessage(error));
    } finally {
      setSubmitting(null);
    }
  }

  async function startDiditVerification() {
    const fullName = signupForm.fullName.trim();
    const email = signupForm.email.trim().toLowerCase();
    if (fullName.split(/\s+/).length < 2 || !isValidEmailAddress(email)) {
      setMessage("Enter your first and last name and a valid email before verifying your identity.");
      return;
    }
    if (!signupForm.diditConsent) {
      setMessage("Consent is required before identity verification.");
      return;
    }

    try {
      setSubmitting("didit");
      const session = await createDiditSession({ full_name: fullName, email, role: signupForm.role });
      globalThis.window.sessionStorage.setItem("freightaxis.didit.signup", JSON.stringify({ ...signupForm, diditSessionId: session.session_id }));
      globalThis.window.location.assign(session.url);
    } catch (error: unknown) {
      setMessage(getErrorMessage(error));
    } finally {
      setSubmitting(null);
    }
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

    if (!isSixDigitCode(verificationCode)) {
      setMessage("Enter the 6-digit verification code sent to your email.");
      return;
    }

    try {
      setSubmitting("signup");
      const account = await signupAccount({
        full_name: fullName,
        company_name: companyName,
        phone: signupForm.phone.trim() || null,
        bio: signupForm.profileNotes.trim() || null,
        tax_id: isCarrier ? taxId : null,
        dot_number: isCarrier ? dotNumber : null,
        didit_session_id: signupForm.diditSessionId || null,
        id_document_name: signupForm.idDocumentName,
        id_document_mime_type: signupForm.idDocumentMimeType,
        id_document_base64: signupForm.idDocumentBase64,
        vehicle_types: isCarrier ? carrierVehicleTypes : null,
        email,
        password,
        email_verification_code: verificationCode,
        role: signupForm.role,
      });

      trackEvent("auth.sign_up", { role: account.role, displayName: account.company_name });
      setMessage("");
      setView("signup_submitted");
    } catch (error: unknown) {
      setMessage(getErrorMessage(error));
    } finally {
      setSubmitting(null);
    }
  }

  async function requestSignupCode() {
    const validated = validateSignupForm(false);
    if (!validated) {
      return;
    }

    try {
      setSubmitting("signup_code");
      await requestSignupVerificationCode({ email: validated.email, role: signupForm.role });
      setMessage("Verification code sent. Check your email and enter the 6-digit code to continue.");
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

  function continueSignupProfile() {
    if (!signupForm.phone.trim()) {
      setMessage("Enter a contact phone number for your application.");
      return;
    }
    if (signupForm.role !== "carrier" && !signupForm.profileNotes.trim()) {
      setMessage("Complete your role-specific profile before review.");
      return;
    }
    setMessage("");
    setView("signup_review");
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
        resourceSection={resourceSection}
        submitting={submitting}
        onOpenLanding={openLanding}
        onOpenPricing={openPricing}
        onOpenResources={openResources}
        onOpenAbout={openAboutSection}
        onToggleLoginMenu={() => setLoginMenuOpen((prev) => !prev)}
        onOpenRoleLogin={openRoleLogin}
        onCreateAccount={() => {
          setLoginMenuOpen(false);
          setMessage("");
          setView("signup_role");
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
        onBackToRoleSelection={() => {
          setMessage("");
          setView("signup_role");
        }}
        onBackToSignupForm={() => {
          setView("signup");
          setMessage("");
        }}
        onBackToSignupVerification={() => {
          setMessage("");
          setView("signup_verify");
        }}
        onBackToSignupIdentity={() => {
          setMessage("");
          setView("signup_identity");
        }}
        onBackToSignupProfile={() => {
          setMessage("");
          setView("signup_profile");
        }}
        onSelectResourceSection={setResourceSection}
        onSignup={signup}
        onStartDiditVerification={startDiditVerification}
        onBeginSignupVerification={beginSignupVerification}
        onContinueRoleSelection={() => {
          setMessage("");
          setView("signup");
        }}
        onVerifySignupEmail={verifySignupEmail}
        onContinueSignupProfile={continueSignupProfile}
        onBackToLanding={() => {
          setMessage("");
          setView("landing");
        }}
      />
      <LiveChatSupport />
    </>
  );
}





