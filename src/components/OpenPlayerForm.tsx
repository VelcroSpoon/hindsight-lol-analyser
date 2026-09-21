"use client";

import { useActionState } from "react";
import { openPlayer, type OpenPlayerState } from "@/app/actions";

export function OpenPlayerForm() {
  const [state, action, pending] = useActionState<OpenPlayerState, FormData>(openPlayer, {});

  return (
    <form action={action} noValidate>
      <label htmlFor="riot-id" className="section-title" style={{ display: "block", fontSize: 18 }}>
        Your Riot ID
      </label>
      <div className="field">
        <input
          id="riot-id"
          name="riotId"
          className="input"
          placeholder="Name#TAG"
          autoComplete="off"
          spellCheck={false}
          required
          aria-invalid={state.error ? true : undefined}
          aria-describedby={state.error ? "riot-id-error" : undefined}
        />
        <button type="submit" className="button" disabled={pending}>
          {pending ? "Opening…" : "Show my games"}
        </button>
      </div>
      {state.error && (
        <p id="riot-id-error" className="form-error" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}
