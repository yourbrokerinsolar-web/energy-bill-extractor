import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";

function getLast12MonthsWithDates(refDate = new Date()) {
  const items = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(refDate.getFullYear(), refDate.getMonth() - i, 1);
    items.push({ label: d.toLocaleString("default", { month: "short" }), date: d });
  }
  return items;
}

const state = {
  image: null,
  crop: { x: 190, y: 130, w: 560, h: 330 },
  // rawValues: the extracted value from the graph (units as on the axis)
  rawValues: Array(12).fill(0),
  // values: the displayed monthly totals (after conversion if needed)
  values: Array(12).fill(0),
  dragging: null,
  stream: null,
  dailyAxisManual: false
};

const imageCanvas = document.querySelector("#imageCanvas");
const imageCtx = imageCanvas.getContext("2d", { willReadFrequently: true });
const reportCanvas = document.querySelector("#reportCanvas");
const reportCtx = reportCanvas.getContext("2d");
const fileInput = document.querySelector("#fileInput");
const emptyState = document.querySelector("#emptyState");
const maxKwhInput = document.querySelector("#maxKwhInput");
const rateInput = document.querySelector("#rateInput");
const statusDot = document.querySelector("#statusDot");
const statusText = document.querySelector("#statusText");
const monthInputs = document.querySelector("#monthInputs");
const cameraPanel = document.querySelector("#cameraPanel");
const cameraPreview = document.querySelector("#cameraPreview");
const utilitySelect = document.querySelector("#utilitySelect");

function money(value) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

function rateMoney(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 3,
    maximumFractionDigits: 3
  }).format(value);
}

function number(value) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function setStatus(text, mode = "pending") {
  statusText.textContent = text;
  statusDot.className = `status-dot ${mode === "ready" ? "ready" : mode === "warn" ? "warn" : ""}`;
}

function makeMonthInputs() {
  monthInputs.innerHTML = "";
  const months = getLast12MonthsWithDates();
  months.forEach((month, index) => {
    const cell = document.createElement("div");
    cell.className = "month-cell";
    cell.innerHTML = `
      <label>
        <span>${month.label}</span>
        <input type="number" min="0" step="1" inputmode="numeric" value="${state.values[index]}" data-month="${index}">
      </label>
    `;
    monthInputs.appendChild(cell);
  });
}

function updateMonthInputs() {
  monthInputs.querySelectorAll("input").forEach((input, index) => {
    input.value = state.values[index];
  });
}

function detectDailyAxis() {
  const months = getLast12MonthsWithDates();
  const raw = state.rawValues.map((v) => Number(v || 0));
  const maxKwh = Number(maxKwhInput?.value || 0);
  const totalRaw = raw.reduce((sum, value) => sum + value, 0);
  const avgRaw = totalRaw / 12;
  const dailyCandidate = raw.reduce((sum, value, index) => {
    const d = months[index]?.date;
    const days = d ? new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate() : 30;
    return sum + value * days;
  }, 0);
  if (!maxKwh || !raw.some((v) => v > 0)) return false;

  // If the top of the graph is low and the bar values are small,
  // the axis is likely daily rather than monthly.
  if (maxKwh <= 80 && avgRaw <= 30) return true;
  if (maxKwh <= 100 && avgRaw <= 20 && dailyCandidate >= 800) return true;

  const ratio = dailyCandidate / Math.max(1, totalRaw);
  if (ratio > 4 && totalRaw < 1200 && dailyCandidate >= 1000) return true;

  return false;
}

function computeDisplayedValues() {
  const months = getLast12MonthsWithDates();
  const dailyAxisCheckbox = document.querySelector('#dailyAxis');
  let daily = dailyAxisCheckbox?.checked;
  if (!state.dailyAxisManual) {
    daily = detectDailyAxis();
    if (dailyAxisCheckbox) {
      dailyAxisCheckbox.checked = daily;
    }
  }

  state.values = state.rawValues.map((v, i) => {
    const base = Number(v || 0);
    if (daily && months[i] && months[i].date) {
      const d = months[i].date;
      const days = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      return Math.round(base * days);
    }
    return Math.round(base);
  });
  updateMonthInputs();
  updateTotals();
}

// wire the checkbox if present
const dailyAxisCheckbox = document.querySelector('#dailyAxis');
if (dailyAxisCheckbox) {
  dailyAxisCheckbox.addEventListener('change', () => {
    state.dailyAxisManual = true;
    computeDisplayedValues();
    setStatus('Display updated for daily-axis conversion.', 'ready');
  });
}

function totals() {
  const annualKwh = state.values.reduce((sum, value) => sum + Number(value || 0), 0);
  const rate = Number(rateInput.value || 0);
  const annualCost = annualKwh * rate;
  return { annualKwh, rate, annualCost, avgMonthly: annualCost / 12 };
}

function drawImageCanvas() {
  imageCtx.clearRect(0, 0, imageCanvas.width, imageCanvas.height);
  if (!state.image) {
    emptyState.hidden = false;
    drawReport();
    return;
  }

  emptyState.hidden = true;
  const scale = Math.min(imageCanvas.width / state.image.width, imageCanvas.height / state.image.height);
  const w = state.image.width * scale;
  const h = state.image.height * scale;
  const x = (imageCanvas.width - w) / 2;
  const y = (imageCanvas.height - h) / 2;
  imageCtx.fillStyle = "#f8faf8";
  imageCtx.fillRect(0, 0, imageCanvas.width, imageCanvas.height);
  imageCtx.drawImage(state.image, x, y, w, h);
  state.imageBounds = { x, y, w, h };

  const crop = state.crop;
  imageCtx.save();
  imageCtx.fillStyle = "rgba(16, 36, 32, 0.45)";
  imageCtx.fillRect(0, 0, imageCanvas.width, crop.y);
  imageCtx.fillRect(0, crop.y + crop.h, imageCanvas.width, imageCanvas.height - crop.y - crop.h);
  imageCtx.fillRect(0, crop.y, crop.x, crop.h);
  imageCtx.fillRect(crop.x + crop.w, crop.y, imageCanvas.width - crop.x - crop.w, crop.h);
  imageCtx.strokeStyle = "#f0c867";
  imageCtx.lineWidth = 3;
  imageCtx.strokeRect(crop.x, crop.y, crop.w, crop.h);
  imageCtx.fillStyle = "#f0c867";
  const handles = getHandles(crop);
  handles.forEach((handle) => imageCtx.fillRect(handle.x - 6, handle.y - 6, 12, 12));
  imageCtx.restore();
}

function getHandles(crop) {
  return [
    { name: "nw", x: crop.x, y: crop.y },
    { name: "ne", x: crop.x + crop.w, y: crop.y },
    { name: "sw", x: crop.x, y: crop.y + crop.h },
    { name: "se", x: crop.x + crop.w, y: crop.y + crop.h }
  ];
}

function canvasPoint(event) {
  const rect = imageCanvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * imageCanvas.width,
    y: ((event.clientY - rect.top) / rect.height) * imageCanvas.height
  };
}

function clampCrop() {
  const b = state.imageBounds || { x: 0, y: 0, w: imageCanvas.width, h: imageCanvas.height };
  state.crop.w = Math.max(120, state.crop.w);
  state.crop.h = Math.max(90, state.crop.h);
  state.crop.x = Math.max(b.x, Math.min(state.crop.x, b.x + b.w - state.crop.w));
  state.crop.y = Math.max(b.y, Math.min(state.crop.y, b.y + b.h - state.crop.h));
}

function findGraphArea() {
  if (!state.imageBounds) return;
  const b = state.imageBounds;
  state.crop = {
    x: b.x + b.w * 0.13,
    y: b.y + b.h * 0.18,
    w: b.w * 0.74,
    h: b.h * 0.55
  };
  clampCrop();
  drawImageCanvas();
  setStatus("Graph area selected. Drag the gold box to fine tune.", "ready");
}

function loadImageFromFile(file) {
  if (!file) return;
  if (file.type === "application/pdf") {
    setStatus("PDF preview is not available in this offline prototype. Save the bill page as an image first.", "warn");
    return;
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    URL.revokeObjectURL(url);
    setImage(img);
  };
  img.src = url;
}

function setImage(img) {
  state.image = img;
  state.dailyAxisManual = false;
  if (dailyAxisCheckbox) {
    dailyAxisCheckbox.checked = false;
  }
  drawImageCanvas();
  findGraphArea();
  setStatus("Image loaded. Adjust the graph box, then extract.", "ready");
}

function extractBars() {
  if (!state.image) {
    setStatus("Add a bill image before extracting.", "warn");
    return;
  }

  const crop = state.crop;
  const maxKwh = Number(maxKwhInput.value || 0);
  if (!maxKwh) {
    setStatus("Enter the graph's top kWh value first.", "warn");
    return;
  }

  const analysisCanvas = document.createElement("canvas");
  analysisCanvas.width = imageCanvas.width;
  analysisCanvas.height = imageCanvas.height;
  const analysisCtx = analysisCanvas.getContext("2d", { willReadFrequently: true });
  const b = state.imageBounds;
  analysisCtx.fillStyle = "#f8faf8";
  analysisCtx.fillRect(0, 0, analysisCanvas.width, analysisCanvas.height);
  analysisCtx.drawImage(state.image, b.x, b.y, b.w, b.h);

  const data = analysisCtx.getImageData(crop.x, crop.y, crop.w, crop.h);
  const width = Math.floor(crop.w);
  const height = Math.floor(crop.h);
  const scores = new Array(width).fill(0);

  for (let x = 0; x < width; x += 1) {
    let active = 0;
    for (let y = 0; y < height; y += 1) {
      const index = (y * width + x) * 4;
      const r = data.data[index];
      const g = data.data[index + 1];
      const bl = data.data[index + 2];
      const brightness = (r + g + bl) / 3;
      const saturation = Math.max(r, g, bl) - Math.min(r, g, bl);
      if (brightness < 225 && saturation > 16) active += 1;
    }
    scores[x] = active;
  }

  const threshold = Math.max(4, height * 0.04);
  let detectedBaseline = 0;
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      const index = (y * width + x) * 4;
      const r = data.data[index];
      const g = data.data[index + 1];
      const bl = data.data[index + 2];
      const brightness = (r + g + bl) / 3;
      const saturation = Math.max(r, g, bl) - Math.min(r, g, bl);
      if (brightness < 225 && saturation > 16) detectedBaseline = Math.max(detectedBaseline, y);
    }
  }
  const chartHeight = Math.max(1, detectedBaseline);
  const segments = [];
  let start = null;
  for (let x = 0; x < width; x += 1) {
    if (scores[x] > threshold && start === null) start = x;
    if ((scores[x] <= threshold || x === width - 1) && start !== null) {
      const end = x === width - 1 ? x : x - 1;
      if (end - start > width * 0.012) segments.push({ start, end, center: (start + end) / 2 });
      start = null;
    }
  }

  let picked = segments;
  if (picked.length < 8 || picked.length > 18) {
    picked = Array.from({ length: 12 }, (_, i) => {
      const slot = width / 12;
      return { start: i * slot + slot * 0.18, end: i * slot + slot * 0.82, center: i * slot + slot / 2 };
    });
  } else {
    picked = picked
      .sort((a, b) => b.end - b.start - (a.end - a.start))
      .slice(0, 12)
      .sort((a, b) => a.center - b.center);
  }

  const extracted = picked.map((segment) => {
    const sx = Math.max(0, Math.floor(segment.start));
    const ex = Math.min(width - 1, Math.ceil(segment.end));
    let top = height;
    let bottom = 0;
    for (let x = sx; x <= ex; x += 1) {
      for (let y = 0; y < height; y += 1) {
        const index = (y * width + x) * 4;
        const r = data.data[index];
        const g = data.data[index + 1];
        const bl = data.data[index + 2];
        const brightness = (r + g + bl) / 3;
        const saturation = Math.max(r, g, bl) - Math.min(r, g, bl);
        if (brightness < 225 && saturation > 16) {
          top = Math.min(top, y);
          bottom = Math.max(bottom, y);
        }
      }
    }
    const barHeight = Math.max(0, bottom - top);
    return Math.round((barHeight / chartHeight) * maxKwh);
  });

  state.rawValues = extracted;
  computeDisplayedValues();
  drawImageCanvas();
  setStatus("Extraction complete. Review the monthly values.", "ready");
}

function drawReport() {
  const { annualKwh, rate, annualCost, avgMonthly } = totals();
  const months = getLast12MonthsWithDates();
  const refEl = document.querySelector("#referenceMonth");
  if (refEl && months.length) {
    const ref = months[months.length - 1].date;
    refEl.textContent = `Reference: ${ref.toLocaleString("default", { month: "long", year: "numeric" })}`;
  }
  const w = reportCanvas.width;
  const h = reportCanvas.height;
  reportCtx.clearRect(0, 0, w, h);
  reportCtx.fillStyle = "#f8faf8";
  reportCtx.fillRect(0, 0, w, h);
  reportCtx.fillStyle = "#102420";
  reportCtx.fillRect(0, 0, w, 190);
  reportCtx.fillStyle = "#f0c867";
  reportCtx.fillRect(0, 190, w, 8);

  reportCtx.fillStyle = "#ffffff";
  reportCtx.font = "700 34px Inter, system-ui, sans-serif";
  reportCtx.fillText("Annual energy snapshot", 58, 70);
  reportCtx.fillStyle = "rgba(255,255,255,0.68)";
  reportCtx.font = "600 22px Inter, system-ui, sans-serif";
  const utility = utilitySelect?.value || "Unknown utility";
  reportCtx.fillText(`${utility} · Based on 12 months at ${rateMoney(rate)} per kWh`, 58, 112);

  const cards = [
    ["Annual kWh", number(annualKwh), "#41b883"],
    ["Annual cost", money(annualCost), "#f0c867"],
    ["Avg monthly", money(avgMonthly), "#d95a67"]
  ];
  cards.forEach((card, index) => {
    const x = 58 + index * 365;
    reportCtx.fillStyle = "#ffffff";
    roundRect(reportCtx, x, 148, 320, 120, 8);
    reportCtx.fill();
    reportCtx.fillStyle = card[2];
    reportCtx.fillRect(x, 148, 9, 120);
    reportCtx.fillStyle = "#68736f";
    reportCtx.font = "700 20px Inter, system-ui, sans-serif";
    reportCtx.fillText(card[0], x + 28, 188);
    reportCtx.fillStyle = "#17231f";
    reportCtx.font = "800 42px Inter, system-ui, sans-serif";
    reportCtx.fillText(card[1], x + 28, 238);
  });

  const chart = { x: 74, y: 330, w: 1040, h: 255 };
  reportCtx.strokeStyle = "#d7ddd9";
  reportCtx.lineWidth = 2;
  reportCtx.beginPath();
  reportCtx.moveTo(chart.x, chart.y + chart.h);
  reportCtx.lineTo(chart.x + chart.w, chart.y + chart.h);
  reportCtx.stroke();

  const max = Math.max(1, ...state.values);
  const slot = chart.w / 12;
  state.values.forEach((value, index) => {
    const barW = Math.max(28, slot * 0.48);
    const barH = (value / max) * (chart.h - 38);
    const x = chart.x + index * slot + (slot - barW) / 2;
    const y = chart.y + chart.h - barH;
    const gradient = reportCtx.createLinearGradient(0, y, 0, y + barH);
    gradient.addColorStop(0, "#41b883");
    gradient.addColorStop(1, "#08716f");
    reportCtx.fillStyle = gradient;
    roundRect(reportCtx, x, y, barW, barH, 6);
    reportCtx.fill();
    reportCtx.fillStyle = "#68736f";
    reportCtx.font = "700 16px Inter, system-ui, sans-serif";
    reportCtx.textAlign = "center";
    reportCtx.fillText(months[index].label, x + barW / 2, chart.y + chart.h + 30);
  });
  reportCtx.textAlign = "left";
  reportCtx.fillStyle = "#17231f";
  reportCtx.font = "800 26px Inter, system-ui, sans-serif";
  reportCtx.fillText("Monthly kWh trend", chart.x, 310);
  reportCtx.fillStyle = "#68736f";
  reportCtx.font = "600 18px Inter, system-ui, sans-serif";
  reportCtx.fillText("Values can be edited before downloading this image.", chart.x, 630);
}

function roundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function updateTotals() {
  const { annualKwh, annualCost, avgMonthly } = totals();
  document.querySelector("#annualKwh").textContent = number(annualKwh);
  document.querySelector("#annualCost").textContent = money(annualCost);
  document.querySelector("#avgMonthly").textContent = money(avgMonthly);
  drawReport();
}

function createDemo() {
  const demo = document.createElement("canvas");
  demo.width = 1100;
  demo.height = 760;
  const ctx = demo.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, demo.width, demo.height);
  ctx.fillStyle = "#17231f";
  ctx.font = "800 38px Inter, system-ui, sans-serif";
  ctx.fillText("Monthly electricity usage", 90, 88);
  ctx.fillStyle = "#68736f";
  ctx.font = "600 24px Inter, system-ui, sans-serif";
  ctx.fillText("kWh used", 90, 130);
  const plot = { x: 120, y: 180, w: 860, h: 390 };
  ctx.strokeStyle = "#d7ddd9";
  ctx.lineWidth = 3;
  for (let i = 0; i <= 4; i += 1) {
    const y = plot.y + (plot.h / 4) * i;
    ctx.beginPath();
    ctx.moveTo(plot.x, y);
    ctx.lineTo(plot.x + plot.w, y);
    ctx.stroke();
  }
  const values = [650, 590, 520, 470, 540, 700, 910, 1020, 880, 690, 610, 735];
  const max = 1200;
  const demoMonths = getLast12MonthsWithDates();
  values.forEach((value, index) => {
    const slot = plot.w / 12;
    const barW = slot * 0.52;
    const barH = (value / max) * plot.h;
    const x = plot.x + index * slot + (slot - barW) / 2;
    const y = plot.y + plot.h - barH;
    ctx.fillStyle = index > 5 && index < 9 ? "#0a6f73" : "#41b883";
    roundRect(ctx, x, y, barW, barH, 5);
    ctx.fill();
    ctx.fillStyle = "#68736f";
    ctx.font = "700 18px Inter, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(demoMonths[index].label, x + barW / 2, plot.y + plot.h + 38);
  });
  ctx.textAlign = "left";
  ctx.fillStyle = "#68736f";
  ctx.font = "600 19px Inter, system-ui, sans-serif";
  ctx.fillText("1200", 45, plot.y + 8);
  ctx.fillText("0", 70, plot.y + plot.h + 8);
  const img = new Image();
  img.onload = () => {
    setImage(img);
    state.dailyAxisManual = false;
    if (dailyAxisCheckbox) {
      dailyAxisCheckbox.checked = false;
    }
    const b = state.imageBounds;
    state.crop = {
      x: b.x + (plot.x / demo.width) * b.w,
      y: b.y + (plot.y / demo.height) * b.h,
      w: (plot.w / demo.width) * b.w,
      h: (plot.h / demo.height) * b.h
    };
    drawImageCanvas();
    state.rawValues = values;
    computeDisplayedValues();
    setStatus("Demo loaded. Try moving the graph box or downloading the report.", "ready");
  };
  img.src = demo.toDataURL("image/png");
}

async function startCamera() {
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
    cameraPreview.srcObject = state.stream;
    cameraPanel.hidden = false;
    setStatus("Camera ready. Frame the graph and capture.", "ready");
  } catch (error) {
    setStatus("Camera access was blocked or unavailable in this browser.", "warn");
  }
}

function stopCamera() {
  if (state.stream) {
    state.stream.getTracks().forEach((track) => track.stop());
    state.stream = null;
  }
  cameraPanel.hidden = true;
}

function captureFrame() {
  if (!state.stream) return;
  const canvas = document.createElement("canvas");
  canvas.width = cameraPreview.videoWidth;
  canvas.height = cameraPreview.videoHeight;
  canvas.getContext("2d").drawImage(cameraPreview, 0, 0, canvas.width, canvas.height);
  const img = new Image();
  img.onload = () => setImage(img);
  img.src = canvas.toDataURL("image/png");
  stopCamera();
}

function downloadReport() {
  const utilName = utilitySelect?.value || "annual-energy-snapshot";
  const safeName = utilName.replace(/[^a-zA-Z0-9-_ ]/g, "").replace(/\s+/g, "-").trim() || "annual-energy-snapshot";
  const months = getLast12MonthsWithDates();
  const ref = months.length ? months[months.length - 1].date : new Date();
  const refLabel = ref.toLocaleString("default", { month: "short", year: "numeric" }).replace(/\s+/g, "-");
  const link = document.createElement("a");
  link.download = `${safeName}-${refLabel}-annual-energy-snapshot.png`;
  link.href = reportCanvas.toDataURL("image/png");
  link.click();
}

imageCanvas.addEventListener("pointerdown", (event) => {
  if (!state.image) return;
  imageCanvas.setPointerCapture(event.pointerId);
  const p = canvasPoint(event);
  const handle = getHandles(state.crop).find((h) => Math.hypot(h.x - p.x, h.y - p.y) < 18);
  const inside = p.x >= state.crop.x && p.x <= state.crop.x + state.crop.w && p.y >= state.crop.y && p.y <= state.crop.y + state.crop.h;
  state.dragging = handle
    ? { type: "resize", handle: handle.name, start: p, crop: { ...state.crop } }
    : inside
      ? { type: "move", start: p, crop: { ...state.crop } }
      : null;
});

imageCanvas.addEventListener("pointermove", (event) => {
  if (!state.dragging) return;
  const p = canvasPoint(event);
  const dx = p.x - state.dragging.start.x;
  const dy = p.y - state.dragging.start.y;
  const c = { ...state.dragging.crop };

  if (state.dragging.type === "move") {
    state.crop.x = c.x + dx;
    state.crop.y = c.y + dy;
  } else {
    if (state.dragging.handle.includes("w")) {
      state.crop.x = c.x + dx;
      state.crop.w = c.w - dx;
    }
    if (state.dragging.handle.includes("e")) state.crop.w = c.w + dx;
    if (state.dragging.handle.includes("n")) {
      state.crop.y = c.y + dy;
      state.crop.h = c.h - dy;
    }
    if (state.dragging.handle.includes("s")) state.crop.h = c.h + dy;
  }
  clampCrop();
  drawImageCanvas();
});

imageCanvas.addEventListener("pointerup", () => {
  state.dragging = null;
});

fileInput.addEventListener("change", (event) => loadImageFromFile(event.target.files[0]));
document.querySelector("#cameraButton").addEventListener("click", startCamera);
document.querySelector("#captureButton").addEventListener("click", captureFrame);
document.querySelector("#stopCameraButton").addEventListener("click", stopCamera);
document.querySelector("#demoButton").addEventListener("click", createDemo);
document.querySelector("#fitButton").addEventListener("click", findGraphArea);
document.querySelector("#extractButton").addEventListener("click", extractBars);
document.querySelector("#downloadButton").addEventListener("click", downloadReport);
document.querySelector("#clearButton").addEventListener("click", () => {
  state.dailyAxisManual = false;
  if (dailyAxisCheckbox) {
    dailyAxisCheckbox.checked = false;
  }
  state.rawValues = Array(12).fill(0);
  computeDisplayedValues();
  setStatus("Values cleared.", "pending");
});

if (utilitySelect) {
  utilitySelect.addEventListener("change", () => {
    updateTotals();
    setStatus(`Selected utility: ${utilitySelect.value || "Unknown"}`, "ready");
  });
}

monthInputs.addEventListener("input", (event) => {
  if (!event.target.matches("input")) return;
  const idx = Number(event.target.dataset.month);
  const val = Number(event.target.value || 0);
  const daily = document.querySelector('#dailyAxis')?.checked;
  // update rawValues accordingly so conversions remain consistent
  if (daily) {
    const months = getLast12MonthsWithDates();
    const d = months[idx] && months[idx].date;
    const days = d ? new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate() : 30;
    state.rawValues[idx] = Math.round(val / days);
  } else {
    state.rawValues[idx] = val;
  }
  computeDisplayedValues();
});

[maxKwhInput, rateInput].forEach((input) => input.addEventListener("input", updateTotals));

makeMonthInputs();
updateTotals();
