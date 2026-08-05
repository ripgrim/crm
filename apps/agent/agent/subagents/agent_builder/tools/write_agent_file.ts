import { defineTool } from "eve/tools";
import { z } from "zod";
import {
	BUILDER_ARTIFACT_PATHS,
	writeBuilderArtifact,
} from "../../../lib/builder-runtime";
import { requireAttribute } from "../../../lib/session-purpose";

export default defineTool({
	description:
		"Write one durable agent file revision so the user can follow the build live. Write instructions and the manifest before saving the final draft.",
	inputSchema: z.object({
		path: z.enum(BUILDER_ARTIFACT_PATHS),
		content: z.string().min(1).max(40_000),
	}),
	async execute(input, ctx) {
		return writeBuilderArtifact(
			requireAttribute(ctx, "conversationId"),
			requireAttribute(ctx, "userId"),
			input.path,
			input.content,
		);
	},
});
