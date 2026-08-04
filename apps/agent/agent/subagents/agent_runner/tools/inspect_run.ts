import { defineTool } from "eve/tools";
import { z } from "zod";
import { runContext } from "../../../lib/run-runtime";
import { requireAttribute } from "../../../lib/session-purpose";

export default defineTool({
	description:
		"Read the immutable version instructions, trigger, approved scope, allowed actions, and current time for this run.",
	inputSchema: z.object({}),
	async execute(_input, ctx) {
		return runContext(requireAttribute(ctx, "runId"));
	},
});
