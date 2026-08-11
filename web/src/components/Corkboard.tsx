import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { api, Element } from "../api/client";
import { TIPS } from "../tips";

const CARD_W = 200;
const CARD_H = 132;
const GAP = 16;
const COLS = 4;

export type CorkItem = {
  id: string;
  title: string;
  x: number;
  y: number;
  sort_order: number;
  parent_id: string | null;
  metadata: Record<string, unknown>;
};

type CorkSnapshot = CorkItem[];

function readPos(meta: Record<string, unknown>): { x: number; y: number } | null {
  const raw = meta.corkboard;
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const x = Number(o.x);
  const y = Number(o.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

function autoLayout(index: number): { x: number; y: number } {
  const col = index % COLS;
  const row = Math.floor(index / COLS);
  return {
    x: GAP + col * (CARD_W + GAP),
    y: GAP + row * (CARD_H + GAP),
  };
}

function fromElements(elements: Element[]): CorkItem[] {
  const sorted = [...elements].sort(
    (a, b) => a.sort_order - b.sort_order || a.title.localeCompare(b.title)
  );
  return sorted.map((el, i) => {
    const pos = readPos(el.metadata) || autoLayout(i);
    return {
      id: el.id,
      title: el.title,
      x: pos.x,
      y: pos.y,
      sort_order: el.sort_order,
      parent_id: el.parent_id,
      metadata: el.metadata,
    };
  });
}

function cloneItems(items: CorkItem[]): CorkItem[] {
  return items.map((it) => ({ ...it, metadata: { ...it.metadata } }));
}

function sameLayout(a: CorkItem[], b: CorkItem[]): boolean {
  if (a.length !== b.length) return false;
  for (const x of a) {
    const y = b.find((it) => it.id === x.id);
    if (!y) return false;
    if (x.title !== y.title || x.x !== y.x || x.y !== y.y || x.sort_order !== y.sort_order) {
      return false;
    }
  }
  return true;
}

function sortOrdersFromPositions(items: CorkItem[]): CorkItem[] {
  const ranked = [...items].sort((a, b) => a.y - b.y || a.x - b.x || a.title.localeCompare(b.title));
  return items.map((it) => ({
    ...it,
    sort_order: ranked.findIndex((r) => r.id === it.id),
  }));
}

export default function Corkboard({
  elements,
  onOpen,
  onChanged,
}: {
  elements: Element[];
  onOpen: (id: string) => void;
  onChanged: () => Promise<void>;
}) {
  const itemsRef = useRef<CorkItem[]>([]);
  const baselineRef = useRef<CorkSnapshot>([]);
  const editStartTitle = useRef<Record<string, string>>({});
  const boardRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    id: string;
    grabX: number;
    grabY: number;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);

  const [items, setItems] = useState<CorkItem[]>(() => fromElements(elements));
  const [past, setPast] = useState<CorkSnapshot[]>([]);
  const [future, setFuture] = useState<CorkSnapshot[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  itemsRef.current = items;

  useEffect(() => {
    const next = fromElements(elements);
    setItems((prev) => {
      if (sameLayout(prev, next)) return prev;
      return next.map((n, i) => {
        const old = prev.find((p) => p.id === n.id);
        if (old) {
          return {
            ...n,
            x: old.x,
            y: old.y,
            title: old.title,
            sort_order: old.sort_order,
            metadata: { ...n.metadata, corkboard: { x: old.x, y: old.y } },
          };
        }
        const pos = readPos(n.metadata) || autoLayout(i);
        return { ...n, x: pos.x, y: pos.y };
      });
    });
    if (!baselineRef.current.length && next.length) {
      baselineRef.current = cloneItems(next);
    }
  }, [elements]);

  const boardSize = useMemo(() => {
    const maxX = items.reduce((m, it) => Math.max(m, it.x + CARD_W), 480);
    const maxY = items.reduce((m, it) => Math.max(m, it.y + CARD_H), 360);
    return { width: maxX + GAP, height: maxY + GAP };
  }, [items]);

  const persist = useCallback(
    async (next: CorkItem[]) => {
      setBusy(true);
      setError(null);
      try {
        await Promise.all(
          next.map((it) =>
            api.updateElement(it.id, {
              title: it.title,
              parent_id: it.parent_id,
              sort_order: it.sort_order,
              metadata: {
                ...it.metadata,
                corkboard: { x: it.x, y: it.y },
              },
            })
          )
        );
        await onChanged();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [onChanged]
  );

  const pushHistory = useCallback((snapshot: CorkItem[]) => {
    setPast((p) => [...p, cloneItems(snapshot)]);
    setFuture([]);
  }, []);

  async function undo() {
    if (!past.length || busy) return;
    const prev = past[past.length - 1];
    setPast((p) => p.slice(0, -1));
    setFuture((f) => [...f, cloneItems(itemsRef.current)]);
    setItems(cloneItems(prev));
    await persist(prev);
  }

  async function redo() {
    if (!future.length || busy) return;
    const next = future[future.length - 1];
    setFuture((f) => f.slice(0, -1));
    setPast((p) => [...p, cloneItems(itemsRef.current)]);
    setItems(cloneItems(next));
    await persist(next);
  }

  async function resetLayout() {
    if (busy) return;
    const baseline = baselineRef.current.length
      ? cloneItems(baselineRef.current)
      : fromElements(elements);
    if (sameLayout(itemsRef.current, baseline)) return;
    pushHistory(itemsRef.current);
    setItems(baseline);
    await persist(baseline);
  }

  function pointerToBoard(e: ReactPointerEvent): { x: number; y: number } {
    const board = boardRef.current;
    if (!board) return { x: e.clientX, y: e.clientY };
    const rect = board.getBoundingClientRect();
    return {
      x: e.clientX - rect.left + board.scrollLeft,
      y: e.clientY - rect.top + board.scrollTop,
    };
  }

  function onPointerDown(e: ReactPointerEvent, id: string) {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("input, textarea, button.open-chapter")) return;
    const card = itemsRef.current.find((it) => it.id === id);
    if (!card) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const pt = pointerToBoard(e);
    dragRef.current = {
      id,
      grabX: pt.x - card.x,
      grabY: pt.y - card.y,
      startX: card.x,
      startY: card.y,
      moved: false,
    };
    setDraggingId(id);
  }

  function onPointerMove(e: ReactPointerEvent) {
    const drag = dragRef.current;
    if (!drag) return;
    const pt = pointerToBoard(e);
    const x = Math.max(0, pt.x - drag.grabX);
    const y = Math.max(0, pt.y - drag.grabY);
    if (Math.hypot(x - drag.startX, y - drag.startY) > 4) drag.moved = true;
    setItems((all) => all.map((it) => (it.id === drag.id ? { ...it, x, y } : it)));
  }

  async function onPointerUp() {
    const drag = dragRef.current;
    dragRef.current = null;
    setDraggingId(null);
    if (!drag || !drag.moved) return;

    const current = itemsRef.current;
    const before = current.map((it) =>
      it.id === drag.id ? { ...it, x: drag.startX, y: drag.startY } : { ...it }
    );
    const next = sortOrdersFromPositions(current);
    pushHistory(before);
    setItems(next);
    await persist(next);
  }

  async function commitRename(id: string, title: string) {
    const trimmed = title.trim() || "Untitled";
    const prior = editStartTitle.current[id];
    delete editStartTitle.current[id];
    if (prior === undefined) return;
    if (prior === trimmed) {
      setItems((all) => all.map((it) => (it.id === id ? { ...it, title: trimmed } : it)));
      return;
    }
    const before = itemsRef.current.map((it) =>
      it.id === id ? { ...it, title: prior } : { ...it }
    );
    const next = itemsRef.current.map((it) =>
      it.id === id ? { ...it, title: trimmed } : it
    );
    pushHistory(before);
    setItems(next);
    await persist(next);
  }

  return (
    <div className="corkboard-wrap">
      <div className="corkboard-toolbar row">
        <h2 style={{ margin: 0 }}>Corkboard</h2>
        <span className="muted">Drag cards to rearrange · edit titles inline</span>
        <div className="spacer" />
        <button type="button" data-tip={TIPS.corkUndo} disabled={!past.length || busy} onClick={() => void undo()}>
          Undo
        </button>
        <button type="button" data-tip={TIPS.corkRedo} disabled={!future.length || busy} onClick={() => void redo()}>
          Redo
        </button>
        <button
          type="button"
          data-tip={TIPS.corkReset}
          disabled={busy || sameLayout(items, baselineRef.current)}
          onClick={() => void resetLayout()}
        >
          Reset layout
        </button>
        {busy && <span className="muted">Saving…</span>}
      </div>
      {error && <p className="error">{error}</p>}

      <div
        className="corkboard"
        ref={boardRef}
        style={{ width: boardSize.width, minHeight: boardSize.height }}
      >
        {!items.length && <p className="muted">Create a manuscript chapter to pin it here.</p>}
        {items.map((it) => (
          <article
            key={it.id}
            className={`cork-card${draggingId === it.id ? " dragging" : ""}`}
            style={{ left: it.x, top: it.y, width: CARD_W, minHeight: CARD_H }}
            onPointerDown={(e) => onPointerDown(e, it.id)}
            onPointerMove={onPointerMove}
            onPointerUp={() => void onPointerUp()}
            onPointerCancel={() => void onPointerUp()}
            data-tip={TIPS.corkDrag}
          >
            <div className="cork-pin" aria-hidden />
            <input
              className="cork-title"
              value={it.title}
              data-tip={TIPS.corkRename}
              onFocus={() => {
                editStartTitle.current[it.id] = it.title;
              }}
              onChange={(e) =>
                setItems((all) => all.map((c) => (c.id === it.id ? { ...c, title: e.target.value } : c)))
              }
              onBlur={(e) => void commitRename(it.id, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
            />
            <button
              type="button"
              className="open-chapter ghost"
              data-tip={TIPS.corkOpen}
              onClick={() => onOpen(it.id)}
            >
              Open chapter
            </button>
          </article>
        ))}
      </div>
    </div>
  );
}
