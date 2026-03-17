/**
 * India State Choropleth — Looker Studio Community Visualization
 * Receives State/UT dimension + any metric from Looker Studio.
 * Looker Studio filters (year, species, etc.) apply automatically.
 */

const TOPO_URL = "https://raw.githubusercontent.com/udit-001/india-maps-data/main/topojson/india.json";

// Viz state
let stateFeatures = null;
let pathFn        = null;
let pendingData   = null;   // holds last data payload until TopoJSON is ready

// ── Load external scripts sequentially ───────────────────────────────────────
function loadScript(url) {
  return new Promise(function(resolve, reject) {
    var s = document.createElement("script");
    s.src = url;
    s.onload = resolve;
    s.onerror = function() { reject(new Error("Failed to load: " + url)); };
    document.head.appendChild(s);
  });
}

// ── Inject page styles & skeleton HTML ───────────────────────────────────────
function setupDOM() {
  var style = document.createElement("style");
  style.textContent = [
    "* { margin:0; padding:0; box-sizing:border-box; }",
    "body { font-family:'Segoe UI',Arial,sans-serif; background:#fff; overflow:hidden; }",
    "#wrap { display:flex; flex-direction:column; width:100%; height:100vh; padding:8px; }",
    "#map-title { font-size:13px; font-weight:600; color:#333; margin-bottom:6px; min-height:18px; }",
    "svg#map { flex:1; width:100%; display:block; }",
    ".state-path { stroke:#fff; stroke-width:0.5; cursor:pointer; transition:fill .2s,opacity .15s; }",
    ".state-path:hover { opacity:.75; stroke:#333; stroke-width:1.5; }",
    ".no-data { fill:#e4e6ec !important; }",
    ".legend { display:flex; align-items:center; gap:8px; font-size:11px; color:#888; padding:5px 0 2px; }",
    "#tip { position:fixed; background:rgba(15,15,25,.9); color:#fff; padding:7px 12px;",
    "       border-radius:6px; font-size:12px; line-height:1.6; pointer-events:none;",
    "       display:none; z-index:9999; box-shadow:0 4px 14px rgba(0,0,0,.25); }",
    "#tip b { font-size:13px; }",
    "#err { color:#c0392b; font-size:13px; padding:16px; display:none; }"
  ].join("\n");
  document.head.appendChild(style);

  document.body.innerHTML = [
    '<div id="wrap">',
    '  <div id="map-title"></div>',
    '  <svg id="map" viewBox="0 0 800 700" preserveAspectRatio="xMidYMid meet"></svg>',
    '  <div class="legend">',
    '    <span id="leg-lo"></span>',
    '    <svg width="140" height="10" style="border-radius:2px;flex-shrink:0">',
    '      <defs><linearGradient id="grad" x1="0" x2="1">',
    '        <stop offset="0%"   id="c-lo"/>',
    '        <stop offset="100%" id="c-hi"/>',
    '      </linearGradient></defs>',
    '      <rect width="140" height="10" fill="url(#grad)"/>',
    '    </svg>',
    '    <span id="leg-hi"></span>',
    '  </div>',
    '  <div id="err"></div>',
    '</div>',
    '<div id="tip"></div>'
  ].join("\n");
}

// ── Main draw function — called by dscc every time data / filters change ─────
function drawViz(data) {
  var rows = data.tables.DEFAULT;

  if (!rows || rows.length === 0) {
    document.getElementById("map-title").textContent = "No data";
    return;
  }

  // Build state → value map (sum in case multiple rows per state)
  var stateData = {};
  rows.forEach(function(row) {
    var state = row.stateDimension;
    var value = row.valueMetric;
    if (state && value != null && !isNaN(value)) {
      stateData[state] = (stateData[state] || 0) + value;
    }
  });

  // Style options
  var styleObj    = data.style;
  var colorLow    = (styleObj.colorLow    && styleObj.colorLow.value    && styleObj.colorLow.value.color)    || "#c6dbef";
  var colorHigh   = (styleObj.colorHigh   && styleObj.colorHigh.value   && styleObj.colorHigh.value.color)   || "#084594";
  var noDataColor = (styleObj.noDataColor && styleObj.noDataColor.value && styleObj.noDataColor.value.color) || "#e4e6ec";

  // Title from field name
  var fields      = data.fields;
  var metricLabel = (fields.valueMetric && fields.valueMetric[0]) ? fields.valueMetric[0].name : "Value";
  document.getElementById("map-title").textContent = metricLabel;

  // Colour scale
  var vals   = Object.values(stateData).filter(function(v) { return v > 0; });
  var minVal = (vals.length ? d3.min(vals) : 0);
  var maxVal = (vals.length ? d3.max(vals) : 1);

  var color = d3.scaleSequential()
    .domain([minVal, maxVal])
    .interpolator(d3.interpolateRgb(colorLow, colorHigh));

  // Legend
  document.getElementById("leg-lo").textContent = d3.format(".3s")(minVal);
  document.getElementById("leg-hi").textContent = d3.format(".3s")(maxVal);
  document.getElementById("c-lo").setAttribute("stop-color", colorLow);
  document.getElementById("c-hi").setAttribute("stop-color", colorHigh);

  // If TopoJSON not ready yet, stash data and return — drawViz will be called again
  if (!stateFeatures) {
    pendingData = data;
    return;
  }

  var tip = document.getElementById("tip");

  d3.select("#map")
    .selectAll(".state-path")
    .data(stateFeatures)
    .join("path")
    .attr("class", function(d) {
      var v = stateData[d.properties.st_nm];
      return "state-path" + ((!v || v <= 0) ? " no-data" : "");
    })
    .attr("fill", function(d) {
      var v = stateData[d.properties.st_nm];
      return (v && v > 0) ? color(v) : noDataColor;
    })
    .attr("d", pathFn)
    .on("mousemove", function(evt, d) {
      var name = d.properties.st_nm || "Unknown";
      var v    = stateData[name];
      tip.style.display = "block";
      tip.style.left    = (evt.clientX + 16) + "px";
      tip.style.top     = (evt.clientY - 36) + "px";
      tip.innerHTML     = "<b>" + name + "</b><br>" +
        (v && v > 0 ? d3.format(",.1f")(v) : "No data");
    })
    .on("mouseleave", function() { tip.style.display = "none"; });
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────
(function init() {
  // Load D3 → TopoJSON → dscc in sequence
  loadScript("https://d3js.org/d3.v7.min.js")
  .then(function() { return loadScript("https://unpkg.com/topojson-client@3/dist/topojson-client.min.js"); })
  .then(function() { return loadScript("https://unpkg.com/@google/dscc@0.3.5/dist/dscc.min.js"); })
  .then(function() {
    setupDOM();
    // Fetch TopoJSON and build state features
    return d3.json(TOPO_URL);
  })
  .then(function(topo) {
    var objKey  = Object.keys(topo.objects)[0];
    var geoms   = topo.objects[objKey].geometries;
    var groups  = d3.group(geoms, function(d) { return d.properties.st_nm; });

    stateFeatures = Array.from(groups, function(entry) {
      var name      = entry[0];
      var districts = entry[1];
      return {
        type: "Feature",
        properties: { st_nm: name },
        geometry: topojson.merge(topo, districts)
      };
    });

    var proj = d3.geoMercator()
      .fitSize([800, 700], { type: "FeatureCollection", features: stateFeatures });
    pathFn = d3.geoPath().projection(proj);

    // Subscribe to Looker Studio — drawViz called on every filter/data change
    dscc.subscribeToData(drawViz, { transform: dscc.objectTransform });

    // If drawViz already fired before TopoJSON was ready, replay it
    if (pendingData) {
      drawViz(pendingData);
      pendingData = null;
    }
  })
  .catch(function(err) {
    var el = document.getElementById("err") || document.body;
    el.style.display  = "block";
    el.textContent    = "Error: " + err.message;
    console.error(err);
  });
})();
