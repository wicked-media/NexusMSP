import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, X, Maximize2, Loader2 } from "lucide-react";

export function PdfViewerDialog({ open, onOpenChange, pdfUrl, title, downloadUrl }) {
  const [loading, setLoading] = useState(true);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[85vh] flex flex-col p-0 gap-0" aria-describedby="pdf-viewer-desc">
        <DialogHeader className="px-4 py-3 border-b flex-shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="text-sm font-semibold">{title || "PDF Preview"}</DialogTitle>
              <DialogDescription id="pdf-viewer-desc" className="text-xs text-muted-foreground">Document preview</DialogDescription>
            </div>
            <div className="flex items-center gap-2">
              {downloadUrl && (
                <Button variant="outline" size="sm" onClick={() => window.open(downloadUrl, "_blank")} data-testid="pdf-download-btn">
                  <Download className="w-3.5 h-3.5 mr-1" />Download
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={() => window.open(pdfUrl, "_blank")} data-testid="pdf-fullscreen-btn">
                <Maximize2 className="w-3.5 h-3.5 mr-1" />Full Screen
              </Button>
            </div>
          </div>
        </DialogHeader>
        <div className="flex-1 relative bg-muted/30">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center z-10">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          )}
          <iframe
            src={pdfUrl}
            className="w-full h-full border-0"
            title="PDF Preview"
            onLoad={() => setLoading(false)}
            data-testid="pdf-viewer-iframe"
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
