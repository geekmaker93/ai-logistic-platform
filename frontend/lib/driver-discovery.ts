export type DriverAvailability = "available" | "busy" | "unavailable";

export type DriverProfile = {
  id: string;
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  address: string;
  zip_code: string;
  city: string;
  state: string;
  latitude: number;
  longitude: number;
  cdl_class: string;
  experience_years: number;
  qualifications: string[];
  endorsements: string[];
  equipment: string;
  trailer_type: string;
  vehicle_type: string;
  capacity: string;
  operating_radius_miles: number;
  availability: DriverAvailability;
  preferred_routes: string[];
  completed_loads: number;
  on_time_delivery_pct: number;
  rating: number;
  cancellation_rate: number;
};

const DRIVER_PROFILES_STORAGE_KEY = "freightaxis-driver-profiles";

const ZIP_COORDINATES: Record<string, { latitude: number; longitude: number }> = {
  "10001": { latitude: 40.7506, longitude: -73.9936 },
  "10017": { latitude: 40.7527, longitude: -73.9772 },
  "60601": { latitude: 41.8819, longitude: -87.6233 },
  "75001": { latitude: 32.7767, longitude: -96.7970 },
  "90210": { latitude: 34.0901, longitude: -118.4065 },
  "94105": { latitude: 37.7838, longitude: -122.4090 },
};

function hashStringToCoordinate(seed: string): { latitude: number; longitude: number } {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    const codePoint = seed.codePointAt(index);
    const charValue = codePoint ?? seed.charCodeAt(index);
    hash = Math.trunc((hash << 5) - hash + charValue);
  }

  const clamped = Math.abs(hash % 10000) / 10000;
  return {
    latitude: 37 + clamped * 8,
    longitude: -95 - clamped * 35,
  };
}

export function getDriverProfilesStorageKey(): string {
  return DRIVER_PROFILES_STORAGE_KEY;
}

export function getZipCoordinates(zipCode: string): { latitude: number; longitude: number } {
  const key = zipCode.trim();
  if (key && ZIP_COORDINATES[key]) {
    return ZIP_COORDINATES[key];
  }

  return hashStringToCoordinate(key || "default");
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

export function calculateDistanceMiles(from: { latitude: number; longitude: number }, to: { latitude: number; longitude: number }): number {
  const earthRadiusMiles = 3958.8;
  const deltaLatitude = toRadians(to.latitude - from.latitude);
  const deltaLongitude = toRadians(to.longitude - from.longitude);
  const lat1 = toRadians(from.latitude);
  const lat2 = toRadians(to.latitude);

  const a =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLongitude / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusMiles * c;
}

export function searchDriversNearZip(zipCode: string, radiusMiles: number, drivers: DriverProfile[]): DriverProfile[] {
  const origin = getZipCoordinates(zipCode);
  return drivers
    .map((driver) => ({
      driver,
      distanceMiles: calculateDistanceMiles(origin, {
        latitude: driver.latitude,
        longitude: driver.longitude,
      }),
    }))
    .filter(({ distanceMiles }) => distanceMiles <= radiusMiles)
    .sort((left, right) => left.distanceMiles - right.distanceMiles)
    .map(({ driver }) => driver);
}

export function buildDefaultDriverProfile(overrides: Partial<DriverProfile> = {}): DriverProfile {
  const now = Date.now().toString();
  return {
    id: overrides.id ?? `driver-${now}`,
    first_name: overrides.first_name ?? "Driver",
    last_name: overrides.last_name ?? "Profile",
    phone: overrides.phone ?? "",
    email: overrides.email ?? "",
    address: overrides.address ?? "",
    zip_code: overrides.zip_code ?? "10001",
    city: overrides.city ?? "New York",
    state: overrides.state ?? "NY",
    latitude: overrides.latitude ?? 40.7506,
    longitude: overrides.longitude ?? -73.9936,
    cdl_class: overrides.cdl_class ?? "Class A",
    experience_years: overrides.experience_years ?? 6,
    qualifications: overrides.qualifications ?? ["HazMat", "TWIC"],
    endorsements: overrides.endorsements ?? ["None"],
    equipment: overrides.equipment ?? "Dry Van",
    trailer_type: overrides.trailer_type ?? "Box Trailer",
    vehicle_type: overrides.vehicle_type ?? "Truck",
    capacity: overrides.capacity ?? "26,000 lbs",
    operating_radius_miles: overrides.operating_radius_miles ?? 150,
    availability: overrides.availability ?? "available",
    preferred_routes: overrides.preferred_routes ?? ["I-95", "I-80"],
    completed_loads: overrides.completed_loads ?? 82,
    on_time_delivery_pct: overrides.on_time_delivery_pct ?? 97,
    rating: overrides.rating ?? 4.8,
    cancellation_rate: overrides.cancellation_rate ?? 1.1,
    ...overrides,
  };
}

export function seedDriverProfiles(): DriverProfile[] {
  return [
    buildDefaultDriverProfile({
      id: "john-davis",
      first_name: "John",
      last_name: "Davis",
      phone: "(555) 123-4567",
      email: "john@example.com",
      address: "180 Madison Ave",
      zip_code: "10001",
      city: "New York",
      state: "NY",
      latitude: 40.7506,
      longitude: -73.9936,
      cdl_class: "Class A",
      experience_years: 7,
      equipment: "Dry Van",
      trailer_type: "Box Trailer",
      capacity: "26,000 lbs",
      operating_radius_miles: 120,
      availability: "available",
      preferred_routes: ["I-95", "I-87"],
      completed_loads: 184,
      on_time_delivery_pct: 98.4,
      rating: 4.9,
      cancellation_rate: 0.8,
    }),
    buildDefaultDriverProfile({
      id: "mike-ross",
      first_name: "Mike",
      last_name: "Ross",
      phone: "(555) 555-0101",
      email: "mike@example.com",
      address: "3200 W 6th St",
      zip_code: "90020",
      city: "Los Angeles",
      state: "CA",
      latitude: 34.0586,
      longitude: -118.2748,
      cdl_class: "Class A",
      experience_years: 5,
      equipment: "Flatbed",
      trailer_type: "Step Deck",
      capacity: "45,000 lbs",
      operating_radius_miles: 90,
      availability: "available",
      preferred_routes: ["I-10", "I-5"],
      completed_loads: 112,
      on_time_delivery_pct: 95.8,
      rating: 4.6,
      cancellation_rate: 1.6,
    }),
    buildDefaultDriverProfile({
      id: "james-taylor",
      first_name: "James",
      last_name: "Taylor",
      phone: "(555) 555-0144",
      email: "james@example.com",
      address: "600 W Jackson Blvd",
      zip_code: "60601",
      city: "Chicago",
      state: "IL",
      latitude: 41.8781,
      longitude: -87.6298,
      cdl_class: "Class A",
      experience_years: 10,
      equipment: "Reefer",
      trailer_type: "Reefer Trailer",
      capacity: "44,000 lbs",
      operating_radius_miles: 140,
      availability: "busy",
      preferred_routes: ["I-90", "I-80"],
      completed_loads: 236,
      on_time_delivery_pct: 96.9,
      rating: 4.7,
      cancellation_rate: 1.2,
    }),
    buildDefaultDriverProfile({
      id: "sara-nguyen",
      first_name: "Sara",
      last_name: "Nguyen",
      phone: "(555) 555-0173",
      email: "sara@example.com",
      address: "4100 N Central Expy",
      zip_code: "75001",
      city: "Dallas",
      state: "TX",
      latitude: 32.7767,
      longitude: -96.7970,
      cdl_class: "Class B",
      experience_years: 4,
      equipment: "Box Truck",
      trailer_type: "Cargo Van",
      capacity: "12,000 lbs",
      operating_radius_miles: 80,
      availability: "unavailable",
      preferred_routes: ["I-35", "I-45"],
      completed_loads: 64,
      on_time_delivery_pct: 93.2,
      rating: 4.4,
      cancellation_rate: 2.1,
    }),
  ];
}

export function loadDriverProfilesFromStorage(): DriverProfile[] {
  if (typeof window === "undefined") {
    return seedDriverProfiles();
  }

  try {
    const raw = window.localStorage.getItem(DRIVER_PROFILES_STORAGE_KEY);
    if (!raw) {
      return seedDriverProfiles();
    }

    const parsed = JSON.parse(raw) as Partial<DriverProfile>[];
    if (!Array.isArray(parsed)) {
      return seedDriverProfiles();
    }

    return parsed.map((profile) => buildDefaultDriverProfile(profile));
  } catch {
    return seedDriverProfiles();
  }
}

export function saveDriverProfilesToStorage(profiles: DriverProfile[]): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(DRIVER_PROFILES_STORAGE_KEY, JSON.stringify(profiles));
}
