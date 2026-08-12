import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";

type Placement = "top" | "bottom" | "left" | "right";

type TipState = {
  text: string;
  placement: Placement;
  anchor: DOMRect;
};

const SHOW_DELAY_MS = 280;
const HIDE_DELAY_MS = 180;
const AUTO_DISMISS_MS = 3000;
const GAP = 8;
const VIEW_PAD = 10;

function preferredPlacement(el: Element): Placement {
  if (el.classList.contains("tip-right")) return "right";
  if (el.classList.contains("tip-below")) return "bottom";
  if (el.classList.contains("tip-left")) return "left";
  return "top";
}

function findTipTarget(start: EventTarget | null): HTMLElement | null {
  if (!(start instanceof Element)) return null;
  const el = start.closest("[data-tip]");
  if (!(el instanceof HTMLElement)) return null;
  const text = el.getAttribute("data-tip")?.trim();
  if (!text) return null;
  return el;
}

function placeTip(
  anchor: DOMRect,
  tip: DOMRect,
  preferred: Placement
): { top: number; left: number; placement: Placement } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const order: Placement[] = [preferred];
  for (const p of ["top", "bottom", "right", "left"] as Placement[]) {
    if (!order.includes(p)) order.push(p);
  }

  let fallback = { top: VIEW_PAD, left: VIEW_PAD, placement: preferred };

  for (const placement of order) {
    let top = 0;
    let left = 0;
    if (placement === "top") {
      top = anchor.top - tip.height - GAP;
      left = anchor.left + anchor.width / 2 - tip.width / 2;
    } else if (placement === "bottom") {
      top = anchor.bottom + GAP;
      left = anchor.left + anchor.width / 2 - tip.width / 2;
    } else if (placement === "right") {
      top = anchor.top + anchor.height / 2 - tip.height / 2;
      left = anchor.right + GAP;
    } else {
      top = anchor.top + anchor.height / 2 - tip.height / 2;
      left = anchor.left - tip.width - GAP;
    }

    left = Math.min(Math.max(VIEW_PAD, left), Math.max(VIEW_PAD, vw - tip.width - VIEW_PAD));
    top = Math.min(Math.max(VIEW_PAD, top), Math.max(VIEW_PAD, vh - tip.height - VIEW_PAD));
    fallback = { top, left, placement };

    const fits =
      placement === "top"
        ? anchor.top - tip.height - GAP >= VIEW_PAD
        : placement === "bottom"
          ? anchor.bottom + tip.height + GAP <= vh - VIEW_PAD
          : placement === "right"
            ? anchor.right + tip.width + GAP <= vw - VIEW_PAD
            : anchor.left - tip.width - GAP >= VIEW_PAD;

    if (fits) return { top, left, placement };
  }

  return fallback;
}

/** Portal tooltips for `[data-tip]` — stays in viewport, not clipped by overflow. */
export default function TipHost() {
  const [tip, setTip] = useState<TipState | null>(null);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const anchorRef = useRef<HTMLElement | null>(null);
  const showTimer = useRef<number | null>(null);
  const hideTimer = useRef<number | null>(null);
  const decayTimer = useRef<number | null>(null);
  const overTip = useRef(false);

  useEffect(() => {
    const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");

    function clearShow() {
      if (showTimer.current != null) {
        window.clearTimeout(showTimer.current);
        showTimer.current = null;
      }
    }

    function clearHide() {
      if (hideTimer.current != null) {
        window.clearTimeout(hideTimer.current);
        hideTimer.current = null;
      }
    }

    function clearDecay() {
      if (decayTimer.current != null) {
        window.clearTimeout(decayTimer.current);
        decayTimer.current = null;
      }
    }

    function dismiss() {
      clearShow();
      clearHide();
      clearDecay();
      overTip.current = false;
      anchorRef.current = null;
      setTip(null);
      setCoords(null);
    }

    function scheduleDecay() {
      clearDecay();
      decayTimer.current = window.setTimeout(() => {
        dismiss();
      }, AUTO_DISMISS_MS);
    }

    function hideSoon() {
      clearHide();
      hideTimer.current = window.setTimeout(() => {
        if (overTip.current) return;
        dismiss();
      }, HIDE_DELAY_MS);
    }

    function showFor(el: HTMLElement) {
      clearHide();
      const text = el.getAttribute("data-tip")?.trim();
      if (!text) return;

      const openNow = () => {
        if (!el.isConnected) return;
        anchorRef.current = el;
        setTip({
          text,
          placement: preferredPlacement(el),
          anchor: el.getBoundingClientRect(),
        });
        scheduleDecay();
      };

      // Switching tips: update immediately. First tip: short delay.
      if (anchorRef.current && anchorRef.current !== el) {
        clearShow();
        openNow();
        return;
      }
      if (anchorRef.current === el) return;

      clearShow();
      showTimer.current = window.setTimeout(openNow, SHOW_DELAY_MS);
    }

    function onOver(e: Event) {
      if (!finePointer.matches && e.type === "mouseover") return;
      const el = findTipTarget(e.target);
      if (!el) return;
      if (anchorRef.current === el) {
        clearHide();
        return;
      }
      showFor(el);
    }

    function onOut(e: MouseEvent) {
      const el = findTipTarget(e.target);
      if (!el || el !== anchorRef.current) return;
      const related = e.relatedTarget;
      if (related instanceof Node && el.contains(related)) return;
      if (related instanceof Node && tipRef.current?.contains(related)) return;
      hideSoon();
    }

    function onFocusIn(e: FocusEvent) {
      const el = findTipTarget(e.target);
      if (el) showFor(el);
    }

    function onFocusOut(e: FocusEvent) {
      const el = findTipTarget(e.target);
      if (!el || el !== anchorRef.current) return;
      const related = e.relatedTarget;
      if (related instanceof Node && tipRef.current?.contains(related)) return;
      hideSoon();
    }

    function refreshAnchor() {
      const el = anchorRef.current;
      if (!el?.isConnected) {
        dismiss();
        return;
      }
      setTip((prev) =>
        prev ? { ...prev, anchor: el.getBoundingClientRect() } : null
      );
    }

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") dismiss();
    }

    document.addEventListener("mouseover", onOver, true);
    document.addEventListener("mouseout", onOut, true);
    document.addEventListener("focusin", onFocusIn, true);
    document.addEventListener("focusout", onFocusOut, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", refreshAnchor, true);
    window.addEventListener("resize", refreshAnchor);

    return () => {
      clearShow();
      clearHide();
      clearDecay();
      document.removeEventListener("mouseover", onOver, true);
      document.removeEventListener("mouseout", onOut, true);
      document.removeEventListener("focusin", onFocusIn, true);
      document.removeEventListener("focusout", onFocusOut, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", refreshAnchor, true);
      window.removeEventListener("resize", refreshAnchor);
    };
  }, []);

  useEffect(() => {
    if (!tip || !tipRef.current) {
      setCoords(null);
      return;
    }
    const tipBox = tipRef.current.getBoundingClientRect();
    const next = placeTip(tip.anchor, tipBox, tip.placement);
    setCoords({ top: next.top, left: next.left });
  }, [tip]);

  if (!tip) return null;

  const style: CSSProperties = {
    top: coords?.top ?? -9999,
    left: coords?.left ?? -9999,
    visibility: coords ? "visible" : "hidden",
  };

  return createPortal(
    <div
      ref={tipRef}
      role="tooltip"
      className="tavern-tip"
      style={style}
      onMouseEnter={() => {
        overTip.current = true;
        if (hideTimer.current != null) {
          window.clearTimeout(hideTimer.current);
          hideTimer.current = null;
        }
      }}
      onMouseLeave={() => {
        overTip.current = false;
        if (hideTimer.current != null) {
          window.clearTimeout(hideTimer.current);
        }
        hideTimer.current = window.setTimeout(() => {
          if (overTip.current) return;
          anchorRef.current = null;
          setTip(null);
          setCoords(null);
        }, HIDE_DELAY_MS);
      }}
    >
      {tip.text}
    </div>,
    document.body
  );
}
