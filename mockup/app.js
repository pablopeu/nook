const statusEl = document.getElementById("status");
const screenEl = document.getElementById("screen");
const hourlyBandEl = document.getElementById("hourly-band");
const dailyBandEl = document.getElementById("daily-band");

const query = new URLSearchParams(window.location.search);

const params = {
  endpointBaseUrl: query.get("endpoint_base_url") || "../server/weather.php",
  mode: query.get("mode") || "city",
  city: query.get("city") || "Buenos Aires",
  country: query.get("country") || "Argentina",
  lat: query.get("lat") || "-34.6037",
  lon: query.get("lon") || "-58.3816",
  units: query.get("units") || "c",
  demo: query.get("demo") === "1",
};

function endpointUrl() {
  const url = new URL(params.endpointBaseUrl, window.location.href);
  url.searchParams.set("mode", params.mode);
  url.searchParams.set("units", params.units);

  if (params.mode === "coords") {
    url.searchParams.set("lat", params.lat);
    url.searchParams.set("lon", params.lon);
  } else {
    url.searchParams.set("city", params.city);
    url.searchParams.set("country", params.country);
  }

  return url.toString();
}

async function loadData() {
  if (params.demo) {
    return loadDemoData();
  }

  try {
    const response = await fetch(endpointUrl(), { headers: { Accept: "application/json" } });
    if (!response.ok) {
      throw new Error(`Endpoint returned ${response.status}`);
    }

    const payload = await response.json();
    if (!payload.ok) {
      throw new Error(payload.error?.message || "Endpoint returned an error payload");
    }

    return payload;
  } catch (error) {
    console.warn("Falling back to demo data:", error);
    statusEl.querySelector(".status-title").textContent = "Endpoint no disponible";
    statusEl.querySelector(".status-copy").textContent = "Se cargaron datos demo para seguir ajustando el layout mientras se levanta el servidor.";
    return loadDemoData();
  }
}

async function loadDemoData() {
  const response = await fetch("./demo-weather.json");
  return response.json();
}

function setText(id, value) {
  document.getElementById(id).textContent = String(value);
}

function heroDescriptionText(text) {
  const source = String(text || "").toLowerCase();

  if (source.includes("thunder")) return "Tormentas";
  if (source.includes("heavy rain")) return "Lluvias intensas";
  if (source.includes("light rain")) return "Lluvias leves";
  if (source.includes("rain")) return "Lluvias";
  if (source.includes("snow")) return "Nieve";
  if (source.includes("fog")) return "Niebla";
  if (source.includes("haze")) return "Bruma";
  if (source.includes("overcast")) return "Cubierto";
  if (source.includes("mostly cloudy")) return "Mayormente nublado";
  if (source.includes("cloudy")) return "Parcial nublado";
  if (source.includes("clear")) return "Despejado";

  return "Variable";
}

function renderCurrent(data) {
  setText("current-temperature", data.current.temperature);
  setText("current-min", data.current.min);
  setText("current-max", data.current.max);
  setText("feels-like", data.current.feels_like);
  setText("humidity", data.current.humidity);
  setText("pressure", data.current.pressure_hpa);

  const heroIcon = document.getElementById("hero-icon");
  heroIcon.src = data.hero.icon_url;
  heroIcon.alt = data.hero.condition_text;

  document.getElementById("hero-description").textContent = heroDescriptionText(data.hero.condition_text);
}

function renderHours(data) {
  hourlyBandEl.innerHTML = "";

  data.hours.slice(0, 12).forEach((hour) => {
    const card = document.createElement("article");
    card.className = "hour-card";
    card.innerHTML = `
      <img src="${hour.icon_url}" alt="${hour.condition_text}">
      <div class="hour-label">${hour.time_label}</div>
    `;
    hourlyBandEl.appendChild(card);
  });
}

function renderDays(data) {
  dailyBandEl.innerHTML = "";

  data.days.slice(0, 7).forEach((day) => {
    const minValue = day.min ?? "--";
    const maxValue = day.max ?? "--";
    const precipValue = day.precipitation_chance == null ? "--" : `${day.precipitation_chance}%`;
    const card = document.createElement("article");
    card.className = "day-card";
    card.innerHTML = `
      <div class="day-minmax">
        <div class="day-stat">${minValue}${day.min == null ? "" : "°"}</div>
        <div class="day-stat">${maxValue}${day.max == null ? "" : "°"}</div>
      </div>
      <div class="day-precip day-stat">${precipValue}</div>
      <img src="${day.icon_url}" alt="${day.condition_text}">
      <div class="day-label">${day.day_label}</div>
    `;
    dailyBandEl.appendChild(card);
  });
}

function revealScreen() {
  statusEl.hidden = true;
  screenEl.hidden = false;
}

loadData()
  .then((data) => {
    renderCurrent(data);
    renderHours(data);
    renderDays(data);
    revealScreen();
  })
  .catch((error) => {
    statusEl.querySelector(".status-title").textContent = "No se pudo cargar el mockup";
    statusEl.querySelector(".status-copy").textContent = error.message;
  });
