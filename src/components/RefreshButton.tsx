"use client";

import { useActionState } from "react";
import { refreshGames, type RefreshState } from "@/app/actions";

interface RefreshButtonProps {
  riotId: string;
  label: string;
  quiet?: boolean;
}

export function RefreshButton({ riotId, label, quiet }: RefreshButtonProps) {
  const [state, action, pending] = useActionState<RefreshState, FormData>(
    refreshGames.bind(null, riotId),
    { status: "idle" },
  );

  return (
    <form action={action}>
      <button type="submit" className={quiet ? "button button--quiet" : "button"} disabled={pending}>
        {pending ? "Checking Riot for games…" : label}
      </button>
      <p
        className={state.status === "error" ? "status status--error" : "status muted"}
        role="status"
        aria-live="polite"
      >
        {state.status === "idle" ? "" : state.message}
      </p>
    </form>
  );
}
