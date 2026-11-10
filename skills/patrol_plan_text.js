/* fauji.ai: turns a patrol-planner result into a short plain-text description for the chat.

   patrolPlanText(spec, summary, payload) -> string

   spec     what the form sent (N, F, T, tau_p, tau_s, tau_r, seed, types)
   summary  res.summary from POST /skills/patrol_planning/run
   payload  res.payload from the same reply (strategies, sorties, aircraft)

   Every number in the text is copied from those three objects: nothing is calculated here except
   formatting (rounding to 3 decimals, minutes -> hh:mm). The server (plan_chat.py) shortens the text when it
   is too long by dropping lines that start with "Timetable" and everything after them, last plan first,
   so the timetables stay at the END of the text. No network access; works in a browser and in Node. */

(function (root) {
  const MAX_AIRCRAFT_LISTED = 40;

  function num(x) {                                   // 9.6000000001 -> "9.6", 5 -> "5"
    if (x === null || x === undefined || x === "") return "n/a";
    const v = Number(x);
    if (!isFinite(v)) return String(x);
    return String(Math.round(v * 1000) / 1000);
  }
  function hhmm(t) {                                  // hours since the start of the period -> "09:31"
    const m = Math.round(Number(t) * 60);
    const h = Math.floor(m / 60), mm = m % 60;
    return (h < 10 ? "0" : "") + h + ":" + (mm < 10 ? "0" : "") + mm;
  }
  function plural(n, one, many) { return num(n) + " " + (Number(n) === 1 ? one : many); }

  function patrolPlanText(spec, summary, payload) {
    const L = [];
    const s = spec || {}, sm = summary || {}, pl = payload || {};

    L.push("Inputs: " + plural(s.N, "aircraft", "aircraft") + ", " + num(s.F) +
           " flying hours per aircraft per planning period, planning period " + num(s.T) + " h.");
    L.push("Patrol duration " + num(s.tau_p) + " h, secure period after a patrol " + num(s.tau_s) +
           " h, turnaround " + num(s.tau_r) + " h. Random seed " + num(s.seed) + ".");
    if (Array.isArray(s.types) && s.types.length) {
      L.push("Areas: " + s.types.map(t =>
        t.name + " (" + plural(t.n_k, "area", "areas") + ", value " + num(t.v_k) + ")").join("; ") + ".");
    }
    L.push("");

    L.push("Game value z*: " + num(sm.zStar) +
           " (for every area kind that gets patrols, value x (2 x coverage - 1) comes out at this number).");
    L.push("Flying-hour allocation per kind of area (all areas of the kind together, per planning period):");
    (sm.allocation || []).forEach(a => {
      if (!a.active) {
        L.push("- " + a.name + ": no flying hours and no patrols (see the notes below).");
        return;
      }
      L.push("- " + a.name + ": " + num(a.hours) + " flying hours, " + num(a.patrols) + " patrols" +
             (a.interval ? " (one every " + num(a.interval) + " h)" : "") +
             ", coverage " + num(a.coverage) +
             (a.worstGap ? ", longest unwatched stretch " + num(a.worstGap) + " h" : "") +
             ", value x (2 x coverage - 1) = " + num(a.ud));
    });
    if (sm.derived) {
      L.push("Total patrols per planning period: " + num(sm.derived.N_srt) +
             ". Usable flying hours: " + num(sm.derived.B_eff) + " of " + num(sm.derived.B) + ".");
    }
    if (sm.fleet) {
      const f = sm.fleet;
      L.push("Fleet size: " + num(f.actual) + " aircraft available. Smallest fleet for zero loss (coverage 0.5): " +
             num(f.nMinHalf) + ", counting whole patrols per aircraft: " + num(f.nMinHalfCorrected) +
             ". Smallest fleet for full coverage (1.0): " + num(f.nMinFull) +
             ", counting whole patrols per aircraft: " + num(f.nMinFullCorrected) +
             ". Highest coverage this fleet can reach: " + num(f.maxCoverage) + ".");
    }
    L.push("");

    const strategies = pl.strategies || [];
    L.push("Plans: " + plural(strategies.length, "plan", "plans") +
           ". One plan is chosen at random each period with the probability shown. " +
           "Patrol counts below are whole patrols per planning period for all areas of that kind together.");
    strategies.forEach((st, i) => {
      L.push("Plan " + (i + 1) + ", probability " + num(st.prob) + ": " + st.label + ".");
      (st.barriers || []).forEach(b => {
        L.push("  " + b.key + ": " + plural(b.q, "patrol", "patrols") +
               (b.delta ? ", one every " + num(b.delta) + " h" : "") + ", coverage " + num(b.cov));
      });
    });

    if ((sm.notes || []).length) {
      L.push("");
      L.push("Notes from the planner:");
      sm.notes.forEach(n => L.push("- " + n));
    }

    // Timetables last: the server drops them first when the text is too long.
    strategies.forEach((st, i) => {
      const byAc = new Map();
      (st.aircraft || []).forEach(a => byAc.set(a.name, { info: a, sorties: [] }));
      (st.sorties || []).slice().sort((x, y) => x.t - y.t).forEach(o => {
        if (!byAc.has(o.ac)) byAc.set(o.ac, { info: { name: o.ac }, sorties: [] });
        byAc.get(o.ac).sorties.push(hhmm(o.t) + " " + o.type + "#" + o.bid);
      });
      L.push("");
      L.push("Timetable for Plan " + (i + 1) + " (each line is one aircraft; times are hours:minutes from the start of the planning period):");
      const entries = Array.from(byAc.values());
      entries.slice(0, MAX_AIRCRAFT_LISTED).forEach(e => {
        const hrs = e.info.hours !== undefined ? ", " + num(e.info.hours) + " flying hours" : "";
        L.push(e.info.name + " (" + plural(e.sorties.length, "patrol", "patrols") + hrs + "): " +
               (e.sorties.length ? e.sorties.join(", ") : "does not fly"));
      });
      if (entries.length > MAX_AIRCRAFT_LISTED) {
        L.push("... and " + (entries.length - MAX_AIRCRAFT_LISTED) + " more aircraft not listed.");
      }
    });
    return L.join("\n");
  }

  root.patrolPlanText = patrolPlanText;
  if (typeof module !== "undefined" && module.exports) module.exports = { patrolPlanText };
})(typeof window !== "undefined" ? window : globalThis);
