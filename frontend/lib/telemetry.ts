type TelemetryEvent = {
  name: string;
  timestamp: string;
  payload?: Record<string, unknown>;
};

const TELEMETRY_KEY = "auth-lite-telemetry";
const MAX_EVENTS = 200;

export function trackEvent(name: string, payload?: Record<string, unknown>) {
  const event: TelemetryEvent = {
    name,
    timestamp: new Date().toISOString(),
    payload,
  };

  if (typeof globalThis.window !== "undefined") {
    try {
      const existingRaw = globalThis.window.localStorage.getItem(TELEMETRY_KEY);
      const existing = existingRaw ? (JSON.parse(existingRaw) as TelemetryEvent[]) : [];
      const next = [...existing, event].slice(-MAX_EVENTS);
      globalThis.window.localStorage.setItem(TELEMETRY_KEY, JSON.stringify(next));
    } catch {
      // Ignore telemetry storage failures in MVP mode.
    }
  }

  console.info("[telemetry]", event.name, event.payload || {});
}
