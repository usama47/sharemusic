# ShareMusic

One shared music room, with a direct dashboard at `/admin` and a listener at `/floor`. It uses plain HTML/JavaScript and a persistent Node server (Express, Multer, WebSockets).

## Run

Install Node 18 or newer, then:

```sh
npm install
npm start
```

`npm run dev` and `npm run local-host` start the same server. `PORT` defaults to 3000. Startup prints interface addresses; choose one reachable by listeners. `127.0.0.1` is only for the server device. `/` redirects to `/floor`.

Open `/admin`, upload a supported audio file, and select a track. Listeners open `/floor` and tap Join when a track is available. The dashboard shows each listener's reported loading, ready, playing, paused, blocked, or error status. Readiness means audio is enabled and the browser has future media data; it does not mean the entire file is downloaded. Start is a host decision, not a barrier waiting for every listener.

Start and Resume use a three-second countdown. Pause, Stop, seeking, and speed changes affect the room. Stop resets position. Seeking while stopped sets the next start position. Selecting a track resets the position. A stopped selected track can be deleted, including the last track. The next remaining track is then selected. There is no playlist or automatic next track.

The dashboard's native audio controls preview only the selected file on that device. Room playback pauses preview. To hear synchronized playback, use `/floor`.

## Storage and access

Files upload to the machine running Node, in `local-media/`, with metadata in `data/local-tracks.json`. Supported extensions: MP3, M4A, OGG, OGA, WAV, WebM; maximum 150 MB per file. The uploading browser must be able to read a finite duration. Codec support still depends on each listener's browser. Files and metadata are ignored by Git. Listeners fetch audio automatically over HTTP; WebSockets carry state and commands, not audio.

There is intentionally no login. Anyone who can reach the server can open the dashboard and modify the library or playback. WebSocket roles are command routing, not authentication. Deploy within the intended trusted audience. Room state and listener presence reset when the server restarts; the library persists. Run one server process against one storage directory.

## Deployment and browser behavior

Deploy the complete project to a machine with a persistent Node process, writable disk, and reachable HTTP/WebSocket port. Static-only hosting cannot provide the upload API, storage, or WebSocket room. Obsolete static-provider rewrite files have been removed. A reverse proxy must forward WebSocket upgrades; use HTTPS/WSS if secure browser features are needed.

Once dependencies are installed, the application makes no internet-service requests. An Android Termux Node runtime is an optional hosting environment, not a browser-hosted server. Network reachability, device runtime availability, and power management must be checked on the chosen host.

The service worker is network-only and clears legacy ShareMusic caches. It does not cache music, API state, or stale page code, and it does not turn a stopped server into an offline room. Registration is limited to secure contexts (HTTPS or browser-trusted localhost). Home-screen installation availability depends on the browser; HTTP LAN pages can still be used as ordinary pages.

Clients estimate server time with round-trip clock samples and correct media drift. Control messages apply immediately without depending on animation frames. Reconnection restores current server state; visibility changes trigger resynchronization. Browsers and operating systems can still suspend JavaScript, WebSockets, or audio in the background. Output-device latency and codec differences are not calibrated. Sample-accurate playback or locked-screen reliability is not guaranteed; validate on the actual devices. A failed audio-enable attempt leaves Join available and restores the mute state.

## Validation

```sh
npm test
npm run verify-demo
```

Tests use temporary storage, real HTTP/WebSocket requests, and deterministic browser/media mocks. They do not replace real-device audio tests. `verify-demo` checks required assets and runs the regression suite. No test writes to the project's music library.

See `REVIEW-FIXES.md` for the finding-by-finding disposition and validation scope.
