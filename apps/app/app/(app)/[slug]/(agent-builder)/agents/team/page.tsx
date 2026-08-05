import { redirect } from "next/navigation";
import { workspaceUrl } from "@/lib/workspace-url";

export default async function TeamAgentsListPage({
	params,
}: PageProps<"/[slug]/agents/team">) {
	const { slug } = await params;
	redirect(workspaceUrl(slug, "/agents"));
}
