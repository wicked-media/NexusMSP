import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import TextAlign from '@tiptap/extension-text-align';
import Image from '@tiptap/extension-image';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import {
  Bold, Italic, Underline as UnderlineIcon, Link as LinkIcon,
  AlignLeft, AlignCenter, AlignRight, List, ListOrdered, Heading2,
  Image as ImageIcon, Code, Minus, Quote, Undo, Redo, Code2, Table as TableIcon
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCallback, useRef, useState, useEffect } from 'react';

export function RichTextEditor({ content, onChange, placeholder, minHeight = "120px", resizable = true }) {
  const fileInputRef = useRef(null);
  const [htmlMode, setHtmlMode] = useState(false);
  const [htmlDraft, setHtmlDraft] = useState(content || '');

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Underline,
      Link.configure({ openOnClick: false }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Image.configure({ inline: true, allowBase64: true }),
      Table.configure({ resizable: true, HTMLAttributes: { class: 'rte-table' } }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: content || '',
    onUpdate: ({ editor }) => onChange?.(editor.getHTML()),
    editorProps: {
      attributes: {
        class: `prose prose-sm prose-invert max-w-none focus:outline-none p-3`,
        'aria-label': placeholder || 'Rich text editor',
        'data-placeholder': placeholder || '',
        style: `min-height: ${minHeight}; ${resizable ? 'resize: vertical; overflow: auto;' : ''}`,
      },
      handlePaste(view, event) {
        // Handle clipboard images (screenshots, drag-drop pastes)
        const items = event.clipboardData?.items;
        if (items) {
          for (const item of items) {
            if (item.type.startsWith('image/')) {
              event.preventDefault();
              const file = item.getAsFile();
              if (file) {
                const reader = new FileReader();
                reader.onload = (e) => {
                  view.dispatch(view.state.tr.replaceSelectionWith(
                    view.state.schema.nodes.image.create({ src: e.target.result })
                  ));
                };
                reader.readAsDataURL(file);
              }
              return true;
            }
          }
        }
        // For HTML paste, let tiptap handle it — table/image extensions will
        // preserve structure now. Outlook-style inline CID images won't work,
        // but base64 data URIs and http(s) images will.
        return false;
      },
      handleDrop(view, event) {
        const files = event.dataTransfer?.files;
        if (!files?.length) return false;
        for (const file of files) {
          if (file.type.startsWith('image/')) {
            event.preventDefault();
            const reader = new FileReader();
            reader.onload = (e) => {
              const pos = view.posAtCoords({ left: event.clientX, top: event.clientY });
              if (pos) {
                view.dispatch(view.state.tr.insert(pos.pos,
                  view.state.schema.nodes.image.create({ src: e.target.result })
                ));
              }
            };
            reader.readAsDataURL(file);
            return true;
          }
        }
        return false;
      },
    },
  });

  // Keep external content in sync when prop changes and editor isn't focused
  useEffect(() => {
    if (editor && content !== undefined && content !== editor.getHTML() && !editor.isFocused) {
      editor.commands.setContent(content || '', false);
    }
  }, [content, editor]);

  const handleImageUpload = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file || !editor) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      editor.chain().focus().setImage({ src: ev.target.result }).run();
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }, [editor]);

  const toggleHtmlMode = useCallback(() => {
    if (!editor) return;
    if (!htmlMode) {
      // Entering HTML mode — seed textarea from current editor content
      setHtmlDraft(editor.getHTML());
      setHtmlMode(true);
    } else {
      // Leaving HTML mode — apply textarea content back into editor
      editor.commands.setContent(htmlDraft || '', true);
      onChange?.(htmlDraft || '');
      setHtmlMode(false);
    }
  }, [editor, htmlMode, htmlDraft, onChange]);

  if (!editor) return null;

  const ToolBtn = ({ onClick, active, children, title, disabled }) => (
    <Button type="button" variant="ghost" size="sm" disabled={disabled} className={`h-7 w-7 p-0 ${active ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground'}`} onClick={onClick} title={title}>
      {children}
    </Button>
  );

  return (
    <div className="border rounded-md bg-background overflow-hidden" data-testid="rich-text-editor">
      <div className="flex items-center gap-0.5 px-2 py-1 border-b bg-muted/30 flex-wrap">
        <ToolBtn onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title="Bold" disabled={htmlMode}><Bold className="w-3.5 h-3.5" /></ToolBtn>
        <ToolBtn onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title="Italic" disabled={htmlMode}><Italic className="w-3.5 h-3.5" /></ToolBtn>
        <ToolBtn onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive('underline')} title="Underline" disabled={htmlMode}><UnderlineIcon className="w-3.5 h-3.5" /></ToolBtn>
        <div className="w-px h-4 bg-border mx-0.5" />
        <ToolBtn onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive('heading', { level: 2 })} title="Heading" disabled={htmlMode}><Heading2 className="w-3.5 h-3.5" /></ToolBtn>
        <ToolBtn onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} title="Bullet List" disabled={htmlMode}><List className="w-3.5 h-3.5" /></ToolBtn>
        <ToolBtn onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} title="Numbered List" disabled={htmlMode}><ListOrdered className="w-3.5 h-3.5" /></ToolBtn>
        <div className="w-px h-4 bg-border mx-0.5" />
        <ToolBtn onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive('blockquote')} title="Quote" disabled={htmlMode}><Quote className="w-3.5 h-3.5" /></ToolBtn>
        <ToolBtn onClick={() => editor.chain().focus().toggleCodeBlock().run()} active={editor.isActive('codeBlock')} title="Code Block" disabled={htmlMode}><Code className="w-3.5 h-3.5" /></ToolBtn>
        <ToolBtn onClick={() => editor.chain().focus().setHorizontalRule().run()} title="Divider" disabled={htmlMode}><Minus className="w-3.5 h-3.5" /></ToolBtn>
        <ToolBtn onClick={() => editor.chain().focus().insertTable({ rows: 2, cols: 2, withHeaderRow: false }).run()} title="Insert Table" disabled={htmlMode}><TableIcon className="w-3.5 h-3.5" /></ToolBtn>
        <div className="w-px h-4 bg-border mx-0.5" />
        <ToolBtn onClick={() => editor.chain().focus().setTextAlign('left').run()} active={editor.isActive({ textAlign: 'left' })} title="Left" disabled={htmlMode}><AlignLeft className="w-3.5 h-3.5" /></ToolBtn>
        <ToolBtn onClick={() => editor.chain().focus().setTextAlign('center').run()} active={editor.isActive({ textAlign: 'center' })} title="Center" disabled={htmlMode}><AlignCenter className="w-3.5 h-3.5" /></ToolBtn>
        <ToolBtn onClick={() => editor.chain().focus().setTextAlign('right').run()} active={editor.isActive({ textAlign: 'right' })} title="Right" disabled={htmlMode}><AlignRight className="w-3.5 h-3.5" /></ToolBtn>
        <div className="w-px h-4 bg-border mx-0.5" />
        <ToolBtn onClick={() => {
          const url = window.prompt('Enter URL');
          if (url) editor.chain().focus().setLink({ href: url }).run();
        }} active={editor.isActive('link')} title="Link" disabled={htmlMode}><LinkIcon className="w-3.5 h-3.5" /></ToolBtn>
        <ToolBtn onClick={handleImageUpload} title="Insert Image" disabled={htmlMode}><ImageIcon className="w-3.5 h-3.5" /></ToolBtn>
        <div className="w-px h-4 bg-border mx-0.5" />
        <ToolBtn onClick={() => editor.chain().focus().undo().run()} title="Undo" disabled={htmlMode}><Undo className="w-3.5 h-3.5" /></ToolBtn>
        <ToolBtn onClick={() => editor.chain().focus().redo().run()} title="Redo" disabled={htmlMode}><Redo className="w-3.5 h-3.5" /></ToolBtn>
        <div className="ml-auto flex items-center gap-1">
          <Button
            type="button"
            variant={htmlMode ? "secondary" : "ghost"}
            size="sm"
            className="h-7 px-2 text-[11px]"
            onClick={toggleHtmlMode}
            title="Toggle raw HTML source — paste full signature HTML here"
            data-testid="rte-html-toggle"
          >
            <Code2 className="w-3.5 h-3.5 mr-1" />{htmlMode ? "Visual" : "HTML"}
          </Button>
        </div>
      </div>
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
      {htmlMode ? (
        <textarea
          value={htmlDraft}
          onChange={(e) => setHtmlDraft(e.target.value)}
          spellCheck={false}
          className="w-full font-mono text-xs p-3 bg-background text-foreground outline-none"
          style={{ minHeight, resize: 'vertical', overflow: 'auto' }}
          placeholder="Paste raw HTML (e.g. exported Outlook signature) here..."
          data-testid="rte-html-textarea"
        />
      ) : (
        <EditorContent editor={editor} />
      )}
      <div className="px-3 py-1 border-t bg-muted/20 flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground/60">
          {htmlMode
            ? "Raw HTML — click Visual to render. Inline images must be data URIs or https URLs (not Outlook cid:)."
            : "Paste images directly · drag & drop · toggle HTML to paste full signature source"}
        </span>
        <span className="text-[10px] text-muted-foreground/40">Resize ↕</span>
      </div>
    </div>
  );
}
