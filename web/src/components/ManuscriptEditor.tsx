import { useEffect, useRef, useState } from "react";
import { api, ConflictError, Element, ModuleType } from "../api/client";
import { TIPS } from "../tips";
import TipHint from "./TipHint";

export default function ManuscriptEditor({
  element,
  allElements,
  canEdit,
  onRenamed,
  focusMode = false,
}: {
  element: Element;
  allElements: Element[];
  canEdit: boolean;
  onRenamed: (title: string) => Promise<void>;
  focusMode?: boolean;
}) {
  const [title, setTitle] = useState(element.title);
  const [markdown, setMarkdown] = useState("");
  const [wordGoal, setWordGoal] = useState(0);
  const [wordCount, setWordCount] = useState(0);
  const [sourceMode, setSourceMode] = useState(false);
  const [saved, setSaved] = useState(true);
  const [updatedAt, setUpdatedAt] = useState("");
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wysiwygRef = useRef<HTMLDivElement | null>(null);
  const titleByIdRef = useRef<Map<string, { module_type: ModuleType; title: string }>>(new Map());
  const loadedIdRef = useRef<string | null>(null);
  const sourceModeRef = useRef(sourceMode);
  sourceModeRef.current = sourceMode;

  function setWysiwygHtml(html: string) {
    const el = wysiwygRef.current;
    if (!el) return;
    el.innerHTML = html || "<p><br></p>";
  }

  function readWysiwygHtml() {
    return wysiwygRef.current?.innerHTML ?? "";
  }

  function readWysiwygText() {
    return wysiwygRef.current?.innerText ?? "";
  }

  function countWords(text: string) {
    return text.split(/\s+/).filter(Boolean).length;
  }

  useEffect(() => {
    setTitle(element.title);
    loadedIdRef.current = null;
    let cancelled = false;
    let raf = 0;
    (async () => {
      try {
        const body = await api.manuscript(element.id);
        if (cancelled) return;
        setMarkdown(body.markdown);
        setWordGoal(body.word_goal);
        setWordCount(body.word_count);
        setUpdatedAt(body.updated_at);
        setConflict(false);
        loadedIdRef.current = element.id;
        raf = requestAnimationFrame(() => {
          if (cancelled || sourceModeRef.current) return;
          setWysiwygHtml(markdownToSimpleHtml(body.markdown));
        });
        setSaved(true);
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load manuscript");
      }
    })();
    return () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
    };
  }, [element.id]);

  // When leaving source mode, push markdown into the contentEditable surface.
  useEffect(() => {
    if (sourceMode) return;
    if (loadedIdRef.current !== element.id) return;
    setWysiwygHtml(markdownToSimpleHtml(markdown));
  }, [sourceMode, element.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // When the project-wide catalog refreshes (e.g. leaving another module after a
  // rename), rewrite any [[Module:OldTitle]] tokens still in the open chapter.
  useEffect(() => {
    const prev = titleByIdRef.current;
    const next = new Map(
      allElements.map((e) => [e.id, { module_type: e.module_type, title: e.title }] as const)
    );
    const renames: { module_type: ModuleType; oldTitle: string; newTitle: string }[] = [];
    for (const [id, cur] of next) {
      const was = prev.get(id);
      if (was && was.title !== cur.title) {
        renames.push({
          module_type: cur.module_type,
          oldTitle: was.title,
          newTitle: cur.title,
        });
      }
    }
    titleByIdRef.current = next;
    if (!renames.length) return;

    const apply = (text: string) =>
      renames.reduce(
        (acc, r) => rewriteWikilinks(acc, r.module_type, r.oldTitle, r.newTitle),
        text
      );

    if (sourceMode) {
      setMarkdown((m) => {
        const updated = apply(m);
        if (updated !== m) setSaved(false);
        return updated;
      });
      return;
    }
    // Rewrite the markdown source of truth, then re-render WYSIWYG (never store HTML in markdown).
    setMarkdown((m) => {
      const fromDom = htmlToMarkdown(readWysiwygHtml() || m);
      const base = fromDom || m;
      const updated = apply(base);
      if (updated !== base) {
        setWysiwygHtml(markdownToSimpleHtml(updated));
        setWordCount(countWords(updated));
        setSaved(false);
        return updated;
      }
      return m;
    });
  }, [allElements, sourceMode]);

  async function save() {
    try {
      const md = sourceMode ? markdown : htmlToMarkdown(readWysiwygHtml() || markdown);
      const res = await api.saveManuscript(element.id, md, wordGoal, updatedAt);
      setMarkdown(res.markdown);
      setWordCount(res.word_count);
      setUpdatedAt(res.updated_at);
      if (!sourceMode) setWysiwygHtml(markdownToSimpleHtml(res.markdown));
      setSaved(true);
      setConflict(false);
      setError(null);
    } catch (e) {
      if (e instanceof ConflictError) {
        setConflict(true);
        setMarkdown(e.body.markdown);
        setWordGoal(e.body.word_goal);
        setWordCount(e.body.word_count);
        setUpdatedAt(e.body.updated_at);
        if (!sourceMode) setWysiwygHtml(markdownToSimpleHtml(e.body.markdown));
        setSaved(true);
        setError(null);
        return;
      }
      setError(e instanceof Error ? e.message : "Save failed");
    }
  }

  function toggleSource() {
    if (!sourceMode) {
      const md = htmlToMarkdown(readWysiwygHtml() || markdown);
      setMarkdown(md);
      setWordCount(countWords(md));
      setSourceMode(true);
      return;
    }
    setSourceMode(false);
  }

  function insertToken(token: string) {
    if (sourceMode) {
      setMarkdown((m) => {
        const next = m + token;
        setWordCount(countWords(next));
        return next;
      });
      setSaved(false);
      return;
    }
    const root = wysiwygRef.current;
    if (!root) return;
    root.focus();
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && root.contains(sel.anchorNode)) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      range.insertNode(document.createTextNode(token));
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    } else {
      root.appendChild(document.createTextNode(token));
    }
    const md = htmlToMarkdown(readWysiwygHtml());
    setMarkdown(md);
    setWordCount(countWords(readWysiwygText()));
    setSaved(false);
  }

  const suggestions = allElements
    .filter((e) => e.module_type !== "manuscript")
    .slice(0, 12);

  return (
    <div className="manuscript-layout">
      <div className="manuscript-toolbar">
        <input
          value={title}
          readOnly={!canEdit}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => {
            if (canEdit && title !== element.title) onRenamed(title);
          }}
          style={{ fontFamily: "var(--font-display)", fontSize: "1.35rem", fontWeight: 700, maxWidth: 360 }}
          data-tip={TIPS.msTitle}
        />
        <button
          className={sourceMode ? "primary" : ""}
          data-tip={TIPS.msSource}
          onClick={toggleSource}
        >
          {sourceMode ? "WYSIWYG" : "Source"}
        </button>
        <label className="row muted" data-tip={TIPS.msGoal}>
          Goal
          <input
            type="number"
            style={{ width: 90 }}
            value={wordGoal}
            disabled={!canEdit}
            onChange={(e) => {
              setWordGoal(Number(e.target.value));
              setSaved(false);
            }}
          />
        </label>
        <span className="muted" data-tip={TIPS.msWords}>
          {wordCount}
          {wordGoal ? ` / ${wordGoal}` : ""} words
        </span>
        {canEdit && (
          <button className="primary" data-tip={TIPS.msSave} onClick={() => void save()}>
            {saved ? "Saved" : "Save"}
          </button>
        )}
        {conflict && (
          <span className="error" style={{ fontSize: "0.85rem" }}>
            Reloaded someone else’s newer save
          </span>
        )}
        {!focusMode && (
          <TipHint tip={TIPS.msEditor} label="Manuscript writing tips" />
        )}
      </div>

      {error && <p className="error">{error}</p>}

      {sourceMode ? (
        <textarea
          className="editor-surface"
          style={{ fontFamily: "var(--font-mono)", minHeight: "60vh" }}
          value={markdown}
          readOnly={!canEdit}
          data-tip={TIPS.msEditor}
          onChange={(e) => {
            setMarkdown(e.target.value);
            setWordCount(countWords(e.target.value));
            setSaved(false);
          }}
        />
      ) : (
        <div
          ref={wysiwygRef}
          className="editor-surface manuscript-wysiwyg"
          contentEditable={canEdit}
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label="Manuscript body"
          data-placeholder="Start writing your chapter…"
          onInput={() => {
            setMarkdown(htmlToMarkdown(readWysiwygHtml()));
            setWordCount(countWords(readWysiwygText()));
            setSaved(false);
          }}
          onPaste={(e) => {
            e.preventDefault();
            const text = e.clipboardData.getData("text/plain");
            document.execCommand("insertText", false, text);
          }}
        />
      )}

      {canEdit && (
      <div className="muted" style={{ fontSize: "0.9rem" }}>
        Quick links:{" "}
        {suggestions.map((s) => (
          <button
            key={s.id}
            className="ghost"
            style={{ marginRight: 4 }}
            data-tip={TIPS.msQuickLink}
            onClick={() => insertToken(`[[${capitalize(s.module_type)}:${s.title}]]`)}
          >
            {s.title}
          </button>
        ))}
      </div>
      )}
    </div>
  );
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function rewriteWikilinks(
  text: string,
  moduleType: ModuleType,
  oldTitle: string,
  newTitle: string
): string {
  if (!oldTitle || oldTitle === newTitle) return text;
  const label = capitalize(moduleType);
  const oldToken = `[[${label}:${oldTitle}]]`;
  const newToken = `[[${label}:${newTitle}]]`;
  let out = text.split(oldToken).join(newToken);
  const oldLower = `[[${moduleType}:${oldTitle}]]`;
  const newLower = `[[${moduleType}:${newTitle}]]`;
  if (oldLower !== oldToken) {
    out = out.split(oldLower).join(newLower);
  }
  return out;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function markdownToSimpleHtml(md: string): string {
  if (!md.trim()) return "";
  // Escape first so imported/pasted HTML never becomes executable markup.
  return md
    .split(/\n\n+/)
    .map((para) => {
      const escaped = escapeHtml(para);
      const line = escaped
        .replace(/^### (.*)$/gm, "<h3>$1</h3>")
        .replace(/^## (.*)$/gm, "<h2>$1</h2>")
        .replace(/^# (.*)$/gm, "<h1>$1</h1>")
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/\*(.+?)\*/g, "<em>$1</em>")
        .replace(/\n/g, "<br/>");
      if (/^<h[1-3]>/.test(line)) return line;
      return `<p>${line}</p>`;
    })
    .join("");
}

function htmlToMarkdown(html: string): string {
  return html
    .replace(/<h1>(.*?)<\/h1>/gi, "# $1\n\n")
    .replace(/<h2>(.*?)<\/h2>/gi, "## $1\n\n")
    .replace(/<h3>(.*?)<\/h3>/gi, "### $1\n\n")
    .replace(/<strong>(.*?)<\/strong>/gi, "**$1**")
    .replace(/<b>(.*?)<\/b>/gi, "**$1**")
    .replace(/<em>(.*?)<\/em>/gi, "*$1*")
    .replace(/<i>(.*?)<\/i>/gi, "*$1*")
    .replace(/<div>/gi, "<p>")
    .replace(/<\/div>/gi, "</p>")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<p>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .trim();
}
