# Enhancement checklist

Scope: preserve the existing local room, HTTP music, trusted HTTPS voice, persisted uploads, and smooth default playback. No public hosting or automatic trust changes.

| Feature | Implementation | Verification |
| --- | --- | --- |
| Local QR invitation and copyable network link | Pending | Pending |
| Connection, buffering and microphone diagnostics | Pending | Pending |
| Smooth / tight sync (Smooth default) | Pending | Pending |
| Optional wait for listener buffers + Start now override | Pending | Pending |
| Ordered queue and opt-in automatic next song | Pending | Pending |
| Music + voice without leaving the music page | Pending | Pending |
| Optional lower music during speech | Pending | Pending |
| Voice activity indicators | Pending | Pending |
| Individual friend volume | Pending | Pending |
| Explicit voice reconnect | Pending | Pending |
| Room PIN / authenticated admin | Deferred | Existing direct dashboard is intentional; authentication, recovery and HTTP/HTTPS sessions need a separate migration. This release remains for trusted local networks. |

The current request authorizes feature tests, superseding the earlier no-tests preference. Automated tests will use temporary media/storage and simulated browser media where appropriate. Physical phone audio, certificate enrollment, QR scanning, and background behavior must be reported separately from automated checks.
