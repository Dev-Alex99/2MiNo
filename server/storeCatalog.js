// Catálogo AUTORITATIVO de la tienda (fuente de verdad de los precios).
//
// El cliente muestra nombres, iconos y descripciones (SkinStoreModal.jsx), pero
// el PRECIO real vive aquí, en el servidor. Nunca se confía en el coste que
// envía el cliente: así nadie puede equiparse una skin premium mandando cost:0.
//
// Los IDs deben coincidir 1:1 con el cliente (theme.js, SkinStoreModal.jsx).

const TILE_ITEMS = {
  classic:       0,
  cyberpunk:     200,
  obsidian:      400,
  walnut:        350,
  rose_gold:     750,
  midnight:      300,
  volcanic:      500,
  arctic:        450,
  jade:          600,
  golden_dragon: 1000
};

const BOARD_ITEMS = {
  emerald:      0,
  dark_oak:     250,
  neon_galaxy:  450,
  mayan_temple: 600,
  ocean_deep:   350,
  blood_moon:   500,
  zen_garden:   400,
  cyber_grid:   550
};

// Estructura combinada expuesta por si se necesita en otros módulos.
const STORE_ITEMS = {
  tile: TILE_ITEMS,
  board: BOARD_ITEMS
};

// Devuelve { id, category, cost } o null si el item/categoría no existe.
function getItem(category, itemId) {
  const table = category === 'tile' ? TILE_ITEMS : category === 'board' ? BOARD_ITEMS : null;
  if (!table || !Object.prototype.hasOwnProperty.call(table, itemId)) return null;
  return { id: itemId, category, cost: table[itemId] };
}

module.exports = { STORE_ITEMS, TILE_ITEMS, BOARD_ITEMS, getItem };
