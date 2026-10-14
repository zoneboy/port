// PET is weighed per type; the types sum to the sorter's PET total (pet_kg),
// which is what gets paid. Keep in sync with netlify/functions/_lib/pet.js.
export const PET_TYPES = [
  { col: 'pet_clear_kg',   label: 'Clear PET' },
  { col: 'pet_oily_kg',    label: 'Oily PET' },
  { col: 'pet_brown_kg',   label: 'Brown' },
  { col: 'pet_green_kg',   label: 'Green' },
  { col: 'pet_viju_kg',    label: 'Viju' },
  { col: 'pet_freshyo_kg', label: 'Freshyo' },
  { col: 'pet_blue_kg',    label: 'Blue' },
];

export const emptyPet = () => Object.fromEntries(PET_TYPES.map((t) => [t.col, '']));

export const petTotal = (vals) =>
  Math.round(PET_TYPES.reduce((s, t) => s + (Number(vals?.[t.col]) || 0), 0) * 100) / 100;

// Prefill inputs from a saved record. Older records only have a PET total, so
// it goes into Clear PET rather than being lost.
export function petFromRecord(r) {
  const vals = emptyPet();
  const hasBreakdown = PET_TYPES.some((t) => r[t.col] != null);
  if (hasBreakdown) {
    for (const t of PET_TYPES) vals[t.col] = Number(r[t.col]) ? String(r[t.col]) : '';
  } else if (Number(r.pet_kg)) {
    vals.pet_clear_kg = String(r.pet_kg);
  }
  return vals;
}
