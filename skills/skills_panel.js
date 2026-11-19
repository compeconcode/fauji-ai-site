/* fauji.ai skills side panel (loaded at the end of chatbot_v3.html).

   Layout:  [ chat | divider | side panel ]. The panel has a Skill dropdown and two collapsible
   sections, Inputs (patrol_form.html in an iframe) and Result (patrol_timetable.html in an iframe).

   Flow for patrol planning:
     1. the form iframe posts {type:"patrol-solve", spec} to this page;
     2. this page sends spec to the server  (POST /skills/patrol_planning/run, same API key as /chat);
     3. on success the plan is stored in sessionStorage["patrolPlan"] and the Result iframe is
        (re)loaded: it reads the plan from there. On an error the message goes back to the form.
   Nothing here loads from the internet; all files are relative to this page.

   Routing: before a typed message goes to /chat, the page asks POST /skills/route which skill (if any) the
   message needs. For a skill the chat shows a guide + "Open the planner?" and waits for a click; for "none",
   or if the server does not answer within 5 s, the message is sent to /chat exactly as before.

   Plan in the chat: after a successful run the plan is described as text (patrol_plan_text.js) and a chip above the
   typing box says "Patrol plan attached". While attached, every question goes straight to /chat (the router is
   skipped) with that text in "plan_context", so the model answers from the plan's real numbers. The chip's x detaches the plan (the text is
   kept; "Attach again" brings it back); "Explain this plan" sends a ready-made question.

   To add a second skill later: add an <option> to #skillSelect, its guide text to GUIDES, and its own
   form/result pages. */

(function () {
  const SKILL_URL = CHAT_URL.replace(/\/chat$/, "/skills/patrol_planning/run");   // follows CHAT_URL, like UPLOAD_URL
  const PLAN_KEY = "patrolPlan";           // read by patrol_timetable.html
  const PLAN_TEXT_KEY = "patrolPlanText";  // the plan described as text, for the chat
  const PLAN_ATTACHED_KEY = "patrolPlanAttached";
  const WIDTH_KEY = "fauji.panelWidth";
  const MIN_PANEL = 320, MIN_CHAT = 300;
  const AIRCRAFT_URL = CHAT_URL.replace(/\/chat$/, "/skills/aircraft_specs");   // + "/list" or "/compare"
  const REPORT_KEY = "aircraftReport";     // read by aircraft_report.html
  const SKILL_KEY = "fauji.skill";         // the skill chosen in the dropdown, remembered for this tab

  const $ = id => document.getElementById(id);
  const layout = $("layout"), panel = $("sidePanel"), divider = $("spDivider");
  const formFrame = $("formFrame"), resultFrame = $("resultFrame");

  // The pages each skill shows in the panel. "stored" is the sessionStorage key that holds its last result.
  const PAGES = {
    patrol_planning: { form: "skills/patrol_form.html", formTitle: "Patrol planner inputs",
                       result: "skills/patrol_timetable.html", resultTitle: "Patrol timetable", stored: PLAN_KEY,
                       empty: "No result yet. Fill in the inputs and press Generate timetable." },
    aircraft_specs:  { form: "skills/aircraft_form.html", formTitle: "Choose aircraft",
                       result: "skills/aircraft_report.html", resultTitle: "Aircraft comparison", stored: REPORT_KEY,
                       empty: "No comparison yet. Choose aircraft in Inputs and press Show comparison." },
  };
  let skill = "patrol_planning";
  try { const s = sessionStorage.getItem(SKILL_KEY); if (PAGES[s]) skill = s; } catch (e) {}
  const hasResult = name => { try { return !!sessionStorage.getItem(PAGES[name].stored); } catch (e) { return false; } };

  /* ---------- open / close / hide chat ---------- */
  function openPanel() {
    panel.hidden = false; divider.hidden = false; layout.classList.add("open");
    let w = null;
    try { w = parseInt(localStorage.getItem(WIDTH_KEY), 10); } catch (e) {}
    setWidth(w || Math.round(window.innerWidth * 0.46));
    if (hasResult(skill) && resultFrame.hidden) showResult(false);       // a result from earlier in this tab
  }
  function closePanel() {
    panel.hidden = true; divider.hidden = true;
    layout.classList.remove("open", "chat-hidden");
    $("spChatToggle").textContent = "Hide chat";
  }
  $("skillsBtn").onclick = () => (panel.hidden ? openPanel() : closePanel());
  $("spClose").onclick = closePanel;
  $("spChatToggle").onclick = () => {
    const hide = !layout.classList.contains("chat-hidden");
    layout.classList.toggle("chat-hidden", hide);
    divider.hidden = hide;
    $("spChatToggle").textContent = hide ? "Show chat" : "Hide chat";
    pokeResult();
  };

  /* ---------- drag the divider to resize ---------- */
  function setWidth(w) {
    const max = Math.max(MIN_PANEL, window.innerWidth - MIN_CHAT - 8);
    w = Math.min(max, Math.max(MIN_PANEL, w));
    panel.style.setProperty("--spw", w + "px");
    return w;
  }
  divider.addEventListener("pointerdown", e => {
    divider.setPointerCapture(e.pointerId);
    divider.classList.add("drag"); layout.classList.add("dragging");
  });
  divider.addEventListener("pointermove", e => {
    if (!divider.hasPointerCapture(e.pointerId)) return;
    setWidth(window.innerWidth - e.clientX);
  });
  const endDrag = e => {
    if (!divider.hasPointerCapture(e.pointerId)) return;
    divider.releasePointerCapture(e.pointerId);
    divider.classList.remove("drag"); layout.classList.remove("dragging");
    try { localStorage.setItem(WIDTH_KEY, String(parseInt(panel.style.getPropertyValue("--spw"), 10))); } catch (err) {}
  };
  divider.addEventListener("pointerup", endDrag);
  divider.addEventListener("pointercancel", endDrag);
  window.addEventListener("resize", () => { if (!panel.hidden) setWidth(panel.getBoundingClientRect().width); });

  /* ---------- collapsible sections ---------- */
  function setCollapsed(sec, collapsed) {
    sec.classList.toggle("collapsed", collapsed);
    const head = sec.querySelector(".sp-sechead");
    head.setAttribute("aria-expanded", String(!collapsed));
    head.textContent = (collapsed ? "▸ " : "▾ ") + head.dataset.title;
    if (!collapsed) pokeResult();
  }
  document.querySelectorAll(".sp-sec").forEach(sec => {
    const head = sec.querySelector(".sp-sechead");
    head.dataset.title = head.textContent.replace(/^[▸▾]\s*/, "");
    head.onclick = () => setCollapsed(sec, !sec.classList.contains("collapsed"));
  });
  // the timetable draws itself to its width: tell it when its box changed size
  function pokeResult() {
    setTimeout(() => { try { resultFrame.contentWindow.dispatchEvent(new Event("resize")); } catch (e) {} }, 50);
  }

  /* ---------- result section (shared by the skills) ---------- */
  function showResult(collapseInputs) {
    $("resultEmpty").hidden = true;
    resultFrame.hidden = false;
    resultFrame.title = PAGES[skill].resultTitle;
    resultFrame.src = PAGES[skill].result + "?ts=" + Date.now();          // reload: it reads the new result on start
    setCollapsed($("secResult"), false);
    if (collapseInputs) setCollapsed($("secInputs"), true);                 // give the result the room
  }

  /* ---------- switching between skills (the Skill dropdown) ---------- */
  function switchSkill(name) {
    if (!PAGES[name]) return;
    skill = name;
    try { sessionStorage.setItem(SKILL_KEY, name); } catch (e) {}
    $("skillSelect").value = name;
    const g = $("guideBody"); g.textContent = ""; g.appendChild(guideNode(GUIDES[name]));
    formFrame.title = PAGES[name].formTitle;
    formFrame.src = PAGES[name].form;
    setCollapsed($("secInputs"), false);
    if (hasResult(name)) showResult(false);
    else {
      resultFrame.hidden = true; resultFrame.removeAttribute("src");
      $("resultEmpty").textContent = PAGES[name].empty; $("resultEmpty").hidden = false;
    }
  }

  /* ---------- aircraft specifications: the form asks, this page calls the server ---------- */
  function replyToFormAs(type, msg) {
    try { formFrame.contentWindow.postMessage(Object.assign({ type }, msg), "*"); } catch (e) {}
  }

  async function callAircraft(path, body) {
    let resp, res = null;
    try {
      resp = await fetch(AIRCRAFT_URL + path, body === undefined
        ? { headers: { "x-api-key": API_KEY } }
        : { method: "POST", headers: { "Content-Type": "application/json", "x-api-key": API_KEY }, body: JSON.stringify(body) });
    } catch (e) {
      return { ok: false, error: "Could not reach the server. Check that it is running and try again." };
    }
    try { res = await resp.json(); } catch (e) {}
    if (!resp.ok) {
      return { ok: false, error: resp.status === 401 ? "The server did not accept the API key."
                               : (res && res.detail) ? String(res.detail) : "The server answered with an error (" + resp.status + ")." };
    }
    return res || { ok: false, error: "No answer from the server." };
  }

  async function aircraftList() {
    const res = await callAircraft("/list");
    replyToFormAs("aircraft-list-result", res.ok ? { ok: true, categories: res.categories } : { ok: false, error: res.error });
  }

  async function aircraftCompare(ids) {
    const res = await callAircraft("/compare", { ids });
    if (!res.ok) { replyToFormAs("aircraft-compare-result", { ok: false, error: res.error || "No result." }); return false; }
    try { sessionStorage.setItem(REPORT_KEY, JSON.stringify({ aircraft: res.aircraft, groups: res.groups })); }
    catch (e) {
      replyToFormAs("aircraft-compare-result", { ok: false,
        error: "The browser blocked site storage, so the comparison cannot be shown. Allow it for this site and try again." });
      return false;
    }
    showResult(true);
    replyToFormAs("aircraft-compare-result", { ok: true });
    setAircraft(res.aircraft.map(a => ({ id: a.id, name: a.name })));     // attach them to the chat
    return true;
  }

  /* ---------- patrol planning ---------- */

  function replyToForm(msg) {
    try { formFrame.contentWindow.postMessage(Object.assign({ type: "patrol-result" }, msg), "*"); } catch (e) {}
  }

  async function runPatrol(spec) {
    let resp;
    try {
      resp = await fetch(SKILL_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
        body: JSON.stringify(spec)
      });
    } catch (e) {
      replyToForm({ ok: false, where: "server", error: "Could not reach the server. Check that it is running and try again." });
      return;
    }
    let res = null;
    try { res = await resp.json(); } catch (e) {}
    if (!resp.ok) {
      const why = resp.status === 401 ? "The server did not accept the API key."
                : resp.status === 413 ? "The request was too large."
                : (res && res.detail) ? String(res.detail) : "The server answered with an error (" + resp.status + ").";
      replyToForm({ ok: false, where: "server", error: why });
      return;
    }
    if (!res || !res.ok) {
      replyToForm({ ok: false, where: (res && res.where) || "server", error: (res && res.error) || "No result." });
      return;
    }
    try { sessionStorage.setItem(PLAN_KEY, JSON.stringify(res.payload)); }
    catch (e) {
      replyToForm({ ok: false, where: "timetable",
                    error: "The browser blocked site storage, so the timetable cannot be shown. Allow it for this site and try again." });
      return;
    }
    showResult(true);
    replyToForm({ ok: true });
    try { setPlanText(window.patrolPlanText(spec, res.summary, res.payload)); }       // the timetable works even if this fails
    catch (e) { console.warn("plan description failed", e); }
  }

  window.addEventListener("message", e => {
    if (e.source !== formFrame.contentWindow) return;        // only our own form
    const m = e.data;
    if (!m) return;
    if (m.type === "patrol-solve" && m.spec) runPatrol(m.spec);
    else if (m.type === "aircraft-list") aircraftList();
    else if (m.type === "aircraft-compare" && Array.isArray(m.ids)) aircraftCompare(m.ids);
  });

  /* ---------- the plan inside the chat: chip + text sent with each question ---------- */
  let planText = "", planAttached = false, planChip = null;
  try {
    planText = sessionStorage.getItem(PLAN_TEXT_KEY) || "";
    planAttached = !!planText && sessionStorage.getItem(PLAN_ATTACHED_KEY) !== "0";
  } catch (e) {}

  // called by chatbot_v3.html for every question: the text to send, or "" when no plan is attached
  window.currentPlanContext = () => (planText && planAttached ? planText : "");

  // called by the chat page's "New chat" button: forget the plan and the attached aircraft completely
  // (chips gone, nothing sent with questions) and close the planner question
  window.resetPlanChat = () => {
    planText = ""; planAttached = false; savePlanState(); renderPlanChip();
    airList = []; airAttached = false; saveAircraftState(); renderAircraftChip();
    hideOffer();
  };

  function savePlanState() {
    try { sessionStorage.setItem(PLAN_TEXT_KEY, planText); sessionStorage.setItem(PLAN_ATTACHED_KEY, planAttached ? "1" : "0"); }
    catch (e) {}
  }
  function setPlanText(text) { planText = text; planAttached = true; savePlanState(); renderPlanChip(); detachAircraft(); }
  function detachPlan() { if (planText && planAttached) { planAttached = false; savePlanState(); renderPlanChip(); } }

  const EXPLAIN_QUESTION = "Explain this patrol plan: what it does, why the areas get different numbers of patrols, " +
                           "and how to read the timetable.";

  function renderPlanChip() {
    if (planChip) { planChip.remove(); planChip = null; }
    if (!planText) return;
    planChip = document.createElement("div");
    planChip.id = "planChip";
    planChip.className = "chip" + (planAttached ? "" : " sp-detached");
    const label = document.createElement("span");
    label.textContent = planAttached ? "Patrol plan attached" : "Patrol plan not attached";
    planChip.appendChild(label);
    const btn = (text, title, fn, cls) => {
      const b = document.createElement("button");
      b.type = "button"; b.textContent = text; b.title = title; b.className = cls || "sp-chip-btn"; b.onclick = fn;
      planChip.appendChild(b);
    };
    if (planAttached) {
      btn("Explain this plan", "Ask the chat to explain the plan", () => {
        if (sendBtn.disabled) return;                       // an answer is still streaming
        promptInput.value = EXPLAIN_QUESTION;
        originalSend();                                     // no routing check: this question is about the plan
      });
      btn("×", "Stop sending the plan with my questions", () => { planAttached = false; savePlanState(); renderPlanChip(); }, "x");
    } else {
      btn("Attach again", "Send the plan with my questions again", () => { planAttached = true; savePlanState(); renderPlanChip(); detachAircraft(); });
    }
    $("docChips").parentNode.insertBefore(planChip, $("docChips"));
  }
  renderPlanChip();

  /* ---------- the compared aircraft inside the chat: chip + ids sent with each question ----------
     Only one thing is attached at a time: attaching aircraft detaches the patrol plan, and the other way round. */
  const AIR_LIST_KEY = "aircraftChatList", AIR_ATTACHED_KEY = "aircraftChatAttached";
  let airList = [], airAttached = false, airChip = null;          // airList: [{id, name}]
  try {
    airList = JSON.parse(sessionStorage.getItem(AIR_LIST_KEY) || "[]") || [];
    airAttached = airList.length > 0 && sessionStorage.getItem(AIR_ATTACHED_KEY) !== "0";
  } catch (e) { airList = []; }

  // called by the chat page for every question: the aircraft ids to send, or null when none are attached
  window.currentAircraftContext = () => (airList.length && airAttached ? airList.map(a => a.id) : null);

  function saveAircraftState() {
    try { sessionStorage.setItem(AIR_LIST_KEY, JSON.stringify(airList)); sessionStorage.setItem(AIR_ATTACHED_KEY, airAttached ? "1" : "0"); }
    catch (e) {}
  }
  function setAircraft(list) { airList = list; airAttached = true; saveAircraftState(); renderAircraftChip(); detachPlan(); }
  function detachAircraft() { if (airList.length && airAttached) { airAttached = false; saveAircraftState(); renderAircraftChip(); } }

  const COMPARE_QUESTION = "Compare these aircraft: their main differences in performance, weapons and sensors, " +
                           "what each is best suited for, and their limitations.";
  const DESCRIBE_QUESTION = "Describe this aircraft: its role, main capabilities, weapons and sensors, how India uses it, " +
                            "and its limitations.";

  function renderAircraftChip() {
    if (airChip) { airChip.remove(); airChip = null; }
    if (!airList.length) return;
    airChip = document.createElement("div");
    airChip.id = "aircraftChip";
    airChip.className = "chip" + (airAttached ? "" : " sp-detached");
    const label = document.createElement("span");
    const names = airList.map(a => a.name).join(", ");
    label.textContent = (airAttached ? "Aircraft attached: " : "Aircraft not attached: ") + names;
    airChip.appendChild(label);
    const btn = (text, title, fn, cls) => {
      const b = document.createElement("button");
      b.type = "button"; b.textContent = text; b.title = title; b.className = cls || "sp-chip-btn"; b.onclick = fn;
      airChip.appendChild(b);
    };
    if (airAttached) {
      const one = airList.length === 1;
      btn(one ? "Describe this aircraft" : "Compare these aircraft",
          one ? "Ask the chat to describe the aircraft" : "Ask the chat to compare the aircraft", () => {
        if (sendBtn.disabled) return;                       // an answer is still streaming
        promptInput.value = one ? DESCRIBE_QUESTION : COMPARE_QUESTION;
        originalSend();                                     // no routing check: this question is about the aircraft
      });
      btn("×", "Stop sending these aircraft with my questions", () => { airAttached = false; saveAircraftState(); renderAircraftChip(); }, "x");
    } else {
      btn("Attach again", "Send these aircraft with my questions again", () => { airAttached = true; saveAircraftState(); renderAircraftChip(); detachPlan(); });
    }
    $("docChips").parentNode.insertBefore(airChip, $("docChips"));
  }
  renderAircraftChip();

  /* ---------- guide text (fixed text, shown in the panel and in the "Open the planner?" question) ---------- */
  const GUIDES = {
    patrol_planning: {
      title: "Patrol planner",
      what: "Plans patrol sorties for a fleet of aircraft that guard a set of areas, over one planning period (for example 24 hours) that then repeats. " +
            "The planner is built on a Stackelberg game: you commit to a randomised patrol plan, and an adversary then strikes wherever you are weakest. " +
            "It looks for the plan that makes that worst case as good as it can be.",
      how: [
        "Step 1: splits the fleet's flying hours between the kinds of area so that the worst case is as good as possible. The most valuable area does not automatically get the most patrols, because the split is set by that worst-case rule and not by value alone.",
        "Step 2: turns each share of hours into patrols. When a share is not a whole number of patrols (say 2.5), the planner offers several plans, rounding down in some and up in others, each with a probability, so that on average the share is met.",
        "Step 3: builds a timetable for each plan. Start times are drawn at random so the pattern is hard to predict, and each patrol is given an aircraft that has flying hours left and has had its turnaround rest."
      ],
      read: [
        "Coverage: the chance that an area is protected at a given moment. A patrol protects its area for the patrol time plus the secure period that follows.",
        "Patrol interval: the planning period divided by the number of patrols.",
        "Longest unwatched stretch: the longest an area could go without protection if the random start times fall badly.",
        "Game value: the worst case the planner could reach. Higher is better, and 0 means break-even.",
        "Plans: the hours, patrols and coverage per area are averages over the plans. Use the Plan menu above the chart to look at each plan."
      ],
      inputs: [
        "Aircraft in the fleet: how many airframes are available.",
        "Flying hours per aircraft: per planning period, per aircraft.",
        "Planning period (hours): 24 for a day, 720 for a month. The schedule repeats.",
        "Patrol duration (hours): flying hours consumed by one patrol.",
        "Secure period after a patrol (hours): how long an area stays covered once a patrol ends.",
        "Turnaround (hours): minimum rest before the same aircraft flies again.",
        "Areas to cover: a name, how many of that kind, and a value. The value is relative importance; only the ratios between areas matter.",
        "Randomisation seed (optional): start times are drawn at random, change this for a different draw."
      ],
      assumptions: "Note: the form has one value of flying hours for all aircraft, and no travel time between bases and areas.",
      after: "After you generate a plan you can ask the chat questions about it, for example how many patrols an area gets or when an aircraft flies. " +
             "The answers use the numbers from your plan. To ask something unrelated, or to plan again for a different fleet, click the \u00d7 next to \u201cPatrol plan attached\u201d above the message box."
    },
    aircraft_specs: {
      title: "Aircraft specifications",
      what: "Shows the specifications of Indian military aircraft side by side, from an aircraft library prepared beforehand. " +
            "You can look at one aircraft or compare up to four.",
      how: [
        "Choose one to four aircraft in Inputs. They are listed by category.",
        "Press Show comparison. The table lists 26 criteria in seven groups: general, dimensions and weights, propulsion, performance, systems, armament, and transport.",
        "Every value names its public source. The numbers in brackets point to the source list under the table."
      ],
      read: [
        "Not published: none of the sources used gives this figure.",
        "Not applicable: the criterion does not apply to this aircraft, for example troops for a fighter.",
        "Notes give the conditions behind a value, such as \u201cferry range with three drop tanks\u201d, and say where sources disagree. Use Show notes to hide or show them.",
        "Download CSV saves the table for a spreadsheet."
      ],
      inputs: [
        "The aircraft to compare, up to four."
      ],
      assumptions: "Note: the library holds public figures only. Figures for Indian variants can differ from published figures, and some figures are old. Check the source before relying on a number."
    }
  };

  function guideNode(g) {
    const box = document.createElement("div");
    box.className = "sp-guide-text";
    const add = (tag, text, parent) => { const e = document.createElement(tag); e.textContent = text; (parent || box).appendChild(e); return e; };
    const list = (items, tag) => { const l = document.createElement(tag || "ul"); items.forEach(t => add("li", t, l)); box.appendChild(l); };
    add("h4", "What it does");  add("p", g.what);
    add("h4", "How it works");  list(g.how, "ol");
    if (g.read) { add("h4", "Reading the results"); list(g.read); }
    add("h4", "What you need to provide"); list(g.inputs);
    add("p", g.assumptions).className = "sp-assume";
    if (g.after) add("h4", "After the plan is made"), add("p", g.after);
    return box;
  }
  $("skillSelect").onchange = e => switchSkill(e.target.value);
  if (skill !== "patrol_planning") switchSkill(skill);                   // the skill chosen earlier in this tab
  else $("guideBody").appendChild(guideNode(GUIDES.patrol_planning));

  /* ---------- routing: ask the server which skill a typed message needs ---------- */
  const ROUTE_URL = CHAT_URL.replace(/\/chat$/, "/skills/route");
  const ROUTE_TIMEOUT_MS = 5000;
  let offerBox = null, routing = false;

  function hideOffer() { if (offerBox) { offerBox.remove(); offerBox = null; } }

  async function askRouter(text) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ROUTE_TIMEOUT_MS);
    try {
      const r = await fetch(ROUTE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
        body: JSON.stringify({ message: text }),
        signal: ctrl.signal
      });
      if (!r.ok) return { skill: "none" };
      const j = await r.json();
      if (!j || typeof j.skill !== "string") return { skill: "none" };
      const ids = Array.isArray(j.aircraft_ids) ? j.aircraft_ids.slice(0, 4) : [];
      const names = Array.isArray(j.aircraft_names) && j.aircraft_names.length === ids.length ? j.aircraft_names : ids;
      return { skill: j.skill, ids, names };
    } catch (e) {
      return { skill: "none" };            // server unreachable or too slow: just answer normally
    } finally {
      clearTimeout(timer);
    }
  }

  const andJoin = a => a.length < 2 ? a.join("") : a.slice(0, -1).join(", ") + " and " + a[a.length - 1];

  // What the offer says and what "yes" does, per skill
  function offerText(route) {
    if (route.skill === "patrol_planning")
      return { q: "This looks like a patrol-planning problem. Open the planner?", yes: "Open planner" };
    if (route.ids.length > 1)
      return { q: "Compare " + andJoin(route.names) + " in the side panel?", yes: "Open comparison" };
    if (route.ids.length === 1)
      return { q: "Show the specifications of " + route.names[0] + " in the side panel?", yes: "Open specifications" };
    return { q: "This looks like an aircraft specifications question. Open the aircraft picker?", yes: "Open picker" };
  }

  function openSkill(name) {
    switchSkill(name);                          // also reloads the form, so the picker reads its ticked aircraft
    if (panel.hidden) openPanel();
  }

  async function acceptOffer(route) {
    if (route.skill === "patrol_planning") {
      promptInput.value = "";
      status.textContent = "Patrol planner opened.";
      openSkill("patrol_planning");
      return;
    }
    if (!route.ids.length) {                    // no library aircraft named: let the user pick
      status.textContent = "Pick the aircraft and press Compare. Your question stays in the box.";
      openSkill("aircraft_specs");
      return;
    }
    try { sessionStorage.setItem("aircraftSelected", JSON.stringify(route.ids)); } catch (e) {}
    openSkill("aircraft_specs");
    status.textContent = "Comparing…";
    const ok = await aircraftCompare(route.ids);   // shows the report and attaches the aircraft to the chat
    if (!ok) { status.textContent = "The comparison could not be made. Your question stays in the box."; return; }
    status.textContent = "";
    originalSend();                             // the typed question, now answered with the aircraft attached
  }

  function showOffer(route) {
    hideOffer();
    const t = offerText(route);
    offerBox = document.createElement("div");
    offerBox.id = "skillOffer";
    const q = document.createElement("div");
    q.className = "sp-offer-q";
    q.textContent = t.q;
    const row = document.createElement("div");
    row.className = "sp-offer-btns";
    const yes = document.createElement("button"); yes.textContent = t.yes; yes.className = "sp-yes";
    const no = document.createElement("button");  no.textContent = "No, just answer";
    row.appendChild(yes); row.appendChild(no);
    offerBox.appendChild(q);
    offerBox.appendChild(row);                       // buttons right under the question, the guide below them
    offerBox.appendChild(guideNode(GUIDES[route.skill]));
    $("docChips").parentNode.insertBefore(offerBox, $("docChips"));
    chatWindow.scrollTop = chatWindow.scrollHeight;
    yes.onclick = () => { hideOffer(); acceptOffer(route); };
    no.onclick = () => { hideOffer(); originalSend(); };       // the typed text is still in the box
  }

  // Wrap the chat page's own sendMessage(). The Send button and the Enter key call it by name,
  // so both go through this. The original function is kept and called unchanged.
  const originalSend = sendMessage;
  sendMessage = async function () {
    if (routing) return;
    hideOffer();
    const text = promptInput.value.trim();
    if (!text || sendBtn.disabled) return originalSend();      // empty box, or an answer is still streaming
    if (window.currentPlanContext()) return originalSend();    // a plan is attached: the question is about it, no routing
    if (window.currentAircraftContext()) return originalSend(); // aircraft are attached: same, no routing
    routing = true;
    let route = { skill: "none" };
    try { route = await askRouter(text); } finally { routing = false; }
    if (GUIDES[route.skill]) { showOffer(route); return; }
    return originalSend();
  };
})();
