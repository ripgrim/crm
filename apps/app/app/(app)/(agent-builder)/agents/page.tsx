import type { Metadata } from "next";
import { AgentBuilderHome } from "@/components/agent-builder/agent-builder-home";
import { requireSession } from "@/lib/session";
import { getServerQueryClient, getServerTrpc } from "@/lib/trpc/server";

export const metadata: Metadata = { title: "Agents" };

export default async function AgentsPage() {
	const session = await requireSession();
	const trpc = getServerTrpc();
	const queryClient = getServerQueryClient();

	await Promise.all([
		queryClient.prefetchQuery(
			trpc.conversations.builderResources.queryOptions({ q: "" }),
		),
		queryClient.prefetchQuery(trpc.google.status.queryOptions()),
	]);

	return <AgentBuilderHome name={session.user.name} />;
}
