import { AgentBuilderShell } from "@/components/agent-builder/agent-builder-shell";
import { HydrateClient } from "@/lib/trpc/hydrate";
import { getServerQueryClient, getServerTrpc } from "@/lib/trpc/server";

export default async function AgentBuilderLayout({
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
