// A minimal WYSIWYG editor for fields that hold real HTML (synopsis/
// description) — replaces a plain <textarea> showing raw "<p>...<br>..."
// source with a contentEditable surface that renders those tags for real,
// plus a floating Bold/Italic/Link toolbar on text selection. No new
// dependency: document.execCommand is deprecated but still broadly
// supported by the Chromium/WebView2 runtimes this app actually ships on,
// and every provider's own synopsis HTML here is simple enough (b/i/br/a)
// that a heavier rich-text library would be overkill.
import { useEffect, useRef, useState } from 'react';
import { sanitizeHtml } from '../../lib/shared/sanitize-html';

interface Props {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  className?: string;
}

interface ToolbarPos {
  top: number;
  left: number;
}

export function RichTextEditor({ value, onChange, placeholder, className }: Props) {
  const editorRef = useRef<HTMLDivElement>(null);
  // Tracks the last value *this* component emitted, so the sync-from-prop
  // effect below only fires on a genuine external change (switching entries)
  // — otherwise resetting innerHTML on every keystroke's own echoed-back
  // prop would throw the caret back to the start of the field. Starts at
  // null (never a real value, even an empty synopsis is `''`), so the very
  // first render always syncs — starting it equal to `value` meant the
  // initial content never actually got written into the contentEditable
  // DOM node at all, since the effect's "did this change externally" check
  // was true=false right from mount.
  const lastEmittedRef = useRef<string | null>(null);
  const [toolbarPos, setToolbarPos] = useState<ToolbarPos | null>(null);

  useEffect(() => {
    if (editorRef.current && value !== lastEmittedRef.current) {
      editorRef.current.innerHTML = sanitizeHtml(value);
      lastEmittedRef.current = value;
    }
  }, [value]);

  function emitChange() {
    if (!editorRef.current) return;
    const html = sanitizeHtml(editorRef.current.innerHTML);
    lastEmittedRef.current = html;
    onChange(html);
  }

  function updateToolbarPosition() {
    const sel = window.getSelection();
    const editor = editorRef.current;
    if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !editor) {
      setToolbarPos(null);
      return;
    }
    const range = sel.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) {
      setToolbarPos(null);
      return;
    }
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      setToolbarPos(null);
      return;
    }
    const editorRect = editor.getBoundingClientRect();
    setToolbarPos({
      top: rect.top - editorRect.top - 38,
      left: rect.left - editorRect.left + rect.width / 2,
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    // Enter inserts a real <br> instead of the browser's default new
    // <p>/<div> block — AniList's own synopsis HTML is built from one
    // wrapping <p> plus <br> for every line after that, so a plain Enter
    // here shouldn't fragment the description into a new paragraph each
    // time. Shift+Enter still falls through to the browser default.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      document.execCommand('insertLineBreak');
      emitChange();
    }
  }

  function applyCommand(cmd: string, arg?: string) {
    editorRef.current?.focus();
    document.execCommand(cmd, false, arg);
    emitChange();
    updateToolbarPosition();
  }

  function handleLink() {
    const url = window.prompt('URL del enlace:');
    if (!url) return;
    applyCommand('createLink', url);
  }

  return (
    <div className="pr-editor-richtext-wrap">
      <div
        ref={editorRef}
        className={`pr-editor-richtext${className ? ` ${className}` : ''}`}
        contentEditable
        suppressContentEditableWarning
        data-placeholder={placeholder}
        onInput={emitChange}
        onKeyDown={handleKeyDown}
        onMouseUp={updateToolbarPosition}
        onKeyUp={updateToolbarPosition}
        onBlur={() => setToolbarPos(null)}
      />
      {toolbarPos && (
        <div
          className="pr-editor-richtext-toolbar"
          style={{ top: toolbarPos.top, left: toolbarPos.left }}
          // Keeps the current text selection alive when a toolbar button is
          // clicked — without this, the editor's own blur/selection-clear
          // would fire first and the command would have nothing to act on.
          onMouseDown={e => e.preventDefault()}
        >
          <button type="button" onClick={() => applyCommand('bold')} title="Negrita"><b>B</b></button>
          <button type="button" onClick={() => applyCommand('italic')} title="Cursiva"><i>I</i></button>
          <button type="button" onClick={() => applyCommand('underline')} title="Subrayado"><u>U</u></button>
          <button type="button" onClick={handleLink} title="Enlace">🔗</button>
        </div>
      )}
    </div>
  );
}
