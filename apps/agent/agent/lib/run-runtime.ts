import { ActivityType, db, type Prisma } from "@crm/db";
import { readCompanyHistory, readDealHistory } from "./accounts";
import { readCrmHistory } from "./crm";
import { searchCrm } from "./lookup";

type RunResource = {
	kind: "integration" | "company" | "contact" | "deal";
	id: string;
	label: string;
};

export async function runContext(runId: string) {
	const run = await db.agentRun.findUnique({
		where: { id: runId },
		select: {
			id: true,
			status: true,
			triggerType: true,
			input: true,
			agent: { select: { id: true, name: true, description: true } },
			version: {
				select: {
					id: true,
					number: true,
					instructions: true,
					manifest: true,
					modelId: true,
					sandboxPolicy: true,
				},
			},
			trigger: { select: { id: true, name: true, type: true, config: true } },
		},
	});

	if (!run) throw new Error("This agent run is unavailable.");

	return {
		...run,
		allowedResources: manifestResources(run.version.manifest),
		allowedActions: manifestActions(run.version.manifest),
		now: new Date().toISOString(),
	};
}

export async function queryRunCrm(
	runId: string,
	input: {
		query: string;
		kinds?: ("contact" | "company" | "deal")[];
		limit: number;
	},
) {
	const run = await runContext(runId);
	const scoped = run.allowedResources.filter(
		(resource) => resource.kind !== "integration",
	);
	const result = await searchCrm(input.query, input);
	if (scoped.length === 0) return result;

	const allowed = new Set(scoped.map((resource) => resource.id));
	return {
		...result,
		contacts: result.contacts.filter((row) => allowed.has(row.id)),
		companies: result.companies.filter((row) => allowed.has(row.id)),
		deals: result.deals.filter((row) => allowed.has(row.id)),
		total: [...result.contacts, ...result.companies, ...result.deals].filter(
			(row) => allowed.has(row.id),
		).length,
	};
}

export async function readRunRecord(
	runId: string,
	input: {
		kind: "contact" | "company" | "deal";
		id: string;
	},
) {
	const run = await runContext(runId);
	assertResourceAllowed(run.allowedResources, input);

	if (input.kind === "contact")
		return readCrmHistory(input.id, { threads: 10 });
	if (input.kind === "company") {
		return readCompanyHistory(input.id, { threads: 10, people: 50 });
	}
	return readDealHistory(input.id, { threads: 10 });
}

export async function createRunActivity(
	runId: string,
	callId: string,
	input: {
		type: "NOTE" | "TASK";
		targetKind: "company" | "contact" | "deal";
		targetId: string;
		subject?: string | null;
		body?: string | null;
		dueAt?: string | null;
	},
) {
	const run = await db.agentRun.findUnique({
		where: { id: runId },
		select: {
			id: true,
			agentId: true,
			initiatedById: true,
			agent: { select: { createdById: true } },
			version: { select: { manifest: true } },
		},
	});
	if (!run) throw new Error("This agent run is unavailable.");

	const target = await targetRecord(input.targetKind, input.targetId);
	const idempotencyKey = `${runId}:${callId}`;
	const existing = await db.agentAction.findUnique({
		where: { idempotencyKey },
		select: {
			id: true,
			status: true,
			externalId: true,
			errorMessage: true,
		},
	});
	if (existing?.status === "SUCCEEDED") {
		return {
			actionId: existing.id,
			activityId: existing.externalId,
			replayed: true,
		};
	}

	const action =
		existing ??
		(await db.agentAction.create({
			data: {
				agentId: run.agentId,
				runId,
				type: "crm.activity.create",
				provider: "crm",
				targetType: input.targetKind,
				targetId: input.targetId,
				targetLabel: target?.label ?? input.targetId,
				summary:
					input.subject?.trim() ||
					`Create a ${input.type.toLowerCase()} on ${target?.label ?? input.targetId}`,
				metadata: { activityType: input.type },
				idempotencyKey,
			},
			select: {
				id: true,
				status: true,
				externalId: true,
				errorMessage: true,
			},
		}));

	try {
		assertActionAllowed(run.version.manifest, "crm.activity.create");
		assertResourceAllowed(manifestResources(run.version.manifest), {
			kind: input.targetKind,
			id: input.targetId,
		});
		if (!target) throw new Error("The requested CRM target no longer exists.");
		if (input.type === "TASK" && !input.subject?.trim()) {
			throw new Error("A CRM task needs a subject.");
		}

		await db.agentAction.update({
			where: { id: action.id },
			data: {
				status: "RUNNING",
				startedAt: new Date(),
				attemptCount: { increment: 1 },
				errorCode: null,
				errorMessage: null,
			},
		});

		const activityId = `agent-action-${action.id}`;
		const now = new Date();
		const dueAt = input.dueAt ? new Date(input.dueAt) : null;
		if (dueAt && Number.isNaN(dueAt.getTime()))
			throw new Error("The due date is invalid.");

		await db.$transaction(async (tx) => {
			await tx.activity.upsert({
				where: { id: activityId },
				create: {
					id: activityId,
					type: input.type === "TASK" ? ActivityType.TASK : ActivityType.NOTE,
					subject: input.subject?.trim() || null,
					body: input.body?.trim() || null,
					occurredAt: now,
					dueAt: input.type === "TASK" ? dueAt : null,
					companyId: target.companyId,
					contactId: target.contactId,
					dealId: target.dealId,
					createdById: run.initiatedById ?? run.agent.createdById,
					meta: {
						source: "agent",
						agentId: run.agentId,
						runId,
						actionId: action.id,
					},
				},
				update: {},
			});

			if (target.companyId) {
				await tx.company.update({
					where: { id: target.companyId },
					data: { lastActivityAt: now },
				});
			}
			if (target.contactId) {
				await tx.contact.update({
					where: { id: target.contactId },
					data: { lastActivityAt: now },
				});
			}
			if (target.dealId) {
				await tx.deal.update({
					where: { id: target.dealId },
					data: { lastActivityAt: now },
				});
			}

			await tx.agentAction.update({
				where: { id: action.id },
				data: {
					status: "SUCCEEDED",
					externalId: activityId,
					completedAt: now,
				},
			});
		});

		return { actionId: action.id, activityId, replayed: false };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		await db.agentAction.update({
			where: { id: action.id },
			data: {
				status: "FAILED",
				errorCode: "ACTION_REJECTED",
				errorMessage: message,
				completedAt: new Date(),
			},
		});
		throw error;
	}
}

export async function finishRun(
	runId: string,
	input: { summary: string; result?: Record<string, unknown> | null },
) {
	const run = await db.agentRun.update({
		where: { id: runId },
		data: {
			status: "SUCCEEDED",
			summary: input.summary,
			result: (input.result ?? {}) as Prisma.InputJsonValue,
			finishedAt: new Date(),
		},
		select: { id: true, agentId: true, versionId: true },
	});

	await db.agentAuditEvent.upsert({
		where: {
			agentId_type_requestId: {
				agentId: run.agentId,
				type: "run.completed",
				requestId: run.id,
			},
		},
		create: {
			agentId: run.agentId,
			versionId: run.versionId,
			actorType: "AGENT",
			actorId: run.id,
			type: "run.completed",
			summary: input.summary,
			requestId: run.id,
		},
		update: { summary: input.summary },
	});

	return { id: run.id, status: "SUCCEEDED" as const };
}

function manifestResources(value: unknown): RunResource[] {
	const manifest = recordOf(value);
	const scope = recordOf(manifest.dataScope);
	if (!Array.isArray(scope.resources)) return [];

	return scope.resources.flatMap((resource) => {
		if (!resource || typeof resource !== "object") return [];
		const row = resource as Record<string, unknown>;
		if (
			!["integration", "company", "contact", "deal"].includes(
				String(row.kind),
			) ||
			typeof row.id !== "string" ||
			typeof row.label !== "string"
		) {
			return [];
		}
		return [resource as RunResource];
	});
}

function manifestActions(value: unknown) {
	const actions = recordOf(value).actions;
	return Array.isArray(actions) ? actions.map(recordOf) : [];
}

function assertActionAllowed(manifest: unknown, type: string) {
	if (!manifestActions(manifest).some((action) => action.type === type)) {
		throw new Error(`Agent version does not allow ${type}.`);
	}
}

function assertResourceAllowed(
	resources: RunResource[],
	input: { kind: "contact" | "company" | "deal"; id: string },
) {
	const records = resources.filter(
		(resource) => resource.kind !== "integration",
	);
	if (records.length === 0) return;
	if (
		records.some(
			(resource) => resource.kind === input.kind && resource.id === input.id,
		)
	) {
		return;
	}
	throw new Error(
		"That CRM record is outside this agent version's approved scope.",
	);
}

async function targetRecord(kind: "company" | "contact" | "deal", id: string) {
	if (kind === "company") {
		const company = await db.company.findUnique({
			where: { id },
			select: { id: true, name: true },
		});
		return company
			? {
					label: company.name,
					companyId: company.id,
					contactId: null,
					dealId: null,
				}
			: null;
	}
	if (kind === "contact") {
		const contact = await db.contact.findUnique({
			where: { id },
			select: { id: true, firstName: true, lastName: true, companyId: true },
		});
		return contact
			? {
					label: [contact.firstName, contact.lastName]
						.filter(Boolean)
						.join(" "),
					companyId: contact.companyId,
					contactId: contact.id,
					dealId: null,
				}
			: null;
	}

	const deal = await db.deal.findUnique({
		where: { id },
		select: { id: true, name: true, companyId: true },
	});
	return deal
		? {
				label: deal.name,
				companyId: deal.companyId,
				contactId: null,
				dealId: deal.id,
			}
		: null;
}

function recordOf(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}
