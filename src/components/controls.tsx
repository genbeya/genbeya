import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import "./controls.css";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "danger" | "default";
  size?: "s" | "m";
  icon?: ReactNode;
  shortcut?: string;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "default", size = "m", icon, shortcut, className = "", children, type = "button", ...props },
  ref,
) {
  return (
    <button ref={ref} type={type} className={`btn btn-${variant} btn-${size} ${className}`} {...props}>
      {icon}
      {children && <span>{children}</span>}
      {shortcut && <Kbd>{shortcut}</Kbd>}
    </button>
  );
});

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean };

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, active, className = "", children, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={`icon-btn ${active ? "is-active" : ""} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
});

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

export function EmptyState({
  icon,
  title,
  children,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      {icon && <div className="empty-icon">{icon}</div>}
      <h3>{title}</h3>
      {children}
    </div>
  );
}

const AVATAR_COLORS = ["#7c7ff2", "#4cb782", "#e8955a", "#5e9eef", "#d46aa8", "#ddb345", "#a77ee6", "#3fb5b5"];

export function Avatar({ name, size = 20 }: { name: string; size?: number }) {
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) | 0;
  const initials = name
    .split(/[\s._@-]+/)
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <span
      className="avatar"
      title={name}
      style={{ width: size, height: size, fontSize: size * 0.42, background: AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length] }}
    >
      {initials || "?"}
    </span>
  );
}

export function Spinner({ size = 14 }: { size?: number }) {
  return <span className="spinner" style={{ width: size, height: size }} aria-label="Loading" />;
}
