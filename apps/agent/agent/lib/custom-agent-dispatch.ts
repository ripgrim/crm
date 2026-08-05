import { db } from "@crm/db";
import type { SendFn } from "eve/channels";

const BUILDER_BATCH = 20;
const RUN_BATCH = 20;
const MAX_BUILDER_ATTEMPTS = 3;
const BUILDER_LEASE_MS = 5 * 60_000;

export async function pendingBuilderSubmissionIds(): Promise<string[]> {
	await recoverBuilderSubmissions();
	const rows = await db.agentConversationSubmission.findMany({
		where: {
			status: "PENDING",
			conversation: {
				kind: "BUILDER",
				OR: [{ sessionId: null }, { continuationToken: { not: null } }],
			},
		},
		orderBy: { createdAt: "asc" },
		take: BUILDER_BATCH * 3,
		select: { id: true, conversationId: true },
	});

	const seen = new Set<string>();
	return rows
		.flatMap((row) => {
			if (seen.has(row.conversationId)) return [];
			seen.add(row.conversationId);
			return [row.id];
		})
		.slice(0, BUILDER_BATCH);
}

export async function drainBuilder(send: SendFn): Promise<number> {
	const ids = await pendingBuilderSubmissionIds();
	await Promise.all(ids.map((id) => dispatchBuilderSubmission(id, send)));
	return ids.length;
}

export async function dispatchBuilderSubmission(
	submissionId: string,
	send: SendFn,
) {
	const claimed = await db.agentConversationSubmission.updateMany({
		where: { id: submissionId, status: "PENDING" },
		data: {
			status: "SENDING",
			attemptCount: { increment: 1 },
			sentAt: new Date(),
			errorCode: null,
			errorMessage: null,
		},
	});
	if (claimed.count === 0)
		throw new Error("Builder submission was already claimed.");

	const submission = await db.agentConversationSubmission.findUnique({
		where: { id: submissionId },
		select: {
			id: true,
			commandType: true,
			message: true,
			attemptCount: true,
			conversation: {
				select: {
					id: true,
					title: true,
					userId: true,
					kind: true,
				},
			},
		},
	});
	if (submission?.conversation.kind !== "BUILDER") {
		throw new Error("Builder submission is unavailable.");
	}

	const conversationId = submission.conversation.id;
	await db.agentConversation.update({
		where: { id: conversationId },
		data: { continuationToken: null },
	});

	try {
		const session = await send(
			builderDeliveryMessage(submission.id, submission.message),
			{
				auth: {
					authenticator: "crm-builder",
					principalType: "user",
					principalId: submission.conversation.userId,
					attributes: {
						purpose: "builder",
						commandType: submission.commandType,
						conversationId,
						userId: submission.conversation.userId,
						submissionId: submission.id,
					},
				},
				continuationToken: builderToken(conversationId),
				title: submission.conversation.title ?? "Agent builder",
			},
		);

		await db.$transaction([
			db.agentConversationSubmission.update({
				where: { id: submission.id },
				data: { status: "ACCEPTED", acceptedAt: new Date() },
			}),
			db.agentConversation.update({
				where: { id: conversationId },
				data: { sessionId: session.id, continuationToken: null },
			}),
		]);

		return session;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const retry = submission.attemptCount < MAX_BUILDER_ATTEMPTS;
		await db.$transaction([
			db.agentConversationSubmission.update({
				where: { id: submission.id },
				data: {
					status: retry ? "PENDING" : "FAILED",
					errorCode: "DELIVERY_FAILED",
					errorMessage: message,
				},
			}),
			db.agentConversation.update({
				where: { id: conversationId },
				data: { continuationToken: builderToken(conversationId) },
			}),
		]);
		throw error;
	}
}

export async function queueDueAgentRuns(now = new Date()): Promise<number> {
	const triggers = await db.agentTrigger.findMany({
		where: {
			enabled: true,
			type: "SCHEDULE",
			nextRunAt: { lte: now },
			agent: { status: "LIVE" },
		},
		orderBy: { nextRunAt: "asc" },
		take: RUN_BATCH,
		select: {
			id: true,
			agentId: true,
			versionId: true,
			nextRunAt: true,
			config: true,
		},
	});

	let queued = 0;
	for (const trigger of triggers) {
		if (!trigger.nextRunAt) continue;
		const intervalMinutes = intervalOf(trigger.config);
		const nextRunAt = advance(trigger.nextRunAt, intervalMinutes, now);
		const claimed = await db.agentTrigger.updateMany({
			where: { id: trigger.id, nextRunAt: trigger.nextRunAt, enabled: true },
			data: { nextRunAt, lastRunAt: trigger.nextRunAt },
		});
		if (claimed.count === 0) continue;

		const idempotencyKey = `${trigger.id}:${trigger.nextRunAt.toISOString()}`;
		await db.agentRun.upsert({
			where: { idempotencyKey },
			create: {
				agentId: trigger.agentId,
				versionId: trigger.versionId,
				triggerId: trigger.id,
				triggerType: "SCHEDULE",
				idempotencyKey,
				correlationId: crypto.randomUUID(),
				input: { scheduledFor: trigger.nextRunAt.toISOString() },
				events: { create: { sequence: 0, type: "run.queued", data: {} } },
			},
			update: {},
		});
		queued += 1;
	}

	return queued;
}

export async function pendingAgentRunIds(): Promise<string[]> {
	const rows = await db.agentRun.findMany({
		where: { status: "QUEUED", agent: { status: "LIVE" } },
		orderBy: { createdAt: "asc" },
		take: RUN_BATCH,
		select: { id: true },
	});
	return rows.map((row) => row.id);
}

export async function drainAgentRuns(send: SendFn): Promise<number> {
	await queueDueAgentRuns();
	const ids = await pendingAgentRunIds();
	await Promise.all(ids.map((id) => dispatchAgentRun(id, send)));
	return ids.length;
}

export async function dispatchAgentRun(runId: string, send: SendFn) {
	const run = await db.agentRun.findUnique({
		where: { id: runId },
		select: {
			id: true,
			status: true,
			agentId: true,
			versionId: true,
			initiatedById: true,
			agent: {
				select: { name: true, createdById: true, status: true },
			},
			version: { select: { modelId: true } },
		},
	});
	if (run?.status !== "QUEUED" || run.agent.status !== "LIVE") {
		throw new Error("Agent run was already claimed or is not live.");
	}

	const claimed = await db.agentRun.updateMany({
		where: { id: runId, status: "QUEUED" },
		data: {
			status: "RUNNING",
			startedAt: new Date(),
			modelId: run.version.modelId,
		},
	});
	if (claimed.count === 0) throw new Error("Agent run was already claimed.");

	const principalId = run.initiatedById ?? run.agent.createdById;
	try {
		const session = await send(`Execute deployed agent run ${run.id}.`, {
			auth: {
				authenticator: run.initiatedById ? "crm-user" : "crm-schedule",
				principalType: run.initiatedById ? "user" : "runtime",
				principalId,
				attributes: {
					purpose: "team-agent",
					runId: run.id,
					agentId: run.agentId,
					versionId: run.versionId,
					userId: principalId,
				},
			},
			continuationToken: runToken(run.id),
			title: `${run.agent.name} run`,
			mode: "task",
		});

		await db.agentRun.update({
			where: { id: run.id },
			data: { sessionId: session.id },
		});
		return session;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		await failRun(run.id, "DELIVERY_FAILED", message);
		throw error;
	}
}

export async function failRun(runId: string, code: string, message: string) {
	const run = await db.agentRun.update({
		where: { id: runId },
		data: {
			status: "FAILED",
			errorCode: code,
			errorMessage: message,
			finishedAt: new Date(),
		},
		select: { id: true, agentId: true, versionId: true },
	});

	await db.agentAuditEvent.upsert({
		where: {
			agentId_type_requestId: {
				agentId: run.agentId,
				type: "run.failed",
				requestId: run.id,
			},
		},
		create: {
			agentId: run.agentId,
			versionId: run.versionId,
			actorType: "AGENT",
			actorId: run.id,
			type: "run.failed",
			summary: message,
			requestId: run.id,
		},
		update: { summary: message },
	});
}

export function builderToken(conversationId: string): string {
	return `builder:${conversationId}`;
}

export function builderIdFromToken(token: string | undefined): string | null {
	return idFromToken(token, "builder:");
}

export function runToken(runId: string): string {
	return `run:${runId}`;
}

export function runIdFromToken(token: string | undefined): string | null {
	return idFromToken(token, "run:");
}

async function recoverBuilderSubmissions() {
	const stale = new Date(Date.now() - BUILDER_LEASE_MS);
	await db.agentConversationSubmission.updateMany({
		where: {
			status: "SENDING",
			sentAt: { lt: stale },
			attemptCount: { lt: MAX_BUILDER_ATTEMPTS },
		},
		data: { status: "PENDING" },
	});
	await db.agentConversationSubmission.updateMany({
		where: {
			status: "SENDING",
			sentAt: { lt: stale },
			attemptCount: { gte: MAX_BUILDER_ATTEMPTS },
		},
		data: {
			status: "FAILED",
			errorCode: "DELIVERY_EXHAUSTED",
			errorMessage:
				"The builder could not accept this message after three attempts.",
		},
	});
}

export function builderDeliveryMessage(
	submissionId: string,
	value: unknown,
): Parameters<SendFn>[0] {
	const message = recordOf(value);
	const inputResponse = recordOf(message.inputResponse);
	const response =
		typeof inputResponse.requestId === "string" &&
		typeof inputResponse.answer === "string"
			? inputResponse.answer.trim()
			: "";
	if (response) return response;

	const text = typeof message.text === "string" ? message.text : "";
	const resources = Array.isArray(message.resources) ? message.resources : [];
	const attachments = Array.isArray(message.attachments)
		? message.attachments
		: [];
	const context = [
		`Submission id: ${submissionId}`,
		resources.length > 0
			? `Tagged resources: ${resources.map(resourceLabel).filter(Boolean).join(", ")}`
			: null,
	]
		.filter(Boolean)
		.join("\n");
	const parts: Array<Record<string, unknown>> = [
		{ type: "text", text: `${context}\n\n${text}` },
	];

	for (const attachment of attachments) {
		const row = recordOf(attachment);
		if (typeof row.contentBase64 !== "string" || typeof row.type !== "string") {
			continue;
		}
		parts.push({
			type: "file",
			data: Buffer.from(row.contentBase64, "base64"),
			mediaType: row.type,
		});
	}

	return parts as Parameters<SendFn>[0];
}

function resourceLabel(value: unknown): string | null {
	const row = recordOf(value);
	return typeof row.label === "string" ? row.label : null;
}

function intervalOf(value: unknown): number {
	const interval = recordOf(value).intervalMinutes;
	return typeof interval === "number" &&
		Number.isFinite(interval) &&
		interval >= 1
		? Math.min(interval, 525_600)
		: 1440;
}

function advance(from: Date, intervalMinutes: number, now: Date): Date {
	const intervalMs = intervalMinutes * 60_000;
	const missed = Math.max(
		1,
		Math.floor((now.getTime() - from.getTime()) / intervalMs) + 1,
	);
	return new Date(from.getTime() + missed * intervalMs);
}

function idFromToken(token: string | undefined, marker: string): string | null {
	if (!token) return null;
	const index = token.lastIndexOf(marker);
	if (index === -1) return null;
	const id = token.slice(index + marker.length);
	return id || null;
}

function recordOf(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}
