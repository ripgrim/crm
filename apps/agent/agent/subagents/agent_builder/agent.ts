import { DEFAULT_AGENT_MODEL } from "@crm/db/settings";
import { defineAgent, defineDynamic } from "eve";
import { selectedModel } from "../../lib/model";

export default defineAgent({
	description:
		"Turn one private CRM builder-chat request into a validated, reviewable team-agent version without deploying it.",
	model: defineDynamic({
		fallback: DEFAULT_AGENT_MODEL.id,
		events: { "session.started": () => selectedModel() },
	}),
	limits: {
		maxInputTokensPerSession: 250_000,
		maxOutputTokensPerSession: 20_000,
		sessionTimeoutMs: 24 * 60 * 60 * 1000,
	},
});
