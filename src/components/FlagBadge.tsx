/** A flag emoji in a circular avatar — the shared identity chip for tennis players and soccer nations. No assets, reads instantly. */
export function FlagBadge({ flag, title, size = 28 }: { flag: string; title?: string; size?: number }) {
  return (
    <span
      title={title}
      style={{ width: size, height: size, fontSize: size * 0.62 }}
      className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted leading-none ring-1 ring-black/10 dark:ring-white/10"
    >
      {flag}
    </span>
  );
}
