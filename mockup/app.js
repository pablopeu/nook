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
  battery: query.get("battery") || "67",
  wifi: query.get("wifi") || "2",
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

  document.getElementById("hero-description").textContent =
    data.hero.condition_text_es || heroDescriptionText(data.hero.condition_text);
}

function renderDeviceStatus() {
  const batteryPercent = Math.max(0, Math.min(100, Number(params.battery) || 0));
  const wifiStrength = Math.max(0, Math.min(3, Number(params.wifi) || 0));

  document.getElementById("battery-fill").style.width = `${batteryPercent}%`;
  document.getElementById("wifi-icon").dataset.strength = String(wifiStrength);
}

function renderHours(data) {
  const hours = data.hours.slice(0, 12);
  const values = hours.map((hour) => Number(hour.precipitation_chance ?? 0));

  hourlyBandEl.innerHTML = `
    <section class="hourly-chart-panel">
      <div class="hourly-chart-title">Pronóstico de precipitaciones</div>
      <div class="hourly-chart-canvas" id="hourly-chart-canvas"></div>
      <div class="hourly-values-row" id="hourly-values-row"></div>
      <div class="hourly-hours-row" id="hourly-hours-row"></div>
    </section>
  `;

  renderPrecipitationChart(
    hourlyBandEl.querySelector("#hourly-chart-canvas"),
    hourlyBandEl.querySelector("#hourly-values-row"),
    hourlyBandEl.querySelector("#hourly-hours-row"),
    hours,
    values,
  );
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

function buildSmoothPath(points) {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;

  let path = `M ${points[0].x} ${points[0].y}`;

  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    const previous = points[index - 1] ?? current;
    const afterNext = points[index + 2] ?? next;

    const control1X = current.x + (next.x - previous.x) / 6;
    const control1Y = current.y + (next.y - previous.y) / 6;
    const control2X = next.x - (afterNext.x - current.x) / 6;
    const control2Y = next.y - (afterNext.y - current.y) / 6;

    path += ` C ${control1X} ${control1Y}, ${control2X} ${control2Y}, ${next.x} ${next.y}`;
  }

  return path;
}

function renderPrecipitationChart(container, valuesRow, hoursRow, hours, values) {
  if (!container || !valuesRow || !hoursRow) return;

  const width = container.clientWidth || 760;
  const height = container.clientHeight || 92;
  const leftPad = 28;
  const rightPad = 12;
  const plotTop = 10;
  const plotBottom = 10;
  const chartWidth = width - leftPad - rightPad;
  const chartHeight = height - plotTop - plotBottom;
  const safeValues = values.length > 0 ? values : Array.from({ length: 12 }, () => 0);

  const points = safeValues.map((value, index) => {
    const ratio = safeValues.length === 1 ? 0.5 : index / (safeValues.length - 1);
    const x = leftPad + chartWidth * ratio;
    const normalized = Math.max(0, Math.min(100, value)) / 100;
    const y = plotTop + chartHeight * (1 - normalized);
    return { x, y, value };
  });

  const rowOffset = valuesRow.getBoundingClientRect().left - container.getBoundingClientRect().left;
  const labelInset = 20;
  const labelTrackWidth = Math.max(0, chartWidth - labelInset * 2);
  const labelPoints = points.map((point, index) => {
    const ratio = safeValues.length === 1 ? 0.5 : index / (safeValues.length - 1);
    const x = leftPad + labelInset + labelTrackWidth * ratio - rowOffset;
    return {
      x,
      value: point.value,
      time: hours[index]?.time_label ?? "",
    };
  });

  const horizontalGrid = [0, 0.25, 0.5, 0.75, 1]
    .map((step) => {
      const y = plotTop + chartHeight * (1 - step);
      return `<line x1="${leftPad}" y1="${y}" x2="${width - rightPad}" y2="${y}" class="chart-grid-line" />`;
    })
    .join("");

  const yAxisLabels = [100, 75, 50, 25, 0]
    .map((value, index) => {
      const step = index / 4;
      const y = plotTop + chartHeight * step + 3;
      return `<text x="${leftPad - 6}" y="${y}" class="chart-axis-label">${value}</text>`;
    })
    .join("");

  const verticalGrid = points
    .map(
      (point) =>
        `<line x1="${point.x}" y1="${plotTop}" x2="${point.x}" y2="${height - plotBottom}" class="chart-grid-line chart-grid-line--vertical" />`,
    )
    .join("");

  const markers = points
    .map(
      (point) =>
        `<circle cx="${point.x}" cy="${point.y}" r="2.6" class="chart-point-marker" />`,
    )
    .join("");

  container.innerHTML = `
    <svg class="hourly-chart-svg" viewBox="0 0 ${width} ${height}" aria-label="Curva de precipitaciones próximas 12 horas" role="img">
      ${horizontalGrid}
      ${verticalGrid}
      ${yAxisLabels}
      <path d="${buildSmoothPath(points)}" class="chart-line" />
      ${markers}
    </svg>
  `;

  valuesRow.innerHTML = labelPoints
    .map(
      (point) => `<div class="hourly-value-label" style="left:${point.x}px">${point.value}%</div>`,
    )
    .join("");

  hoursRow.innerHTML = labelPoints
    .map(
      (point) => `<div class="hour-label" style="left:${point.x}px">${point.time}</div>`,
    )
    .join("");
}

loadData()
  .then((data) => {
    revealScreen();
    renderDeviceStatus();
    renderCurrent(data);
    renderHours(data);
    renderDays(data);
  })
  .catch((error) => {
    statusEl.querySelector(".status-title").textContent = "No se pudo cargar el mockup";
    statusEl.querySelector(".status-copy").textContent = error.message;
  });
