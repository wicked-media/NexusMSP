import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function Section({ icon: Icon, title, hint, children, id }) {
  return (
    <Card id={id} className="nx-tool-card border-violet-500/20 bg-slate-900/40">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="h-4 w-4 text-violet-400" />{title}
        </CardTitle>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
