import { redirect } from "next/navigation";
import { workspaceUrl } from "@/lib/workspace-url";

export default async function AgentBuilderPage({
	params,
}: {
	params: Promise<{ slug: string }>;
}) {
	const { slug } = await params;
	redirect(workspaceUrl(slug, "/agents"));
}
