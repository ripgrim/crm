import { describe, expect, it } from "bun:test";
import {
	builderCommandType,
	hasCreateAgentCommand,
} from "../lib/agent-builder";

describe("agent builder commands", () => {
	it("only enters agent creation for the explicit slash command", () => {
		expect(builderCommandType("/Create agent Flag stalled deals")).toBe(
			"CREATE_AGENT",
		);
		expect(builderCommandType("  /create agent summarize renewals")).toBe(
			"CREATE_AGENT",
		);
		expect(builderCommandType("Tell me about this customer")).toBe("CHAT");
		expect(builderCommandType("/Create agentic workflows")).toBe("CHAT");
	});

	it("shows creation surfaces only after a creation command", () => {
		expect(hasCreateAgentCommand([{ commandType: "CHAT" }])).toBe(false);
		expect(
			hasCreateAgentCommand([
				{ commandType: "CHAT" },
				{ commandType: "CREATE_AGENT" },
			]),
		).toBe(true);
	});
});
