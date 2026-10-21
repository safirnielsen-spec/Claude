// Udfyld med værdierne fra Supabase → Project Settings → API.
// Så længe felterne er tomme, kører platformen i demo-tilstand med data gemt lokalt i browseren.
window.CP_CONFIG = {
  supabaseUrl: 'https://efelesduhwgjvqziqzuy.supabase.co',
  // Offentlig nøgle (publishable). Sikker at have i koden; adgang styres af Row Level Security.
  supabaseAnonKey: 'sb_publishable_2p63vc6a23ZaQMhyfc5r4w_ZI2TOuyz',
  // Hvor Core Partners-knappen "Book gennemgang" peger hen.
  contactEmail: 'kontakt@corepartners.dk'
};
