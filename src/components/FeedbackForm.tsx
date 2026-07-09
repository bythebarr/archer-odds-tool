"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FEEDBACK_CATEGORIES, MESSAGE_MAX } from "@/lib/feedback";
import { TargetMark } from "@/components/TargetMark";

// Native <select>/<textarea> (not the shadcn Select) — the form needs to be
// bulletproof and the project's Select has known label quirks; native controls
// styled to match input.tsx avoid that entirely.
const FIELD =
  "w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 dark:bg-input/30";

export function FeedbackForm({ initialContext }: { initialContext?: string }) {
  const [category, setCategory] = useState<string>(initialContext?.includes("empty") ? "data" : "");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setError(null);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, message, email: email || null, context: initialContext ?? null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        setError(data?.error ?? "Something went wrong. Please try again.");
        setStatus("error");
        return;
      }
      setStatus("sent");
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
      setStatus("error");
    }
  }

  if (status === "sent") {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-card px-4 py-10 text-center">
        <TargetMark size={80} arrow="bullseye" />
        <div>
          <h3 className="text-base font-semibold text-foreground">Got it — thank you</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Your report landed. {email ? "We'll follow up by email if we need more." : "Leave an email next time if you'd like a reply."}
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            setMessage("");
            setEmail("");
            setCategory("");
            setStatus("idle");
          }}
          className="mt-1"
        >
          Send another
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="fb-category">What&apos;s this about?</Label>
        <select
          id="fb-category"
          required
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className={FIELD}
        >
          <option value="" disabled>
            Choose one…
          </option>
          {FEEDBACK_CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="fb-message">Tell us what happened</Label>
        <textarea
          id="fb-message"
          required
          rows={5}
          maxLength={MESSAGE_MAX}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="The more specific, the faster we can help — what you expected, what you saw, and when."
          className={`${FIELD} resize-y`}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="fb-email">Email (optional — for a reply)</Label>
        <Input
          id="fb-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
        />
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <Button type="submit" disabled={status === "sending"} className="self-start">
        {status === "sending" ? "Sending…" : "Send"}
      </Button>
    </form>
  );
}
