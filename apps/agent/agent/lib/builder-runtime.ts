import { db, type Prisma } from "@crm/db";
import { readAgentModel } from "@crm/db/settings";

const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";

export type BuilderResource = {
	kind: "integration" | "company" | "contact" | "deal";
	id: string;
	label: string;
};

export type DraftTrigger = {
	type: "MANUAL" | "SCHEDULE";
	name: string;
	summary: string;
	nextRunAt?: string | null;
	intervalMinutes?: number | null;
};

export type DraftAction = {
	type: "crm.activity.create" | "run.summary";
	provider: "crm";
	summary: string;
};

export type DraftAgentInput = {
	name: string;
	description: string;
	instructions: string;
	trigger: DraftTrigger;
	resources: BuilderResource[];
	actions: DraftAction[];
	access: string[];
};

export async function builderContext(conversationId: string, userId: string) {
	const conversation = await db.agentConversation.findFirst({
		where: { id: conversationId, userId, kind: "BUILDER" },
		select: {
			id: true,
			title: true,
			agent: {
				select: {
					id: true,
					name: true,
					description: true,
					status: true,
					versions: {
						orderBy: { number: "desc" },
						take: 1,
						select: {
							id: true,
							number: true,
							status: true,
							manifest: true,
							instructions: true,
						},
					},
				},
			},
			submissions: {
				orderBy: { createdAt: "asc" },
				select: { id: true, message: true, createdAt: true },
			},
		},
	});

	if (!conversation)
		throw new Error("This builder conversation is unavailable.");

	const resources = uniqueResources(
		conversation.submissions.flatMap((submission) =>
			resourcesOf(submission.message),
		),
	);

	return {
		conversation: {
			id: conversation.id,
			title: conversation.title,
		},
		availableConnections: await connectionStatus(userId),
		resources: await describeResources(resources),
		existingDraft: conversation.agent,
		now: new Date().toISOString(),
	};
}

export async function saveBuilderDraft(
	conversationId: string,
	userId: string,
	input: DraftAgentInput,
) {
	const conversation = await db.agentConversation.findFirst({
		where: { id: conversationId, userId, kind: "BUILDER" },
		select: { id: true, agentId: true },
	});

	if (!conversation)
		throw new Error("This builder conversation is unavailable.");

	const validation = await validateDraft(userId, input);
	if (!validation.valid) {
		return {
			saved: false as const,
			issues: validation.issues,
			availableConnections: validation.connections,
		};
	}

	const model = await readAgentModel(db);
	const now = new Date();
	const nextRunAt = scheduleDate(input.trigger, now);
	const manifest = {
		kind: "crm-team-agent",
		trigger: {
			type: input.trigger.type,
			name: input.trigger.name,
			summary: input.trigger.summary,
			config:
				input.trigger.type === "SCHEDULE"
					? {
							intervalMinutes: input.trigger.intervalMinutes,
							nextRunAt: nextRunAt?.toISOString(),
						}
					: {},
		},
		dataScope: {
			summary: scopeSummary(input.resources),
			resources: input.resources,
		},
		actions: input.actions,
		access: input.access,
	};
	const sandboxPolicy = {
		backend: "vercel-sandbox",
		networkPolicy: "deny-all",
		credentials: "app-runtime-only",
	};

	return db.$transaction(async (tx) => {
		let agentId = conversation.agentId;
		let created = false;

		if (!agentId) {
			const agent = await tx.agentDefinition.create({
				data: {
					name: input.name,
					description: input.description,
					createdById: userId,
				},
				select: { id: true },
			});
			agentId = agent.id;
			created = true;

			await tx.agentConversation.update({
				where: { id: conversationId },
				data: { agentId, title: input.name },
			});
		} else {
			await tx.agentDefinition.update({
				where: { id: agentId },
				data: { name: input.name, description: input.description },
			});
		}

		const latest = await tx.agentVersion.findFirst({
			where: { agentId },
			orderBy: { number: "desc" },
			select: { number: true },
		});
		const number = (latest?.number ?? 0) + 1;
		const version = await tx.agentVersion.create({
			data: {
				agentId,
				number,
				status: "READY",
				instructions: input.instructions,
				manifest: manifest as Prisma.InputJsonValue,
				modelId: model.id,
				sandboxPolicy,
				validation: {
					status: "passed",
					checkedAt: now.toISOString(),
					capabilities: validation.capabilities,
				},
				sourceConversationId: conversationId,
				createdById: userId,
			},
			select: { id: true, number: true, status: true },
		});

		await tx.agentTrigger.create({
			data: {
				agentId,
				versionId: version.id,
				type: input.trigger.type,
				name: input.trigger.name,
				config: manifest.trigger.config as Prisma.InputJsonValue,
				createdById: userId,
				nextRunAt,
			},
		});

		if (created) {
			await tx.agentAuditEvent.create({
				data: {
					agentId,
					actorUserId: userId,
					actorType: "USER",
					actorId: userId,
					type: "agent.created",
					summary: "Created a draft agent from a private builder chat",
					requestId: `builder:${conversationId}`,
				},
			});
		}

		await tx.agentAuditEvent.create({
			data: {
				agentId,
				versionId: version.id,
				actorUserId: userId,
				actorType: "USER",
				actorId: userId,
				type: "version.created",
				summary: `Prepared version ${number} for review`,
				requestId: version.id,
				after: { status: "READY", validation: "passed" },
			},
		});

		return {
			saved: true as const,
			agentId,
			versionId: version.id,
			versionNumber: version.number,
			status: version.status,
		};
	});
}

async function validateDraft(userId: string, input: DraftAgentInput) {
	const connections = await connectionStatus(userId);
	const issues: string[] = [];
	const capabilities = new Set(["crm.read", "crm.activity.create"]);

	for (const resource of input.resources) {
		if (resource.kind !== "integration") continue;
		if (resource.id === "google:gmail" && !connections.gmail) {
			issues.push("Gmail is not connected for the chat owner.");
		}
		if (resource.id === "google:calendar" && !connections.calendar) {
			issues.push("Google Calendar is not connected for the chat owner.");
		}
		if (!resource.id.startsWith("google:")) {
			issues.push(`${resource.label} is not an available integration.`);
		}
		capabilities.add(`${resource.id}.read`);
	}

	const missingRecords = await missingResourceIds(input.resources);
	issues.push(
		...missingRecords.map(
			(resource) => `${resource.label} is no longer in the CRM.`,
		),
	);

	if (input.trigger.type === "SCHEDULE") {
		const next = Date.parse(input.trigger.nextRunAt ?? "");
		if (!Number.isFinite(next) || next <= Date.now()) {
			issues.push("A scheduled agent needs a future next run time.");
		}
		if (
			!input.trigger.intervalMinutes ||
			input.trigger.intervalMinutes < 1 ||
			input.trigger.intervalMinutes > 525_600
		) {
			issues.push(
				"A scheduled agent needs a recurrence from 1 minute to 1 year.",
			);
		}
	}

	return {
		valid: issues.length === 0,
		issues,
		connections,
		capabilities: [...capabilities],
	};
}

async function connectionStatus(userId: string) {
	const accounts = await db.account.findMany({
		where: { userId, providerId: "google" },
		select: { scope: true },
	});
	const scopes = new Set(
		accounts.flatMap((account) => (account.scope ?? "").split(/[,\s]+/)),
	);

	return {
		gmail: scopes.has(GMAIL_SCOPE),
		calendar: scopes.has(CALENDAR_SCOPE),
		crm: true,
	};
}

async function describeResources(resources: BuilderResource[]) {
	return Promise.all(
		resources.map(async (resource) => {
			if (resource.kind === "company") {
				const row = await db.company.findUnique({
					where: { id: resource.id },
					select: { id: true, name: true, domain: true, industry: true },
				});
				return { ...resource, record: row };
			}
			if (resource.kind === "contact") {
				const row = await db.contact.findUnique({
					where: { id: resource.id },
					select: {
						id: true,
						firstName: true,
						lastName: true,
						email: true,
						title: true,
						company: { select: { id: true, name: true } },
					},
				});
				return { ...resource, record: row };
			}
			if (resource.kind === "deal") {
				const row = await db.deal.findUnique({
					where: { id: resource.id },
					select: {
						id: true,
						name: true,
						stage: true,
						amount: true,
						currency: true,
						company: { select: { id: true, name: true } },
					},
				});
				return {
					...resource,
					record: row
						? {
								...row,
								amount: row.amount === null ? null : Number(row.amount),
							}
						: null,
				};
			}
			return { ...resource, record: null };
		}),
	);
}

async function missingResourceIds(resources: BuilderResource[]) {
	const described = await describeResources(
		resources.filter((resource) => resource.kind !== "integration"),
	);
	return described.filter((resource) => !resource.record);
}

function resourcesOf(value: unknown): BuilderResource[] {
	if (!value || typeof value !== "object" || !("resources" in value)) return [];
	const resources = (value as { resources?: unknown }).resources;
	if (!Array.isArray(resources)) return [];

	return resources.flatMap((resource) => {
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
		return [resource as BuilderResource];
	});
}

function uniqueResources(resources: BuilderResource[]): BuilderResource[] {
	return [
		...new Map(
			resources.map((resource) => [
				`${resource.kind}:${resource.id}`,
				resource,
			]),
		).values(),
	];
}

function scheduleDate(trigger: DraftTrigger, now: Date): Date | null {
	if (trigger.type !== "SCHEDULE") return null;
	const parsed = new Date(trigger.nextRunAt ?? "");
	return parsed > now ? parsed : null;
}

function scopeSummary(resources: BuilderResource[]): string {
	if (resources.length === 0)
		return "Workspace CRM records required by the run";
	return resources.map((resource) => resource.label).join(" · ");
}
