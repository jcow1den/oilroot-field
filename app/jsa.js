// ============================================================
// jsa.js — JSA module logic (Session 2: UI structure only)
// Session 3 will wire this up to Firestore for persistence.
// Session 4 will add individual crew signatures.
// Session 5 will generate audit-ready PDFs.
// ============================================================

// ============== JOB TYPES ==============
// Only flowback is "ready" in v0.1. The others are scaffolded for the future.
const JOB_TYPES = [
  { id: "flowback",   name: "Flowback Operations", num: "M-01", ready: true  },
  { id: "swabbing",   name: "Swabbing",            num: "M-02", ready: false },
  { id: "roustabout", name: "Roustabout",          num: "M-03", ready: false },
  { id: "trucking",   name: "Trucking",            num: "M-04", ready: false },
  { id: "frac",       name: "Frac",                num: "M-05", ready: false },
  { id: "workover",   name: "Workover",            num: "M-06", ready: false },
  { id: "production", name: "Production",          num: "M-07", ready: false },
  { id: "pna",        name: "Plug & Abandon",      num: "M-08", ready: false }
];

// ============== FLOWBACK TEMPLATE ==============
// This is the v0.1 template content. Sourced from OSHA Oil & Gas eTool,
// API RP 54 / RP 75 frameworks, the Fatal 8 categories, and standard
// upstream HSE practice. To be reviewed by a qualified attorney before
// commercial launch.

const FLOWBACK_TEMPLATE = {
  hazards: [
    "High pressure lines and equipment failure",
    "Trapped pressure / unexpected pressure release",
    "H₂S exposure (sour gas)",
    "Hydrocarbon vapor exposure (LEL / explosive atmosphere)",
    "Fire and explosion (ignition sources, static electricity)",
    "Hot surfaces (separator vessels, flow iron after flow)",
    "Sand erosion and equipment failure",
    "Pinch points (hammer unions, valves, flow iron)",
    "Struck-by (dropped equipment, swinging iron, pressure release)",
    "Slips, trips, falls (icy catwalks, slick surfaces, hoses)",
    "Noise exposure (>85 dB)",
    "Chemical exposure (produced fluids, treatment chemicals)",
    "Spill / environmental release",
    "Heat / cold stress, fatigue (12-hour shifts)"
  ],
  // Hierarchy of controls tagging: 'eng' = engineering, 'admin' = administrative, 'ppe' = PPE
  controls: [
    { text: "Pre-job safety meeting completed and documented",       type: "admin" },
    { text: "Stop Work Authority communicated to all crew",          type: "admin" },
    { text: "All non-essential personnel kept clear of pressure work zones", type: "admin" },
    { text: "Pressure verified at zero before any iron disconnection", type: "admin" },
    { text: "Hammer unions properly seated and pinned",              type: "eng"   },
    { text: "Lines anchored / chained per operator spec",            type: "eng"   },
    { text: "Bonding and grounding verified on all tanks",           type: "eng"   },
    { text: "Continuous gas monitoring (4-gas) at work area",        type: "eng"   },
    { text: "Wind direction noted, briefing oriented to upwind muster", type: "admin" },
    { text: "Spill kit on site and location communicated",           type: "admin" },
    { text: "Berms / secondary containment verified",                type: "eng"   },
    { text: "Fire extinguishers staged and inspected",               type: "eng"   },
    { text: "Communication plan (radio, hand signals) confirmed",    type: "admin" }
  ],
  ppe: [
    "Hard hat",
    "Safety glasses (impact-rated)",
    "FR coveralls or FR layered clothing",
    "Steel-toe boots (lace-up, ANSI-rated)",
    "Cut-resistant / impact gloves",
    "Hearing protection (within 50 ft of flow iron)",
    "Personal 4-gas monitor (O₂, LEL, H₂S, CO)",
    "H₂S escape pack / SCBA available on site"
  ],
  routineSteps: [
    {
      title: "Site arrival and pre-job inspection",
      hazards: ["Driving to remote location", "Slips/trips on uneven ground", "Exposure to live equipment", "Working alone at arrival"],
      controls: ["Defensive driving", "Three points of contact entering location", "Verbal check-in with supervisor or crew at arrival", "Walk the location before touching anything", "Verify gas monitor calibration"]
    },
    {
      title: "Equipment inspection and rig-up verification",
      hazards: ["Pinch points on iron and valves", "Residual pressure in lines", "Dropped equipment during inspection", "Slick surfaces", "Leaks"],
      controls: ["Visually inspect all flow iron, hammer unions, and connections", "Verify chains/anchoring on flow lines", "Confirm pressure gauges calibrated", "Check choke for wear", "Hands clear of pinch points"]
    },
    {
      title: "Open well to flow / manage choke and separator",
      hazards: ["Sudden pressure release", "Sand erosion of choke or iron", "Hydrocarbon release if separator dump fails", "H₂S", "Vapor cloud at LEL", "Fire/explosion if ignition source present"],
      controls: ["Verify all valves correctly aligned before opening choke", "Stand clear of pressure work zone during opening", "Continuous gas monitoring", "Adjust choke incrementally", "No hot work, no smoking, no non-rated electronics in work zone", "Wind direction awareness"]
    },
    {
      title: "Routine operation and monitoring (12-hour shift)",
      hazards: ["Fatigue, complacency", "Climbing on tanks", "Slips on catwalks", "Exposure during sample collection", "Noise", "Heat / cold stress"],
      controls: ["Hourly walkarounds with awareness of wind, smell, sound changes", "Three points of contact on any ladder or catwalk", "Sample collection from upwind position with monitor on person", "Stay hydrated", "Rotate tasks if fatigue sets in", "Communicate any abnormal conditions immediately"]
    },
    {
      title: "Shift handoff and end-of-day documentation",
      hazards: ["Incomplete information transfer", "Missed equipment changes", "Environmental hazards if leaving site"],
      controls: ["Walk the location with incoming operator", "Verbally cover pressures, choke setting, sand production, any abnormal observations", "Document hourly readings", "Note any equipment issues for follow-up"]
    }
  ]
};

// ============== DOM REFS ==============
const backBtn       = document.getElementById("back-btn");
const startJsaBtn   = document.getElementById("start-jsa-btn");
const viewHome      = document.getElementById("view-home");
const viewPicker    = document.getElementById("view-picker");
const viewJsaForm   = document.getElementById("view-jsa-form");
const jobGrid       = document.getElementById("job-grid");
const jsaJobTitle   = document.getElementById("jsa-job-title");

const jsaDateInput  = document.getElementById("jsa-date");
const jsaTimeInput  = document.getElementById("jsa-time");
const captureGpsBtn = document.getElementById("capture-gps-btn");
const jsaGpsEl      = document.getElementById("jsa-gps");

const hazardsList   = document.getElementById("hazards-list");
const controlsList  = document.getElementById("controls-list");
const ppeList       = document.getElementById("ppe-list");
const hazardsLabel  = document.getElementById("hazards-label");
const controlsLabel = document.getElementById("controls-label");
const ppeLabel      = document.getElementById("ppe-label");

const confirmStandardBtn = document.getElementById("confirm-standard-btn");
const exceptionBtn       = document.getElementById("exception-btn");
const exceptionArea      = document.getElementById("exception-area");

const addTaskBtn    = document.getElementById("add-task-btn");
const customTasksEl = document.getElementById("custom-tasks");

const submitJsaBtn  = document.getElementById("submit-jsa-btn");

const toastEl       = document.getElementById("toast");

// ============== VIEW NAVIGATION ==============
let viewStack = ["home"];

function navigateTo(viewName) {
  // Hide all views
  viewHome.hidden = true;
  viewPicker.hidden = true;
  viewJsaForm.hidden = true;

  // Show requested view
  if (viewName === "home") {
    viewHome.hidden = false;
    backBtn.hidden = true;
  } else if (viewName === "picker") {
    viewPicker.hidden = false;
    backBtn.hidden = false;
  } else if (viewName === "jsa-form") {
    viewJsaForm.hidden = false;
    backBtn.hidden = false;
  }

  // Track stack for back button
  if (viewStack[viewStack.length - 1] !== viewName) {
    viewStack.push(viewName);
  }

  // Scroll to top on view change
  window.scrollTo(0, 0);
}

function goBack() {
  if (viewStack.length > 1) {
    viewStack.pop();
    const prev = viewStack[viewStack.length - 1];
    navigateTo(prev);
    // Pop again because navigateTo re-pushed
    if (viewStack.length > 1 && viewStack[viewStack.length - 1] === viewStack[viewStack.length - 2]) {
      viewStack.pop();
    }
  } else {
    navigateTo("home");
  }
}

backBtn.addEventListener("click", goBack);
startJsaBtn.addEventListener("click", () => navigateTo("picker"));

// ============== JOB PICKER ==============
function renderJobGrid() {
  jobGrid.innerHTML = "";
  JOB_TYPES.forEach((job) => {
    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = "job-tile" + (job.ready ? "" : " disabled");
    tile.disabled = !job.ready;
    tile.innerHTML = `
      <span class="job-tile-num">${job.num}</span>
      <h3 class="job-tile-name">${job.name}</h3>
      <span class="job-tile-tag ${job.ready ? "ready" : "coming"}">${job.ready ? "Ready" : "Coming soon"}</span>
    `;
    if (job.ready) {
      tile.addEventListener("click", () => openJsaForm(job));
    }
    jobGrid.appendChild(tile);
  });
}
renderJobGrid();

// ============== JSA FORM ==============
function openJsaForm(job) {
  jsaJobTitle.textContent = job.name;

  // Reset form state
  resetJsaForm();

  // Populate the standard hazards/controls/PPE lists from the template
  if (job.id === "flowback") {
    populateStandardLists(FLOWBACK_TEMPLATE);
  }

  // Set today's date as default
  const now = new Date();
  jsaDateInput.value = now.toISOString().slice(0, 10);
  // HH:MM in local time
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  jsaTimeInput.value = `${hh}:${mm}`;

  navigateTo("jsa-form");
}

function populateStandardLists(template) {
  // Hazards
  hazardsLabel.textContent = `Standard hazards (${template.hazards.length})`;
  hazardsList.innerHTML = template.hazards
    .map(h => `<li>${escapeHtml(h)}</li>`)
    .join("");

  // Controls (with hierarchy-of-controls tagging)
  controlsLabel.textContent = `Standard controls (${template.controls.length})`;
  controlsList.innerHTML = template.controls
    .map(c => {
      const tag = c.type === "eng" ? "ENGINEERING" : c.type === "admin" ? "ADMIN" : "PPE";
      return `<li>${escapeHtml(c.text)}<span class="hierarchy-tag">${tag}</span></li>`;
    })
    .join("");

  // PPE
  ppeLabel.textContent = `Standard PPE (${template.ppe.length})`;
  ppeList.innerHTML = template.ppe
    .map(p => `<li>${escapeHtml(p)}</li>`)
    .join("");
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;"
  }[m]));
}

// Toggle the standard list views ("View list" / "Hide list")
document.querySelectorAll(".link-toggle").forEach(btn => {
  btn.addEventListener("click", () => {
    const targetId = btn.dataset.toggle;
    const target = document.getElementById(targetId);
    if (target.hidden) {
      target.hidden = false;
      btn.textContent = "Hide list";
    } else {
      target.hidden = true;
      btn.textContent = "View list";
    }
  });
});

// Confirmation toggle
confirmStandardBtn.addEventListener("click", () => {
  const isConfirmed = confirmStandardBtn.classList.toggle("confirmed");
  if (isConfirmed) {
    confirmStandardBtn.querySelector(".btn-confirm-label").textContent = "Confirmed for today's work";
  } else {
    confirmStandardBtn.querySelector(".btn-confirm-label").textContent = "I confirm all standard items apply to today's work";
  }
});

// Exception path toggle
exceptionBtn.addEventListener("click", () => {
  exceptionArea.hidden = !exceptionArea.hidden;
  exceptionBtn.textContent = exceptionArea.hidden ? "Something is different" : "Cancel exception";
});

// ============== GPS CAPTURE ==============
captureGpsBtn.addEventListener("click", () => {
  if (!navigator.geolocation) {
    showToast("GPS not available on this device", "error");
    return;
  }

  captureGpsBtn.disabled = true;
  captureGpsBtn.textContent = "Capturing...";

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const lat = pos.coords.latitude.toFixed(5);
      const lng = pos.coords.longitude.toFixed(5);
      jsaGpsEl.textContent = `${lat}°, ${lng}°`;
      jsaGpsEl.classList.add("captured");
      captureGpsBtn.textContent = "Recapture";
      captureGpsBtn.disabled = false;
    },
    (err) => {
      let msg = "GPS unavailable";
      if (err.code === 1) msg = "GPS permission denied";
      if (err.code === 3) msg = "GPS timed out";
      showToast(msg, "error");
      captureGpsBtn.textContent = "Capture GPS";
      captureGpsBtn.disabled = false;
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
});

// ============== CUSTOM TASKS ==============
let customTaskCount = 0;

addTaskBtn.addEventListener("click", () => {
  customTaskCount += 1;
  const taskEl = document.createElement("div");
  taskEl.className = "custom-task";
  taskEl.dataset.taskNum = customTaskCount;
  taskEl.innerHTML = `
    <div class="custom-task-head">
      <span class="custom-task-num">NON-ROUTINE TASK #${String(customTaskCount).padStart(2, "0")}</span>
      <button type="button" class="custom-task-remove" data-action="remove">Remove</button>
    </div>
    <label class="field-group">
      <span class="spec-label">Task description</span>
      <input type="text" class="field" placeholder="e.g., Swap out worn choke insert" />
    </label>
    <label class="field-group">
      <span class="spec-label">Specific hazards for this task</span>
      <textarea class="field textarea" rows="2" placeholder="What could go wrong specifically with this task?"></textarea>
    </label>
    <label class="field-group">
      <span class="spec-label">Controls for this task</span>
      <textarea class="field textarea" rows="2" placeholder="LOTO, depressurize, two-person verification, etc."></textarea>
    </label>
  `;
  taskEl.querySelector("[data-action=remove]").addEventListener("click", () => {
    taskEl.remove();
  });
  customTasksEl.appendChild(taskEl);
});

// ============== SUBMIT (placeholder for Session 3) ==============
submitJsaBtn.addEventListener("click", () => {
  showToast("Submit wires up in Session 3 — saving to Firestore with tamper-evident timestamp", "info");
});

// ============== RESET ==============
function resetJsaForm() {
  // Clear all text inputs and textareas inside the form view
  viewJsaForm.querySelectorAll("input[type=text], input[type=date], input[type=time], textarea").forEach(el => {
    el.value = "";
  });
  // Reset GPS
  jsaGpsEl.textContent = "Not captured";
  jsaGpsEl.classList.remove("captured");
  // Reset confirmation
  confirmStandardBtn.classList.remove("confirmed");
  confirmStandardBtn.querySelector(".btn-confirm-label").textContent = "I confirm all standard items apply to today's work";
  // Reset exception
  exceptionArea.hidden = true;
  exceptionBtn.textContent = "Something is different";
  // Reset toggle states
  ["hazards-list", "controls-list", "ppe-list"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.hidden = true;
  });
  document.querySelectorAll(".link-toggle").forEach(btn => btn.textContent = "View list");
  // Routine task default checked
  const routineCheck = document.getElementById("task-routine");
  if (routineCheck) routineCheck.checked = true;
  // Clear custom tasks
  customTasksEl.innerHTML = "";
  customTaskCount = 0;
}

// ============== TOAST ==============
let toastTimer = null;
function showToast(message, type = "info") {
  toastEl.textContent = message;
  toastEl.className = "toast " + type;
  toastEl.hidden = false;
  // Force reflow then animate in
  void toastEl.offsetWidth;
  toastEl.classList.add("visible");

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.classList.remove("visible");
    setTimeout(() => { toastEl.hidden = true; }, 250);
  }, 3500);
}
