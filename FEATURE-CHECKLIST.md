# Enhancement checklist

Scope: preserve the local room, HTTP music, trusted HTTPS voice, persisted uploads, and smooth default playback. No public hosting or automatic trust changes.

| Feature | Implementation | Verification |
| --- | --- | --- |
| Local QR invitation and copyable network link | Complete | Server invitation/SVG validation passed; desktop dialog renders links and QR. Phone scanning remains manual. |
| Connection, buffering and microphone diagnostics | Complete | Client checks and desktop dialog confirmed. Phone permission UI remains manual. |
| Smooth / tight sync (Smooth default) | Complete | Drift, buffering, seek cooldown and mode-change regressions passed. Acoustic timing remains manual. |
| Optional wait for listener buffers + Start now override | Complete | Fresh readiness, stale reports, timeout, override, cancellation and disconnect checks passed. |
| Ordered queue and opt-in automatic next song | Complete | Order, duplicates, removal, deletion and automatic transition checks passed. |
| Live track selection, Previous / Next / Shuffle | Complete | Server/client regressions passed; desktop Next while playing and Shuffle while paused confirmed. |
| Music + voice without leaving the music page | Complete | Panel lifecycle and retained player covered with browser/media mocks; physical phones remain manual. |
| Optional lower music during speech | Complete | Mocked activity/volume restoration and message-source validation passed. Physical browser volume support remains manual. |
| Voice activity indicators | Complete | Simulated audio activity and cleanup checks passed. Physical microphones remain manual. |
| Individual friend volume | Complete | Per-peer gain checks passed with simulated audio nodes. Physical output remains manual. |
| Explicit voice reconnect | Complete | Rejoin starts muted and releases old resources in client checks. Phone network recovery remains manual. |
| Room PIN / authenticated admin | Deferred | Authentication, recovery and HTTP/HTTPS sessions need a separate migration. This release remains for trusted local networks. |

The current request authorizes feature tests, superseding the earlier no-tests preference. The suite has 36 passing checks using temporary media/storage and simulated browser media where appropriate. Physical phone audio, certificate enrollment, QR scanning, and background behavior are not claimed verified.
