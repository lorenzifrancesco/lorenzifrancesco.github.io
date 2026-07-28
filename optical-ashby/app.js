
const DATA = window.OPTASHBY_DATA;
const rowsByGrid = new Map();
const loadingByGrid = new Map();
let currentRows = [];
let currentGrid = DATA.grid[0];

const $ = (id) => document.getElementById(id);
const value = (id) => $(id).value;
const numberOrNull = (id) => value(id) === "" ? null : Number(value(id));
const checkedValues = (name) => [...document.querySelectorAll(`input[name="${name}"]:checked`)].map((item) => item.value);
const selectedValues = (id) => [...$(id).selectedOptions].map((item) => item.value);
const propertyKeys = Object.keys(DATA.registry);

function option(label, value) {
  const item = document.createElement("option");
  item.textContent = label;
  item.value = value;
  return item;
}

function formatValue(item, unit = "") {
  return item === null || item === undefined || Number.isNaN(item) ? "unavailable" : `${Number(item).toPrecision(6)}${unit ? ` ${unit}` : ""}`;
}

function nearestGrid(wavelength) {
  return DATA.grid.reduce((best, item) => Math.abs(Math.log(item.wavelength_um) - Math.log(wavelength)) < Math.abs(Math.log(best.wavelength_um) - Math.log(wavelength)) ? item : best, DATA.grid[0]);
}

function setBand() {
  const [lower, upper] = DATA.bands[value("band-preset")];
  $("wavelength-slider").min = Math.log10(lower);
  $("wavelength-slider").max = Math.log10(upper);
}

function setGridFromInput(source) {
  const mode = value("spectral-mode");
  const raw = source === "slider" ? 10 ** Number(value("wavelength-slider")) : Number(value("wavelength-input"));
  const requested = mode === "frequency" && source !== "slider" ? DATA.speed_um_thz / raw : raw;
  currentGrid = nearestGrid(requested > 0 ? requested : DATA.default_wavelength_um);
  const shown = mode === "frequency" ? currentGrid.frequency_THz : currentGrid.wavelength_um;
  $("wavelength-slider").value = Math.log10(currentGrid.wavelength_um);
  $("wavelength-input").value = Number(shown.toPrecision(6));
  $("spectral-input-label").textContent = mode === "frequency" ? "Frequency [THz]" : "Wavelength [um]";
  $("wavelength-display").textContent = `${formatValue(currentGrid.wavelength_um)} um`;
  $("frequency-display").textContent = `${formatValue(currentGrid.frequency_THz)} THz`;
}

function allowLog(prop) {
  return DATA.registry[prop].log_allowed !== false;
}

function representativeRows(rows) {
  const best = new Map();
  for (const row of rows) {
    const existing = best.get(row.material_id);
    if (!existing || row.priority < existing.priority || (row.priority === existing.priority && row.dataset_id < existing.dataset_id)) {
      best.set(row.material_id, row);
    }
  }
  return [...best.values()];
}

function filteredRows() {
  const xProp = value("x-property");
  const yProp = value("y-property");
  const xLog = checkedValues("x-scale")[0] === "log" && allowLog(xProp);
  const yLog = checkedValues("y-scale")[0] === "log" && allowLog(yProp);
  const categories = selectedValues("category-filter");
  const search = value("material-search").trim().toLowerCase();
  const xMin = numberOrNull("x-min");
  const xMax = numberOrNull("x-max");
  const yMin = numberOrNull("y-min");
  const yMax = numberOrNull("y-max");
  let rows = rowsByGrid.get(currentGrid.grid_index) || [];
  rows = rows.filter((row) => {
    const x = row[xProp];
    const y = row[yProp];
    if (x === null || y === null || x === undefined || y === undefined) return false;
    if (categories.length && !categories.includes(row.primary_category)) return false;
    if (search && !String(row.full_name).toLowerCase().includes(search)) return false;
    if ($("require-k").checked && row.k === null) return false;
    if ($("require-density").checked && row.density_g_cm3 === null) return false;
    if (xLog && x <= 0) return false;
    if (yLog && y <= 0) return false;
    if (xMin !== null && x < xMin) return false;
    if (xMax !== null && x > xMax) return false;
    if (yMin !== null && y < yMin) return false;
    if (yMax !== null && y > yMax) return false;
    return true;
  });
  if (checkedValues("point-mode")[0] === "material") rows = representativeRows(rows);
  return rows;
}

function propertyTitle(prop) {
  const item = DATA.registry[prop];
  return `${item.label} (${item.symbol})${item.unit ? ` [${item.unit}]` : ""}`;
}

function loadGridRows(gridIndex) {
  if (rowsByGrid.has(gridIndex)) return Promise.resolve(rowsByGrid.get(gridIndex));
  if (window.OPTASHBY_GRID_ROWS && window.OPTASHBY_GRID_ROWS[gridIndex]) {
    rowsByGrid.set(gridIndex, window.OPTASHBY_GRID_ROWS[gridIndex]);
    return Promise.resolve(rowsByGrid.get(gridIndex));
  }
  if (loadingByGrid.has(gridIndex)) return loadingByGrid.get(gridIndex);
  $("point-count").textContent = "Loading sampled wavelength data...";
  const promise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `grids/grid-${gridIndex}.js`;
    script.onload = () => {
      const rows = (window.OPTASHBY_GRID_ROWS && window.OPTASHBY_GRID_ROWS[gridIndex]) || [];
      rowsByGrid.set(gridIndex, rows);
      resolve(rows);
    };
    script.onerror = () => reject(new Error(`Could not load grids/grid-${gridIndex}.js`));
    document.head.append(script);
  });
  loadingByGrid.set(gridIndex, promise);
  return promise;
}

async function updatePlot() {
  const requestedGridIndex = currentGrid.grid_index;
  await loadGridRows(requestedGridIndex);
  if (requestedGridIndex !== currentGrid.grid_index) return updatePlot();
  const xProp = value("x-property");
  const yProp = value("y-property");
  const xScaleRequested = checkedValues("x-scale")[0];
  const yScaleRequested = checkedValues("y-scale")[0];
  const xScale = xScaleRequested === "log" && allowLog(xProp) ? "log" : "linear";
  const yScale = yScaleRequested === "log" && allowLog(yProp) ? "log" : "linear";
  currentRows = filteredRows();
  const totalRows = rowsByGrid.get(currentGrid.grid_index) || [];
  const missingAxes = totalRows.filter((row) => row[xProp] === null || row[xProp] === undefined || row[yProp] === null || row[yProp] === undefined).length;
  const traces = [];
  for (const [key, category] of Object.entries(DATA.categories)) {
    const group = currentRows.filter((row) => row.primary_category === key);
    if (!group.length) continue;
    traces.push({
      type: group.length > 5000 ? "scattergl" : "scatter",
      mode: "markers",
      name: category.label,
      x: group.map((row) => row[xProp]),
      y: group.map((row) => row[yProp]),
      customdata: group,
      marker: {color: category.color, symbol: category.symbol || "circle", size: 8, opacity: 0.58, line: {width: 0.45, color: "rgba(255,255,255,.9)"}},
      hovertemplate: `<b>%{customdata.full_name}</b><br>%{customdata.display_name}<br>${DATA.registry[xProp].symbol} = %{x:.5g}<br>${DATA.registry[yProp].symbol} = %{y:.5g}<extra></extra>`,
    });
  }
  Plotly.react("ashby-graph", traces, {
    template: "plotly_white",
    dragmode: "lasso",
    hovermode: "closest",
    paper_bgcolor: "#ffffff",
    plot_bgcolor: "#fbfcfd",
    title: {text: `${currentGrid.wavelength_um.toPrecision(4)} um <span style='color:#7b8790;font-size:13px'>/ ${currentGrid.frequency_THz.toPrecision(4)} THz</span>`, x: 0.015, y: 0.98, font: {size: 20, color: "#16262e"}},
    xaxis: {title: propertyTitle(xProp), type: xScale, gridcolor: "#e9edf0", zerolinecolor: "#cad2d7"},
    yaxis: {title: propertyTitle(yProp), type: yScale, gridcolor: "#e9edf0", zerolinecolor: "#cad2d7"},
    legend: {title: {text: "MATERIAL CLASS", font: {size: 10}}, orientation: "v", y: 1, x: 1.01, xanchor: "left", yanchor: "top", font: {size: 11}, bgcolor: "rgba(255,255,255,.8)"},
    hoverlabel: {bgcolor: "rgba(16,44,58,.84)", bordercolor: "rgba(255,255,255,.45)", font: {color: "white", size: 11}},
    margin: {l: 78, r: 145, t: 62, b: 72},
    font: {family: "Inter, Arial, sans-serif", color: "#33454e", size: 12},
  }, {displaylogo: false, scrollZoom: true, responsive: true});
  $("point-count").textContent = `${currentRows.length.toLocaleString()} plotted / ${totalRows.length.toLocaleString()} datasets available at ${currentGrid.wavelength_um.toPrecision(5)} um. ${missingAxes.toLocaleString()} lack one or both axis properties.`;
  const warnings = [];
  if (xScaleRequested === "log" && !allowLog(xProp)) warnings.push(`Log scale is not valid for ${DATA.registry[xProp].label}; linear shown.`);
  if (yScaleRequested === "log" && !allowLog(yProp)) warnings.push(`Log scale is not valid for ${DATA.registry[yProp].label}; linear shown.`);
  if (checkedValues("point-mode")[0] === "material") warnings.push("Representative sources selected deterministically; no averaging performed.");
  warnings.push("Static build uses sampled wavelength points, not the full local grid.");
  $("warning-box").textContent = warnings.join(" ");
}

function showDetails(row) {
  const category = DATA.categories[row.primary_category] || DATA.categories.other;
  const fields = [
    ["Category", category.label], ["Wavelength", `${formatValue(row.wavelength_um)} um`], ["Frequency", `${formatValue(row.frequency_THz)} THz`],
    ["n", formatValue(row.n)], ["k", formatValue(row.k)], ["Absorption", `${formatValue(row.alpha_cm_1)} cm^-1`],
    ["Reflectance", formatValue(row.reflectance_normal)], ["Group index", formatValue(row.group_index)], ["GVD", `${formatValue(row.beta2_fs2_mm)} fs^2/mm`],
    ["Density", `${formatValue(row.density_g_cm3)} g/cm^3`], ["Validity", `${formatValue(row.wavelength_min_um)}-${formatValue(row.wavelength_max_um)} um`],
    ["Data type", row.data_type || "unavailable"], ["Formula family", row.formula_type || "tabulated"], ["Stable dataset ID", row.dataset_id], ["Raw source", row.raw_yaml_path || "unavailable"],
  ];
  $("detail-panel").innerHTML = `<div class="detail-summary"><p class="eyebrow">SOURCE DATASET</p><h2>${escapeHtml(row.full_name)}</h2><h3>${escapeHtml(row.display_name || "")}</h3><h3>Reference</h3><p>${escapeHtml(row.reference_text || "No reference supplied")}</p>${row.reference_url ? `<a href="${escapeHtml(row.reference_url)}" target="_blank" rel="noopener noreferrer">Open DOI / source</a>` : ""}<h3>Source comments</h3><p>${escapeHtml(row.comments || "No comments supplied")}</p></div><div class="detail-data"><dl>${fields.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(String(v))}</dd>`).join("")}</dl></div>`;
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[char]));
}

function exportCsv() {
  const keys = ["dataset_id", "material_id", "full_name", "primary_category", "display_name", "wavelength_um", "frequency_THz", "n", "k", "alpha_cm_1", "reflectance_normal", "group_index", "beta2_fs2_mm", "density_g_cm3", "reference_text", "reference_doi", "reference_url", "wavelength_min_um", "wavelength_max_um", "raw_yaml_path"];
  const lines = [keys.join(",")];
  for (const row of currentRows) lines.push(keys.map((key) => `"${String(row[key] ?? "").replaceAll('"', '""')}"`).join(","));
  const blob = new Blob([lines.join("\n")], {type: "text/csv"});
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "optical_ashby_selection.csv";
  link.click();
  URL.revokeObjectURL(link.href);
}

function populateControls() {
  for (const [key, band] of Object.entries(DATA.bands)) $("band-preset").append(option(band[2], key));
  $("band-preset").value = "visible-near-ir";
  for (const key of propertyKeys) {
    const prop = DATA.registry[key];
    $("x-property").append(option(`${prop.label} (${prop.symbol})`, key));
    $("y-property").append(option(`${prop.label} (${prop.symbol})`, key));
  }
  $("x-property").value = "n";
  $("y-property").value = "reflectance_normal";
  for (const [key, category] of Object.entries(DATA.categories)) $("category-filter").append(option(category.label, key));
  setBand();
  setGridFromInput("input");
  $("detail-panel").innerHTML = `<div class="detail-summary"><p class="eyebrow">POINT INSPECTOR</p><h2>Select a dataset</h2><p class="muted">Click any point to reveal its indexed value and source provenance.</p></div>`;
}

populateControls();
updatePlot();

$("band-preset").addEventListener("change", () => { setBand(); setGridFromInput("input"); updatePlot(); });
$("spectral-mode").addEventListener("change", () => { setGridFromInput("input"); updatePlot(); });
$("wavelength-input").addEventListener("change", () => { setGridFromInput("input"); updatePlot(); });
$("wavelength-slider").addEventListener("input", () => { setGridFromInput("slider"); updatePlot(); });
$("export-csv").addEventListener("click", exportCsv);
for (const control of document.querySelectorAll("select, input")) {
  if (["band-preset", "spectral-mode", "wavelength-input", "wavelength-slider"].includes(control.id)) continue;
  control.addEventListener("change", updatePlot);
  control.addEventListener("input", updatePlot);
}
$("ashby-graph").on("plotly_click", (event) => showDetails(event.points[0].customdata));
