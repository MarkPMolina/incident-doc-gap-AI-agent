---
uid: onboarding-setup-guide
title: "Environment Setup & Onboarding Troubleshooting"
draft_type: standalone
motivated_by_icms:
  - id: 100000007
    url: https://incidents.example.com/details/100000007
  - id: 100000008
    url: https://incidents.example.com/details/100000008
  - id: 100000009
    url: https://incidents.example.com/details/100000009
target_location: docs_external/getting-started/
toc_parent: docs_external/getting-started/toc.yml
---

# Environment Setup & Onboarding Troubleshooting

This guide covers common issues encountered during initial environment setup, application registration, and role configuration.

## Prerequisites check failures

**Symptom:** Running the setup wizard or `Initialize-Environment` fails with "prerequisite check failed" or exits with a list of unmet dependencies.

**Common causes and fixes:**

1. **Client tools not installed or outdated:**
   ```powershell
   # Check installed version
   Get-InstalledModule -Name AdminTools | Select-Object Version

   # Update to latest
   Update-Module AdminTools -Force
   ```

2. **Network connectivity to control plane:**
   Verify you can reach the service endpoints:
   ```powershell
   Test-NetConnection admin-api.example.com -Port 443
   ```

3. **Missing role assignments:**
   Your account needs at minimum the `Reader` role on the target environment before setup can proceed. Contact your team admin if prerequisites list "insufficient permissions."

## Application registration errors

**Symptom:** `Register-Application` fails with "not authorized" or "insufficient privileges" despite having followed the documentation.

**Cause:** Application registration requires a specific delegated permission that is separate from your user role. The documentation's prerequisite section lists "Application Administrator" but doesn't clarify this is a directory-level role, not an environment role.

**Resolution:**

1. Verify your directory role assignments:
   ```powershell
   Get-RoleAssignment -Principal (whoami) -Scope Directory
   ```
2. If missing, request the `Application Administrator` directory role from your identity team.
3. After role assignment propagates (up to 15 minutes), retry:
   ```powershell
   Register-Application -Name "MyApp" -Type "Service"
   ```

## Role configuration incomplete

**Symptom:** `Set-RoleConfig` returns "environment not configured" even after successful setup.

**Cause:** Role configuration depends on a backend propagation step that completes asynchronously after `Initialize-Environment`. The setup wizard reports success before propagation finishes.

**Resolution:**

1. Wait 5-10 minutes after initial setup completes.
2. Verify propagation status:
   ```powershell
   Get-EnvironmentStatus -Verbose
   ```
3. If status shows "Provisioning," wait and retry. If "Failed," re-run:
   ```powershell
   Initialize-Environment -Force -Verbose
   ```
4. Once status shows "Ready," retry role configuration:
   ```powershell
   Set-RoleConfig -Environment Production -Role Operator
   ```

## Getting help

If these steps don't resolve your issue:
- Check the [known issues page](xref:known-issues) for current outages or delays
- Open a support incident with your setup logs attached (`$env:LOCALAPPDATA\Setup\logs\`)
