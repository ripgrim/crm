import type { Metadata } from "next";
import { TeamAgentsIndex } from "@/components/agent-builder/team-agents-index";

export const metadata: Metadata = { title: "Agents" };

export default function AgentsPage() {
	return <TeamAgentsIndex />;
}
