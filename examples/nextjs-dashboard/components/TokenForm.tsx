"use client";

import { useState, type FormEvent } from "react";
import type { Copy } from "../lib/copy";

type Props = { onSignedIn: () => void; copy: Copy };

/**
 * Sign in (#29 step 1): one "Admin token" field; Enter or "Continue" sends it once to the dashboard
 * server, which keeps it in an HttpOnly cookie (#24). The field is cleared and never shown again.
 */
export default function TokenForm({ onSignedIn, copy }: Props) {
  const [token, setToken] = useState("");
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setFailed(false);
    const res = await fetch("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token })
    }).catch(() => null);
    setBusy(false);
    setToken("");
    // A dead collector re-checks the session, which shows the unreachable message instead.
    if (res?.ok || res?.status === 502) return onSignedIn();
    setFailed(true);
  };

  return (
    <form className="onboarding-card" onSubmit={submit} data-testid="sign-in">
      <label className="control">
        Admin token
        <input
          type="password"
          autoComplete="off"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          aria-invalid={failed || undefined}
          aria-describedby={failed ? "token-error" : undefined}
          required
        />
      </label>
      <button type="submit" disabled={busy || !token.trim()}>
        Continue
      </button>
      {failed ? (
        <p role="alert" id="token-error" className="ph-error">
          {copy.signInError}
        </p>
      ) : null}
    </form>
  );
}
