import { defineTool } from "eve/tools";
import { z } from "zod";
import { readRunRecord } from "../../../lib/run-runtime";
import { requireAttribute } from "../../../lib/session-purpose";

export default defineTool({
	description:
		"Read one approved CRM record with its recent activities, synced email history, meetings, and related records.",
	inputSchema: z.object({
		kind: z.enum(["contact", "company", "deal"]),
		id: z.string().min(1),
	}),
	async execute(input, ctx) {
		return readRunRecord(requireAttribute(ctx, "runId"), input);
	},
});
