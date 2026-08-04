import { z } from "zod";

export const conversationListInput = z.object({
	contactId: z.string().optional(),
	companyId: z.string().optional(),
	dealId: z.string().optional(),
});

export type ConversationListInput = z.infer<typeof conversationListInput>;

export const conversationSaveInput = z.object({
	contactId: z.string().optional(),
	companyId: z.string().optional(),
	dealId: z.string().optional(),
	sessionId: z.string().min(1),
	continuationToken: z.string().nullish(),
	streamIndex: z.number().int().min(0).optional(),
	title: z.string().trim().max(120).optional(),
	messageCount: z.number().int().min(0).optional(),
});

export type ConversationSaveInput = z.infer<typeof conversationSaveInput>;

export const conversationIdInput = z.object({ id: z.string() });

export const conversationEventsInput = z.object({
	id: z.string(),
	limit: z.number().int().min(1).max(5000).default(2000),
});

export type ConversationEventsInput = z.infer<typeof conversationEventsInput>;

export const builderResource = z.object({
	kind: z.enum(["integration", "company", "contact", "deal"]),
	id: z.string().trim().min(1).max(160),
	label: z.string().trim().min(1).max(120),
});

export const builderAttachment = z.object({
	name: z.string().trim().min(1).max(180),
	type: z.string().trim().min(1).max(120),
	size: z.number().int().min(1).max(2_000_000),
	contentBase64: z.string().min(1).max(2_800_000),
});

export const builderConversationCreateInput = z.object({
	clientRequestId: z.uuid(),
	commandType: z.enum(["CHAT", "CREATE_AGENT"]).default("CHAT"),
	message: z.string().trim().min(1).max(20_000),
	resources: z.array(builderResource).max(20).default([]),
	attachments: z.array(builderAttachment).max(5).default([]),
});

export type BuilderConversationCreateInput = z.infer<
	typeof builderConversationCreateInput
>;

export const builderConversationSubmitInput =
	builderConversationCreateInput.extend({
		id: z.string().min(1),
	});

export type BuilderConversationSubmitInput = z.infer<
	typeof builderConversationSubmitInput
>;

export const sharedConversationInput = z.object({
	token: z.string().trim().min(32).max(256),
});

export const builderResourceSearchInput = z.object({
	q: z.string().trim().max(120).default(""),
});

export const builderResponseRatingInput = z.object({
	id: z.string().min(1),
	messageId: z.string().trim().min(1).max(240),
	rating: z.enum(["UP", "DOWN"]).nullable(),
});
