import { useEffect, useMemo, useState } from "react";
import GridLayout, { Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { api, Element, Page, Panel } from "../api/client";

const PANEL_TYPES = [
  "attributes",
  "text",
  "list",
  "stats",
  "image",
  "table",
  "links",
] as const;

export default function PanelCanvas({
  element,
  canEdit,
  onTitle,
}: {
  element: Element;
  canEdit: boolean;
  onTitle: (title: string) => Promise<void>;
}) {
  const [pages, setPages] = useState<Page[]>([]);
  const [pageId, setPageId] = useState<string | null>(null);
  const [panels, setPanels] = useState<Panel[]>([]);
  const [title, setTitle] = useState(element.title);
  const [width, setWidth] = useState(900);

  useEffect(() => {
    setTitle(element.title);
    (async () => {
      let list = await api.pages(element.id);
      if (!list.length) {
        await api.createPage(element.id, "Overview");
        list = await api.pages(element.id);
      }
      setPages(list);
      setPageId(list[0]?.id || null);
    })();
  }, [element.id]);

  useEffect(() => {
    if (!pageId) return;
    api.panels(pageId).then(setPanels);
  }, [pageId]);

  useEffect(() => {
    const onResize = () => setWidth(Math.max(640, window.innerWidth - 780));
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const layout: Layout[] = useMemo(
    () =>
      panels.map((p) => ({
        i: p.id,
        x: Math.round(p.layout.x),
        y: Math.round(p.layout.y),
        w: Math.max(2, Math.round(p.layout.w)),
        h: Math.max(2, Math.round(p.layout.h)),
      })),
    [panels]
  );

  async function persistPanel(panel: Panel, patch: Partial<Panel>) {
    const next = { ...panel, ...patch };
    const saved = await api.updatePanel(panel.id, {
      title: next.title,
      border_color: next.border_color,
      layout: next.layout,
      content: next.content,
      sort_order: next.sort_order,
    });
    setPanels((all) => all.map((p) => (p.id === saved.id ? saved : p)));
  }

  return (
    <div>
      <div className="row" style={{ marginBottom: "0.85rem" }}>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => {
            if (title !== element.title) onTitle(title);
          }}
          style={{ fontFamily: "var(--font-display)", fontSize: "1.4rem", fontWeight: 700 }}
        />
        <select
          value={pageId || ""}
          onChange={(e) => setPageId(e.target.value)}
          style={{ maxWidth: 180 }}
        >
          {pages.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </select>
        {canEdit && pageId && (
          <>
            <select
              defaultValue=""
              onChange={async (e) => {
                const panel_type = e.target.value;
                e.target.value = "";
                if (!panel_type || !pageId) return;
                const created = await api.createPanel(pageId, {
                  panel_type,
                  title: panel_type,
                  sort_order: panels.length,
                  content: defaultContent(panel_type),
                });
                setPanels((p) => [...p, created]);
              }}
            >
              <option value="">Add panel…</option>
              {PANEL_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <button
              onClick={async () => {
                const page = await api.createPage(element.id, `Page ${pages.length + 1}`);
                const list = await api.pages(element.id);
                setPages(list);
                setPageId(page.id);
              }}
            >
              + Page
            </button>
          </>
        )}
      </div>

      <div className="panel-canvas">
        <GridLayout
          className="layout"
          layout={layout}
          cols={12}
          rowHeight={36}
          width={width}
          draggableHandle=".drag-handle"
          onDragStop={async (l) => {
            for (const item of l) {
              const panel = panels.find((p) => p.id === item.i);
              if (!panel) continue;
              await persistPanel(panel, {
                layout: { x: item.x, y: item.y, w: item.w, h: item.h },
              });
            }
          }}
          onResizeStop={async (l) => {
            for (const item of l) {
              const panel = panels.find((p) => p.id === item.i);
              if (!panel) continue;
              await persistPanel(panel, {
                layout: { x: item.x, y: item.y, w: item.w, h: item.h },
              });
            }
          }}
        >
          {panels.map((panel) => (
            <div key={panel.id} style={{ borderColor: panel.border_color || undefined }}>
              <div className="panel-header">
                <span className="drag-handle">⠿</span>
                <input
                  value={panel.title}
                  onChange={(e) =>
                    setPanels((all) =>
                      all.map((p) => (p.id === panel.id ? { ...p, title: e.target.value } : p))
                    )
                  }
                  onBlur={() => persistPanel(panel, { title: panel.title })}
                  style={{ border: "none", background: "transparent", padding: 0 }}
                />
                <div className="spacer" />
                <button
                  className="ghost"
                  onClick={async () => {
                    await api.deletePanel(panel.id);
                    setPanels((all) => all.filter((p) => p.id !== panel.id));
                  }}
                >
                  ×
                </button>
              </div>
              <div className="panel-body">
                <PanelEditor
                  panel={panel}
                  onChange={(content) =>
                    setPanels((all) =>
                      all.map((p) => (p.id === panel.id ? { ...p, content } : p))
                    )
                  }
                  onSave={() => persistPanel(panel, { content: panel.content })}
                />
              </div>
            </div>
          ))}
        </GridLayout>
      </div>
    </div>
  );
}

function defaultContent(type: string): Record<string, unknown> {
  switch (type) {
    case "attributes":
    case "stats":
      return { items: [{ key: "", value: "" }] };
    case "list":
      return { items: [""] };
    case "text":
      return { markdown: "" };
    case "image":
      return { images: [] };
    case "table":
      return { headers: ["A", "B"], rows: [["", ""]] };
    case "links":
      return { element_ids: [] };
    default:
      return {};
  }
}

function PanelEditor({
  panel,
  onChange,
  onSave,
}: {
  panel: Panel;
  onChange: (c: Record<string, unknown>) => void;
  onSave: () => void;
}) {
  const content = panel.content;

  if (panel.panel_type === "text") {
    return (
      <textarea
        value={String(content.markdown || "")}
        onChange={(e) => onChange({ ...content, markdown: e.target.value })}
        onBlur={onSave}
        placeholder="Write markdown…"
      />
    );
  }

  if (panel.panel_type === "attributes" || panel.panel_type === "stats") {
    const items = (content.items as { key: string; value: string }[]) || [];
    return (
      <div>
        {items.map((item, i) => (
          <div className="attr-row" key={i}>
            <input
              placeholder="Key"
              value={item.key}
              onChange={(e) => {
                const next = items.slice();
                next[i] = { ...item, key: e.target.value };
                onChange({ ...content, items: next });
              }}
              onBlur={onSave}
            />
            <input
              placeholder="Value"
              value={item.value}
              onChange={(e) => {
                const next = items.slice();
                next[i] = { ...item, value: e.target.value };
                onChange({ ...content, items: next });
              }}
              onBlur={onSave}
            />
            <button
              onClick={() => {
                onChange({ ...content, items: items.filter((_, j) => j !== i) });
                setTimeout(onSave, 0);
              }}
            >
              ×
            </button>
          </div>
        ))}
        <button
          onClick={() => {
            onChange({ ...content, items: [...items, { key: "", value: "" }] });
            setTimeout(onSave, 0);
          }}
        >
          Add row
        </button>
      </div>
    );
  }

  if (panel.panel_type === "list") {
    const items = (content.items as string[]) || [];
    return (
      <div>
        {items.map((item, i) => (
          <div className="list-row" key={i}>
            <input
              value={item}
              onChange={(e) => {
                const next = items.slice();
                next[i] = e.target.value;
                onChange({ ...content, items: next });
              }}
              onBlur={onSave}
              style={{ gridColumn: "1 / 3" }}
            />
            <button
              onClick={() => {
                onChange({ ...content, items: items.filter((_, j) => j !== i) });
                setTimeout(onSave, 0);
              }}
            >
              ×
            </button>
          </div>
        ))}
        <button
          onClick={() => {
            onChange({ ...content, items: [...items, ""] });
            setTimeout(onSave, 0);
          }}
        >
          Add item
        </button>
      </div>
    );
  }

  if (panel.panel_type === "table") {
    const headers = (content.headers as string[]) || [];
    const rows = (content.rows as string[][]) || [];
    return (
      <div className="stack">
        <div className="row">
          {headers.map((h, i) => (
            <input
              key={i}
              value={h}
              onChange={(e) => {
                const next = headers.slice();
                next[i] = e.target.value;
                onChange({ ...content, headers: next });
              }}
              onBlur={onSave}
            />
          ))}
        </div>
        {rows.map((row, ri) => (
          <div className="row" key={ri}>
            {row.map((cell, ci) => (
              <input
                key={ci}
                value={cell}
                onChange={(e) => {
                  const next = rows.map((r) => r.slice());
                  next[ri][ci] = e.target.value;
                  onChange({ ...content, rows: next });
                }}
                onBlur={onSave}
              />
            ))}
          </div>
        ))}
        <button
          onClick={() => {
            onChange({
              ...content,
              rows: [...rows, headers.map(() => "")],
            });
            setTimeout(onSave, 0);
          }}
        >
          Add row
        </button>
      </div>
    );
  }

  if (panel.panel_type === "image") {
    return (
      <textarea
        value={JSON.stringify(content.images || [], null, 2)}
        onChange={(e) => {
          try {
            onChange({ ...content, images: JSON.parse(e.target.value) });
          } catch {
            /* ignore while typing */
          }
        }}
        onBlur={onSave}
        placeholder='JSON array of image refs, e.g. [{"url":"...","caption":""}]'
      />
    );
  }

  if (panel.panel_type === "links") {
    return (
      <textarea
        value={(content.element_ids as string[] | undefined)?.join("\n") || ""}
        onChange={(e) =>
          onChange({
            ...content,
            element_ids: e.target.value
              .split("\n")
              .map((s) => s.trim())
              .filter(Boolean),
          })
        }
        onBlur={onSave}
        placeholder="One element id per line"
      />
    );
  }

  return (
    <textarea
      value={JSON.stringify(content, null, 2)}
      onChange={(e) => {
        try {
          onChange(JSON.parse(e.target.value));
        } catch {
          /* ignore */
        }
      }}
      onBlur={onSave}
    />
  );
}
