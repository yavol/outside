import { destinations, getDestination, type DestinationId } from "./destinations";

export type EvidenceStatus = "available" | "stale" | "unavailable";

export type CameraConditions = {
  status: EvidenceStatus;
  imageUrl: string | null;
  sourceUrl: string;
  fetchedAt: string | null;
  checkedAt: string;
  /** The latest image URL has no machine-readable capture timestamp. Never substitute fetch time. */
  capturedAt: string | null;
  lastModifiedAt: string | null;
  note: string;
};

export type WeatherPeriod = {
  startTime: string;
  endTime: string;
  temperatureF: number | null;
  windMph: number | null;
  windDirection: string;
  shortForecast: string;
  precipitationChance: number | null;
  isDaytime: boolean;
};

export type WeatherConditions = {
  status: EvidenceStatus;
  kind: "forecast";
  temperatureF: number | null;
  windMph: number | null;
  windDirection: string | null;
  shortForecast: string | null;
  precipitationChance: number | null;
  forecastAt: string | null;
  updatedAt: string | null;
  fetchedAt: string | null;
  checkedAt: string;
  sourceUrl: string;
  sunrise: string | null;
  sunset: string | null;
  hourly: WeatherPeriod[];
  note: string;
};

export type WeatherAlert = {
  id: string;
  event: string;
  headline: string;
  severity: string;
  expires: string | null;
  sourceUrl: string;
};

export type DestinationConditions = {
  id: DestinationId;
  camera: CameraConditions;
  weather: WeatherConditions;
  alerts: WeatherAlert[];
  alertsStatus: EvidenceStatus;
};

export type ConditionsResponse = {
  fetchedAt: string;
  destinations: DestinationConditions[];
  sources: { name: string; url: string }[];
};

const REQUEST_TIMEOUT = 4_500;
const CACHE_TTL = 5 * 60_000;
const CAMERA_STALE_AFTER = 2 * 60 * 60_000;
const FORECAST_STALE_AFTER = 12 * 60 * 60_000;
const NWS_ORIGIN = "https://api.weather.gov";
const CAMERA_ORIGIN = "https://cmgp-coastcam.s3-us-west-2.amazonaws.com";
const NWS_HEADERS = {
  "User-Agent": "OUTSIDE (https://github.com/yavol/outside, yaroslav.volovich@gmail.com)",
  Accept: "application/geo+json",
};

type CacheValue = { value: DestinationConditions; expiresAt: number };
const cache = new Map<DestinationId, CacheValue>();
const pending = new Map<DestinationId, Promise<DestinationConditions>>();
const pointCache = new Map<DestinationId, { value: NwsPoint; expiresAt: number }>();

type NwsPoint = {
  forecastHourly: string;
  sunrise: string | null;
  sunset: string | null;
};
type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject {
  return typeof value === "object" && value !== null ? (value as JsonObject) : {};
}

function string(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function date(value: unknown): string | null {
  const raw = string(value);
  return raw && Number.isFinite(Date.parse(raw)) ? new Date(raw).toISOString() : null;
}

/** No input URL is ever fetched. NWS links are constrained to the expected public API origin. */
async function fetchNws(url: string): Promise<JsonObject> {
  const parsed = new URL(url);
  if (parsed.origin !== NWS_ORIGIN || parsed.username || parsed.password) throw new Error("Invalid NWS URL");
  const response = await fetch(parsed, {
    headers: NWS_HEADERS,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT),
    redirect: "error",
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`NWS returned ${response.status}`);
  return object(await response.json());
}

async function getPoint(id: DestinationId): Promise<NwsPoint> {
  const existing = pointCache.get(id);
  if (existing && existing.expiresAt > Date.now()) return existing.value;
  const [lng, lat] = getDestination(id).coordinates;
  const response = await fetchNws(`${NWS_ORIGIN}/points/${lat},${lng}`);
  const properties = object(response.properties);
  const hourly = string(properties.forecastHourly);
  if (!hourly || new URL(hourly).origin !== NWS_ORIGIN) throw new Error("No NWS hourly forecast");
  const astro = object(properties.astronomicalData);
  const value: NwsPoint = {
    forecastHourly: hourly,
    sunrise: date(astro.sunrise),
    sunset: date(astro.sunset),
  };
  // Points include today's astronomical data, so refresh more often than the grid mapping needs.
  pointCache.set(id, { value, expiresAt: Date.now() + 30 * 60_000 });
  return value;
}

function parseWind(value: unknown): number | null {
  if (typeof value === "number") return number(value);
  const raw = string(value);
  if (!raw) return null;
  const values = raw.match(/\d+(?:\.\d+)?/g)?.map(Number);
  if (!values?.length) return null;
  const mph = Math.max(...values);
  return /km\/h/i.test(raw) ? Math.round(mph / 1.609344) : mph;
}

function parsePeriod(raw: unknown): WeatherPeriod | null {
  const period = object(raw);
  const startTime = date(period.startTime);
  const endTime = date(period.endTime);
  if (!startTime || !endTime) return null;
  const temperature = number(period.temperature);
  return {
    startTime,
    endTime,
    temperatureF: temperature === null ? null : period.temperatureUnit === "C" ? Math.round(temperature * 1.8 + 32) : temperature,
    windMph: parseWind(period.windSpeed),
    windDirection: string(period.windDirection) ?? "",
    shortForecast: string(period.shortForecast) ?? "Forecast unavailable",
    precipitationChance: number(object(period.probabilityOfPrecipitation).value),
    isDaytime: period.isDaytime === true,
  };
}

async function getWeather(id: DestinationId): Promise<WeatherConditions> {
  const point = await getPoint(id);
  const response = await fetchNws(point.forecastHourly);
  const properties = object(response.properties);
  const periods = Array.isArray(properties.periods) ? properties.periods.map(parsePeriod).filter((period): period is WeatherPeriod => period !== null) : [];
  const now = Date.now();
  const hourly = periods.filter((period) => Date.parse(period.endTime) > now).slice(0, 12);
  const current = hourly.find((period) => Date.parse(period.startTime) <= now) ?? hourly[0];
  if (!current) throw new Error("No current or upcoming NWS forecast");
  const updatedAt = date(properties.updateTime) ?? date(properties.updated) ?? date(properties.generatedAt);
  const stale = !updatedAt || now - Date.parse(updatedAt) > FORECAST_STALE_AFTER;
  const fetchedAt = new Date().toISOString();
  return {
    status: stale ? "stale" : "available",
    kind: "forecast",
    temperatureF: current.temperatureF,
    windMph: current.windMph,
    windDirection: current.windDirection,
    shortForecast: current.shortForecast,
    precipitationChance: current.precipitationChance,
    forecastAt: current.startTime,
    updatedAt,
    fetchedAt,
    checkedAt: fetchedAt,
    sourceUrl: point.forecastHourly,
    sunrise: point.sunrise,
    sunset: point.sunset,
    hourly,
    note: stale ? "NWS hourly forecast is older than 12 hours. Treat as outdated." : "National Weather Service hourly forecast; this is forecast guidance, not an on-site observation.",
  };
}

async function getCamera(id: DestinationId): Promise<CameraConditions> {
  const place = getDestination(id);
  const url = new URL(place.camera.imageUrl);
  if (url.origin !== CAMERA_ORIGIN || !/^\/cameras\/(dreaminn|sunset)\/latest\/c[12]_snap\.jpg$/.test(url.pathname)) throw new Error("Invalid camera source");
  const response = await fetch(url, {
    method: "HEAD",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT),
    redirect: "error",
    cache: "no-store",
  });
  if (!response.ok || !response.headers.get("content-type")?.startsWith("image/")) throw new Error("Camera unavailable");
  const fetchedAt = new Date().toISOString();
  const lastModifiedAt = date(response.headers.get("last-modified"));
  const stale = !lastModifiedAt || Date.now() - Date.parse(lastModifiedAt) > CAMERA_STALE_AFTER;
  url.searchParams.set("v", String(lastModifiedAt ? Date.parse(lastModifiedAt) : Math.floor(Date.now() / CACHE_TTL)));
  return {
    status: stale ? "stale" : "available",
    imageUrl: url.toString(),
    sourceUrl: place.camera.sourceUrl,
    fetchedAt,
    checkedAt: fetchedAt,
    capturedAt: null,
    lastModifiedAt,
    note: stale
      ? "USGS source file is over 2 hours old or its update time is unknown. Cameras collect during daylight only. Read the capture time printed on the image."
      : `USGS publishes snapshots about every ${place.camera.cadenceMinutes} minutes in daylight, with a ${place.camera.publicationDelayMinutes}-minute delay. File update time is not capture time; read the timestamp printed on the image.`,
  };
}

async function getAlerts(id: DestinationId): Promise<WeatherAlert[]> {
  const [lng, lat] = getDestination(id).coordinates;
  const response = await fetchNws(`${NWS_ORIGIN}/alerts/active?point=${lat},${lng}`);
  const features = Array.isArray(response.features) ? response.features : [];
  return features.slice(0, 8).map((raw) => {
    const feature = object(raw);
    const properties = object(feature.properties);
    const alertId = string(feature.id) ?? string(properties.id) ?? "";
    return {
      id: alertId,
      event: string(properties.event) ?? "Weather alert",
      headline: string(properties.headline) ?? string(properties.event) ?? "Weather alert",
      severity: string(properties.severity) ?? "Unknown",
      expires: date(properties.expires),
      sourceUrl: alertId.startsWith(`${NWS_ORIGIN}/alerts/`) ? alertId : `https://www.weather.gov/`,
    };
  });
}

function unavailableWeather(id: DestinationId, checkedAt: string): WeatherConditions {
  const [lng, lat] = getDestination(id).coordinates;
  return {
    status: "unavailable", kind: "forecast", temperatureF: null, windMph: null,
    windDirection: null, shortForecast: null, precipitationChance: null,
    forecastAt: null, updatedAt: null, fetchedAt: null, checkedAt,
    sourceUrl: `https://forecast.weather.gov/MapClick.php?lat=${lat}&lon=${lng}`,
    sunrise: null, sunset: null, hourly: [],
    note: "The NWS forecast could not be reached. No weather values have been substituted.",
  };
}

async function refreshDestination(id: DestinationId): Promise<DestinationConditions> {
  const previous = cache.get(id)?.value;
  const checkedAt = new Date().toISOString();
  const [cameraResult, weatherResult, alertsResult] = await Promise.allSettled([getCamera(id), getWeather(id), getAlerts(id)]);
  const camera: CameraConditions = cameraResult.status === "fulfilled" ? cameraResult.value
    : previous?.camera.imageUrl ? { ...previous.camera, status: "stale", checkedAt, note: "Camera source could not be checked again. The previous source URL is shown; read the timestamp printed on the image to establish its capture time." }
    : { status: "unavailable", imageUrl: null, sourceUrl: getDestination(id).camera.sourceUrl, fetchedAt: null, checkedAt, capturedAt: null, lastModifiedAt: null, note: "The USGS camera could not be reached. Open the official source or try again shortly." };
  const weather: WeatherConditions = weatherResult.status === "fulfilled" ? weatherResult.value
    : previous?.weather.fetchedAt ? { ...previous.weather, status: "stale", checkedAt, note: "Forecast refresh failed. Showing the last successful NWS forecast; check its update time." }
    : unavailableWeather(id, checkedAt);
  const value: DestinationConditions = {
    id, camera, weather,
    alerts: alertsResult.status === "fulfilled" ? alertsResult.value : previous?.alerts ?? [],
    alertsStatus: alertsResult.status === "fulfilled" ? "available" : previous?.alerts.length ? "stale" : "unavailable",
  };
  // Retry an unavailable source sooner, while still preventing rapid repeated upstream requests.
  cache.set(id, { value, expiresAt: Date.now() + (camera.status === "unavailable" || weather.status === "unavailable" ? 60_000 : CACHE_TTL) });
  return value;
}

export async function getDestinationConditions(id: DestinationId): Promise<DestinationConditions> {
  const existing = cache.get(id);
  if (existing && existing.expiresAt > Date.now()) return existing.value;
  const inFlight = pending.get(id);
  if (inFlight) return inFlight;
  const request = refreshDestination(id).finally(() => pending.delete(id));
  pending.set(id, request);
  return request;
}

export async function getConditions(ids: DestinationId[] = destinations.map((place) => place.id)): Promise<ConditionsResponse> {
  return {
    fetchedAt: new Date().toISOString(),
    destinations: await Promise.all([...new Set(ids)].map(getDestinationConditions)),
    sources: [
      { name: "USGS Santa Cruz CoastCam", url: "https://www.usgs.gov/centers/pcmsc/science/using-video-imagery-study-coastal-change-santa-cruz-beaches" },
      { name: "USGS Sunset CoastCam", url: "https://www.usgs.gov/centers/pcmsc/science/using-video-imagery-study-coastal-change-sunset-state-beach" },
      { name: "National Weather Service API", url: "https://www.weather.gov/documentation/services-web-api" },
    ],
  };
}
