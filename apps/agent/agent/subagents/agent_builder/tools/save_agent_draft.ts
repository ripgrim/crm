import { defineTool } from "eve/tools";
import { z } from "zod";
import { saveBuilderDraft } from "../../../lib/builder-runtime";
import { requireAttribute } from "../../../lib/session-purpose";

const resource = z.object({
	kind: z.enum(["integration", "company", "contact", "deal"]),
	id: z.string().min(1),
	label: z.string().min(1).max(120),
});

const trigger = z.object({
	type: z.enum(["MANUAL", "SCHEDULE"]),
	name: z.string().min(1).max(120),
	summary: z.string().min(1).max(240),
	nextRunAt: z.string().nullish(),
	intervalMinutes: z.number().int().min(1).max(525_600).nullish(),
});

const action = z.object({
	type: z.enum(["crm.activity.create", "run.summary"]),
	provider: z.literal("crm"),
	summary: z.string().min(1).max(240),
});

export default defineTool({
	description:
		"Validate and save one immutable agent version for human review. This never deploys the agent.",
	inputSchema: z.object({
		name: z.string().trim().min(1).max(100),
		description: z.string().trim().min(1).max(320),
		instructions: z.string().trim().min(40).max(20_000),
		trigger,
		resources: z.array(resource).max(30),
		actions: z.array(action).min(1).max(10),
		access: z.array(z.string().trim().min(1).max(120)).max(20),
	}),
	async execute(input, ctx) {
		return saveBuilderDraft(
			requireAttribute(ctx, "conversationId"),
			requireAttribute(ctx, "userId"),
			input,
		);
	},
});
