# Pakistan Independence Day — Synchronized Floor Presentation

A working, self-hosted system that plays the Pakistan National Anthem and a
waving flag on every laptop's main screen, and a cinematic historical tribute
slideshow on every extended display, all starting at the exact same instant
— across as many laptops as are on the floor.

- **Admin opens:** `/admin` — connected/ready/synchronized counts, live
  previews of both screens, Start/Pause/Stop/Restart, a media library, and
  an editable timeline.
- **Everyone else opens:** `/floor` — one button ("Join Presentation"), then
  it waits, then it becomes the ceremony.

## 1. Requirements

- [Node.js](https://nodejs.org) 18 or newer, installed on **one** computer
  (this becomes the sync server — it can be the admin's own laptop).
- All participating laptops on the **same Wi-Fi/LAN**, so sync doesn't
  depend on the internet.

## 2. Install & run

```bash
cd anthem-sync
npm install
npm run fetch-media   # one-time: downloads the verified, openly-licensed
                       # anthem recording + historical photos (see below)
npm start
```

`npm run fetch-media` needs normal internet access once. It pulls the exact,
license-checked files listed in [`media-sources.json`](./media-sources.json)
from Wikimedia Commons and wires them straight into the timeline — see
[`ATTRIBUTIONS.md`](./ATTRIBUTIONS.md) for the full source/license list.
**You don't have to run it before the first demo** — every photo slot shows
a clean, locally-generated placeholder card until the real photo lands, so
`npm start` alone already gives you a complete, playable ceremony.

You'll see:

```
🇵🇰  Pakistan Anthem Sync server running
   Admin:  http://<this-computer-ip>:3000/admin
   Floor:  http://<this-computer-ip>:3000/floor
```

Find `<this-computer-ip>` (the server laptop's LAN IP — e.g. `192.168.1.42`):

- **Windows:** `ipconfig` → "IPv4 Address"
- **Mac:** System Settings → Wi-Fi → Details, or `ipconfig getifaddr en0`
- **Linux:** `hostname -I`

## 3. Before the event

1. On the server laptop, open `http://localhost:3000/admin` and run
   `npm run fetch-media` first if you haven't (see above) — it pulls the
   real, license-verified anthem recording and photos of Jinnah, Iqbal, and
   Liaquat Ali Khan straight from Wikimedia Commons and wires them in.
2. **Fatima Jinnah** needs one manual step: no clearly-licensed historical
   photo of her could be verified automatically (see `ATTRIBUTIONS.md` for
   why), so her slot ships as a placeholder card. Find and upload a
   suitably-licensed photo via Media Library, then assign it to her row in
   the Presentation Timeline.
3. Check the **Media Sources & Attribution** panel at the bottom of the
   admin page — it shows the source, license, and download status of every
   asset live, with a link back to the original.
4. In **Presentation Timeline**, you can swap in your own anthem recording
   or photographs at any time (upload via Media Library, then pick them
   from each row's dropdown), adjust names/titles, and edit the mm:ss
   timings to match your anthem's actual duration. Set "Ceremony ends at"
   to the anthem's length. Click **Save Timeline**.
5. On every participating laptop, open a browser to
   `http://<server-ip>:3000/floor` and click **Join Presentation**. The
   admin panel's counters should climb toward "32 / 32 ready" (or however
   many laptops you have).
6. On laptops with a second display (monitor/TV/projector), click
   **Open Tribute Display for Second Screen** from the waiting screen, then
   drag that new window onto the external display and press F11 (or your
   browser's fullscreen shortcut) to fullscreen it there. On browsers that
   support the Window Management API and grant permission, this window
   places and fullscreens itself automatically.

## 4. Running the ceremony

Press **▶ Start** in the admin panel. A short countdown gives every laptop
a moment to line up, then the flag and anthem begin at the same scheduled
instant everywhere, and every extended display's tribute slideshow follows
the same timeline. **Pause**, **Stop**, and **Restart** all propagate
instantly to the whole floor.

When the anthem ends, every screen settles on the same final Pakistan-themed
moment and stays there — nothing auto-resets. Press **Restart** to run it
again.

## 5. How the synchronization actually works

A single "play now" message is not used, because it would arrive at
different laptops at slightly different times. Instead:

- Every laptop continuously estimates the **offset** between its own clock
  and the server's clock, using repeated round-trip pings (similar in spirit
  to NTP) — so each laptop computes its own accurate estimate of "the
  server's current time," rather than trusting a single message's arrival
  time.
- When **Start** is pressed, the server picks one absolute timestamp
  (`startAt`, a few seconds in the future) and broadcasts it — the *same*
  number — to every laptop.
- Each laptop independently waits, using its own corrected clock, until
  its estimate of "now" reaches `startAt`, then begins.
- While the anthem plays, each laptop compares where the audio *should* be
  (based on elapsed time since `startAt`) against where it *actually* is,
  and gently nudges playback speed (or, if the drift is large, seeks) to
  keep every laptop's audio in step.
- A laptop that reconnects or joins mid-ceremony asks the server for the
  current status and `startAt` and catches up immediately, instead of
  restarting from zero or waiting for a new broadcast.

## 6. Project structure

```
server.js              Express + Socket.io sync server, REST API, uploads
data/timeline.json      Persisted timeline (editable from /admin)
data/media.json          Persisted media library index
public/floor.html        Join → waiting → countdown → flag/tribute → final
public/admin.html        Control panel
public/js/clocksync.js   NTP-style clock offset estimation
public/js/schedule.js    Pure timeline → on-screen-state resolver
public/js/flag.js        Realistic waving Pakistan flag (animated SVG)
public/js/floor.js       Floor client controller
public/js/admin.js       Admin panel controller
public/uploads/          Uploaded anthem/photos land here
```

## 7. Notes & limits

- This is a LAN-first design (`0.0.0.0` binding); if the event spans more
  than one network, host the server somewhere reachable by all laptops and
  open the corresponding port.
- Browsers block audio autoplay-with-sound until a user gesture occurs on
  the page; clicking **Join Presentation** satisfies that for the anthem
  playback later in the same page.
- The Window Management API (used for auto-placing the extended display) is
  only available in some Chromium-based browsers and requires the user to
  grant a one-time permission; the manual "drag + fullscreen" flow always
  works as a fallback.
- No audio or photographs are bundled with this project — add your own
  authorized anthem recording and rights-cleared historical photographs
  through the admin Media Library before the event.

## LAN setup (important)

1. On the computer that runs the server, run `npm install` once, then `npm start`.
2. Find that computer's LAN IPv4 address with `ipconfig` on Windows (for example `192.168.1.25`).
3. On every other laptop on the same Wi-Fi/LAN, open `http://192.168.1.25:3000/floor` — **do not use `localhost`**.
4. Open `http://192.168.1.25:3000/admin` on the administrator computer.
5. Click **Join Presentation** on each main laptop. This user gesture enables audio playback.
6. On laptops with a second monitor, click **Open Tribute Display for Second Screen**. If the browser cannot automatically move the new window to the second monitor, drag it there and press F11/fullscreen.
7. The admin should show the connected/ready devices before pressing Start.
8. Windows Firewall must allow Node.js/port 3000 for private networks if other computers cannot connect.

The bundled demo now uses a local MP3 copy of the anthem, local historical images, a canvas-based smooth flag animation, and a shared server timeline. No internet connection is needed during the ceremony once the project is installed.

## QUICK EVENT SETUP

See `QUICK_START_PRESENTATION.txt` for the shortest setup path.

The server laptop is the only machine that runs `npm start`. All other laptops open the server laptop's LAN IP, for example `http://192.168.1.25:3000/floor`. They must not use `localhost`.

Before the ceremony, verify `http://SERVER-IP:3000/api/health` reports `anthem.exists=true` and every timeline photo has `exists=true`.


## Updated 10-minute presentation

This build preserves the existing routes and admin workflow:

- Admin: `http://SERVER-IP:3000/admin` (so if the server laptop is `10.10.10.84`, use `http://10.10.10.84:3000/admin`)
- Main floor: `http://SERVER-IP:3000/floor`
- Extended display: open from the floor waiting screen, or use `/floor?screen=extended`

The visual timeline is exactly 10 minutes. It contains 50 individual 1920×1080 photographs, arranged by era from the 1940s through the 2020s/2026 and a 2047 future section. Extended displays keep the same server-clock timing but choose a different deterministic random image order per laptop, so screens can show different photographs without losing synchronization.

The Pakistan National Anthem starts at presentation time 00:00. The bundled anthem is 82.939 seconds long. The uploaded `Dil Say Pakistan` track starts at 02:22.939 — exactly one minute after the anthem ends — and continues with the presentation.

The anthem ending no longer ends the presentation. Only the 10:00 timeline endpoint ends the presentation.

Pause, Resume, Stop and Restart are server-authoritative. On reconnect, a display receives the current state and catches up to the current presentation position rather than restarting from zero.
