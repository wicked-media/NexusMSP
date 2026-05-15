import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Lock, Unlock, RotateCcw, X, PlusCircle, LayoutGrid, Plus } from "lucide-react";
import { toast } from "sonner";

/**
 * Reusable hook + bar component for the customisable widget grid pattern.
 *
 * Returns:
 *   editMode, setEditMode, hiddenWidgets, hideWidget, showWidget,
 *   visibleLayouts, onLayoutChange, resetLayout, EditBar (renderable React node)
 *
 * Use with react-grid-layout: pass `visibleLayouts` to `layouts`, wrap children
 * in `{!hiddenWidgets.has(id) && <div key={id} className="nx-widget-card">...}`,
 * and render `<HideBtn id={id} />` inside each widget for an inline X button.
 */
export function useWidgetGrid({ storageKey, hiddenKey, defaultLayout, widgetMeta, label = "Dashboard" }) {
  const [editMode, setEditMode] = useState(false);

  const [layouts, setLayouts] = useState(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) return JSON.parse(saved);
    } catch { /* ignore */ }
    return { lg: defaultLayout };
  });

  const [hiddenWidgets, setHiddenWidgets] = useState(() => {
    try {
      const saved = localStorage.getItem(hiddenKey);
      if (saved) return new Set(JSON.parse(saved));
    } catch { /* ignore */ }
    return new Set();
  });

  const persistHidden = (next) => {
    try { localStorage.setItem(hiddenKey, JSON.stringify([...next])); } catch { /* */ }
  };

  const hideWidget = (id) => {
    setHiddenWidgets(prev => {
      const next = new Set(prev); next.add(id); persistHidden(next); return next;
    });
    toast.success(`${widgetMeta[id]?.label || id} hidden`, { description: "Re-add it from + Add Widget" });
  };

  const showWidget = (id) => {
    setHiddenWidgets(prev => {
      const next = new Set(prev); next.delete(id); persistHidden(next); return next;
    });
    toast.success(`${widgetMeta[id]?.label || id} restored`);
  };

  const onLayoutChange = (_currentLayout, allLayouts) => {
    setLayouts(allLayouts);
    try { localStorage.setItem(storageKey, JSON.stringify(allLayouts)); } catch { /* */ }
  };

  const resetLayout = () => {
    setLayouts({ lg: defaultLayout });
    setHiddenWidgets(new Set());
    try {
      localStorage.removeItem(storageKey);
      localStorage.removeItem(hiddenKey);
    } catch { /* */ }
    toast.success(`${label} layout reset to defaults`);
  };

  const visibleLayouts = (() => {
    const filtered = {};
    Object.keys(layouts).forEach(bp => {
      filtered[bp] = (layouts[bp] || []).filter(l => !hiddenWidgets.has(l.i));
    });
    return filtered;
  })();

  const hiddenList = Object.keys(widgetMeta).filter(id => hiddenWidgets.has(id));

  const HideBtn = ({ id }) => (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); hideWidget(id); }}
      className="nx-widget-hide"
      data-testid={`hide-widget-${id}`}
      aria-label={`Hide ${widgetMeta[id]?.label || id}`}
    >
      <X className="w-3 h-3" />
    </button>
  );

  const EditBar = ({ testIdPrefix = "" }) => (
    <div className="flex items-center justify-between px-1">
      <div className="flex items-center gap-2 text-[11px] text-zinc-500">
        {editMode ? (
          <><Unlock className="w-3 h-3 text-violet-400" /><span className="text-violet-300 font-medium">Edit mode active</span> — drag widgets, resize from the bottom-right, or click <X className="inline w-3 h-3 mx-0.5 text-rose-400" /> to hide{hiddenWidgets.size > 0 ? <> · <span className="text-amber-300">{hiddenWidgets.size} hidden</span></> : null}</>
        ) : (
          <><Lock className="w-3 h-3" />{label} layout locked · click <strong className="text-zinc-300">Customise</strong> to rearrange{hiddenWidgets.size > 0 ? <> · <span className="text-amber-300/80">{hiddenWidgets.size} hidden</span></> : null}</>
        )}
      </div>
      <div className="flex gap-2">
        {editMode && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" className="h-7 text-[10px] text-emerald-300 border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20" data-testid={`${testIdPrefix}add-widget-btn`}>
                <PlusCircle className="w-3 h-3 mr-1" />Add Widget{hiddenList.length > 0 ? ` (${hiddenList.length})` : ""}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel className="text-[10px] uppercase tracking-widest text-zinc-500">
                {hiddenList.length === 0 ? "All widgets visible" : `${hiddenList.length} hidden widget${hiddenList.length > 1 ? "s" : ""}`}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {hiddenList.length === 0 ? (
                <div className="px-3 py-4 text-[11px] text-zinc-500 text-center">
                  <LayoutGrid className="w-5 h-5 mx-auto mb-1.5 opacity-40" />
                  Hide widgets via the <X className="inline w-3 h-3 mx-0.5 text-rose-400" /> button to see them here
                </div>
              ) : (
                hiddenList.map(id => {
                  const meta = widgetMeta[id];
                  const Icon = meta?.icon || LayoutGrid;
                  return (
                    <DropdownMenuItem key={id} onClick={() => showWidget(id)} className="cursor-pointer" data-testid={`${testIdPrefix}add-widget-${id}`}>
                      <Icon className="w-3.5 h-3.5 mr-2 text-violet-400" />
                      <span className="flex-1 text-xs">{meta?.label || id}</span>
                      <Plus className="w-3 h-3 text-emerald-400" />
                    </DropdownMenuItem>
                  );
                })
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {editMode && (
          <Button size="sm" variant="ghost" className="h-7 text-[10px] text-zinc-400" onClick={resetLayout} data-testid={`${testIdPrefix}reset-layout-btn`}>
            <RotateCcw className="w-3 h-3 mr-1" />Reset
          </Button>
        )}
        <Button size="sm" variant="outline" className={`h-7 text-[10px] ${editMode ? "text-violet-300 border-violet-500/40 bg-violet-500/10" : ""}`} onClick={() => setEditMode(e => !e)} data-testid={`${testIdPrefix}customise-layout-btn`}>
          {editMode ? <><Lock className="w-3 h-3 mr-1" />Lock</> : <><Unlock className="w-3 h-3 mr-1" />Customise</>}
        </Button>
      </div>
    </div>
  );

  return {
    editMode, setEditMode,
    hiddenWidgets, hideWidget, showWidget,
    layouts, visibleLayouts, onLayoutChange, resetLayout,
    hiddenList,
    HideBtn, EditBar,
  };
}
