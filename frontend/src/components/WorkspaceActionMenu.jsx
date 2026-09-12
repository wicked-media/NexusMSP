import { ChevronDown, MoreHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function WorkspaceActionMenuItem({ children, icon: Icon, onSelect, disabled = false, testId }) {
  return (
    <DropdownMenuItem onSelect={onSelect} disabled={disabled} data-testid={testId}>
      {Icon && <Icon className="mr-2 h-4 w-4" aria-hidden="true" />}
      {children}
    </DropdownMenuItem>
  );
}

export default function WorkspaceActionMenu({ children, label = "More", disabled = false, testId }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm" disabled={disabled} data-testid={testId}>
          <MoreHorizontal className="mr-1.5 h-4 w-4" aria-hidden="true" />
          {label}
          <ChevronDown className="ml-1 h-3.5 w-3.5 opacity-70" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
