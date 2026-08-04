import { createHash, randomBytes } from "node:crypto";
import { WORKSPACE_ID } from "@crm/auth";
import type { Db } from "@crm/db";
import {
	ForbiddenException,
	Injectable,
	NotFoundException,
} from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";

@Injectable()
export class ConversationSharingService {
	constructor(@InjectDatabase() private readonly db: Db) {}

	async status(conversationId: string, userId: string) {
		await this.ownedBuilder(conversationId, userId);

		const share = await this.db.agentConversationShare.findFirst({
			where: {
				conversationId,
				revokedAt: null,
				OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
			},
			select: { createdAt: true, expiresAt: true },
		});

		return {
			enabled: share !== null,
			createdAt: share?.createdAt.toISOString() ?? null,
			expiresAt: share?.expiresAt?.toISOString() ?? null,
		};
	}

	async create(conversationId: string, userId: string) {
		await this.ownedBuilder(conversationId, userId);

		const token = randomBytes(32).toString("base64url");
		const tokenHash = this.hash(token);

		await this.db.$transaction(async (tx) => {
			await tx.agentConversationShare.updateMany({
				where: { conversationId, revokedAt: null },
				data: { revokedAt: new Date() },
			});

			await tx.agentConversationShare.create({
				data: { conversationId, createdById: userId, tokenHash },
			});
		});

		return { token };
	}

	async revoke(conversationId: string, userId: string) {
		await this.ownedBuilder(conversationId, userId);

		await this.db.agentConversationShare.updateMany({
			where: { conversationId, revokedAt: null },
			data: { revokedAt: new Date() },
		});

		return { id: conversationId };
	}

	async resolve(token: string, userId: string) {
		await this.assertWorkspaceMember(userId);

		const share = await this.db.agentConversationShare.findFirst({
			where: {
				tokenHash: this.hash(token),
				revokedAt: null,
				OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
				conversation: { kind: "BUILDER" },
			},
			select: {
				conversation: {
					select: {
						id: true,
						title: true,
						sessionId: true,
						lastMessageAt: true,
						user: { select: { name: true } },
						agent: { select: { id: true, name: true, status: true } },
						submissions: {
							orderBy: { createdAt: "asc" },
							select: {
								id: true,
								commandType: true,
								message: true,
								status: true,
								errorMessage: true,
								createdAt: true,
							},
						},
					},
				},
			},
		});

		if (!share) {
			throw new NotFoundException("That shared conversation is unavailable.");
		}

		const { conversation } = share;
		const events = conversation.sessionId
			? await this.db.agentEvent.findMany({
					where: { sessionId: conversation.sessionId },
					orderBy: { emittedAt: "asc" },
					take: 5000,
					select: { id: true, type: true, data: true, emittedAt: true },
				})
			: [];

		return {
			id: conversation.id,
			title: conversation.title,
			ownerName: conversation.user.name,
			lastMessageAt: conversation.lastMessageAt.toISOString(),
			agent: conversation.agent,
			submissions: conversation.submissions.map((submission) => ({
				...submission,
				createdAt: submission.createdAt.toISOString(),
			})),
			events: events.map((event) => ({
				type: event.type,
				data: event.data,
				meta: { id: event.id, at: event.emittedAt.toISOString() },
			})),
		};
	}

	private async ownedBuilder(conversationId: string, userId: string) {
		const conversation = await this.db.agentConversation.findFirst({
			where: { id: conversationId, userId, kind: "BUILDER" },
			select: { id: true },
		});

		if (!conversation) {
			throw new NotFoundException(
				`No builder conversation with id ${conversationId}.`,
			);
		}

		return conversation;
	}

	private async assertWorkspaceMember(userId: string): Promise<void> {
		const member = await this.db.member.findUnique({
			where: {
				organizationId_userId: { organizationId: WORKSPACE_ID, userId },
			},
			select: { id: true },
		});

		if (!member) {
			throw new ForbiddenException(
				"This conversation belongs to another team.",
			);
		}
	}

	private hash(token: string): string {
		return createHash("sha256").update(token).digest("hex");
	}
}
