---
uid: remote-access-troubleshooting-patch
title: "Remote Access — Rate Limit Scenarios"
draft_type: augmentation_patch
motivated_by_icms:
  - id: 100000004
    url: https://incidents.example.com/details/100000004
augments:
  target_path: docs_external/troubleshooting/remote-access.md
  target_uid: remote-access-troubleshooting
---

### Patch 1

**Insert at:** End of `## Troubleshooting` section

````markdown
### API rate limiting during batch operations (HTTP 429)

**Symptom:** Batch scripts or automation that make multiple API calls in rapid succession receive:

> `HTTP 429 Too Many Requests — Retry-After: 30`

**Cause:** The API gateway enforces per-client rate limits (default: 100 requests/minute). Batch operations that don't implement backoff will hit this limit quickly.

**Resolution:**

1. Implement exponential backoff in your scripts:
   ```powershell
   $retryCount = 0
   $maxRetries = 5
   do {
       try {
           $result = Invoke-BatchOperation -Items $batch
           break
       } catch {
           if ($_.Exception.Response.StatusCode -eq 429) {
               $wait = [math]::Pow(2, $retryCount) * 1000
               Start-Sleep -Milliseconds $wait
               $retryCount++
           } else { throw }
       }
   } while ($retryCount -lt $maxRetries)
   ```

2. Reduce batch sizes — process in chunks of 25 rather than sending all at once.

3. Check your current rate limit status:
   ```powershell
   Get-ThrottleStatus
   ```

**Prevention:** For scheduled automation, spread requests across the rate limit window. Use the `Retry-After` header value rather than fixed delays.
````
