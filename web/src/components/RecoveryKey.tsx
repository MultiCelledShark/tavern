import { useState } from "react";

export default function RecoveryKey({
  recoveryKey,
  onContinue,
  continueLabel = "I’ve saved it",
}: {
  recoveryKey: string;
  onContinue: () => void;
  continueLabel?: string;
}) {
  const [copied, setCopied] = useState(false);

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
      <div className="row">
        <button
          type="button"
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
        <button className="primary" type="button" onClick={onContinue}>
          {continueLabel}
        </button>
      </div>
    </div>
  );
}
