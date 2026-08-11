# Our Alaska — Cruise Companion 🧊

A super-simple app for the whole family to drop in **photos, videos, and
stories** from the cruise. It matches the look of the family SHL viewer
(same navy), so it can be folded into that app later.

There are two ways to use it, and it switches between them **automatically**:

| Mode | What it means | Setup |
|---|---|---|
| **On this device** (default) | Memories save privately in *your* phone's browser. Works offline on the ship. Only you see them. | **None.** Just open it. |
| **Shared album** | One link the whole family opens; everyone adds to the *same* album. | Add a `config.js` (5 min, below). |

You can start in on-device mode today and switch to shared later — the app
and all your typed-in stories look identical either way.

---

## Use it right now (no setup)

Just open `index.html` in a phone browser (or host the folder — see below).
Tap **＋ Add a memory**, pick a photo or video, add a title and a story, Save.
Everything is kept on the device even after you close it.

> Tip: open **Save a backup file** in the Add sheet now and then. It downloads
> a single file with all your photos + stories so nothing can be lost. You can
> **Restore from backup** on any device.

---

## Turn on the shared family album (about 5 minutes)

You need a free [Supabase](https://supabase.com) project — it gives you the
shared storage for photos/videos and the list of stories. No credit card.

### 1. Create the project
1. Sign in at supabase.com → **New project**. Pick any name, any region.
2. When it's ready, go to **Project Settings → API** and copy:
   - **Project URL** (looks like `https://abcd1234.supabase.co`)
   - **anon public** key (a long string — this one is safe for browsers)

### 2. Create the table + storage
In the Supabase dashboard, open **SQL Editor → New query**, paste this, and Run:

```sql
-- Table of memories
create table if not exists memories (
  id         text primary key,
  title      text,
  story      text,
  who        text,
  taken_at   date,
  media_type text,
  media_path text,
  created_at timestamptz default now()
);

-- Let the family add and view without accounts (simple, open album)
alter table memories enable row level security;
create policy "anyone can read"   on memories for select using (true);
create policy "anyone can add"    on memories for insert with check (true);
create policy "anyone can remove" on memories for delete using (true);

-- Storage bucket for the photos/videos
insert into storage.buckets (id, name, public)
values ('media', 'media', true)
on conflict (id) do nothing;

create policy "public read media"  on storage.objects for select using (bucket_id = 'media');
create policy "anyone upload media" on storage.objects for insert with check (bucket_id = 'media');
```

> **Note on privacy:** this makes an *open* album — anyone who has the link can
> view and add. That's usually what a family wants, and it needs no logins. If
> you'd rather lock it down, tell Claude and it can add a shared passcode or
> real sign-in.

### 3. Add your keys
1. In this folder, copy `config.example.js` → **`config.js`**.
2. Paste your **Project URL** and **anon key** into it.
3. That's it — the app now shows a green **"Shared album"** badge.

---

## Put it on the web (so family can open a link)

The folder is just static files — host it anywhere. Two easy options:

**Netlify (drag & drop):** go to app.netlify.com → **Add new site → Deploy
manually** → drag this `cruise-companion` folder in. You get a link instantly.
(You can also point your existing `alaska-cruise-8-2026` site at it.)

**GitHub Pages:** this folder already lives in the repo — enable Pages on the
branch and point it at `/cruise-companion`.

Whichever you pick, share the link and everyone taps **＋ Add a memory**.

---

## Files here

- `index.html` — the whole app (one file, no build step).
- `config.example.js` — template; copy to `config.js` to enable sharing.
- `config.js` — *your* keys (create it; it's git-ignored so keys aren't committed).
- `SETUP.md` — this guide.
