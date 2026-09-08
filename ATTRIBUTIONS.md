# Media Sources & Attribution

This app ships with a curated set of openly-licensed media, sourced from
Wikimedia Commons. Machine-readable details (source URL, license URL,
download status) live in [`media-sources.json`](./media-sources.json) and
are also shown live in the admin panel under **Media Sources & Attribution**.

Nothing here was pulled from YouTube, Spotify, commercial recordings, or a
random image search — every asset below was individually checked for a
clearly-stated public-domain or Creative Commons license before inclusion.

## How assets get onto disk

This project was assembled in a sandboxed build environment with no general
internet access, so the actual binary files could not be downloaded during
development. Instead:

1. Every asset below was verified (source, license, resolution) using live
   web search against Wikimedia Commons.
2. The verified metadata was recorded in `media-sources.json`.
3. `npm run fetch-media` — run once, on a machine with normal internet
   access — downloads the exact files listed below and wires them into
   `data/timeline.json` / `data/media.json` automatically.
4. Until that command is run (or an admin uploads a replacement), each
   photo slot shows a locally-generated placeholder card (initials + name
   on a green field — not a copyrighted image of any kind) so the demo is
   still fully watchable end-to-end.

## Audio

| Asset | Source | License | Creator |
|---|---|---|---|
| National Anthem of Pakistan — Instrumental (default) | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:National_anthem_of_Pakistan,_instrumental.oga) | Public Domain (CC PDM 1.0) | Government of Pakistan, official instrumental recording |
| National Anthem of Pakistan — U.S. Navy Band (fallback/alt.) | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Pakistani_national_anthem_-_United_States_Navy_Band.ogg) | Public Domain (performance: CC PDM 1.0; composition: PD in Pakistan) | United States Navy Band |

## Historical photographs

| Person | Source | License |
|---|---|---|
| Muhammad Ali Jinnah | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Quaid_Azam_Muhammad_Ali_Jinnah.jpg) | Public Domain — PD-Pakistan |
| Allama Muhammad Iqbal | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Allama_Iqbal.jpg) | Public Domain — PD-Pakistan |
| Liaquat Ali Khan | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Liaquat_Ali_Khan.jpg) | Public Domain — PD-Pakistan |
| Fatima Jinnah | **Needs Licensed Asset** | — see below |

### Fatima Jinnah — needs a licensed asset

An automated, careful search of Wikimedia Commons did not turn up a
photograph that could be confidently verified as (a) actually depicting
Fatima Jinnah herself, rather than a park, monument, or statue named after
her, and (b) carrying a clearly-stated free license. Rather than guess, this
slot was intentionally left as "Needs Licensed Asset."

To fill it in:

1. Browse [Category:Fatima Jinnah](https://commons.wikimedia.org/wiki/Category:Fatima_Jinnah)
   and related categories on Wikimedia Commons, or check the Pakistani
   government's own archives.
2. Confirm the file is (a) actually a photo of her and (b) tagged
   `PD-Pakistan`, CC0, or another license that permits this use.
3. Upload it via **Admin → Media Library**, then assign it to her entry in
   the Presentation Timeline editor. It will immediately replace the
   placeholder card on the extended display.

## Flag

The waving Pakistan flag is **not** an image or GIF at all — it's original
SVG code (`public/js/flag.js`) with correct 2:3 proportions, rendered with
an animated turbulence/displacement filter for a cloth-like ripple. No
external asset or license is involved.
