"use client";

import Link from "next/link";
import { ChangeEvent, useEffect, useState } from "react";
import { clearAuthLiteSession, getAuthLiteSession } from "@/lib/auth-lite";
import {
  getDriverApplicationProfile,
  updateDriverApplicationProfile,
  type DriverApplicationProfile,
} from "@/lib/logistics-api";

type EditableProfile = Omit<DriverApplicationProfile, "email" | "updated_at">;

const availabilityOptions: Array<{ value: EditableProfile["availability_status"]; label: string; className: string }> = [
  { value: "available", label: "Available", className: "bg-emerald-500" },
  { value: "on_load", label: "Currently on load", className: "bg-amber-400" },
  { value: "unavailable", label: "Unavailable", className: "bg-rose-500" },
];

function toEditableProfile(profile: DriverApplicationProfile): EditableProfile {
  return {
    first_name: profile.first_name,
    last_name: profile.last_name,
    phone: profile.phone,
    address: profile.address,
    zip_code: profile.zip_code,
    cdl_information: profile.cdl_information,
    years_experience: profile.years_experience,
    qualifications: profile.qualifications,
    endorsements: profile.endorsements,
    availability_notes: profile.availability_notes,
    truck_type: profile.truck_type,
    trailer_type: profile.trailer_type,
    capacity: profile.capacity,
    vehicle_information: profile.vehicle_information,
    availability_status: profile.availability_status,
    resume_name: profile.resume_name,
    resume_mime_type: profile.resume_mime_type,
    resume_base64: profile.resume_base64,
  };
}

function signOut() {
  clearAuthLiteSession("driver");
  globalThis.window.location.assign("/");
}

function InputField(props: Readonly<{
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  type?: "text" | "tel" | "number";
  placeholder?: string;
}>) {
  const { label, value, onChange, type = "text", placeholder } = props;
  return (
    <label className="grid gap-1.5 text-sm font-medium text-slate-700">
      {label}
      <input
        type={type}
        value={value}
        min={type === "number" ? 0 : undefined}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-md border border-slate-300 bg-white px-3 py-2.5 text-slate-950 outline-none focus:border-cyan-600 focus:ring-2 focus:ring-cyan-100"
      />
    </label>
  );
}

function TextAreaField(props: Readonly<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}>) {
  const { label, value, onChange, placeholder } = props;
  return (
    <label className="grid gap-1.5 text-sm font-medium text-slate-700">
      {label}
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        rows={4}
        className="w-full resize-y rounded-md border border-slate-300 bg-white px-3 py-2.5 text-slate-950 outline-none focus:border-cyan-600 focus:ring-2 focus:ring-cyan-100"
      />
    </label>
  );
}

export default function DriverApplicationPage() {
  const [profile, setProfile] = useState<EditableProfile | null>(null);
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const session = getAuthLiteSession("driver");
    if (!session?.email) {
      globalThis.window.location.assign("/");
      return;
    }

    setEmail(session.email);
    void getDriverApplicationProfile(session.email)
      .then((result) => setProfile(toEditableProfile(result)))
      .catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Unable to load your application."))
      .finally(() => setLoading(false));
  }, []);

  function updateField<Key extends keyof EditableProfile>(key: Key, value: EditableProfile[Key]) {
    setProfile((current) => (current ? { ...current, [key]: value } : current));
  }

  async function saveProfile() {
    if (!profile || !email) return;
    setSaving(true);
    setMessage("");
    try {
      const saved = await updateDriverApplicationProfile(email, profile);
      setProfile(toEditableProfile(saved));
      setMessage("Driver profile saved.");
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : "Unable to save your application.");
    } finally {
      setSaving(false);
    }
  }

  async function setAvailabilityStatus(status: EditableProfile["availability_status"]) {
    if (!profile || !email || profile.availability_status === status) return;
    const nextProfile = { ...profile, availability_status: status };
    setProfile(nextProfile);
    setSaving(true);
    setMessage("");
    try {
      await updateDriverApplicationProfile(email, nextProfile);
      setMessage("Availability updated.");
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : "Unable to update availability.");
    } finally {
      setSaving(false);
    }
  }

  function handleResumeChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 6_000_000) {
      setMessage("Choose a resume smaller than 6 MB.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") return;
      const base64 = reader.result.split(",", 2)[1] ?? "";
      updateField("resume_name", file.name);
      updateField("resume_mime_type", file.type || "application/octet-stream");
      updateField("resume_base64", base64);
      setMessage("Resume attached. Save your profile to upload it.");
    };
    reader.readAsDataURL(file);
  }

  if (loading || !profile) {
    return <main className="grid min-h-screen place-items-center bg-slate-100 text-slate-700">Loading driver application...</main>;
  }

  return (
    <main className="min-h-screen bg-slate-100 text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-700">FreightAxis</p>
            <h1 className="text-xl font-bold">Driver Profile / Application</h1>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/" className="text-sm font-semibold text-slate-600 hover:text-slate-950">Home</Link>
            <button type="button" onClick={signOut} className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Sign out</button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-6 px-5 py-8 sm:px-8 lg:grid-cols-[280px_1fr]">
        <aside className="h-fit border border-slate-200 bg-white p-5 lg:sticky lg:top-5">
          <p className="text-sm font-semibold text-slate-500">Availability</p>
          <div className="mt-4 grid gap-2">
            {availabilityOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => void setAvailabilityStatus(option.value)}
                className={`flex items-center gap-3 rounded-md border px-3 py-3 text-left text-sm font-semibold ${profile.availability_status === option.value ? "border-slate-950 bg-slate-950 text-white" : "border-slate-200 text-slate-700 hover:bg-slate-50"}`}
              >
                <span className={`h-2.5 w-2.5 rounded-full ${option.className}`} aria-hidden="true" />
                {option.label}
              </button>
            ))}
          </div>
          <p className="mt-5 text-xs leading-5 text-slate-500">Your status updates immediately for the carrier network.</p>
        </aside>

        <form onSubmit={(event) => { event.preventDefault(); void saveProfile(); }} className="grid gap-6">
          <section className="border border-slate-200 bg-white p-5 sm:p-7">
            <h2 className="text-lg font-bold">Personal Information</h2>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <InputField label="First name" value={profile.first_name} onChange={(value) => updateField("first_name", value)} />
              <InputField label="Last name" value={profile.last_name} onChange={(value) => updateField("last_name", value)} />
              <InputField label="Phone number" type="tel" value={profile.phone} onChange={(value) => updateField("phone", value)} />
              <InputField label="Email" value={email} onChange={() => undefined} />
              <InputField label="Address" value={profile.address} onChange={(value) => updateField("address", value)} />
              <InputField label="ZIP code" value={profile.zip_code} onChange={(value) => updateField("zip_code", value)} />
            </div>
          </section>

          <section className="border border-slate-200 bg-white p-5 sm:p-7">
            <h2 className="text-lg font-bold">Professional Information</h2>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <InputField label="CDL information" value={profile.cdl_information} onChange={(value) => updateField("cdl_information", value)} placeholder="Class A, issuing state, expiration" />
              <InputField label="Years of experience" type="number" value={profile.years_experience} onChange={(value) => updateField("years_experience", Number(value) || 0)} />
              <TextAreaField label="Qualifications" value={profile.qualifications} onChange={(value) => updateField("qualifications", value)} placeholder="Safety record, route experience, certifications" />
              <TextAreaField label="Endorsements" value={profile.endorsements} onChange={(value) => updateField("endorsements", value)} placeholder="Tanker, hazmat, doubles/triples" />
              <TextAreaField label="Availability details" value={profile.availability_notes} onChange={(value) => updateField("availability_notes", value)} placeholder="Preferred routes, start date, scheduling notes" />
              <div className="grid gap-1.5 text-sm font-medium text-slate-700">
                <label htmlFor="driver-resume">Resume</label>
                <input id="driver-resume" type="file" accept=".pdf,.doc,.docx,.txt" onChange={handleResumeChange} className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm" />
                <span className="text-xs font-normal text-slate-500">{profile.resume_name ? `Attached: ${profile.resume_name}` : "PDF, DOC, DOCX, or TXT up to 6 MB"}</span>
              </div>
            </div>
          </section>

          <section className="border border-slate-200 bg-white p-5 sm:p-7">
            <h2 className="text-lg font-bold">Equipment</h2>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <InputField label="Truck type" value={profile.truck_type} onChange={(value) => updateField("truck_type", value)} placeholder="Sleeper cab, day cab" />
              <InputField label="Trailer type" value={profile.trailer_type} onChange={(value) => updateField("trailer_type", value)} placeholder="Dry van, reefer, flatbed" />
              <InputField label="Capacity" value={profile.capacity} onChange={(value) => updateField("capacity", value)} placeholder="e.g. 45,000 lb" />
              <InputField label="Vehicle information" value={profile.vehicle_information} onChange={(value) => updateField("vehicle_information", value)} placeholder="Year, make, model, unit number" />
            </div>
          </section>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-5">
            <output className="text-sm text-slate-600">{message}</output>
            <button type="submit" disabled={saving} className="rounded-md bg-cyan-700 px-5 py-3 text-sm font-bold text-white hover:bg-cyan-800 disabled:opacity-60">
              {saving ? "Saving..." : "Save Driver Profile"}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}