import type { MessageStreamEvent } from "eve/client";
import {
	defaultMessageReducer,
	type EveMessage,
	type EveMessageInputRequest,
	type EveMessagePart,
} from "eve/react";

export type TranscriptItem =
	| { kind: "said"; id: string; mine: boolean; text: string }
	| {
			kind: "asked";
			id: string;
			question: EveMessageInputRequest;
	  }
	| {
			kind: "did";
			id: string;
			label: string;
			tone: Tone;
			pending: boolean;
			sources: Source[];
	  };

export type Tone = "neutral" | "success" | "warning";

export type Source = {
	url: string;
	title: string;
	network: "linkedin" | "github" | "web";
};

export type AgentTurnFailure = {
	code: string;
	kind: "rate-limit" | "restricted" | "credits" | "unknown";
};

type AgentStreamEvent = {
	type: string;
	data?: unknown;
};

const VERBS: Record<string, string> = {
	read_crm_history: "Read our emails and meetings with them",
	read_company_history: "Read everything we have on the company",
	read_deal_history: "Read the deal and where it has been",
	search_crm: "Looked the record up in the CRM",
	resolve_linkedin_profile: "Searched for their LinkedIn profile",
	get_linkedin_profile: "Read a LinkedIn profile",
	get_contact_work_history: "Read their work history",
	fetch_contact_photo: "Fetched their profile picture",
	find_contact_socials: "Searched for their other profiles",
	set_contact_socials: "Checked a profile against the account itself",
	identify_contact: "Put a name to the address",
	record_fact: "Recorded what it found",
	write_brief: "Wrote the background",
	write_workspace_profile: "Wrote up who we are",
	research_person: "Researched them on the web",
	research_company: "Read the company's site",
	enrich_company: "Looked up the company",
	schedule_recheck: "Decided when to look again",
	record_job_change: "Raised a job change",
	list_outstanding_work: "Looked for outstanding work",

	load_skill: "Read its instructions for this",
	web_search: "Searched the web",
	web_fetch: "Read a web page",
	todo: "Updated its plan",
	ask_question: "Asked a question",
	agent: "Handed part of the job to a helper",
	connection_search: "Looked for a tool it could use",
	bash: "Ran a command",
	read_file: "Read a file",
	write_file: "Wrote a file",
	glob: "Looked for files",
	grep: "Searched inside the files",
};

function humanise(tool: string): string {
	const words = tool.replace(/_/g, " ");
	return words.charAt(0).toUpperCase() + words.slice(1);
}

export type TranscriptMessage = {
	id: string;
	mine: boolean;
	items: TranscriptItem[];
};

export type ConversationTimelineItem<
	TSubmission extends { id: string; createdAt: string },
> =
	| { kind: "submission"; id: string; submission: TSubmission }
	| { kind: "assistant"; id: string; message: EveMessage };

export function messagesFromEvents(
	events: readonly MessageStreamEvent[],
): readonly EveMessage[] {
	const reducer = defaultMessageReducer();
	let data = reducer.initial();

	for (const event of events) data = reducer.reduce(data, event);

	return data.messages;
}

export function conversationTimeline<
	TSubmission extends { id: string; createdAt: string },
>(
	submissions: readonly TSubmission[],
	events: readonly MessageStreamEvent[],
	messages: readonly EveMessage[],
): ConversationTimelineItem<TSubmission>[] {
	const turnTimes = new Map<string, number>();

	for (const event of events) {
		const turnId = stringOf(
			recordOf("data" in event ? event.data : undefined).turnId,
		);
		if (!turnId || turnTimes.has(turnId)) continue;
		turnTimes.set(turnId, timestampOf(event.meta.at));
	}

	const rows = [
		...submissions.map((submission, index) => ({
			kind: "submission" as const,
			id: `submission:${submission.id}`,
			submission,
			at: timestampOf(submission.createdAt),
			index,
		})),
		...messages
			.filter((message) => message.role === "assistant")
			.map((message, index) => ({
				kind: "assistant" as const,
				id: `assistant:${message.id}`,
				message,
				at:
					turnTimes.get(stringOf(recordOf(message.metadata).turnId) ?? "") ??
					Number.POSITIVE_INFINITY,
				index,
			})),
	];

	rows.sort((a, b) =>
		a.at !== b.at
			? a.at - b.at
			: a.kind === b.kind
				? a.index - b.index
				: a.kind === "submission"
					? -1
					: 1,
	);

	return rows.map((row) =>
		row.kind === "submission"
			? { kind: row.kind, id: row.id, submission: row.submission }
			: { kind: row.kind, id: row.id, message: row.message },
	);
}

export function toTranscript(
	messages: readonly EveMessage[],
): TranscriptMessage[] {
	return messages
		.map((message) => ({
			id: message.id,
			mine: message.role === "user",
			items: message.parts.flatMap((part, index): TranscriptItem[] => {
				const id = partId(message.id, part, index);

				if (part.type === "text") {
					const text = part.text.trim();
					if (!text) return [];
					return [{ kind: "said", id, mine: message.role === "user", text }];
				}

				if (part.type === "dynamic-tool") {
					const request = part.toolMetadata?.eve?.inputRequest;
					if (request?.kind === "question") {
						return [{ kind: "asked", id, question: request }];
					}
				}

				if (part.type.startsWith("tool-") || part.type === "dynamic-tool") {
					const state = "state" in part ? part.state : undefined;

					return [
						{
							kind: "did",
							id,
							label: describe(part),
							tone: outcomeTone(part),
							pending:
								state === "input-streaming" ||
								state === "input-available" ||
								state === "approval-requested",
							sources: sourcesOf(part),
						},
					];
				}

				return [];
			}),
		}))
		.filter((message) => message.items.length > 0);
}

function partId(
	messageId: string,
	part: EveMessagePart,
	index: number,
): string {
	const callId =
		"toolCallId" in part && typeof part.toolCallId === "string"
			? part.toolCallId
			: null;

	return callId ? `${messageId}:${callId}` : `${messageId}:${index}`;
}

export function toolName(part: EveMessagePart): string {
	if (part.type === "dynamic-tool" && "toolName" in part) {
		return String(part.toolName);
	}
	return part.type.replace(/^tool-/, "");
}

export const TOOL_VERBS = VERBS;

export function describe(part: EveMessagePart): string {
	const tool = toolName(part);
	const verb = VERBS[tool] ?? humanise(tool);
	const reason = output(part)?.reason;

	return typeof reason === "string" ? `${verb} — ${reason}` : verb;
}

export function outcomeTone(part: EveMessagePart): Tone {
	if ("state" in part && part.state === "output-error") return "warning";

	const result = output(part);
	if (!result) return "neutral";

	if (result.applied === true || result.written === true) return "success";
	if (result.stored === false || result.written === false) return "warning";

	return "neutral";
}

export function sourcesOf(part: EveMessagePart): Source[] {
	const result = output(part);
	if (!result) return [];

	const urls = new Set<string>();
	for (const key of ["sourceUrl", "profileUrl", "url"]) {
		const value = result[key];
		if (typeof value === "string" && /^https?:\/\//.test(value)) {
			urls.add(value);
		}
	}

	return [...urls].map((url) => {
		const title = hostOf(url);
		return {
			url,
			title,
			network: title.includes("linkedin")
				? ("linkedin" as const)
				: title.includes("github")
					? ("github" as const)
					: ("web" as const),
		};
	});
}

export function pendingQuestion(messages: readonly EveMessage[]) {
	for (const part of messages.at(-1)?.parts ?? []) {
		if (part.type !== "dynamic-tool" || part.state !== "approval-requested") {
			continue;
		}

		const request = part.toolMetadata?.eve?.inputRequest;
		if (request?.kind === "question") return request;
	}

	return null;
}

export function latestTurnFailure(
	events: readonly AgentStreamEvent[],
): AgentTurnFailure | null {
	for (let index = events.length - 1; index >= 0; index -= 1) {
		const event = events[index];
		if (!event) continue;
		if (event.type === "turn.completed") return null;
		if (event.type !== "turn.failed" && event.type !== "session.failed") {
			continue;
		}

		const data = recordOf(event.data);
		const message = typeof data.message === "string" ? data.message : "";
		const code = typeof data.code === "string" ? data.code : "AGENT_FAILED";

		return {
			code,
			kind: /free tier users do not have access|RestrictedModelsError/i.test(
				message,
			)
				? "restricted"
				: /GatewayRateLimitError|free tier requests.*rate-?limited/i.test(
							message,
						)
					? "rate-limit"
					: /credits?|quota|billing|usage limit/i.test(message)
						? "credits"
						: "unknown",
		};
	}

	return null;
}

function output(part: EveMessagePart): Record<string, unknown> | null {
	return "output" in part && part.output && typeof part.output === "object"
		? (part.output as Record<string, unknown>)
		: null;
}

function recordOf(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function stringOf(value: unknown): string | null {
	return typeof value === "string" && value ? value : null;
}

function timestampOf(value: string): number {
	const timestamp = Date.parse(value);
	return Number.isFinite(timestamp) ? timestamp : Number.POSITIVE_INFINITY;
}

function hostOf(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./, "");
	} catch {
		return url;
	}
}

export const NEW_THREAD = "new";

export function resolveThread<T extends { id: string }>({
	conversations,
	fromUrl,
	landedOn,
}: {
	conversations: readonly T[];
	fromUrl: string | null;
	landedOn: string | null;
}): { openId: string | null; current: T | null } {
	const openId = fromUrl ?? landedOn;

	if (!openId || openId === NEW_THREAD) return { openId, current: null };

	return {
		openId,
		current: conversations.find((row) => row.id === openId) ?? null,
	};
}
