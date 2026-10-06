const $ = i => document.getElementById(i);

firebase.initializeApp(FIREBASE_CONFIG);
const db = firebase.database();

const P = PUZZLE;
const SOL = P.solution;

const KEYS = [];
for (let r = 1; r <= 7; r++) {
  for (let c = 1; c <= 7; c++) {
    KEYS.push(`r${r}c${c}`);
  }
}

const byId = Object.fromEntries(P.people.map(p => [p.id, p]));

const S = {
  code: null,
  name: "",
  teacher: false,
  meta: {},
  cells: {},
  players: {},
  sel: null,
  pid: Math.random().toString(36).slice(2, 10),
  prev: {},
  dismissed: null,
  listening: false,
  checked: {},
  bed: null
};

const R = p => db.ref(`rooms/${S.code}/${p}`);

const BOARD_PATH = () => `boards/${S.pid}`;

const SCREENS = ["home", "join", "lobby", "wait", "game"];

const show = id => {
  SCREENS.forEach(s => {
    const el = $(s);
    if (el) el.hidden = s !== id;
  });
};

const link = () =>
  location.origin +
  location.pathname +
  "?sala=" +
  S.code;

const clean = s =>
  String(s || "")
    .replace(/[<>&"']/g, "")
    .trim();


// ============================================================
// PANTALLA INICIAL
// ============================================================

$("btnShowCreate").onclick = () => {
  $("createBox").hidden = false;
  $("tkey").focus();
};

$("btnShowJoin").onclick = () => show("join");


$("btnCreate").onclick = async () => {

  if ($("tkey").value !== TEACHER_KEY) {
    $("homeErr").textContent = "Clave de docente incorrecta.";
    return;
  }

  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  for (let i = 0; i < 10; i++) {

    const code = Array.from(
      { length: 4 },
      () => chars[Math.floor(Math.random() * chars.length)]
    ).join("");

    const snap = await db.ref(`rooms/${code}/meta`).get();

    if (!snap.exists()) {

      S.code = code;
      S.teacher = true;
      S.name = "Docente";

      await R("meta").set({
        locked: false,
        started: false,
        ended: false,
        epoch: 0,
        created: Date.now()
      });

      return enter();
    }
  }

  $("homeErr").textContent =
    "No se pudo crear la partida. Intentá nuevamente.";
};


$("btnJoin").onclick = async () => {

  const code = $("jcode").value.trim().toUpperCase();
  const name = clean($("jname").value);

  if (!code || !name) {
    $("joinErr").textContent =
      "Escribí el código y tu nombre.";
    return;
  }

  const snap =
    await db.ref(`rooms/${code}/meta`).get();

  if (!snap.exists()) {
    $("joinErr").textContent =
      "Esa partida no existe.";
    return;
  }

  S.code = code;
  S.name = name;

  S.teacher =
    $("jkey").value === TEACHER_KEY &&
    $("jkey").value !== "";

  sessionStorage.setItem("mk_name", name);

  enter();
};


const q =
  new URLSearchParams(location.search).get("sala");

if (q) {
  $("jcode").value = q.toUpperCase();

  $("jname").value =
    sessionStorage.getItem("mk_name") || "";

  show("join");
}


// ============================================================
// CONEXIÓN Y SINCRONIZACIÓN
// ============================================================

function enter() {

  $("roomTag").textContent =
    "Sala " + S.code;

  db.ref(".info/connected").on("value", s => {

    if (!s.val()) return;

    const me =
      R("players/" + S.pid);

    me.onDisconnect().remove();

    me.set({
      n: S.name,
      d: S.teacher
    });
  });


  // Información GENERAL de la sala.
  // No contiene el tablero de cada estudiante.
  R("").on("value", snap => {

    const v = snap.val();

    if (!v || !v.meta) {

      $("homeErr").textContent = "";

      alert("La partida ya no existe.");

      location.href = location.pathname;

      return;
    }

    S.meta = v.meta;
    S.players = v.players || {};

    render();
  });


  // ==========================================================
  // TABLERO PRIVADO DEL ESTUDIANTE
  // ==========================================================

  R(`${BOARD_PATH()}/cells`).on("value", snap => {

    S.cells = snap.val() || {};

    render();
  });


  // Resultado privado de este estudiante
  R(`${BOARD_PATH()}/checked`).on("value", snap => {

    S.checked = snap.val() || {};

    render();
  });


  // Pieza cama privada
  R(`${BOARD_PATH()}/bed`).on("value", snap => {

    S.bed = snap.val() || null;

    render();
  });
}


// ============================================================
// ESCRIBIR EN EL TABLERO PRIVADO
// ============================================================

function setCell(key, val) {

  if (!key) return;

  if (P.rocks.includes(key)) return;

  if (isFixedSpecialCell(key)) return;

  if (S.meta.locked || S.meta.ended) return;

  if (!val) {
    R(`${BOARD_PATH()}/cells/${key}`).remove();

    clearCheck(key);

    return;
  }

  // Verificar si el personaje puede estar en ese casillero.
  if (!canPlaceCharacter(val, key)) {

    const p = byId[val];

    $("msg").className = "msg no";

    $("msg").textContent =
      `${p ? p.name : "Ese personaje"} no puede colocarse en ese casillero.`;

    return;
  }

  // Cada personaje aparece una sola vez.
  removeCharacterFromOtherCells(val, key);

  R(`${BOARD_PATH()}/cells/${key}`).set({
    v: val
  });

  clearCheck(key);
}


// ============================================================
// QUITAR UN PERSONAJE DE OTRO CASILLERO
// ============================================================

function removeCharacterFromOtherCells(id, exceptKey) {

  Object.entries(S.cells).forEach(([key, obj]) => {

    if (
      key !== exceptKey &&
      obj &&
      obj.v === id
    ) {
      R(`${BOARD_PATH()}/cells/${key}`).remove();
      clearCheck(key);
    }
  });
}


// ============================================================
// RESTRICCIONES DE COLOCACIÓN
// ============================================================

function getCellIcon(key) {
  return P.icons[key] || "";
}


/*
  Reglas:

  Arok = A = domador de lobos
  Branuk = B = pescador
  Clega = C = fabricante de herramientas
  Fegu = F = cazador

  Daki = D debe estar en sala de talla
  Evka = E queda libre respecto del tipo de objeto
  Velok = V queda libre

  Esto permite que las pistas sigan siendo parte del razonamiento
  y no convierta todas las respuestas en automáticas.
*/

function canPlaceCharacter(id, key) {

  const room =
    P.rooms[
      Number(key.match(/r(\d+)/)[1]) - 1
    ][
      Number(key.match(/c(\d+)/)[1]) - 1
    ];

  const icon = getCellIcon(key);

  switch (id) {

    // Arok: domador de lobos
    case "A":
      return icon === "🐺";

    // Branuk: pescador
    case "B":
      return icon === "🐟";

    // Clega: fabricante de herramientas
    case "C":
      return icon === "🪓";

    // Daki: sala de talla
    case "D":
      return room === "T";

    // Fegu: cazador
    case "F":
      return icon === "🏹";

    // Evka
    case "E":
      return true;

    // Velok, víctima
    case "V":
      return true;

    default:
      return false;
  }
}


// ============================================================
// CASILLEROS ESPECIALES
// ============================================================

function isFixedSpecialCell(key) {

  /*
    Piedras
  */
  if (P.rocks.includes(key)) {
    return true;
  }

  /*
    Árbol y huesos quedan bloqueados.
  */
  const icon = getCellIcon(key);

  if (icon === "🌳") return true;
  if (icon === "🦴") return true;

  return false;
}


// ============================================================
// TABLERO
// ============================================================

const board = $("board");
const cellEls = {};

(function build() {

  board.appendChild(
    Object.assign(
      document.createElement("div"),
      {
        className: "lab"
      }
    )
  );

  for (let c = 1; c <= 7; c++) {

    board.appendChild(
      Object.assign(
        document.createElement("div"),
        {
          className: "lab",
          textContent: "C" + c
        }
      )
    );
  }


  for (let r = 1; r <= 7; r++) {

    board.appendChild(
      Object.assign(
        document.createElement("div"),
        {
          className: "lab",
          textContent: "F" + r
        }
      )
    );


    for (let c = 1; c <= 7; c++) {

      const k = `r${r}c${c}`;

      const room =
        P.rooms[r - 1][c - 1];

      const b =
        document.createElement("button");

      const blocked =
        isFixedSpecialCell(k);

      b.className =
        "cell " +
        room +
        (blocked ? " rock" : "");


      const diff = (rr, cc) =>
        rr < 1 ||
        cc < 1 ||
        rr > 7 ||
        cc > 7 ||
        P.rooms[rr - 1][cc - 1] !== room;


      b.style.borderTop =
        diff(r - 1, c)
          ? "4px solid #222"
          : "1px solid #fff9";

      b.style.borderBottom =
        diff(r + 1, c)
          ? "4px solid #222"
          : "1px solid #fff9";

      b.style.borderLeft =
        diff(r, c - 1)
          ? "4px solid #222"
          : "1px solid #fff9";

      b.style.borderRight =
        diff(r, c + 1)
          ? "4px solid #222"
          : "1px solid #fff9";


      b.title =
        `F${r} C${c}`;


      let fixedIcon = "";

      if (P.rocks.includes(k)) {
        fixedIcon = "🪨";
      }
      else if (P.icons[k]) {
        fixedIcon = P.icons[k];
      }


      b.innerHTML =
        `<span class="ic">${fixedIcon}</span>` +
        `<span class="tok"></span>`;


      b.onclick = () => {

        if (blocked) return;

        select(k);
      };


      board.appendChild(b);

      cellEls[k] = b;
    }
  }


  // ==========================================================
  // PERSONAJES
  // ==========================================================

  $("picker").innerHTML =

    P.people.map(p => {

      return `
        <button data-id="${p.id}">
          <b style="background:${p.color}">
            ${p.id}
          </b>
          ${p.name}
        </button>
      `;
    }).join("")

    +

    `
      <button
        data-id=""
        style="grid-column:span 2"
      >
        ⌫ Borrar
      </button>
    `;


  $("picker").onclick = e => {

    const b =
      e.target.closest("button");

    if (!b) return;

    if (!S.sel) {

      $("msg").className = "msg no";

      $("msg").textContent =
        "Primero seleccioná un casillero.";

      return;
    }

    setCell(
      S.sel,
      b.dataset.id
    );
  };


  // ==========================================================
  // PISTAS
  // ==========================================================

  $("clues").innerHTML =
    P.people.map(p => {

      return `
        <li>
          <b style="color:${p.color}">
            ${p.name}
          </b>:
          ${p.clue}
        </li>
      `;

    }).join("");


  // ==========================================================
  // LEYENDA
  // ==========================================================

  $("legend").innerHTML =

    Object.entries({
      W: "Estanque",
      T: "Sala de talla",
      M: "Sala común",
      D: "Sala de doma",
      E: "Entrada"
    })

    .map(([k, n]) => {

      return `
        <span>
          <i style="background:var(--${k})"></i>
          ${n}
        </span>
      `;

    }).join("")

    +

    `
      <span>
        🐟 pescador ·
        🪓 herramientas ·
        🏹 cazador ·
        🐺 domador
      </span>
    `;
})();


// ============================================================
// SELECCIONAR CASILLERO
// ============================================================

function select(k) {

  if (isFixedSpecialCell(k)) return;

  S.sel = k;

  const match =
    k.match(/r(\d)c(\d)/);

  if (!match) return;

  const [, r, c] = match;

  $("selName").textContent =
    `F${r} · C${c}`;


  KEYS.forEach(x => {

    cellEls[x].classList.toggle(
      "sel",
      x === k
    );
  });
}


// ============================================================
// TECLADO
// ============================================================

document.addEventListener("keydown", e => {

  if (
    $("game").hidden ||
    e.target.tagName === "INPUT" ||
    !S.sel
  ) {
    return;
  }


  const match =
    S.sel.match(/r(\d)c(\d)/);

  if (!match) return;

  const [, r, c] = match;

  const k =
    e.key.toUpperCase();


  const mv = {
    ARROWUP: [-1, 0],
    ARROWDOWN: [1, 0],
    ARROWLEFT: [0, -1],
    ARROWRIGHT: [0, 1]
  }[k];


  if (mv) {

    e.preventDefault();

    const nr =
      +r + mv[0];

    const nc =
      +c + mv[1];


    if (
      nr >= 1 &&
      nr <= 7 &&
      nc >= 1 &&
      nc <= 7
    ) {

      const nk =
        `r${nr}c${nc}`;

      if (!isFixedSpecialCell(nk)) {
        select(nk);
      }
    }

    return;
  }


  if (byId[k]) {

    setCell(
      S.sel,
      k
    );

    return;
  }


  if (
    [
      "BACKSPACE",
      "DELETE",
      "0",
      " "
    ].includes(k)
  ) {

    e.preventDefault();

    setCell(
      S.sel,
      ""
    );
  }
});


// ============================================================
// JUGADORES
// ============================================================

const chips = o =>

  Object.values(o)
    .map(p =>
      `<span>${p.n}${p.d ? " 👩‍🏫" : ""}</span>`
    )
    .join("");


// ============================================================
// CANTIDADES
// ============================================================

function renderQuantities() {

  const quantityBox =
    $("quantities");

  if (!quantityBox) return;


  quantityBox.innerHTML =
    P.people.map(p => {

      return `
        <div class="quantity">
          <b style="color:${p.color}">
            ${p.name}
          </b>
          : 1
        </div>
      `;

    }).join("");
}


// ============================================================
// ESTADO DEL TABLERO
// ============================================================

function render() {

  const m = S.meta;

  const n =
    Object.keys(S.players).length;


  // ==========================================================
  // DOCENTE: LOBBY
  // ==========================================================

  if (!m.started && S.teacher) {

    show("lobby");

    $("lcode").textContent =
      S.code;

    $("llink").value =
      link();

    $("lcount").textContent =
      n;

    $("lplayers").innerHTML =
      chips(S.players);

    return;
  }


  // ==========================================================
  // ESTUDIANTE ESPERANDO
  // ==========================================================

  if (!m.started) {

    show("wait");

    $("wplayers").innerHTML =
      chips(S.players);

    return;
  }


  // ==========================================================
  // JUEGO
  // ==========================================================

  show("game");

  $("teacher").hidden =
    !S.teacher;


  renderQuantities();


  let filled = 0;


  // ==========================================================
  // DIBUJAR TABLERO
  // ==========================================================

  KEYS.forEach(k => {

    const el =
      cellEls[k];

    if (!el) return;


    const obj =
      S.cells[k];

    const v =
      obj && obj.v
        ? obj.v
        : "";


    const tok =
      el.querySelector(".tok");


    tok.textContent =
      v || "";


    tok.style.background =
      v && byId[v]
        ? byId[v].color
        : "";


    el.classList.toggle(
      "has",
      !!v
    );


    // Duplicados: no debería ocurrir porque
    // el código elimina automáticamente el anterior.
    const duplicate =
      Object.values(S.cells)
        .filter(x => x && x.v === v)
        .length > 1;


    el.classList.toggle(
      "dup",
      !!v && duplicate
    );


    if (v) filled++;


    // ========================================================
    // RESULTADO DE COMPROBACIÓN
    // ========================================================

    el.classList.toggle(
      "correct",
      S.checked[k] === "correct"
    );


    el.classList.toggle(
      "incorrect",
      S.checked[k] === "incorrect"
    );


    const baseTitle =
      `F${k.match(/r(\d)c(\d)/)[1]} C${k.match(/r(\d)c(\d)/)[2]}`;


    el.title =
      baseTitle;


    // Animación cuando cambia una pieza
    if (
      (S.prev[k] || "") !== v &&
      v
    ) {

      el.classList.remove("flash");

      void el.offsetWidth;

      el.classList.add("flash");
    }


    S.prev[k] = v;
  });


  // ==========================================================
  // BANNER
  // ==========================================================

  const locked =
    m.locked ||
    m.ended;


  $("banner").hidden =
    !locked;


  $("banner").textContent =
    m.ended
      ? "🏁 Partida finalizada"
      : "🔒 Tablero bloqueado por la docente";


  $("pcount").textContent =
    n;


  $("players").innerHTML =
    chips(S.players);


  $("progress").textContent =
    `Personajes ubicados: ${filled} de ${P.people.length}`;


  // ==========================================================
  // BOTONES DOCENTE
  // ==========================================================

  $("tLock").textContent =
    m.locked
      ? "🔓 Desbloquear"
      : "🔒 Bloquear";


  $("tReveal").textContent =
    m.reveal
      ? "Ocultar resultado"
      : "Mostrar resultado";


  // ==========================================================
  // REVELACIÓN PARA DOCENTE
  // ==========================================================

  if (m.reveal && S.teacher) {

    KEYS.forEach(k => {

      const el =
        cellEls[k];

      if (!el) return;

      const tok =
        el.querySelector(".tok");

      const value =
        SOL[k] || "";

      tok.textContent =
        value;

      tok.style.background =
        value && byId[value]
          ? byId[value].color
          : "";

      el.classList.toggle(
        "has",
        !!value
      );
    });

  }


  // ==========================================================
  // AVISO DE PARTIDA FINALIZADA
  // ==========================================================

  if (
    m.ended &&
    S.dismissed !== m.endedAt
  ) {

    $("ovT").textContent =
      "🏁 Partida finalizada";

    $("ovP").innerHTML =
      `La docente ha finalizado la partida.`;

    $("overlay").hidden =
      false;

    S.dismissed =
      m.endedAt;
  }


  // ==========================================================
  // OCULTAR OVERLAY SI NO CORRESPONDE
  // ==========================================================

  if (!m.ended) {

    $("overlay").hidden =
      true;
  }
}


// ============================================================
// LIMPIAR MARCA DE COMPROBACIÓN
// ============================================================

function clearCheck(key) {

  if (!key) return;

  R(`${BOARD_PATH()}/checked/${key}`)
    .remove();
}


// ============================================================
// COMPROBAR
// ============================================================

$("btnCheck").onclick = async () => {

  if (
    S.meta.locked ||
    S.meta.ended
  ) {
    return;
  }


  const current = {};

  KEYS.forEach(k => {

    if (
      S.cells[k] &&
      S.cells[k].v
    ) {
      current[k] =
        S.cells[k].v;
    }
  });


  const checked = {};

  let correctCount = 0;
  let incorrectCount = 0;


  // ==========================================================
  // COMPROBAR CADA CASILLERO
  // ==========================================================

  KEYS.forEach(k => {

    const actual =
      current[k] || "";

    const expected =
      SOL[k] || "";


    if (!actual) {
      return;
    }


    if (actual === expected) {

      checked[k] =
        "correct";

      correctCount++;

    } else {

      checked[k] =
        "incorrect";

      incorrectCount++;
    }
  });


  await R(`${BOARD_PATH()}/checked`)
    .set(checked);


  const totalNeeded =
    Object.keys(SOL).length;


  const filled =
    Object.keys(current).length;


  const msg =
    $("msg");


  // ==========================================================
  // SOLUCIÓN COMPLETA
  // ==========================================================

  if (
    filled === totalNeeded &&
    correctCount === totalNeeded
  ) {

    msg.className =
      "msg ok";

    msg.textContent =
      "🎉 ¡Correcto! Resolviste el Murdoku.";


    // La solución queda registrada SOLO
    // para este estudiante.
    await R(`${BOARD_PATH()}/solved`)
      .set({
        solved: true,
        name: S.name,
        at: Date.now()
      });


    $("ovT").textContent =
      "🎉 ¡Murdoku resuelto!";


    $("ovP").innerHTML =
      `¡Excelente trabajo, ${clean(S.name)}!<br><br>` +
      `El asesino es <b>${P.murderer}</b>.`;


    $("overlay").hidden =
      false;


    return;
  }


  // ==========================================================
  // TABLERO INCOMPLETO
  // ==========================================================

  if (
    filled < totalNeeded
  ) {

    msg.className =
      "msg no";

    msg.textContent =
      `Todavía faltan ${totalNeeded - filled} personaje(s) por ubicar.`;

    return;
  }


  // ==========================================================
  // HAY ERRORES
  // ==========================================================

  msg.className =
    "msg no";


  msg.textContent =
    `Hay ${incorrectCount} ubicación(es) incorrecta(s). ` +
    `Las correctas están marcadas en verde y las incorrectas en rojo.`;
};


// ============================================================
// CERRAR RESULTADO
// ============================================================

$("ovX").onclick = () => {

  $("overlay").hidden =
    true;
};


// ============================================================
// DOCENTE: COPIAR ENLACE
// ============================================================

$("btnCopy").onclick = () => {

  $("llink").select();

  navigator.clipboard
    .writeText(link())
    .catch(() =>
      document.execCommand("copy")
    );

  $("btnCopy").textContent =
    "¡Copiado!";
};


// ============================================================
// DOCENTE: INICIAR
// ============================================================

$("btnStart").onclick = () => {

  R("meta").update({
    started: true
  });
};


// ============================================================
// DOCENTE: BLOQUEAR / DESBLOQUEAR
// ============================================================

$("tLock").onclick = () => {

  R("meta").update({
    locked: !S.meta.locked
  });
};


// ============================================================
// DOCENTE: MOSTRAR / OCULTAR SOLUCIÓN
// ============================================================

$("tReveal").onclick = () => {

  R("meta").update({
    reveal: !S.meta.reveal
  });
};


// ============================================================
// DOCENTE: FINALIZAR
// ============================================================

$("tEnd").onclick = () => {

  if (
    !confirm(
      "¿Finalizar la partida?"
    )
  ) {
    return;
  }


  R("meta").update({
    ended: true,
    locked: true,
    endedAt: Date.now()
  });
};


// ============================================================
// DOCENTE: NUEVA PARTIDA
// ============================================================

$("tNew").onclick = () => {

  if (
    !confirm(
      "¿Crear una partida nueva? Esta partida seguirá abierta."
    )
  ) {
    return;
  }


  location.href =
    location.pathname;
};


// ============================================================
// DOCENTE: REINICIAR
// ============================================================

$("tReset").onclick = async () => {

  if (
    !confirm(
      "¿Reiniciar los tableros de todos los estudiantes?"
    )
  ) {
    return;
  }


  await R("meta").update({
    locked: false,
    ended: false,
    endedAt: null,
    reveal: false,
    epoch: (S.meta.epoch || 0) + 1
  });


  /*
    Importante:

    Ya no usamos rooms/CODIGO/cells.

    Ahora cada estudiante tiene:

    rooms/CODIGO/boards/ID_ESTUDIANTE/cells

    Por eso el reinicio docente debe borrar
    todos los boards de la sala.
  */

  await R("boards").remove();


  $("msg").textContent = "";
};


// ============================================================
// LIMPIAR AL SALIR
// ============================================================

window.addEventListener("beforeunload", () => {

  if (!S.code) return;

  R("players/" + S.pid)
    .remove();
});
