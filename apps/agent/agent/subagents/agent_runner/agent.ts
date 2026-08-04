import { db } from "@crm/db";
import { DEFAULT_AGENT_MODEL } from "@crm/db/settings";
import { defineAgent, defineDynamic } from "eve";
import { attribute } from "../../lib/session-purpose";

export default defineAgent({
	description:
		"Execute one immutable deployed CRM agent version and persist its result and every side effect.",
	model: defineDynamic({
		fallback: DEFAULT_AGENT_MODEL.id,
		events: {
			"session.started": async (_event, ctx) => {
				const runId = attribute(ctx, "runId");
				if (!runId) return null;

				const run = await db.agentRun.findUnique({
					where: { id: runId },
					select: { version: { select: { modelId: true } } },
				});
				return run?.version.modelId ?? null;
			},
		},
	}),
	limits: {
		maxInputTokensPerSession: 500_000,
		maxOutputTokensPerSession: 40_000,
		sessionTimeoutMs: 24 * 60 * 60 * 1000,
	},
});
