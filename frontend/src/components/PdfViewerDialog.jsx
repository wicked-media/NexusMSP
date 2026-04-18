import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Download, Maximize2, Loader2, Mail, Send } from "lucide-react";

export function PdfViewerDialog({ open, onOpenChange, pdfUrl, title, downloadUrl, onEmail }) {
  const [loading, setLoading] = useState(true);
  const [showEmail, setShowEmail] = useState(false);
  const [emailTo, setEmailTo] = useState("");
  const [emailSending, setEmailSending] = useState(false);

  const handleEmail = async () => {
    if (!emailTo.trim() || !onEmail) return;
    setEmailSending(true);
    try {
      await onEmail(emailTo.trim());
      setShowEmail(false);
      setEmailTo("");
    } finally {
      setEmailSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={v => { onOpenChange(v); if (!v) { setShowEmail(false); setLoading(true); } }}>
      <DialogContent className="max-w-4xl h-[85vh] flex flex-col p-0 gap-0" aria-describedby="pdf-viewer-desc">
        <DialogHeader className="px-4 py-3 border-b flex-shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="text-sm font-semibold">{title || "PDF Preview"}</DialogTitle>
              <DialogDescription id="pdf-viewer-desc" className="text-xs text-muted-foreground">Document preview</DialogDescription>
            </div>
            <div className="flex items-center gap-2">
              {onEmail && (
                <Button variant="outline" size="sm" onClick={() => setShowEmail(p => !p)} data-testid="pdf-email-btn">
                  <Mail className="w-3.5 h-3.5 mr-1" />Email
                </Button>
              )}
              {downloadUrl && (
                <Button variant="outline" size="sm" onClick={() => { const a = document.createElement("a"); a.href = downloadUrl; a.target = "_blank"; a.rel = "noopener"; document.body.appendChild(a); a.click(); setTimeout(() => document.body.removeChild(a), 200); }} data-testid="pdf-download-btn">
                  <Download className="w-3.5 h-3.5 mr-1" />Download
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={() => window.open(pdfUrl, "_blank")} data-testid="pdf-fullscreen-btn">
                <Maximize2 className="w-3.5 h-3.5 mr-1" />Full Screen
              </Button>
            </div>
          </div>
          {showEmail && (
            <div className="flex items-end gap-2 mt-2 pt-2 border-t">
              <div className="flex-1">
                <Label className="text-xs">Recipient Email</Label>
                <Input type="email" placeholder="client@company.com" value={emailTo} onChange={e => setEmailTo(e.target.value)} className="h-8 text-sm" data-testid="pdf-email-input" />
              </div>
              <Button size="sm" onClick={handleEmail} disabled={emailSending || !emailTo.trim()} data-testid="pdf-email-send">
                {emailSending ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Send className="w-3.5 h-3.5 mr-1" />}Send
              </Button>
            </div>
          )}
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
