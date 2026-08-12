import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { useEffect, useState } from "react";
import { api, Element } from "../api/client";
import { TIPS } from "../tips";
import TipHint from "./TipHint";

export default function ManuscriptEditor({
  element,
  allElements,
  onRenamed,
  focusMode = false,
}: {
  element: Element;
  allElements: Element[];
  onRenamed: (title: string) => Promise<void>;
  focusMode?: boolean;
}) {
  const [title, setTitle] = useState(element.title);
  const [markdown, setMarkdown] = useState("");
  const [wordGoal, setWordGoal] = useState(0);
  const [wordCount, setWordCount] = useState(0);
  const [sourceMode, setSourceMode] = useState(false);
  const [saved, setSaved] = useState(true);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: "Start writing your chapter…" }),
    ],
    content: "",
    onUpdate: ({ editor: ed }) => {
      const text = ed.getText();
      setWordCount(text.split(/\s+/).filter(Boolean).length);
      setMarkdown(ed.getHTML());
      setSaved(false);
    },
  });

  useEffect(() => {
    setTitle(element.title);
    (async () => {
      const body = await api.manuscript(element.id);
      setMarkdown(body.markdown);
      setWordGoal(body.word_goal);
      setWordCount(body.word_count);
      if (editor) {
        // Prefer treating stored content as markdown-ish plain/HTML hybrid
        const html = markdownToSimpleHtml(body.markdown);
        editor.commands.setContent(html || "<p></p>");
      }
      setSaved(true);
    })();
  }, [element.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    const md = sourceMode ? markdown : htmlToMarkdown(editor?.getHTML() || markdown);
    const res = await api.saveManuscript(element.id, md, wordGoal);
    setMarkdown(res.markdown);
    setWordCount(res.word_count);
    setSaved(true);
  }

  const suggestions = allElements
    .filter((e) => e.module_type !== "manuscript")
    .slice(0, 12);

  return (
    <div className="manuscript-layout">
      <div className="manuscript-toolbar">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => {
            if (title !== element.title) onRenamed(title);
          }}
          style={{ fontFamily: "var(--font-display)", fontSize: "1.35rem", fontWeight: 700, maxWidth: 360 }}
          data-tip={TIPS.msTitle}
        />
        <button
          className={sourceMode ? "primary" : ""}
          data-tip={TIPS.msSource}
          onClick={() => setSourceMode((s) => !s)}
        >
          {sourceMode ? "WYSIWYG" : "Source"}
        </button>
        <label className="row muted" data-tip={TIPS.msGoal}>
          Goal
          <input
            type="number"
            style={{ width: 90 }}
            value={wordGoal}
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
        <button className="primary" data-tip={TIPS.msSave} onClick={save}>
          {saved ? "Saved" : "Save"}
        </button>
        {!focusMode && (
          <TipHint tip={TIPS.msEditor} label="Manuscript writing tips" />
        )}
      </div>

      {sourceMode ? (
        <textarea
          className="editor-surface"
          style={{ fontFamily: "var(--font-mono)", minHeight: "60vh" }}
          value={markdown}
          onChange={(e) => {
            setMarkdown(e.target.value);
            setWordCount(e.target.value.split(/\s+/).filter(Boolean).length);
            setSaved(false);
          }}
        />
      ) : (
        <div className="editor-surface">
          <EditorContent editor={editor} />
        </div>
      )}

      <div className="muted" style={{ fontSize: "0.9rem" }}>
        Quick links:{" "}
        {suggestions.map((s) => (
          <button
            key={s.id}
            className="ghost"
            style={{ marginRight: 4 }}
            data-tip={TIPS.msQuickLink}
            onClick={() => {
              const token = `[[${capitalize(s.module_type)}:${s.title}]]`;
              if (sourceMode) {
                setMarkdown((m) => m + token);
                setSaved(false);
              } else {
                editor?.commands.insertContent(token);
              }
            }}
          >
            {s.title}
          </button>
        ))}
      </div>
    </div>
  );
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function markdownToSimpleHtml(md: string): string {
  if (!md.trim()) return "";
  if (md.trim().startsWith("<")) return md;
  return md
    .split(/\n\n+/)
    .map((para) => {
      const line = para
        .replace(/^### (.*)$/gm, "<h3>$1</h3>")
        .replace(/^## (.*)$/gm, "<h2>$1</h2>")
        .replace(/^# (.*)$/gm, "<h1>$1</h1>")
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/\*(.+?)\*/g, "<em>$1</em>")
        .replace(/\n/g, "<br/>");
      if (line.startsWith("<h")) return line;
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
    .replace(/<em>(.*?)<\/em>/gi, "*$1*")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<p>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .trim();
}
