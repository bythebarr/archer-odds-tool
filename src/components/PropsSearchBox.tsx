"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { MlbPlayerSummary } from "@/lib/queries/props";
import { Input } from "@/components/ui/input";
import { PlayerBadge } from "./PlayerBadge";

const DEBOUNCE_MS = 250;

export function PropsSearchBox() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MlbPlayerSummary[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      if (query.trim().length < 2) {
        setResults([]);
        return;
      }
      fetch(`/api/props/search?q=${encodeURIComponent(query)}`, { signal: controller.signal })
        .then((r) => r.json())
        .then((data: MlbPlayerSummary[]) => setResults(data))
        .catch(() => {});
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [query]);

  return (
    <div className="relative">
      <Input
        type="text"
        placeholder="Search players…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {results.length > 0 && (
        <ul className="absolute z-10 mt-1 w-full rounded-md border border-border bg-card py-1 shadow-md">
          {results.map((p) => (
            <li key={p.id}>
              <Link
                href={`/props/${p.id}`}
                className="flex items-center gap-2 px-3 py-1.5 text-sm text-foreground hover:bg-accent/50"
              >
                <PlayerBadge name={p.fullName} mlbPersonId={p.mlbPersonId} size={24} />
                {p.fullName}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
