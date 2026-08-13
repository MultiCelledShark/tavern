/** Small corner control that shows a tip only when hovered/focused. */
export default function TipHint({
  tip,
  label = "Help",
}: {
  tip: string;
  label?: string;
}) {
  return (
    <button
      type="button"
      className="tip-hint tip-left"
      data-tip={tip}
      aria-label={label}
    >
      ?
    </button>
  );
}
