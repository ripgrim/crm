import type { Metadata } from "next";
import { AgentBuilderChat } from "@/components/agent-builder/agent-builder-chat";
import { getServerQueryClient, getServerTrpc } from "@/lib/trpc/server";

export const metadata: Metadata = { title: "Agent chat" };

export default async function AgentChatPage({
	params,
}: {
	params: Promise<{ chatId: string }>;
}) {
	const { chatId } = await params;
	const trpc = getServerTrpc();
	const queryClient = getServerQueryClient();

	void queryClient.prefetchQuery(
		trpc.conversations.builderById.queryOptions({ id: chatId }),
	);

	return <AgentBuilderChat conversationId={chatId} />;
}
