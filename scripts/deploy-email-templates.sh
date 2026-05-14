#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# deploy-email-templates.sh
#
# Pushes Ekwe email templates to the hosted Supabase project via Management API.
# This avoids the dashboard entirely — run this after editing templates locally.
#
# Prerequisites:
#   1. Get your access token: https://supabase.com/dashboard/account/tokens
#   2. Set environment variables:
#      export SUPABASE_ACCESS_TOKEN="sbp_..."
#      export SUPABASE_PROJECT_REF="your-project-ref"
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

if [ -z "${SUPABASE_ACCESS_TOKEN:-}" ] || [ -z "${SUPABASE_PROJECT_REF:-}" ]; then
  echo "❌ Missing environment variables."
  echo "   export SUPABASE_ACCESS_TOKEN=\"sbp_...\""
  echo "   export SUPABASE_PROJECT_REF=\"your-project-ref\""
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Read the HTML templates from the file system
MAGIC_LINK_HTML=$(cat "$PROJECT_ROOT/supabase/templates/magic_link.html")
CONFIRMATION_HTML=$(cat "$PROJECT_ROOT/supabase/templates/confirmation.html")

echo "📧 Deploying email templates to Supabase project: $SUPABASE_PROJECT_REF"

# Use jq to safely JSON-encode the HTML (handles quotes, newlines, etc.)
PAYLOAD=$(jq -n \
  --arg ml_subject "Your Ekwe Login Code" \
  --arg ml_content "$MAGIC_LINK_HTML" \
  --arg cf_subject "Confirm Your Ekwe Account" \
  --arg cf_content "$CONFIRMATION_HTML" \
  '{
    mailer_subjects_magic_link: $ml_subject,
    mailer_templates_magic_link_content: $ml_content,
    mailer_subjects_confirmation: $cf_subject,
    mailer_templates_confirmation_content: $cf_content
  }')

RESPONSE=$(curl -s -w "\n%{http_code}" -X PATCH \
  "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/config/auth" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 300 ]; then
  echo "✅ Email templates deployed successfully (HTTP $HTTP_CODE)"
else
  echo "❌ Failed to deploy (HTTP $HTTP_CODE)"
  echo "$BODY"
  exit 1
fi
