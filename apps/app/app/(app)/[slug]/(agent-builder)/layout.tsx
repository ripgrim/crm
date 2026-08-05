import { Suspense } from "react";
import { AgentBuilderShell } from "@/components/agent-builder/agent-builder-shell";
import { HydrateClient } from "@/lib/trpc/hydrate";
import { getServerQueryClient, getServerTrpc } from "@/lib/trpc/server";

export default function AgentBuilderLayout({
	children,
}: Readonly<{ children: React.ReactNode }>) {
	return (
		<Suspense
			fallback={
				<AgentBuilderShell>
					<AgentBuilderContentFallback />
				</AgentBuilderShell>
			}
		>
			<PrefetchedAgentBuilderShell>{children}</PrefetchedAgentBuilderShell>
		</Suspense>
	);
}

function AgentBuilderContentFallback() {
	return (
		<main className="flex min-h-0 flex-1 items-center justify-center">
			<span className="text-muted-foreground text-sm">Loading chat…</span>
		</main>
	);
}

async function PrefetchedAgentBuilderShell({
	children,
}: Readonly<{ children: React.ReactNode }>) {
	const trpc = getServerTrpc();
	const queryClient = getServerQueryClient();

	await Promise.all([
		queryClient.prefetchQuery(trpc.conversations.builderList.queryOptions()),
		queryClient.prefetchQuery(trpc.agents.list.queryOptions()),
	]);

	return (
		<HydrateClient>
			<AgentBuilderShell>{children}</AgentBuilderShell>
		</HydrateClient>
	);
}
