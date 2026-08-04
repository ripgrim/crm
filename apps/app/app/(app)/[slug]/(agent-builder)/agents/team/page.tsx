import type { Metadata } from "next";
import { TeamAgentsIndex } from "@/components/agent-builder/team-agents-index";

export const metadata: Metadata = { title: "Team agents" };

export default function TeamAgentsListPage() {
	return <TeamAgentsIndex />;
}
