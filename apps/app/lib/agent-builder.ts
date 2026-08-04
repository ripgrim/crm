export type BuilderCommandType = "CHAT" | "CREATE_AGENT";

export function builderCommandType(message: string): BuilderCommandType {
	return /^\/create\s+agent(?:\s|$)/i.test(message.trimStart())
		? "CREATE_AGENT"
		: "CHAT";
}

export function hasCreateAgentCommand(
	submissions: ReadonlyArray<{ commandType: BuilderCommandType }>,
): boolean {
	return submissions.some(
		(submission) => submission.commandType === "CREATE_AGENT",
	);
}
