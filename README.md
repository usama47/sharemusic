# ShareMusic

ShareMusic lets one host play one local audio file to many listeners on the same Wi-Fi/LAN. Listeners open a mobile-friendly link, tap once to enable audio, and stay synchronized to the host's server clock.

## Run it

```bash
npm install
npm start
```

Open the printed LAN address:

- Host dashboard: `http://SERVER-IP:3000/admin`
- Listener page: `http://SERVER-IP:3000/floor`

Default dashboard credentials:

- Username: `admin`
- Password: `sharemusic`

Set a private password before starting the event:

```powershell
$env:ADMIN_PASSWORD = "your-private-password"
npm start
```

You can also set `ADMIN_USERNAME` and `PORT`. The dashboard session protects uploads, track selection, and playback controls. Listener devices do not need an account.

## Event flow

1. Start the server on the host laptop.
2. Open `/admin`, sign in, and upload an MP3, M4A, OGG, WAV, or WebM audio file.
3. Select the track and confirm the detected duration.
4. Share `/floor` with the other devices on the same LAN.
5. Each listener taps **Join and enable audio** once.
6. Press **Start**. The host schedules a common start timestamp three seconds ahead; each listener uses its measured server-clock offset to begin at that timestamp.

Pause, resume, and stop are server-authoritative. A listener that reconnects receives the current state and catches up to the current position.

Run the local preflight check with:

```bash
npm run verify-demo
```

## YouTube and other phone playback

Playing YouTube on the host's phone cannot be captured and redistributed by this web app. Mobile browsers and YouTube do not expose the decoded audio/video stream to another website, and screen/audio capture would require explicit operating-system permissions and a different streaming architecture.

For reliable synchronized playback, use a file the server can serve locally, such as an uploaded MP3. Each listener downloads that same file from the LAN and the app synchronizes its playback position. The current app shares audio only; it does not mirror video.

You could share a YouTube link, but every phone would run its own YouTube player with separate buffering, ads, autoplay rules, and timing. That is not dependable room synchronization.

## Network notes

- All devices must be able to reach the host laptop over the same LAN/Wi-Fi.
- Other devices must use the host laptop's LAN IP, not `localhost`.
- Allow Node.js through Windows Firewall for private networks if the page cannot be reached.
- Every listener must tap the join button because browsers block sound autoplay without a user gesture.
