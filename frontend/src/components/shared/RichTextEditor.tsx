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

interface ContextMenuPos {
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
  // Discord-style right-click format menu — a second, explicit way to reach
  // the same commands as the hover toolbar. Kept as separate state (rather
  // than reusing toolbarPos) since it's positioned at the click point, not
  // above the selection, and dismisses on its own set of triggers (outside
  // click, Escape, picking an option) instead of on blur/selection-clear.
  const [contextMenuPos, setContextMenuPos] = useState<ContextMenuPos | null>(null);

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
    setContextMenuPos(null);
  }

  function handleLink() {
    const url = window.prompt('URL del enlace:');
    setContextMenuPos(null);
    if (!url) return;
    applyCommand('createLink', url);
  }

  // Right-click format menu (Discord-style) — a second, more discoverable
  // way to reach the same commands the hover toolbar already exposes,
  // instead of relying on someone noticing text needs to stay selected for
  // a moment. Only takes over the browser's own context menu when there's
  // actually a selection to act on; a plain right-click with nothing
  // selected still gets the normal menu (cut/paste/etc).
  function handleContextMenu(e: React.MouseEvent<HTMLDivElement>) {
    const sel = window.getSelection();
    const editor = editorRef.current;
    if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !editor) return;
    const range = sel.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return;

    e.preventDefault();
    e.stopPropagation();
    const wrapRect = e.currentTarget.parentElement!.getBoundingClientRect();
    setContextMenuPos({ top: e.clientY - wrapRect.top, left: e.clientX - wrapRect.left });
  }

  useEffect(() => {
    if (!contextMenuPos) return;
    const close = () => setContextMenuPos(null);
    const closeOnEscape = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    // 'click' rather than 'mousedown' — the menu's own wrapper already
    // preventDefaults mousedown (to keep the text selection alive for
    // applyCommand to act on), so a 'mousedown' listener here would never
    // actually see that event reach window at all.
    window.addEventListener('click', close);
    window.addEventListener('contextmenu', close);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('contextmenu', close);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [contextMenuPos]);

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
        onContextMenu={handleContextMenu}
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
      {contextMenuPos && (
        <div
          className="pr-editor-richtext-ctxmenu"
          style={{ top: contextMenuPos.top, left: contextMenuPos.left }}
          // Same reason as the toolbar above — without this, the browser
          // clears the contentEditable's selection the instant focus moves
          // to one of these buttons, so applyCommand would have nothing
          // left to format by the time its onClick actually runs.
          onMouseDown={e => e.preventDefault()}
        >
          <button type="button" className="pr-editor-richtext-ctxmenu-item" onClick={() => applyCommand('bold')}>
            <b className="pr-editor-richtext-ctxmenu-icon">B</b> Negrita
          </button>
          <button type="button" className="pr-editor-richtext-ctxmenu-item" onClick={() => applyCommand('italic')}>
            <i className="pr-editor-richtext-ctxmenu-icon">I</i> Cursiva
          </button>
          <button type="button" className="pr-editor-richtext-ctxmenu-item" onClick={() => applyCommand('underline')}>
            <u className="pr-editor-richtext-ctxmenu-icon">U</u> Subrayado
          </button>
          <button type="button" className="pr-editor-richtext-ctxmenu-item" onClick={handleLink}>
            <span className="pr-editor-richtext-ctxmenu-icon">🔗</span> Enlace
          </button>
          <div className="pr-editor-richtext-ctxmenu-sep" />
          <button type="button" className="pr-editor-richtext-ctxmenu-item" onClick={() => applyCommand('removeFormat')}>
            <span className="pr-editor-richtext-ctxmenu-icon">⌫</span> Quitar formato
          </button>
        </div>
      )}
    </div>
  );
}
