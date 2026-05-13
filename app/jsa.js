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
  addDoc,
  getDocs,
  doc,
  getDoc,
  query,
  orderBy,
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

onAuthStateChanged(auth, (user) => {
  currentUser = user || null;
  if (user) {
    // Load past JSAs whenever a user is signed in
    loadPastJsas();
  }
});

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
const TEMPLATE_VERSION = "flowback-v0.3.0";

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
  cond1: {
    label: "Condition I",
    range: "below 10 ppm",
    info: {
      title: "API Condition I · Routine operations",
      body: "Industry-standard alarm setpoint per NIOSH is 10 ppm. If your monitor alarms, evacuate and reassess before re-entry. ACGIH short-term exposure limit is 5 ppm. Loss of smell begins around 100 ppm, so never rely on your nose."
    },
    addControls: [],
    // Items here get flagged as required (uncheckable without override reason)
    requirePpe: ["Personal 4-gas monitor worn within 6 inches of breathing zone (O2, LEL, H2S, CO)"]
  },
  cond2: {
    label: "Condition II",
    range: "10 to 30 ppm",
    info: {
      title: "API Condition II · Moderate hazard",
      body: "Industry-recognized 8-hour ceiling is 20 ppm. Continuous gas monitoring required. Escape pack must be accessible. Oxygen resuscitator on location per API. Headaches, nausea, and respiratory irritation can occur with prolonged exposure."
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
  cond3: {
    label: "Condition III",
    range: "above 30 ppm",
    info: {
      title: "API Condition III · Emergency procedures in effect",
      body: "NIOSH IDLH (Immediately Dangerous to Life and Health) is 100 ppm. Above 100 ppm in Texas, Railroad Commission notification required. SCBA in use for any person entering work zone. Written H2S emergency response plan must be reviewed and on location."
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

// ============== FACTS LIBRARY ==============
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
const jsaMuster     = document.getElementById("jsa-muster");
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
let detailDocId     = null;      // Currently-viewed JSA in the detail view

// Interview question answers
let interviewAnswers = {
  h2s: null,           // "known" | "suspected" | "none"
  newcrew: null,       // "yes" | "no"
  weather: [],         // array of "cold" | "heat" | "wind" | "lightning" | "none"
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
  currentTemplate.controls.forEach((c, idx) => {
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
  // Pick one random hazard to show pre-expanded as anti-complacency nudge
  pickHighlightedHazard();

  // Render hazards as tappable items with elaboration
  hazardsList.innerHTML = "";
  template.hazards.forEach((hazard, idx) => {
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

  // Render controls as checkboxes (all start checked)
  populateControlsList();

  // Render PPE as expandable checkbox rows. Default unchecked. User actively
  // checks each item that applies. Core items must be checked to submit.
  ppeList.className = "checkbox-list with-elaborations";
  ppeList.innerHTML = "";
  template.ppe.forEach((p, idx) => {
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
      muster: jsaMuster.value.trim(),
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

// ============== COLLAPSIBLE SECTIONS ==============
// Hazards, controls, and PPE start collapsed. User taps the header to expand.
function setupCollapsibles() {
  const collapsibles = [
    { headerId: "hazards-collapse-header",  listId: "hazards-list"  },
    { headerId: "controls-collapse-header", listId: "controls-list" },
    { headerId: "ppe-collapse-header",      listId: "ppe-list"      }
  ];
  collapsibles.forEach(({ headerId, listId }) => {
    const header = document.getElementById(headerId);
    const list = document.getElementById(listId);
    if (!header || !list) return;
    header.addEventListener("click", () => {
      const expanded = header.getAttribute("aria-expanded") === "true";
      const newState = !expanded;
      header.setAttribute("aria-expanded", newState ? "true" : "false");
      list.hidden = !newState;
      header.classList.toggle("expanded", newState);
    });
  });
}

// Update the count display on each collapse header
function updateCollapseCounts() {
  if (!currentTemplate) return;

  const hazardCount = currentTemplate.hazards.length;
  const hazardsCountEl = document.getElementById("hazards-collapse-count");
  if (hazardsCountEl) hazardsCountEl.textContent = `${hazardCount} hazards`;

  const ctlTotal = currentTemplate.controls.length;
  const ctlChecked = Object.values(controlsState).filter(s => s.checked).length;
  const ctlEl = document.getElementById("controls-collapse-count");
  if (ctlEl) ctlEl.textContent = `${ctlChecked} of ${ctlTotal} checked`;

  const ppeTotal = currentTemplate.ppe.length;
  const ppeChecked = Object.values(ppeState).filter(s => s.checked).length;
  const ppeEl = document.getElementById("ppe-collapse-count");
  if (ppeEl) ppeEl.textContent = `${ppeChecked} of ${ppeTotal} checked`;
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

      // H2S tier triggers info panel + auto-marks PPE/controls
      if (question === "h2s") {
        applyH2sTier(interviewAnswers.h2s);
      }
    });
  });
});

// Render the H2S info panel and update controls/PPE based on tier
function applyH2sTier(tierKey) {
  const tier = H2S_TIERS[tierKey];
  if (!tier) return;

  // Update info panel
  if (h2sInfoPanel) {
    if (tier.info) {
      h2sInfoPanel.hidden = false;
      h2sInfoPanel.className = "h2s-info-panel " + (tierKey === "cond3" ? "cond-3" : tierKey === "cond2" ? "cond-2" : "");
      h2sInfoPanel.innerHTML = `
        <span class="h2s-info-panel-label">${escapeHtml(tier.info.title)}</span>
        <p class="h2s-info-panel-body">${escapeHtml(tier.info.body)}</p>
      `;
    } else {
      h2sInfoPanel.hidden = true;
      h2sInfoPanel.innerHTML = "";
    }
  }

  // Apply control auto-marking. Add tier-specific controls to controlsState
  // and the template snapshot only at submission time. For UI rendering, we
  // dynamically inject these into the controls list as additional checked items.
  refreshControlsForTier(tierKey);
  refreshPpeRequirementsForTier(tierKey);
}

// Track tier-added controls separately so we can clean them up if tier changes
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
  // We want full-service hospitals with emergency departments, not specialty
  // clinics, dental offices, or anything else that someone tagged amenity=hospital.
  // Require either emergency=yes (best signal) OR healthcare=hospital (rigorous tag).
  // We deliberately do NOT fall back to generic amenity=hospital, since that tag
  // is unreliable in OSM and includes everything from eye clinics to (yes, really)
  // miscategorized car dealerships.
  const overpassQuery = `
    [out:json][timeout:8];
    (
      node["amenity"="hospital"]["emergency"="yes"](around:${radiusMeters},${lat},${lng});
      way["amenity"="hospital"]["emergency"="yes"](around:${radiusMeters},${lat},${lng});
      node["amenity"="hospital"]["healthcare"="hospital"](around:${radiusMeters},${lat},${lng});
      way["amenity"="hospital"]["healthcare"="hospital"](around:${radiusMeters},${lat},${lng});
    );
    out center 25;
  `;
  const url = "https://overpass-api.de/api/interpreter";
  const resp = await fetch(url, {
    method: "POST",
    body: "data=" + encodeURIComponent(overpassQuery)
  });
  if (!resp.ok) throw new Error("Overpass API error: " + resp.status);
  const data = await resp.json();
  if (!data.elements || data.elements.length === 0) return null;

  // Even within tagged hospitals, exclude obvious specialty facilities
  const SPECIALTY_KEYWORDS = [
    "eye", "vision", "ophthalm", "dental", "orthodont",
    "dermatolog", "fertility", "psychiatric", "behavioral",
    "rehabilitation", "rehab center", "surgery center",
    "outpatient", "urgent care", "veterinary", "animal",
    "cancer center", "cardiac care only", "physical therapy",
    "chevrolet", "ford", "toyota", "dealership", "auto"
  ];

  function looksLikeSpecialty(name, tags) {
    const lower = (name || "").toLowerCase();
    if (SPECIALTY_KEYWORDS.some(kw => lower.includes(kw))) return true;
    if (tags?.healthcare === "clinic") return true;
    if (tags?.healthcare === "doctor") return true;
    if (tags?.healthcare === "dentist") return true;
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

  candidates.sort((a, b) => a.distanceMi - b.distanceMi);
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
  const muster = jsaMuster.value.trim();
  if (!muster) {
    showToast("Muster point is required", "error");
    jsaMuster.focus();
    return;
  }
  if (!interviewAnswers.h2s) {
    showToast("Answer the H2S question in Today's conditions", "error");
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
  if (isStandardConfirmed === false && exceptionFlagged === false) {
    showToast("Confirm standard items, or flag an exception, before submitting", "error");
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

  // All core PPE items must be checked before submission. These are the
  // baseline PPE that always applies to flowback work.
  if (currentTemplate && currentTemplate.ppe) {
    const missingCorePpe = [];
    currentTemplate.ppe.forEach((p, idx) => {
      if (p.core && (!ppeState[idx] || !ppeState[idx].checked)) {
        missingCorePpe.push(p.text);
      }
    });
    if (missingCorePpe.length > 0) {
      showToast(`Required PPE not checked: ${missingCorePpe[0]}${missingCorePpe.length > 1 ? ` (+${missingCorePpe.length - 1} more)` : ""}`, "error");
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

    const docRef = doc(db, "users", currentUser.uid, "jsas", editingDocId);
    await updateDoc(docRef, {
      ...newValues,
      revisionCount: newRevisionCount,
      revisions: arrayUnion(revision)
    });

    showToast("Revision saved · audit trail updated", "success");
    resetJsaForm();
    // Reload detail view with the updated data
    await openJsaDetail(editingDocId);
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
    musterPoint:      data.musterPoint,
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

  return {
    // Identity
    userId:        currentUser.uid,
    userEmail:     currentUser.email,
    userDisplayName: currentUser.displayName || "",

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
    musterPoint:     jsaMuster.value.trim(),

    // Emergency information (optional)
    emergencyInfo: {
      contactNumbers: jsaEmergencyPhone ? jsaEmergencyPhone.value.trim() : "",
      firstAidLocation: jsaFirstAidLoc ? jsaFirstAidLoc.value.trim() : "",
      aedLocation: jsaAedLoc ? jsaAedLoc.value.trim() : "",
      windsockLocation: jsaWindsockLoc ? jsaWindsockLoc.value.trim() : "",
      helicopterLz: jsaHeloLz ? jsaHeloLz.value.trim() : ""
    },

    // Standard items
    standardConfirmed:   isStandardConfirmed,
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

    // Audit trail (server-side, can't be faked client-side)
    createdAt:      serverTimestamp(),
    submittedAt:    serverTimestamp(),
    revisionCount:  0,
    schemaVersion:  2
  };
}

// ============== LOAD PAST JSAs ==============
async function loadPastJsas() {
  if (!currentUser) return;

  pastJsasList.innerHTML = `
    <div class="empty-state">
      <p class="empty-text">Loading past JSAs...</p>
    </div>
  `;

  try {
    const colRef = collection(db, "users", currentUser.uid, "jsas");
    const q = query(colRef, orderBy("createdAt", "desc"));
    const snap = await getDocs(q);

    if (snap.empty) {
      pastJsasList.innerHTML = `
        <div class="empty-state">
          <p class="empty-text">No JSAs yet. Your submitted JSAs will appear here.</p>
        </div>
      `;
      pastJsasCount.hidden = true;
      return;
    }

    pastJsasCount.hidden = false;
    pastJsasCount.textContent = `${snap.size} TOTAL`;

    pastJsasList.innerHTML = "";
    snap.forEach((docSnap) => {
      const data = docSnap.data();
      const card = renderPastJsaCard(docSnap.id, data);
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

function renderPastJsaCard(docId, data) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "past-jsa-card";

  const dateLabel = formatDateLabel(data.date, data.createdAt);
  const jobTag = data.jobTypeName || "Unknown job type";

  card.innerHTML = `
    <div class="past-jsa-info">
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

  card.addEventListener("click", () => openJsaDetail(docId));
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
async function openJsaDetail(docId) {
  if (!currentUser) return;

  detailDocId = docId;
  detailJobTitle.textContent = "Loading...";
  detailLocation.textContent = "";
  detailContent.innerHTML = "";
  editJsaBtn.hidden = true;
  navigateTo("jsa-detail");

  try {
    const docRef = doc(db, "users", currentUser.uid, "jsas", docId);
    const snap = await getDoc(docRef);
    if (!snap.exists()) {
      detailJobTitle.textContent = "Not found";
      detailContent.innerHTML = `<p class="empty-text">This JSA could not be loaded. It may have been deleted.</p>`;
      return;
    }
    const data = snap.data();
    renderDetailView(data);
    editJsaBtn.hidden = false;
  } catch (err) {
    console.error("Detail load error:", err);
    detailJobTitle.textContent = "Could not load";
    detailContent.innerHTML = `<p class="empty-text">${escapeHtml(err.message || "Unknown error")}</p>`;
  }
}

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
  jsaMuster.value           = data.musterPoint || "";
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
    confirmStandardBtn.querySelector(".btn-confirm-label").textContent = "Confirmed for today's work";
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

function renderDetailView(data) {
  detailJobTitle.textContent = data.jobTypeName || "Unknown job type";
  detailLocation.textContent = data.location || "—";
  detailStatusLabel.textContent = "SUBMITTED JSA";

  const sections = [];

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
        <span class="spec-label">Muster point</span>
        <span class="detail-value ${data.musterPoint ? "" : "muted"}">${escapeHtml(data.musterPoint || "Not specified")}</span>
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
    // H2S label supports both new tier system and legacy answers
    const h2sLabels = {
      "none":      "Not present",
      "cond1":     "Condition I (below 10 ppm)",
      "cond2":     "Condition II (10 to 30 ppm)",
      "cond3":     "Condition III (above 30 ppm)",
      // Legacy
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
  confirmStandardBtn.querySelector(".btn-confirm-label").textContent = "I've reviewed everything above and it applies to today's work";
  exceptionArea.hidden = true;
  exceptionBtn.textContent = "Something is different";
  // Collapse any expanded hazard items
  document.querySelectorAll(".hazard-item.expanded").forEach(el => {
    el.classList.remove("expanded");
    const head = el.querySelector(".hazard-head");
    const elab = el.querySelector(".hazard-elaboration");
    if (head) head.setAttribute("aria-expanded", "false");
    if (elab) elab.hidden = true;
  });
  if (taskRoutine) taskRoutine.checked = true;
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
    newcrew: null,
    weather: [],
    different: ""
  };
  document.querySelectorAll(".interview-chip.selected").forEach(c => c.classList.remove("selected"));

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
