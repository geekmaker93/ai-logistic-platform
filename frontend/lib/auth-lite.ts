export type PortalRole = "client" | "carrier" | "driver";

export type DriverPortalSession = {
  driver_id: string;
  driver_name: string;
  driver_mobile: string;
  carrier_name: string;
  carrier_email: string;
};

export type AuthLiteSession = {
  role: PortalRole;
  displayName: string;
  email?: string;
  subscriptionActive?: boolean;
  createdAt: string;
};

const AUTH_SESSION_KEY = "auth-lite-session";
const AUTH_ACTIVE_ROLE_KEY = "auth-lite-active-role";
const DRIVER_SESSION_KEY = "driver-portal-session";
const AUTH_LAST_ACTIVITY_KEY = "auth-lite-last-activity";
const INACTIVITY_TIMEOUT_MS = 60 * 60 * 1000;
const INACTIVITY_POLL_MS = 60 * 1000;
const ACTIVITY_THROTTLE_MS = 10 * 1000;
const WATCHER_FLAG_KEY = "__authInactivityWatcherActive";

const ACTIVITY_EVENTS: Array<keyof WindowEventMap> = [
  "click",
  "keydown",
  "mousemove",
  "mousedown",
  "touchstart",
  "scroll",
  "focus",
];

let lastActivityWriteAt = 0;

function roleSessionKey(role: PortalRole): string {
  return `${AUTH_SESSION_KEY}:${role}`;
}

function parseAuthLiteSession(raw: string | null): AuthLiteSession | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as AuthLiteSession;
    if (!parsed.role || !parsed.displayName) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function clearInactivityActivityMarker() {
  if (globalThis.window === undefined) {
    return;
  }
  globalThis.window.localStorage.removeItem(AUTH_LAST_ACTIVITY_KEY);
}

function getKnownSessionCreatedAtMs(): number {
  if (globalThis.window === undefined) {
    return Date.now();
  }

  let latest = 0;
  for (const role of ["client", "carrier", "driver"] as PortalRole[]) {
    const session = parseAuthLiteSession(globalThis.window.localStorage.getItem(roleSessionKey(role)));
    if (session?.createdAt) {
      const ms = Date.parse(session.createdAt);
      if (!Number.isNaN(ms) && ms > latest) {
        latest = ms;
      }
    }
  }

  const legacy = parseAuthLiteSession(globalThis.window.localStorage.getItem(AUTH_SESSION_KEY));
  if (legacy?.createdAt) {
    const ms = Date.parse(legacy.createdAt);
    if (!Number.isNaN(ms) && ms > latest) {
      latest = ms;
    }
  }

  return latest || Date.now();
}

function getLastActivityMs(): number {
  if (globalThis.window === undefined) {
    return Date.now();
  }

  const raw = globalThis.window.localStorage.getItem(AUTH_LAST_ACTIVITY_KEY);
  const parsed = raw ? Number(raw) : Number.NaN;
  if (!Number.isNaN(parsed) && parsed > 0) {
    return parsed;
  }

  return getKnownSessionCreatedAtMs();
}

function anySessionPresent(): boolean {
  if (globalThis.window === undefined) {
    return false;
  }

  for (const role of ["client", "carrier", "driver"] as PortalRole[]) {
    if (parseAuthLiteSession(globalThis.window.localStorage.getItem(roleSessionKey(role)))) {
      return true;
    }
  }

  if (parseAuthLiteSession(globalThis.window.localStorage.getItem(AUTH_SESSION_KEY))) {
    return true;
  }

  return globalThis.window.localStorage.getItem(DRIVER_SESSION_KEY) !== null;
}

function hasExpiredByInactivity(): boolean {
  return Date.now() - getLastActivityMs() > INACTIVITY_TIMEOUT_MS;
}

function clearSessionsForInactivity(): void {
  clearAuthLiteSession();
  clearDriverPortalSession();
  clearInactivityActivityMarker();
}

export function recordAuthActivity(force = false) {
  if (globalThis.window === undefined) {
    return;
  }
  if (!anySessionPresent()) {
    return;
  }

  const now = Date.now();
  if (!force && now - lastActivityWriteAt < ACTIVITY_THROTTLE_MS) {
    return;
  }

  globalThis.window.localStorage.setItem(AUTH_LAST_ACTIVITY_KEY, String(now));
  lastActivityWriteAt = now;
}

export function startAuthInactivityWatcher() {
  if (globalThis.window === undefined) {
    return () => undefined;
  }

  const windowWithWatcherFlag = globalThis.window as Window & { [WATCHER_FLAG_KEY]?: boolean };
  if (windowWithWatcherFlag[WATCHER_FLAG_KEY]) {
    return () => undefined;
  }

  windowWithWatcherFlag[WATCHER_FLAG_KEY] = true;

  const onActivity = () => recordAuthActivity();
  const checkInactivityTimeout = () => {
    if (!anySessionPresent()) {
      return;
    }
    if (!hasExpiredByInactivity()) {
      return;
    }

    clearSessionsForInactivity();
    if (globalThis.window.location.pathname !== "/") {
      globalThis.window.location.assign("/");
    }
  };

  for (const eventName of ACTIVITY_EVENTS) {
    globalThis.window.addEventListener(eventName, onActivity, { passive: true });
  }

  const pollId = globalThis.window.setInterval(checkInactivityTimeout, INACTIVITY_POLL_MS);
  const onVisibilityOrFocus = () => {
    onActivity();
    checkInactivityTimeout();
  };

  globalThis.window.addEventListener("visibilitychange", onVisibilityOrFocus);
  globalThis.window.addEventListener("focus", onVisibilityOrFocus);
  checkInactivityTimeout();

  return () => {
    for (const eventName of ACTIVITY_EVENTS) {
      globalThis.window.removeEventListener(eventName, onActivity);
    }
    globalThis.window.clearInterval(pollId);
    globalThis.window.removeEventListener("visibilitychange", onVisibilityOrFocus);
    globalThis.window.removeEventListener("focus", onVisibilityOrFocus);
    windowWithWatcherFlag[WATCHER_FLAG_KEY] = false;
  };
}

export function getAuthLiteSession(role?: PortalRole): AuthLiteSession | null {
  if (globalThis.window === undefined) {
    return null;
  }

  if (hasExpiredByInactivity()) {
    clearSessionsForInactivity();
    return null;
  }

  if (role) {
    const scoped = parseAuthLiteSession(globalThis.window.localStorage.getItem(roleSessionKey(role)));
    if (scoped) {
      return scoped;
    }

    // Backward compatibility: migrate old single-session storage lazily.
    const legacy = parseAuthLiteSession(globalThis.window.localStorage.getItem(AUTH_SESSION_KEY));
    if (legacy?.role === role) {
      globalThis.window.localStorage.setItem(roleSessionKey(role), JSON.stringify(legacy));
      globalThis.window.localStorage.setItem(AUTH_ACTIVE_ROLE_KEY, role);
      return legacy;
    }
    return null;
  }

  const activeRole = globalThis.window.localStorage.getItem(AUTH_ACTIVE_ROLE_KEY) as PortalRole | null;
  if (activeRole) {
    const activeSession = parseAuthLiteSession(globalThis.window.localStorage.getItem(roleSessionKey(activeRole)));
    if (activeSession) {
      return activeSession;
    }
  }

  for (const nextRole of ["client", "carrier", "driver"] as PortalRole[]) {
    const scoped = parseAuthLiteSession(globalThis.window.localStorage.getItem(roleSessionKey(nextRole)));
    if (scoped) {
      globalThis.window.localStorage.setItem(AUTH_ACTIVE_ROLE_KEY, scoped.role);
      return scoped;
    }
  }

  return parseAuthLiteSession(globalThis.window.localStorage.getItem(AUTH_SESSION_KEY));
}

export function setAuthLiteSession(role: PortalRole, displayName: string, email?: string, subscriptionActive?: boolean): AuthLiteSession {
  const session: AuthLiteSession = {
    role,
    displayName,
    email,
    subscriptionActive,
    createdAt: new Date().toISOString(),
  };

  if (globalThis.window !== undefined) {
    globalThis.window.localStorage.setItem(roleSessionKey(role), JSON.stringify(session));
    globalThis.window.localStorage.setItem(AUTH_ACTIVE_ROLE_KEY, role);
    // Keep legacy key current for compatibility with older reads.
    globalThis.window.localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(session));
    recordAuthActivity(true);
  }

  return session;
}

export function clearAuthLiteSession(role?: PortalRole) {
  if (globalThis.window !== undefined) {
    if (role) {
      globalThis.window.localStorage.removeItem(roleSessionKey(role));
      const activeRole = globalThis.window.localStorage.getItem(AUTH_ACTIVE_ROLE_KEY);
      if (activeRole === role) {
        globalThis.window.localStorage.removeItem(AUTH_ACTIVE_ROLE_KEY);
      }

      const legacy = parseAuthLiteSession(globalThis.window.localStorage.getItem(AUTH_SESSION_KEY));
      if (legacy?.role === role) {
        globalThis.window.localStorage.removeItem(AUTH_SESSION_KEY);
      }
      return;
    }

    globalThis.window.localStorage.removeItem(AUTH_SESSION_KEY);
    globalThis.window.localStorage.removeItem(AUTH_ACTIVE_ROLE_KEY);
    globalThis.window.localStorage.removeItem(roleSessionKey("client"));
    globalThis.window.localStorage.removeItem(roleSessionKey("carrier"));
    globalThis.window.localStorage.removeItem(roleSessionKey("driver"));
    clearInactivityActivityMarker();
  }
}

export function getDriverPortalSession(): DriverPortalSession | null {
  if (globalThis.window === undefined) {
    return null;
  }

  if (hasExpiredByInactivity()) {
    clearSessionsForInactivity();
    return null;
  }

  const raw = globalThis.window.localStorage.getItem(DRIVER_SESSION_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as DriverPortalSession;
    if (!parsed.driver_id || !parsed.driver_name || !parsed.carrier_name) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function setDriverPortalSession(session: DriverPortalSession): DriverPortalSession {
  if (globalThis.window !== undefined) {
    globalThis.window.localStorage.setItem(DRIVER_SESSION_KEY, JSON.stringify(session));
    recordAuthActivity(true);
  }
  return session;
}

export function clearDriverPortalSession() {
  if (globalThis.window !== undefined) {
    globalThis.window.localStorage.removeItem(DRIVER_SESSION_KEY);
  }
}
