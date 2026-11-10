import { Receipt, Wallet } from "lucide-react";
import {
  Badge,
  CopyButton,
  EmptyState,
  SectionCard,
  TableSkeleton,
} from "./primitives";
import type { BadgeTone } from "./primitives";
import {
  fmtCurrency,
  fmtDate,
  fmtRelative,
  fmtTimeLeft,
  shortId,
} from "./format";
import type { Claim, Subscription } from "./types";

function statusTone(status: string): BadgeTone {
  const value = status.toLowerCase();
  if (["active", "paid", "succeeded", "completed"].includes(value)) {
    return "success";
  }
  if (["pending", "processing", "trialing", "open"].includes(value)) {
    return "warning";
  }
  if (
    ["expired", "cancelled", "canceled", "failed", "refunded"].includes(value)
  ) {
    return "danger";
  }
  return "neutral";
}

function titleCase(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function BillingPanel({
  subscriptions,
  claims,
  loading,
}: {
  subscriptions: Subscription[];
  claims: Claim[];
  loading: boolean;
}) {
  const now = Date.now();

  return (
    <div className="adm-stack">
      <SectionCard
        title="Subscriptions"
        description="Latest store and web subscriptions across all accounts."
        actions={<Badge tone="neutral">{subscriptions.length} shown</Badge>}
      >
        {loading && subscriptions.length === 0 ? (
          <TableSkeleton rows={5} columns={5} />
        ) : subscriptions.length === 0 ? (
          <EmptyState
            icon={<Wallet size={22} />}
            title="No subscriptions yet"
            description="App Store, Play Store, and web subscriptions will show up here."
          />
        ) : (
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead>
                <tr>
                  <th scope="col">Account</th>
                  <th scope="col">Status</th>
                  <th scope="col">Plan</th>
                  <th scope="col">Platform</th>
                  <th scope="col">Expires</th>
                </tr>
              </thead>
              <tbody>
                {subscriptions.map((subscription, index) => (
                  <tr key={`${subscription.user_id}-${index}`}>
                    <td className="adm-cell-primary" data-label="Account">
                      <div className="adm-id">
                        <span className="adm-mono">
                          {shortId(subscription.user_id, 12)}
                        </span>
                        <CopyButton
                          value={subscription.user_id}
                          label="Copy user ID"
                        />
                      </div>
                    </td>
                    <td data-label="Status">
                      <Badge tone={statusTone(subscription.status)} dot>
                        {titleCase(subscription.status)}
                      </Badge>
                    </td>
                    <td data-label="Plan">
                      <span className="adm-mono adm-mono--soft">
                        {subscription.product_id || "—"}
                      </span>
                    </td>
                    <td data-label="Platform">
                      <span className="adm-text">
                        {subscription.platform
                          ? titleCase(subscription.platform)
                          : "—"}
                      </span>
                    </td>
                    <td data-label="Expires">
                      <span className="adm-access">
                        {fmtDate(subscription.expires_at)}
                        {subscription.expires_at && (
                          <span className="adm-access-note">
                            {fmtTimeLeft(subscription.expires_at)}
                          </span>
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Flutterwave claims"
        description="Manual bank-transfer claims awaiting or granted Premium access."
        actions={<Badge tone="neutral">{claims.length} shown</Badge>}
      >
        {loading && claims.length === 0 ? (
          <TableSkeleton rows={5} columns={6} />
        ) : claims.length === 0 ? (
          <EmptyState
            icon={<Receipt size={22} />}
            title="No payment claims"
            description="Flutterwave transfer claims appear here once a customer submits a reference."
          />
        ) : (
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead>
                <tr>
                  <th scope="col">Reference</th>
                  <th scope="col">Account</th>
                  <th scope="col">Amount</th>
                  <th scope="col">Status</th>
                  <th scope="col">Claimed</th>
                  <th scope="col">Expires</th>
                </tr>
              </thead>
              <tbody>
                {claims.map((claim) => {
                  const expired = claim.expires_at < now;
                  return (
                    <tr key={claim.flw_ref}>
                      <td className="adm-cell-primary" data-label="Reference">
                        <div className="adm-id">
                          <span className="adm-mono">{claim.flw_ref}</span>
                          <CopyButton
                            value={claim.flw_ref}
                            label="Copy Flutterwave reference"
                          />
                        </div>
                        {claim.tx_ref && (
                          <span className="adm-cell-sub">
                            tx {claim.tx_ref}
                          </span>
                        )}
                      </td>
                      <td data-label="Account">
                        <div className="adm-id">
                          <span className="adm-mono">
                            {shortId(claim.user_id, 12)}
                          </span>
                          <CopyButton
                            value={claim.user_id}
                            label="Copy user ID"
                          />
                        </div>
                      </td>
                      <td data-label="Amount">
                        <span className="adm-amount">
                          {fmtCurrency(claim.amount, claim.currency)}
                        </span>
                      </td>
                      <td data-label="Status">
                        <Badge tone={expired ? "danger" : "warning"} dot>
                          {expired ? "Expired" : "Open"}
                        </Badge>
                      </td>
                      <td data-label="Claimed">
                        <span className="adm-date">
                          {fmtRelative(claim.claimed_at)}
                        </span>
                      </td>
                      <td data-label="Expires">
                        <span className="adm-date">
                          {fmtRelative(claim.expires_at)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
