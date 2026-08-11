import { useCallback, useEffect, useRef, useState } from "react";
import { api, Element } from "../api/client";
import { TIPS } from "../tips";

export type CorkItem = {
  id: string;
  title: string;
  sort_order: number;
  parent_id: string | null;
  metadata: Record<string, unknown>;
};

type CorkSnapshot = CorkItem[];

function fromElements(elements: Element[]): CorkItem[] {
  return [...elements]
    .sort((a, b) => a.sort_order - b.sort_order || a.title.localeCompare(b.title))
    .map((el, i) => ({
      id: el.id,
      title: el.title,
      sort_order: i,
      parent_id: el.parent_id,
      metadata: el.metadata,
    }));
}

function cloneItems(items: CorkItem[]): CorkItem[] {
  return items.map((it) => ({ ...it, metadata: { ...it.metadata } }));
}

function sameLayout(a: CorkItem[], b: CorkItem[]): boolean {
  if (a.length !== b.length) return false;
  const as = [...a].sort((x, y) => x.sort_order - y.sort_order);
  const bs = [...b].sort((x, y) => x.sort_order - y.sort_order);
  return as.every(
    (item, i) => item.id === bs[i]?.id && item.title === bs[i]?.title && item.sort_order === bs[i]?.sort_order
  );
}

/** Move `fromId` into the grid slot currently occupied by `toId`. */
function moveToSlot(items: CorkItem[], fromId: string, toId: string): CorkItem[] {
  if (fromId === toId) return items;
  const sorted = [...items].sort((a, b) => a.sort_order - b.sort_order);
  const from = sorted.findIndex((it) => it.id === fromId);
  const to = sorted.findIndex((it) => it.id === toId);
  if (from < 0 || to < 0) return items;
  const next = [...sorted];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next.map((it, i) => ({ ...it, sort_order: i }));
}

function stripCorkMeta(meta: Record<string, unknown>): Record<string, unknown> {
  const next = { ...meta };
  delete next.corkboard;
  return next;
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
  const dragIdRef = useRef<string | null>(null);

  const [items, setItems] = useState<CorkItem[]>(() => fromElements(elements));
  const [past, setPast] = useState<CorkSnapshot[]>([]);
  const [future, setFuture] = useState<CorkSnapshot[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  itemsRef.current = items;

  const ordered = [...items].sort((a, b) => a.sort_order - b.sort_order);

  useEffect(() => {
    const next = fromElements(elements);
    setItems((prev) => {
      if (sameLayout(prev, next)) return prev;
      // Keep in-progress titles while syncing server order for shared ids.
      return next.map((n) => {
        const old = prev.find((p) => p.id === n.id);
        return old ? { ...n, title: old.title } : n;
      });
    });
    if (!baselineRef.current.length && next.length) {
      baselineRef.current = cloneItems(next);
    }
  }, [elements]);

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
              metadata: stripCorkMeta(it.metadata),
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

  async function applyMove(fromId: string, toId: string) {
    const before = cloneItems(itemsRef.current);
    const next = moveToSlot(before, fromId, toId);
    if (sameLayout(before, next)) return;
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
        <span className="muted">Drag a card onto another slot to reorder · edit titles inline</span>
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

      <div className="corkboard">
        {!ordered.length && <p className="muted">Create a manuscript chapter to place it here.</p>}
        {ordered.map((it) => (
          <article
            key={it.id}
            className={[
              "cork-card",
              draggingId === it.id ? "dragging" : "",
              overId === it.id && draggingId && draggingId !== it.id ? "drop-target" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            draggable
            data-tip={TIPS.corkDrag}
            onDragStart={(e) => {
              if ((e.target as HTMLElement).closest("input, button.open-chapter")) {
                e.preventDefault();
                return;
              }
              dragIdRef.current = it.id;
              setDraggingId(it.id);
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", it.id);
            }}
            onDragEnd={() => {
              dragIdRef.current = null;
              setDraggingId(null);
              setOverId(null);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              if (dragIdRef.current && dragIdRef.current !== it.id) setOverId(it.id);
            }}
            onDragLeave={() => {
              setOverId((id) => (id === it.id ? null : id));
            }}
            onDrop={(e) => {
              e.preventDefault();
              const fromId = e.dataTransfer.getData("text/plain") || dragIdRef.current;
              setOverId(null);
              setDraggingId(null);
              dragIdRef.current = null;
              if (!fromId) return;
              void applyMove(fromId, it.id);
            }}
          >
            <input
              className="cork-title"
              value={it.title}
              draggable={false}
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
              onPointerDown={(e) => e.stopPropagation()}
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
