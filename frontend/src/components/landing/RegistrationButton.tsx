"use client";

interface RegistrationButtonProps {
  label: string;
  href?: string;
  onClick?: () => void;
  className?: string;
}

export default function RegistrationButton({
  label,
  href,
  onClick,
  className,
}: RegistrationButtonProps) {
  const classes = ["ws-registration", className].filter(Boolean).join(" ");

  if (href) {
    const external = /^https?:\/\//i.test(href);
    return (
      <a
        className={classes}
        href={href}
        onClick={onClick}
        {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
      >
        {label}
      </a>
    );
  }

  return (
    <button type="button" className={classes} onClick={onClick}>
      {label}
    </button>
  );
}
