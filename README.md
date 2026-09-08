# ShareMusic

ShareMusic is an offline music room for an Android host phone. The host phone creates a Wi-Fi hotspot, stores the music locally, and synchronizes playback to friends over the hotspot. Internet is only needed to install Termux and copy the project to the phone.

## Android host setup

Install Termux from F-Droid or the official Termux releases. While internet is available, run:

```bash
pkg update
pkg install nodejs-lts git
cd sharemusic
npm install
```

During the event:

1. Turn on the Android Wi-Fi hotspot.
2. Keep mobile data off if desired.
3. Start the host:

   ```bash
   npm run local-host
   ```

4. Open the printed `/admin` address on the host phone.
5. Upload one or more local MP3, M4A, OGG, OGA, WAV, or WebM files.
6. Select a track.
7. Friends connect to the hotspot and open the printed `/floor` address.
8. Friends tap **Join and enable audio**.
9. Press **Start**. Playback begins for everyone after a three-second countdown.

The event uses only the host phone's local HTTP server, local WebSocket connection, local audio files, and hotspot network. Supabase and internet are not used.

## Android requirements

- Keep Termux open and running.
- Keep the host phone charging.
- Disable battery optimization for Termux.
- Keep the screen awake during playback.
- Disable VPNs.
- If friends cannot connect, disable hotspot client isolation.
- Use the exact IP address printed by the server or the hotspot gateway address.

Typical listener URL:

```text
http://10.10.11.192:3000/floor
```

Typical admin URL:

```text
http://10.10.11.192:3000/admin
```

The address may differ by Android device or hotspot configuration.

## Local storage

Uploaded files are stored on the host phone in `local-media/`. Track metadata is stored in `data/local-tracks.json`. These event files are ignored by Git and are not uploaded anywhere.

## Verification

```bash
npm run verify-demo
```

This project does not capture or redistribute native YouTube playback. Use audio files you are authorized to distribute.
