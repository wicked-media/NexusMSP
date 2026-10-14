import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

// The lost packet: a 404 that earns its keep. Every dropped packet deserves a
// little dignity before it finds its way home.
export default function NotFoundPage() {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-6 text-center" data-testid="not-found-page">
      <div className="relative mb-8 h-28 w-28">
        <div className="absolute inset-0 animate-ping rounded-2xl border-2 border-dashed border-sky-400/40" />
        <div className="flex h-28 w-28 items-center justify-center rounded-2xl border border-sky-400/30 bg-sky-500/10 text-5xl">
          📦
        </div>
        <span className="absolute -right-3 -top-3 rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-mono text-amber-300">404</span>
      </div>
      <h1 className="text-3xl font-semibold tracking-tight">Lost packet</h1>
      <p className="mt-3 max-w-md text-sm text-muted-foreground">
        This packet took a wrong turn at the switch and never reached its destination.
        The route you asked for doesn't exist — but the little guy would love an escort home.
      </p>
      <div className="mt-6 flex items-center gap-3">
        <Button asChild data-testid="not-found-home">
          <Link to="/">Escort the packet home</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link to="/toolbox">Visit the Tech Toolbox</Link>
        </Button>
      </div>
    </div>
  );
}
