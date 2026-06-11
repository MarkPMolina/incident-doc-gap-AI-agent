---
uid: auth-token-errors-troubleshooting
title: "Authentication Token Troubleshooting — Credential Rotation & Cache Staleness"
draft_type: augmentation_patch
motivated_by_icms:
  - id: 100000001
    url: https://incidents.example.com/details/100000001
  - id: 100000002
    url: https://incidents.example.com/details/100000002
augments:
  target_path: docs_external/troubleshooting/authentication-errors.md
  target_uid: auth-errors-troubleshooting
---

### Patch 1

**Insert at:** End of `## Common issues` section

````markdown
### Token cache staleness after credential rotation

**Symptom:** After rotating credentials (certificate renewal, password change, or key rotation), connections fail with errors like:

> `IDX10223: Lifetime validation failed. The token is expired.`

or

> `Unable to acquire token — cached credential no longer valid`

**Cause:** The local token cache retains tokens signed with the old credential. The system does not automatically invalidate cached tokens when credentials are rotated externally.

**Resolution:**

1. Clear the local token cache:
   ```powershell
   Remove-Item "$env:LOCALAPPDATA\YourApp\TokenCache\*" -Force
   ```
2. Close all active sessions (terminal windows, background processes).
3. Re-authenticate:
   ```powershell
   Connect-AdminShell
   ```
4. Verify the new credential is being used:
   ```powershell
   Get-AuthToken | Select-Object ExpiresOn, Thumbprint
   ```

**Prevention:** After any credential rotation, always clear the token cache before opening new sessions. Consider adding cache clearing to your rotation runbook.
````

### Patch 2

**Insert at:** End of `## Certificate-based authentication` section

````markdown
### Certificate renewal failures (IDX10223)

**Symptom:** After renewing a client certificate, admin shell connections fail with:

> `IDX10223: Lifetime validation failed`

even though the new certificate is installed and the old one is removed.

**Cause:** The authentication library caches the certificate thumbprint from the initial connection. Renewal changes the thumbprint, but the cached thumbprint reference is not updated automatically.

**Resolution:**

1. Verify the new certificate is installed:
   ```powershell
   Get-ChildItem Cert:\CurrentUser\My | Where-Object { $_.NotAfter -gt (Get-Date) }
   ```
2. Update the thumbprint reference in your profile configuration.
3. Clear the token cache (see "Token cache staleness" above).
4. Reconnect with the explicit new thumbprint if auto-detection fails:
   ```powershell
   Connect-AdminShell -CertificateThumbprint <new-thumbprint>
   ```
````
