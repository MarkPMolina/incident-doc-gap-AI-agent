<#
.SYNOPSIS
    Posts tech review requests for doc gap drafts to team channels.

.DESCRIPTION
    Groups drafts by target channel, then posts a single batched message per channel
    with a table of drafts (linked title + summary + incident count). Links open in
    document edit mode. Uses Microsoft Graph API for sharing links and messaging.

    This is a reference implementation demonstrating the publish pattern.
    Configure the parameters below for your team's Graph API endpoints.

.PARAMETER GroupId
    Teams group (team) ID.

.PARAMETER SiteId
    SharePoint site ID (Graph format: host,siteGuid,webGuid).

.PARAMETER DriveId
    SharePoint document library drive ID.

.PARAMETER FolderPath
    Relative path to the drafts folder within the document library.

.PARAMETER Drafts
    Array of hashtables, each with: File, Title, Summary, Channel.

.PARAMETER ChannelIds
    Hashtable mapping channel display names to channel IDs.

.PARAMETER DateRange
    The incident scan date range (e.g., "May 1 – Jun 1, 2026").

.PARAMETER RespondByDate
    The date by which reviewers should provide feedback.

.PARAMETER Intro
    Introductory text for the post.

.EXAMPLE
    See bottom of script for invocation pattern.
#>

param(
    [Parameter(Mandatory)]
    [string]$GroupId,

    [Parameter(Mandatory)]
    [string]$SiteId,

    [Parameter(Mandatory)]
    [string]$DriveId,

    [Parameter(Mandatory)]
    [string]$FolderPath,

    [Parameter(Mandatory)]
    [hashtable[]]$Drafts,

    [Parameter(Mandatory)]
    [hashtable]$ChannelIds,

    [Parameter(Mandatory)]
    [string]$DateRange,

    [Parameter(Mandatory)]
    [string]$RespondByDate,

    [string]$Intro = "These doc fix drafts address documentation gaps identified from recent support incidents. Each draft augments an existing documentation page with new troubleshooting scenarios. Please review for technical accuracy and completeness."
)

# Halt on any error
$ErrorActionPreference = "Stop"

# Get Graph token
$token = az account get-access-token --resource "https://graph.microsoft.com" --query "accessToken" -o tsv
if ($LASTEXITCODE -ne 0) {
    throw "✗ Failed to get Graph token. Run 'az login' to refresh authentication."
}

$headers = @{
    Authorization  = "Bearer $token"
    "Content-Type" = "application/json"
}

# Resolve edit sharing links for each draft file
Write-Host "Resolving edit links..."
$editLinks = @{}
foreach ($draft in $Drafts) {
    $filePath = "$FolderPath/$($draft.File)"
    try {
        $item = Invoke-RestMethod -Uri "https://graph.microsoft.com/v1.0/drives/$DriveId/root:/$filePath" -Headers $headers
    } catch {
        throw "✗ Failed to find '$($draft.File)' on shared site at path '$filePath'.`n  Error: $($_.Exception.Message)`n  Verify the file was uploaded before running this script."
    }

    try {
        $linkBody = @{ type = "edit"; scope = "organization" } | ConvertTo-Json
        $linkResp = Invoke-RestMethod -Method Post `
            -Uri "https://graph.microsoft.com/v1.0/drives/$DriveId/items/$($item.id)/createLink" `
            -Headers $headers -Body $linkBody
    } catch {
        throw "✗ Failed to create edit link for '$($draft.File)'.`n  Error: $($_.Exception.Message)`n  You may not have sharing permissions on this document library."
    }

    $editLinks[$draft.File] = $linkResp.link.webUrl
    Write-Host "  ✓ $($draft.File)"
}

# Group drafts by channel
$grouped = @{}
foreach ($draft in $Drafts) {
    $ch = $draft.Channel
    if (-not $grouped.ContainsKey($ch)) { $grouped[$ch] = @() }
    $grouped[$ch] += $draft
}

foreach ($channelName in $grouped.Keys) {
    $channelId = $ChannelIds[$channelName]
    if (-not $channelId) {
        throw "✗ No channel ID configured for '$channelName'. Check the ChannelIds parameter."
    }

    $channelDrafts = $grouped[$channelName]

    # Build table rows using edit links
    $rows = ""
    foreach ($d in $channelDrafts) {
        $url = $editLinks[$d.File]
        $rows += "<tr><td><a href=`"$url`">$($d.Title)</a></td><td>$($d.Summary)</td></tr>`n"
    }

    $html = @"
<h3>📋 Tech Review Request — Doc Gap Drafts</h3>
<p><strong>Incident scan period:</strong> $DateRange</p>
<p>$Intro</p>
<table>
<tr><th>Draft</th><th>Summary</th></tr>
$rows</table>
<h4>What to Review</h4>
<ul>
<li>Technical accuracy of troubleshooting steps and resolutions</li>
<li>Whether the scenarios match what you've seen in practice</li>
<li>Any missing edge cases or incorrect guidance</li>
</ul>
<p>⏰ <strong>Please respond by $RespondByDate.</strong> Add feedback as Word comments (Insert → Comment) rather than direct edits, so changes are attributable and easy to incorporate. Thanks! 🙏</p>
"@

    $body = @{ body = @{ contentType = "html"; content = $html } } | ConvertTo-Json -Depth 5

    try {
        $resp = Invoke-RestMethod -Method Post `
            -Uri "https://graph.microsoft.com/v1.0/teams/$GroupId/channels/$channelId/messages" `
            -Headers $headers -Body $body
        Write-Host "  ✓ Posted to '$channelName' (message ID: $($resp.id))"
    } catch {
        throw "✗ Failed to post to channel '$channelName'.`n  Error: $($_.Exception.Message)"
    }
}

Write-Host "`n✅ All tech review requests posted successfully."
