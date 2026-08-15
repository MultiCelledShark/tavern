import { useState } from "react";

export default function RecoveryKey({
  recoveryKey,
  onContinue,
  continueLabel = "I’ve saved it",
}: {
  recoveryKey: string;
  onContinue: () => void | Promise<void>;
  continueLabel?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="recovery-block">
      <p>
        This recovery key is the only way to keep your writing if you forget your password. It is
        never emailed. Copy it somewhere the tavern operator cannot read — a password manager, not
        a screenshot on this machine.
      </p>
      <pre className="recovery-key" tabIndex={0}>
        {recoveryKey}
      </pre>
      {error && <div className="error">{error}</div>}
      <div className="row">
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(recoveryKey);
              setCopied(true);
            } catch {
              window.prompt("Copy this recovery key", recoveryKey);
            }
          }}
        >
          {copied ? "Copied" : "Copy key"}
        </button>
        <button
          className="primary"
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError(null);
            void Promise.resolve(onContinue())
              .catch((err) => {
                setError(err instanceof Error ? err.message : "Could not continue");
              })
              .finally(() => setBusy(false));
          }}
        >
          {busy ? "Saving…" : continueLabel}
        </button>
      </div>
    </div>
  );
}
