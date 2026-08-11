import { useMemo, useState } from "react";
import { api, Element } from "../api/client";
import PanelCanvas from "./PanelCanvas";

function eventDate(el: Element): string {
  const m = el.metadata || {};
  return String(m.date || m.Date || "").trim();
}

function eventLabel(el: Element): string {
  const m = el.metadata || {};
  return String(m.date_label || m.era || eventDate(el) || "Undated").trim();
}

export default function TimelineView({
  projectId,
  elements,
  selectedId,
  onSelect,
  canEdit,
  onChanged,
}: {
  projectId: string;
  elements: Element[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  canEdit: boolean;
  onChanged: () => Promise<void>;
}) {
  const selected = elements.find((e) => e.id === selectedId) || null;
  const [dateDraft, setDateDraft] = useState(() => (selected ? eventDate(selected) : ""));
  const [labelDraft, setLabelDraft] = useState(() =>
    selected ? String(selected.metadata.date_label || "") : ""
  );

  const ordered = useMemo(() => {
    return [...elements].sort((a, b) => {
      const da = eventDate(a);
      const db = eventDate(b);
      if (da && db) return da.localeCompare(db);
      if (da) return -1;
      if (db) return 1;
      return a.sort_order - b.sort_order || a.title.localeCompare(b.title);
    });
  }, [elements]);

  function selectEvent(el: Element) {
    onSelect(el.id);
    setDateDraft(eventDate(el));
    setLabelDraft(String(el.metadata.date_label || ""));
  }

  async function saveMeta(el: Element, date: string, dateLabel: string) {
    await api.updateElement(el.id, {
      title: el.title,
      parent_id: el.parent_id,
      sort_order: el.sort_order,
      metadata: {
        ...el.metadata,
        date,
        date_label: dateLabel,
      },
    });
    await onChanged();
  }

  return (
    <div className="timeline-layout">
      <div className="timeline-rail">
        {ordered.length === 0 && (
          <p className="muted">Create an event to start the timeline.</p>
        )}
        <ol className="timeline-list">
          {ordered.map((el) => (
            <li key={el.id}>
              <button
                type="button"
                className={selectedId === el.id ? "active" : ""}
                onClick={() => selectEvent(el)}
              >
                <span className="timeline-when">{eventLabel(el)}</span>
                <strong>{el.title}</strong>
              </button>
            </li>
          ))}
        </ol>
      </div>

      <div className="timeline-detail">
        {!selected && <p className="muted">Select an event to edit details.</p>}
        {selected && (
          <>
            {canEdit && (
              <div className="row" style={{ marginBottom: "0.85rem", flexWrap: "wrap" }}>
                <input
                  type="text"
                  placeholder="Sortable date (e.g. 1247-03-15)"
                  value={dateDraft}
                  onChange={(e) => setDateDraft(e.target.value)}
                  onBlur={() => saveMeta(selected, dateDraft, labelDraft)}
                  style={{ maxWidth: 220 }}
                />
                <input
                  type="text"
                  placeholder="Display label (e.g. Spring 1247)"
                  value={labelDraft}
                  onChange={(e) => setLabelDraft(e.target.value)}
                  onBlur={() => saveMeta(selected, dateDraft, labelDraft)}
                />
              </div>
            )}
            <PanelCanvas
              projectId={projectId}
              element={selected}
              canEdit={canEdit}
              onTitle={async (title) => {
                await api.updateElement(selected.id, {
                  title,
                  parent_id: selected.parent_id,
                  sort_order: selected.sort_order,
                  metadata: selected.metadata,
                });
                await onChanged();
              }}
            />
          </>
        )}
      </div>
    </div>
  );
}
