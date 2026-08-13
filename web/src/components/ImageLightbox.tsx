import { useEffect } from "react";
import { createPortal } from "react-dom";
import AssetImg from "./AssetImg";

/** Floating full-resolution image viewer. */
export default function ImageLightbox({
  projectId,
  url,
  caption,
  onClose,
}: {
  projectId: string;
  url: string;
  caption?: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const label = (caption || "").trim();

  return createPortal(
    <div
      className="image-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={label || "Full-size image"}
      onClick={onClose}
    >
      <button
        type="button"
        className="image-lightbox-close"
        aria-label="Close image"
        data-tip="Close"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      >
        ×
      </button>
      <figure
        className="image-lightbox-figure"
        onClick={(e) => e.stopPropagation()}
      >
        <AssetImg projectId={projectId} url={url} alt={label || "Image"} />
        {label && <figcaption>{label}</figcaption>}
      </figure>
    </div>,
    document.body
  );
}
