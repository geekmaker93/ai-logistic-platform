"use client";

import Link from "next/link";
import { ChangeEvent, useCallback, useEffect, useMemo, useState } from "react";
import { clearAuthLiteSession, clearDriverPortalSession, getDriverPortalSession, type DriverPortalSession } from "@/lib/auth-lite";
import {
  getDriverCurrentShipment,
  startDriverTracking,
  updateDriverTracking,
  uploadDriverDocument,
  type DriverCurrentShipment,
} from "@/lib/logistics-api";

type TrackingState = "idle" | "starting" | "updating";
type SelectedDocument = { name: string; mimeType: string; base64: string };
type DriverDocumentType = "bill_of_lading" | "proof_of_delivery" | "other";

function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

function getCurrentPosition(): Promise<{ latitude: number; longitude: number } | null> {
  if (!("geolocation" in globalThis.navigator)) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    globalThis.navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
      },
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 6000, maximumAge: 10000 }
    );
  });
}

function signOutToHome() {
  clearDriverPortalSession();
  clearAuthLiteSession("driver");
  globalThis.window.location.assign("/");
}

export default function DriverPortalPage() {
  const [session, setSession] = useState<DriverPortalSession | null>(null);
  const [payload, setPayload] = useState<DriverCurrentShipment | null>(null);
  const [loading, setLoading] = useState(true);
  const [trackingState, setTrackingState] = useState<TrackingState>("idle");
  const [trackingNote, setTrackingNote] = useState("");
  const [docName, setDocName] = useState("");
  const [docText, setDocText] = useState("");
  const [documentType, setDocumentType] = useState<DriverDocumentType>("bill_of_lading");
  const [selectedDocument, setSelectedDocument] = useState<SelectedDocument | null>(null);
  const [uploadingDocument, setUploadingDocument] = useState(false);
  const [message, setMessage] = useState("");

  const shipment = payload?.shipment ?? null;

  const canUpdateTracking = useMemo(() => {
    return Boolean(session?.driver_id);
  }, [session?.driver_id]);

  const loadDriverState = useCallback(async (driverId: string) => {
    setLoading(true);
    try {
      const next = await getDriverCurrentShipment(driverId);
      setPayload(next);
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : "Failed to load driver shipment.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const storedSession = getDriverPortalSession();
    if (!storedSession) {
      globalThis.window.location.assign("/");
      return;
    }

    setSession(storedSession);
    void loadDriverState(storedSession.driver_id);
  }, [loadDriverState]);

  async function handleStartTracking() {
    if (!session) {
      return;
    }

    setTrackingState("starting");
    setMessage("");
    try {
      await startDriverTracking({ driver_id: session.driver_id });
      await loadDriverState(session.driver_id);
      setMessage("Tracking started.");
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : "Failed to start tracking.");
    } finally {
      setTrackingState("idle");
    }
  }

  async function handleTrackingUpdate() {
    if (!session) {
      return;
    }

    setTrackingState("updating");
    setMessage("");
    try {
      const coords = await getCurrentPosition();
      await updateDriverTracking({
        driver_id: session.driver_id,
        shipment_id: shipment?.id,
        latitude: coords?.latitude,
        longitude: coords?.longitude,
        note: trackingNote.trim() || undefined,
      });
      await loadDriverState(session.driver_id);
      setTrackingNote("");
      setMessage("Tracking update sent.");
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : "Failed to send tracking update.");
    } finally {
      setTrackingState("idle");
    }
  }

  async function handleUploadDocument() {
    if (!session) {
      return;
    }

    if (!selectedDocument) {
      setMessage("Choose a BOL or other document before uploading.");
      return;
    }
    const safeName = docName.trim() || selectedDocument.name;

    setUploadingDocument(true);
    setMessage("");
    try {
      await uploadDriverDocument({
        driver_id: session.driver_id,
        document_name: safeName,
        document_type: documentType,
        notes: docText.trim() || undefined,
        file_mime_type: selectedDocument.mimeType,
        file_base64: selectedDocument.base64,
      });
      setDocName("");
      setDocText("");
      setSelectedDocument(null);
      setMessage("Document sent to the carrier Documents section.");
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : "Failed to upload document.");
    } finally {
      setUploadingDocument(false);
    }
  }

  function handleDocumentSelection(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 4_000_000) {
      setMessage("Choose a document smaller than 4 MB.");
      event.target.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") return;
      setSelectedDocument({
        name: file.name,
        mimeType: file.type || "application/octet-stream",
        base64: reader.result.split(",", 2)[1] ?? "",
      });
      if (!docName.trim()) setDocName(file.name);
      setMessage("Document ready to upload.");
    };
    reader.readAsDataURL(file);
  }

  return (
    <main className="min-h-screen bg-[#020B16] px-6 py-8 text-white md:px-10">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="rounded-2xl border border-cyan-300/20 bg-[#031227]/75 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-cyan-300">Drive Portal</p>
              <h1 className="mt-2 text-2xl font-semibold">Road Operations Console</h1>
              {session && (
                <p className="mt-2 text-sm text-cyan-100">
                  Signed in as {session.driver_name} for {session.carrier_name}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Link href="/" className="rounded-lg border border-cyan-300/40 px-3 py-2 text-sm hover:bg-cyan-500/15">
                Home
              </Link>
              <button type="button" onClick={signOutToHome} className="rounded-lg border border-cyan-300/40 px-3 py-2 text-sm hover:bg-cyan-500/15">
                Sign Out
              </button>
            </div>
          </div>
        </header>

        {message && <p className="rounded-lg border border-cyan-300/25 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-100">{message}</p>}

        <section className="rounded-2xl border border-cyan-300/20 bg-[#031227]/75 p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Assigned Shipment</h2>
            <button
              type="button"
              onClick={() => session && void loadDriverState(session.driver_id)}
              className="rounded-lg border border-cyan-300/40 px-3 py-2 text-sm hover:bg-cyan-500/15"
              disabled={!session || loading}
            >
              {loading ? "Loading..." : "Refresh"}
            </button>
          </div>

          {shipment ? (
            <div className="grid gap-3 rounded-xl border border-cyan-300/20 bg-[#041a34] p-4 text-sm md:grid-cols-2">
              <p>
                <span className="text-cyan-200">Shipment ID:</span> {shipment.id}
              </p>
              <p>
                <span className="text-cyan-200">Status:</span> {shipment.status}
              </p>
              <p>
                <span className="text-cyan-200">Origin:</span> {shipment.origin}
              </p>
              <p>
                <span className="text-cyan-200">Destination:</span> {shipment.destination}
              </p>
              <p>
                <span className="text-cyan-200">Cargo:</span> {shipment.cargo_type}
              </p>
              <p>
                <span className="text-cyan-200">Weight (kg):</span> {shipment.weight_kg}
              </p>
            </div>
          ) : (
            <p className="text-sm text-slate-300">No active shipment is assigned right now.</p>
          )}

          <div className="mt-4 grid gap-3 text-sm md:grid-cols-2">
            <p>
              <span className="text-cyan-200">Tracking Started:</span> {formatDateTime(payload?.tracking_started_at)}
            </p>
            <p>
              <span className="text-cyan-200">Last Tracking Update:</span> {formatDateTime(payload?.last_tracking_at)}
            </p>
          </div>
        </section>

        <section className="rounded-2xl border border-cyan-300/20 bg-[#031227]/75 p-5">
          <h2 className="text-lg font-semibold">Tracking Actions</h2>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handleStartTracking}
              className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-[#031227] hover:bg-cyan-400"
              disabled={!canUpdateTracking || trackingState !== "idle"}
            >
              {trackingState === "starting" ? "Starting..." : "Start Tracking"}
            </button>
            <button
              type="button"
              onClick={handleTrackingUpdate}
              className="rounded-lg border border-cyan-300/40 px-4 py-2 text-sm hover:bg-cyan-500/15"
              disabled={!canUpdateTracking || trackingState !== "idle"}
            >
              {trackingState === "updating" ? "Sending..." : "Send Update"}
            </button>
          </div>

          <textarea
            value={trackingNote}
            onChange={(event) => setTrackingNote(event.target.value)}
            placeholder="Optional note for this location update"
            className="mt-3 w-full rounded-lg border border-cyan-300/25 bg-[#041a34] px-3 py-2 text-sm text-white outline-none ring-cyan-300 placeholder:text-slate-400 focus:ring-2"
            rows={3}
          />
        </section>

        <section className="rounded-2xl border border-cyan-300/20 bg-[#031227]/75 p-5">
          <h2 className="text-lg font-semibold">Send Document to Carrier</h2>
          <p className="mt-1 text-sm text-slate-300">Select your BOL, proof of delivery, or another required document. It will appear in your carrier&apos;s Documents section.</p>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <input
              value={docName}
              onChange={(event) => setDocName(event.target.value)}
              placeholder="Document name"
              className="rounded-lg border border-cyan-300/25 bg-[#041a34] px-3 py-2 text-sm text-white outline-none ring-cyan-300 placeholder:text-slate-400 focus:ring-2"
            />
            <button
              type="button"
              onClick={handleUploadDocument}
              className="rounded-lg border border-cyan-300/40 px-4 py-2 text-sm hover:bg-cyan-500/15"
              disabled={!session || uploadingDocument}
            >
              {uploadingDocument ? "Uploading..." : "Upload"}
            </button>
          </div>
          <div className="mt-3 grid gap-1 text-sm text-cyan-100">
            <label htmlFor="drive-portal-document-type">Document type</label>
            <select
              id="drive-portal-document-type"
              value={documentType}
              onChange={(event) => setDocumentType(event.target.value as DriverDocumentType)}
              className="rounded-lg border border-cyan-300/25 bg-[#041a34] px-3 py-2 text-sm text-white outline-none ring-cyan-300 focus:ring-2"
            >
              <option value="bill_of_lading">Bill of lading</option>
              <option value="proof_of_delivery">Proof of delivery</option>
              <option value="other">Other document</option>
            </select>
          </div>
          <div className="mt-3 flex flex-wrap gap-3">
            <div className="rounded-lg border border-cyan-300/40 px-3 py-2 text-sm text-cyan-100 hover:bg-cyan-500/15">
              <label htmlFor="drive-portal-gallery">Choose from gallery</label>
              <input id="drive-portal-gallery" type="file" accept="image/*,application/pdf,.doc,.docx,.txt" onChange={handleDocumentSelection} className="sr-only" />
            </div>
            <div className="rounded-lg border border-cyan-300/40 px-3 py-2 text-sm text-cyan-100 hover:bg-cyan-500/15">
              <label htmlFor="drive-portal-camera">Take photo</label>
              <input id="drive-portal-camera" type="file" accept="image/*" capture="environment" onChange={handleDocumentSelection} className="sr-only" />
            </div>
          </div>
          {selectedDocument && <p className="mt-2 text-xs text-cyan-200">Ready: {selectedDocument.name}</p>}
          <textarea
            value={docText}
            onChange={(event) => setDocText(event.target.value)}
            placeholder="Optional note for the carrier"
            className="mt-3 w-full rounded-lg border border-cyan-300/25 bg-[#041a34] px-3 py-2 text-sm text-white outline-none ring-cyan-300 placeholder:text-slate-400 focus:ring-2"
            rows={4}
          />
        </section>
      </div>
    </main>
  );
}
