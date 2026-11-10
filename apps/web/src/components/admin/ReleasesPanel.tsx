import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Download,
  ExternalLink,
  FileText,
  Hash,
  Package,
  Rocket,
  RotateCcw,
  Send,
  Smartphone,
} from "lucide-react";
import {
  Badge,
  Button,
  CopyButton,
  EmptyState,
  SectionCard,
  TextAreaField,
  TextField,
} from "./primitives";
import { fmtBytes } from "./format";
import type { Manifest, ManifestPayload, NotifyPayload } from "./types";

interface PublishForm {
  latest_version: string;
  latest_version_code: string;
  min_supported_version_code: string;
  download_url: string;
  checksum_sha256: string;
  file_size: string;
  release_notes: string;
}

interface NotifyForm {
  version: string;
  downloadUrl: string;
  versionCode: string;
  checksumSha256: string;
}

const EMPTY_PUBLISH: PublishForm = {
  latest_version: "",
  latest_version_code: "",
  min_supported_version_code: "",
  download_url: "",
  checksum_sha256: "",
  file_size: "",
  release_notes: "",
};

const EMPTY_NOTIFY: NotifyForm = {
  version: "",
  downloadUrl: "",
  versionCode: "",
  checksumSha256: "",
};

type PublishErrors = Partial<Record<keyof PublishForm, string>>;
type NotifyErrors = Partial<Record<keyof NotifyForm, string>>;

function formFromManifest(manifest: Manifest): PublishForm {
  return {
    latest_version: manifest.latest_version,
    latest_version_code: String(manifest.latest_version_code),
    min_supported_version_code: String(manifest.min_supported_version_code),
    download_url: manifest.download_url,
    checksum_sha256: manifest.checksum_sha256 ?? "",
    file_size: manifest.file_size ? String(manifest.file_size) : "",
    release_notes: manifest.release_notes ?? "",
  };
}

function notifyFromManifest(manifest: Manifest): NotifyForm {
  return {
    version: manifest.latest_version,
    downloadUrl: manifest.download_url,
    versionCode: String(manifest.latest_version_code),
    checksumSha256: manifest.checksum_sha256 ?? "",
  };
}

const SEMVER = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const SHA256 = /^[0-9a-fA-F]{64}$/;

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function validatePublish(form: PublishForm): PublishErrors {
  const errors: PublishErrors = {};
  const version = form.latest_version.trim();
  const code = Number(form.latest_version_code);
  const minCode = Number(form.min_supported_version_code);

  if (!version) errors.latest_version = "Version is required.";
  else if (!SEMVER.test(version))
    errors.latest_version = "Use semantic versioning, e.g. 1.4.0.";

  if (!form.latest_version_code.trim())
    errors.latest_version_code = "Version code is required.";
  else if (!Number.isInteger(code) || code <= 0)
    errors.latest_version_code = "Use a whole number greater than 0.";

  if (!form.min_supported_version_code.trim())
    errors.min_supported_version_code = "Minimum supported code is required.";
  else if (!Number.isInteger(minCode) || minCode < 0)
    errors.min_supported_version_code = "Use a whole number, 0 or greater.";
  else if (Number.isInteger(code) && code > 0 && minCode > code)
    errors.min_supported_version_code =
      "Cannot exceed the latest version code.";

  const url = form.download_url.trim();
  if (!url) errors.download_url = "Download URL is required.";
  else if (!isHttpsUrl(url))
    errors.download_url = "Must be a valid https:// URL.";

  const checksum = form.checksum_sha256.trim();
  if (checksum && !SHA256.test(checksum))
    errors.checksum_sha256 = "Enter a 64-character SHA-256 hex digest.";

  const size = form.file_size.trim();
  if (size && (!Number.isInteger(Number(size)) || Number(size) <= 0))
    errors.file_size = "Use a positive whole number of bytes.";

  return errors;
}

function validateNotify(form: NotifyForm): NotifyErrors {
  const errors: NotifyErrors = {};
  if (!form.version.trim()) errors.version = "Version is required.";
  else if (!SEMVER.test(form.version.trim()))
    errors.version = "Use semantic versioning, e.g. 1.4.0.";

  const url = form.downloadUrl.trim();
  if (!url) errors.downloadUrl = "Download URL is required.";
  else if (!isHttpsUrl(url))
    errors.downloadUrl = "Must be a valid https:// URL.";

  const code = form.versionCode.trim();
  if (code && (!Number.isInteger(Number(code)) || Number(code) <= 0))
    errors.versionCode = "Use a whole number greater than 0.";

  const checksum = form.checksumSha256.trim();
  if (checksum && !SHA256.test(checksum))
    errors.checksumSha256 = "Enter a 64-character SHA-256 hex digest.";

  return errors;
}

export function ReleasesPanel({
  manifest,
  loading,
  publishing,
  notifying,
  onPublish,
  onNotify,
}: {
  manifest: Manifest | null;
  loading: boolean;
  publishing: boolean;
  notifying: boolean;
  onPublish: (payload: ManifestPayload) => void;
  onNotify: (payload: NotifyPayload) => void;
}) {
  const [form, setForm] = useState<PublishForm>(EMPTY_PUBLISH);
  const [notifyForm, setNotifyForm] = useState<NotifyForm>(EMPTY_NOTIFY);
  const [errors, setErrors] = useState<PublishErrors>({});
  const [notifyErrors, setNotifyErrors] = useState<NotifyErrors>({});
  const manifestKey = manifest
    ? JSON.stringify([
        manifest.latest_version,
        manifest.latest_version_code,
        manifest.min_supported_version_code,
        manifest.download_url,
        manifest.checksum_sha256 ?? "",
        manifest.file_size ?? "",
        manifest.release_notes ?? "",
      ])
    : "";
  const syncedKey = useRef("");

  useEffect(() => {
    if (!manifest || syncedKey.current === manifestKey) return;
    syncedKey.current = manifestKey;
    setForm(formFromManifest(manifest));
    setNotifyForm(notifyFromManifest(manifest));
    setErrors({});
    setNotifyErrors({});
  }, [manifest, manifestKey]);

  const updatePublish = <K extends keyof PublishForm>(
    key: K,
    value: PublishForm[K],
  ) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const updateNotify = <K extends keyof NotifyForm>(
    key: K,
    value: NotifyForm[K],
  ) => {
    setNotifyForm((current) => ({ ...current, [key]: value }));
    setNotifyErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const publish = () => {
    const nextErrors = validatePublish(form);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    const payload: ManifestPayload = {
      latest_version: form.latest_version.trim(),
      latest_version_code: Number(form.latest_version_code),
      min_supported_version_code: Number(form.min_supported_version_code),
      download_url: form.download_url.trim(),
    };
    if (form.checksum_sha256.trim())
      payload.checksum_sha256 = form.checksum_sha256.trim();
    if (form.file_size.trim())
      payload.file_size = Number(form.file_size.trim());
    if (form.release_notes.trim())
      payload.release_notes = form.release_notes.trim();
    onPublish(payload);
  };

  const sendNotify = () => {
    const nextErrors = validateNotify(notifyForm);
    setNotifyErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    const payload: NotifyPayload = {
      version: notifyForm.version.trim(),
      downloadUrl: notifyForm.downloadUrl.trim(),
    };
    if (notifyForm.versionCode.trim())
      payload.versionCode = Number(notifyForm.versionCode.trim());
    if (notifyForm.checksumSha256.trim())
      payload.checksumSha256 = notifyForm.checksumSha256.trim();
    onNotify(payload);
  };

  const dirty = manifest
    ? JSON.stringify(form) !== JSON.stringify(formFromManifest(manifest))
    : Object.values(form).some((value) => value.trim() !== "");

  return (
    <div className="adm-stack">
      <SectionCard
        title="Current release"
        description="The manifest served to installed apps on launch."
        actions={
          manifest ? (
            <Badge tone="success" dot>
              Published
            </Badge>
          ) : (
            <Badge tone="neutral">Not published</Badge>
          )
        }
      >
        {loading && !manifest ? (
          <div className="adm-release-skeleton" aria-hidden="true">
            <div
              className="adm-skeleton-bar"
              style={{ width: "30%", height: 28 }}
            />
            <div className="adm-skeleton-bar" style={{ width: "60%" }} />
            <div className="adm-skeleton-bar" style={{ width: "45%" }} />
          </div>
        ) : !manifest ? (
          <EmptyState
            icon={<Rocket size={22} />}
            title="No build published yet"
            description="Upload the APK to R2, then publish a manifest below to enable in-app update prompts."
          />
        ) : (
          <div className="adm-release">
            <div className="adm-release-head">
              <span className="adm-release-mark" aria-hidden="true">
                <Smartphone size={22} />
              </span>
              <div>
                <p className="adm-release-version">
                  v{manifest.latest_version}
                  <Badge tone="accent">Android</Badge>
                </p>
                <p className="adm-release-sub">
                  Build {manifest.latest_version_code} · minimum supported{" "}
                  {manifest.min_supported_version_code}
                </p>
              </div>
              {manifest.file_size ? (
                <span className="adm-release-size">
                  <Download size={14} aria-hidden="true" />
                  {fmtBytes(manifest.file_size)}
                </span>
              ) : null}
            </div>

            <dl className="adm-kv-grid">
              <div className="adm-kv">
                <dt>
                  <Package size={13} aria-hidden="true" /> Version code
                </dt>
                <dd className="adm-mono">{manifest.latest_version_code}</dd>
              </div>
              <div className="adm-kv">
                <dt>
                  <FileText size={13} aria-hidden="true" /> Minimum supported
                </dt>
                <dd className="adm-mono">
                  {manifest.min_supported_version_code}
                </dd>
              </div>
              <div className="adm-kv adm-kv--wide">
                <dt>
                  <Hash size={13} aria-hidden="true" /> Checksum
                </dt>
                <dd className="adm-inline">
                  <span className="adm-mono adm-truncate">
                    {manifest.checksum_sha256 ?? "Not set"}
                  </span>
                  {manifest.checksum_sha256 && (
                    <CopyButton
                      value={manifest.checksum_sha256}
                      label="Copy checksum"
                    />
                  )}
                </dd>
              </div>
              <div className="adm-kv adm-kv--wide">
                <dt>
                  <ExternalLink size={13} aria-hidden="true" /> Download URL
                </dt>
                <dd className="adm-inline">
                  <a
                    className="adm-link adm-truncate"
                    href={manifest.download_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {manifest.download_url}
                  </a>
                  <CopyButton
                    value={manifest.download_url}
                    label="Copy download URL"
                  />
                </dd>
              </div>
            </dl>

            {manifest.release_notes && (
              <div className="adm-release-notes">
                <p className="adm-kv-label">Release notes</p>
                <p>{manifest.release_notes}</p>
              </div>
            )}
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Publish manifest"
        description="Publishing updates the version gate for every installed app immediately."
        actions={
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              setForm(manifest ? formFromManifest(manifest) : EMPTY_PUBLISH)
            }
            disabled={!dirty || publishing}
            icon={<RotateCcw size={14} />}
          >
            Reset
          </Button>
        }
      >
        <div className="adm-form-grid">
          <TextField
            id="release-version"
            label="Latest version"
            value={form.latest_version}
            onChange={(value) => updatePublish("latest_version", value)}
            placeholder="1.4.0"
            hint="Semantic version shown in the app."
            error={errors.latest_version}
            autoComplete="off"
            spellCheck={false}
          />
          <TextField
            id="release-code"
            label="Version code"
            value={form.latest_version_code}
            onChange={(value) => updatePublish("latest_version_code", value)}
            placeholder="10400"
            hint="Monotonic integer from the Android build."
            error={errors.latest_version_code}
            inputMode="numeric"
            autoComplete="off"
          />
          <TextField
            id="release-min-code"
            label="Minimum supported code"
            value={form.min_supported_version_code}
            onChange={(value) =>
              updatePublish("min_supported_version_code", value)
            }
            placeholder="10300"
            hint="Older builds below this code must update."
            error={errors.min_supported_version_code}
            inputMode="numeric"
            autoComplete="off"
          />
          <TextField
            id="release-size"
            label="Package size (bytes)"
            value={form.file_size}
            onChange={(value) => updatePublish("file_size", value)}
            placeholder="48234496"
            hint="Used for the download size label."
            error={errors.file_size}
            optional
            inputMode="numeric"
            autoComplete="off"
          />
          <TextField
            id="release-checksum"
            label="SHA-256 checksum"
            value={form.checksum_sha256}
            onChange={(value) => updatePublish("checksum_sha256", value)}
            placeholder="64 hex characters"
            hint="Lets clients verify the APK after download."
            error={errors.checksum_sha256}
            optional
            autoComplete="off"
            spellCheck={false}
            className="adm-mono"
          />
          <div className="adm-form-span">
            <TextField
              id="release-url"
              label="Download URL"
              value={form.download_url}
              onChange={(value) => updatePublish("download_url", value)}
              placeholder="https://…/ekwe-1.4.0.apk"
              hint="Must be a public https:// URL, typically an R2 object."
              error={errors.download_url}
              autoComplete="off"
              spellCheck={false}
              className="adm-mono"
            />
          </div>
          <div className="adm-form-span">
            <TextAreaField
              id="release-notes"
              label="Release notes"
              value={form.release_notes}
              onChange={(value) => updatePublish("release_notes", value)}
              placeholder="What changed in this build?"
              hint="Shown in the update prompt inside the app."
              optional
              rows={3}
            />
          </div>
        </div>

        <div className="adm-form-actions">
          <Button
            variant="primary"
            onClick={publish}
            loading={publishing}
            icon={<Rocket size={15} />}
          >
            Publish manifest
          </Button>
          <p className="adm-form-note">
            You will be asked to confirm before the manifest goes live.
          </p>
        </div>
      </SectionCard>

      <SectionCard
        title="Send update notification"
        description="Push an update prompt to every active Android installation."
      >
        <div className="adm-callout adm-callout--warning">
          <AlertTriangle size={18} aria-hidden="true" />
          <div>
            <p className="adm-callout-title">This reaches real devices</p>
            <p className="adm-callout-desc">
              The notification is delivered through Expo to all active Android
              push tokens. It cannot be recalled once sent.
            </p>
          </div>
        </div>

        <div className="adm-form-grid">
          <TextField
            id="notify-version"
            label="Version"
            value={notifyForm.version}
            onChange={(value) => updateNotify("version", value)}
            placeholder="1.4.0"
            error={notifyErrors.version}
            autoComplete="off"
            spellCheck={false}
          />
          <TextField
            id="notify-code"
            label="Version code"
            value={notifyForm.versionCode}
            onChange={(value) => updateNotify("versionCode", value)}
            placeholder="10400"
            error={notifyErrors.versionCode}
            optional
            inputMode="numeric"
            autoComplete="off"
          />
          <div className="adm-form-span">
            <TextField
              id="notify-url"
              label="Download URL"
              value={notifyForm.downloadUrl}
              onChange={(value) => updateNotify("downloadUrl", value)}
              placeholder="https://…/ekwe-1.4.0.apk"
              error={notifyErrors.downloadUrl}
              autoComplete="off"
              spellCheck={false}
              className="adm-mono"
            />
          </div>
          <div className="adm-form-span">
            <TextField
              id="notify-checksum"
              label="SHA-256 checksum"
              value={notifyForm.checksumSha256}
              onChange={(value) => updateNotify("checksumSha256", value)}
              placeholder="64 hex characters"
              error={notifyErrors.checksumSha256}
              optional
              autoComplete="off"
              spellCheck={false}
              className="adm-mono"
            />
          </div>
        </div>

        <div className="adm-form-actions">
          <Button
            variant="secondary"
            onClick={sendNotify}
            loading={notifying}
            icon={<Send size={15} />}
          >
            Send notification
          </Button>
          <p className="adm-form-note">
            Prefilled from the current manifest. Edit before sending if needed.
          </p>
        </div>
      </SectionCard>
    </div>
  );
}
