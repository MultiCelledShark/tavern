import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { Link, useSearchParams } from "../lib/router";

export default function VerifyPage() {
  const [params] = useSearchParams();
  const token = useMemo(() => params.get("token") || "", [params]);
  const [status, setStatus] = useState<"working" | "ok" | "bad">("working");
  const [message, setMessage] = useState("Confirming your email…");

  useEffect(() => {
    if (!token) {
      setStatus("bad");
      setMessage("Missing verification token. Use the link from your email.");
      return;
    }
    api
      .verifyEmail(token)
      .then(() => {
        setStatus("ok");
        setMessage("Email confirmed. You can sign in now.");
      })
      .catch((err) => {
        setStatus("bad");
        setMessage(err instanceof Error ? err.message : "Verification failed");
      });
  }, [token]);

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="brand">Tavern</div>
        <h1>Verify email</h1>
        <p className={status === "bad" ? "error" : undefined}>{message}</p>
        {status !== "working" && (
          <p className="login-links">
            <Link to="/login">Sign in</Link>
          </p>
        )}
      </div>
    </div>
  );
}
