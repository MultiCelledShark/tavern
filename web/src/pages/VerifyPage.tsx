import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { Link, useHash, useNavigate, useSearchParams } from "../lib/router";

export default function VerifyPage() {
  const [params] = useSearchParams();
  const hash = useHash();
  const navigate = useNavigate();
  const queryToken = params.get("token") || "";
  const token = useMemo(() => hash || "", [hash]);
  const [status, setStatus] = useState<"working" | "ok" | "bad">("working");
  const [message, setMessage] = useState("Confirming your email…");

  // Legacy ?token= → move into the fragment and scrub the query (proxy logs).
  useEffect(() => {
    if (!queryToken || hash) return;
    navigate(`/verify#${encodeURIComponent(queryToken)}`, { replace: true });
  }, [queryToken, hash, navigate]);

  useEffect(() => {
    if (!token) {
      if (queryToken) return; // wait for hash scrub
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
  }, [token, queryToken]);

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
