const $ = i => document.getElementById(i);
firebase.initializeApp(FIREBASE_CONFIG);
const db = firebase.database();
const P = PUZZLE, SOL = P.solution, KEYS = [];
for (let r = 1; r <= 7; r++) for (let c = 1; c <= 7; c++) KEYS.push(`r${r}c${c}`);
const byId = Object.fromEntries(P.people.map(p => [p.id, p]));
const S = {code:null, name:"", teacher:false, meta:{}, cells:{}, players:{}, sel:null,
  pid:Math.random().toString(36).slice(2,10), prev:{}, dismissed:null, listening:false};
const R = p => db.ref(`rooms/${S.code}/${p}`);
const SCREENS = ["home","join","lobby","wait","game"];
const show = id => SCREENS.forEach(s => $(s).hidden = s !== id);
const link = () => location.origin + location.pathname + "?sala=" + S.code;
const clean = s => s.replace(/[<>&"']/g, "").trim();

// ---------- Pantalla inicial ----------
$("btnShowCreate").onclick = () => { $("createBox").hidden = false; $("tkey").focus(); };
$("btnShowJoin").onclick = () => show("join");
$("btnCreate").onclick = async () => {
  if ($("tkey").value !== TEACHER_KEY) { $("homeErr").textContent = "Clave de docente incorrecta."; return; }
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let i = 0; i < 10; i++) {
    const code = Array.from({length:4}, () => chars[Math.floor(Math.random()*chars.length)]).join("");
    const snap = await db.ref(`rooms/${code}/meta`).get();
    if (!snap.exists()) {
      S.code = code; S.teacher = true; S.name = "Docente";
      await R("meta").set({locked:false, started:false, solved:false, ended:false, reveal:false, epoch:0, created:Date.now()});
      return enter();
    }
  }
};
$("btnJoin").onclick = async () => {
  const code = $("jcode").value.trim().toUpperCase(), name = clean($("jname").value);
  if (!code || !name) { $("joinErr").textContent = "Escribí el código y tu nombre."; return; }
  const snap = await db.ref(`rooms/${code}/meta`).get();
  if (!snap.exists()) { $("joinErr").textContent = "Esa partida no existe."; return; }
  S.code = code; S.name = name; S.teacher = $("jkey").value === TEACHER_KEY && $("jkey").value !== "";
  sessionStorage.setItem("mk_name", name); enter();
};
const q = new URLSearchParams(location.search).get("sala");
if (q) { $("jcode").value = q.toUpperCase(); $("jname").value = sessionStorage.getItem("mk_name") || ""; show("join"); }

// ---------- Conexión y sincronización ----------
function enter() {
  $("roomTag").textContent = "Sala " + S.code;
  db.ref(".info/connected").on("value", s => {           // se reanuda solo tras cortes de red
    if (!s.val()) return;
    const me = R("players/" + S.pid);
    me.onDisconnect().remove();
    me.set({n:S.name, d:S.teacher});
  });
  R("").on("value", snap => {
    const v = snap.val();
    if (!v || !v.meta) { $("homeErr").textContent = ""; alert("La partida ya no existe."); location.href = location.pathname; return; }
    S.meta = v.meta; S.cells = v.cells || {}; S.players = v.players || {};
    render();
  });
}

function setCell(key, val) {
  if (!key || P.rocks.includes(key) || S.meta.locked || S.meta.ended) return;
  if (val === "") R("cells/" + key).remove();
  else R("cells/" + key).set({v:val, by:S.name});          // última escritura gana
}

// ---------- Tablero ----------
const board = $("board"), cellEls = {};
(function build() {
  board.appendChild(Object.assign(document.createElement("div"), {className:"lab"}));
  for (let c = 1; c <= 7; c++) board.appendChild(Object.assign(document.createElement("div"), {className:"lab", textContent:"C" + c}));
  for (let r = 1; r <= 7; r++) {
    board.appendChild(Object.assign(document.createElement("div"), {className:"lab", textContent:"F" + r}));
    for (let c = 1; c <= 7; c++) {
      const k = `r${r}c${c}`, room = P.rooms[r-1][c-1], b = document.createElement("button");
      b.className = "cell " + room + (P.rocks.includes(k) ? " rock" : "");
      const diff = (rr, cc) => rr < 1 || cc < 1 || rr > 7 || cc > 7 || P.rooms[rr-1][cc-1] !== room;
      b.style.borderTop = (diff(r-1,c) ? "4px solid #222" : "1px solid #fff9");
      b.style.borderBottom = (diff(r+1,c) ? "4px solid #222" : "1px solid #fff9");
      b.style.borderLeft = (diff(r,c-1) ? "4px solid #222" : "1px solid #fff9");
      b.style.borderRight = (diff(r,c+1) ? "4px solid #222" : "1px solid #fff9");
      b.title = `F${r} C${c}`;
      b.innerHTML = `<span class="ic">${P.rocks.includes(k) ? "🪨" : (P.icons[k] || "")}</span><span class="tok"></span>`;
      b.onclick = () => select(k);
      board.appendChild(b); cellEls[k] = b;
    }
  }
  $("picker").innerHTML = P.people.map(p => `<button data-id="${p.id}"><b style="background:${p.color}">${p.id}</b>${p.name}</button>`).join("") +
    `<button data-id="" style="grid-column:span 2">⌫ Borrar</button>`;
  $("picker").onclick = e => { const b = e.target.closest("button"); if (b) setCell(S.sel, b.dataset.id); };
  $("clues").innerHTML = P.people.map(p => `<li><b style="color:${p.color}">${p.name}</b>: ${p.clue}</li>`).join("");
  $("legend").innerHTML = Object.entries({W:"Estanque",T:"Sala de talla",M:"Sala común",D:"Sala de doma",E:"Entrada"})
    .map(([k,n]) => `<span><i style="background:var(--${k})"></i>${n}</span>`).join("") + "<span>🐟 pescador · 🪓 herramientas · 🏹 cazador · 🐺 domador</span>";
})();

function select(k) {
  if (P.rocks.includes(k)) return;
  S.sel = k; const [, r, c] = k.match(/r(\d)c(\d)/);
  $("selName").textContent = `F${r} · C${c}`;
  KEYS.forEach(x => cellEls[x].classList.toggle("sel", x === k));
}
document.addEventListener("keydown", e => {
  if ($("game").hidden || e.target.tagName === "INPUT" || !S.sel) return;
  const [, r, c] = S.sel.match(/r(\d)c(\d)/), k = e.key.toUpperCase();
  const mv = {ARROWUP:[-1,0],ARROWDOWN:[1,0],ARROWLEFT:[0,-1],ARROWRIGHT:[0,1]}[k];
  if (mv) { e.preventDefault(); const nr = +r+mv[0], nc = +c+mv[1]; if (nr>=1&&nr<=7&&nc>=1&&nc<=7) select(`r${nr}c${nc}`); }
  else if (byId[k]) setCell(S.sel, k);
  else if (["BACKSPACE","DELETE","0"," "].includes(k)) { e.preventDefault(); setCell(S.sel, ""); }
});

// ---------- Dibujar el estado compartido ----------
const chips = o => Object.values(o).map(p => `<span>${p.n}${p.d ? " 👩‍🏫" : ""}</span>`).join("");
function render() {
  const m = S.meta, n = Object.keys(S.players).length;
  if (!m.started && S.teacher) { show("lobby"); $("lcode").textContent = S.code; $("llink").value = link(); $("lcount").textContent = n; $("lplayers").innerHTML = chips(S.players); return; }
  if (!m.started) { show("wait"); $("wplayers").innerHTML = chips(S.players); return; }
  show("game"); $("teacher").hidden = !S.teacher;
  const counts = {};
  KEYS.forEach(k => { const v = S.cells[k] && S.cells[k].v; if (v) counts[v] = (counts[v] || 0) + 1; });
  let filled = 0;
  KEYS.forEach(k => {
    const el = cellEls[k], c = S.cells[k], v = m.reveal ? SOL[k] : (c && c.v);
    const tok = el.querySelector(".tok");
    tok.textContent = v || ""; tok.style.background = v ? byId[v].color : "";
    el.classList.toggle("has", !!v); el.classList.toggle("dup", !m.reveal && !!v && counts[v] > 1);
    if (c && c.v) filled++;
    el.title = c && c.by ? `${byId[c.v].name} — puesto por ${c.by}` : el.title.split(" —")[0];
    if ((S.prev[k] || "") !== (v || "") && c && c.by !== S.name) { el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash"); }
    S.prev[k] = v || "";
  });
  const locked = m.locked || m.ended;
  $("banner").hidden = !locked; $("banner").textContent = m.ended ? "🏁 Partida finalizada" : "🔒 Tablero bloqueado por la docente";
  $("pcount").textContent = n; $("players").innerHTML = chips(S.players);
  $("progress").textContent = `Personajes ubicados: ${filled} de 7`;
  $("tLock").textContent = m.locked ? "🔓 Desbloquear" : "🔒 Bloquear";
  $("tReveal").textContent = m.reveal ? "Ocultar resultado" : "Mostrar resultado";
  if (m.solved && S.dismissed !== m.solvedAt) {
    $("ovT").textContent = "¡Murdoku resuelto! 🎉";
    $("ovP").innerHTML = `¡Excelente trabajo!<br>El asesino es <b>${P.murderer}</b>.<br><small>Comprobado por ${m.solvedBy || "la clase"}</small>`;
    $("overlay").hidden = false;
  } else if (!m.solved) $("overlay").hidden = true;
}
$("ovX").onclick = () => { S.dismissed = S.meta.solvedAt; $("overlay").hidden = true; };

// ---------- Comprobar ----------
$("btnCheck").onclick = () => {
  const cur = {}; KEYS.forEach(k => { if (S.cells[k] && S.cells[k].v) cur[k] = S.cells[k].v; });
  const ok = Object.keys(cur).length === 7 && Object.keys(SOL).every(k => cur[k] === SOL[k]);
  const msg = $("msg");
  if (ok) { msg.className = "msg ok"; msg.textContent = "¡Correcto!"; R("meta").update({solved:true, solvedBy:S.name, solvedAt:Date.now()}); }
  else { msg.className = "msg no"; msg.textContent = Object.keys(cur).length < 7 ? "Todavía faltan personajes por ubicar." : "Todavía hay respuestas incorrectas. ¡Sigan pensando!"; }
};

// ---------- Docente ----------
$("btnCopy").onclick = () => { $("llink").select(); navigator.clipboard.writeText(link()).catch(() => document.execCommand("copy")); $("btnCopy").textContent = "¡Copiado!"; };
$("btnStart").onclick = () => R("meta").update({started:true});
$("tLock").onclick = () => R("meta").update({locked:!S.meta.locked});
$("tReveal").onclick = () => R("meta").update({reveal:!S.meta.reveal});
$("tEnd").onclick = () => confirm("¿Finalizar la partida?") && R("meta").update({ended:true, locked:true});
$("tNew").onclick = () => confirm("¿Crear una partida nueva? (esta seguirá abierta)") && (location.href = location.pathname);
$("tReset").onclick = async () => {
  if (!confirm("¿Reiniciar el tablero para todos?")) return;
  await R("meta").update({locked:false, ended:false, solved:false, reveal:false, solvedAt:null, solvedBy:null, epoch:(S.meta.epoch||0)+1});
  await R("cells").remove(); $("msg").textContent = "";
};
