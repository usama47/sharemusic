# ShareMusic

One shared music room, with a direct dashboard at `/admin` and a listener at `/floor`. It uses plain HTML/JavaScript and a persistent Node server (Express, Multer, WebSockets).

## Run

The admin, listener and voice pages all have **Setup & help** navigation. It provides role-specific music instructions, guided phone certificate setup, microphone/audio troubleshooting, and a copyable listener invitation link. Listener help returns to the music page; dashboard help returns to the dashboard. The voice setup page has separate Android/iPhone steps and an Open Voice link for the current host, so participants do not need to edit protocols or port numbers.

Install Node 18 or newer, then:

```sh
npm install
npm start
```

`npm start` launches HTTP music on port 3000 and HTTPS voice on port 3001 in one process, sharing one room and library. `npm run dev`, `npm run local-host`, and `npm run local-host:https` are aliases. `PORT` defaults to 3000; `HTTPS_PORT` defaults to 3001. Startup prints interface addresses; choose one reachable by listeners. `127.0.0.1` is only for the server device. `/` redirects to `/floor`.

Open `/admin`, upload a supported audio file, and select a track. Listeners open `/floor` and tap Join when a track is available. The dashboard shows each listener's reported loading, ready, playing, paused, blocked, or error status. Readiness means audio is enabled and the browser has future media data; it does not mean the entire file is downloaded. Start is a host decision, not a barrier waiting for every listener.

Start and Resume use a three-second countdown. Pause, Stop, seeking, and speed changes affect the room. Stop resets position. Seeking while stopped sets the next start position. Selecting a track resets the position. A stopped selected track can be deleted, including the last track. The next remaining track is then selected. There is no playlist or automatic next track.

The dashboard also plays synchronized room audio. Pressing Start or Resume enables audio on the admin device; if the browser blocks it or the dashboard joins an already-running room, use **Enable audio on this device**. The separate native preview controls still audition only the selected file; room playback pauses preview.

Listeners have **Pause for everyone** and **Resume for everyone** controls after joining, including during the countdown. Either action updates the server and all listeners and dashboards. Resume uses the same shared countdown and position. Track selection, Start, Stop, seeking, and speed remain dashboard controls.

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

## Voice chat

Use the **Voice chat** button on `/admin` or `/floor`. The voice page is `/voice`; listener navigation returns to `/floor` and does not expose the dashboard. Voice is independent of the selected music track and works even with an empty library. Navigating to voice leaves the current page's music player; it does not stop the shared music room.

Enter a name and Join voice. Microphone permission is requested only after that click. The mic starts muted. **Hold to talk** transmits while pressed; releasing/canceling the press mutes it. **Turn on open mic** enables hands-free talking until switched off. Up to eight people can join. The list shows membership, microphone-on state (not speech detection), and each peer connection's state. Leave releases the microphone and all peer connections. A lost server connection also releases the mic; rejoining is explicit. Hiding the page mutes transmission. Use headphones to reduce echo.

Voice uses a WebRTC peer connection between each pair and local WebSocket signaling. No public STUN/TURN service, voice recording, or audio upload is used. Everyone must have a reachable local network path. Client isolation, multicast/mDNS restrictions, device firewalls or failed peer connectivity can prevent voice even while music works. There is no guaranteed distance or screen-lock/background operation. This is a foreground small-group voice feature, not a replacement for safety-critical radio communication.

### HTTPS on Termux and other LAN hosts

**An HTTP LAN URL cannot request microphone access.** The optional HTTP-only command `npm run start:http` permits host-only voice on localhost; normal startup guides voice users through `/setup`. Other phones need an HTTPS address whose certificate they trust. Changing `http` to `https` alone does not enable TLS, and bypassing a certificate warning is not a deployment solution.

For the included offline HTTPS setup, stop the old server with Ctrl+C, then run in Termux:

```sh
pkg install openssl-tool
npm start
```

Music and admin work immediately at **http://HOST:3000/floor** and **http://HOST:3000/admin**. Voice uses **https://HOST:3001/voice**. Open **http://HOST:3000/setup** once on each phone for microphone setup. Port 3001 uses HTTPS, not HTTP. Both ports start together; do not run a second server. It provides the public certificate, Android/iPhone installation instructions, and HTTPS Music/Voice/Admin links. Install and trust this host's certificate once on each participating phone (including the host phone), then open the HTTPS Voice link and allow the microphone. Browsers cannot grant a LAN HTTP microphone exemption for educational projects.

Some Android versions prevent Termux from discovering interface addresses. If only localhost is printed, or the desired address is missing, supply your current Wi-Fi/hotspot IP explicitly:

```sh
npm start -- 10.10.11.192
```

Use your actual reachable IP, not necessarily the example. Additional IPs or DNS names can be supplied as more arguments or comma-separated `HTTPS_HOSTS`. Restart this command after a network/address change. `PORT` and `HTTPS_PORT` override 3000 and 3001; the old `SETUP_PORT` option is no longer used. Both must be reachable from the phones. On Windows/macOS install OpenSSL first; `OPENSSL` can specify its executable path.

The launcher generates a local CA and a server certificate with matching address SANs. It preserves the CA in the Git-ignored `certs/` directory and reissues the server certificate at launch. Keep this directory on the host across updates so enrolled phones retain trust. Only the public CA certificate is downloadable; private keys are never served. Check the certificate fingerprint against the host terminal before trusting it. Trusting this CA allows its holder to issue certificates your phone accepts, so keep its keys private and remove its trust/profile from phones when no longer needed. Trust installation is manual; the app does not modify device trust stores. No internet service is needed after installing dependencies and enrolling phones.

Android: choose **CA certificate** in the system's Install a certificate settings, not Wi-Fi/client certificate. iPhone/iPad: install the downloaded profile, then enable ShareMusic Local CA under **General → About → Certificate Trust Settings**. See [Android certificate help](https://support.google.com/pixelphone/answer/2844832?hl=en) and [Apple certificate trust help](https://support.apple.com/en-us/102390). Menu names differ across Android devices. If HTTPS shows a certificate error, check trust, address and device time before using voice.

If you already have a trusted PEM private key and certificate chain valid for the hostname/IP your friends use, the original direct TLS option is also available:

```sh
TLS_KEY="$PWD/certs/voice-key.pem" TLS_CERT="$PWD/certs/voice-cert.pem" npm run start:http
```

Keep the private key on the host. An existing trusted HTTPS reverse proxy that forwards `/local-ws` is another option. The HTTPS launcher uses the same persistent music library as the HTTP server; changing protocol does not delete uploads. Run only one music server at a time.

Update the complete project on Termux, including `scripts/https-host.js` and `package.json`, before using the new command. The ordinary HTTP voice page now gives actionable setup instructions. A correctly trusted HTTPS voice page hides those instructions and enables Join when connected.

### Music alignment

The host and listeners use the same server-clock estimate and audio engine. Initial clock sampling is faster, foreground correction runs every 50 ms, and large corrections now begin at 80 ms rather than 350 ms. Smaller drift gets proportional rate correction. These are control thresholds, not a guarantee of acoustic alignment: browser media precision, speaker/Bluetooth latency, buffering and OS suspension can still create audible differences. Test on the actual phones, preferably using comparable output devices.
