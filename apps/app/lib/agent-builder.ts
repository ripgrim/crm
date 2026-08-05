export type BuilderCommandType = "CHAT" | "CREATE_AGENT";

const CREATE_AGENT = /^\/create(?:\s+agent|-agent)(?:\s|$)/i;

export function builderCommandType(message: string): BuilderCommandType {
	return CREATE_AGENT.test(message.trimStart()) ? "CREATE_AGENT" : "CHAT";
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
