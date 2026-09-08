# ShareMusic

ShareMusic is a Supabase-backed synchronized music room. The host controls one audio track from a mobile-friendly dashboard, while listeners join from their phones through a PWA.

## Supabase setup

1. Create a Supabase project.
2. Open **SQL Editor** and run [supabase-schema.sql](supabase-schema.sql).
3. In **Storage**, create a public bucket named `tracks`.
4. In **Authentication**, create the admin user with an email and password.
5. Copy that user's UUID and run the registration statement at the bottom of [supabase-schema.sql](supabase-schema.sql).
6. Create a local `.env` file with the project URL and publishable key:

```dotenv
SB_PROJECT_URL="https://your-project.supabase.co"
SB_PUBLISHABLE_KEY="your-public-anon-key"
```

The build generates `public/js/supabase-config.js` from those variables. That generated file is ignored by Git. The publishable/anon key is intended for browser use; never put a Supabase service-role key in `.env` values that reach the frontend.

## Run locally

```bash
npm install
npm run dev
```

Open:

- Admin: `http://localhost:3000/admin`
- Listener: `http://localhost:3000/floor`

The local Express process now only serves static files. Auth, realtime state, uploads, and track storage are handled by Supabase.

For Netlify or Vercel, configure `SB_PROJECT_URL` and `SB_PUBLISHABLE_KEY` as build environment variables and use `npm run build` as the build command. Publish `public/` as the output directory. The repository includes route rewrites for `/admin` and `/floor`.

## Deploy

Deploy the `public/` directory to Firebase Hosting, Netlify, Vercel, GitHub Pages, or another static host. Configure the custom domain and HTTPS. The app does not require the Node server in production.

For a PWA install, use HTTPS. On iPhone/iPad, open the listener page, use the browser Share menu, and choose **Add to Home Screen**. On supported browsers, the listener page exposes an install action.

## Offline Android event mode

For an event without internet, use the Android host phone as the local server:

1. Install Termux from F-Droid or the official Termux releases.
2. In Termux run `pkg update`, then `pkg install nodejs-lts git`.
3. Copy this project to the phone and run `npm install` once while internet is available.
4. Turn on the Android Wi-Fi hotspot.
5. Start the local host with `npm run local-host`.
6. Open the printed `/admin` address on the host phone.
7. Friends connect to the hotspot and open the printed `/floor` address.

Local mode stores audio in `local-media/` on the host phone and streams it over the hotspot only. Commands and listener presence use a local WebSocket; Supabase and internet are not required during the event. The host phone must stay awake, charging, and running Termux. Some hotspots isolate connected clients; disable client isolation if listeners cannot open the local link.

The installed cloud PWA is useful for online preparation, but a PWA cannot silently change its origin from your cloud domain to the host phone. During an offline event, open the local `/floor` link served by the host phone.

## Event flow

1. Open `/admin` on the host phone.
2. Sign in with the registered Supabase admin account.
3. Upload one or many MP3, M4A, OGG, WAV, or WebM files. The dashboard shows real byte-level progress for each file and adds completed tracks to the library automatically.
4. Select the track and wait for its duration to load.
5. Share `/floor` with listeners.
6. Each listener taps **Join and enable audio** once.
7. Press **Start**. Supabase publishes one future `start_at` timestamp and each phone plays locally against that timestamp.

Pause, resume, and stop update the shared room record. Realtime subscriptions deliver changes to connected listeners, and Presence reports active listener devices.

## Architecture

- Supabase Auth: admin login
- Supabase Postgres: room state and track metadata
- Supabase Realtime: room updates and listener presence
- Supabase Storage: audio files
- Static hosting: admin dashboard and listener PWA

The app intentionally does not upload or capture native YouTube playback. Use audio files that you are authorized to distribute.

## Verification

```bash
npm run verify-demo
```
