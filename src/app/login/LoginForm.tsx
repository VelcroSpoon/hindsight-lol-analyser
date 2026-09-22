"use client";

import { useActionState } from "react";
import { logIn, type LogInState } from "./actions";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<LogInState, FormData>(logIn, {});

  return (
    <form action={action}>
      <input type="hidden" name="next" value={next} />
      <label htmlFor="password" className="section-title" style={{ display: "block", fontSize: 18 }}>
        Password
      </label>
      <div className="field">
        <input
          id="password"
          name="password"
          type="password"
          className="input"
          autoComplete="current-password"
          required
          aria-invalid={state.error ? true : undefined}
          aria-describedby={state.error ? "password-error" : undefined}
        />
        <button type="submit" className="button" disabled={pending}>
          {pending ? "Opening…" : "Open Hindsight"}
        </button>
      </div>
      {state.error && (
        <p id="password-error" className="form-error" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}
