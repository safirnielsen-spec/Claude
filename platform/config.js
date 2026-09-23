// Udfyld med værdierne fra Supabase → Project Settings → API.
// Så længe felterne er tomme, kører platformen i demo-tilstand med data gemt lokalt i browseren.
window.CP_CONFIG = {
  supabaseUrl: 'https://coghnjyigoizhiqwqazw.supabase.co',
  // Offentlig nøgle (publishable). Sikker at have i koden; adgang styres af Row Level Security.
  supabaseAnonKey: 'sb_publishable_EYA-mcCIxLT7QURJgEyWrg_rH7qfAqE',
  // Hvor Core Partners-knappen "Book gennemgang" peger hen.
  contactEmail: 'kontakt@corepartners.dk'
};
