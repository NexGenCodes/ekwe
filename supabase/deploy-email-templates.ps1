# ──────────────────────────────────────────────────────────────────────────────
# deploy-email-templates.ps1
#
# Pushes Ekwe email templates to the hosted Supabase project via Management API.
# This avoids the dashboard entirely — run this after editing templates locally.
#
# Usage:
#   $env:SUPABASE_ACCESS_TOKEN = "sbp_..."
#   $env:SUPABASE_PROJECT_REF = "your-project-ref"
#   .\supabase\deploy-email-templates.ps1
# ──────────────────────────────────────────────────────────────────────────────

$ErrorActionPreference = "Stop"

# Auto-load from .env if env vars not already set
$EnvFile = Join-Path (Split-Path -Parent $PSScriptRoot) ".env"
if (Test-Path $EnvFile) {
    Get-Content $EnvFile | Where-Object { $_ -match "^\s*[^#].*=.*" } | ForEach-Object {
        $parts = $_ -split "=", 2
        $key = $parts[0].Trim()
        $val = $parts[1].Trim().Trim('"')
        if (-not [System.Environment]::GetEnvironmentVariable($key)) {
            [System.Environment]::SetEnvironmentVariable($key, $val, "Process")
        }
    }
}

if (-not $env:SUPABASE_ACCESS_TOKEN -or -not $env:SUPABASE_PROJECT_REF) {
    Write-Host "❌ Missing SUPABASE_ACCESS_TOKEN or SUPABASE_PROJECT_REF." -ForegroundColor Red
    Write-Host "   Add them to your .env file or set them manually."
    exit 1
}

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$MagicLinkHtml = Get-Content -Path "$ProjectRoot\supabase\templates\magic_link.html" -Raw
$ConfirmationHtml = Get-Content -Path "$ProjectRoot\supabase\templates\confirmation.html" -Raw

Write-Host "📧 Deploying email templates to Supabase project: $env:SUPABASE_PROJECT_REF"

# Build JSON manually to avoid ConvertTo-Json encoding issues with HTML content
$MagicLinkEscaped = $MagicLinkHtml -replace '\\', '\\' -replace '"', '\"' -replace "`r`n", '' -replace "`n", ''
$ConfirmationEscaped = $ConfirmationHtml -replace '\\', '\\' -replace '"', '\"' -replace "`r`n", '' -replace "`n", ''

$JsonBody = "{`"mailer_subjects_magic_link`":`"Your Ekwe Login Code`",`"mailer_templates_magic_link_content`":`"$MagicLinkEscaped`",`"mailer_subjects_confirmation`":`"Confirm Your Ekwe Account`",`"mailer_templates_confirmation_content`":`"$ConfirmationEscaped`"}"
$BodyBytes = [System.Text.Encoding]::UTF8.GetBytes($JsonBody)

$Headers = @{
    "Authorization" = "Bearer $env:SUPABASE_ACCESS_TOKEN"
    "Content-Type"  = "application/json"
}

try {
    $Response = Invoke-RestMethod `
        -Uri "https://api.supabase.com/v1/projects/$env:SUPABASE_PROJECT_REF/config/auth" `
        -Method Patch `
        -Headers $Headers `
        -Body $BodyBytes

    Write-Host "✅ Email templates deployed successfully!" -ForegroundColor Green
} catch {
    Write-Host "❌ Failed to deploy templates." -ForegroundColor Red
    Write-Host $_.Exception.Message
    exit 1
}
