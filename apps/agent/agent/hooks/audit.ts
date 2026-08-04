import { db, type Prisma } from "@crm/db";
import { defineHook } from "eve/hooks";
import { currentFocus } from "../lib/focus";
import { attribute, purposeOf } from "../lib/session-purpose";

export default defineHook({
	events: {
		async "*"(event, ctx) {
			const id = event.meta?.id;

			if (!id) return;

			try {
				const data = ("data" in event ? (event.data ?? {}) : {}) as object;
				const emittedAt = event.meta?.at ? new Date(event.meta.at) : new Date();
				await db.agentEvent.createMany({
					data: [
						{
							id,
							sessionId: ctx.session.id,
							contactId: currentFocus().contactId,
							type: event.type,
							data,
							emittedAt,
						},
					],
					skipDuplicates: true,
				});

				const purpose = purposeOf(ctx);
				if (purpose === "builder") {
					await persistBuilderLifecycle(event, ctx.session.id, ctx);
				}
				if (purpose === "team-agent") {
					await persistRunEvent(id, event.type, data, emittedAt, ctx);
				}
			} catch (error) {
				console.warn("[audit] could not record event", {
					type: event.type,
					reason: error instanceof Error ? error.message : String(error),
				});
			}
		},
	},
});

async function persistBuilderLifecycle(
	event: { type: string },
	sessionId: string,
	ctx: Parameters<typeof purposeOf>[0],
) {
	const conversationId = attribute(ctx, "conversationId");
	if (!conversationId) return;

	if (event.type === "session.started") {
		await db.agentConversation.updateMany({
			where: { id: conversationId, kind: "BUILDER" },
			data: { sessionId, continuationToken: null },
		});
	}

	if (event.type === "message.received") {
		const submissionId = attribute(ctx, "submissionId");
		if (submissionId) {
			await db.agentConversationSubmission.updateMany({
				where: { id: submissionId, conversationId },
				data: { status: "ACCEPTED", acceptedAt: new Date() },
			});
		}
	}
}

async function persistRunEvent(
	eventId: string,
	type: string,
	data: object,
	emittedAt: Date,
	ctx: Parameters<typeof purposeOf>[0] & { session: { id: string } },
) {
	const runId = attribute(ctx, "runId");
	if (!runId) return;

	const run = await db.agentRun.update({
		where: { id: runId },
		data: {
			nextEventSequence: { increment: 1 },
			...(type === "session.started"
				? {
						sessionId: ctx.session.id,
						status: "RUNNING",
						startedAt: new Date(),
					}
				: {}),
		},
		select: { nextEventSequence: true },
	});

	await db.agentRunEvent.createMany({
		data: [
			{
				id: eventId,
				runId,
				sequence: run.nextEventSequence,
				type,
				data: data as Prisma.InputJsonValue,
				emittedAt,
			},
		],
		skipDuplicates: true,
	});

	if (type === "step.completed") {
		const usage = recordOf(data).usage;
		const values = recordOf(usage);
		await db.agentRun.update({
			where: { id: runId },
			data: {
				...(numberOf(values.inputTokens) !== null
					? { inputTokens: { increment: numberOf(values.inputTokens) ?? 0 } }
					: {}),
				...(numberOf(values.outputTokens) !== null
					? { outputTokens: { increment: numberOf(values.outputTokens) ?? 0 } }
					: {}),
				...(numberOf(values.costUsd) !== null
					? { costUsd: { increment: numberOf(values.costUsd) ?? 0 } }
					: {}),
			},
		});
	}

	if (type === "message.completed") {
		const message = recordOf(data).message;
		if (typeof message === "string" && message.trim()) {
			await db.agentRun.update({
				where: { id: runId },
				data: { summary: message.slice(0, 1000) },
			});
		}
	}
}

function recordOf(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function numberOf(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}
