import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { api, Element } from "../api/client";
import AssetImg from "./AssetImg";
import { TIPS } from "../tips";

export type MapPin = {
  id: string;
  x: number;
  y: number;
  label: string;
  element_id?: string | null;
};

function readPins(meta: Record<string, unknown>): MapPin[] {
  const raw = meta.pins;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((p, i) => {
      if (!p || typeof p !== "object") return null;
      const o = p as Record<string, unknown>;
      return {
        id: String(o.id || `pin-${i}`),
        x: Number(o.x) || 0,
        y: Number(o.y) || 0,
        label: String(o.label || "Pin"),
        element_id: o.element_id ? String(o.element_id) : null,
      } as MapPin;
    })
    .filter(Boolean) as MapPin[];
}

export default function MapCanvas({
  projectId,
  element,
  locations,
  canEdit,
  onSaved,
}: {
  projectId: string;
  element: Element;
  locations: Element[];
  canEdit: boolean;
  onSaved: () => Promise<void>;
}) {
  const [title, setTitle] = useState(element.title);
  const [bg, setBg] = useState(String(element.metadata.background_url || ""));
  const [pins, setPins] = useState<MapPin[]>(() => readPins(element.metadata));
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTitle(element.title);
    setBg(String(element.metadata.background_url || ""));
    setPins(readPins(element.metadata));
  }, [element.id, element.title, element.metadata]);

  const selectedPin = useMemo(
    () => pins.find((p) => p.id === selected) || null,
    [pins, selected]
  );

  const persist = useCallback(
    async (nextTitle: string, nextBg: string, nextPins: MapPin[]) => {
      setBusy(true);
      setError(null);
      try {
        await api.updateElement(element.id, {
          title: nextTitle,
          parent_id: element.parent_id,
          sort_order: element.sort_order,
          metadata: {
            ...element.metadata,
            background_url: nextBg,
            pins: nextPins,
          },
        });
        await onSaved();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [element, onSaved]
  );

  async function onUpload(file: File | null) {
    if (!file || !canEdit) return;
    setBusy(true);
    try {
      const asset = await api.uploadAsset(projectId, file);
      setBg(asset.url);
      await persist(title, asset.url, pins);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function placePin(e: MouseEvent<HTMLDivElement>) {
    if (!canEdit || !bg) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    const pin: MapPin = {
      id: crypto.randomUUID(),
      x: Math.min(1, Math.max(0, x)),
      y: Math.min(1, Math.max(0, y)),
      label: "New pin",
      element_id: null,
    };
    const next = [...pins, pin];
    setPins(next);
    setSelected(pin.id);
    void persist(title, bg, next);
  }

  return (
    <div className="map-layout">
      <div className="row" style={{ marginBottom: "0.85rem", flexWrap: "wrap" }}>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => {
            if (title !== element.title) void persist(title, bg, pins);
          }}
          style={{ fontFamily: "var(--font-display)", fontSize: "1.4rem", fontWeight: 700 }}
          data-tip={TIPS.elementTitle}
        />
        {canEdit && (
          <label className="buttonish" data-tip={TIPS.mapUpload}>
            {bg ? "Replace map image" : "Upload map image"}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
              hidden
              onChange={(e) => onUpload(e.target.files?.[0] || null)}
            />
          </label>
        )}
        {busy && <span className="muted">Saving…</span>}
      </div>
      {error && <p className="error">{error}</p>}
      <p className="muted" style={{ marginTop: 0 }} data-tip={TIPS.mapPin}>
        {canEdit
          ? "Click the map to drop a pin. Select a pin to rename or link a location."
          : "View-only map."}
      </p>

      <div className="map-stage" ref={frameRef}>
        {bg ? (
          <div className="map-frame" onClick={placePin} title={TIPS.mapPin}>
            <AssetImg projectId={projectId} url={bg} alt={title} draggable={false} />
            {pins.map((pin) => (
              <button
                key={pin.id}
                type="button"
                className={`map-pin${selected === pin.id ? " active" : ""}`}
                style={{ left: `${pin.x * 100}%`, top: `${pin.y * 100}%` }}
                data-tip={pin.label}
                onClick={(ev) => {
                  ev.stopPropagation();
                  setSelected(pin.id);
                }}
              >
                <span>{pin.label}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="map-empty muted" data-tip={TIPS.mapUpload}>
            Upload a map image to begin placing pins.
          </div>
        )}
      </div>

      {selectedPin && canEdit && (
        <div className="map-pin-editor stack" style={{ marginTop: "1rem", maxWidth: 420 }}>
          <strong>Pin</strong>
          <input
            value={selectedPin.label}
            data-tip={TIPS.mapPinLabel}
            onChange={(e) => {
              const next = pins.map((p) =>
                p.id === selectedPin.id ? { ...p, label: e.target.value } : p
              );
              setPins(next);
            }}
            onBlur={() => void persist(title, bg, pins)}
          />
          <select
            value={selectedPin.element_id || ""}
            data-tip={TIPS.mapPinLink}
            onChange={(e) => {
              const next = pins.map((p) =>
                p.id === selectedPin.id
                  ? { ...p, element_id: e.target.value || null }
                  : p
              );
              setPins(next);
              void persist(title, bg, next);
            }}
          >
            <option value="">Link location…</option>
            {locations.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.title}
              </option>
            ))}
          </select>
          <button
            className="danger"
            type="button"
            data-tip={TIPS.mapPinRemove}
            onClick={() => {
              const next = pins.filter((p) => p.id !== selectedPin.id);
              setPins(next);
              setSelected(null);
              void persist(title, bg, next);
            }}
          >
            Remove pin
          </button>
        </div>
      )}
    </div>
  );
}
