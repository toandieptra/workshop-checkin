"use client";

interface DetailsButtonProps {
  label: string;
  href?: string;
  onClick?: () => void;
  className?: string;
}

export default function DetailsButton({ label, href, onClick, className }: DetailsButtonProps) {
  const classes = ["ws-details", className].filter(Boolean).join(" ");

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
