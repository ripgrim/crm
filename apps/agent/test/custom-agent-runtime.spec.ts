import { describe, expect, it } from "bun:test";
import { builderTaskMarkdown } from "../agent/instructions/task";
import {
	builderIdFromToken,
	builderToken,
	runIdFromToken,
	runToken,
} from "../agent/lib/custom-agent-dispatch";
import {
	assertResearchPurpose,
	attribute,
	purposeOf,
} from "../agent/lib/session-purpose";

const context = (purpose?: string) => ({
	session: {
		auth: {
			current: purpose
				? { attributes: { purpose, conversationId: "chat-1" } }
				: { attributes: {} },
			initiator: { attributes: { userId: "user-1" } },
		},
	},
});

describe("custom agent continuation tokens", () => {
	it("round-trips a builder conversation through the channel token", () => {
		expect(builderIdFromToken(builderToken("chat-1"))).toBe("chat-1");
		expect(builderIdFromToken(`crm:${builderToken("chat-1")}`)).toBe("chat-1");
	});

	it("round-trips a team agent run without accepting another token kind", () => {
		expect(runIdFromToken(runToken("run-1"))).toBe("run-1");
		expect(runIdFromToken(builderToken("chat-1"))).toBeNull();
	});
});

describe("session purpose boundaries", () => {
	it("reads current-turn attributes before initiator attributes", () => {
		expect(attribute(context("builder"), "conversationId")).toBe("chat-1");
		expect(attribute(context("builder"), "userId")).toBe("user-1");
	});

	it("defaults ordinary CRM sessions to research", () => {
		expect(purposeOf(context())).toBe("research");
		expect(() => assertResearchPurpose(context())).not.toThrow();
	});

	it("rejects research writes from builder and team-agent sessions", () => {
		expect(() => assertResearchPurpose(context("builder"))).toThrow();
		expect(() => assertResearchPurpose(context("team-agent"))).toThrow();
	});
});

describe("builder command routing", () => {
	it("delegates only the explicit creation command to the agent builder", () => {
		expect(builderTaskMarkdown("CREATE_AGENT")).toContain(
			"Call agent_builder exactly once",
		);
		expect(builderTaskMarkdown("CHAT")).toContain("Do not call agent_builder");
		expect(builderTaskMarkdown(null)).toContain("private CRM assistant chat");
	});
});
