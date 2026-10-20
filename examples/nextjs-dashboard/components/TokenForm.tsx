"use client";

import { useState, type FormEvent } from "react";
import type { SessionState } from "../lib/onboarding";

type Props = { onSignedIn: () => void };

/** Sends the token once to the dashboard server, which keeps it in an HttpOnly cookie. */
export default function TokenForm({ onSignedIn }: Props) {
  const [token, setToken] = useState("");
  const [error, setError] = useState<SessionState["error"]>();
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    const res = await fetch("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token })
    });
    setBusy(false);
    setToken("");
    if (res.ok) return onSignedIn();
    setError((await res.json().catch(() => null))?.error);
  };

  return (
    <form className="onboarding-card" onSubmit={submit}>
      <h2>Paste your admin token</h2>
      <p>
        It is printed in the collector logs. Show it again with{" "}
        <code>docker compose exec collector heat-collector token</code>.
      </p>
      <label className="control">
        Admin token
        <input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} required />
      </label>
      <button type="submit" disabled={busy || !token.trim()}>
        Continue
      </button>
      {error ? (
        <p role="alert" className="ph-error">
          {error.message} {error.fix}
        </p>
      ) : null}
    </form>
  );
}
