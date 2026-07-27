"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckIcon, ChevronsUpDownIcon, Building2Icon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { Spinner } from "@/components/ui/spinner";

// Only rendered when someone belongs to more than one workspace. A switcher
// with nothing to switch between is a control that does nothing.
export function WorkspaceSwitcher({ workspaces, activeId }) {
  const router = useRouter();
  const [busy, setBusy] = useState(null);

  if (!workspaces || workspaces.length < 2) return null;

  const active = workspaces.find((w) => w.id === activeId) ?? workspaces[0];

  async function switchTo(workspace) {
    if (workspace.id === active.id) return;
    setBusy(workspace.id);

    // Server-side: the route re-checks membership before setting the cookie,
    // and every read re-checks it again. The cookie is a hint, not authority.
    const response = await fetch("/api/workspace/switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId: workspace.id }),
    });

    setBusy(null);
    if (!response.ok) {
      toast.error("Couldn't switch workspace.");
      return;
    }

    toast.success(`Switched to ${workspace.name}.`);
    router.refresh();
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<SidebarMenuButton size="lg" className="aria-expanded:bg-muted" />}
          >
            <div className="flex size-6 shrink-0 items-center justify-center rounded bg-muted">
              <Building2Icon className="size-4" />
            </div>
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-medium">{active.name}</span>
              <span className="truncate text-xs text-muted-foreground">{active.role}</span>
            </div>
            <ChevronsUpDownIcon className="ml-auto size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-56">
            {workspaces.map((workspace) => (
              <DropdownMenuItem
                key={workspace.id}
                onClick={() => switchTo(workspace)}
                disabled={busy === workspace.id}
              >
                <span className="flex-1 truncate">{workspace.name}</span>
                {busy === workspace.id ? (
                  <Spinner />
                ) : (
                  workspace.id === active.id && <CheckIcon className="size-4" />
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
