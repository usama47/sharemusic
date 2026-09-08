# ShareMusic review fixes

Baseline: `6c6251b` (remove login panel and update caching). That commit was inspected before editing. Direct `/admin` and `/floor` behavior is preserved. No commit, push, or deployment was performed.

## Finding-by-finding disposition

| Finding | Disposition | Validation |
| --- | --- | --- |
| Neither page initialized | Fixed: both entrypoints call idempotent startup; shared transport loads first. | Actual HTML scripts exercised by `clients.test.js`; both pages connected in desktop browser. |
| Missing admin connection element | Fixed: dashboard uses existing `#connection`; obsolete login map removed. | Registration/startup regression; browser shows Room connected. |
| Premature countdown audio | Fixed: future starts stay paused and schedule against estimated server time. Countdown changes only the number, not the containing screen. | Boundary test at 2999/3000 ms; browser countdown showed paused audio. |
| Stop/end did not pause | Fixed: state messages pause/reset immediately and cancel pending starts; stale play completions cannot restart stopped media. | Stop/end and pending-promise regressions; Stop reset both real browser listeners to zero and paused. |
| Pause/seek/resume behavior | Fixed: paused seek applies immediately; position and rate remain explicit; Resume gets a countdown. | Server lifecycle test, client paused-seek test; browser Pause, seek, Resume. |
| Late Join inaccessible | Fixed: Join stays visible until audio enablement succeeds, including a running room. | Late-join regression; second browser listener joined during 2x playback. |
| Unsynchronized device clocks | Fixed: shared monotonic clock with server-offset samples, rolling lowest RTT, and state-time fallback. | Clock skew, RTT preference and wall-clock jump regression. No physical output-latency calibration. |
| Missing playbackRate in state | Fixed: state includes rate plus position anchor and start time; rate/seek changes preserve pending countdown. | Server/client timing regressions; browser rate observed at 2x plus drift correction. |
| Animation-frame dependency | Fixed: controls apply on incoming state; interval, scheduled start and visibility/pageshow recovery are independent of painting. | Tests intentionally provide no animation-frame API. OS suspension remains a platform limitation. |
| No real readiness acknowledgment | Fixed: listener reports joined/loading/ready/playing/paused/blocked/error/ended; readiness is scoped to the current track and buffer availability. | WS status/track tests and client media-event tests; real dashboard reached 1/1 then 2/2 ready. Start remains an explicit host decision. |
| Unwired preview | Fixed: native controls provide an explicit local audition; room playback pauses preview. | Client test and desktop native-control check. Preview is not a second synchronized listener. |
| Admin reconnect missing | Fixed: shared retry transport registers again, receives current state, guards sends and disables disconnected controls. | Both-client reconnect and restored-state regressions. |
| Listener banner stuck | Fixed: reconnect clears the banner. | Listener disconnect/reconnect regression. |
| Selected last track undeletable | Fixed: selected tracks may be deleted when stopped/ended; next track or null replaces selection. Active/paused deletion remains blocked with a visible error. | Real HTTP deletion, active 409 response, last-track removal, disk and JSON checks. |
| Rejected Join left muted | Fixed: finally restores mute; Join remains retryable and blocked status is reported. | Rejection/retry and pending-gesture tests. |
| Malformed WS input crashed server | Fixed: message shape/type/numeric checks, payload limit, socket error handling and presence heartbeat. | Real WS null/array/primitive/broken JSON/invalid command tests; server remains responsive. |
| Upload reliability and identifier collisions | Fixed: unique UUID names/IDs; finite positive duration and extension checks; bounded upload/metadata timeouts; one queue across selections; JSON error feedback. | Real invalid-upload cleanup and unique-file tests; generated WAV uploaded through browser successfully. Large-file/time-out limits inspected, not exhaustively load-tested. |
| Persistence consistency | Improved: atomic metadata replacement; failed media deletion restores metadata; corrupt JSON fails startup instead of silently overwriting the library. | Persistence/restart/disk integration checks. Disk-failure/crash recovery is not fault-injection tested. |
| Broad SW cache and Range/HTML fallback errors | Fixed: network-only worker, no fetch interception, deletes only legacy ShareMusic shell caches. Secure-context registration and fresh-code headers retained. | Worker regression, real HTTP 206 byte-range check, no-store response check. Legacy installed-worker upgrade across browser versions not device-tested. |
| Static deployment files and missing index fallback | Fixed: removed obsolete `vercel.json` and `public/_redirects`; root redirects to floor; README specifies persistent Node, storage, and WS forwarding. | HTTP route tests; required-asset verifier. No cloud deployment was performed. |
| Placeholder startup address | Fixed: print loopback and actual IPv4 interface addresses; explain which are reachable. | Code inspection; disposable browser host verified at a real bound address. Production CLI network interfaces were not device-tested. |
| Existence-only verifier | Fixed: `npm test` runs regressions; `verify-demo` checks assets and runs the suite. | Both commands pass all 14 tests. |
| Missing authentication | Intentionally superseded: direct dashboard access is the user's chosen policy. No login restored. README explains that anyone with network access can control the room and library. | Direct-route regression; no login panel in browser. |
| Phone-hosting/travel assumptions | Not acceptance requirements, per user correction. Documentation describes the actual Node architecture and optional runtime environments. | Implementation-based scope; no claimed phone/server compatibility test. |

## Validation completed

- `npm test`: 14/14 passing.
- `npm run verify-demo`: asset checks plus 14/14 passing.
- `node --check`: server, shared client, admin client, listener client, service worker.
- `git diff --check`: no whitespace errors (Git emits local LF/CRLF conversion notices).
- Desktop Codex in-app browser with disposable generated WAV: direct dashboard, upload, Join, readiness, countdown silence, playback, Pause, paused seek, speed change, Resume, late Join, Stop on both listeners, native preview and preview interruption. No warning/error logs in three test tabs.
- Test storage was temporary. The real project library was not used. Browser tabs and disposable host were closed; generated browser-test audio was removed.

## Remaining practical limits

Mobile browsers, screen lock, OS suspension, hotspot reachability, codecs beyond the generated WAV, and actual acoustic synchronization were not tested. Network clock estimates and media correction cannot promise sample-accurate sound across hardware or prevent the OS suspending the page. A Home-screen shortcut does not provide an offline server. These are documented limitations, not unimplemented fixes being claimed complete.

Tests are in `tests/clients.test.js`, `tests/server.test.js`, and `tests/worker.test.js`; the deterministic browser harness reads the real HTML script order and IDs. `node scripts/smoke-host.js` starts a disposable manual-browser host and prints a generated WAV path; run it in an interactive terminal and use Ctrl+C (or enter `stop`) to clean up.
