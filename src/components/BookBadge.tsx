import { bookLogoSources } from "@/lib/logos";
import { BOOK_INITIALS, BOOK_COLORS } from "@/lib/odds/bookAllowlist";
import { Logo } from "./Logo";

interface BookBadgeProps {
  bookKey: string;
  bookName: string;
  size?: number;
}

/** Sportsbook logo (falls back to a colored initials badge) — the Logo+bookLogoSources+BOOK_INITIALS/BOOK_COLORS wiring used everywhere a book is shown. */
export function BookBadge({ bookKey, bookName, size }: BookBadgeProps) {
  return (
    <Logo
      sources={bookLogoSources(bookKey)}
      alt={bookName}
      fallbackText={BOOK_INITIALS[bookKey] ?? bookKey.slice(0, 2).toUpperCase()}
      color={BOOK_COLORS[bookKey]}
      size={size}
    />
  );
}
