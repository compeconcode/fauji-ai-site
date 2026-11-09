/* Patrol planner form (shown inside the chat page's side panel).
   Reused from the Patrol Planner project's app.js, without the in-browser Python:
   pressing "Generate timetable" sends the inputs to the chat page (skills_panel.js),
   which calls the fauji.ai server and answers with {type:"patrol-result", ok, where, error}.
   The form values are kept in sessionStorage so a page refresh does not lose them. */

const KEEP = "patrolForm";
const $ = id => document.getElementById(id);

const esc = s => String(s).replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ---------------------------------------------------------------- areas */
function areaRow(name = "", n_k = 1, v_k = 1) {
  const d = document.createElement("div");
  d.className = "arow";
  d.innerHTML = `
    <div class="f"><input type="text" class="a-name" placeholder="e.g. Sector A" value="${esc(name)}" required></div>
    <div class="f"><input type="number" class="a-n" min="1" step="1" value="${n_k}" required></div>
    <div class="f"><input type="number" class="a-v" min="0" step="any" value="${v_k}" required></div>
    <button type="button" class="rm" title="Remove" aria-label="Remove area">&times;</button>`;
  d.querySelector(".rm").onclick = () => {
    if ($("areas").querySelectorAll(".arow:not(.hdr)").length > 1) { d.remove(); save(); }
  };
  return d;
}

function setAreas(list) {
  $("areas").querySelectorAll(".arow:not(.hdr)").forEach(n => n.remove());
  list.forEach(a => $("areas").appendChild(areaRow(a.name, a.n_k, a.v_k)));
}

/* ---------------------------------------------------------------- form <-> object */
function readForm() {
  const rows = [...$("areas").querySelectorAll(".arow:not(.hdr)")];
  return {
    N: +$("N").value, F: +$("F").value, T: +$("T").value,
    tau_p: +$("tau_p").value, tau_s: +$("tau_s").value, tau_r: +$("tau_r").value,
    seed: Math.trunc(+$("seed").value) || 0,
    types: rows.map(r => ({
      name: r.querySelector(".a-name").value.trim(),
      n_k: +r.querySelector(".a-n").value,
      v_k: +r.querySelector(".a-v").value
    }))
  };
}

function fillForm(s) {
  ["N", "F", "T", "tau_p", "tau_s", "tau_r", "seed"].forEach(k => { if (s[k] !== undefined) $(k).value = s[k]; });
  if (Array.isArray(s.types) && s.types.length) setAreas(s.types);
}

function save() {
  try { sessionStorage.setItem(KEEP, JSON.stringify(readForm())); } catch (e) {}
}

/* ---------------------------------------------------------------- errors */
function showError(where, msg) {
  $("errWhere").textContent = ({
    input: "Check the inputs", allocation: "Could not work out an allocation",
    mixing: "Could not build a mix", timetable: "Could not build a timetable",
    server: "Server problem"
  })[where] || "Problem";
  $("errMsg").textContent = msg;
  $("errBox").classList.remove("hidden");
  $("errBox").scrollIntoView({ behavior: "smooth", block: "center" });
}

/* ---------------------------------------------------------------- send / receive */
let label = $("go").textContent;

function busy(on) {
  $("go").disabled = on;
  $("go").textContent = on ? "Working…" : label;
}

$("form").addEventListener("submit", ev => {
  ev.preventDefault();
  $("errBox").classList.add("hidden");
  if (window.parent === window) {
    showError("server", "This form works inside the fauji.ai chat page (Skills button).");
    return;
  }
  busy(true);
  window.parent.postMessage({ type: "patrol-solve", spec: readForm() }, "*");
});

window.addEventListener("message", e => {
  if (e.source !== window.parent) return;          // only the chat page that contains this form
  const m = e.data;
  if (!m || m.type !== "patrol-result") return;
  busy(false);
  if (!m.ok) showError(m.where, m.error);
});

/* ---------------------------------------------------------------- buttons */
$("addArea").onclick = () => { $("areas").appendChild(areaRow("", 1, 1)); save(); };
$("reset").onclick = () => {
  $("errBox").classList.add("hidden");
  setAreas([{ name: "", n_k: 1, v_k: 1 }]);
  save();
};
$("example").onclick = () => {
  fillForm({ N: 2, F: 6, T: 24, tau_p: 2, tau_s: 4, tau_r: 4, seed: 0,
             types: [{ name: "High", n_k: 1, v_k: 6 }, { name: "Medium", n_k: 1, v_k: 2 }] });
  $("errBox").classList.add("hidden");
  save();
};
$("form").addEventListener("input", save);

/* ---------------------------------------------------------------- start */
setAreas([{ name: "High", n_k: 1, v_k: 6 }, { name: "Medium", n_k: 1, v_k: 2 }]);
try { const kept = JSON.parse(sessionStorage.getItem(KEEP) || "null"); if (kept) fillForm(kept); } catch (e) {}
