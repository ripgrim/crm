import { Skeleton } from "@crm/ui/components/skeleton";
import { Suspense } from "react";
import { AgentBuilderSidebar } from "./agent-builder-sidebar";

export function AgentBuilderShell({ children }: { children: React.ReactNode }) {
	return (
		<div className="flex min-h-0 min-w-0 flex-1">
			<Suspense fallback={<AgentBuilderSidebarFallback />}>
				<AgentBuilderSidebar className="hidden w-[213px] flex-none border-r md:flex" />
			</Suspense>
			<div className="flex min-w-0 flex-1 flex-col">{children}</div>
		</div>
	);
}

function AgentBuilderSidebarFallback() {
	return (
		<aside className="hidden w-[213px] flex-none flex-col border-r p-4 md:flex">
			<div className="flex h-7 items-center pl-2 font-medium text-xs">
				Chats
			</div>
			<div className="mt-3 space-y-2 px-2" aria-hidden="true">
				<Skeleton className="h-2.5 w-16" />
				<Skeleton className="h-7 w-full" />
				<Skeleton className="h-7 w-full" />
			</div>
		</aside>
	);
}
