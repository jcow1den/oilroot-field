// ============================================================
// jsa.js — JSA module logic (Session 3: Firestore wired up)
// Session 4 will add individual crew signatures.
// Session 5 will generate audit-ready PDFs.
// ============================================================

import {
  initializeApp, getApps, getApp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  initializeFirestore,
  getFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  collection,
  collectionGroup,
  addDoc,
  getDocs,
  doc,
  getDoc,
  query,
  orderBy,
  where,
  limit,
  serverTimestamp,
  updateDoc,
  arrayUnion,
  Timestamp,
  setDoc
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

// auth.js already initialized Firebase. We just grab the existing app.
const app  = getApps().length ? getApp() : initializeApp({});
const auth = getAuth(app);
const db   = getFirestore(app);

// ============== CURRENT USER (set by auth observer) ==============
let currentUser = null;
let isCurrentUserAdmin = false;  // Set after auth state change; true if user has isAdmin flag
let adminViewMode = false;        // When true, loadPastJsas shows all users' JSAs

onAuthStateChanged(auth, async (user) => {
  currentUser = user || null;
  isCurrentUserAdmin = false;
  adminViewMode = false;
  hideAdminToggle();
  if (user) {
    // Check admin status by reading the user doc
    try {
      const userDoc = await getDoc(doc(db, "users", user.uid));
      if (userDoc.exists() && userDoc.data().isAdmin === true) {
        isCurrentUserAdmin = true;
        showAdminToggle();
      }
    } catch (err) {
      console.warn("Admin status check failed:", err);
    }
    // Load past JSAs whenever a user is signed in
    loadPastJsas();
  }
});

// Admin toggle UI helpers; the toggle itself is built lazily in showAdminToggle
function showAdminToggle() {
  let toggle = document.getElementById("admin-view-toggle");
  if (!toggle) {
    toggle = document.createElement("button");
    toggle.id = "admin-view-toggle";
    toggle.type = "button";
    toggle.className = "admin-view-toggle";
    toggle.innerHTML = `<span class="admin-badge">ADMIN</span><span class="admin-toggle-label">View: My JSAs</span>`;
    // Insert into the header. Find the "New JSA" button container or similar.
    const headerContainer = document.querySelector(".past-header-row") || document.querySelector(".content-header") || document.body;
    if (headerContainer && headerContainer.parentElement) {
      headerContainer.parentElement.insertBefore(toggle, headerContainer.nextSibling);
    }
    toggle.addEventListener("click", () => {
      adminViewMode = !adminViewMode;
      toggle.querySelector(".admin-toggle-label").textContent = adminViewMode ? "View: All users" : "View: My JSAs";
      toggle.classList.toggle("admin-view-active", adminViewMode);
      loadPastJsas();
    });
  }
  toggle.hidden = false;
}

function hideAdminToggle() {
  const toggle = document.getElementById("admin-view-toggle");
  if (toggle) toggle.hidden = true;
}

// ============== JOB TYPES ==============
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
const FLOWBACK_TEMPLATE = {
  // Each hazard: short tap-line + a longer "what can actually happen" elaboration.
  // Elaborations are plain-spoken, no scare tactics, no romanticizing.
  hazards: [
    {
      text: "High pressure lines and equipment failure",
      elaboration: "Flow iron carries fluid at thousands of psi during flowback. When a connection fails, released energy whips the line and ejects components at high velocity. Restraints on flow iron, properly pinned hammer unions, and keeping the work zone clear before pressure operations are the standard controls."
    },
    {
      text: "Trapped pressure / unexpected pressure release",
      elaboration: "Closing a valve does not eliminate pressure between that valve and the next closure. Disconnecting iron with residual pressure can dislodge components forcefully. Standard practice is to verify zero on a gauge, bleed down to a safe location, then verify zero again before breaking any connection."
    },
    {
      text: "H2S exposure (sour gas)",
      elaboration: "Hydrogen sulfide at 100 ppm causes loss of smell within minutes. At 500 ppm, short exposure can be fatal. H2S is heavier than air and accumulates in low areas. Required controls include continuous gas monitoring (worn within 6 inches of the breathing zone), awareness of wind direction, and a defined upwind muster point."
    },
    {
      text: "Hydrocarbon vapor exposure (LEL / explosive atmosphere)",
      elaboration: "The lower explosive limit is the minimum concentration of hydrocarbon vapor in air that will support combustion. Continuous gas monitoring is required during flowback. At 10% of LEL, work practices change. At 100% of LEL, a single ignition source can ignite the atmosphere."
    },
    {
      text: "Fire and explosion (ignition sources, static electricity)",
      elaboration: "Common ignition sources on flowback locations include static electricity from clothing or footwear, non-rated electronics, hot work without permit, and running equipment near a leak. Bonding and grounding of all flowback equipment and vessels, ignition source controls, and hot work permits address this hazard."
    },
    {
      text: "Hot work and ignition sources (heater treaters, welding, cutting, grinding)",
      elaboration: "Heater treater ignition is part of flowback operations and follows the operator's specific procedure. Other hot work such as welding, cutting, grinding, and any open flame requires a separate hot work permit and is not authorized under this JSA. Verify atmosphere is below 10% LEL before any ignition source, including heater treater lighting."
    },
    {
      text: "Hot surfaces (separator vessels, flow iron after flow)",
      elaboration: "Flow iron and separator vessels can remain at temperatures that cause severe burns for 30+ minutes after the well shuts in. Visual inspection alone is not reliable. Use the back of a gloved hand to test, or use an IR thermometer before contact."
    },
    {
      text: "Sand erosion and equipment failure",
      elaboration: "Sand at flowback velocity erodes tungsten carbide chokes within days. The inside of flow iron, valve bodies, and dump valves erode the same way. Erosion at the inside of a 90-degree bend often shows no outward signs until the iron fails. Monitoring sand cutters and inspecting iron are standard practice."
    },
    {
      text: "Pinch points (hammer unions, valves, flow iron)",
      elaboration: "Hammer unions, valve handles, choke wrenches, and equipment skids all present pinch hazards during assembly, adjustment, and inspection. Hands stay clear of the line of action, gloves stay on, and the right tool is used for each task."
    },
    {
      text: "Struck-by (dropped equipment, swinging iron, pressure release)",
      elaboration: "Dropped tools, equipment under tension, and pressure release events can strike workers in the area. The work zone is cleared during pressure operations specifically to limit who can be exposed. Only essential personnel should be present in active work zones."
    },
    {
      text: "Falls from elevation (tanks, separator tops, elevated equipment)",
      elaboration: "Climbing on tanks, separator catwalks, and elevated equipment for gauging, sampling, or inspection introduces fall hazards. Guard rails on tanks, separators, and elevated walkways are the primary engineering control and are inspected before each use. Three points of contact applies to all ladders. If a guard rail is damaged, missing, or unsafe, stop work and address it before continuing."
    },
    {
      text: "Slips, trips, falls at ground level (icy catwalks, slick surfaces, hoses)",
      elaboration: "Slip, trip, and fall incidents at ground level account for the largest share of oilfield injuries by category. Catwalks ice over in cold weather. Hoses and cables across the ground create trip hazards. Three points of contact on any ladder or elevated surface is required practice."
    },
    {
      text: "Stored energy release during maintenance (mechanical, electrical, hydraulic, pneumatic)",
      elaboration: "Iron change-out, valve repair, and equipment maintenance can release stored energy unexpectedly. Lockout/tagout (LOTO) of all energy sources is required before maintenance: depressurization, electrical isolation, pneumatic bleed-off, hydraulic relief. Every energy source must be verified at zero before work begins."
    },
    {
      text: "Confined space hazards (tanks, vessels, enclosed work areas)",
      elaboration: "Tanks, vessels, and certain enclosed work areas qualify as permit-required confined spaces. Flowback operations do not include confined space entry. Tank entry, vessel entry, and similar work require a separate permit process with atmospheric testing, ventilation, attendant, and retrieval equipment, and are not authorized under this JSA."
    },
    {
      text: "Noise exposure (over 85 dB)",
      elaboration: "The industry-recognized action level for noise exposure is 85 dB averaged over 8 hours. Flowback equipment commonly exceeds 95 dB at the work area. Hearing protection is required within 50 feet of flow iron. Long-term hearing damage is cumulative and not reversible."
    },
    {
      text: "Chemical exposure (produced fluids, treatment chemicals)",
      elaboration: "Produced water can contain NORM (naturally occurring radioactive material), benzene, and high-concentration brines. Treatment chemicals like H2S scavengers and corrosion inhibitors are typically caustic. SDS sheets for all chemicals on location must be available and reviewed before handling."
    },
    {
      text: "Spill / environmental release",
      elaboration: "Spills that reach soil require remediation. Spills that reach a waterway trigger regulatory reporting under the Clean Water Act and significant cleanup costs. Berms, secondary containment, spill kits, and contingency plans are the standard controls."
    },
    {
      text: "Vehicle and commute hazards (driving to and from location)",
      elaboration: "Highway vehicle incidents account for roughly 40% of oilfield worker fatalities. Defensive driving, seatbelt use, no phone while driving, and adequate rest before long drives are the controls. Fatigue management before and after long shifts is critical."
    },
    {
      text: "Heat / cold stress, fatigue (12-hour shifts)",
      elaboration: "Heat exhaustion develops before subjective symptoms are obvious. Cold stress reduces dexterity and judgment. Fatigue at the end of a long shift correlates with the highest rate of preventable incidents. Hydration, rest breaks, and communicating fatigue early are required controls."
    }
  ],
  controls: [
    {
      text: "Pre-job safety meeting completed and documented",
      type: "admin",
      elaboration: "The pre-job safety meeting is where the crew aligns on today's work, today's hazards, and today's plan. It's also the legal record that hazards were communicated. Without it, no one can prove the crew was briefed on what could go wrong."
    },
    {
      text: "Stop Work Authority communicated to all crew",
      type: "admin",
      elaboration: "Every crew member needs to know they can stop the job if they see something unsafe, without fear of being punished. If this hasn't been said out loud, new hands won't speak up when they should."
    },
    {
      text: "All non-essential personnel kept clear of pressure work zones",
      type: "admin",
      elaboration: "When iron is under pressure, the work zone is for essential personnel only. Extra bodies create more potential injuries during a release event. Keep the zone small and the people in it minimal."
    },
    {
      text: "Pressure verified at zero before any iron disconnection",
      type: "admin",
      elaboration: "Trapped pressure between two closures will eject components when iron is broken. Verify zero on a gauge, bleed it down to a safe location, verify zero again. This is a sequence, not a single step."
    },
    {
      text: "Hammer unions properly seated and pinned",
      type: "eng",
      elaboration: "A hammer union that isn't fully seated or has a missing pin will let go under pressure. The pin is the difference between a controlled connection and a flying piece of iron. Check every connection during assembly."
    },
    {
      text: "Lines restrained per operator spec",
      type: "eng",
      elaboration: "Flow iron carries enough stored energy to whip violently if a connection fails. Restraints (typically cable or chain tied to fixed anchor points) limit how far the line can travel during a release. Without them, the line goes wherever the pressure sends it."
    },
    {
      text: "Bonding and grounding verified on all flowback equipment and vessels",
      type: "eng",
      elaboration: "Hydrocarbon flow generates static electricity. Without bonding (connecting equipment electrically) and grounding (path to earth), static can build up and discharge as a spark in a flammable atmosphere. This is how flowback locations catch fire."
    },
    {
      text: "Continuous gas monitoring (4-gas) at work area",
      type: "eng",
      elaboration: "A 4-gas monitor reads O2, LEL, H2S, and CO. Continuous monitoring means it's running during work, not just checked once. The monitor is your early warning before anyone notices a leak."
    },
    {
      text: "Wind direction noted, briefing oriented to upwind muster",
      type: "admin",
      elaboration: "If H2S or hydrocarbon vapor releases, wind decides who's exposed. The muster point must be upwind of the release source. Wind direction needs to be checked at the start of every shift and any time the briefing changes."
    },
    {
      text: "Spill kit on site and location communicated",
      type: "admin",
      elaboration: "When fluid hits the ground, every minute matters. The spill kit needs to be on location before work starts, and every crew member needs to know where it is without having to ask."
    },
    {
      text: "Berms / secondary containment verified",
      type: "eng",
      elaboration: "Berms and containment catch spills before they reach soil or water. A breach in a berm means the next spill goes off-location. Walk the perimeter at the start of the shift to verify integrity."
    },
    {
      text: "Fire extinguishers staged and inspected",
      type: "eng",
      elaboration: "Fire extinguishers are useless if they're empty, expired, or located 200 feet from the fire. Check the gauge, check the date, confirm location is accessible from the work area."
    },
    {
      text: "Communication plan (radio, hand signals) confirmed",
      type: "admin",
      elaboration: "When the iron is loud and the crew is spread out, verbal communication fails. The plan needs to cover both normal communication and emergency signals. Test the radios before work starts."
    },
    {
      text: "Lockout/tagout applied to all energy sources before maintenance or iron change-out (mechanical, electrical, hydraulic, pneumatic)",
      type: "eng",
      elaboration: "Energy stored in any form can release when equipment is opened. Mechanical (springs, gravity), electrical (capacitors, batteries), hydraulic (pressurized lines), pneumatic (compressed air). Every source gets isolated and verified at zero before work begins."
    },
    {
      text: "Guard rails inspected and intact on tanks, separators, and elevated walkways. Three points of contact on ladders. Stop work if any rail is damaged, missing, or unsafe.",
      type: "eng",
      elaboration: "Guard rails are the engineering control that prevents falls from elevation. They work passively, no harness required, as long as they're intact. A damaged or missing rail means the fall protection is broken. Stop work, address it, then continue."
    },
    {
      text: "Heater treater ignition follows operator-specific procedure. Other hot work (welding, cutting, grinding) requires separate hot work permit and is not authorized under this JSA.",
      type: "admin",
      elaboration: "Heater treater lighting is part of routine flowback and follows the operator's written ignition procedure. Welding, cutting, and grinding produce additional sparks and require a separate hot work permit with atmospheric testing. They're not authorized under this JSA without that permit."
    },
    {
      text: "Defensive driving practices to and from location. Seatbelts in use. No phone while driving. Adequate rest before long drives.",
      type: "admin",
      elaboration: "Highway vehicle incidents are statistically the most dangerous part of the oilfield workday. About 40% of industry fatalities are vehicle-related. The drive matters as much as the work."
    },
    {
      text: "H2S escape packs accessible to all personnel",
      type: "eng",
      elaboration: "Escape packs let workers reach safe air during an H2S release. Required when H2S is suspected or confirmed at Condition II or above. Must be accessible, not locked away."
    },
    {
      text: "Oxygen resuscitator on location",
      type: "eng",
      elaboration: "Used for emergency response to H2S exposure. The oxygen resuscitator is part of API-recommended equipment for Condition II and above operations."
    },
    {
      text: "Crew briefed on wind direction and muster point",
      type: "admin",
      elaboration: "H2S is heavier than air and drifts downwind. The muster point must be upwind of the source. Wind direction must be briefed before any sour gas operation and any time conditions change."
    },
    {
      text: "Air-supplied respirator (SCBA) in use for personnel in work zone",
      type: "eng",
      elaboration: "Required at Condition III. SCBA provides a clean air supply when ambient atmosphere is above safe limits. No work in the zone without SCBA on, period."
    },
    {
      text: "Dedicated H2S safety watch on duty",
      type: "admin",
      elaboration: "A second person watches the work zone, monitors gas readings, and is ready to respond to an incident. Required at Condition III."
    },
    {
      text: "Written H2S emergency response plan reviewed and on location",
      type: "admin",
      elaboration: "Required at Condition III. The plan covers evacuation routes, rescue procedures, and emergency contacts. Reviewed before shift and physically on location."
    },
    {
      text: "Posted warning signage at site entry points",
      type: "admin",
      elaboration: "Anyone approaching the location needs to know H2S is present. Signs at entry points warn drivers, vendors, and other crews before they're at risk."
    }
  ],
  ppe: [
    {
      text: "Hard hat",
      core: true,
      elaboration: "Protects the head from dropped objects, swinging equipment, and contact with overhead pipe. The most basic PPE on any oilfield location."
    },
    {
      text: "Safety glasses (impact-rated)",
      core: true,
      elaboration: "Protects eyes from fluid splashes, debris, and produced solids. Impact-rated means rated for high-velocity small particles. Reading glasses don't qualify."
    },
    {
      text: "FR coveralls or FR layered clothing",
      core: true,
      elaboration: "Flame-resistant clothing won't ignite from a flash fire. In a flowback location with hydrocarbon vapor potential, this is the layer between the worker and a survivable burn."
    },
    {
      text: "Steel-toe boots (lace-up, ANSI-rated)",
      core: true,
      elaboration: "Protects feet from dropped tools, equipment skids, and crush injuries. Lace-up means firmly secured to the foot (slip-ons can come off in mud or during quick movement). ANSI rating confirms the steel toe meets impact standards."
    },
    {
      text: "Cut-resistant / impact gloves",
      core: true,
      elaboration: "Hands take more incidental contact than any other part of the body on a flowback location. Cut-resistant material protects from sharp edges and pinch points. Impact protection covers the knuckles."
    },
    {
      text: "Hearing protection (within 50 ft of flow iron)",
      core: false,
      elaboration: "Flowback equipment commonly exceeds 95 dB. Hearing damage is cumulative and not reversible. Use foam plugs, earmuffs, or both when working within 50 feet of running iron."
    },
    {
      text: "Personal 4-gas monitor worn within 6 inches of breathing zone (O2, LEL, H2S, CO)",
      core: true,
      elaboration: "The monitor needs to read the air you're actually breathing. Worn within 6 inches of the breathing zone (typically clipped to the collar or shirt pocket), not at the belt. A monitor in the wrong location won't detect the threat in time."
    },
    {
      text: "H2S escape pack / SCBA available on site",
      core: false,
      elaboration: "An escape pack lets a worker reach safe air during an H2S release. SCBA (Self-Contained Breathing Apparatus) is needed for work in atmospheres that already exceed safe limits. Required when H2S is suspected or confirmed."
    }
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
      controls: ["Visually inspect all flow iron, hammer unions, and connections", "Verify line restraints in place", "Confirm pressure gauges calibrated", "Check choke for wear", "Hands clear of pinch points"]
    },
    {
      title: "Open well to flow / manage choke and separator",
      hazards: ["Sudden pressure release", "Sand erosion of choke or iron", "Hydrocarbon release if separator dump fails", "H2S", "Vapor cloud at LEL", "Fire/explosion if ignition source present"],
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

// ============== TEMPLATE VERSION ==============
// Bump when the template content changes. Stored on every JSA so we know
// which version of the template a record was created against.
const TEMPLATE_VERSION = "flowback-v0.4.1";

// ============== H2S TIER CONFIG ==============
// Industry-standard API Condition system. Drives the educational panel and
// the auto-marking of PPE and controls on the JSA form.
//
// Sources: NIOSH REL (10 ppm), NIOSH IDLH (100 ppm),
// ACGIH STEL (5 ppm), API onshore/offshore RP guidance,
// and operator policies including Devon, BP, and similar majors.
//
// Edit thresholds or wording here; the form rerenders accordingly.
const H2S_TIERS = {
  none: {
    label: "Not present",
    range: "verified by recent monitoring",
    info: null,
    addControls: [],
    requirePpe: []
  },
  trace: {
    label: "Trace, monitor only",
    range: "below 10 ppm",
    info: {
      title: "Trace · Monitor only",
      body: "Below 10 ppm. You might smell rotten eggs at concentrations as low as 1 ppm. No physical effects yet. Keep your personal monitor on and clipped within 6 inches of your breathing zone. Alarm setpoint is 10 ppm. Never rely on your nose because olfactory paralysis kicks in at 100 ppm."
    },
    addControls: [],
    requirePpe: ["Personal 4-gas monitor worn within 6 inches of breathing zone (O2, LEL, H2S, CO)"]
  },
  caution: {
    label: "Caution, alarm range",
    range: "10 to 50 ppm",
    info: {
      title: "Caution · Alarm range",
      body: "10 to 50 ppm. Monitors will alarm at 10 ppm. Still no physical symptoms but you're at the threshold. Continuous gas monitoring required. Escape pack accessible. Crew briefed on wind direction and muster point. Oxygen resuscitator on location."
    },
    addControls: [
      "H2S escape packs accessible to all personnel",
      "Oxygen resuscitator on location",
      "Crew briefed on wind direction and muster point"
    ],
    requirePpe: [
      "Personal 4-gas monitor worn within 6 inches of breathing zone (O2, LEL, H2S, CO)",
      "H2S escape pack / SCBA available on site"
    ]
  },
  danger: {
    label: "Danger, physical effects",
    range: "50 to 100 ppm",
    info: {
      title: "Danger · Physical effects",
      body: "50 to 100 ppm. Eye and throat irritation starts at 50 ppm. Coughing and headache start at 100 ppm. You will lose your sense of smell at 100 ppm. SCBA required for any work in the zone. Dedicated H2S safety watch on duty. Written H2S emergency response plan on location."
    },
    addControls: [
      "H2S escape packs accessible to all personnel",
      "Oxygen resuscitator on location",
      "Crew briefed on wind direction and muster point",
      "Air-supplied respirator (SCBA) in use for personnel in work zone",
      "Dedicated H2S safety watch on duty",
      "Written H2S emergency response plan reviewed and on location"
    ],
    requirePpe: [
      "Personal 4-gas monitor worn within 6 inches of breathing zone (O2, LEL, H2S, CO)",
      "H2S escape pack / SCBA available on site"
    ]
  },
  severe: {
    label: "Severe, evacuate",
    range: "above 100 ppm",
    info: {
      title: "Severe · Evacuate",
      body: "NIOSH IDLH (Immediately Dangerous to Life and Health) is 100 ppm. Vomiting and difficulty breathing at 250 ppm. Loss of balance at 500 ppm. Death within minutes above 750 ppm. Full evacuation. Written emergency response plan invoked. No work without SCBA and direct approval. Posted warning signage at all site entry points."
    },
    addControls: [
      "H2S escape packs accessible to all personnel",
      "Oxygen resuscitator on location",
      "Crew briefed on wind direction and muster point",
      "Air-supplied respirator (SCBA) in use for personnel in work zone",
      "Dedicated H2S safety watch on duty",
      "Written H2S emergency response plan reviewed and on location",
      "Posted warning signage at site entry points"
    ],
    requirePpe: [
      "Personal 4-gas monitor worn within 6 inches of breathing zone (O2, LEL, H2S, CO)",
      "H2S escape pack / SCBA available on site"
    ]
  }
};

// ============== CONDITIONAL CONTENT ENGINE ==============
// The JSA shows a standing core (always applies) plus conditional content
// triggered by today's intake answers. This keeps the form short and focused
// on what actually applies, while preserving full audit defensibility.
//
// Hazards/controls/PPE are referenced by their text from FLOWBACK_TEMPLATE.
// The engine looks up the template item by text match at render time.
const FLOWBACK_STANDING_CORE = {
  // Hazards always shown regardless of intake answers
  hazards: [
    "High pressure lines and equipment failure",
    "Trapped pressure / unexpected pressure release",
    "Sand erosion and equipment failure",
    "Hot surfaces (separator vessels, flow iron after flow)",
    "Pinch points (hammer unions, valves, flow iron)",
    "Struck-by (dropped equipment, swinging iron, pressure release)",
    "Slips, trips, falls at ground level (icy catwalks, slick surfaces, hoses)",
    "Chemical exposure (produced fluids, treatment chemicals)",
    "Spill / environmental release",
    "Heat / cold stress, fatigue (12-hour shifts)",
    "Vehicle and commute hazards (driving to and from location)"
  ],
  // Controls always shown
  controls: [
    "Pre-job safety meeting completed and documented",
    "Stop Work Authority communicated to all crew",
    "All non-essential personnel kept clear of pressure work zones",
    "Pressure verified at zero before any iron disconnection",
    "Hammer unions properly seated and pinned",
    "Lines restrained per operator spec",
    "Bonding and grounding verified on all flowback equipment and vessels",
    "Continuous gas monitoring (4-gas) at work area",
    "Wind direction noted, briefing oriented to upwind muster",
    "Spill kit on site and location communicated",
    "Berms / secondary containment verified",
    "Fire extinguishers staged and inspected",
    "Communication plan (radio, hand signals) confirmed"
  ],
  // PPE always shown (most are core/required)
  ppe: [
    "Hard hat",
    "Safety glasses (impact-rated)",
    "FR coveralls or FR layered clothing",
    "Steel-toe boots (lace-up, ANSI-rated)",
    "Cut-resistant / impact gloves",
    "Hearing protection (within 50 ft of flow iron)",
    "Personal 4-gas monitor worn within 6 inches of breathing zone (O2, LEL, H2S, CO)"
  ]
};

// Conditional rules: each rule has a trigger (function returns true if applies)
// and a list of hazards/controls/PPE to add when the rule fires. Rules check
// the intake answers object: {h2s, work, weather, newcrew, different}.
const CONDITIONAL_RULES = [
  {
    name: "h2s_trace",
    trigger: a => a.h2s === "trace",
    hazards:  ["H2S exposure (sour gas)", "Hydrocarbon vapor exposure (LEL / explosive atmosphere)", "Fire and explosion (ignition sources, static electricity)"],
    controls: [],
    ppe:      []
  },
  {
    name: "h2s_caution",
    trigger: a => a.h2s === "caution",
    hazards:  ["H2S exposure (sour gas)", "Hydrocarbon vapor exposure (LEL / explosive atmosphere)", "Fire and explosion (ignition sources, static electricity)"],
    controls: [
      "H2S escape packs accessible to all personnel",
      "Oxygen resuscitator on location",
      "Crew briefed on wind direction and muster point"
    ],
    ppe:      ["H2S escape pack / SCBA available on site"]
  },
  {
    name: "h2s_danger",
    trigger: a => a.h2s === "danger",
    hazards:  ["H2S exposure (sour gas)", "Hydrocarbon vapor exposure (LEL / explosive atmosphere)", "Fire and explosion (ignition sources, static electricity)"],
    controls: [
      "H2S escape packs accessible to all personnel",
      "Oxygen resuscitator on location",
      "Crew briefed on wind direction and muster point",
      "Air-supplied respirator (SCBA) in use for personnel in work zone",
      "Dedicated H2S safety watch on duty",
      "Written H2S emergency response plan reviewed and on location"
    ],
    ppe:      ["H2S escape pack / SCBA available on site"]
  },
  {
    name: "h2s_severe",
    trigger: a => a.h2s === "severe",
    hazards:  ["H2S exposure (sour gas)", "Hydrocarbon vapor exposure (LEL / explosive atmosphere)", "Fire and explosion (ignition sources, static electricity)"],
    controls: [
      "H2S escape packs accessible to all personnel",
      "Oxygen resuscitator on location",
      "Crew briefed on wind direction and muster point",
      "Air-supplied respirator (SCBA) in use for personnel in work zone",
      "Dedicated H2S safety watch on duty",
      "Written H2S emergency response plan reviewed and on location",
      "Posted warning signage at site entry points"
    ],
    ppe:      ["H2S escape pack / SCBA available on site"]
  },
  {
    name: "maintenance",
    trigger: a => Array.isArray(a.work) && a.work.includes("maintenance"),
    hazards:  ["Stored energy release during maintenance (mechanical, electrical, hydraulic, pneumatic)"],
    controls: ["Lockout/tagout applied to all energy sources before maintenance or iron change-out (mechanical, electrical, hydraulic, pneumatic)"],
    ppe:      []
  },
  {
    name: "heater_treater",
    trigger: a => Array.isArray(a.work) && a.work.includes("heater_treater"),
    hazards:  ["Hot work and ignition sources (heater treaters, welding, cutting, grinding)"],
    controls: ["Heater treater ignition follows operator-specific procedure. Other hot work (welding, cutting, grinding) requires separate hot work permit and is not authorized under this JSA."],
    ppe:      []
  },
  {
    name: "elevation_sample",
    trigger: a => Array.isArray(a.work) && a.work.includes("elevation_sample"),
    hazards:  ["Falls from elevation (tanks, separator tops, elevated equipment)"],
    controls: ["Guard rails inspected and intact on tanks, separators, and elevated walkways. Three points of contact on ladders. Stop work if any rail is damaged, missing, or unsafe."],
    ppe:      []
  },
  {
    name: "noise_emphasis",
    trigger: () => true,
    hazards:  ["Noise exposure (over 85 dB)"],
    controls: [],
    ppe:      []
  },
  {
    name: "driving_emphasis",
    trigger: () => true,
    hazards:  [],
    controls: ["Defensive driving practices to and from location. Seatbelts in use. No phone while driving. Adequate rest before long drives."],
    ppe:      []
  }
];

// Build the active content for this JSA based on intake answers.
// Returns indices into FLOWBACK_TEMPLATE.hazards/controls/ppe arrays.
function buildActiveContent(intakeAnswers) {
  if (!currentTemplate) return { hazardIdxs: [], controlIdxs: [], ppeIdxs: [] };

  const includedHazardTexts  = new Set(FLOWBACK_STANDING_CORE.hazards);
  const includedControlTexts = new Set(FLOWBACK_STANDING_CORE.controls);
  const includedPpeTexts     = new Set(FLOWBACK_STANDING_CORE.ppe);

  // Apply conditional rules
  CONDITIONAL_RULES.forEach(rule => {
    if (rule.trigger(intakeAnswers)) {
      rule.hazards.forEach(h => includedHazardTexts.add(h));
      rule.controls.forEach(c => includedControlTexts.add(c));
      rule.ppe.forEach(p => includedPpeTexts.add(p));
    }
  });

  // Map text back to template indices
  const hazardIdxs = [];
  currentTemplate.hazards.forEach((h, idx) => {
    if (includedHazardTexts.has(h.text)) hazardIdxs.push(idx);
  });
  const controlIdxs = [];
  currentTemplate.controls.forEach((c, idx) => {
    if (includedControlTexts.has(c.text)) controlIdxs.push(idx);
  });
  const ppeIdxs = [];
  currentTemplate.ppe.forEach((p, idx) => {
    if (includedPpeTexts.has(p.text)) ppeIdxs.push(idx);
  });

  return { hazardIdxs, controlIdxs, ppeIdxs };
}
// Shown in the banner at the top of the JSA form. Roughly even split between
// trivia ("huh, didn't know that") and technical/process content (educational).
// Scoped to flowback or broadly upstream. No role commentary, no characterizing
// of specific job titles, no folklore, no theatrical voice. New facts get added
// in updates; the picker tracks what each user has seen so repeats are rare.
const FACTS = [

  // ---- OSHA stats ----
  "Between 2013 and 2017, 489 U.S. oil and gas extraction workers were killed on the job.",
  "About 40% of oilfield worker fatalities involve highway vehicle incidents on the drive to or from location.",
  "The industry-recognized action level for noise exposure is 85 dB averaged over 8 hours. Most flowback equipment runs above 95 dB at the work area.",
  "Slips, trips, and falls account for the largest share of oilfield injuries by category.",
  "Most oilfield worker fatalities involve people with less than 5 years of industry experience.",
  "OSHA's 2026 maximum penalty for a serious violation is $16,550 per violation. Willful or repeat violations can reach $165,514. Penalties are adjusted annually for inflation.",
  "The OSHA General Duty Clause is one sentence long. Most enforcement citations cite it.",
  "OSHA doesn't mandate a specific JSA format. The legal requirement comes from the General Duty Clause.",

  // ---- History ----
  "The first commercial U.S. oil well opened in Titusville, Pennsylvania in 1859. Edwin Drake drilled it 69.5 feet deep.",
  "A barrel of oil is 42 U.S. gallons. The number comes from old whiskey barrels.",
  "Spindletop blew in Beaumont, Texas in 1901. It produced 100,000 barrels per day.",
  "The Lucas Gusher at Spindletop gave the world the term \"wildcatter.\"",
  "Hydraulic fracturing as a stimulation technique was first used in 1947 in Kansas.",
  "Horizontal drilling combined with hydraulic fracturing became commercially viable in the late 1990s.",
  "The deepest well ever drilled reached 40,318 feet. About 7.6 miles down.",
  "OSHA was created in 1970. Worker fatality records for oil and gas before that year are largely estimates.",
  "Oklahoma\'s first commercial oil well opened near Bartlesville in 1897.",
  "Texas overtook Pennsylvania as the top U.S. oil producer in 1928 and has held the title ever since.",
  "The Macondo blowout in 2010 changed BOP regulations across the industry.",

  // ---- Scale and geography ----
  "The Permian Basin spans roughly 75,000 square miles across Texas and New Mexico.",
  "The Permian Basin alone produces more oil per day than most OPEC member countries.",
  "U.S. oil and gas production today exceeds Saudi Arabia and Russia combined. Most growth came after 2010.",
  "North Dakota production went from 80,000 barrels per day in 2005 to over 1.4 million by 2014.",
  "A typical Bakken pad has 4 to 8 wells. Some have 16.",
  "The Eagle Ford in South Texas was barely producing until 2008.",
  "A modern horizontal well can drain rock that 1980s vertical wells couldn\'t reach with three boreholes side by side.",

  // ---- Equipment and physics ----
  "Flow iron at 5,000 psi carries enough stored energy to whip violently if a connection fails. That\'s why lines are anchored.",
  "Tungsten carbide chokes can erode visibly within days during sand-heavy flowback.",
  "Hammer unions are designed to handle up to 15,000 psi when properly seated and pinned.",
  "Flow iron and separator vessels can remain hot enough to burn for 30+ minutes after shut-in.",
  "A standard separator dump valve cycles 3,000+ times per day during early flowback.",
  "BOPs are pressure-tested to 1.5 times their working pressure rating before use.",
  "Static electricity from boots on a dry catwalk can generate over 20,000 volts. That exceeds the ignition energy of methane.",
  "The choke manifold on a flowback spread is the most-inspected piece of iron on location.",
  "Flare stacks are sized for worst-case gas rate, not the daily average.",

  // ---- Process science ----
  "API gravity above 10 means oil floats on water. Below 10 means it sinks. Most U.S. crude is between 30 and 45.",
  "Crude oil is a mixture of thousands of distinct hydrocarbons. Refineries separate them by boiling point.",
  "Mud weight in drilling is measured in pounds per gallon. Heavier mud holds back more formation pressure.",
  "A \"dog leg\" in directional drilling refers to a sharp angle change in the wellbore.",
  "Frac sand must have specific grain shape and crush strength to prop fractures effectively.",
  "A single hydraulic fracture stage can use enough proppant to fill a backyard swimming pool.",
  "Modern frac jobs typically have 30+ stages along the horizontal section of a single well.",
  "Modern frac pumps are commonly rated at 2,500 horsepower each. A frac job may use 16 simultaneously.",
  "Most produced water in U.S. shale plays is reinjected into disposal wells. Disposal is one of the largest cost items on a flowback AFE.",

  // ---- Hazard physics ----
  "Hydrogen sulfide is heavier than air and pools in low-lying areas. Methane is lighter than air and rises.",
  "The lower explosive limit for methane in air is 5%. Standard practice moves to stop-work at 10% of LEL on a monitor.",
  "Cold stress can be more dangerous than heat stress because symptoms develop more rapidly. Wet, windy, and 40°F is more hazardous than dry and 95°F.",
  "Produced water in shale plays can contain NORM (naturally occurring radioactive material) and benzene.",
  "Benzene has no safe lower exposure limit under current OSHA guidance.",
  "H2S at 100 ppm causes loss of smell. At 500 ppm, exposure of a few minutes can be fatal.",
  "Continuous gas monitoring is standard practice during flowback because H2S concentrations can change without warning.",

  // ---- Trivia ----
  "Frac sand mining is itself a multi-billion-dollar industry.",
  "The kelly bushing predates rotary drilling and is one of the oldest pieces of equipment still in regular use.",
  "Permitted disposal well injection volumes have been linked to induced seismicity in parts of Oklahoma.",
  "API standards 54 and 75 (onshore and offshore) reference JHA and JSA processes as part of safety management systems.",
  "Modern frac trucks can pump at over 100 barrels per minute combined.",
  "Pre-job safety meetings are required by most U.S. land operators before any flowback or workover operation begins.",
  "Permit-to-work systems became common on U.S. land operations after several major incidents in the 1990s and 2000s.",
  "The phrase \"black gold\" was first used to describe coal, not oil.",

  // ---- Practical safety reminders ----
  "Stop Work Authority gives any worker the right to stop a job if they observe an unsafe condition.",
  "The buddy system isn\'t a beginner\'s rule. It applies to anyone working in a confined space, near pressure, or alone at night.",
  "Wind direction awareness is one of the cheapest and most effective safety controls on a flowback location.",
  "Sample collection from upwind position is standard practice when H2S or hydrocarbon vapors are possible.",
  "Three points of contact is required when climbing any ladder, catwalk, or elevated platform.",
  "Hydration starts before the shift, not during. Dehydration is detectable in blood chemistry before subjective symptoms appear.",
  "If you smell hydrocarbons strongly, the LEL is already elevated. The nose detects vapor well below explosive concentrations, but not always reliably.",
  "If a JSA is identical to yesterday\'s, conditions on location may have changed even if the document didn\'t. Review before signing."
];

// Track which facts have been seen (in localStorage so it persists across sessions).
const FACTS_SEEN_KEY = "oilroot_facts_seen";

function pickRandomFact() {
  let seen = [];
  try {
    seen = JSON.parse(localStorage.getItem(FACTS_SEEN_KEY) || "[]");
  } catch {
    seen = [];
  }

  // If user has seen 80%+ of the library, reset so we can shuffle through again
  if (seen.length >= Math.floor(FACTS.length * 0.8)) {
    seen = [];
  }

  // Pick from facts not yet seen
  const unseen = FACTS.map((_, idx) => idx).filter(idx => !seen.includes(idx));
  const pool = unseen.length ? unseen : FACTS.map((_, idx) => idx);
  const pickedIdx = pool[Math.floor(Math.random() * pool.length)];

  // Record it as seen
  seen.push(pickedIdx);
  try {
    localStorage.setItem(FACTS_SEEN_KEY, JSON.stringify(seen));
  } catch {
    // localStorage failures are non-fatal; the user just sees more repeats
  }

  return FACTS[pickedIdx];
}

// ============== DOM REFS ==============
const backBtn       = document.getElementById("back-btn");
const startJsaBtn   = document.getElementById("start-jsa-btn");
const viewHome      = document.getElementById("view-home");
const viewPicker    = document.getElementById("view-picker");
const viewJsaForm   = document.getElementById("view-jsa-form");
const viewJsaDetail = document.getElementById("view-jsa-detail");
const jobGrid       = document.getElementById("job-grid");
const jsaJobTitle   = document.getElementById("jsa-job-title");

const jsaLocation   = document.getElementById("jsa-location");
const jsaDateInput  = document.getElementById("jsa-date");
const jsaTimeInput  = document.getElementById("jsa-time");
const captureGpsBtn = document.getElementById("capture-gps-btn");
const jsaGpsEl      = document.getElementById("jsa-gps");
const jsaHospital   = document.getElementById("jsa-hospital");
const jsaMusterPrimary   = document.getElementById("jsa-muster-primary");
const jsaMusterSecondary = document.getElementById("jsa-muster-secondary");
const jsaEmergencyPhone = document.getElementById("jsa-emergency-phone");
const jsaFirstAidLoc    = document.getElementById("jsa-first-aid-loc");
const jsaAedLoc         = document.getElementById("jsa-aed-loc");
const jsaWindsockLoc    = document.getElementById("jsa-windsock-loc");
const jsaHeloLz         = document.getElementById("jsa-helo-lz");

const hazardsList   = document.getElementById("hazards-list");
const controlsList  = document.getElementById("controls-list");
const ppeList       = document.getElementById("ppe-list");
const routineStepsList = document.getElementById("routine-steps-list");
const factText      = document.getElementById("fact-text");
const factShuffleBtn = document.getElementById("fact-shuffle");

const confirmStandardBtn = document.getElementById("confirm-standard-btn");
const exceptionBtn       = document.getElementById("exception-btn");
const exceptionArea      = document.getElementById("exception-area");
const exceptionText      = document.getElementById("exception-text");
const exceptionWorkaround = document.getElementById("exception-workaround");
const exceptionApprover   = document.getElementById("exception-approver");
const exceptionStopwork   = document.getElementById("exception-stopwork");

const jsaTodayDifferent = document.getElementById("jsa-today-different");
const jsaStopWork       = document.getElementById("jsa-stop-work");
const taskRoutine       = document.getElementById("task-routine");
const addTaskBtn        = document.getElementById("add-task-btn");
const customTasksEl     = document.getElementById("custom-tasks");

const submitJsaBtn  = document.getElementById("submit-jsa-btn");
const submitNote    = document.getElementById("submit-note");
const formModeLabel = document.getElementById("form-mode-label");
const formModeSub   = document.getElementById("form-mode-sub");
const revisionReasonSection = document.getElementById("revision-reason-section");
const revisionReasonInput   = document.getElementById("revision-reason");
const hospitalStatus        = document.getElementById("hospital-status");
const editJsaBtn            = document.getElementById("edit-jsa-btn");
const exportPdfBtn          = document.getElementById("export-pdf-btn");
const interviewDifferent    = document.getElementById("interview-different");
const h2sInfoPanel          = document.getElementById("h2s-info-panel");
const ppeOverrideModal      = document.getElementById("ppe-override-modal");
const ppeOverrideTitle      = document.getElementById("ppe-override-title");
const ppeOverrideReason     = document.getElementById("ppe-override-reason");
const ppeOverrideCancel     = document.getElementById("ppe-override-cancel");
const ppeOverrideConfirm    = document.getElementById("ppe-override-confirm");
const crewSignedList        = document.getElementById("crew-signed-list");
const crewNameInput         = document.getElementById("crew-name");
const crewSwaCheckbox       = document.getElementById("crew-swa");
const signaturePad          = document.getElementById("signature-pad");
const signatureClearBtn     = document.getElementById("signature-clear");
const signatureHint         = document.getElementById("signature-hint");
const addCrewBtn            = document.getElementById("add-crew-btn");

const pastJsasList   = document.getElementById("past-jsas-list");
const pastJsasCount  = document.getElementById("past-jsas-count");

const detailJobTitle = document.getElementById("detail-job-title");
const detailLocation = document.getElementById("detail-location");
const detailContent  = document.getElementById("detail-content");
const detailStatusLabel = document.getElementById("detail-status-label");

const toastEl       = document.getElementById("toast");

// ============== STATE ==============
let currentJob       = null;     // Selected job type when filling out a form
let currentTemplate  = null;     // The template object loaded for that job
let isStandardConfirmed = false; // Has the user tapped the confirm button?
let standardConfirmedAt = null;  // Timestamp when they tapped it
let exceptionFlagged = false;    // Has the user opened the exception path?

// Edit mode tracking
let editMode        = false;     // Are we editing an existing JSA?
let editingDocId    = null;      // Doc ID of the JSA being edited
let editingOriginal = null;      // Original data of the JSA being edited (for revision history)
let editingOwnerUid = null;      // UID of the JSA owner (differs from currentUser when admin edits another's)
let detailDocId     = null;      // Currently-viewed JSA in the detail view

// Interview question answers
let interviewAnswers = {
  h2s: null,           // "none" | "cond1" | "cond2" | "cond3"
  work: [],            // multi-select: "routine" | "maintenance" | "heater_treater" | "elevation_sample" | "other"
  newcrew: null,       // "yes" | "no"
  weather: [],         // multi-select including "visibility"
  different: ""        // free text
};

// PPE & controls checkbox state.
// Maps item index to {checked: bool, overrideReason: string|null}
let ppeState = {};      // {0: {checked: true, overrideReason: null}, ...}
let controlsState = {}; // same shape

// Signed crew members. Array of {name, swaAcknowledged, signatureDataUrl, signedAt}
let signedCrew = [];

// ============== VIEW NAVIGATION ==============
let viewStack = ["home"];

function navigateTo(viewName) {
  viewHome.hidden = true;
  viewPicker.hidden = true;
  viewJsaForm.hidden = true;
  viewJsaDetail.hidden = true;

  if (viewName === "home") {
    viewHome.hidden = false;
    backBtn.hidden = true;
  } else if (viewName === "picker") {
    viewPicker.hidden = false;
    backBtn.hidden = false;
  } else if (viewName === "jsa-form") {
    viewJsaForm.hidden = false;
    backBtn.hidden = false;
  } else if (viewName === "jsa-detail") {
    viewJsaDetail.hidden = false;
    backBtn.hidden = false;
  }

  if (viewStack[viewStack.length - 1] !== viewName) {
    viewStack.push(viewName);
  }

  window.scrollTo(0, 0);
}

function goBack() {
  if (viewStack.length > 1) {
    viewStack.pop();
    const prev = viewStack[viewStack.length - 1];
    viewStack.pop();
    navigateTo(prev);
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
  currentJob = job;
  currentTemplate = (job.id === "flowback") ? FLOWBACK_TEMPLATE : null;

  jsaJobTitle.textContent = job.name;

  // Fresh fact for every JSA
  if (factText) {
    factText.textContent = pickRandomFact();
  }

  // Reset edit mode (this is a fresh new JSA)
  editMode = false;
  editingDocId = null;
  editingOriginal = null;
  editingOwnerUid = null;
  revisionReasonSection.hidden = true;
  formModeLabel.textContent = "NEW JSA · STEP 2 OF 2";
  formModeSub.textContent = "Pre-job hazard analysis. Smart defaults pre-loaded. Spend your attention on what's specific to today.";
  submitJsaBtn.querySelector(".btn-label").textContent = "Submit JSA";
  submitNote.textContent = "RECORDS ARE TAMPER-EVIDENT · TIMESTAMPED ON SUBMISSION";

  resetJsaForm();

  if (currentTemplate) {
    populateStandardLists(currentTemplate);
  }

  const now = new Date();
  jsaDateInput.value = now.toISOString().slice(0, 10);
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  jsaTimeInput.value = `${hh}:${mm}`;

  navigateTo("jsa-form");

  // Initialize the signature pad now that the form is visible (canvas needs to be in DOM with measurable dimensions)
  setTimeout(initSignaturePad, 50);

  // Auto-capture GPS in the background after view transition
  setTimeout(autoCaptureGps, 500);
}

function populateControlsList() {
  if (!currentTemplate) return;
  controlsList.className = "checkbox-list with-elaborations";
  controlsList.innerHTML = "";

  // Get the active content indices for current intake answers
  const active = buildActiveContent(interviewAnswers);
  const activeControlIdxs = new Set(active.controlIdxs);

  currentTemplate.controls.forEach((c, idx) => {
    // Skip controls not relevant to today's job
    if (!activeControlIdxs.has(idx)) return;

    if (!(idx in controlsState)) {
      // Default unchecked. User must actively confirm each control applies.
      controlsState[idx] = { checked: false, overrideReason: null, expanded: false };
    }
    const tag = c.type === "eng" ? "ENGINEERING" : c.type === "admin" ? "ADMIN" : "PPE";
    const li = document.createElement("li");
    li.className = "checkbox-item expandable" + (controlsState[idx].checked ? " checked" : "");
    li.innerHTML = `
      <div class="checkbox-item-row">
        <input type="checkbox" ${controlsState[idx].checked ? "checked" : ""} />
        <button type="button" class="checkbox-item-text-btn" aria-expanded="false">
          <span class="checkbox-item-text">${escapeHtml(c.text)}<span class="hierarchy-tag">${tag}</span></span>
          <svg class="elab-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none">
            <path d="M9 18l6-6-6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>
      <div class="item-elaboration" hidden>
        <span class="elaboration-label">Why this matters</span>
        ${escapeHtml(c.elaboration || "")}
      </div>
    `;
    const cb = li.querySelector("input");
    const expandBtn = li.querySelector(".checkbox-item-text-btn");
    const elab = li.querySelector(".item-elaboration");

    cb.addEventListener("change", () => {
      controlsState[idx].checked = cb.checked;
      li.classList.toggle("checked", cb.checked);
      updateCollapseCounts();
    });

    expandBtn.addEventListener("click", () => {
      const expanded = li.classList.toggle("expanded");
      elab.hidden = !expanded;
      expandBtn.setAttribute("aria-expanded", expanded ? "true" : "false");
      if (expanded) controlsState[idx].expanded = true;  // track engagement
    });
    controlsList.appendChild(li);
  });
}

function populateStandardLists(template) {
  // Pick one random hazard to show pre-expanded as anti-complacency nudge.
  // Pick from the active set (only hazards shown today).
  const active = buildActiveContent(interviewAnswers);
  const activeHazardIdxs = new Set(active.hazardIdxs);
  const activePpeIdxs    = new Set(active.ppeIdxs);

  // Pick highlighted hazard from active set
  if (active.hazardIdxs.length > 0) {
    const randomActiveIdx = active.hazardIdxs[Math.floor(Math.random() * active.hazardIdxs.length)];
    highlightedHazardIdx = randomActiveIdx;
  } else {
    highlightedHazardIdx = null;
  }

  // Render hazards as tappable items with elaboration
  hazardsList.innerHTML = "";
  template.hazards.forEach((hazard, idx) => {
    // Skip hazards not active for today's job
    if (!activeHazardIdxs.has(idx)) return;
    const isHighlighted = idx === highlightedHazardIdx;
    const li = document.createElement("li");
    li.className = "hazard-item" + (isHighlighted ? " expanded" : "");
    li.innerHTML = `
      <button type="button" class="hazard-head" aria-expanded="${isHighlighted ? "true" : "false"}">
        <svg class="hazard-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none">
          <path d="M9 18l6-6-6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span class="hazard-text">${escapeHtml(hazard.text)}${isHighlighted ? '<span class="hazard-reminder-tag">REMINDER</span>' : ''}</span>
      </button>
      <div class="hazard-elaboration" ${isHighlighted ? "" : "hidden"}>
        <span class="elaboration-label">What can actually happen</span>
        ${escapeHtml(hazard.elaboration)}
      </div>
    `;
    const head = li.querySelector(".hazard-head");
    const elab = li.querySelector(".hazard-elaboration");
    head.addEventListener("click", () => {
      const expanded = li.classList.toggle("expanded");
      elab.hidden = !expanded;
      head.setAttribute("aria-expanded", expanded ? "true" : "false");
    });
    hazardsList.appendChild(li);
  });

  // Render controls as checkboxes (filtered to active set)
  populateControlsList();

  // Render PPE as expandable checkbox rows, filtered to active set
  ppeList.className = "checkbox-list with-elaborations";
  ppeList.innerHTML = "";
  template.ppe.forEach((p, idx) => {
    if (!activePpeIdxs.has(idx)) return;
    if (!(idx in ppeState)) {
      ppeState[idx] = { checked: false, overrideReason: null, expanded: false };
    }
    const isCore = !!p.core;
    const li = document.createElement("li");
    li.className = "checkbox-item expandable" + (isCore ? " core-required" : "") + (ppeState[idx].checked ? " checked" : "");
    li.innerHTML = `
      <div class="checkbox-item-row">
        <input type="checkbox" ${ppeState[idx].checked ? "checked" : ""} />
        <button type="button" class="checkbox-item-text-btn" aria-expanded="false">
          <span class="checkbox-item-text">${escapeHtml(p.text)}${isCore ? '<span class="core-required-tag">CORE</span>' : ''}</span>
          <svg class="elab-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none">
            <path d="M9 18l6-6-6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>
      <div class="item-elaboration" hidden>
        <span class="elaboration-label">Why this matters</span>
        ${escapeHtml(p.elaboration || "")}
      </div>
    `;
    const cb = li.querySelector("input");
    const expandBtn = li.querySelector(".checkbox-item-text-btn");
    const elab = li.querySelector(".item-elaboration");

    cb.addEventListener("change", () => {
      ppeState[idx].checked = cb.checked;
      li.classList.toggle("checked", cb.checked);
      updateCollapseCounts();
    });

    expandBtn.addEventListener("click", () => {
      const expanded = li.classList.toggle("expanded");
      elab.hidden = !expanded;
      expandBtn.setAttribute("aria-expanded", expanded ? "true" : "false");
      if (expanded) ppeState[idx].expanded = true;  // track engagement
    });

    ppeList.appendChild(li);
  });

  // Update count displays now that everything's rendered
  updateCollapseCounts();

  // ============== COMBINED LIST RENDER (v0.4 minimal form) ==============
  // The visible UI uses a single combined list of controls + PPE filtered
  // to today's active content. In the 3-acknowledgment structure this list
  // is informational only: the user reads what's covered, then acknowledges.
  // Each item is tap-to-expand for the elaboration. No individual checkboxes
  // in the visible UI; checkbox state in the audit trail comes from the
  // parent acknowledgment.
  const combinedList = document.getElementById("combined-list");
  if (combinedList) {
    combinedList.innerHTML = "";
    const activeCtl = new Set(active.controlIdxs);
    const activePpe = new Set(active.ppeIdxs);

    // Render filtered controls as informational rows
    template.controls.forEach((c, idx) => {
      if (!activeCtl.has(idx)) return;
      if (!(idx in controlsState)) {
        controlsState[idx] = { checked: false, overrideReason: null, expanded: false };
      }
      const li = document.createElement("li");
      li.className = "info-item expandable";
      li.innerHTML = `
        <button type="button" class="info-item-btn" aria-expanded="false">
          <span class="info-item-text">${escapeHtml(c.text)}<span class="hierarchy-tag">CONTROL</span></span>
          <svg class="elab-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none">
            <path d="M9 18l6-6-6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        <div class="item-elaboration" hidden>
          <span class="elaboration-label">Why this matters</span>
          ${escapeHtml(c.elaboration || "")}
        </div>
      `;
      const btn = li.querySelector(".info-item-btn");
      const elab = li.querySelector(".item-elaboration");
      btn.addEventListener("click", () => {
        const expanded = li.classList.toggle("expanded");
        elab.hidden = !expanded;
        btn.setAttribute("aria-expanded", expanded ? "true" : "false");
        if (expanded) controlsState[idx].expanded = true;
      });
      combinedList.appendChild(li);
    });

    // Render filtered PPE as informational rows
    template.ppe.forEach((p, idx) => {
      if (!activePpe.has(idx)) return;
      if (!(idx in ppeState)) {
        ppeState[idx] = { checked: false, overrideReason: null, expanded: false };
      }
      const isCore = !!p.core;
      const li = document.createElement("li");
      li.className = "info-item expandable";
      li.innerHTML = `
        <button type="button" class="info-item-btn" aria-expanded="false">
          <span class="info-item-text">${escapeHtml(p.text)}<span class="hierarchy-tag">PPE${isCore ? " · CORE" : ""}</span></span>
          <svg class="elab-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none">
            <path d="M9 18l6-6-6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        <div class="item-elaboration" hidden>
          <span class="elaboration-label">Why this matters</span>
          ${escapeHtml(p.elaboration || "")}
        </div>
      `;
      const btn = li.querySelector(".info-item-btn");
      const elab = li.querySelector(".item-elaboration");
      btn.addEventListener("click", () => {
        const expanded = li.classList.toggle("expanded");
        elab.hidden = !expanded;
        btn.setAttribute("aria-expanded", expanded ? "true" : "false");
        if (expanded) ppeState[idx].expanded = true;
      });
      combinedList.appendChild(li);
    });
  }

  // Update count labels on the acknowledgment cards
  const ackHazardsSub = document.getElementById("ack-hazards-sub");
  if (ackHazardsSub) {
    ackHazardsSub.textContent = `${active.hazardIdxs.length} hazards apply to today's work`;
  }
  const ackCtlPpeSub = document.getElementById("ack-controls-ppe-sub");
  if (ackCtlPpeSub) {
    const totalCtlPpe = active.controlIdxs.length + active.ppeIdxs.length;
    ackCtlPpeSub.textContent = `${active.controlIdxs.length} controls and ${active.ppeIdxs.length} PPE items apply`;
  }

  // Render routine steps (always visible)
  if (routineStepsList) {
    routineStepsList.innerHTML = template.routineSteps.map((step, i) => {
      const num = String(i + 1).padStart(2, "0");
      return `
        <div class="routine-step">
          <div class="routine-step-head">
            <span class="routine-step-num">STEP ${num}</span>
            <h3 class="routine-step-title">${escapeHtml(step.title)}</h3>
          </div>
          <div class="routine-step-block">
            <span class="routine-step-block-label">Hazards</span>
            <ul class="routine-step-block-list">
              ${step.hazards.map(h => `<li>${escapeHtml(h)}</li>`).join("")}
            </ul>
          </div>
          <div class="routine-step-block">
            <span class="routine-step-block-label">Controls</span>
            <ul class="routine-step-block-list">
              ${step.controls.map(c => `<li>${escapeHtml(c)}</li>`).join("")}
            </ul>
          </div>
        </div>
      `;
    }).join("");
  }
}

// Render the override reason inside the checkbox item
function renderOverrideReasonOnItem(li, reason) {
  const existing = li.querySelector(".override-reason-display");
  if (existing) existing.remove();
  if (!reason) return;
  const div = document.createElement("div");
  div.className = "override-reason-display";
  div.textContent = `Override reason: ${reason}`;
  li.appendChild(div);
}

// ============== PPE OVERRIDE MODAL ==============
let pendingOverrideIdx = null;
let pendingOverrideOnConfirm = null;

function openPpeOverrideModal(idx, itemText, onConfirm) {
  pendingOverrideIdx = idx;
  pendingOverrideOnConfirm = onConfirm;
  ppeOverrideTitle.textContent = `${itemText} is required for flowback work`;
  ppeOverrideReason.value = "";
  ppeOverrideModal.hidden = false;
  setTimeout(() => ppeOverrideReason.focus(), 50);
}

function closePpeOverrideModal() {
  ppeOverrideModal.hidden = true;
  pendingOverrideIdx = null;
  pendingOverrideOnConfirm = null;
}

if (ppeOverrideCancel) {
  ppeOverrideCancel.addEventListener("click", closePpeOverrideModal);
}

if (ppeOverrideConfirm) {
  ppeOverrideConfirm.addEventListener("click", () => {
    const reason = ppeOverrideReason.value.trim();
    if (!reason) {
      ppeOverrideReason.focus();
      return;
    }
    if (pendingOverrideIdx !== null) {
      ppeState[pendingOverrideIdx].overrideReason = reason;
    }
    if (pendingOverrideOnConfirm) {
      pendingOverrideOnConfirm();
    }
    closePpeOverrideModal();
  });
}

// ============== SIGNATURE PAD ==============
// Capture handwritten signatures on the canvas. Works for both mouse and touch.
let sigCtx = null;
let sigDrawing = false;
let sigHasInk = false;  // true if any stroke has been drawn

function initSignaturePad() {
  if (!signaturePad) return;
  // Size the canvas to its CSS width so drawing matches the visible area
  resizeSignaturePad();
  sigCtx = signaturePad.getContext("2d");
  sigCtx.strokeStyle = "#0a0a0a";
  sigCtx.lineWidth = 2;
  sigCtx.lineCap = "round";
  sigCtx.lineJoin = "round";
  sigHasInk = false;

  // Mouse events
  signaturePad.addEventListener("mousedown", sigStart);
  signaturePad.addEventListener("mousemove", sigMove);
  signaturePad.addEventListener("mouseup",   sigEnd);
  signaturePad.addEventListener("mouseleave", sigEnd);

  // Touch events
  signaturePad.addEventListener("touchstart", sigStart, { passive: false });
  signaturePad.addEventListener("touchmove",  sigMove,  { passive: false });
  signaturePad.addEventListener("touchend",   sigEnd);
  signaturePad.addEventListener("touchcancel", sigEnd);
}

function resizeSignaturePad() {
  if (!signaturePad) return;
  const rect = signaturePad.getBoundingClientRect();
  // Use a higher internal resolution for crisp lines
  const ratio = window.devicePixelRatio || 1;
  signaturePad.width  = rect.width * ratio;
  signaturePad.height = rect.height * ratio;
  if (sigCtx) {
    sigCtx.scale(ratio, ratio);
    sigCtx.strokeStyle = "#0a0a0a";
    sigCtx.lineWidth = 2;
    sigCtx.lineCap = "round";
    sigCtx.lineJoin = "round";
  }
}

function sigGetXY(e) {
  const rect = signaturePad.getBoundingClientRect();
  let clientX, clientY;
  if (e.touches && e.touches[0]) {
    clientX = e.touches[0].clientX;
    clientY = e.touches[0].clientY;
  } else {
    clientX = e.clientX;
    clientY = e.clientY;
  }
  return { x: clientX - rect.left, y: clientY - rect.top };
}

function sigStart(e) {
  e.preventDefault();
  if (!sigCtx) return;
  sigDrawing = true;
  const { x, y } = sigGetXY(e);
  sigCtx.beginPath();
  sigCtx.moveTo(x, y);
}

function sigMove(e) {
  if (!sigDrawing || !sigCtx) return;
  e.preventDefault();
  const { x, y } = sigGetXY(e);
  sigCtx.lineTo(x, y);
  sigCtx.stroke();
  sigHasInk = true;
  if (signatureHint) signatureHint.style.opacity = "0";
}

function sigEnd(e) {
  if (!sigDrawing) return;
  sigDrawing = false;
  if (sigCtx) sigCtx.closePath();
}

function sigClear() {
  if (!sigCtx || !signaturePad) return;
  sigCtx.clearRect(0, 0, signaturePad.width, signaturePad.height);
  sigHasInk = false;
  if (signatureHint) signatureHint.style.opacity = "";
}

if (signatureClearBtn) {
  signatureClearBtn.addEventListener("click", sigClear);
}

// Re-size canvas if the window resizes (rotation, etc.)
window.addEventListener("resize", () => {
  // Only re-size if the canvas is currently visible
  if (signaturePad && signaturePad.offsetParent !== null) {
    // Preserve existing ink by capturing as data URL, clearing, and redrawing
    const dataUrl = sigHasInk ? signaturePad.toDataURL() : null;
    resizeSignaturePad();
    if (dataUrl) {
      const img = new Image();
      img.onload = () => sigCtx.drawImage(img, 0, 0, signaturePad.getBoundingClientRect().width, signaturePad.getBoundingClientRect().height);
      img.src = dataUrl;
    }
  }
});

// ============== ADD CREW MEMBER ==============
if (addCrewBtn) {
  addCrewBtn.addEventListener("click", async () => {
    const name = (crewNameInput.value || "").trim();
    if (!name) {
      showToast("Enter the crew member's name", "error");
      crewNameInput.focus();
      return;
    }
    if (!crewSwaCheckbox.checked) {
      showToast("Stop Work Authority acknowledgment is required", "error");
      crewSwaCheckbox.focus();
      return;
    }
    if (!sigHasInk) {
      showToast("Signature is required", "error");
      return;
    }

    // Capture the signature as a data URL
    const signatureDataUrl = signaturePad.toDataURL("image/png");

    // Compute a SHA-256 hash of the JSA content state at signing time.
    // This binds the signature to the content as it was when signed. If
    // the JSA is modified later, the hash no longer matches the content,
    // providing tamper evidence.
    const contentHash = await computeJsaContentHash();

    signedCrew.push({
      name,
      swaAcknowledged: true,
      signatureDataUrl,
      signedAt: new Date().toISOString(),
      contentHash: contentHash
    });

    renderSignedCrew();
    resetCrewAddForm();
    showToast(`${name} added`, "success");
  });
}

// Compute SHA-256 hash of the JSA content the user is signing.
// Uses the Web Crypto API (built into all modern browsers). The hash
// includes the location, date, conditions, controls/PPE state, hazards,
// and exception details. Any change to these invalidates the hash.
async function computeJsaContentHash() {
  try {
    const contentToHash = JSON.stringify({
      location: jsaLocation.value.trim(),
      date: jsaDateInput.value,
      shiftStart: jsaTimeInput.value,
      muster: jsaMusterPrimary.value.trim() + " | " + jsaMusterSecondary.value.trim(),
      hospital: jsaHospital.value.trim(),
      conditions: interviewAnswers,
      controlsState: controlsState,
      ppeState: ppeState,
      exceptionFlagged: exceptionFlagged,
      exceptionText: exceptionFlagged ? exceptionText.value.trim() : "",
      exceptionDetails: exceptionFlagged ? {
        workaround: exceptionWorkaround?.value.trim() || "",
        approver: exceptionApprover?.value.trim() || "",
        stopWork: exceptionStopwork?.value.trim() || ""
      } : null,
      todayDifferent: jsaTodayDifferent.value.trim(),
      stopWork: jsaStopWork.value.trim(),
      templateVersion: TEMPLATE_VERSION
    });
    const encoder = new TextEncoder();
    const data = encoder.encode(contentToHash);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
  } catch (err) {
    console.warn("Hash computation failed:", err);
    return null;
  }
}

function resetCrewAddForm() {
  if (crewNameInput) crewNameInput.value = "";
  if (crewSwaCheckbox) crewSwaCheckbox.checked = false;
  sigClear();
}

function renderSignedCrew() {
  if (!crewSignedList) return;
  crewSignedList.innerHTML = "";
  signedCrew.forEach((c, idx) => {
    const item = document.createElement("div");
    item.className = "crew-signed-item";
    const timeLabel = c.signedAt ? new Date(c.signedAt).toLocaleString() : "—";
    item.innerHTML = `
      <div class="crew-signed-head">
        <span class="crew-signed-name">${escapeHtml(c.name)}</span>
        <button type="button" class="crew-signed-remove" data-idx="${idx}">Remove</button>
      </div>
      <div class="crew-signed-sig">
        <img alt="Signature of ${escapeHtml(c.name)}" src="${c.signatureDataUrl}" />
      </div>
      <div class="crew-signed-head">
        <span class="crew-signed-swa">✓ STOP WORK AUTHORITY ACKNOWLEDGED</span>
        <span class="crew-signed-time">${escapeHtml(timeLabel)}</span>
      </div>
    `;
    item.querySelector(".crew-signed-remove").addEventListener("click", () => {
      signedCrew.splice(idx, 1);
      renderSignedCrew();
    });
    crewSignedList.appendChild(item);
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;"
  }[m]));
}

// ============== COLLAPSIBLE SECTIONS (legacy, no-op when not present) ==============
function setupCollapsibles() {
  // Wire up the inline collapse buttons in §02 Confirm what applies
  const inlineCollapsibles = [
    { btnId: "ack-hazards-toggle",      targetId: "hazards-list" },
    { btnId: "ack-controls-ppe-toggle", targetId: "combined-list" },
    { btnId: "routine-steps-toggle",    targetId: "routine-steps-list" },
    { btnId: "specifics-toggle",        targetId: "specifics-area" }
  ];
  inlineCollapsibles.forEach(({ btnId, targetId }) => {
    const btn = document.getElementById(btnId);
    const target = document.getElementById(targetId);
    if (!btn || !target) return;
    if (btn.dataset.wired === "true") return;
    btn.dataset.wired = "true";
    btn.addEventListener("click", () => {
      const expanded = btn.getAttribute("aria-expanded") === "true";
      btn.setAttribute("aria-expanded", expanded ? "false" : "true");
      btn.classList.toggle("expanded", !expanded);
      target.hidden = expanded;
    });
  });

  // When acknowledgment checkboxes are toggled, cascade to underlying item state
  // so the audit trail accurately reflects what the user attested to.
  const ackHazards = document.getElementById("ack-hazards");
  if (ackHazards && ackHazards.dataset.wired !== "true") {
    ackHazards.dataset.wired = "true";
    ackHazards.addEventListener("change", () => {
      // Hazards aren't checkboxed individually; the acknowledgment IS the record.
      // We mirror state to the legacy lists for any code that still reads them.
      if (!currentTemplate) return;
      const active = buildActiveContent(interviewAnswers);
      active.hazardIdxs.forEach(idx => {
        // Hazards don't have a state object historically; treat the ack as truth
      });
    });
  }

  const ackCtlPpe = document.getElementById("ack-controls-ppe");
  if (ackCtlPpe && ackCtlPpe.dataset.wired !== "true") {
    ackCtlPpe.dataset.wired = "true";
    ackCtlPpe.addEventListener("change", () => {
      if (!currentTemplate) return;
      const active = buildActiveContent(interviewAnswers);
      const checked = ackCtlPpe.checked;
      active.controlIdxs.forEach(idx => {
        if (!controlsState[idx]) controlsState[idx] = { checked: false, overrideReason: null, expanded: false };
        controlsState[idx].checked = checked;
        // Mirror to legacy hidden list
        const legacyLi = controlsList.children[idx];
        if (legacyLi) {
          const legacyCb = legacyLi.querySelector("input[type=checkbox]");
          if (legacyCb) legacyCb.checked = checked;
        }
      });
      active.ppeIdxs.forEach(idx => {
        if (!ppeState[idx]) ppeState[idx] = { checked: false, overrideReason: null, expanded: false };
        ppeState[idx].checked = checked;
        const legacyLi = ppeList.children[idx];
        if (legacyLi) {
          const legacyCb = legacyLi.querySelector("input[type=checkbox]");
          if (legacyCb) legacyCb.checked = checked;
        }
      });
    });
  }
}

function updateCollapseCounts() {
  // Counts are rendered inline now; no-op
}

// Initialize collapsibles on page load
setupCollapsibles();

// ============== ANTI-COMPLACENCY REMINDER ==============
// Pick one random hazard to show pre-expanded each time the JSA opens.
// Different hazard each shift, even on day 90 of the same job, breaks autopilot.
let highlightedHazardIdx = null;

function pickHighlightedHazard() {
  if (!currentTemplate || !currentTemplate.hazards.length) return null;
  const idx = Math.floor(Math.random() * currentTemplate.hazards.length);
  highlightedHazardIdx = idx;
  return idx;
}

// Fact banner shuffle button
if (factShuffleBtn) {
  factShuffleBtn.addEventListener("click", () => {
    factText.textContent = pickRandomFact();
  });
}

// Interview question chip handlers (single-select and multi-select)
document.querySelectorAll(".interview-options").forEach(group => {
  const isMulti = group.classList.contains("interview-multi");
  const question = group.dataset.question;
  group.querySelectorAll(".interview-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      const value = chip.dataset.value;
      if (isMulti) {
        // Toggle the chip
        chip.classList.toggle("selected");
        // "None" is exclusive: tapping it deselects others, and tapping others deselects "None"
        if (value === "none" && chip.classList.contains("selected")) {
          group.querySelectorAll(".interview-chip").forEach(c => {
            if (c !== chip) c.classList.remove("selected");
          });
        } else if (value !== "none") {
          const noneChip = group.querySelector('[data-value="none"]');
          if (noneChip) noneChip.classList.remove("selected");
        }
        // Update state
        const selected = [...group.querySelectorAll(".interview-chip.selected")].map(c => c.dataset.value);
        interviewAnswers[question] = selected;
      } else {
        // Single select
        group.querySelectorAll(".interview-chip").forEach(c => c.classList.remove("selected"));
        chip.classList.add("selected");
        interviewAnswers[question] = value;
      }

      // H2S tier triggers info panel and re-renders content
      if (question === "h2s") {
        applyH2sTier(interviewAnswers.h2s);
      }

      // Any intake answer change re-renders the content lists to add or
      // remove items based on the new answer set
      if (currentTemplate) {
        populateStandardLists(currentTemplate);
      }
    });
  });
});

// Render the H2S info panel. The content engine handles add/remove of items.
function applyH2sTier(tierKey) {
  const tier = H2S_TIERS[tierKey];
  if (!tier) return;

  if (h2sInfoPanel) {
    if (tier.info) {
      h2sInfoPanel.hidden = false;
      h2sInfoPanel.className = "h2s-info-panel " + (tierKey === "severe" ? "cond-3" : tierKey === "danger" ? "cond-3" : tierKey === "caution" ? "cond-2" : "");
      h2sInfoPanel.innerHTML = `
        <span class="h2s-info-panel-label">${escapeHtml(tier.info.title)}</span>
        <p class="h2s-info-panel-body">${escapeHtml(tier.info.body)}</p>
      `;
    } else {
      h2sInfoPanel.hidden = true;
      h2sInfoPanel.innerHTML = "";
    }
  }
}

// Tracking var kept for backward compatibility with edit-mode restore
let tierAddedControls = [];

function refreshControlsForTier(tierKey) {
  if (!currentTemplate) return;
  const tier = H2S_TIERS[tierKey];
  if (!tier) return;

  // Remove any previously-added tier controls from controlsState
  tierAddedControls.forEach(idx => {
    delete controlsState[idx];
  });
  tierAddedControls = [];

  // Re-render the standard controls list (this resets to template defaults)
  // Then append tier-specific controls if any
  populateControlsList();

  if (tier.addControls.length > 0) {
    const startIdx = currentTemplate.controls.length;
    tier.addControls.forEach((controlText, offset) => {
      const idx = startIdx + offset;
      controlsState[idx] = { checked: false, overrideReason: null, expanded: false };
      tierAddedControls.push(idx);
      appendTierControlToList(idx, controlText, tierKey);
    });
  }
  updateCollapseCounts();
}

function appendTierControlToList(idx, controlText, tierKey) {
  const tierBadge = tierKey === "cond3" ? "H2S COND III"
                  : tierKey === "cond2" ? "H2S COND II"
                  : "H2S";
  const li = document.createElement("li");
  li.className = "checkbox-item expandable core-required";
  li.dataset.tierIdx = idx;
  li.innerHTML = `
    <div class="checkbox-item-row">
      <input type="checkbox" />
      <button type="button" class="checkbox-item-text-btn" aria-expanded="false">
        <span class="checkbox-item-text">${escapeHtml(controlText)}<span class="core-required-tag">${tierBadge}</span></span>
      </button>
    </div>
  `;
  const cb = li.querySelector("input");
  cb.addEventListener("change", () => {
    controlsState[idx].checked = cb.checked;
    li.classList.toggle("checked", cb.checked);
    updateCollapseCounts();
  });
  controlsList.appendChild(li);
}

function refreshPpeRequirementsForTier(tierKey) {
  const tier = H2S_TIERS[tierKey];
  if (!tier || !currentTemplate) return;

  // Mark tier-required PPE items as core-required so submit validation catches
  // them if unchecked. Don't auto-check, the user actively confirms each item.
  currentTemplate.ppe.forEach((p, idx) => {
    const text = typeof p === "string" ? p : (p.text || "");
    const shouldBeRequired = tier.requirePpe.includes(text);
    const li = ppeList.children[idx];
    if (!li) return;

    if (shouldBeRequired) {
      li.classList.add("core-required");
      // Ensure the badge is present and tagged for H2S tier
      if (!li.querySelector(".core-required-tag")) {
        const span = li.querySelector(".checkbox-item-text");
        if (span) {
          span.insertAdjacentHTML("beforeend", '<span class="core-required-tag">REQUIRED · H2S TIER</span>');
        }
      }
      // Mark in state so submit validation knows this is required
      if (!p.core) {
        p.core = true;  // tier escalates this to core for this JSA
      }
    }
  });
  updateCollapseCounts();
}

// Free-text interview answer
if (interviewDifferent) {
  interviewDifferent.addEventListener("input", () => {
    interviewAnswers.different = interviewDifferent.value;
  });
}

confirmStandardBtn.addEventListener("click", () => {
  isStandardConfirmed = !isStandardConfirmed;
  confirmStandardBtn.classList.toggle("confirmed", isStandardConfirmed);
  if (isStandardConfirmed) {
    standardConfirmedAt = new Date().toISOString();
    confirmStandardBtn.querySelector(".btn-confirm-label").textContent = "Confirmed for today's work";
  } else {
    standardConfirmedAt = null;
    confirmStandardBtn.querySelector(".btn-confirm-label").textContent = "I've reviewed everything above and it applies to today's work";
  }
});

exceptionBtn.addEventListener("click", () => {
  exceptionFlagged = exceptionArea.hidden;
  exceptionArea.hidden = !exceptionArea.hidden;
  exceptionBtn.textContent = exceptionArea.hidden ? "Something is different" : "Cancel exception";
});

// ============== GPS ==============
let capturedGps = null;

captureGpsBtn.addEventListener("click", () => {
  // Reset and run the multi-source auto-capture
  capturedGps = null;
  jsaGpsEl.textContent = "Capturing...";
  jsaGpsEl.classList.remove("captured");
  autoCaptureGps();
});

// Auto-capture GPS when the form opens. Uses three sources in parallel:
// 1. Browser geolocation (great on phones, often wildly off on laptops)
// 2. iplocate.io network-based lookup (better than browser fallback for cell hotspots)
// 3. Cached "last good location" from Firestore (saved by any device that previously
//    got a high-accuracy GPS fix on this user's account)
// Whichever returns the most accurate result wins. If we get a high-accuracy fix
// from the device, we save it to Firestore so other devices on this account benefit.
const IPLOCATE_API_KEY = "6186e45569220b16fb537bd3056600eb";
const HIGH_ACCURACY_THRESHOLD_M = 300;  // ~1000 ft, phone-GPS quality

// ============== FAST-PATH LOCATION LOOKUP ==============
// When the user types a location name, look up their recent JSAs at that
// location. If a recent match (within 7 days) is found, pre-fill the form
// with last shift's answers so the user can fast-confirm rather than
// re-answering everything. The user can change anything that's different.
let fastPathLookupTimer = null;
let fastPathLastQueriedLocation = "";
let fastPathActive = false;
let fastPathSourceJsaDate = null;

async function fastPathLookup(locationName) {
  if (!currentUser) return;
  const cleaned = locationName.trim();
  if (!cleaned || cleaned.length < 3) return;
  if (cleaned.toLowerCase() === fastPathLastQueriedLocation.toLowerCase()) return;
  fastPathLastQueriedLocation = cleaned;

  try {
    const sevenDaysAgo = Timestamp.fromDate(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));
    const jsasRef = collection(db, "users", currentUser.uid, "jsas");
    // Note: querying with two range filters requires a composite index in Firestore.
    // We avoid that by ordering on submittedAt and filtering client-side for location match.
    const q = query(jsasRef, orderBy("submittedAt", "desc"), limit(10));
    const snap = await getDocs(q);
    let bestMatch = null;
    snap.forEach(docSnap => {
      const d = docSnap.data();
      if (!d.location) return;
      // Case-insensitive location match
      if (d.location.trim().toLowerCase() !== cleaned.toLowerCase()) return;
      // Within 7-day window
      if (!d.submittedAt || !d.submittedAt.toMillis) return;
      if (d.submittedAt.toMillis() < sevenDaysAgo.toMillis()) return;
      if (!bestMatch || d.submittedAt.toMillis() > bestMatch.submittedAt.toMillis()) {
        bestMatch = d;
      }
    });
    if (bestMatch) {
      applyFastPath(bestMatch);
    } else {
      clearFastPathIndicator();
    }
  } catch (err) {
    console.warn("Fast-path lookup failed:", err);
  }
}

function applyFastPath(priorJsa) {
  // Pre-fill the intake answers from the prior JSA
  if (priorJsa.conditions) {
    if (priorJsa.conditions.h2s) {
      interviewAnswers.h2s = priorJsa.conditions.h2s;
      const chip = document.querySelector(`.interview-options[data-question="h2s"] .interview-chip[data-value="${priorJsa.conditions.h2s}"]`);
      if (chip) {
        document.querySelectorAll('.interview-options[data-question="h2s"] .interview-chip').forEach(c => c.classList.remove("selected"));
        chip.classList.add("selected");
      }
      applyH2sTier(priorJsa.conditions.h2s);
    }
    if (Array.isArray(priorJsa.conditions.work)) {
      interviewAnswers.work = [...priorJsa.conditions.work];
      document.querySelectorAll('.interview-options[data-question="work"] .interview-chip').forEach(c => {
        if (priorJsa.conditions.work.includes(c.dataset.value)) c.classList.add("selected");
        else c.classList.remove("selected");
      });
    }
    if (priorJsa.conditions.newCrew) {
      interviewAnswers.newcrew = priorJsa.conditions.newCrew;
      const chip = document.querySelector(`.interview-options[data-question="newcrew"] .interview-chip[data-value="${priorJsa.conditions.newCrew}"]`);
      if (chip) {
        document.querySelectorAll('.interview-options[data-question="newcrew"] .interview-chip').forEach(c => c.classList.remove("selected"));
        chip.classList.add("selected");
      }
    }
    if (Array.isArray(priorJsa.conditions.weather)) {
      interviewAnswers.weather = [...priorJsa.conditions.weather];
      document.querySelectorAll('.interview-options[data-question="weather"] .interview-chip').forEach(c => {
        if (priorJsa.conditions.weather.includes(c.dataset.value)) c.classList.add("selected");
        else c.classList.remove("selected");
      });
    }
  }

  // Pre-fill other useful fields the user might want to keep
  if (priorJsa.musterPrimary && !jsaMusterPrimary.value.trim()) {
    jsaMusterPrimary.value = priorJsa.musterPrimary;
  }
  if (priorJsa.musterSecondary && !jsaMusterSecondary.value.trim()) {
    jsaMusterSecondary.value = priorJsa.musterSecondary;
  }
  if (priorJsa.emergencyInfo) {
    if (jsaEmergencyPhone && priorJsa.emergencyInfo.contactNumbers && !jsaEmergencyPhone.value.trim()) {
      jsaEmergencyPhone.value = priorJsa.emergencyInfo.contactNumbers;
    }
    if (jsaFirstAidLoc && priorJsa.emergencyInfo.firstAidLocation && !jsaFirstAidLoc.value.trim()) {
      jsaFirstAidLoc.value = priorJsa.emergencyInfo.firstAidLocation;
    }
    if (jsaAedLoc && priorJsa.emergencyInfo.aedLocation && !jsaAedLoc.value.trim()) {
      jsaAedLoc.value = priorJsa.emergencyInfo.aedLocation;
    }
    if (jsaWindsockLoc && priorJsa.emergencyInfo.windsockLocation && !jsaWindsockLoc.value.trim()) {
      jsaWindsockLoc.value = priorJsa.emergencyInfo.windsockLocation;
    }
    if (jsaHeloLz && priorJsa.emergencyInfo.helicopterLz && !jsaHeloLz.value.trim()) {
      jsaHeloLz.value = priorJsa.emergencyInfo.helicopterLz;
    }
  }

  // Re-render content lists with the pre-filled answers
  if (currentTemplate) {
    populateStandardLists(currentTemplate);
  }

  // Show the pre-fill indicator
  fastPathActive = true;
  fastPathSourceJsaDate = priorJsa.submittedAt && priorJsa.submittedAt.toDate
    ? priorJsa.submittedAt.toDate()
    : null;
  const indicator = document.getElementById("prefill-indicator");
  const detail = document.getElementById("prefill-detail");
  if (indicator && detail) {
    indicator.hidden = false;
    detail.textContent = fastPathSourceJsaDate
      ? `Today's conditions and crew info pre-filled from your JSA on ${fastPathSourceJsaDate.toLocaleDateString()}. Tap any chip to change.`
      : "Today's conditions pre-filled from your last shift. Tap any chip to change.";
  }
}

function clearFastPathIndicator() {
  fastPathActive = false;
  fastPathSourceJsaDate = null;
  const indicator = document.getElementById("prefill-indicator");
  if (indicator) indicator.hidden = true;
}

// Wire up the location field to trigger fast-path lookup on blur/debounced input
if (jsaLocation) {
  jsaLocation.addEventListener("blur", () => {
    fastPathLookup(jsaLocation.value);
  });
  jsaLocation.addEventListener("input", () => {
    clearTimeout(fastPathLookupTimer);
    fastPathLookupTimer = setTimeout(() => {
      fastPathLookup(jsaLocation.value);
    }, 800);
  });
}

function autoCaptureGps() {
  if (capturedGps) return; // Already captured (e.g. in edit mode)

  captureGpsBtn.disabled = true;
  captureGpsBtn.textContent = "Capturing...";

  // Fire all three location sources in parallel
  const browserPromise = getBrowserLocation();
  const iplocatePromise = getIplocateLocation();
  const cachedPromise = getCachedLocation();

  Promise.allSettled([browserPromise, iplocatePromise, cachedPromise]).then(results => {
    const [browserR, iplocateR, cachedR] = results;

    // Collect successful results with their source
    const candidates = [];
    if (browserR.status === "fulfilled" && browserR.value) {
      candidates.push({ ...browserR.value, source: "browser" });
    }
    if (iplocateR.status === "fulfilled" && iplocateR.value) {
      candidates.push({ ...iplocateR.value, source: "iplocate" });
    }
    if (cachedR.status === "fulfilled" && cachedR.value) {
      candidates.push({ ...cachedR.value, source: "cached" });
    }

    if (!candidates.length) {
      captureGpsBtn.textContent = "Capture GPS";
      captureGpsBtn.disabled = false;
      return;
    }

    // If the browser fix is high-accuracy (real GPS), it wins outright.
    // Save it to Firestore so other devices on this account can use it later.
    const browserFix = candidates.find(c => c.source === "browser");
    if (browserFix && browserFix.accuracy <= HIGH_ACCURACY_THRESHOLD_M) {
      applyLocation(browserFix);
      saveLocationToCache(browserFix);
      return;
    }

    // No high-accuracy device fix. Prefer cached (real prior GPS) over network
    // estimates (iplocate or browser-IP-fallback), since the cached value came
    // from an actual GPS chip at some point.
    const cached = candidates.find(c => c.source === "cached");
    if (cached) {
      applyLocation(cached);
      return;
    }

    // No high-accuracy fix and no cache. Fall back to whichever wide source
    // returned the smallest accuracy radius.
    candidates.sort((a, b) => (a.accuracy || Infinity) - (b.accuracy || Infinity));
    applyLocation(candidates[0]);
  });
}

// Apply a location result to the form
function applyLocation(loc) {
  capturedGps = {
    lat: loc.lat,
    lng: loc.lng,
    accuracy: loc.accuracy,
    source: loc.source,
    capturedAt: new Date().toISOString()
  };
  jsaGpsEl.textContent = `${loc.lat.toFixed(5)}°, ${loc.lng.toFixed(5)}° ${formatAccuracy(loc.accuracy, loc.source)}`;
  jsaGpsEl.classList.add("captured");
  captureGpsBtn.textContent = "Recapture";
  captureGpsBtn.disabled = false;
  lookupNearestHospital(loc.lat, loc.lng);
}

// Save a high-accuracy location to Firestore so other devices on this account
// can use it as a fallback when they can't get a good fix locally.
async function saveLocationToCache(loc) {
  if (!currentUser) return;
  try {
    const ref = doc(db, "users", currentUser.uid);
    await setDoc(ref, {
      lastGoodLocation: {
        lat: loc.lat,
        lng: loc.lng,
        accuracy: loc.accuracy,
        capturedAt: serverTimestamp()
      }
    }, { merge: true });
  } catch (err) {
    // Non-fatal; the user just doesn't get cross-device sync this time
    console.warn("Could not cache location:", err);
  }
}

// Read the cached "last good location" from Firestore. Returns {lat, lng, accuracy}
// or null if there's no cached location or the user isn't signed in.
async function getCachedLocation() {
  if (!currentUser) return null;
  try {
    const ref = doc(db, "users", currentUser.uid);
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    const data = snap.data();
    if (!data.lastGoodLocation) return null;
    const cached = data.lastGoodLocation;
    if (typeof cached.lat !== "number" || typeof cached.lng !== "number") return null;
    return {
      lat: cached.lat,
      lng: cached.lng,
      accuracy: cached.accuracy || HIGH_ACCURACY_THRESHOLD_M
    };
  } catch (err) {
    console.warn("Could not read cached location:", err);
    return null;
  }
}

// Browser geolocation as a Promise. Uses watchPosition (not getCurrentPosition)
// so the browser has a chance to refine the fix over time. Returns the best
// (smallest accuracy radius) fix it sees within the watch window.
//
// Why this matters: getCurrentPosition often returns a fast, low-accuracy
// WiFi/IP estimate and stops. watchPosition keeps firing as the browser
// refines its fix from satellite, WiFi, cell, etc. KPA does it this way.
function getBrowserLocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null);
      return;
    }

    let bestFix = null;
    let watchId = null;
    let resolved = false;

    const finish = () => {
      if (resolved) return;
      resolved = true;
      if (watchId !== null) {
        try { navigator.geolocation.clearWatch(watchId); } catch {}
      }
      resolve(bestFix);
    };

    const onSuccess = (pos) => {
      const fix = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy
      };
      // Keep the smallest accuracy radius we've seen
      if (!bestFix || fix.accuracy < bestFix.accuracy) {
        bestFix = fix;
      }
      // If we got a high-accuracy fix, no need to keep watching
      if (fix.accuracy <= HIGH_ACCURACY_THRESHOLD_M) {
        finish();
      }
    };

    const onError = () => {
      // Don't resolve immediately on a single error; the watch may still produce a fix
      // The overall timeout below handles the case where nothing comes in
    };

    try {
      watchId = navigator.geolocation.watchPosition(onSuccess, onError, {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0
      });
    } catch {
      resolve(null);
      return;
    }

    // Hard cap: stop watching after 12 seconds and return whatever's best so far
    setTimeout(finish, 12000);
  });
}

// iplocate.io network-based location. Resolves with {lat, lng, accuracy} or null.
// Free tier allows commercial use; 1,000 lookups/day.
async function getIplocateLocation() {
  try {
    const resp = await fetch(`https://iplocate.io/api/lookup/?apikey=${IPLOCATE_API_KEY}`, {
      signal: AbortSignal.timeout(8000)
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (typeof data.latitude !== "number" || typeof data.longitude !== "number") return null;
    // iplocate doesn't return an accuracy radius. Network/IP-based lookups are
    // typically accurate to city level; estimate 5 mi (~8000 m) as a baseline.
    return {
      lat: data.latitude,
      lng: data.longitude,
      accuracy: 8000
    };
  } catch {
    return null;
  }
}

// Format GPS accuracy for display. Uses feet for tight fixes, miles for wide.
// Adds a source label so the user knows where the location came from.
function formatAccuracy(accuracyMeters, source) {
  if (!accuracyMeters || accuracyMeters <= 0) return "";
  const accFt = accuracyMeters * 3.281;
  const accMi = accuracyMeters * 0.000621371;
  let sourceLabel = "";
  if (source === "iplocate") sourceLabel = " · network estimate";
  else if (source === "cached") sourceLabel = " · last known good";
  else if (accMi >= 0.5) sourceLabel = " · WiFi/IP estimate";
  if (accMi >= 0.5) {
    return `(±${accMi.toFixed(1)} mi${sourceLabel})`;
  }
  return `(±${Math.round(accFt)} ft${sourceLabel})`;
}

// Tracks whether the hospital field was auto-set by our lookup (true) or
// typed/edited by the user (false). When location improves later, we only
// overwrite an auto-set value, never a user-edited one.
let hospitalAutoSet = false;

if (jsaHospital) {
  jsaHospital.addEventListener("input", () => {
    hospitalAutoSet = false;
  });
}

// Look up nearest hospital from GPS coordinates using OpenStreetMap Overpass API.
// Free, no API key. Tiered behavior based on GPS accuracy:
//   - High accuracy (under 1000 ft): trust the fix, search small radius first
//   - Medium accuracy (1000 ft - 10 mi): warn user, search wider radius
//   - Low accuracy (over 10 mi): too unreliable to suggest, just offer search
async function lookupNearestHospital(lat, lng) {
  // Don't overwrite if user has typed/edited something. Auto-set values are
  // safe to overwrite (e.g. when location refines to a better fix).
  if (jsaHospital.value.trim() && !hospitalAutoSet) return;

  const accuracyMeters = capturedGps?.accuracy || 0;
  const accuracyMiles = accuracyMeters * 0.000621371;

  // If accuracy is over 10 miles, the fix is so wide that auto-suggesting
  // a specific hospital would be misleading. Just hint that they can type.
  if (accuracyMiles > 10) {
    hospitalStatus.hidden = false;
    hospitalStatus.textContent = `GPS too imprecise for auto-suggest (±${accuracyMiles.toFixed(0)} mi). Type your hospital.`;
    return;
  }

  hospitalStatus.hidden = false;
  hospitalStatus.textContent = "Finding nearest hospital...";

  // Pick search radius based on how confident we are in the location
  let searchRadiusMeters;
  if (accuracyMiles <= 0.2) {
    searchRadiusMeters = 16000;  // ~10 mi for accurate fixes
  } else if (accuracyMiles <= 2) {
    searchRadiusMeters = 32000;  // ~20 mi for medium accuracy
  } else {
    searchRadiusMeters = 80000;  // ~50 mi for low accuracy
  }

  try {
    let result = await queryOverpassForHospital(lat, lng, searchRadiusMeters);
    // If nothing found in initial search, try a wider radius
    if (!result && searchRadiusMeters < 80000) {
      result = await queryOverpassForHospital(lat, lng, 80000);
    }

    if (!result) {
      hospitalStatus.textContent = "No hospital found nearby. Type one in.";
      return;
    }

    // Don't overwrite if user typed something while we were waiting (and it
    // wasn't us that auto-set it)
    if (jsaHospital.value.trim() && !hospitalAutoSet) {
      hospitalStatus.hidden = true;
      return;
    }

    // Only show distance if GPS accuracy is good enough for it to be meaningful
    // AND the GPS source is a real-time device fix. Cached locations and network
    // estimates can have tight reported accuracy but be wildly wrong because
    // they reference a different location than where the user is now.
    const gpsSource = capturedGps?.source || "browser";
    const isRealTimeFix = gpsSource === "browser";
    const showDistance = accuracyMiles <= 0.5 && isRealTimeFix;
    if (showDistance) {
      jsaHospital.value = result.display;
    } else {
      jsaHospital.value = result.name;
    }
    hospitalAutoSet = true;  // Mark as auto-set so future location updates can overwrite

    // Calibrate the message to GPS confidence
    if (showDistance && accuracyMiles <= 0.2) {
      hospitalStatus.textContent = `Auto-suggested · ${result.distanceMi.toFixed(1)} mi away. Edit if wrong.`;
    } else if (showDistance) {
      hospitalStatus.textContent = `Auto-suggested. Verify distance and route.`;
    } else if (gpsSource === "cached") {
      hospitalStatus.textContent = `Best guess based on last known location. Verify hospital before relying on it.`;
    } else if (gpsSource === "iplocate") {
      hospitalStatus.textContent = `Best guess based on network location. Verify hospital before relying on it.`;
    } else {
      hospitalStatus.textContent = `Best guess based on imprecise location. Verify hospital and distance.`;
    }
  } catch (err) {
    console.warn("Hospital lookup failed:", err);
    hospitalStatus.textContent = "Hospital lookup unavailable. Type one in.";
  }
}

async function queryOverpassForHospital(lat, lng, radiusMeters) {
  // Goal: find a full-service hospital with an emergency department that can
  // handle trauma. The OSM tagging landscape is messy:
  //   - `amenity=hospital` alone is unreliable (eye clinics, dentists,
  //     even miscategorized non-medical buildings)
  //   - `healthcare=hospital` filters out clinics but still includes
  //     psychiatric, rehabilitation, and hospice facilities
  //   - `emergency=yes` is the strongest signal for trauma response
  //
  // Strategy: three-tier search.
  //   Tier 1 (strict): emergency=yes AND healthcare=hospital. Best match.
  //   Tier 2 (medium): emergency=yes only. Common in rural areas with
  //     incomplete tagging where the ED is documented but the broader
  //     facility classification isn't.
  //   Tier 3 (loose): healthcare=hospital only. Last resort when no
  //     emergency tag exists at all.
  //
  // All tiers exclude psychiatric, rehab, hospice, and behavioral health
  // facilities by both tag and name filter.

  const overpassQuery = `
    [out:json][timeout:10];
    (
      node["amenity"="hospital"]["emergency"="yes"]["healthcare"="hospital"](around:${radiusMeters},${lat},${lng});
      way["amenity"="hospital"]["emergency"="yes"]["healthcare"="hospital"](around:${radiusMeters},${lat},${lng});
      node["amenity"="hospital"]["emergency"="yes"](around:${radiusMeters},${lat},${lng});
      way["amenity"="hospital"]["emergency"="yes"](around:${radiusMeters},${lat},${lng});
      node["amenity"="hospital"]["healthcare"="hospital"](around:${radiusMeters},${lat},${lng});
      way["amenity"="hospital"]["healthcare"="hospital"](around:${radiusMeters},${lat},${lng});
      node["amenity"="hospital"](around:${radiusMeters},${lat},${lng});
      way["amenity"="hospital"](around:${radiusMeters},${lat},${lng});
    );
    out center 50;
  `;
  const url = "https://overpass-api.de/api/interpreter";
  const resp = await fetch(url, {
    method: "POST",
    body: "data=" + encodeURIComponent(overpassQuery)
  });
  if (!resp.ok) throw new Error("Overpass API error: " + resp.status);
  const data = await resp.json();
  if (!data.elements || data.elements.length === 0) return null;

  // Even within tagged hospitals, exclude obvious specialty/non-emergency
  // facilities by name keywords and by explicit OSM tag filters.
  const SPECIALTY_KEYWORDS = [
    // Mental health and behavioral
    "psychiatric", "psychiatry", "behavioral", "behavioural", "mental health",
    "mental hospital", "psych ", "psych hospital",
    // Rehabilitation and long-term care
    "rehabilitation", "rehab center", "rehab hospital", "skilled nursing",
    "long-term care", "long term care", "nursing home",
    "hospice", "palliative",
    // Specialty clinics that get miscategorized as hospitals
    "eye", "vision", "ophthalm", "dental", "orthodont",
    "dermatolog", "fertility", "ivf",
    "surgery center", "surgical center", "outpatient surgery",
    "urgent care", "minute clinic", "walk-in",
    // Veterinary and non-medical
    "veterinary", "animal", "pet clinic", "vet hospital",
    // Single-specialty
    "cancer center", "oncology center only", "cardiac care only",
    "physical therapy", "chiropractic", "wellness center",
    "detox", "addiction", "recovery center", "treatment center",
    // Non-medical contamination of OSM tags
    "chevrolet", "ford", "toyota", "dealership", "auto"
  ];

  function looksLikeSpecialty(name, tags) {
    const lower = (name || "").toLowerCase();
    if (SPECIALTY_KEYWORDS.some(kw => lower.includes(kw))) return true;
    // OSM speciality tags that disqualify a facility for trauma response
    const speciality = tags?.["healthcare:speciality"] || tags?.["healthcare:specialty"] || "";
    const specLower = speciality.toLowerCase();
    if (specLower.includes("psychiatry") || specLower.includes("psychiatric")) return true;
    if (specLower.includes("rehabilitation")) return true;
    if (specLower.includes("hospice") || specLower.includes("palliative")) return true;
    if (specLower.includes("addiction")) return true;
    if (specLower.includes("dermatology")) return true;
    if (specLower.includes("ophthalmology")) return true;
    if (specLower.includes("dental")) return true;
    if (specLower.includes("vision")) return true;
    if (specLower.includes("oncology") && !specLower.includes("general")) return true;
    // Healthcare type filters (non-hospital tagged buildings)
    if (tags?.healthcare === "clinic") return true;
    if (tags?.healthcare === "doctor") return true;
    if (tags?.healthcare === "dentist") return true;
    if (tags?.healthcare === "psychotherapist") return true;
    if (tags?.healthcare === "rehabilitation") return true;
    if (tags?.healthcare === "alternative") return true;
    if (tags?.amenity === "clinic") return true;
    return false;
  }

  // All results passed the tag filter. Now build distance-sorted list.
  const candidates = [];
  const seen = new Set();

  data.elements.forEach(el => {
    const elLat = el.lat ?? el.center?.lat;
    const elLng = el.lon ?? el.center?.lon;
    if (elLat == null || elLng == null) return;
    const name = el.tags?.name;
    if (!name) return;
    const id = `${el.type}-${el.id}`;
    if (seen.has(id)) return;
    seen.add(id);

    if (looksLikeSpecialty(name, el.tags)) return;

    candidates.push({
      name,
      tags: el.tags || {},
      distanceMi: haversineKm(lat, lng, elLat, elLng) * 0.621371
    });
  });

  if (!candidates.length) return null;

  // Score each candidate by how strong its trauma-hospital signal is.
  // Lower score = stronger match. Tie-break by distance.
  candidates.forEach(c => {
    let score = 100;
    const hasEmergency = c.tags?.emergency === "yes";
    const isHealthcareHospital = c.tags?.healthcare === "hospital";
    if (hasEmergency && isHealthcareHospital) {
      score = 0;   // Best: explicit ER + hospital classification
    } else if (hasEmergency) {
      score = 10;  // Has ER tag, classification unclear
    } else if (isHealthcareHospital) {
      score = 20;  // Hospital classification, ER not explicitly tagged
    } else {
      score = 30;  // Plain amenity=hospital, no qualifiers (rural OSM)
    }
    // Boost (lower) score if name contains strong positive indicators
    const lower = (c.name || "").toLowerCase();
    if (lower.includes("trauma center")) score -= 5;
    if (lower.includes("level i") || lower.includes("level 1")) score -= 3;
    if (lower.includes("regional medical")) score -= 3;
    if (lower.includes("medical center") || lower.includes("regional health")) score -= 2;
    if (lower.includes("health center") && !lower.includes("mental")) score -= 1;
    // Penalize names that suggest single-specialty or non-trauma
    if (lower.includes("children's") || lower.includes("childrens") || lower.includes("pediatric")) {
      score += 5;
    }
    c.score = score;
  });

  candidates.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    return a.distanceMi - b.distanceMi;
  });
  const closest = candidates[0];

  const erSuffix = closest.tags?.emergency === "yes" ? " · ER confirmed" : "";

  return {
    display: `${closest.name} (~${closest.distanceMi.toFixed(1)} mi)${erSuffix}`,
    name: `${closest.name}${erSuffix}`,
    distanceMi: closest.distanceMi
  };
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const toRad = (d) => d * Math.PI / 180;
  const R = 6371; // km
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

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
      <input type="text" class="field custom-task-desc" placeholder="e.g., Swap out worn choke insert" />
    </label>
    <label class="field-group">
      <span class="spec-label">Specific hazards for this task</span>
      <textarea class="field textarea custom-task-hazards" rows="2" placeholder="What could go wrong specifically with this task?"></textarea>
    </label>
    <label class="field-group">
      <span class="spec-label">Controls for this task</span>
      <textarea class="field textarea custom-task-controls" rows="2" placeholder="LOTO, depressurize, two-person verification, etc."></textarea>
    </label>
  `;
  taskEl.querySelector("[data-action=remove]").addEventListener("click", () => {
    taskEl.remove();
  });
  customTasksEl.appendChild(taskEl);
});

function gatherCustomTasks() {
  const tasks = [];
  customTasksEl.querySelectorAll(".custom-task").forEach(el => {
    const desc     = el.querySelector(".custom-task-desc").value.trim();
    const hazards  = el.querySelector(".custom-task-hazards").value.trim();
    const controls = el.querySelector(".custom-task-controls").value.trim();
    if (desc || hazards || controls) {
      tasks.push({ description: desc, hazards, controls });
    }
  });
  return tasks;
}

// ============== SUBMIT (handles both create and revise) ==============
submitJsaBtn.addEventListener("click", async () => {
  if (!currentUser) {
    showToast("You must be signed in to submit a JSA", "error");
    return;
  }

  // Validate required fields
  const location = jsaLocation.value.trim();
  if (!location) {
    showToast("Location / pad / well name is required", "error");
    jsaLocation.focus();
    return;
  }
  const musterPrimary = jsaMusterPrimary.value.trim();
  if (!musterPrimary) {
    showToast("Primary muster point is required", "error");
    jsaMusterPrimary.focus();
    return;
  }
  const musterSecondary = jsaMusterSecondary.value.trim();
  if (!musterSecondary) {
    showToast("Secondary muster point is required", "error");
    jsaMusterSecondary.focus();
    return;
  }
  if (!interviewAnswers.h2s) {
    showToast("Answer the H2S question in Today's conditions", "error");
    document.getElementById("conditions-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  if (!Array.isArray(interviewAnswers.work) || interviewAnswers.work.length === 0) {
    showToast("Answer the 'what work today' question in Today's conditions", "error");
    document.getElementById("conditions-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  if (!interviewAnswers.newcrew) {
    showToast("Answer the new crew question in Today's conditions", "error");
    document.getElementById("conditions-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  if (!Array.isArray(interviewAnswers.weather) || interviewAnswers.weather.length === 0) {
    showToast("Answer the weather question in Today's conditions", "error");
    document.getElementById("conditions-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  // All three acknowledgments must be checked before submitting
  const ackHazards    = document.getElementById("ack-hazards");
  const ackCtlPpe     = document.getElementById("ack-controls-ppe");
  const routineCheck  = document.getElementById("task-routine");

  if (ackHazards && !ackHazards.checked) {
    showToast("Acknowledge hazards reviewed before submitting", "error");
    ackHazards.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  if (ackCtlPpe && !ackCtlPpe.checked) {
    showToast("Acknowledge controls and PPE in place before submitting", "error");
    ackCtlPpe.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  if (routineCheck && !routineCheck.checked) {
    showToast("Acknowledge the standard task breakdown before submitting", "error");
    routineCheck.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }

  if (exceptionFlagged) {
    if (!exceptionText.value.trim()) {
      showToast("Describe what's different from standard", "error");
      exceptionText.focus();
      return;
    }
    if (!exceptionWorkaround.value.trim()) {
      showToast("Describe the workaround in place", "error");
      exceptionWorkaround.focus();
      return;
    }
    if (!exceptionApprover.value.trim()) {
      showToast("Who approved the workaround?", "error");
      exceptionApprover.focus();
      return;
    }
    if (!exceptionStopwork.value.trim()) {
      showToast("Stop work threshold for this exception is required", "error");
      exceptionStopwork.focus();
      return;
    }
  }

  if (signedCrew.length === 0) {
    showToast("At least one crew member must sign the JSA before submitting", "error");
    return;
  }

  // Edit-mode requires a revision reason
  if (editMode) {
    const reason = revisionReasonInput.value.trim();
    if (!reason) {
      showToast("Revision reason is required", "error");
      revisionReasonInput.focus();
      return;
    }
    await saveRevision(reason);
    return;
  }

  // New JSA: build a fresh record
  const record = buildJsaRecord({ location });

  submitJsaBtn.disabled = true;
  submitJsaBtn.querySelector(".btn-label").textContent = "Submitting...";

  try {
    const colRef = collection(db, "users", currentUser.uid, "jsas");
    const docRef = await addDoc(colRef, record);
    showToast("JSA submitted and saved", "success");
    resetJsaForm();
    navigateTo("home");
    await loadPastJsas();
  } catch (err) {
    console.error("JSA submit error:", err);
    showToast("Could not save JSA: " + (err.message || "unknown error"), "error");
  } finally {
    submitJsaBtn.disabled = false;
    submitJsaBtn.querySelector(".btn-label").textContent = "Submit JSA";
  }
});

// Save a revision to an existing JSA. Original record is updated with the new
// field values, and a snapshot of the prior state is appended to the
// `revisions` array. Nothing is overwritten without a preserved copy.
async function saveRevision(reason) {
  submitJsaBtn.disabled = true;
  submitJsaBtn.querySelector(".btn-label").textContent = "Saving revision...";

  try {
    // Build the new field values from the form
    const newValues = buildJsaRecord({ location: jsaLocation.value.trim() });

    // Strip the fields we don't want to overwrite (audit trail stays put)
    delete newValues.createdAt;     // Original creation time stays
    delete newValues.submittedAt;   // Original submission time stays
    delete newValues.revisionCount; // We'll set explicitly below

    // Build the snapshot of the prior state to append to revisions[]
    const priorSnapshot = snapshotPriorState(editingOriginal);

    // The revision record itself
    const revision = {
      revisedAt:        Timestamp.now(),
      revisedByUid:     currentUser.uid,
      revisedByEmail:   currentUser.email,
      revisedByName:    currentUser.displayName || "",
      reason:           reason,
      priorState:       priorSnapshot
    };

    const newRevisionCount = (editingOriginal.revisionCount || 0) + 1;

    // Use the editing owner's UID, which differs from currentUser if admin is
    // editing another user's JSA. Admin edits get tagged for the audit trail.
    const targetUid = editingOwnerUid || currentUser.uid;
    const isAdminEdit = isCurrentUserAdmin && targetUid !== currentUser.uid;

    const docRef = doc(db, "users", targetUid, "jsas", editingDocId);
    const updatePayload = {
      ...newValues,
      revisionCount: newRevisionCount,
      revisions: arrayUnion(revision)
    };

    // Tag admin edits per Firestore rules requirement
    if (isAdminEdit) {
      updatePayload.editedByAdmin = true;
      updatePayload.editedByAdminUid = currentUser.uid;
      updatePayload.editedByAdminAt = serverTimestamp();
    }

    await updateDoc(docRef, updatePayload);

    showToast(isAdminEdit ? "Admin revision saved · audit trail updated" : "Revision saved · audit trail updated", "success");
    resetJsaForm();
    // Reload detail view with the updated data
    await openJsaDetail(editingDocId, isAdminEdit ? targetUid : null);
    await loadPastJsas();
  } catch (err) {
    console.error("Revision save error:", err);
    showToast("Could not save revision: " + (err.message || "unknown error"), "error");
  } finally {
    submitJsaBtn.disabled = false;
    submitJsaBtn.querySelector(".btn-label").textContent = "Save revision";
  }
}

// Capture the prior state of a JSA so it's preserved when a revision is saved.
// We store the field values that could have changed; the immutable audit
// trail (creation time, submitter identity) doesn't need to be duplicated.
function snapshotPriorState(data) {
  return {
    location:         data.location,
    date:             data.date,
    shiftStart:       data.shiftStart,
    gps:              data.gps,
    nearestHospital:  data.nearestHospital,
    musterPrimary:    data.musterPrimary,
    musterSecondary:  data.musterSecondary,
    standardConfirmed:    data.standardConfirmed,
    standardConfirmedAt:  data.standardConfirmedAt,
    exceptionFlagged:     data.exceptionFlagged,
    exceptionText:        data.exceptionText,
    exceptionDetails:     data.exceptionDetails || null,
    emergencyInfo:        data.emergencyInfo || null,
    conditions:           data.conditions || null,
    controlsState:        data.controlsState || null,
    ppeState:             data.ppeState || null,
    todayDifferent:       data.todayDifferent,
    stopWork:             data.stopWork,
    routineTaskAcknowledged: data.routineTaskAcknowledged,
    customTasks:          data.customTasks,
    signedCrew:           data.signedCrew || []
  };
}

function buildJsaRecord({ location }) {
  // Snapshot the template content as it is at submission time. This is the
  // legal record. Even if the template is updated later, this JSA shows the
  // hazards/controls/PPE the user actually saw and acknowledged.
  // Capture tier-added controls (from H2S Condition II/III) along with the
  // standard template controls so the detail view and PDF can render them.
  const tierKey = interviewAnswers.h2s;
  const tier = tierKey && H2S_TIERS[tierKey];
  const tierControls = (tier && tier.addControls.length)
    ? tier.addControls.map(text => ({ text, type: "admin", tierAdded: tierKey }))
    : [];
  const combinedControls = currentTemplate
    ? [...currentTemplate.controls, ...tierControls]
    : [];

  const templateSnapshot = currentTemplate ? {
    hazards:  currentTemplate.hazards,
    controls: combinedControls,
    ppe:      currentTemplate.ppe,
    routineSteps: currentTemplate.routineSteps,
    tierAddedControlsCount: tierControls.length
  } : null;

  // When admin edits another user's JSA, preserve the original owner's identity
  // on the record. The audit trail captures who actually performed the edit via
  // editedByAdmin flag set in the save logic.
  const isAdminEditingOther = isCurrentUserAdmin && editMode && editingOwnerUid && editingOwnerUid !== currentUser.uid;
  const identityUid = isAdminEditingOther ? (editingOriginal?.userId || editingOwnerUid) : currentUser.uid;
  const identityEmail = isAdminEditingOther ? (editingOriginal?.userEmail || "") : currentUser.email;
  const identityName = isAdminEditingOther ? (editingOriginal?.userDisplayName || "") : (currentUser.displayName || "");

  return {
    // Identity (preserved for admin edits of other users' JSAs)
    userId:        identityUid,
    userEmail:     identityEmail,
    userDisplayName: identityName,

    // Job info
    jobTypeId:     currentJob.id,
    jobTypeName:   currentJob.name,
    templateVersion: TEMPLATE_VERSION,

    // Job site
    location:      location,
    date:          jsaDateInput.value || null,
    shiftStart:    jsaTimeInput.value || null,
    gps:           capturedGps,
    nearestHospital: jsaHospital.value.trim(),
    musterPrimary:   jsaMusterPrimary.value.trim(),
    musterSecondary: jsaMusterSecondary.value.trim(),

    // Emergency information (optional)
    emergencyInfo: {
      contactNumbers: jsaEmergencyPhone ? jsaEmergencyPhone.value.trim() : "",
      firstAidLocation: jsaFirstAidLoc ? jsaFirstAidLoc.value.trim() : "",
      aedLocation: jsaAedLoc ? jsaAedLoc.value.trim() : "",
      windsockLocation: jsaWindsockLoc ? jsaWindsockLoc.value.trim() : "",
      helicopterLz: jsaHeloLz ? jsaHeloLz.value.trim() : ""
    },

    // Standard items
    // standardConfirmed is true when ALL 3 acknowledgments are checked, which
    // is the new v0.4.0 condition for a submittable JSA.
    standardConfirmed:   (
      document.getElementById("ack-hazards")?.checked === true &&
      document.getElementById("ack-controls-ppe")?.checked === true &&
      document.getElementById("task-routine")?.checked === true
    ),
    // Granular per-acknowledgment record for audit
    acknowledgments: {
      hazardsReviewed:           document.getElementById("ack-hazards")?.checked === true,
      controlsAndPpeInPlace:     document.getElementById("ack-controls-ppe")?.checked === true,
      taskBreakdownAcknowledged: document.getElementById("task-routine")?.checked === true
    },
    standardConfirmedAt: standardConfirmedAt,
    exceptionFlagged:    exceptionFlagged,
    exceptionText:       exceptionFlagged ? exceptionText.value.trim() : "",
    exceptionDetails:    exceptionFlagged ? {
      workaround: exceptionWorkaround.value.trim(),
      approver:   exceptionApprover.value.trim(),
      stopWork:   exceptionStopwork.value.trim()
    } : null,
    templateSnapshot:    templateSnapshot,

    // Today's conditions (interview answers)
    conditions: {
      h2s:       interviewAnswers.h2s,
      work:      interviewAnswers.work,
      newCrew:   interviewAnswers.newcrew,
      weather:   interviewAnswers.weather,
      different: interviewAnswers.different || ""
    },

    // Per-item state for controls and PPE: which items the user confirmed
    // applicable, and any override reasons for unchecked core PPE.
    controlsState: { ...controlsState },
    ppeState:      { ...ppeState },

    // Today's specifics
    todayDifferent: jsaTodayDifferent.value.trim(),
    stopWork:       jsaStopWork.value.trim(),

    // Tasks
    routineTaskAcknowledged: !!taskRoutine.checked,
    customTasks:    gatherCustomTasks(),

    // Crew signatures
    signedCrew:     [...signedCrew],

    // Fast-path tracking (was this JSA pre-filled from a prior shift?)
    fastPathUsed:           fastPathActive,
    fastPathSourceJsaDate:  fastPathSourceJsaDate ? fastPathSourceJsaDate.toISOString() : null,

    // Active content snapshot: which hazards/controls/PPE were shown to the
    // user based on their intake answers. Captured so the audit trail shows
    // exactly what was on this JSA, not just the master template.
    activeContent:  buildActiveContent(interviewAnswers),

    // Audit trail (server-side, can't be faked client-side)
    createdAt:      serverTimestamp(),
    submittedAt:    serverTimestamp(),
    revisionCount:  0,
    schemaVersion:  3
  };
}

// ============== LOAD PAST JSAs ==============
async function loadPastJsas() {
  if (!currentUser) return;

  pastJsasList.innerHTML = `
    <div class="empty-state">
      <p class="empty-text">${adminViewMode ? "Loading all users' JSAs..." : "Loading past JSAs..."}</p>
    </div>
  `;

  try {
    let q;
    let isAdminQuery = false;

    if (adminViewMode && isCurrentUserAdmin) {
      // Admin view: query across all users' jsas subcollections
      const cgRef = collectionGroup(db, "jsas");
      q = query(cgRef, orderBy("createdAt", "desc"), limit(100));
      isAdminQuery = true;
    } else {
      // Normal view: query current user's jsas
      const colRef = collection(db, "users", currentUser.uid, "jsas");
      q = query(colRef, orderBy("createdAt", "desc"));
    }

    const snap = await getDocs(q);

    if (snap.empty) {
      pastJsasList.innerHTML = `
        <div class="empty-state">
          <p class="empty-text">${adminViewMode ? "No JSAs found across any users." : "No JSAs yet. Your submitted JSAs will appear here."}</p>
        </div>
      `;
      pastJsasCount.hidden = true;
      return;
    }

    pastJsasCount.hidden = false;
    pastJsasCount.textContent = isAdminQuery
      ? `${snap.size} ACROSS ALL USERS`
      : `${snap.size} TOTAL`;

    pastJsasList.innerHTML = "";
    // For admin view, batch-fetch user info for each unique uid to show names
    const userInfoCache = {};
    if (isAdminQuery) {
      const uniqueUids = new Set();
      snap.forEach(s => {
        // collectionGroup query: path is users/{uid}/jsas/{jsaId}
        const pathParts = s.ref.path.split("/");
        if (pathParts[0] === "users" && pathParts[1]) {
          uniqueUids.add(pathParts[1]);
        }
      });
      for (const uid of uniqueUids) {
        try {
          const userDoc = await getDoc(doc(db, "users", uid));
          if (userDoc.exists()) {
            const u = userDoc.data();
            userInfoCache[uid] = u.email || u.displayName || uid.slice(0, 8);
          } else {
            userInfoCache[uid] = uid.slice(0, 8);
          }
        } catch {
          userInfoCache[uid] = uid.slice(0, 8);
        }
      }
    }

    snap.forEach((docSnap) => {
      const data = docSnap.data();
      let ownerLabel = null;
      let ownerUid = null;
      if (isAdminQuery) {
        const pathParts = docSnap.ref.path.split("/");
        ownerUid = pathParts[1];
        ownerLabel = userInfoCache[ownerUid] || ownerUid.slice(0, 8);
      }
      const card = renderPastJsaCard(docSnap.id, data, { ownerLabel, ownerUid });
      pastJsasList.appendChild(card);
    });
  } catch (err) {
    console.error("Past JSAs load error:", err);
    pastJsasList.innerHTML = `
      <div class="empty-state">
        <p class="empty-text">Could not load past JSAs.</p>
        <p class="empty-sub font-mono">${escapeHtml(err.message || "UNKNOWN ERROR")}</p>
      </div>
    `;
  }
}

function renderPastJsaCard(docId, data, options = {}) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "past-jsa-card" + (options.ownerLabel ? " admin-card" : "");

  const dateLabel = formatDateLabel(data.date, data.createdAt);
  const jobTag = data.jobTypeName || "Unknown job type";
  const ownerBadge = options.ownerLabel
    ? `<span class="admin-owner-badge">${escapeHtml(options.ownerLabel)}</span>`
    : "";

  card.innerHTML = `
    <div class="past-jsa-info">
      ${ownerBadge}
      <span class="past-jsa-location">${escapeHtml(data.location || "Untitled")}</span>
      <div class="past-jsa-meta">
        <span>${escapeHtml(jobTag)}</span>
        <span class="past-jsa-meta-dot">·</span>
        <span>${escapeHtml(dateLabel)}</span>
      </div>
    </div>
    <svg class="past-jsa-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path d="M9 18l6-6-6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `;

  card.addEventListener("click", () => openJsaDetail(docId, options.ownerUid));
  return card;
}

function formatDateLabel(dateStr, createdAtTimestamp) {
  if (dateStr) {
    try {
      const d = new Date(dateStr + "T00:00:00");
      return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    } catch {}
  }
  if (createdAtTimestamp && createdAtTimestamp.toDate) {
    return createdAtTimestamp.toDate().toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }
  return "—";
}

// ============== JSA DETAIL VIEW ==============
// Track which user's JSA is currently being viewed in detail (admin can view other users' JSAs)
let detailOwnerUid = null;

async function openJsaDetail(docId, ownerUid = null) {
  if (!currentUser) return;

  // If no ownerUid provided, viewing own JSA. If provided, admin viewing another user's.
  const targetUid = ownerUid || currentUser.uid;
  detailOwnerUid = targetUid;
  const isViewingOtherUser = ownerUid && ownerUid !== currentUser.uid;

  detailDocId = docId;
  detailJobTitle.textContent = "Loading...";
  detailLocation.textContent = "";
  detailContent.innerHTML = "";
  editJsaBtn.hidden = true;
  if (exportPdfBtn) exportPdfBtn.hidden = true;
  navigateTo("jsa-detail");

  try {
    const docRef = doc(db, "users", targetUid, "jsas", docId);
    const snap = await getDoc(docRef);
    if (!snap.exists()) {
      detailJobTitle.textContent = "Not found";
      detailContent.innerHTML = `<p class="empty-text">This JSA could not be loaded. It may have been deleted.</p>`;
      return;
    }
    const data = snap.data();
    detailCachedData = data;  // cache for PDF export
    renderDetailView(data, isViewingOtherUser);
    editJsaBtn.hidden = false;
    if (exportPdfBtn) exportPdfBtn.hidden = false;
  } catch (err) {
    console.error("Detail load error:", err);
    detailJobTitle.textContent = "Could not load";
    detailContent.innerHTML = `<p class="empty-text">${escapeHtml(err.message || "Unknown error")}</p>`;
  }
}

// Cache for PDF export — holds the current detail view's JSA data
let detailCachedData = null;

// Edit button on the detail view: load the JSA into the form for revision
editJsaBtn.addEventListener("click", async () => {
  if (!detailDocId || !currentUser) return;

  try {
    const docRef = doc(db, "users", currentUser.uid, "jsas", detailDocId);
    const snap = await getDoc(docRef);
    if (!snap.exists()) {
      showToast("This JSA no longer exists", "error");
      return;
    }
    openJsaForEdit(detailDocId, snap.data());
  } catch (err) {
    console.error("Edit load error:", err);
    showToast("Could not open for editing: " + (err.message || "unknown error"), "error");
  }
});

// Open the form in edit mode, pre-populated with the existing JSA's values.
function openJsaForEdit(docId, data) {
  // Find the matching job type
  const job = JOB_TYPES.find(j => j.id === data.jobTypeId) || JOB_TYPES[0];
  currentJob = job;
  currentTemplate = (job.id === "flowback") ? FLOWBACK_TEMPLATE : null;

  jsaJobTitle.textContent = job.name;

  // Set edit-mode state BEFORE resetJsaForm (which only clears fields)
  editMode        = true;
  editingDocId    = docId;
  editingOriginal = data;
  editingOwnerUid = detailOwnerUid || currentUser.uid;

  resetJsaForm();

  // Show revision reason section, update mode label and button
  revisionReasonSection.hidden = false;
  formModeLabel.textContent = "EDIT JSA · REVISION";
  formModeSub.textContent = "Update what's changed in the field. Original record is preserved as part of the audit trail.";
  submitJsaBtn.querySelector(".btn-label").textContent = "Save revision";
  submitNote.textContent = "PRIOR STATE PRESERVED · ALL REVISIONS TIMESTAMPED";

  // Restore controls/PPE state BEFORE populateStandardLists so the rendered
  // checkboxes reflect the saved state from the prior submission
  if (data.controlsState && typeof data.controlsState === "object") {
    controlsState = { ...data.controlsState };
  }
  if (data.ppeState && typeof data.ppeState === "object") {
    ppeState = { ...data.ppeState };
  }

  if (currentTemplate) populateStandardLists(currentTemplate);

  // Restore interview answers
  if (data.conditions) {
    interviewAnswers.h2s = data.conditions.h2s || null;
    interviewAnswers.work = Array.isArray(data.conditions.work) ? [...data.conditions.work] : [];
    interviewAnswers.newcrew = data.conditions.newCrew || null;
    interviewAnswers.weather = Array.isArray(data.conditions.weather) ? [...data.conditions.weather] : [];
    interviewAnswers.different = data.conditions.different || "";

    // Reflect in UI
    document.querySelectorAll(".interview-options").forEach(group => {
      const q = group.dataset.question;
      const isMulti = group.classList.contains("interview-multi");
      group.querySelectorAll(".interview-chip").forEach(chip => {
        const v = chip.dataset.value;
        if (isMulti) {
          if (interviewAnswers[q] && interviewAnswers[q].includes(v)) chip.classList.add("selected");
        } else {
          if (interviewAnswers[q] === v) chip.classList.add("selected");
        }
      });
    });
    if (interviewDifferent) interviewDifferent.value = interviewAnswers.different;

    // Re-apply H2S tier (info panel + auto-marked controls/PPE)
    if (interviewAnswers.h2s) {
      applyH2sTier(interviewAnswers.h2s);
    }
  }

  // Pre-populate fields from existing data
  jsaLocation.value         = data.location || "";
  jsaDateInput.value        = data.date || "";
  jsaTimeInput.value        = data.shiftStart || "";
  jsaHospital.value         = data.nearestHospital || "";
  jsaMusterPrimary.value    = data.musterPrimary || "";
  jsaMusterSecondary.value  = data.musterSecondary || "";
  jsaTodayDifferent.value   = data.todayDifferent || "";
  jsaStopWork.value         = data.stopWork || "";

  // Emergency info fields
  if (data.emergencyInfo) {
    if (jsaEmergencyPhone) jsaEmergencyPhone.value = data.emergencyInfo.contactNumbers || "";
    if (jsaFirstAidLoc)    jsaFirstAidLoc.value    = data.emergencyInfo.firstAidLocation || "";
    if (jsaAedLoc)         jsaAedLoc.value         = data.emergencyInfo.aedLocation || "";
    if (jsaWindsockLoc)    jsaWindsockLoc.value    = data.emergencyInfo.windsockLocation || "";
    if (jsaHeloLz)         jsaHeloLz.value         = data.emergencyInfo.helicopterLz || "";
  }

  // GPS preserved from prior state
  if (data.gps) {
    capturedGps = data.gps;
    jsaGpsEl.textContent = `${data.gps.lat.toFixed(5)}°, ${data.gps.lng.toFixed(5)}° ${formatAccuracy(data.gps.accuracy, data.gps.source)}`;
    jsaGpsEl.classList.add("captured");
    captureGpsBtn.textContent = "Recapture";
  }

  // Standard items state
  if (data.standardConfirmed) {
    isStandardConfirmed = true;
    standardConfirmedAt = data.standardConfirmedAt;
    confirmStandardBtn.classList.add("confirmed");
    if (confirmStandardBtn.querySelector(".btn-confirm-label")) {
      confirmStandardBtn.querySelector(".btn-confirm-label").textContent = "Confirmed for today's work";
    }
    // Also tick the visible routine acknowledgment in the new minimal form
    const routineCheck = document.getElementById("task-routine");
    if (routineCheck) routineCheck.checked = true;
  }
  if (data.exceptionFlagged) {
    exceptionFlagged = true;
    exceptionArea.hidden = false;
    exceptionBtn.textContent = "Cancel exception";
    exceptionText.value = data.exceptionText || "";
    if (data.exceptionDetails) {
      if (exceptionWorkaround) exceptionWorkaround.value = data.exceptionDetails.workaround || "";
      if (exceptionApprover)   exceptionApprover.value   = data.exceptionDetails.approver   || "";
      if (exceptionStopwork)   exceptionStopwork.value   = data.exceptionDetails.stopWork   || "";
    }
  }

  // Routine task acknowledgment
  if (taskRoutine) taskRoutine.checked = !!data.routineTaskAcknowledged;

  // 3-ack structure: if the prior JSA had standardConfirmed=true, tick both
  // new acknowledgments. Older JSAs predate the 3-ack structure so we infer.
  const ackH_ = document.getElementById("ack-hazards");
  const ackCP_ = document.getElementById("ack-controls-ppe");
  if (data.standardConfirmed) {
    if (ackH_) ackH_.checked = true;
    if (ackCP_) ackCP_.checked = true;
  }

  // Custom tasks: re-populate
  if (Array.isArray(data.customTasks)) {
    data.customTasks.forEach(t => {
      addTaskBtn.click(); // Adds an empty custom task block
      const lastTask = customTasksEl.lastElementChild;
      if (lastTask) {
        lastTask.querySelector(".custom-task-desc").value     = t.description || "";
        lastTask.querySelector(".custom-task-hazards").value  = t.hazards || "";
        lastTask.querySelector(".custom-task-controls").value = t.controls || "";
      }
    });
  }

  // Restore signed crew so their signatures carry through the revision
  if (Array.isArray(data.signedCrew)) {
    signedCrew = data.signedCrew.map(c => ({ ...c }));
    renderSignedCrew();
  }

  navigateTo("jsa-form");

  // Initialize signature pad after view becomes visible
  setTimeout(initSignaturePad, 50);
}

function renderDetailView(data, isViewingOtherUser = false) {
  detailJobTitle.textContent = data.jobTypeName || "Unknown job type";
  detailLocation.textContent = data.location || "—";
  detailStatusLabel.textContent = "SUBMITTED JSA";

  const sections = [];

  // Admin viewing banner: when admin is looking at another user's JSA
  if (isViewingOtherUser) {
    sections.push(`
      <div class="admin-viewing-banner">
        <span class="admin-badge">ADMIN VIEW</span>
        <span class="admin-viewing-text">You are viewing another user's JSA. Edits will be tagged in the audit trail.</span>
      </div>
    `);
  }

  // If this JSA was admin-edited, show that prominently
  if (data.editedByAdmin) {
    sections.push(`
      <div class="admin-edited-banner">
        <span class="admin-edited-label">EDITED BY ADMIN</span>
        <span class="admin-edited-text">This JSA has been edited by an administrator after original submission.</span>
      </div>
    `);
  }

  // Section 01: Job site
  const dateLabel = data.date
    ? new Date(data.date + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })
    : "—";
  const gpsLabel = data.gps
    ? `${data.gps.lat.toFixed(5)}°, ${data.gps.lng.toFixed(5)}° ${formatAccuracy(data.gps.accuracy, data.gps.source)}`
    : "Not captured";

  sections.push(`
    <div class="detail-section">
      <div class="detail-section-head">
        <span class="detail-section-num">§ 01</span>
        <h3 class="detail-section-title">Job site</h3>
      </div>
      <div class="detail-row">
        <span class="spec-label">Location</span>
        <span class="detail-value">${escapeHtml(data.location || "—")}</span>
      </div>
      <div class="detail-meta-row">
        <div class="detail-row">
          <span class="spec-label">Date</span>
          <span class="detail-value">${escapeHtml(dateLabel)}</span>
        </div>
        <div class="detail-row">
          <span class="spec-label">Shift start</span>
          <span class="detail-value">${escapeHtml(data.shiftStart || "—")}</span>
        </div>
      </div>
      <div class="detail-row">
        <span class="spec-label">GPS coordinates</span>
        <span class="detail-value mono">${escapeHtml(gpsLabel)}</span>
      </div>
      <div class="detail-row">
        <span class="spec-label">Nearest hospital</span>
        <span class="detail-value ${data.nearestHospital ? "" : "muted"}">${escapeHtml(data.nearestHospital || "Not specified")}</span>
      </div>
      <div class="detail-row">
        <span class="spec-label">Primary muster point</span>
        <span class="detail-value ${data.musterPrimary ? "" : "muted"}">${escapeHtml(data.musterPrimary || "Not specified")}</span>
      </div>
      <div class="detail-row">
        <span class="spec-label">Secondary muster point</span>
        <span class="detail-value ${data.musterSecondary ? "" : "muted"}">${escapeHtml(data.musterSecondary || "Not specified")}</span>
      </div>
      ${data.emergencyInfo ? `
        ${data.emergencyInfo.contactNumbers ? `<div class="detail-row"><span class="spec-label">Emergency contact numbers</span><span class="detail-value">${escapeHtml(data.emergencyInfo.contactNumbers)}</span></div>` : ""}
        ${data.emergencyInfo.firstAidLocation ? `<div class="detail-row"><span class="spec-label">First aid kit location</span><span class="detail-value">${escapeHtml(data.emergencyInfo.firstAidLocation)}</span></div>` : ""}
        ${data.emergencyInfo.aedLocation ? `<div class="detail-row"><span class="spec-label">AED location</span><span class="detail-value">${escapeHtml(data.emergencyInfo.aedLocation)}</span></div>` : ""}
        ${data.emergencyInfo.windsockLocation ? `<div class="detail-row"><span class="spec-label">Wind sock location</span><span class="detail-value">${escapeHtml(data.emergencyInfo.windsockLocation)}</span></div>` : ""}
        ${data.emergencyInfo.helicopterLz ? `<div class="detail-row"><span class="spec-label">Helicopter LZ</span><span class="detail-value">${escapeHtml(data.emergencyInfo.helicopterLz)}</span></div>` : ""}
      ` : ""}
    </div>
  `);

  // Section: Today's conditions (interview answers)
  if (data.conditions) {
    const c = data.conditions;
    // H2S label supports new severity tiers and legacy condition system
    const h2sLabels = {
      "none":      "Not present",
      // New severity-based tiers
      "trace":     "Trace, monitor only (below 10 ppm)",
      "caution":   "Caution, alarm range (10 to 50 ppm)",
      "danger":    "Danger, physical effects (50 to 100 ppm)",
      "severe":    "Severe, evacuate (above 100 ppm)",
      // Legacy API Condition tiers (pre-v0.4.0 records)
      "cond1":     "Condition I (below 10 ppm)",
      "cond2":     "Condition II (10 to 30 ppm)",
      "cond3":     "Condition III (above 30 ppm)",
      "known":     "Known present",
      "suspected": "Suspected"
    };
    const h2sLabel = h2sLabels[c.h2s] || "—";
    const newCrewLabel = c.newCrew === "yes" ? "Yes"
                       : c.newCrew === "no" ? "No"
                       : "—";
    const weatherLabel = Array.isArray(c.weather) && c.weather.length
      ? c.weather.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(", ")
      : "—";
    sections.push(`
      <div class="detail-section">
        <div class="detail-section-head">
          <span class="detail-section-num">§ 00</span>
          <h3 class="detail-section-title">Today's conditions</h3>
        </div>
        <div class="detail-row">
          <span class="spec-label">H2S potential</span>
          <span class="detail-value">${escapeHtml(h2sLabel)}</span>
        </div>
        <div class="detail-row">
          <span class="spec-label">New crew member on location</span>
          <span class="detail-value">${escapeHtml(newCrewLabel)}</span>
        </div>
        <div class="detail-row">
          <span class="spec-label">Weather concerns</span>
          <span class="detail-value">${escapeHtml(weatherLabel)}</span>
        </div>
        ${c.different ? `
        <div class="detail-row">
          <span class="spec-label">Different from last shift</span>
          <span class="detail-value">${escapeHtml(c.different)}</span>
        </div>
        ` : ""}
      </div>
    `);
  }

  // Section 02: Standard items
  const tpl = data.templateSnapshot;
  const confirmedAtLabel = data.standardConfirmedAt
    ? new Date(data.standardConfirmedAt).toLocaleString()
    : "—";

  let standardSection = `
    <div class="detail-section">
      <div class="detail-section-head">
        <span class="detail-section-num">§ 02</span>
        <h3 class="detail-section-title">Standard items</h3>
      </div>
  `;

  if (data.standardConfirmed) {
    standardSection += `
      <span class="detail-confirm-pill confirmed">✓ Confirmed at ${escapeHtml(confirmedAtLabel)}</span>
    `;
  }
  if (data.exceptionFlagged) {
    standardSection += `
      <span class="detail-confirm-pill exception">! Exception flagged</span>
      <div class="detail-row">
        <span class="spec-label">What's different</span>
        <span class="detail-value">${escapeHtml(data.exceptionText || "—")}</span>
      </div>
      ${data.exceptionDetails ? `
        <div class="detail-row">
          <span class="spec-label">Workaround in place</span>
          <span class="detail-value">${escapeHtml(data.exceptionDetails.workaround || "—")}</span>
        </div>
        <div class="detail-row">
          <span class="spec-label">Workaround approved by</span>
          <span class="detail-value">${escapeHtml(data.exceptionDetails.approver || "—")}</span>
        </div>
        <div class="detail-row">
          <span class="spec-label">Stop work threshold for exception</span>
          <span class="detail-value">${escapeHtml(data.exceptionDetails.stopWork || "—")}</span>
        </div>
      ` : ""}
    `;
  }

  if (tpl && tpl.hazards) {
    standardSection += `
      <div class="detail-row">
        <span class="spec-label">Hazards (${tpl.hazards.length})</span>
        <ul class="standard-list">
          ${tpl.hazards.map(h => {
            const text = typeof h === "string" ? h : (h.text || "");
            return `<li>${escapeHtml(text)}</li>`;
          }).join("")}
        </ul>
      </div>
    `;
  }
  if (tpl && tpl.controls) {
    const cState = data.controlsState || {};
    standardSection += `
      <div class="detail-row">
        <span class="spec-label">Controls (${tpl.controls.length})</span>
        <ul class="standard-list">
          ${tpl.controls.map((c, idx) => {
            const tag = c.type === "eng" ? "ENGINEERING" : c.type === "admin" ? "ADMIN" : "PPE";
            const stateForItem = cState[idx];
            const checked = stateForItem ? stateForItem.checked !== false : true;
            const status = checked ? "✓" : "—";
            const lineClass = checked ? "" : ' style="opacity:0.5;text-decoration:line-through"';
            return `<li${lineClass}>${status} ${escapeHtml(c.text)}<span class="hierarchy-tag">${tag}</span></li>`;
          }).join("")}
        </ul>
      </div>
    `;
  }
  if (tpl && tpl.ppe) {
    const pState = data.ppeState || {};
    standardSection += `
      <div class="detail-row">
        <span class="spec-label">PPE (${tpl.ppe.length})</span>
        <ul class="standard-list">
          ${tpl.ppe.map((p, idx) => {
            const text = typeof p === "string" ? p : (p.text || "");
            const isCore = typeof p === "object" && p.core;
            const stateForItem = pState[idx];
            const checked = stateForItem ? stateForItem.checked !== false : true;
            const status = checked ? "✓" : "—";
            const lineClass = checked ? "" : ' style="opacity:0.5;text-decoration:line-through"';
            const reason = stateForItem && stateForItem.overrideReason
              ? `<div style="font-size:11px;color:var(--amber);margin-top:4px;font-style:italic">Override: ${escapeHtml(stateForItem.overrideReason)}</div>`
              : '';
            const coreTag = isCore ? '<span class="core-required-tag">CORE</span>' : '';
            return `<li${lineClass}>${status} ${escapeHtml(text)}${coreTag}${reason}</li>`;
          }).join("")}
        </ul>
      </div>
    `;
  }

  standardSection += `</div>`;
  sections.push(standardSection);

  // Section 03: Today's specifics
  sections.push(`
    <div class="detail-section">
      <div class="detail-section-head">
        <span class="detail-section-num">§ 03</span>
        <h3 class="detail-section-title">Today's specifics</h3>
      </div>
      <div class="detail-row">
        <span class="spec-label">What's different about this job today</span>
        <span class="detail-value ${data.todayDifferent ? "" : "muted"}">${escapeHtml(data.todayDifferent || "Nothing noted")}</span>
      </div>
      <div class="detail-row">
        <span class="spec-label">Stop work conditions for today</span>
        <span class="detail-value ${data.stopWork ? "" : "muted"}">${escapeHtml(data.stopWork || "Nothing noted")}</span>
      </div>
    </div>
  `);

  // Section 04: Tasks (routine steps + custom)
  let tasksSection = `
    <div class="detail-section">
      <div class="detail-section-head">
        <span class="detail-section-num">§ 04</span>
        <h3 class="detail-section-title">Today's tasks</h3>
      </div>
  `;
  if (data.routineTaskAcknowledged && tpl && tpl.routineSteps) {
    tasksSection += `<span class="detail-confirm-pill confirmed">✓ Routine task breakdown acknowledged</span>`;
    tpl.routineSteps.forEach((step, i) => {
      tasksSection += `
        <div class="detail-step">
          <div class="detail-step-head">
            <span class="detail-step-num">STEP ${String(i + 1).padStart(2, "0")}</span>
            <h4 class="detail-step-title">${escapeHtml(step.title)}</h4>
          </div>
          <p class="detail-step-sub">Hazards</p>
          <ul class="detail-step-list">
            ${step.hazards.map(h => `<li>${escapeHtml(h)}</li>`).join("")}
          </ul>
          <p class="detail-step-sub">Controls</p>
          <ul class="detail-step-list">
            ${step.controls.map(c => `<li>${escapeHtml(c)}</li>`).join("")}
          </ul>
        </div>
      `;
    });
  }
  if (Array.isArray(data.customTasks) && data.customTasks.length) {
    data.customTasks.forEach((t, i) => {
      tasksSection += `
        <div class="detail-step">
          <div class="detail-step-head">
            <span class="detail-step-num">NON-ROUTINE #${String(i + 1).padStart(2, "0")}</span>
            <h4 class="detail-step-title">${escapeHtml(t.description || "—")}</h4>
          </div>
          ${t.hazards ? `<p class="detail-step-sub">Hazards</p><div class="detail-value">${escapeHtml(t.hazards)}</div>` : ""}
          ${t.controls ? `<p class="detail-step-sub">Controls</p><div class="detail-value">${escapeHtml(t.controls)}</div>` : ""}
        </div>
      `;
    });
  }
  tasksSection += `</div>`;
  sections.push(tasksSection);

  // Crew signatures section
  if (Array.isArray(data.signedCrew) && data.signedCrew.length) {
    let crewSection = `
      <div class="detail-section">
        <div class="detail-section-head">
          <span class="detail-section-num">§ 09</span>
          <h3 class="detail-section-title">Crew &amp; signatures (${data.signedCrew.length})</h3>
        </div>
    `;
    data.signedCrew.forEach(c => {
      const timeLabel = c.signedAt ? new Date(c.signedAt).toLocaleString() : "—";
      const hashShort = c.contentHash ? c.contentHash.substring(0, 12) + "..." : "";
      crewSection += `
        <div class="detail-signature-item">
          <div class="crew-signed-head">
            <span class="crew-signed-name">${escapeHtml(c.name || "—")}</span>
            <span class="crew-signed-time">${escapeHtml(timeLabel)}</span>
          </div>
          ${c.signatureDataUrl ? `
            <div class="detail-signature-img">
              <img alt="Signature" src="${c.signatureDataUrl}" />
            </div>
          ` : ""}
          ${c.swaAcknowledged ? `<span class="crew-signed-swa">✓ STOP WORK AUTHORITY ACKNOWLEDGED</span>` : ""}
          ${hashShort ? `<span class="crew-signed-time" title="${escapeHtml(c.contentHash)}">Content hash: ${escapeHtml(hashShort)}</span>` : ""}
        </div>
      `;
    });
    crewSection += `</div>`;
    sections.push(crewSection);
  }

  // Section 05: Audit trail
  const submittedAtLabel = data.submittedAt && data.submittedAt.toDate
    ? data.submittedAt.toDate().toLocaleString()
    : "—";

  let auditSection = `
    <div class="detail-section">
      <div class="detail-section-head">
        <span class="detail-section-num">§ 05</span>
        <h3 class="detail-section-title">Audit trail</h3>
      </div>
      <div class="detail-row">
        <span class="spec-label">Originally submitted</span>
        <span class="detail-value mono">${escapeHtml(submittedAtLabel)}</span>
      </div>
      <div class="detail-row">
        <span class="spec-label">Submitted by</span>
        <span class="detail-value">${escapeHtml(data.userDisplayName || data.userEmail || "—")}</span>
      </div>
      <div class="detail-row">
        <span class="spec-label">Template version</span>
        <span class="detail-value mono">${escapeHtml(data.templateVersion || "—")}</span>
      </div>
      <div class="detail-row">
        <span class="spec-label">Revisions</span>
        <span class="detail-value mono">${data.revisionCount || 0}</span>
      </div>
  `;

  // Revision history
  if (Array.isArray(data.revisions) && data.revisions.length) {
    auditSection += `
      <div class="detail-row">
        <span class="spec-label">Revision history (newest first)</span>
        <ul class="revision-list">
    `;
    // Newest first
    const sortedRevisions = [...data.revisions].sort((a, b) => {
      const at = a.revisedAt && a.revisedAt.toDate ? a.revisedAt.toDate().getTime() : 0;
      const bt = b.revisedAt && b.revisedAt.toDate ? b.revisedAt.toDate().getTime() : 0;
      return bt - at;
    });
    sortedRevisions.forEach((rev, idx) => {
      const num = sortedRevisions.length - idx; // Newest = highest number
      const ts = rev.revisedAt && rev.revisedAt.toDate ? rev.revisedAt.toDate().toLocaleString() : "—";
      const by = rev.revisedByName || rev.revisedByEmail || "—";
      auditSection += `
        <li class="revision-item">
          <div class="revision-head">
            <span class="revision-num">REVISION ${String(num).padStart(2, "0")}</span>
            <span class="revision-time">${escapeHtml(ts)}</span>
          </div>
          <span class="revision-by">By ${escapeHtml(by)}</span>
          <div class="revision-reason">${escapeHtml(rev.reason || "—")}</div>
        </li>
      `;
    });
    // Original at the bottom of the list
    auditSection += `
      <li class="revision-item original">
        <div class="revision-head">
          <span class="revision-num original">ORIGINAL</span>
          <span class="revision-time">${escapeHtml(submittedAtLabel)}</span>
        </div>
        <span class="revision-by">By ${escapeHtml(data.userDisplayName || data.userEmail || "—")}</span>
      </li>
    `;
    auditSection += `</ul></div>`;
  }

  auditSection += `</div>`;
  sections.push(auditSection);

  detailContent.innerHTML = sections.join("");
}

// ============== RESET ==============
function resetJsaForm() {
  viewJsaForm.querySelectorAll("input[type=text], input[type=date], input[type=time], textarea").forEach(el => {
    el.value = "";
  });
  jsaGpsEl.textContent = "Not captured";
  jsaGpsEl.classList.remove("captured");
  capturedGps = null;
  isStandardConfirmed = false;
  standardConfirmedAt = null;
  exceptionFlagged = false;
  confirmStandardBtn.classList.remove("confirmed");
  const confirmLabel = confirmStandardBtn.querySelector(".btn-confirm-label");
  if (confirmLabel) confirmLabel.textContent = "I've reviewed everything above and it applies to today's work";
  exceptionArea.hidden = true;
  exceptionBtn.textContent = "Flag exception (something is different from standard)";
  // Collapse any expanded hazard items
  document.querySelectorAll(".hazard-item.expanded").forEach(el => {
    el.classList.remove("expanded");
    const head = el.querySelector(".hazard-head");
    const elab = el.querySelector(".hazard-elaboration");
    if (head) head.setAttribute("aria-expanded", "false");
    if (elab) elab.hidden = true;
  });
  // Reset inline collapsibles
  ["hazards-toggle", "routine-steps-toggle", "specifics-toggle"].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) {
      btn.setAttribute("aria-expanded", "false");
      btn.classList.remove("expanded");
    }
  });
  ["hazards-list", "routine-steps-list", "specifics-area"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.hidden = true;
  });
  if (taskRoutine) taskRoutine.checked = false;  // active acknowledgment, not pre-checked
  // Reset the two new acknowledgments in the 3-ack structure
  const ackH = document.getElementById("ack-hazards");
  const ackCP = document.getElementById("ack-controls-ppe");
  if (ackH) ackH.checked = false;
  if (ackCP) ackCP.checked = false;
  customTasksEl.innerHTML = "";
  customTaskCount = 0;
  if (hospitalStatus) {
    hospitalStatus.hidden = true;
    hospitalStatus.textContent = "";
  }
  hospitalAutoSet = false;
  if (revisionReasonInput) revisionReasonInput.value = "";

  // Reset interview answers
  interviewAnswers = {
    h2s: null,
    work: [],
    newcrew: null,
    weather: [],
    different: ""
  };
  document.querySelectorAll(".interview-chip.selected").forEach(c => c.classList.remove("selected"));

  // Reset fast-path state
  fastPathActive = false;
  fastPathSourceJsaDate = null;
  fastPathLastQueriedLocation = "";
  const indicator = document.getElementById("prefill-indicator");
  if (indicator) indicator.hidden = true;

  // Reset PPE/controls state (will be re-initialized by populateStandardLists)
  ppeState = {};
  controlsState = {};
  tierAddedControls = [];

  // Reset H2S info panel
  if (h2sInfoPanel) {
    h2sInfoPanel.hidden = true;
    h2sInfoPanel.innerHTML = "";
    h2sInfoPanel.className = "h2s-info-panel";
  }

  // Reset signed crew
  signedCrew = [];
  renderSignedCrew();
  resetCrewAddForm();
}

// ============== PDF EXPORT ==============
// Lazy-load jsPDF + html2canvas from CDN on first export. They're ~250KB
// combined so we only load when the user actually wants a PDF.
let pdfLibsLoaded = false;
async function ensurePdfLibsLoaded() {
  if (pdfLibsLoaded) return;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.head.appendChild(s);
    });
  }

  // Load html2canvas first, then jsPDF
  await loadScript("https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js");
  await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js");

  pdfLibsLoaded = true;
}

// Build the print-friendly HTML for the JSA. This is rendered into a hidden
// off-screen container, then rasterized by html2canvas, then packaged into PDF.
function buildPdfHtml(data) {
  const dateLabel = data.date
    ? new Date(data.date + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })
    : "—";
  const gpsLabel = data.gps
    ? `${data.gps.lat.toFixed(5)}°, ${data.gps.lng.toFixed(5)}° (accuracy: ~${Math.round(data.gps.accuracy || 0)}m, source: ${data.gps.source || "unknown"})`
    : "Not captured";
  const submittedAt = data.submittedAt && data.submittedAt.toDate
    ? data.submittedAt.toDate().toLocaleString()
    : "—";

  // H2S tier label
  const h2sLabels = {
    "none":      "Not present",
    "trace":     "Trace, monitor only (below 10 ppm)",
    "caution":   "Caution, alarm range (10 to 50 ppm)",
    "danger":    "Danger, physical effects (50 to 100 ppm)",
    "severe":    "Severe, evacuate (above 100 ppm)",
    "cond1":     "Condition I (below 10 ppm) — legacy",
    "cond2":     "Condition II (10 to 30 ppm) — legacy",
    "cond3":     "Condition III (above 30 ppm) — legacy"
  };
  const h2sLabel = h2sLabels[data.conditions?.h2s] || "—";

  // Work types
  const workLabels = {
    "routine":           "Routine monitoring only",
    "maintenance":       "Equipment maintenance / iron change-out",
    "heater_treater":    "Heater treater lighting",
    "elevation_sample":  "Sample collection at elevation",
    "other":             "Other"
  };
  const workSelected = (data.conditions?.work || []).map(w => workLabels[w] || w).join(", ") || "—";
  const weatherSelected = (data.conditions?.weather || []).join(", ") || "—";

  // Reconstruct active content from snapshot
  const activeContent = data.activeContent || { hazardIdxs: [], controlIdxs: [], ppeIdxs: [] };
  const template = data.templateSnapshot || FLOWBACK_TEMPLATE;

  // Build hazards section
  const hazardsHtml = activeContent.hazardIdxs.map(idx => {
    const h = template.hazards[idx];
    if (!h) return "";
    return `
      <div class="pdf-item">
        <p class="pdf-item-text">${escapeHtml(h.text)}</p>
        <p class="pdf-item-elab">${escapeHtml(h.elaboration || "")}</p>
      </div>
    `;
  }).join("");

  // Build controls section
  const controlsHtml = activeContent.controlIdxs.map(idx => {
    const c = template.controls[idx];
    if (!c) return "";
    const state = data.controlsState?.[idx] || { checked: false };
    const checkbox = state.checked ? "☒" : "☐";
    const expandedTag = state.expanded ? '<span class="pdf-eng-tag">Reviewed elaboration</span>' : "";
    const typeTag = c.type === "eng" ? "ENGINEERING" : c.type === "admin" ? "ADMIN" : "PPE";
    return `
      <div class="pdf-item">
        <p class="pdf-item-text">${checkbox} ${escapeHtml(c.text)} <span class="pdf-tag">${typeTag}</span>${expandedTag}</p>
        <p class="pdf-item-elab">${escapeHtml(c.elaboration || "")}</p>
      </div>
    `;
  }).join("");

  // Build PPE section
  const ppeHtml = activeContent.ppeIdxs.map(idx => {
    const p = template.ppe[idx];
    if (!p) return "";
    const state = data.ppeState?.[idx] || { checked: false };
    const checkbox = state.checked ? "☒" : "☐";
    const coreTag = p.core ? '<span class="pdf-tag">CORE</span>' : "";
    const expandedTag = state.expanded ? '<span class="pdf-eng-tag">Reviewed elaboration</span>' : "";
    return `
      <div class="pdf-item">
        <p class="pdf-item-text">${checkbox} ${escapeHtml(p.text)} ${coreTag}${expandedTag}</p>
        <p class="pdf-item-elab">${escapeHtml(p.elaboration || "")}</p>
      </div>
    `;
  }).join("");

  // Acknowledgments
  const acks = data.acknowledgments || {};
  const ackHazards = acks.hazardsReviewed ? "☒" : "☐";
  const ackCtlPpe  = acks.controlsAndPpeInPlace ? "☒" : "☐";
  const ackTask    = acks.taskBreakdownAcknowledged ? "☒" : "☐";

  // Routine task breakdown
  let routineStepsHtml = "";
  if (template.routineSteps) {
    routineStepsHtml = template.routineSteps.map((step, i) => `
      <div class="pdf-step">
        <p class="pdf-step-title">Step ${i + 1}: ${escapeHtml(step.title || "")}</p>
        ${step.description ? `<p class="pdf-step-desc">${escapeHtml(step.description)}</p>` : ""}
        ${step.hazards?.length ? `<p class="pdf-step-sub"><b>Hazards:</b> ${step.hazards.map(escapeHtml).join("; ")}</p>` : ""}
        ${step.controls?.length ? `<p class="pdf-step-sub"><b>Controls:</b> ${step.controls.map(escapeHtml).join("; ")}</p>` : ""}
      </div>
    `).join("");
  }

  // Custom tasks
  const customTasksHtml = (data.customTasks || []).length > 0
    ? `<div class="pdf-section">
         <h3 class="pdf-section-title">Non-routine tasks (added for this shift)</h3>
         ${data.customTasks.map((t, i) => `<div class="pdf-item"><p class="pdf-item-text">${i + 1}. ${escapeHtml(t.description || "")}</p></div>`).join("")}
       </div>`
    : "";

  // Exception
  const exceptionHtml = data.exceptionFlagged
    ? `<div class="pdf-section pdf-exception">
         <h3 class="pdf-section-title">EXCEPTION FLAGGED</h3>
         <p><b>What's different from standard:</b> ${escapeHtml(data.exceptionDetails?.text || data.exceptionText || "")}</p>
         <p><b>Workaround in place:</b> ${escapeHtml(data.exceptionDetails?.workaround || "")}</p>
         <p><b>Approved by:</b> ${escapeHtml(data.exceptionDetails?.approver || "")}</p>
         <p><b>Stop work threshold:</b> ${escapeHtml(data.exceptionDetails?.stopWork || "")}</p>
       </div>`
    : "";

  // Signatures
  const signaturesHtml = (data.signedCrew || []).map(sig => `
    <div class="pdf-signature">
      <p class="pdf-sig-name"><b>${escapeHtml(sig.name || "—")}</b></p>
      <p class="pdf-sig-meta">SWA acknowledged: ${sig.swaAcknowledged ? "Yes" : "No"} · Signed: ${sig.signedAt ? new Date(sig.signedAt).toLocaleString() : "—"}</p>
      ${sig.signatureData ? `<img class="pdf-sig-img" src="${sig.signatureData}" alt="Signature" />` : ""}
      ${sig.contentHash ? `<p class="pdf-sig-hash">Content hash: ${escapeHtml(sig.contentHash)}</p>` : ""}
    </div>
  `).join("");

  // Revisions
  const revisionsHtml = (data.revisions || []).length > 0
    ? `<div class="pdf-section">
         <h3 class="pdf-section-title">Revision history</h3>
         ${data.revisions.map((r, i) => `
           <div class="pdf-revision">
             <p><b>Revision ${i + 1}</b> · ${r.revisedAt ? new Date(r.revisedAt.toDate ? r.revisedAt.toDate() : r.revisedAt).toLocaleString() : "—"}</p>
             <p>Reason: ${escapeHtml(r.reason || "—")}</p>
           </div>
         `).join("")}
       </div>`
    : "";

  // Admin edit flag
  const adminEditHtml = data.editedByAdmin
    ? `<div class="pdf-admin-note">⚠ This JSA was edited by an administrator after original submission. Admin UID: ${escapeHtml(data.editedByAdminUid || "—")}. Edited at: ${data.editedByAdminAt?.toDate ? data.editedByAdminAt.toDate().toLocaleString() : "—"}.</div>`
    : "";

  return `
    <div class="pdf-page">
      <div class="pdf-header">
        <h1 class="pdf-title">JOB SAFETY ANALYSIS</h1>
        <p class="pdf-sub">Oilroot Field · ${escapeHtml(data.jobTypeName || "—")}</p>
        <p class="pdf-meta">JSA ID: ${escapeHtml(detailDocId || "—")} · Template: ${escapeHtml(data.templateVersion || "—")} · Generated: ${new Date().toLocaleString()}</p>
      </div>

      ${adminEditHtml}

      <div class="pdf-section">
        <h3 class="pdf-section-title">Identity</h3>
        <p><b>Filled by:</b> ${escapeHtml(data.userDisplayName || data.userEmail || "—")}</p>
        <p><b>Email:</b> ${escapeHtml(data.userEmail || "—")}</p>
        <p><b>User ID:</b> ${escapeHtml(data.userId || "—")}</p>
        <p><b>Submitted at:</b> ${escapeHtml(submittedAt)}</p>
      </div>

      <div class="pdf-section">
        <h3 class="pdf-section-title">§ 00 Today's conditions</h3>
        <p><b>H2S potential:</b> ${escapeHtml(h2sLabel)}</p>
        <p><b>Work today:</b> ${escapeHtml(workSelected)}</p>
        <p><b>Weather concerns:</b> ${escapeHtml(weatherSelected)}</p>
        <p><b>New crew member:</b> ${escapeHtml(data.conditions?.newCrew || "—")}</p>
        ${data.conditions?.different ? `<p><b>Anything different:</b> ${escapeHtml(data.conditions.different)}</p>` : ""}
      </div>

      <div class="pdf-section">
        <h3 class="pdf-section-title">§ 01 Job site</h3>
        <p><b>Location:</b> ${escapeHtml(data.location || "—")}</p>
        <p><b>Date:</b> ${escapeHtml(dateLabel)}</p>
        <p><b>Shift start:</b> ${escapeHtml(data.shiftStart || "—")}</p>
        <p><b>GPS:</b> ${escapeHtml(gpsLabel)}</p>
        <p><b>Nearest hospital:</b> ${escapeHtml(data.nearestHospital || "—")}</p>
        <p><b>Primary muster:</b> ${escapeHtml(data.musterPrimary || data.musterPoint || "—")}</p>
        <p><b>Secondary muster:</b> ${escapeHtml(data.musterSecondary || "—")}</p>
        ${data.emergencyInfo?.contactNumbers ? `<p><b>Emergency contacts:</b> ${escapeHtml(data.emergencyInfo.contactNumbers)}</p>` : ""}
        ${data.emergencyInfo?.firstAidLocation ? `<p><b>First aid kit:</b> ${escapeHtml(data.emergencyInfo.firstAidLocation)}</p>` : ""}
        ${data.emergencyInfo?.aedLocation ? `<p><b>AED:</b> ${escapeHtml(data.emergencyInfo.aedLocation)}</p>` : ""}
        ${data.emergencyInfo?.windsockLocation ? `<p><b>Wind sock:</b> ${escapeHtml(data.emergencyInfo.windsockLocation)}</p>` : ""}
        ${data.emergencyInfo?.helicopterLz ? `<p><b>Helicopter LZ:</b> ${escapeHtml(data.emergencyInfo.helicopterLz)}</p>` : ""}
      </div>

      <div class="pdf-section">
        <h3 class="pdf-section-title">§ 02 Acknowledgments</h3>
        <p>${ackHazards} Hazards reviewed</p>
        <p>${ackCtlPpe} Controls and PPE in place for today's work</p>
        <p>${ackTask} Standard task breakdown acknowledged</p>
      </div>

      <div class="pdf-section">
        <h3 class="pdf-section-title">Hazards on this job (${activeContent.hazardIdxs.length})</h3>
        ${hazardsHtml}
      </div>

      <div class="pdf-section">
        <h3 class="pdf-section-title">Standard controls (${activeContent.controlIdxs.length})</h3>
        ${controlsHtml}
      </div>

      <div class="pdf-section">
        <h3 class="pdf-section-title">Required PPE (${activeContent.ppeIdxs.length})</h3>
        ${ppeHtml}
      </div>

      ${routineStepsHtml ? `<div class="pdf-section">
        <h3 class="pdf-section-title">Standard task breakdown</h3>
        ${routineStepsHtml}
      </div>` : ""}

      ${customTasksHtml}

      ${data.todayDifferent ? `<div class="pdf-section">
        <h3 class="pdf-section-title">Today's specifics</h3>
        <p><b>What's different about this job today:</b> ${escapeHtml(data.todayDifferent)}</p>
        ${data.stopWork ? `<p><b>Stop work conditions:</b> ${escapeHtml(data.stopWork)}</p>` : ""}
      </div>` : ""}

      ${exceptionHtml}

      <div class="pdf-section">
        <h3 class="pdf-section-title">Crew signatures (${(data.signedCrew || []).length})</h3>
        ${signaturesHtml || "<p>No signatures recorded.</p>"}
      </div>

      ${revisionsHtml}

      <div class="pdf-section pdf-audit-footer">
        <h3 class="pdf-section-title">Audit trail</h3>
        <p><b>JSA ID:</b> ${escapeHtml(detailDocId || "—")}</p>
        <p><b>Template version:</b> ${escapeHtml(data.templateVersion || "—")}</p>
        <p><b>Schema version:</b> ${data.schemaVersion || "—"}</p>
        <p><b>Submitted at:</b> ${escapeHtml(submittedAt)}</p>
        <p><b>Revision count:</b> ${data.revisionCount || 0}</p>
        ${data.fastPathUsed ? `<p><b>Fast path used:</b> Yes (source date: ${data.fastPathSourceJsaDate || "—"})</p>` : ""}
        <p><b>PDF generated at:</b> ${new Date().toLocaleString()}</p>
        <p class="pdf-footer-note">This PDF was generated from data stored in Oilroot Field. The signature content hash on each signature in the audit trail above provides cryptographic proof that the JSA content at signing time matches what is shown in this document.</p>
      </div>
    </div>
  `;
}

// Build the print stylesheet for the off-screen render
function buildPdfStyles() {
  return `
    .pdf-page {
      font-family: Georgia, 'Times New Roman', serif;
      color: #1a1a1a;
      background: white;
      padding: 40px;
      width: 800px;
      box-sizing: border-box;
      line-height: 1.4;
      font-size: 11pt;
    }
    .pdf-header { border-bottom: 2px solid #1a1a1a; margin-bottom: 20px; padding-bottom: 12px; }
    .pdf-title { font-size: 22pt; margin: 0 0 4px 0; letter-spacing: 0.05em; }
    .pdf-sub { font-size: 13pt; margin: 0 0 6px 0; color: #444; }
    .pdf-meta { font-size: 9pt; color: #666; font-family: 'Courier New', monospace; margin: 0; }
    .pdf-section { margin: 18px 0; page-break-inside: avoid; }
    .pdf-section-title { font-size: 13pt; margin: 0 0 8px 0; padding-bottom: 4px; border-bottom: 1px solid #888; }
    .pdf-section p { margin: 4px 0; }
    .pdf-item { margin: 8px 0; padding: 6px 0; border-bottom: 1px dotted #ccc; }
    .pdf-item-text { margin: 0; font-weight: 600; font-size: 11pt; }
    .pdf-item-elab { margin: 4px 0 0 0; font-size: 9.5pt; color: #555; font-style: italic; }
    .pdf-tag { display: inline-block; font-size: 7.5pt; padding: 1px 4px; background: #eee; border-radius: 2px; font-weight: 600; letter-spacing: 0.05em; margin-left: 4px; font-family: 'Courier New', monospace; }
    .pdf-eng-tag { display: inline-block; font-size: 7.5pt; padding: 1px 4px; background: #fff3cd; color: #856404; border-radius: 2px; margin-left: 4px; font-family: 'Courier New', monospace; }
    .pdf-step { margin: 10px 0; padding: 8px; background: #f7f7f7; border-left: 3px solid #888; }
    .pdf-step-title { margin: 0 0 4px 0; font-weight: 700; }
    .pdf-step-desc { margin: 0 0 4px 0; font-size: 10pt; }
    .pdf-step-sub { margin: 2px 0; font-size: 9.5pt; color: #444; }
    .pdf-exception { background: #fff5f5; border-left: 4px solid #d04444; padding: 12px; }
    .pdf-exception .pdf-section-title { color: #d04444; border-bottom-color: #d04444; }
    .pdf-signature { margin: 12px 0; padding: 10px; background: #fafafa; border-left: 3px solid #444; page-break-inside: avoid; }
    .pdf-sig-name { margin: 0; font-size: 12pt; }
    .pdf-sig-meta { margin: 4px 0; font-size: 9pt; color: #555; }
    .pdf-sig-img { max-width: 280px; max-height: 80px; background: white; border: 1px solid #ddd; margin: 4px 0; }
    .pdf-sig-hash { margin: 4px 0 0 0; font-size: 7.5pt; font-family: 'Courier New', monospace; color: #666; word-break: break-all; }
    .pdf-revision { margin: 6px 0; padding: 6px; background: #f7f7f7; }
    .pdf-revision p { margin: 2px 0; font-size: 10pt; }
    .pdf-admin-note { margin: 12px 0; padding: 10px; background: #fff3cd; border-left: 4px solid #d97706; color: #856404; font-weight: 600; }
    .pdf-audit-footer { background: #f4f4f4; padding: 14px; border: 1px solid #ccc; }
    .pdf-footer-note { margin-top: 10px; font-size: 8.5pt; font-style: italic; color: #555; }
  `;
}

// Generate filename: JSA_[location-slug]_[YYYY-MM-DD].pdf
function buildPdfFilename(data) {
  const locationSlug = (data.location || "untitled")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const dateStr = data.date || new Date().toISOString().slice(0, 10);
  return `JSA_${locationSlug}_${dateStr}.pdf`;
}

// Main export entry point
async function exportJsaPdf(data) {
  if (!data) {
    showToast("No JSA loaded to export", "error");
    return;
  }
  exportPdfBtn.disabled = true;
  const originalLabel = exportPdfBtn.innerHTML;
  exportPdfBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" opacity="0.3"/></svg> Loading...`;

  try {
    await ensurePdfLibsLoaded();

    // Build the HTML and stylesheet, render into an offscreen container
    const container = document.createElement("div");
    container.style.position = "absolute";
    container.style.left = "-99999px";
    container.style.top = "0";
    container.style.background = "white";
    const styleTag = document.createElement("style");
    styleTag.textContent = buildPdfStyles();
    container.appendChild(styleTag);
    container.innerHTML += buildPdfHtml(data);
    document.body.appendChild(container);

    exportPdfBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" opacity="0.3"/></svg> Rendering...`;

    // html2canvas the rendered HTML, scale 2 for retina sharpness
    const canvas = await window.html2canvas(container.querySelector(".pdf-page"), {
      scale: 2,
      backgroundColor: "#ffffff",
      logging: false,
      useCORS: true
    });

    // jsPDF build: letter-sized, portrait, paginated
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({
      orientation: "portrait",
      unit: "pt",
      format: "letter"  // 612 x 792 pt
    });

    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const imgWidth = pageWidth - 40;  // 20pt margin each side
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    let heightLeft = imgHeight;
    let position = 20;  // top margin

    pdf.addImage(canvas.toDataURL("image/png"), "PNG", 20, position, imgWidth, imgHeight);
    heightLeft -= (pageHeight - 40);

    while (heightLeft > 0) {
      position = heightLeft - imgHeight + 20;
      pdf.addPage();
      pdf.addImage(canvas.toDataURL("image/png"), "PNG", 20, position, imgWidth, imgHeight);
      heightLeft -= (pageHeight - 40);
    }

    const filename = buildPdfFilename(data);
    pdf.save(filename);

    // Cleanup
    document.body.removeChild(container);
    showToast(`Exported as ${filename}`, "success");
  } catch (err) {
    console.error("PDF export error:", err);
    showToast("Could not export PDF: " + (err.message || "unknown error"), "error");
  } finally {
    exportPdfBtn.disabled = false;
    exportPdfBtn.innerHTML = originalLabel;
  }
}

// Wire up the Export PDF button
if (exportPdfBtn) {
  exportPdfBtn.addEventListener("click", () => {
    exportJsaPdf(detailCachedData);
  });
}

// ============== TOAST ==============
let toastTimer = null;
function showToast(message, type = "info") {
  toastEl.textContent = message;
  toastEl.className = "toast " + type;
  toastEl.hidden = false;
  void toastEl.offsetWidth;
  toastEl.classList.add("visible");

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.classList.remove("visible");
    setTimeout(() => { toastEl.hidden = true; }, 250);
  }, 3500);
}
