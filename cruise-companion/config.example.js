// ============================================================
//  Cruise Companion — shared album configuration
// ============================================================
//
//  HOW TO USE
//  1. Copy this file and rename the copy to exactly:  config.js
//  2. Fill in the two Supabase values below.
//  3. Deploy the folder (see SETUP.md).
//
//  Until config.js exists, the app runs happily in PRIVATE, ON-DEVICE
//  mode — no setup needed. Adding config.js is what turns it into a
//  SHARED family album that everyone can add to from one link.
//
//  Nothing secret goes here: the "anon key" is a public, browser-safe key.
// ============================================================

window.CRUISE_CONFIG = {
  // --- Required for a shared album ---
  supabaseUrl:     "https://YOUR-PROJECT.supabase.co",
  supabaseAnonKey: "YOUR-PUBLIC-ANON-KEY",

  // --- Optional cosmetics ---
  tripTitle: "Our Alaska",
  tagline:   "Photos, videos & stories from the trip",

  // --- Advanced (leave as-is unless you renamed things) ---
  bucket: "media",
  table:  "memories",
};
