// Murdoku n.º 51 "Cuevas subterráneas". Filas F1..F7 (arriba→abajo), columnas C1..C7.
// Salas: W estanque, T sala de talla, M sala común, D sala de doma, E entrada
const PUZZLE = {
  rooms: ["WWWWWWW","WTWWWWW","TTMMWWW","TTMMMDD","TTTMMMD","TTTEMMD","EEEEEEE"],
  roomNames: {W:"Estanque subterráneo",T:"Sala de talla",M:"Sala común",D:"Sala de doma",E:"Entrada"},
  // 🐟 pescador, 🪓 fabricante de herramientas, 🏹 cazador, 🐺 domador de lobos
  icons: {
    r1c3:"🐟",r1c6:"🐟",r2c2:"🐟",r2c4:"🐟",r2c7:"🐟",
    r5c1:"🪓",r5c3:"🪓",r6c3:"🪓",
    r3c4:"🏹",r4c2:"🏹",r6c2:"🏹",r7c5:"🏹",
    r4c1:"🐺",r4c6:"🐺",r5c7:"🐺",r6c7:"🐺",
    r4c3:"🛏️",r6c5:"🛏️",r4c7:"🦴",r7c3:"🌳"
  },
  rocks: ["r3c1","r5c2","r6c1"], // bloqueadas
  solution: {r1c1:"V",r2c7:"B",r3c2:"D",r4c6:"A",r5c3:"C",r6c4:"E",r7c5:"F"},
  people: [
    {id:"A",name:"Arok",color:"#e4572e",clue:"Estaba en la sala de doma."},
    {id:"B",name:"Branuk",color:"#2e86de",clue:"Él es el pescador."},
    {id:"C",name:"Clega",color:"#12a594",clue:"Ella es la fabricante de herramientas."},
    {id:"D",name:"Daki",color:"#7c4dff",clue:"Ella estaba en la sala de talla."},
    {id:"E",name:"Evka",color:"#8d5524",clue:"Ella estaba con el cazador, que era un hombre."},
    {id:"F",name:"Fegu",color:"#d81b60",clue:"Clega estaba exactamente dos columnas al oeste de él."},
    {id:"V",name:"Velok",color:"#444",clue:"La víctima. Estaba solo con el asesino."}
  ],
  murderer: "Branuk"
};
