import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import TextAlign from '@tiptap/extension-text-align';
import { Bold, Italic, Underline as UnderlineIcon, Link as LinkIcon, AlignLeft, AlignCenter, AlignRight, List, ListOrdered, Heading2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function RichTextEditor({ content, onChange, placeholder, minHeight = "120px" }) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Link.configure({ openOnClick: false }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
    ],
    content: content || '',
    onUpdate: ({ editor }) => onChange?.(editor.getHTML()),
    editorProps: {
      attributes: {
        class: `prose prose-sm prose-invert max-w-none focus:outline-none p-3`,
        style: `min-height: ${minHeight}`,
      },
    },
  });

  if (!editor) return null;

  const ToolBtn = ({ onClick, active, children, title }) => (
    <Button type="button" variant="ghost" size="sm" className={`h-7 w-7 p-0 ${active ? 'bg-primary/20 text-primary' : 'text-muted-foreground'}`} onClick={onClick} title={title}>
      {children}
    </Button>
  );

  return (
    <div className="border rounded-md bg-background overflow-hidden" data-testid="rich-text-editor">
      <div className="flex items-center gap-0.5 px-2 py-1 border-b bg-muted/30 flex-wrap">
        <ToolBtn onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title="Bold"><Bold className="w-3.5 h-3.5" /></ToolBtn>
        <ToolBtn onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title="Italic"><Italic className="w-3.5 h-3.5" /></ToolBtn>
        <ToolBtn onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive('underline')} title="Underline"><UnderlineIcon className="w-3.5 h-3.5" /></ToolBtn>
        <div className="w-px h-4 bg-border mx-1" />
        <ToolBtn onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive('heading')} title="Heading"><Heading2 className="w-3.5 h-3.5" /></ToolBtn>
        <ToolBtn onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} title="Bullet List"><List className="w-3.5 h-3.5" /></ToolBtn>
        <ToolBtn onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} title="Numbered List"><ListOrdered className="w-3.5 h-3.5" /></ToolBtn>
        <div className="w-px h-4 bg-border mx-1" />
        <ToolBtn onClick={() => editor.chain().focus().setTextAlign('left').run()} active={editor.isActive({ textAlign: 'left' })} title="Left"><AlignLeft className="w-3.5 h-3.5" /></ToolBtn>
        <ToolBtn onClick={() => editor.chain().focus().setTextAlign('center').run()} active={editor.isActive({ textAlign: 'center' })} title="Center"><AlignCenter className="w-3.5 h-3.5" /></ToolBtn>
        <ToolBtn onClick={() => editor.chain().focus().setTextAlign('right').run()} active={editor.isActive({ textAlign: 'right' })} title="Right"><AlignRight className="w-3.5 h-3.5" /></ToolBtn>
        <div className="w-px h-4 bg-border mx-1" />
        <ToolBtn onClick={() => {
          const url = window.prompt('Enter URL');
          if (url) editor.chain().focus().setLink({ href: url }).run();
        }} active={editor.isActive('link')} title="Link"><LinkIcon className="w-3.5 h-3.5" /></ToolBtn>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
