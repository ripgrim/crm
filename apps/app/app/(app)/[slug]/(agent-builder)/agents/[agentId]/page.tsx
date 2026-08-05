import type { Metadata } from "next";
import { Suspense } from "react";
import { TeamAgentDetail } from "@/components/agent-builder/team-agent-detail";
import { getServerQueryClient, getServerTrpc } from "@/lib/trpc/server";

export const metadata: Metadata = { title: "Team agent" };

export default function TeamAgentPage({
	params,
}: {
	params: Promise<{ agentId: string }>;
}) {
	return (
		<Suspense fallback={<AgentDetailFallback />}>
			<PrefetchedTeamAgent params={params} />
		</Suspense>
	);
}

async function PrefetchedTeamAgent({
	params,
}: {
	params: Promise<{ agentId: string }>;
}) {
	const { agentId } = await params;
	const trpc = getServerTrpc();
	const queryClient = getServerQueryClient();

	await Promise.all([
		queryClient.prefetchQuery(trpc.agents.byId.queryOptions({ id: agentId })),
		queryClient.prefetchQuery(
			trpc.agents.history.queryOptions({ id: agentId, limit: 50 }),
		),
		queryClient.prefetchQuery(
			trpc.agents.activity.queryOptions({ id: agentId, limit: 100 }),
		),
	]);

	return <TeamAgentDetail agentId={agentId} />;
}

function AgentDetailFallback() {
	return (
		<main className="flex min-h-0 flex-1 items-center justify-center">
			<span className="text-muted-foreground text-sm">Opening agent…</span>
		</main>
	);
}
