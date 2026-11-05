// Item types the AI chooses from (CLIP zero-shot). Shared by the page and the AI worker.
export const TYPES = [
  { id: 'plush', label: 'Plushie', emoji: '🧸', prompts: ['a photo of a plush toy', 'a photo of a stuffed animal'] },
  { id: 'figure', label: 'Figure', emoji: '🪆', prompts: ['a photo of a small collectible figurine', 'a photo of a blind box toy figure'] },
  { id: 'charm', label: 'Charm', emoji: '🔑', prompts: ['a photo of a keychain', 'a photo of a bag charm pendant'] },
  { id: 'magnet', label: 'Fridge magnet', emoji: '🧲', prompts: ['a photo of a fridge magnet', 'a photo of a souvenir magnet'] },
  { id: 'dessert', label: 'Dessert', emoji: '🍰', prompts: ['a photo of a dessert', 'a photo of a cake or pastry'] },
  { id: 'drink', label: 'Drink', emoji: '🧋', prompts: ['a photo of a drink in a cup', 'a photo of bubble tea or coffee'] },
  { id: 'food', label: 'Food', emoji: '🍙', prompts: ['a photo of a meal', 'a photo of food on a plate'] },
  { id: 'flower', label: 'Flower', emoji: '🌸', prompts: ['a photo of a flower', 'a photo of a plant'] },
  { id: 'stationery', label: 'Stationery', emoji: '✏️', prompts: ['a photo of stationery', 'a photo of pens, stickers or a notebook'] },
  { id: 'accessory', label: 'Accessory', emoji: '🎀', prompts: ['a photo of jewelry', 'a photo of a hair clip or accessory'] },
  { id: 'other', label: 'Little thing', emoji: '✨', prompts: ['a photo of a small object'] },
];
export const typeById = (id) => TYPES.find((t) => t.id === id) || TYPES[TYPES.length - 1];
export const cosine = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
