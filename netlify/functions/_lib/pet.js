import { HttpError } from './respond.js';

// PET weight columns per type. Keep in sync with src/petTypes.js.
export const PET_TYPES = [
  { col: 'pet_clear_kg',   label: 'Clear PET' },
  { col: 'pet_oily_kg',    label: 'Oily PET' },
  { col: 'pet_brown_kg',   label: 'Brown' },
  { col: 'pet_green_kg',   label: 'Green' },
  { col: 'pet_viju_kg',    label: 'Viju' },
  { col: 'pet_freshyo_kg', label: 'Freshyo' },
  { col: 'pet_blue_kg',    label: 'Blue' },
  { col: 'pet_black_kg',   label: 'Black' },
];

export const NO_PET = Object.fromEntries(PET_TYPES.map((t) => [t.col, null]));

// Read the per-type PET weights from a request body. Returns the breakdown and
// its total (stored as pet_kg). A body that sends only pet_kg (older clients)
// is accepted as an untyped total.
export function readPet(b) {
  if (!PET_TYPES.some((t) => t.col in b)) {
    const total = nonNeg(b.pet_kg, 'PET weight');
    return { breakdown: { ...NO_PET }, total };
  }
  const breakdown = {};
  let total = 0;
  for (const t of PET_TYPES) {
    const n = nonNeg(b[t.col], `${t.label} weight`);
    breakdown[t.col] = n;
    total += n;
  }
  return { breakdown, total: Math.round(total * 100) / 100 };
}

function nonNeg(v, label) {
  const n = v == null || v === '' ? 0 : Number(v);
  if (!Number.isFinite(n) || n < 0) throw new HttpError(400, `${label} must be a non-negative number`);
  return n;
}
