import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { api, Element as ProjectElement, ElementLink } from "../api/client";
import { TIPS } from "../tips";

type Pos = { x: number; y: number };

type GraphNode = {
  id: string;
  title: string;
  x: number;
  y: number;
};

type DragState =
  | { mode: "pan"; startX: number; startY: number; origin: Pos }
  | { mode: "node"; id: string; startX: number; startY: number; origin: Pos }
  | { mode: "link"; fromId: string };

const NODE_W = 160;
const NODE_H = 48;

function defaultPositions(elements: ProjectElement[]): GraphNode[] {
  return elements.map((el, i) => ({
    id: el.id,
    title: el.title,
    x: (i % 4) * 220 + 40,
    y: Math.floor(i / 4) * 120 + 40,
  }));
}

/**
 * Lightweight relationship canvas (replaces @xyflow/react).
 * Pan on background, wheel zoom, drag nodes, drag from a port to link.
 */
export default function RelationshipGraph({
  projectId,
  elements,
  links,
  canEdit,
  onChange,
}: {
  projectId: string;
  elements: ProjectElement[];
  links: ElementLink[];
  canEdit: boolean;
  onChange: () => Promise<void>;
}) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [nodes, setNodes] = useState<GraphNode[]>(() => defaultPositions(elements));
  const [edges, setEdges] = useState<ElementLink[]>(links);
  const [pan, setPan] = useState<Pos>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [linkPreview, setLinkPreview] = useState<{
    fromId: string;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  } | null>(null);

  const dragRef = useRef<DragState | null>(null);
  const nodesRef = useRef(nodes);
  const panRef = useRef(pan);
  const zoomRef = useRef(zoom);
  const edgesRef = useRef(edges);
  nodesRef.current = nodes;
  panRef.current = pan;
  zoomRef.current = zoom;
  edgesRef.current = edges;

  useEffect(() => {
    setNodes((prev) => {
      const byId = new Map(prev.map((n) => [n.id, n]));
      return defaultPositions(elements).map((n) => {
        const old = byId.get(n.id);
        return old ? { ...n, x: old.x, y: old.y } : n;
      });
    });
  }, [elements]);

  useEffect(() => {
    setEdges(links);
  }, [links]);

  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  const visibleEdges = useMemo(
    () =>
      edges.filter((l) => nodeById.has(l.from_element_id) && nodeById.has(l.to_element_id)),
    [edges, nodeById]
  );

  const clientToWorld = useCallback((clientX: number, clientY: number): Pos => {
    const root = viewportRef.current;
    if (!root) return { x: clientX, y: clientY };
    const rect = root.getBoundingClientRect();
    const p = panRef.current;
    const z = zoomRef.current;
    return {
      x: (clientX - rect.left - p.x) / z,
      y: (clientY - rect.top - p.y) / z,
    };
  }, []);

  const detachWindow = useRef<(() => void) | null>(null);

  const endDrag = useCallback(
    async (e: PointerEvent) => {
      const drag = dragRef.current;
      dragRef.current = null;
      detachWindow.current?.();
      detachWindow.current = null;
      if (!drag) return;

      if (drag.mode === "link") {
        setLinkPreview(null);
        if (!canEdit) return;
        const el = document.elementFromPoint(e.clientX, e.clientY);
        const target = el?.closest("[data-node-id]") as HTMLElement | null;
        const toId = target?.dataset.nodeId;
        if (!toId || toId === drag.fromId) return;
        const existing = edgesRef.current.find(
          (l) =>
            (l.from_element_id === drag.fromId && l.to_element_id === toId) ||
            (l.from_element_id === toId && l.to_element_id === drag.fromId)
        );
        if (existing) return;
        const link = await api.createLink(projectId, {
          from_element_id: drag.fromId,
          to_element_id: toId,
          label: "related",
          link_type: "related",
        });
        setEdges((eds) => [...eds, link]);
        await onChange();
      }
    },
    [canEdit, onChange, projectId]
  );

  const onWindowMove = useCallback(
    (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      if (drag.mode === "pan") {
        setPan({
          x: drag.origin.x + (e.clientX - drag.startX),
          y: drag.origin.y + (e.clientY - drag.startY),
        });
        return;
      }
      if (drag.mode === "node") {
        const z = zoomRef.current;
        const dx = (e.clientX - drag.startX) / z;
        const dy = (e.clientY - drag.startY) / z;
        setNodes((all) =>
          all.map((n) =>
            n.id === drag.id
              ? { ...n, x: drag.origin.x + dx, y: drag.origin.y + dy }
              : n
          )
        );
        return;
      }
      if (drag.mode === "link") {
        const from = nodesRef.current.find((n) => n.id === drag.fromId);
        if (!from) return;
        const world = clientToWorld(e.clientX, e.clientY);
        setLinkPreview({
          fromId: drag.fromId,
          x1: from.x + NODE_W,
          y1: from.y + NODE_H / 2,
          x2: world.x,
          y2: world.y,
        });
      }
    },
    [clientToWorld]
  );

  function attachWindow() {
    detachWindow.current?.();
    const up = (e: PointerEvent) => void endDrag(e);
    window.addEventListener("pointermove", onWindowMove);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    detachWindow.current = () => {
      window.removeEventListener("pointermove", onWindowMove);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }

  useEffect(() => () => detachWindow.current?.(), []);

  function beginPan(e: ReactPointerEvent) {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest(".relationship-node, .relationship-port")) return;
    dragRef.current = {
      mode: "pan",
      startX: e.clientX,
      startY: e.clientY,
      origin: { ...panRef.current },
    };
    attachWindow();
  }

  function beginNodeDrag(e: ReactPointerEvent, id: string) {
    if (e.button !== 0) return;
    e.stopPropagation();
    const node = nodesRef.current.find((n) => n.id === id);
    if (!node) return;
    dragRef.current = {
      mode: "node",
      id,
      startX: e.clientX,
      startY: e.clientY,
      origin: { x: node.x, y: node.y },
    };
    attachWindow();
  }

  function beginLink(e: ReactPointerEvent, fromId: string) {
    if (!canEdit || e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const node = nodesRef.current.find((n) => n.id === fromId);
    if (!node) return;
    dragRef.current = { mode: "link", fromId };
    const world = clientToWorld(e.clientX, e.clientY);
    setLinkPreview({
      fromId,
      x1: node.x + NODE_W,
      y1: node.y + NODE_H / 2,
      x2: world.x,
      y2: world.y,
    });
    attachWindow();
  }

  const onWheel = useCallback((e: ReactWheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.08 : 1 / 1.08;
    setZoom((z) => Math.min(2.5, Math.max(0.4, z * factor)));
  }, []);

  async function undoLast() {
    const edge = edges[edges.length - 1];
    if (!edge) return;
    await api.deleteLink(edge.id);
    setEdges((eds) => eds.slice(0, -1));
    await onChange();
  }

  const worldW = Math.max(800, ...nodes.map((n) => n.x + NODE_W + 80), 800);
  const worldH = Math.max(500, ...nodes.map((n) => n.y + NODE_H + 80), 500);

  return (
    <div>
      <div className="row" style={{ marginBottom: "0.75rem" }}>
        <h2 style={{ margin: 0 }}>Relationship web</h2>
        <span className="muted" data-tip={TIPS.graphHint}>
          {canEdit
            ? "Drag nodes to arrange · drag a port to link · scroll to zoom"
            : "Drag nodes to arrange · scroll to zoom · read only"}
        </span>
        {canEdit && (
          <button type="button" data-tip={TIPS.undoLink} onClick={() => void undoLast()}>
            Undo last link
          </button>
        )}
      </div>
      <div
        className="relationship-canvas"
        ref={viewportRef}
        data-tip={TIPS.graphHint}
        onWheel={onWheel}
        onPointerDown={beginPan}
      >
        <div
          className="relationship-world"
          style={{
            width: worldW,
            height: worldH,
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: "0 0",
          }}
        >
          <svg className="relationship-edges" width={worldW} height={worldH} aria-hidden>
            {visibleEdges.map((l) => {
              const a = nodeById.get(l.from_element_id)!;
              const b = nodeById.get(l.to_element_id)!;
              const x1 = a.x + NODE_W / 2;
              const y1 = a.y + NODE_H / 2;
              const x2 = b.x + NODE_W / 2;
              const y2 = b.y + NODE_H / 2;
              const mx = (x1 + x2) / 2;
              const my = (y1 + y2) / 2;
              return (
                <g key={l.id}>
                  <line
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke="var(--border)"
                    strokeWidth={2}
                  />
                  {(l.label || l.link_type) && (
                    <text
                      x={mx}
                      y={my - 6}
                      textAnchor="middle"
                      fill="var(--muted)"
                      fontSize={11}
                    >
                      {l.label || l.link_type}
                    </text>
                  )}
                </g>
              );
            })}
            {linkPreview && (
              <line
                x1={linkPreview.x1}
                y1={linkPreview.y1}
                x2={linkPreview.x2}
                y2={linkPreview.y2}
                stroke="var(--moss)"
                strokeWidth={2}
                strokeDasharray="6 4"
              />
            )}
          </svg>

          {nodes.map((n) => (
            <div
              key={n.id}
              className="relationship-node"
              data-node-id={n.id}
              style={{ left: n.x, top: n.y, width: NODE_W, height: NODE_H }}
              onPointerDown={(e) => beginNodeDrag(e, n.id)}
            >
              <span className="relationship-node-label">{n.title}</span>
              {canEdit && (
                <button
                  type="button"
                  className="relationship-port"
                  aria-label={`Link from ${n.title}`}
                  title="Drag to another character to link"
                  onPointerDown={(e) => beginLink(e, n.id)}
                />
              )}
            </div>
          ))}
        </div>
      </div>
      {!elements.length && (
        <p className="muted">Create characters first, then open Relationships.</p>
      )}
    </div>
  );
}
