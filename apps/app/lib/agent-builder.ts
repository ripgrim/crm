export type BuilderCommandType = "CHAT" | "CREATE_AGENT";

const CREATE_AGENT = /^\/create(?:\s+agent|-agent)(?:\s|$)/i;
const CREATE_AGENT_REQUEST =
	/^(?:(?:i\s+(?:need|want)\s+(?:you\s+to\s+)?)|please\s+)?(?:create|build|draft|make|configure|set\s+up)(?:\s+me)?\s+(?:(?:and\s+save)\s+)?(?:(?:a|an|the|this)\s+)?(?:new\s+)?agent\b/i;

export function builderCommandType(message: string): BuilderCommandType {
	const trimmed = message.trimStart();
	return CREATE_AGENT.test(trimmed) || CREATE_AGENT_REQUEST.test(trimmed)
		? "CREATE_AGENT"
		: "CHAT";
}

export function consumeBuilderCommand(
	message: string,
): { commandType: BuilderCommandType; body: string } | null {
	const trimmed = message.trimStart();
	const match = CREATE_AGENT.exec(trimmed);
	if (!match) return null;

	return {
		commandType: "CREATE_AGENT",
		body: trimmed.slice(match[0].length).trimStart(),
	};
}

export function hasCreateAgentCommand(
	submissions: ReadonlyArray<{ commandType: BuilderCommandType }>,
): boolean {
	return submissions.some(
		(submission) => submission.commandType === "CREATE_AGENT",
	);
}
