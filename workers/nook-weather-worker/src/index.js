const TRMNL_ICON_PREFIX = "https://trmnl.com/images/plugins/weather/";
const DEFAULT_CACHE_TTL_SECONDS = 600;
const FORECAST_DAYS = 7;
const HOURLY_WINDOW_SIZE = 12;
const HERO_WINDOW_SIZE = 4;
const METEOBLUE_FORECAST_URL = "https://my.meteoblue.com/packages/basic-1h_basic-day_current";
const METEOBLUE_SEARCH_URL = "https://www.meteoblue.com/en/server/search/query3";
const CACHE_SCHEMA_VERSION = "meteoblue-worker-v1";
const ACCEPTED_PATHS = new Set(["/", "/weather", "/weather.php", "/server/weather.php"]);

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return withCors(new Response(null, { status: 204 }));
    }

    if (request.method !== "GET") {
      return errorResponse("Method not allowed.", 405);
    }

    const url = new URL(request.url);
    if (!ACCEPTED_PATHS.has(url.pathname)) {
      return withCors(
        jsonResponse(
          {
            ok: false,
            error: {
              message: "Not found.",
              status: 404,
              accepted_paths: Array.from(ACCEPTED_PATHS),
            },
          },
          404
        )
      );
    }

    const apiKey = String(env.METEOBLUE_API_KEY || "").trim();
    if (!apiKey) {
      return errorResponse("METEOBLUE_API_KEY is not configured.", 500);
    }

    let validated;
    try {
      validated = validateRequest(url.searchParams);
    } catch (error) {
      return error instanceof HttpError
        ? errorResponse(error.message, error.status, error.extra)
        : errorResponse("Invalid request.", 400);
    }

    const cacheRequest = new Request(buildCacheUrl(url, validated), {
      method: "GET",
      headers: { Accept: "application/json" },
    });

    const cache = caches.default;
    const cached = await cache.match(cacheRequest);
    if (cached) {
      return withCors(cached);
    }

    try {
      const location = await resolveLocation(validated, apiKey);
      const source = await fetchMeteoblue(location, validated, apiKey);
      const normalized = normalizeWeather(source, validated, location);
      const response = jsonResponse(normalized, 200, {
        "Cache-Control": `public, max-age=${DEFAULT_CACHE_TTL_SECONDS}`,
      });

      ctx.waitUntil(cache.put(cacheRequest, response.clone()));
      return withCors(response);
    } catch (error) {
      if (error instanceof HttpError) {
        return errorResponse(error.message, error.status, error.extra);
      }

      return errorResponse("Unexpected worker error.", 500, {
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  },
};

class HttpError extends Error {
  constructor(message, status = 400, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

function jsonResponse(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...headers,
    },
  });
}

function withCors(response) {
  const next = new Response(response.body, response);
  next.headers.set("Access-Control-Allow-Origin", "*");
  next.headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  next.headers.set("Access-Control-Allow-Headers", "Content-Type");
  return next;
}

function errorResponse(message, status = 400, extra = {}) {
  return withCors(
    jsonResponse(
      {
        ok: false,
        error: {
          message,
          status,
          ...extra,
        },
      },
      status
    )
  );
}

function requestParam(searchParams, key) {
  const raw = searchParams.get(key);
  if (raw === null) {
    return null;
  }

  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}

function validateRequest(searchParams) {
  const mode = requestParam(searchParams, "mode") ?? "city";
  const units = (requestParam(searchParams, "units") ?? "c").toLowerCase();

  if (!["city", "coords"].includes(mode)) {
    throw new HttpError("Invalid mode. Use city or coords.", 400);
  }

  if (!["c", "f"].includes(units)) {
    throw new HttpError("Invalid units. Use c or f.", 400);
  }

  if (mode === "city") {
    const city = requestParam(searchParams, "city");
    const country = requestParam(searchParams, "country");

    if (city === null || country === null) {
      throw new HttpError("City mode requires city and country.", 400);
    }

    return {
      mode,
      units,
      city,
      country,
      query: `${city}, ${country}`,
    };
  }

  const lat = requestParam(searchParams, "lat");
  const lon = requestParam(searchParams, "lon");

  if (lat === null || lon === null) {
    throw new HttpError("Coords mode requires lat and lon.", 400);
  }

  const parsedLat = Number(lat);
  const parsedLon = Number(lon);

  if (Number.isNaN(parsedLat) || Number.isNaN(parsedLon)) {
    throw new HttpError("lat and lon must be numeric.", 400);
  }

  return {
    mode,
    units,
    lat: parsedLat,
    lon: parsedLon,
    query: `${lat},${lon}`,
  };
}

function buildCacheUrl(sourceUrl, request) {
  const cacheUrl = new URL("https://cache.nook.weather.internal/worker");
  cacheUrl.searchParams.set("schema", CACHE_SCHEMA_VERSION);
  cacheUrl.searchParams.set("mode", request.mode);
  cacheUrl.searchParams.set("units", request.units);

  if (request.mode === "city") {
    cacheUrl.searchParams.set("city", request.city);
    cacheUrl.searchParams.set("country", request.country);
  } else {
    cacheUrl.searchParams.set("lat", String(request.lat));
    cacheUrl.searchParams.set("lon", String(request.lon));
  }

  cacheUrl.searchParams.set("path", sourceUrl.pathname);
  return cacheUrl.toString();
}

async function fetchJson(url, failureMessage) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "nook-weather-plugin/1.0",
      Accept: "application/json",
    },
  });

  let decoded;
  try {
    decoded = await response.json();
  } catch {
    throw new HttpError(`${failureMessage} Invalid JSON response.`, 502);
  }

  if (!response.ok) {
    throw new HttpError(decoded.message || failureMessage, 502, {
      upstream_status: response.status,
    });
  }

  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
    throw new HttpError(`${failureMessage} Invalid JSON response.`, 502);
  }

  return decoded;
}

function isIso2(country) {
  return /^[A-Za-z]{2}$/.test(country);
}

async function resolveLocation(request, apiKey) {
  if (request.mode === "coords") {
    const coords = {
      lat: Number(request.lat),
      lon: Number(request.lon),
      name: "",
      region: "",
      country: "",
      timezone: "",
    };

    const url = new URL(METEOBLUE_SEARCH_URL);
    url.searchParams.set("query", `${request.lat} ${request.lon}`);
    url.searchParams.set("itemsPerPage", "1");
    url.searchParams.set("apikey", apiKey);

    const search = await fetchJson(url.toString(), "Could not resolve coordinates.");
    const result = Array.isArray(search.results) ? search.results[0] : null;
    if (result && typeof result === "object") {
      coords.name = String(result.name || "");
      coords.region = String(result.admin1 || "");
      coords.country = String(result.country || "");
      coords.timezone = String(result.timezone || "");
    }

    return coords;
  }

  const country = String(request.country).trim();
  const url = new URL(METEOBLUE_SEARCH_URL);
  url.searchParams.set("query", request.city);
  url.searchParams.set("itemsPerPage", "20");
  url.searchParams.set("apikey", apiKey);
  if (isIso2(country)) {
    url.searchParams.set("iso2", country.toUpperCase());
  }

  const search = await fetchJson(url.toString(), "Could not resolve location.");
  const results = Array.isArray(search.results) ? search.results : [];
  if (results.length === 0) {
    throw new HttpError("Location not found.", 404);
  }

  const cityLower = request.city.toLowerCase();
  const countryLower = country.toLowerCase();

  let chosen =
    results.find((result) => {
      const nameMatches = String(result.name || "").toLowerCase() === cityLower;
      const countryMatches =
        country === "" ||
        String(result.country || "").toLowerCase() === countryLower ||
        String(result.iso2 || "").toUpperCase() === country.toUpperCase();

      return nameMatches && countryMatches;
    }) ||
    results.find((result) => {
      return (
        country === "" ||
        String(result.country || "").toLowerCase() === countryLower ||
        String(result.iso2 || "").toUpperCase() === country.toUpperCase()
      );
    }) ||
    results[0];

  return {
    lat: Number(chosen.lat || 0),
    lon: Number(chosen.lon || 0),
    name: String(chosen.name || ""),
    region: String(chosen.admin1 || ""),
    country: String(chosen.country || ""),
    timezone: String(chosen.timezone || ""),
  };
}

async function fetchMeteoblue(location, request, apiKey) {
  const url = new URL(METEOBLUE_FORECAST_URL);
  url.searchParams.set("lat", String(location.lat));
  url.searchParams.set("lon", String(location.lon));
  url.searchParams.set("apikey", apiKey);

  if (request.units === "f") {
    url.searchParams.set("temperature", "F");
  }

  return fetchJson(url.toString(), "Could not reach Meteoblue.");
}

function iconFilename(name) {
  return `${TRMNL_ICON_PREFIX}${name}.svg`;
}

function meteoblueIconGroup(pictocode, hourly) {
  if (hourly) {
    if ([1, 2, 3].includes(pictocode)) return "clear";
    if ([4, 5, 6, 7, 8, 9].includes(pictocode)) return "partly_cloudy";
    if ([10, 11, 12].includes(pictocode)) return "thunder_rain";
    if ([13, 14, 15].includes(pictocode)) return "haze";
    if ([16, 17, 18].includes(pictocode)) return "fog";
    if ([19, 20, 21, 22].includes(pictocode)) return "cloudy";
    if ([23, 25].includes(pictocode)) return "rain";
    if ([24, 26].includes(pictocode)) return "snow";
    if ([27, 28, 30].includes(pictocode)) return "thunder_rain";
    if (pictocode === 29) return "thunder_snow";
    if ([31, 33].includes(pictocode)) return "sprinkle";
    if ([32, 34].includes(pictocode)) return "snow";
    if (pictocode === 35) return "mix";
    return "cloudy";
  }

  if (pictocode === 1) return "clear";
  if ([2, 3].includes(pictocode)) return "partly_cloudy";
  if ([4, 20].includes(pictocode)) return "cloudy";
  if (pictocode === 5) return "fog";
  if ([6, 12, 14, 16].includes(pictocode)) return "rain";
  if (pictocode === 7) return "sprinkle";
  if ([8, 21, 22, 23, 24, 25].includes(pictocode)) return "thunder_rain";
  if ([9, 10, 13, 15, 17].includes(pictocode)) return "snow";
  if (pictocode === 11) return "mix";
  return "cloudy";
}

function meteobluePictocodeDescription(pictocode, hourly) {
  const hourlyDescriptions = {
    1: "Clear, cloudless sky",
    2: "Clear, few cirrus",
    3: "Clear with cirrus",
    4: "Clear with few low clouds",
    5: "Clear with few low clouds and few cirrus",
    6: "Clear with few low clouds and cirrus",
    7: "Partly cloudy",
    8: "Partly cloudy and few cirrus",
    9: "Partly cloudy and cirrus",
    10: "Mixed with some thunderstorm clouds possible",
    11: "Mixed with few cirrus with some thunderstorm clouds possible",
    12: "Mixed with cirrus with some thunderstorm clouds possible",
    13: "Clear but hazy",
    14: "Clear but hazy with few cirrus",
    15: "Clear but hazy with cirrus",
    16: "Fog or low stratus clouds",
    17: "Fog or low stratus clouds with few cirrus",
    18: "Fog or low stratus clouds with cirrus",
    19: "Mostly cloudy",
    20: "Mostly cloudy and few cirrus",
    21: "Mostly cloudy and cirrus",
    22: "Overcast",
    23: "Overcast with rain",
    24: "Overcast with snow",
    25: "Overcast with heavy rain",
    26: "Overcast with heavy snow",
    27: "Rain, thunderstorms likely",
    28: "Light rain, thunderstorms likely",
    29: "Storm with heavy snow",
    30: "Heavy rain, thunderstorms likely",
    31: "Mixed with showers",
    32: "Mixed with snow showers",
    33: "Overcast with light rain",
    34: "Overcast with light snow",
    35: "Overcast with mixture of snow and rain",
  };

  const dailyDescriptions = {
    1: "Clear, cloudless sky",
    2: "Clear and few clouds",
    3: "Partly cloudy",
    4: "Overcast",
    5: "Fog",
    6: "Overcast with rain",
    7: "Mixed with showers",
    8: "Showers, thunderstorms likely",
    9: "Overcast with snow",
    10: "Mixed with snow showers",
    11: "Mostly cloudy with a mixture of snow and rain",
    12: "Overcast with occasional rain",
    13: "Overcast with occasional snow",
    14: "Mostly cloudy with rain",
    15: "Mostly cloudy with snow",
    16: "Mostly cloudy with occasional rain",
    17: "Mostly cloudy with occasional snow",
    20: "Mostly cloudy",
    21: "Mostly clear with a chance of local thunderstorms",
    22: "Partly cloudy with a chance of local thunderstorms",
    23: "Partly cloudy with local thunderstorms and showers possible",
    24: "Cloudy with thunderstorms and heavy showers",
    25: "Mostly cloudy with thunderstorms and showers",
  };

  const descriptions = hourly ? hourlyDescriptions : dailyDescriptions;
  return descriptions[pictocode] || `Pictocode ${pictocode}`;
}

function iconNameForGroup(group, isDay) {
  switch (group) {
    case "clear":
      return isDay ? "wi-day-sunny" : "wi-night-clear";
    case "partly_cloudy":
      return isDay ? "wi-day-cloudy" : "wi-night-alt-partly-cloudy";
    case "cloudy":
      return isDay ? "wi-cloudy" : "wi-night-cloudy";
    case "fog":
      return isDay ? "wi-day-fog" : "wi-night-fog";
    case "haze":
      return isDay ? "wi-day-haze" : "wi-night-fog";
    case "sprinkle":
      return isDay ? "wi-day-sprinkle" : "wi-night-alt-sprinkle";
    case "rain":
      return isDay ? "wi-day-rain" : "wi-night-alt-rain";
    case "mix":
      return isDay ? "wi-day-rain-mix" : "wi-night-alt-rain-mix";
    case "snow":
      return isDay ? "wi-day-snow" : "wi-night-alt-snow";
    case "thunder_rain":
      return isDay ? "wi-day-thunderstorm" : "wi-night-alt-thunderstorm";
    case "thunder_snow":
      return isDay ? "wi-day-snow-thunderstorm" : "wi-night-alt-snow-thunderstorm";
    default:
      return isDay ? "wi-cloudy" : "wi-night-cloudy";
  }
}

function severityForGroup(group) {
  switch (group) {
    case "thunder_snow":
      return 10;
    case "thunder_rain":
      return 9;
    case "snow":
      return 7;
    case "mix":
      return 6;
    case "rain":
      return 5;
    case "sprinkle":
      return 4;
    case "fog":
      return 3;
    case "haze":
    case "cloudy":
      return 2;
    case "partly_cloudy":
      return 1;
    case "clear":
    default:
      return 0;
  }
}

function spanishConditionLabel(group, text) {
  switch (group) {
    case "thunder_snow":
      return "Nieve y tormenta";
    case "thunder_rain":
      return "Tormentas";
    case "snow":
      return "Nieve";
    case "mix":
      return "Agua y nieve";
    case "rain":
      return text.toLowerCase().includes("heavy") ? "Lluvias intensas" : "Lluvias";
    case "sprinkle":
      return "Lloviznas";
    case "fog":
      return "Niebla";
    case "haze":
      return "Bruma";
    case "cloudy":
      return "Nublado";
    case "partly_cloudy":
      return "Parcial nublado";
    case "clear":
      return "Despejado";
    default:
      return "Variable";
  }
}

function iconPayloadFromMeteoblue(pictocode, isDay, hourly, text) {
  const group = meteoblueIconGroup(pictocode, hourly);
  const description = text || meteobluePictocodeDescription(pictocode, hourly);

  return {
    code: pictocode,
    group,
    severity: severityForGroup(group),
    url: iconFilename(iconNameForGroup(group, isDay)),
    text: description,
    text_es: spanishConditionLabel(group, description),
  };
}

function formatTemperature(value) {
  return Math.round(Number(value));
}

function degreesUnit(request) {
  return request.units === "f" ? "F" : "C";
}

function parseLocalDateTime(value) {
  const [datePart, timePart] = value.split(" ");
  if (!datePart || !timePart) {
    throw new HttpError("Invalid Meteoblue datetime format.", 502, { value });
  }

  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute] = timePart.split(":").map(Number);
  return new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
}

function formatDate(date) {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function formatTime(date) {
  return `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

function formatTimeLabel(date) {
  return `${date.getUTCHours()}:${pad(date.getUTCMinutes())}`;
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function nextFullHour(date) {
  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    date.getUTCHours() + 1,
    0,
    0
  ));
}

function spanishDayLabel(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day, 0, 0, 0)).getUTCDay();
  return ["Dom", "Lun", "Mar", "Mie", "Jue", "Vie", "Sab"][weekday];
}

function buildHourRows(source) {
  const data = source.data_1h || {};
  const times = Array.isArray(data.time) ? data.time : [];
  if (times.length === 0) {
    throw new HttpError("Meteoblue response is missing hourly forecast data.", 502);
  }

  return times.map((time, index) => {
    const dateTime = parseLocalDateTime(String(time));
    const pictocode = Number(data.pictocode?.[index] ?? 19);
    const isDay = Number(data.isdaylight?.[index] ?? 1) === 1;
    const icon = iconPayloadFromMeteoblue(pictocode, isDay, true);

    return {
      datetime: dateTime,
      datetime_string: String(time),
      date: formatDate(dateTime),
      time: formatTime(dateTime),
      temperature: formatTemperature(data.temperature?.[index] ?? 0),
      feels_like: formatTemperature(data.felttemperature?.[index] ?? data.temperature?.[index] ?? 0),
      humidity: Math.round(Number(data.relativehumidity?.[index] ?? 0)),
      pressure_hpa: formatTemperature(data.sealevelpressure?.[index] ?? 0),
      precipitation_chance: Math.round(Number(data.precipitation_probability?.[index] ?? 0)),
      condition_text: icon.text,
      condition_text_es: icon.text_es,
      condition_code: icon.code,
      icon_group: icon.group,
      icon_url: icon.url,
      severity: icon.severity,
      is_day: isDay,
    };
  });
}

function findCurrentHourRow(hourRows, currentTime) {
  let row = hourRows.find((item) => item.datetime_string === currentTime);
  if (row) return row;

  const currentPrefix = currentTime.slice(0, 13);
  row = hourRows.find((item) => item.datetime_string.slice(0, 13) === currentPrefix);
  if (row) return row;

  row = hourRows.find((item) => item.datetime_string > currentTime);
  return row || hourRows[0] || null;
}

function predominantHourIcon(rows) {
  if (rows.length === 0) {
    return {
      icon_url: iconFilename("wi-cloudy"),
      condition_text: "Cloudy",
      condition_text_es: "Nublado",
      icon_group: "cloudy",
      severity: 2,
    };
  }

  const scores = new Map();
  rows.forEach((row, index) => {
    const group = row.icon_group;
    if (!scores.has(group)) {
      scores.set(group, {
        count: 0,
        severity: Number(row.severity),
        first_index: index,
        row,
      });
    }

    scores.get(group).count += 1;
  });

  const winner = [...scores.values()].sort((left, right) => {
    if (left.count !== right.count) {
      return right.count - left.count;
    }

    if (left.severity !== right.severity) {
      return right.severity - left.severity;
    }

    return left.first_index - right.first_index;
  })[0];

  return winner?.row || {
    icon_url: iconFilename("wi-cloudy"),
    condition_text: "Cloudy",
    condition_text_es: "Nublado",
    icon_group: "cloudy",
    severity: 2,
  };
}

function adjustHeroIcon(hero, rows) {
  if (rows.length === 0) {
    return hero;
  }

  const maxPrecipitation = Math.max(...rows.map((row) => row.precipitation_chance));
  let group = String(hero.icon_group || "cloudy");

  if (["fog", "haze", "snow", "mix", "thunder_snow"].includes(group)) {
    return hero;
  }

  if (maxPrecipitation >= 75) {
    group = "thunder_rain";
  } else if (maxPrecipitation >= 55) {
    group = "rain";
  } else if (maxPrecipitation >= 40) {
    group = "sprinkle";
  } else if (["rain", "sprinkle", "thunder_rain"].includes(group)) {
    group = "cloudy";
  }

  const sampleRow = rows.find((row) => typeof row.is_day === "boolean");
  const isDay = sampleRow ? Boolean(sampleRow.is_day) : true;
  const text = {
    thunder_rain: "Tormentas",
    rain: "Lluvias",
    sprinkle: "Lloviznas",
    partly_cloudy: "Parcial nublado",
  }[group] || "Nublado";

  return {
    ...hero,
    icon_group: group,
    icon_url: iconFilename(iconNameForGroup(group, isDay)),
    severity: severityForGroup(group),
    condition_text_es: text,
  };
}

function buildHourWindow(hourRows, currentTime) {
  const start = nextFullHour(parseLocalDateTime(currentTime));
  const items = [];

  for (const row of hourRows) {
    if (row.datetime < start) {
      continue;
    }

    items.push({
      time: row.time,
      time_label: formatTimeLabel(row.datetime),
      temperature: row.temperature,
      precipitation_chance: row.precipitation_chance,
      condition_text: row.condition_text,
      condition_text_es: row.condition_text_es,
      condition_code: row.condition_code,
      icon_group: row.icon_group,
      icon_url: row.icon_url,
      severity: row.severity,
    });

    if (items.length >= HOURLY_WINDOW_SIZE) {
      break;
    }
  }

  return items;
}

function rowsForDate(hourRows, date) {
  return hourRows.filter((row) => row.date === date);
}

function buildDayRows(hourRows, currentTime) {
  const startOfToday = parseLocalDateTime(`${currentTime.slice(0, 10)} 00:00`);
  const days = [];

  for (let offset = 0; offset < FORECAST_DAYS; offset += 1) {
    const date = formatDate(new Date(startOfToday.getTime() + offset * 86400000));
    const rows = rowsForDate(hourRows, date);

    if (rows.length === 0) {
      days.push({
        date,
        day_label: spanishDayLabel(date),
        min: null,
        max: null,
        precipitation_chance: null,
        condition_text: "Forecast unavailable",
        condition_text_es: "Sin pronóstico",
        condition_code: null,
        icon_group: "cloudy",
        icon_url: iconFilename("wi-cloudy"),
        available: false,
      });
      continue;
    }

    const icon = predominantHourIcon(rows);
    const precipitationChance = Math.max(...rows.map((row) => row.precipitation_chance));
    let iconGroup = String(icon.icon_group);

    if (["clear", "partly_cloudy", "cloudy"].includes(iconGroup)) {
      if (precipitationChance >= 70) {
        iconGroup = "rain";
      } else if (precipitationChance >= 40) {
        iconGroup = "sprinkle";
      }
    }

    days.push({
      date,
      day_label: spanishDayLabel(date),
      min: Math.min(...rows.map((row) => row.temperature)),
      max: Math.max(...rows.map((row) => row.temperature)),
      precipitation_chance: precipitationChance,
      condition_text: icon.condition_text,
      condition_text_es: spanishConditionLabel(iconGroup, String(icon.condition_text)),
      condition_code: icon.condition_code ?? null,
      icon_group: iconGroup,
      icon_url: iconFilename(iconNameForGroup(iconGroup, true)),
      available: true,
    });
  }

  return days;
}

function normalizeWeather(source, request, location) {
  const metadata = source.metadata || {};
  const current = source.data_current || {};
  if (!Object.keys(metadata).length || !Object.keys(current).length) {
    throw new HttpError("Meteoblue response is missing expected data.", 502);
  }

  const hourRows = buildHourRows(source);
  const currentTime = String(current.time || "");
  if (!currentTime) {
    throw new HttpError("Meteoblue response is missing current time.", 502);
  }

  const currentHour = findCurrentHourRow(hourRows, currentTime);
  if (!currentHour) {
    throw new HttpError("Could not match current Meteoblue hour.", 502);
  }

  const todayRows = rowsForDate(hourRows, currentTime.slice(0, 10));
  const hours = buildHourWindow(hourRows, currentTime);
  const heroHours = hours.slice(0, HERO_WINDOW_SIZE);
  const hero = adjustHeroIcon(predominantHourIcon(heroHours), heroHours);
  const days = buildDayRows(hourRows, currentTime);

  const currentIcon = iconPayloadFromMeteoblue(
    Number(currentHour.condition_code ?? current.pictocode_detailed ?? current.pictocode ?? 19),
    Number(current.isdaylight ?? 1) === 1,
    true
  );

  return {
    ok: true,
    error: null,
    meta: {
      source: "meteoblue",
      generated_at: new Date().toISOString(),
      cache_ttl_seconds: DEFAULT_CACHE_TTL_SECONDS,
      units: degreesUnit(request),
      available_forecast_days: FORECAST_DAYS,
      request,
      location: {
        name: location.name !== "" ? location.name : String(metadata.name || ""),
        region: String(location.region || ""),
        country: String(location.country || ""),
        lat: Number(location.lat ?? metadata.latitude ?? 0),
        lon: Number(location.lon ?? metadata.longitude ?? 0),
        tz_id: String(location.timezone || ""),
        localtime: currentTime,
      },
    },
    current: {
      temperature: formatTemperature(current.temperature ?? currentHour.temperature),
      min: todayRows.length ? Math.min(...todayRows.map((row) => row.temperature)) : null,
      max: todayRows.length ? Math.max(...todayRows.map((row) => row.temperature)) : null,
      feels_like: Number(currentHour.feels_like),
      humidity: Number(currentHour.humidity),
      pressure_hpa: Number(currentHour.pressure_hpa),
      condition_text: currentIcon.text,
      condition_text_es: currentIcon.text_es,
      condition_code: currentIcon.code,
      icon_group: currentIcon.group,
      icon_url: currentIcon.url,
      last_updated: currentTime,
    },
    hero: {
      icon_url: String(hero.icon_url || iconFilename("wi-cloudy")),
      condition_text: String(hero.condition_text || "Cloudy"),
      condition_text_es: String(hero.condition_text_es || "Nublado"),
      window_start: heroHours[0]?.time ?? null,
      window_end: heroHours[heroHours.length - 1]?.time ?? null,
    },
    hours,
    days,
  };
}
