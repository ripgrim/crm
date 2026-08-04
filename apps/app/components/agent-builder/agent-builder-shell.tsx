import { AgentBuilderSidebar } from "./agent-builder-sidebar";

export function AgentBuilderShell({ children }: { children: React.ReactNode }) {
	return (
		<div className="flex min-h-0 min-w-0 flex-1">
			<AgentBuilderSidebar className="hidden w-[213px] flex-none border-r md:flex" />
			<div className="flex min-w-0 flex-1 flex-col">{children}</div>
		</div>
	);
}
