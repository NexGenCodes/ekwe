import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
  type TextareaHTMLAttributes,
} from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  Info,
  Loader2,
  X,
  XCircle,
} from "lucide-react";
import type { Toast } from "./types";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/* ---------------------------------------------------------------- Button */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}

export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  icon,
  className,
  children,
  disabled,
  type = "button",
  ref,
  ...rest
}: ButtonProps) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(
        "adm-btn",
        `adm-btn--${variant}`,
        `adm-btn--${size}`,
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? (
        <Loader2 className="adm-spin" size={16} aria-hidden="true" />
      ) : (
        icon
      )}
      {children}
    </button>
  );
}

/* ----------------------------------------------------------------- Badge */

export type BadgeTone = "neutral" | "accent" | "success" | "warning" | "danger";

export function Badge({
  tone = "neutral",
  dot = false,
  children,
  className,
}: {
  tone?: BadgeTone;
  dot?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={cx("adm-badge", `adm-badge--${tone}`, className)}>
      {dot && <span className="adm-badge-dot" aria-hidden="true" />}
      {children}
    </span>
  );
}

/* ------------------------------------------------------------- StatusDot */

export function StatusDot({
  tone = "success",
  pulse = false,
}: {
  tone?: "success" | "warning" | "danger" | "neutral";
  pulse?: boolean;
}) {
  return (
    <span
      className={cx("adm-dot", `adm-dot--${tone}`, pulse && "adm-dot--pulse")}
      aria-hidden="true"
    />
  );
}

/* --------------------------------------------------------------- Avatar */

export function Avatar({
  name,
  email,
  size = "md",
}: {
  name?: string | null;
  email?: string | null;
  size?: "sm" | "md";
}) {
  const source = (name ?? "").trim() || (email ?? "").trim();
  const parts = source.split(/[\s.@_-]+/).filter(Boolean);
  const label =
    parts.length === 0
      ? "?"
      : parts.length === 1
        ? parts[0].slice(0, 2).toUpperCase()
        : `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  let hash = 0;
  for (let i = 0; i < source.length; i += 1) {
    hash = (hash * 31 + source.charCodeAt(i)) % 360;
  }
  return (
    <span
      className={cx("adm-avatar", `adm-avatar--${size}`)}
      style={{
        background: `hsl(${hash} 62% 20%)`,
        color: `hsl(${hash} 85% 76%)`,
      }}
      aria-hidden="true"
    >
      {label}
    </span>
  );
}

/* ------------------------------------------------------------- Section */

export function SectionCard({
  title,
  description,
  actions,
  children,
  footer,
  className,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <section className={cx("adm-section", className)}>
      <header className="adm-section-head">
        <div>
          <h2 className="adm-section-title">{title}</h2>
          {description && <p className="adm-section-desc">{description}</p>}
        </div>
        {actions && <div className="adm-section-actions">{actions}</div>}
      </header>
      {children}
      {footer && <footer className="adm-section-foot">{footer}</footer>}
    </section>
  );
}

/* ------------------------------------------------------------ StatCard */

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = "accent",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon: ReactNode;
  tone?: "accent" | "success" | "warning" | "danger";
}) {
  return (
    <div className={cx("adm-stat", `adm-stat--${tone}`)}>
      <div className="adm-stat-top">
        <span className="adm-stat-label">{label}</span>
        <span className="adm-stat-icon" aria-hidden="true">
          {icon}
        </span>
      </div>
      <div className="adm-stat-value">{value}</div>
      {hint && <div className="adm-stat-hint">{hint}</div>}
    </div>
  );
}

/* --------------------------------------------------------------- Fields */

export function Field({
  id,
  label,
  hint,
  error,
  optional,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  optional?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="adm-field">
      <label className="adm-label" htmlFor={id}>
        {label}
        {optional && <span className="adm-label-optional">Optional</span>}
      </label>
      {children}
      {error ? (
        <p className="adm-field-error" id={`${id}-error`}>
          {error}
        </p>
      ) : (
        hint && (
          <p className="adm-field-hint" id={`${id}-hint`}>
            {hint}
          </p>
        )
      )}
    </div>
  );
}

interface TextFieldProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "onChange" | "value"
> {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  error?: string;
  optional?: boolean;
}

export function TextField({
  id,
  label,
  value,
  onChange,
  hint,
  error,
  optional,
  className,
  ...rest
}: TextFieldProps) {
  return (
    <Field id={id} label={label} hint={hint} error={error} optional={optional}>
      <input
        id={id}
        className={cx("adm-input", className)}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={
          error ? `${id}-error` : hint ? `${id}-hint` : undefined
        }
        {...rest}
      />
    </Field>
  );
}

interface TextAreaFieldProps extends Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  "onChange" | "value"
> {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  error?: string;
  optional?: boolean;
}

export function TextAreaField({
  id,
  label,
  value,
  onChange,
  hint,
  error,
  optional,
  className,
  ...rest
}: TextAreaFieldProps) {
  return (
    <Field id={id} label={label} hint={hint} error={error} optional={optional}>
      <textarea
        id={id}
        className={cx("adm-input", "adm-textarea", className)}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={
          error ? `${id}-error` : hint ? `${id}-hint` : undefined
        }
        {...rest}
      />
    </Field>
  );
}

/* ---------------------------------------------------------- EmptyState */

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="adm-empty">
      <span className="adm-empty-icon" aria-hidden="true">
        {icon}
      </span>
      <p className="adm-empty-title">{title}</p>
      {description && <p className="adm-empty-desc">{description}</p>}
      {action && <div className="adm-empty-action">{action}</div>}
    </div>
  );
}

/* --------------------------------------------------------- TableSkeleton */

export function TableSkeleton({
  rows = 6,
  columns = 5,
}: {
  rows?: number;
  columns?: number;
}) {
  return (
    <div className="adm-table-wrap" aria-hidden="true">
      <div className="adm-skeleton-table">
        {Array.from({ length: rows }).map((_, row) => (
          <div className="adm-skeleton-row" key={row}>
            {Array.from({ length: columns }).map((__, col) => (
              <span
                className="adm-skeleton-bar"
                key={col}
                style={{
                  width: col === 0 ? "34%" : `${12 + ((row + col) % 3) * 6}%`,
                }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ CopyButton */

export function CopyButton({
  value,
  label = "Copy",
  className,
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const copy = useCallback(() => {
    const done = () => {
      setCopied(true);
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1600);
    };
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard
        .writeText(value)
        .then(done)
        .catch(() => undefined);
    }
  }, [value]);

  return (
    <button
      type="button"
      className={cx("adm-copy", className)}
      onClick={copy}
      aria-label={copied ? "Copied" : label}
      title={copied ? "Copied" : label}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </button>
  );
}

/* ------------------------------------------------------------ Pagination */

export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  disabled,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  disabled?: boolean;
}) {
  const start = total === 0 ? 0 : page * pageSize + 1;
  const end = Math.min(total, (page + 1) * pageSize);
  const lastPage = Math.max(0, Math.ceil(total / pageSize) - 1);

  return (
    <div className="adm-pagination">
      <p className="adm-pagination-info">
        {total === 0 ? "0 results" : `${start}–${end} of ${total}`}
      </p>
      <div className="adm-pagination-actions">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onPageChange(page - 1)}
          disabled={disabled || page <= 0}
          icon={<ChevronLeft size={16} />}
        >
          Previous
        </Button>
        <span className="adm-pagination-page">
          {page + 1} / {lastPage + 1}
        </span>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onPageChange(page + 1)}
          disabled={disabled || page >= lastPage}
        >
          Next
          <ChevronRight size={16} />
        </Button>
      </div>
    </div>
  );
}

/* ----------------------------------------------------- SegmentedControl */

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: Array<{ value: T; label: string; count?: number }>;
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  return (
    <div className="adm-segmented" role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className="adm-segmented-btn"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
          {option.count !== undefined && (
            <span className="adm-segmented-count">{option.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- Toasts */

const toastIcon = {
  success: CheckCircle2,
  error: XCircle,
  info: Info,
} as const;

export function ToastRegion({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}) {
  return (
    <div className="adm-toasts" role="status" aria-live="polite">
      {toasts.map((toast) => {
        const Icon = toastIcon[toast.tone];
        return (
          <div
            className={cx("adm-toast", `adm-toast--${toast.tone}`)}
            key={toast.id}
          >
            <Icon size={18} className="adm-toast-icon" aria-hidden="true" />
            <div className="adm-toast-body">
              <p className="adm-toast-title">{toast.title}</p>
              {toast.description && (
                <p className="adm-toast-desc">{toast.description}</p>
              )}
            </div>
            <button
              type="button"
              className="adm-toast-close"
              onClick={() => onDismiss(toast.id)}
              aria-label="Dismiss notification"
            >
              <X size={15} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

/* --------------------------------------------------------- ConfirmDialog */

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  tone = "primary",
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  tone?: "primary" | "danger";
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const confirmRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement as HTMLElement | null;
    document.body.style.overflow = "hidden";
    confirmRef.current?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCancelRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusables = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
      previousFocus?.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="adm-dialog-scrim" onMouseDown={onCancel}>
      <div
        ref={dialogRef}
        className="adm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div
          className={cx(
            "adm-dialog-icon",
            tone === "danger" && "adm-dialog-icon--danger",
          )}
          aria-hidden="true"
        >
          <AlertTriangle size={20} />
        </div>
        <h2 className="adm-dialog-title" id={titleId}>
          {title}
        </h2>
        <p className="adm-dialog-desc" id={descriptionId}>
          {description}
        </p>
        <div className="adm-dialog-actions">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            ref={confirmRef}
            variant={tone === "danger" ? "danger" : "primary"}
            loading={busy}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
