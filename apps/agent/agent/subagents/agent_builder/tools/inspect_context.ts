import { defineTool } from "eve/tools";
import { z } from "zod";
import { builderContext } from "../../../lib/builder-runtime";
import { requireAttribute } from "../../../lib/session-purpose";

export default defineTool({
	description:
		"Read the authoritative builder-chat scope, connected sources, selected CRM records, current time, and latest draft.",
	inputSchema: z.object({}),
	async execute(_input, ctx) {
		return builderContext(
			requireAttribute(ctx, "conversationId"),
			requireAttribute(ctx, "userId"),
		);
	},
});
