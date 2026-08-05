import { WORKSPACE_ID } from "@crm/auth";
import type { Db, Prisma } from "@crm/db";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import {
	BadRequestException,
	Inject,
	Injectable,
	Logger,
	NotFoundException,
	Optional,
} from "@nestjs/common";
import type { Cache } from "cache-manager";
import { AgentTriggerService } from "../agent/agent-trigger.service";
import { InjectDatabase } from "../database/database.constants";
import type {
	BuilderConversationCreateInput,
	BuilderConversationSubmitInput,
	ConversationEventsInput,
	ConversationListInput,
	ConversationSaveInput,
} from "./conversations.contracts";

export interface ConversationSummary {
	id: string;
	sessionId: string;
	continuationToken: string | null;
	streamIndex: number;
	title: string | null;
	messageCount: number;
	lastMessageAt: string;
}

export interface BuilderConversationSummary {
	id: string;
	sessionId: string | null;
	continuationToken: string | null;
	streamIndex: number;
	title: string | null;
	messageCount: number;
	lastMessageAt: string;
	lastAssistantAt: string | null;
	unread: boolean;
	state: "working" | "unread" | "deployed" | "idle";
	agent: {
		id: string;
		name: string;
		status: string;
	} | null;
}

const LIST_TTL_MS = 10 * 60_000;

const listKey = (userId: string, recordId: string) =>
	`agent:conversations:${userId}:${recordId}`;

@Injectable()
export class ConversationsService {
	private readonly logger = new Logger(ConversationsService.name);

	constructor(
		@InjectDatabase() private readonly db: Db,
		@Inject(CACHE_MANAGER) private readonly cache: Cache,
		@Optional() private readonly agent?: AgentTriggerService,
	) {}

	async list(
		input: ConversationListInput,
		userId: string,
	): Promise<ConversationSummary[]> {
		const recordId = this.recordId(input);
		const key = listKey(userId, recordId);

		const cached = await this.cache.get<ConversationSummary[]>(key);
		if (cached) return cached;

		this.logger.debug({ message: "Conversation list cache miss", recordId });

		const rows = await this.db.agentConversation.findMany({
			where: {
				userId,
				...(input.contactId ? { contactId: input.contactId } : {}),
				...(input.companyId ? { companyId: input.companyId } : {}),
				...(input.dealId ? { dealId: input.dealId } : {}),
			},
			orderBy: { lastMessageAt: "desc" },
			take: 20,
			select: {
				id: true,
				sessionId: true,
				continuationToken: true,
				streamIndex: true,
				title: true,
				messageCount: true,
				lastMessageAt: true,
			},
		});

		const summaries = rows.flatMap((row) =>
			row.sessionId
				? [
						{
							...row,
							sessionId: row.sessionId,
							lastMessageAt: row.lastMessageAt.toISOString(),
						},
					]
				: [],
		);

		await this.cache.set(key, summaries, LIST_TTL_MS);

		return summaries;
	}

	async listBuilder(userId: string): Promise<BuilderConversationSummary[]> {
		const rows = await this.db.agentConversation.findMany({
			where: { userId, kind: "BUILDER" },
			orderBy: { lastMessageAt: "desc" },
			take: 50,
			select: {
				id: true,
				sessionId: true,
				continuationToken: true,
				streamIndex: true,
				title: true,
				messageCount: true,
				lastMessageAt: true,
				lastAssistantAt: true,
				lastReadAt: true,
				agent: { select: { id: true, name: true, status: true } },
				_count: {
					select: {
						submissions: { where: { commandType: "CREATE_AGENT" } },
					},
				},
				submissions: {
					where: { status: { in: ["PENDING", "SENDING"] } },
					select: { id: true },
					take: 1,
				},
			},
		});

		return rows.map((row) => {
			const unread = Boolean(
				row.lastAssistantAt &&
					(!row.lastReadAt || row.lastAssistantAt > row.lastReadAt),
			);
			const working =
				row.submissions.length > 0 ||
				Boolean(row.sessionId && !row.continuationToken);

			return {
				id: row.id,
				sessionId: row.sessionId,
				continuationToken: row.continuationToken,
				streamIndex: row.streamIndex,
				title: row.title,
				messageCount: row.messageCount,
				lastMessageAt: row.lastMessageAt.toISOString(),
				lastAssistantAt: row.lastAssistantAt?.toISOString() ?? null,
				unread,
				state:
					row._count.submissions > 0 && row.agent?.status === "LIVE"
						? "deployed"
						: working
							? "working"
							: unread
								? "unread"
								: "idle",
				agent: row.agent,
			};
		});
	}

	async builderResources(q: string, userId: string) {
		const member = await this.db.member.findUnique({
			where: {
				organizationId_userId: { organizationId: WORKSPACE_ID, userId },
			},
			select: { id: true },
		});

		if (!member) {
			throw new NotFoundException("No workspace membership was found.");
		}

		const search = q.trim();
		const contains = search
			? { contains: search, mode: "insensitive" as const }
			: undefined;

		const [companies, contacts, deals] = await Promise.all([
			this.db.company.findMany({
				where: contains ? { name: contains } : undefined,
				orderBy: { lastActivityAt: { sort: "desc", nulls: "last" } },
				take: 6,
				select: { id: true, name: true, domain: true, logoUrl: true },
			}),
			this.db.contact.findMany({
				where: contains
					? {
							OR: [
								{ firstName: contains },
								{ lastName: contains },
								{ email: contains },
							],
						}
					: undefined,
				orderBy: { lastActivityAt: { sort: "desc", nulls: "last" } },
				take: 6,
				select: {
					id: true,
					firstName: true,
					lastName: true,
					email: true,
					imageUrl: true,
					company: { select: { name: true } },
				},
			}),
			this.db.deal.findMany({
				where: contains ? { name: contains } : undefined,
				orderBy: { lastActivityAt: { sort: "desc", nulls: "last" } },
				take: 6,
				select: {
					id: true,
					name: true,
					company: { select: { name: true, logoUrl: true } },
				},
			}),
		]);

		return [
			...companies.map((company) => ({
				kind: "company" as const,
				id: company.id,
				label: company.name,
				detail: company.domain,
				imageUrl: company.logoUrl,
			})),
			...contacts.map((contact) => ({
				kind: "contact" as const,
				id: contact.id,
				label: [contact.firstName, contact.lastName].filter(Boolean).join(" "),
				detail: contact.company?.name ?? contact.email,
				imageUrl: contact.imageUrl,
			})),
			...deals.map((deal) => ({
				kind: "deal" as const,
				id: deal.id,
				label: deal.name,
				detail: deal.company.name,
				imageUrl: deal.company.logoUrl,
			})),
		];
	}

	async builderById(id: string, userId: string) {
		const row = await this.db.agentConversation.findFirst({
			where: { id, userId, kind: "BUILDER" },
			select: {
				id: true,
				sessionId: true,
				continuationToken: true,
				streamIndex: true,
				title: true,
				messageCount: true,
				lastMessageAt: true,
				lastAssistantAt: true,
				lastReadAt: true,
				agent: {
					select: {
						id: true,
						name: true,
						description: true,
						status: true,
						createdBy: { select: { id: true, name: true } },
						currentVersion: {
							select: {
								id: true,
								number: true,
								status: true,
								manifest: true,
								modelId: true,
								sandboxPolicy: true,
								deployedAt: true,
							},
						},
						triggers: {
							orderBy: { createdAt: "asc" },
							select: {
								id: true,
								type: true,
								name: true,
								config: true,
								enabled: true,
								nextRunAt: true,
							},
						},
					},
				},
				createdVersions: {
					orderBy: { number: "desc" },
					take: 1,
					select: {
						id: true,
						number: true,
						status: true,
						instructions: true,
						manifest: true,
						modelId: true,
						sandboxPolicy: true,
						validation: true,
						createdAt: true,
					},
				},
				builderArtifacts: {
					orderBy: [{ createdAt: "desc" }, { revision: "desc" }],
					take: 100,
					select: {
						id: true,
						versionId: true,
						path: true,
						language: true,
						content: true,
						previousContent: true,
						revision: true,
						status: true,
						createdAt: true,
					},
				},
				feedback: {
					where: { userId },
					select: { messageId: true, rating: true },
				},
				submissions: {
					orderBy: { createdAt: "asc" },
					select: {
						id: true,
						clientRequestId: true,
						commandType: true,
						message: true,
						status: true,
						errorCode: true,
						errorMessage: true,
						createdAt: true,
						sentAt: true,
						acceptedAt: true,
					},
				},
			},
		});

		if (!row) {
			throw new NotFoundException(`No builder conversation with id ${id}.`);
		}

		return {
			...row,
			lastMessageAt: row.lastMessageAt.toISOString(),
			lastAssistantAt: row.lastAssistantAt?.toISOString() ?? null,
			lastReadAt: row.lastReadAt?.toISOString() ?? null,
			agent: row.agent
				? {
						...row.agent,
						currentVersion: row.agent.currentVersion
							? {
									...row.agent.currentVersion,
									deployedAt:
										row.agent.currentVersion.deployedAt?.toISOString() ?? null,
								}
							: null,
						triggers: row.agent.triggers.map((trigger) => ({
							...trigger,
							nextRunAt: trigger.nextRunAt?.toISOString() ?? null,
						})),
					}
				: null,
			createdVersions: row.createdVersions.map((version) => ({
				...version,
				createdAt: version.createdAt.toISOString(),
			})),
			builderArtifacts: row.builderArtifacts.map((artifact) => ({
				...artifact,
				createdAt: artifact.createdAt.toISOString(),
			})),
			submissions: row.submissions.map((submission) => ({
				...submission,
				createdAt: submission.createdAt.toISOString(),
				sentAt: submission.sentAt?.toISOString() ?? null,
				acceptedAt: submission.acceptedAt?.toISOString() ?? null,
			})),
		};
	}

	async createBuilder(
		input: BuilderConversationCreateInput,
		userId: string,
	): Promise<{ id: string }> {
		const existing = await this.db.agentConversationSubmission.findUnique({
			where: { clientRequestId: input.clientRequestId },
			select: {
				conversation: { select: { id: true, userId: true, kind: true } },
			},
		});

		if (existing) {
			if (
				existing.conversation.userId !== userId ||
				existing.conversation.kind !== "BUILDER"
			) {
				throw new BadRequestException("That request has already been used.");
			}

			return { id: existing.conversation.id };
		}

		const now = new Date();
		const conversation = await this.db.agentConversation.create({
			data: {
				kind: "BUILDER",
				userId,
				title: this.titleFrom(input.message),
				lastReadAt: now,
				lastMessageAt: now,
				submissions: {
					create: {
						submittedById: userId,
						clientRequestId: input.clientRequestId,
						commandType: input.commandType,
						message: this.builderMessage(input),
					},
				},
			},
			select: { id: true },
		});

		this.agent?.builderConversationQueued();

		return conversation;
	}

	async submitBuilder(
		input: BuilderConversationSubmitInput,
		userId: string,
	): Promise<{ id: string }> {
		const existing = await this.db.agentConversationSubmission.findUnique({
			where: { clientRequestId: input.clientRequestId },
			select: { id: true, conversationId: true, submittedById: true },
		});

		if (existing) {
			if (
				existing.conversationId !== input.id ||
				existing.submittedById !== userId
			) {
				throw new BadRequestException("That request has already been used.");
			}

			return { id: existing.id };
		}

		const conversation = await this.db.agentConversation.findFirst({
			where: { id: input.id, userId, kind: "BUILDER" },
			select: { id: true },
		});

		if (!conversation) {
			throw new NotFoundException(
				`No builder conversation with id ${input.id}.`,
			);
		}

		const submission = await this.db.$transaction(async (tx) => {
			const created = await tx.agentConversationSubmission.create({
				data: {
					conversationId: input.id,
					submittedById: userId,
					clientRequestId: input.clientRequestId,
					commandType: input.commandType,
					message: this.builderMessage(input),
				},
				select: { id: true },
			});

			await tx.agentConversation.update({
				where: { id: input.id },
				data: { lastMessageAt: new Date(), lastReadAt: new Date() },
			});

			return created;
		});

		this.agent?.builderConversationQueued();

		return submission;
	}

	async markRead(id: string, userId: string): Promise<{ id: string }> {
		const updated = await this.db.agentConversation.updateMany({
			where: { id, userId, kind: "BUILDER" },
			data: { lastReadAt: new Date() },
		});

		if (updated.count === 0) {
			throw new NotFoundException(`No builder conversation with id ${id}.`);
		}

		return { id };
	}

	async rateBuilderResponse(
		input: { id: string; messageId: string; rating: "UP" | "DOWN" | null },
		userId: string,
	) {
		const conversation = await this.db.agentConversation.findFirst({
			where: { id: input.id, userId, kind: "BUILDER" },
			select: { id: true },
		});

		if (!conversation) {
			throw new NotFoundException(
				`No builder conversation with id ${input.id}.`,
			);
		}

		const key = {
			conversationId_userId_messageId: {
				conversationId: input.id,
				userId,
				messageId: input.messageId,
			},
		};

		if (!input.rating) {
			await this.db.agentConversationFeedback.deleteMany({
				where: key.conversationId_userId_messageId,
			});
			return { id: input.messageId, rating: null };
		}

		await this.db.agentConversationFeedback.upsert({
			where: key,
			create: {
				conversationId: input.id,
				userId,
				messageId: input.messageId,
				rating: input.rating,
			},
			update: { rating: input.rating },
		});

		return { id: input.messageId, rating: input.rating };
	}

	async save(
		input: ConversationSaveInput,
		userId: string,
	): Promise<{ id: string }> {
		const recordId = this.recordId(input);

		const conversation = await this.db.agentConversation.upsert({
			where: { sessionId: input.sessionId },
			create: {
				sessionId: input.sessionId,
				continuationToken: input.continuationToken ?? null,
				streamIndex: input.streamIndex ?? 0,
				title: input.title?.slice(0, 120) ?? null,
				messageCount: input.messageCount ?? 0,
				userId,
				contactId: input.contactId ?? null,
				companyId: input.companyId ?? null,
				dealId: input.dealId ?? null,
			},
			update: {
				continuationToken: input.continuationToken ?? null,
				streamIndex: input.streamIndex ?? 0,
				messageCount: input.messageCount ?? 0,
				lastMessageAt: new Date(),
			},
			select: { id: true, userId: true },
		});

		if (conversation.userId !== userId) {
			throw new BadRequestException(
				"That conversation belongs to someone else.",
			);
		}

		await this.cache.del(listKey(userId, recordId));

		return { id: conversation.id };
	}

	async events(input: ConversationEventsInput, userId: string) {
		const conversation = await this.db.agentConversation.findUnique({
			where: { id: input.id },
			select: { sessionId: true, userId: true },
		});

		if (!conversation || conversation.userId !== userId) {
			throw new NotFoundException(`No conversation with id ${input.id}.`);
		}

		if (!conversation.sessionId) return [];

		const events = await this.db.agentEvent.findMany({
			where: { sessionId: conversation.sessionId },
			orderBy: { emittedAt: "asc" },
			take: input.limit,
			select: { id: true, type: true, data: true, emittedAt: true },
		});

		return events.map((event) => ({
			type: event.type,
			data: event.data,
			meta: { id: event.id, at: event.emittedAt.toISOString() },
		}));
	}

	async remove(id: string, userId: string): Promise<{ id: string }> {
		const conversation = await this.db.agentConversation.findUnique({
			where: { id },
			select: {
				id: true,
				userId: true,
				contactId: true,
				companyId: true,
				dealId: true,
				sessionId: true,
			},
		});

		if (!conversation || conversation.userId !== userId) {
			throw new NotFoundException(`No conversation with id ${id}.`);
		}

		await this.db.$transaction(async (tx) => {
			if (conversation.sessionId) {
				await tx.agentEvent.deleteMany({
					where: { sessionId: conversation.sessionId },
				});
			}

			await tx.agentConversation.delete({ where: { id } });
		});

		const recordId =
			conversation.contactId ?? conversation.companyId ?? conversation.dealId;
		if (recordId) await this.cache.del(listKey(userId, recordId));

		this.logger.log({ message: "Conversation removed", conversationId: id });

		return { id };
	}

	private recordId(input: {
		contactId?: string;
		companyId?: string;
		dealId?: string;
	}): string {
		const recordId = input.contactId ?? input.companyId ?? input.dealId;

		if (!recordId) {
			throw new BadRequestException(
				"A conversation belongs to a contact, a company or a deal.",
			);
		}

		return recordId;
	}

	private builderMessage(input: {
		message: string;
		resources: BuilderConversationCreateInput["resources"];
		attachments: BuilderConversationCreateInput["attachments"];
	}): Prisma.InputJsonValue {
		return {
			text: input.message,
			resources: input.resources,
			attachments: input.attachments,
		};
	}

	private titleFrom(message: string): string {
		const normalized = message.replace(/\s+/g, " ").trim();
		return normalized.length <= 80
			? normalized
			: `${normalized.slice(0, 77).trimEnd()}…`;
	}
}
