import {
  Children,
  isValidElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

export type GridItem = {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
};

type DragState = {
  id: string;
  mode: "drag" | "resize";
  startX: number;
  startY: number;
  origin: GridItem;
  captureEl: HTMLElement | null;
};

const COLS = 12;

function colWidth(width: number, cols: number, margin: number) {
  return (width - margin * (cols + 1)) / cols;
}

function itemStyle(
  item: GridItem,
  width: number,
  rowHeight: number,
  margin: number,
  cols: number
): CSSProperties {
  const cw = colWidth(width, cols, margin);
  const left = margin + item.x * (cw + margin);
  const top = margin + item.y * (rowHeight + margin);
  const w = item.w * cw + Math.max(0, item.w - 1) * margin;
  const h = item.h * rowHeight + Math.max(0, item.h - 1) * margin;
  return {
    position: "absolute",
    left,
    top,
    width: w,
    height: h,
    zIndex: 1,
  };
}

function clampItem(item: GridItem, cols: number): GridItem {
  const minW = item.minW ?? 1;
  const minH = item.minH ?? 1;
  const w = Math.max(minW, Math.min(cols, item.w));
  const h = Math.max(minH, item.h);
  const x = Math.max(0, Math.min(cols - w, item.x));
  const y = Math.max(0, item.y);
  return { ...item, x, y, w, h };
}

function overlaps(a: GridItem, b: GridItem) {
  return (
    a.i !== b.i &&
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}

/** Push `moved` down until it no longer overlaps others. */
function resolveCollisions(items: GridItem[], movedId: string): GridItem[] {
  const next = items.map((it) => ({ ...it }));
  const moved = next.find((it) => it.i === movedId);
  if (!moved) return next;
  let guard = 0;
  while (guard++ < 200 && next.some((it) => overlaps(moved, it))) {
    moved.y += 1;
  }
  return next;
}

function containerHeight(items: GridItem[], rowHeight: number, margin: number) {
  let max = 0;
  for (const it of items) {
    max = Math.max(max, it.y + it.h);
  }
  return margin + max * (rowHeight + margin) + margin + 24;
}

function applyPointerDelta(
  drag: DragState,
  clientX: number,
  clientY: number,
  width: number,
  cols: number,
  margin: number,
  rowHeight: number
): GridItem {
  const cw = colWidth(width, cols, margin);
  const dx = clientX - drag.startX;
  const dy = clientY - drag.startY;
  if (drag.mode === "drag") {
    const x = drag.origin.x + Math.round(dx / (cw + margin));
    const y = drag.origin.y + Math.round(dy / (rowHeight + margin));
    return clampItem({ ...drag.origin, x, y }, cols);
  }
  const w = drag.origin.w + Math.round(dx / (cw + margin));
  const h = drag.origin.h + Math.round(dy / (rowHeight + margin));
  return clampItem({ ...drag.origin, w, h }, cols);
}

/**
 * Absolute 12-column panel grid (react-grid-layout replacement).
 * Drag via `draggableHandle` selector; resize via the SE handle.
 */
export default function PanelGrid({
  layout,
  width,
  cols = COLS,
  rowHeight = 36,
  margin = 10,
  draggableHandle = ".drag-handle",
  editable = true,
  onDragStop,
  onResizeStop,
  children,
}: {
  layout: GridItem[];
  width: number;
  cols?: number;
  rowHeight?: number;
  margin?: number;
  draggableHandle?: string;
  editable?: boolean;
  onDragStop?: (layout: GridItem[]) => void;
  onResizeStop?: (layout: GridItem[]) => void;
  children: ReactNode;
}) {
  const [draft, setDraft] = useState<GridItem[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const items = draft ?? layout;

  const childMap = useMemo(() => {
    const map = new Map<string, ReactNode>();
    Children.forEach(children, (child) => {
      if (!isValidElement(child) || child.key == null) return;
      map.set(String(child.key), child);
    });
    return map;
  }, [children]);

  const finish = useCallback(
    (mode: "drag" | "resize", next: GridItem[]) => {
      setDraft(null);
      setActiveId(null);
      dragRef.current = null;
      if (mode === "drag") onDragStop?.(next);
      else onResizeStop?.(next);
    },
    [onDragStop, onResizeStop]
  );

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const nextItem = applyPointerDelta(
        drag,
        e.clientX,
        e.clientY,
        width,
        cols,
        margin,
        rowHeight
      );
      setDraft(layoutRef.current.map((it) => (it.i === drag.id ? nextItem : it)));
    },
    [width, cols, margin, rowHeight]
  );

  const onPointerUp = useCallback(
    (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      drag.captureEl?.releasePointerCapture?.(e.pointerId);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);

      const nextItem = applyPointerDelta(
        drag,
        e.clientX,
        e.clientY,
        width,
        cols,
        margin,
        rowHeight
      );
      const resolved = resolveCollisions(
        layoutRef.current.map((it) => (it.i === drag.id ? nextItem : it)),
        drag.id
      );
      finish(drag.mode, resolved);
    },
    [finish, onPointerMove, width, cols, margin, rowHeight]
  );

  // Drop window listeners if the grid unmounts mid-drag.
  useEffect(() => {
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, [onPointerMove, onPointerUp]);

  function begin(
    e: ReactPointerEvent,
    id: string,
    mode: "drag" | "resize",
    origin: GridItem
  ) {
    if (!editable) return;
    e.preventDefault();
    e.stopPropagation();
    const captureEl = e.currentTarget as HTMLElement;
    captureEl.setPointerCapture?.(e.pointerId);
    dragRef.current = {
      id,
      mode,
      startX: e.clientX,
      startY: e.clientY,
      origin: { ...origin },
      captureEl,
    };
    setActiveId(id);
    setDraft(layoutRef.current.map((it) => ({ ...it })));
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
  }

  const height = containerHeight(items, rowHeight, margin);

  return (
    <div className="panel-grid" style={{ width, height, position: "relative" }}>
      {items.map((item) => {
        const child = childMap.get(item.i);
        if (!child) return null;
        const style = itemStyle(item, width, rowHeight, margin, cols);
        const dragging = activeId === item.i;
        return (
          <div
            key={item.i}
            className={`panel-grid-item${dragging ? " is-dragging" : ""}`}
            style={{ ...style, zIndex: dragging ? 5 : 1 }}
            onPointerDown={(e) => {
              if (!editable) return;
              const t = e.target as Element;
              if (t.closest(".panel-resize-handle")) return;
              if (!t.closest(draggableHandle)) return;
              begin(e, item.i, "drag", item);
            }}
          >
            {child}
            {editable && (
              <div
                className="panel-resize-handle"
                aria-label="Resize panel"
                onPointerDown={(e) => begin(e, item.i, "resize", item)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
