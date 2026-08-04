"use client";

import Add from "@carbon/icons-react/es/Add";
import ArrowRight from "@carbon/icons-react/es/ArrowRight";
import Checkmark from "@carbon/icons-react/es/Checkmark";
import CheckmarkFilled from "@carbon/icons-react/es/CheckmarkFilled";
import Copy from "@carbon/icons-react/es/Copy";
import Play from "@carbon/icons-react/es/Play";
import Renew from "@carbon/icons-react/es/Renew";
import ThumbsDown from "@carbon/icons-react/es/ThumbsDown";
import ThumbsUp from "@carbon/icons-react/es/ThumbsUp";
import WarningAlt from "@carbon/icons-react/es/WarningAlt";
import {
	AsyncButtonContent,
	useAsyncAction,
} from "@crm/ui/components/async-action";
import { Button } from "@crm/ui/components/button";
import { Icon } from "@crm/ui/components/icon";
import { Markdown } from "@crm/ui/components/markdown";
import { Skeleton } from "@crm/ui/components/skeleton";
import { TaskSteps } from "@crm/ui/components/task-steps";
import { cn } from "@crm/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { MessageStreamEvent } from "eve/client";
import { useEveAgent } from "eve/react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { hasCreateAgentCommand } from "@/lib/agent-builder";
import {
	type AgentTurnFailure,
	latestTurnFailure,
	toTranscript,
} from "@/lib/agent-transcript";
import { useTRPC } from "@/lib/trpc/client";
import type { RouterOutputs } from "@/lib/trpc/types";
import { useWorkspaceUrl } from "@/lib/use-workspace-url";
import { AgentComposer, type BuilderPrompt } from "./agent-composer";
import { ShareChatDialog } from "./share-chat-dialog";

type Conversation = RouterOutputs["conversations"]["builderById"];
type SharedConversation = RouterOutputs["conversations"]["shared"];

type DraftVersion = {
	id: string;
	status: string;
	manifest: unknown;
};

type BuilderSubmission = {
	id: string;
	commandType: "CHAT" | "CREATE_AGENT";
	message: unknown;
	status: string;
	errorMessage: string | null;
};

export function AgentBuilderChat({
	conversationId,
}: {
	conversationId: string;
}) {
	const trpc = useTRPC();
	const workspaceUrl = useWorkspaceUrl();
	const queryClient = useQueryClient();
	const conversation = useQuery({
		...trpc.conversations.builderById.queryOptions({ id: conversationId }),
		refetchInterval: (query) => {
			const data = query.state.data;
			return data?.agent?.status === "LIVE" ? 10_000 : 2500;
		},
	});
	const shared = useQuery({
		...trpc.conversations.shared.queryOptions({ token: conversationId }),
		enabled: conversation.isError,
		refetchInterval: 10_000,
	});
	const events = useQuery({
		...trpc.conversations.events.queryOptions({
			id: conversationId,
			limit: 5000,
		}),
		enabled: Boolean(conversation.data?.sessionId),
		refetchInterval: 2500,
	});
	const submit = useMutation(
		trpc.conversations.submitBuilder.mutationOptions({
			onSuccess: async () => {
				await Promise.all([
					queryClient.invalidateQueries({
						queryKey: trpc.conversations.builderById.pathKey(),
					}),
					queryClient.invalidateQueries({
						queryKey: trpc.conversations.builderList.pathKey(),
					}),
				]);
			},
			onError: (error) => toast.error(error.message),
		}),
	);
	const markRead = useMutation(
		trpc.conversations.markRead.mutationOptions({
			onSuccess: () =>
				queryClient.invalidateQueries({
					queryKey: trpc.conversations.builderList.pathKey(),
				}),
		}),
	);

	if (conversation.isPending || (conversation.isError && shared.isPending)) {
		return <ChatLoading />;
	}

	if (conversation.isError) {
		if (shared.data) {
			return <SharedAgentChat conversation={shared.data} />;
		}

		return (
			<main className="flex flex-1 items-center justify-center p-8">
				<div className="max-w-md text-center">
					<h1 className="font-medium text-lg">Chat unavailable</h1>
					<p className="mt-2 text-muted-foreground text-sm">
						{conversation.error.message}
					</p>
					<Button asChild variant="outline" className="mt-5">
						<Link href={workspaceUrl("/agents")}>Start a new chat</Link>
					</Button>
				</div>
			</main>
		);
	}

	const data = conversation.data;
	const submissions = data.submissions as BuilderSubmission[];
	const failure = latestTurnFailure(events.data ?? []);
	const creatingAgent = hasCreateAgentCommand(submissions);
	const working = isWorking(data, creatingAgent) && !failure;
	const retryPrompt = retryPromptOf(submissions.at(-1));
	const send = (prompt: BuilderPrompt) => {
		submit.mutate({
			id: conversationId,
			clientRequestId: crypto.randomUUID(),
			...prompt,
		});
	};

	return (
		<main
			className="flex min-h-0 flex-1 flex-col"
			onPointerEnter={() => {
				if (
					data.lastAssistantAt &&
					(!data.lastReadAt ||
						new Date(data.lastAssistantAt) > new Date(data.lastReadAt)) &&
					!markRead.isPending
				) {
					markRead.mutate({ id: conversationId });
				}
			}}
		>
			<ChatHeader
				conversation={data}
				working={working}
				creatingAgent={creatingAgent}
			/>

			<div className="min-h-0 flex-1 overflow-y-auto">
				<div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6 sm:gap-5 sm:px-5 sm:py-9">
					{submissions.map((submission) => (
						<UserSubmission
							key={submission.id}
							message={submissionText(submission.message)}
							failed={submission.status === "FAILED"}
							error={submission.errorMessage}
						/>
					))}

					{events.data && events.data.length > 0 ? (
						<AssistantTranscript
							key={`${events.data.length}:${events.data.at(-1)?.meta.id}`}
							conversation={data}
							events={events.data as unknown as MessageStreamEvent[]}
						/>
					) : null}

					{working && creatingAgent ? (
						<BuildingAgentCard
							conversationId={conversationId}
							sessionId={data.sessionId}
							eventCount={events.data?.length ?? 0}
						/>
					) : null}

					{!working &&
					failure &&
					creatingAgent &&
					!reviewable(data) &&
					data.agent?.status !== "LIVE" ? (
						<BuilderFailureCard
							failure={failure}
							creatingAgent
							retrying={submit.isPending}
							onRetry={retryPrompt ? () => send(retryPrompt) : null}
						/>
					) : null}

					{!working && failure && !creatingAgent ? (
						<BuilderFailureCard
							failure={failure}
							creatingAgent={false}
							retrying={submit.isPending}
							onRetry={retryPrompt ? () => send(retryPrompt) : null}
						/>
					) : null}

					{creatingAgent && reviewable(data) ? (
						<ReviewAgentCard conversation={data} />
					) : null}

					{creatingAgent && data.agent?.status === "LIVE" ? (
						<DeployedAgentCard
							conversation={data}
							onFollowUp={(message) =>
								send({
									commandType: "CHAT",
									message,
									resources: [],
									attachments: [],
								})
							}
						/>
					) : null}
				</div>
			</div>

			<div className="shrink-0 border-t px-4 py-3 sm:px-5">
				<div className="mx-auto w-full max-w-3xl">
					<AgentComposer
						mode="chat"
						pending={submit.isPending}
						disabled={working}
						onSubmit={send}
					/>
				</div>
			</div>
		</main>
	);
}

function SharedAgentChat({
	conversation,
}: {
	conversation: SharedConversation;
}) {
	const submissions = conversation.submissions as BuilderSubmission[];
	const events = conversation.events as unknown as MessageStreamEvent[];

	return (
		<main className="flex min-h-0 flex-1 flex-col">
			<header className="flex h-12 shrink-0 items-center gap-3 border-b px-5">
				<h1 className="min-w-0 flex-1 truncate font-medium text-sm">
					{conversation.agent?.name ?? conversation.title ?? "Agent builder"}
				</h1>
				<span className="text-muted-foreground text-xs">Read-only</span>
			</header>

			<div className="min-h-0 flex-1 overflow-y-auto">
				<div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6 sm:gap-5 sm:px-5 sm:py-9">
					<div className="rounded-lg border bg-card px-4 py-3 text-sm">
						<p className="font-medium">Shared by {conversation.ownerName}</p>
						<p className="mt-1 text-muted-foreground text-xs">
							You can read this builder chat, but only its owner can continue or
							change it.
						</p>
					</div>

					{submissions.map((submission) => (
						<UserSubmission
							key={submission.id}
							message={submissionText(submission.message)}
							failed={submission.status === "FAILED"}
							error={submission.errorMessage}
						/>
					))}

					{events.length > 0 ? (
						<SharedAssistantTranscript events={events} />
					) : null}
				</div>
			</div>
		</main>
	);
}

function SharedAssistantTranscript({
	events,
}: {
	events: MessageStreamEvent[];
}) {
	const agent = useEveAgent({ initialEvents: events });
	const messages = toTranscript(agent.data.messages).filter(
		(message) => !message.mine,
	);

	return messages.map((message) => {
		const markdown = message.items
			.filter((item) => item.kind === "said")
			.map((item) => item.text)
			.join("\n\n");

		return markdown ? (
			<div
				key={message.id}
				className="flex w-full min-w-0 max-w-[640px] flex-col gap-2"
			>
				<Markdown className="wrap-break-word text-sm leading-5">
					{markdown}
				</Markdown>
				<Button
					variant="ghost"
					size="icon-xs"
					aria-label="Copy response as Markdown"
					onClick={() => {
						void navigator.clipboard.writeText(markdown);
						toast.success("Response copied as Markdown.");
					}}
				>
					<Icon icon={Copy} />
				</Button>
			</div>
		) : null;
	});
}

function ChatHeader({
	conversation,
	working,
	creatingAgent,
}: {
	conversation: Conversation;
	working: boolean;
	creatingAgent: boolean;
}) {
	const workspaceUrl = useWorkspaceUrl();
	const title =
		(creatingAgent ? conversation.agent?.name : null) ??
		conversation.title ??
		"Agent chat";

	return (
		<header className="flex h-12 shrink-0 items-center gap-2 border-b px-4 sm:gap-2.5 sm:pr-4 sm:pl-5">
			<div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
				<h1 className="truncate font-medium text-sm">{title}</h1>
				<span className="hidden shrink-0 text-muted-foreground text-xs sm:inline">
					Private
				</span>
				{working ? (
					<span className="flex shrink-0 items-center gap-2 text-muted-foreground text-xs">
						<Icon
							icon={Renew}
							className="size-3.5 animate-spin text-ring"
							motion="none"
						/>
						<span className="sr-only">Working in background</span>
						<span aria-hidden="true" className="hidden sm:inline">
							Working in background
						</span>
					</span>
				) : null}
			</div>
			<Button asChild variant="ghost" size="icon-sm">
				<Link href={workspaceUrl("/agents")} aria-label="Start a new chat">
					<Icon icon={Add} />
				</Link>
			</Button>
			<ShareChatDialog conversationId={conversation.id} title={title} />
		</header>
	);
}

function UserSubmission({
	message,
	failed,
	error,
}: {
	message: string;
	failed: boolean;
	error: string | null;
}) {
	return (
		<div className="flex min-w-0 w-full justify-end">
			<div className="w-fit min-w-0 max-w-full rounded-md bg-muted px-3 py-2.5 text-sm leading-5 sm:max-w-[620px] sm:px-3.5 sm:py-3">
				<p className="wrap-break-word">{message}</p>
				{failed ? (
					<p className="mt-2 text-destructive text-xs">
						{error ?? "This message could not be sent."}
					</p>
				) : null}
			</div>
		</div>
	);
}

function AssistantTranscript({
	conversation,
	events,
}: {
	conversation: Conversation;
	events: MessageStreamEvent[];
}) {
	const agent = useEveAgent({ initialEvents: events });
	const messages = toTranscript(agent.data.messages).filter(
		(message) => !message.mine,
	);

	return (
		<>
			{messages.map((message) => {
				const markdown = message.items
					.filter((item) => item.kind === "said")
					.map((item) => item.text)
					.join("\n\n");

				return (
					<div
						key={message.id}
						className="flex w-full min-w-0 max-w-[640px] flex-col gap-2"
					>
						{markdown ? (
							<Markdown className="wrap-break-word text-sm leading-5">
								{markdown}
							</Markdown>
						) : null}
						{message.items
							.filter((item) => item.kind === "did")
							.map((item) => (
								<div
									key={item.id}
									className="flex min-w-0 items-start gap-2 text-muted-foreground text-xs"
								>
									{item.pending ? (
										<Icon
											icon={Renew}
											className="size-3.5 animate-spin"
											motion="none"
										/>
									) : (
										<Icon icon={Checkmark} className="size-3.5 text-ring" />
									)}
									<span className="min-w-0 wrap-break-word">{item.label}</span>
								</div>
							))}
						{markdown ? (
							<ResponseActions
								conversation={conversation}
								messageId={message.id}
								markdown={markdown}
							/>
						) : null}
					</div>
				);
			})}
		</>
	);
}

function ResponseActions({
	conversation,
	messageId,
	markdown,
}: {
	conversation: Conversation;
	messageId: string;
	markdown: string;
}) {
	const trpc = useTRPC();
	const initial = conversation.feedback.find(
		(item) => item.messageId === messageId,
	)?.rating;
	const [rating, setRating] = useState<"UP" | "DOWN" | null>(initial ?? null);
	const rate = useMutation(
		trpc.conversations.rateBuilderResponse.mutationOptions({
			onError: (error) => toast.error(error.message),
		}),
	);

	const choose = (next: "UP" | "DOWN") => {
		const value = rating === next ? null : next;
		setRating(value);
		rate.mutate({ id: conversation.id, messageId, rating: value });
	};

	return (
		<div className="flex h-7 items-center gap-0.5">
			<Button
				variant="ghost"
				size="icon-xs"
				aria-label="Copy response as Markdown"
				onClick={() => {
					void navigator.clipboard.writeText(markdown);
					toast.success("Response copied as Markdown.");
				}}
			>
				<Icon icon={Copy} />
			</Button>
			<Button
				variant="ghost"
				size="icon-xs"
				aria-label="Rate response helpful"
				aria-pressed={rating === "UP"}
				className={cn(rating === "UP" && "bg-muted text-foreground")}
				onClick={() => choose("UP")}
			>
				<Icon icon={ThumbsUp} />
			</Button>
			<Button
				variant="ghost"
				size="icon-xs"
				aria-label="Rate response not helpful"
				aria-pressed={rating === "DOWN"}
				className={cn(rating === "DOWN" && "bg-muted text-foreground")}
				onClick={() => choose("DOWN")}
			>
				<Icon icon={ThumbsDown} />
			</Button>
		</div>
	);
}

function BuildingAgentCard({
	conversationId,
	sessionId,
	eventCount,
}: {
	conversationId: string;
	sessionId: string | null;
	eventCount: number;
}) {
	const completed = Math.min(
		3,
		sessionId ? Math.max(1, Math.floor(eventCount / 4)) : 0,
	);
	const steps = [
		{
			id: "data-model",
			label: "Read the CRM data model",
			meta: "Companies · contacts · deals",
		},
		{
			id: "records",
			label: "Resolved the requested records",
			meta: "Scoped to this workspace",
		},
		{
			id: "integrations",
			label: "Checked connected integrations",
			meta: "Only available connections",
		},
		{
			id: "sandbox",
			label: "Preparing the agent",
			meta: "Isolated Vercel Sandbox",
		},
	] as const;
	const stop = useAsyncAction({
		action: async () => {
			if (!sessionId) return;
			const response = await fetch(`/eve/v1/session/${sessionId}/cancel`, {
				method: "POST",
				headers: { "x-crm-builder-conversation": conversationId },
			});
			if (!response.ok) throw new Error(await response.text());
		},
		onSuccess: () => toast.success("Stop requested."),
		onError: () => toast.error("The agent could not be stopped. Try again."),
	});

	return (
		<div className="flex flex-col gap-4">
			<p className="max-w-[640px] text-pretty text-sm leading-5">
				I’m turning this into a team agent. I’ll inspect the CRM scope, verify
				the requested connections, then prepare a safe deployment for review.
			</p>
			<div className="overflow-hidden rounded-lg border bg-card">
				<div className="flex flex-wrap items-center gap-3 border-b px-4 py-3 sm:gap-4 sm:px-5 sm:py-4">
					<Icon
						icon={Renew}
						className="size-3.5 animate-spin text-ring"
						motion="none"
					/>
					<span className="min-w-0 flex-1 font-medium text-sm">
						Building the agent
					</span>
					<span className="font-mono text-muted-foreground text-xs">
						{completed} of 4
					</span>
					<Button
						variant="outline"
						size="sm"
						disabled={!sessionId || stop.pending}
						aria-busy={stop.pending}
						onClick={() => stop.run()}
					>
						<AsyncButtonContent
							status={stop.status}
							pendingLabel="Stopping"
							successLabel="Stopping"
							errorLabel="Try again"
						>
							Stop
						</AsyncButtonContent>
					</Button>
				</div>
				<TaskSteps
					steps={[...steps]}
					current={completed}
					label="Agent creation"
				/>
				<p className="border-t px-4 py-3 text-muted-foreground text-xs sm:px-5">
					This chat keeps running if you leave. You’ll see a dot in the sidebar
					when there’s a response.
				</p>
			</div>
		</div>
	);
}

function BuilderFailureCard({
	failure,
	creatingAgent,
	retrying,
	onRetry,
}: {
	failure: AgentTurnFailure;
	creatingAgent: boolean;
	retrying: boolean;
	onRetry: (() => void) | null;
}) {
	const message =
		failure.kind === "rate-limit"
			? "Vercel AI Gateway rate-limited this model before it could start. Try again in a moment or add AI Gateway credits in Vercel."
			: failure.kind === "restricted"
				? "This model requires paid AI Gateway credits. Add credits in Vercel, then try again."
				: failure.kind === "credits"
					? "Vercel AI Gateway has no available credits. Add credits in Vercel, then try again."
					: "The builder could not finish this request. Try again.";

	return (
		<div
			role="alert"
			className="flex flex-col items-stretch gap-3 rounded-lg border border-destructive/30 bg-card px-4 py-3 sm:flex-row sm:items-start"
		>
			<div className="flex min-w-0 flex-1 items-start gap-3">
				<Icon icon={WarningAlt} className="mt-0.5 size-4 text-destructive" />
				<div className="min-w-0 flex-1">
					<p className="font-medium text-sm">
						{creatingAgent ? "Agent creation stopped" : "Response stopped"}
					</p>
					<p className="mt-0.5 text-pretty text-muted-foreground text-xs leading-5">
						{message}
					</p>
				</div>
			</div>
			{onRetry ? (
				<Button
					variant="outline"
					size="sm"
					disabled={retrying}
					aria-busy={retrying}
					onClick={onRetry}
				>
					<AsyncButtonContent
						status={retrying ? "pending" : "idle"}
						pendingLabel="Retrying"
					>
						Try again
					</AsyncButtonContent>
				</Button>
			) : null}
		</div>
	);
}

function ReviewAgentCard({ conversation }: { conversation: Conversation }) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const version = conversation.createdVersions[0] as DraftVersion | undefined;
	const agent = conversation.agent;
	const manifest = manifestOf(version?.manifest);
	const deploy = useMutation(
		trpc.agents.deploy.mutationOptions({
			onSuccess: async () => {
				await Promise.all([
					queryClient.invalidateQueries({
						queryKey: trpc.conversations.builderById.pathKey(),
					}),
					queryClient.invalidateQueries({
						queryKey: trpc.conversations.builderList.pathKey(),
					}),
					queryClient.invalidateQueries({
						queryKey: trpc.agents.list.pathKey(),
					}),
				]);
				toast.success("Agent created for the team.");
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	if (!version || !agent) return null;

	return (
		<div className="flex flex-col gap-5">
			<p className="max-w-[640px] text-pretty text-sm leading-5">
				I’ve drafted the agent. Review its scope before I create and deploy it
				for the team.
			</p>
			<div className="overflow-hidden rounded-lg border bg-card">
				<div className="border-b px-4 py-3 sm:px-5 sm:py-4">
					<h2 className="wrap-break-word font-medium text-sm">{agent.name}</h2>
					<p className="mt-0.5 wrap-break-word text-pretty text-muted-foreground text-xs">
						{agent.description ?? "A durable agent for your team."}
					</p>
				</div>
				<ReviewRow label="Trigger" value={manifest.trigger} />
				<ReviewRow label="Looks at" value={manifest.looksAt} />
				<ReviewRow label="Action" value={manifest.action} />
				<ReviewRow label="Access" value={manifest.access} />
				<p className="border-t px-4 py-2 text-pretty text-muted-foreground text-xs sm:px-5">
					Runs in an isolated Vercel Sandbox. Integration credentials are
					brokered at runtime and never enter the workspace.
				</p>
				<div className="flex min-h-14 flex-col items-stretch gap-3 border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-5">
					<p className="text-pretty text-muted-foreground text-xs">
						Creating this makes the agent available to everyone in Comp AI.
					</p>
					<div className="flex flex-wrap justify-end gap-1 sm:shrink-0">
						<Button
							variant="ghost"
							onClick={() =>
								document
									.querySelector<HTMLTextAreaElement>(
										'textarea[aria-label="Message the agent builder"]',
									)
									?.focus()
							}
						>
							Change details
						</Button>
						<Button
							disabled={deploy.isPending}
							aria-busy={deploy.isPending}
							onClick={() =>
								deploy.mutate({
									id: agent.id,
									versionId: version.id,
									clientRequestId: crypto.randomUUID(),
								})
							}
						>
							<AsyncButtonContent
								status={
									deploy.isPending
										? "pending"
										: deploy.isError
											? "error"
											: deploy.isSuccess
												? "success"
												: "idle"
								}
								pendingLabel="Creating"
								successLabel="Created"
								errorLabel="Try again"
							>
								Create agent
							</AsyncButtonContent>
						</Button>
					</div>
				</div>
			</div>
		</div>
	);
}

function ReviewRow({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex min-h-8 flex-col items-start gap-0.5 border-b px-4 py-2 last:border-b-0 sm:flex-row sm:items-center sm:gap-4 sm:px-5 sm:py-1.5">
			<span className="text-muted-foreground text-xs sm:w-[104px] sm:shrink-0">
				{label}
			</span>
			<span className="min-w-0 flex-1 wrap-break-word font-medium text-sm">
				{value}
			</span>
		</div>
	);
}

function DeployedAgentCard({
	conversation,
	onFollowUp,
}: {
	conversation: Conversation;
	onFollowUp: (message: string) => void;
}) {
	const trpc = useTRPC();
	const workspaceUrl = useWorkspaceUrl();
	const queryClient = useQueryClient();
	const agent = conversation.agent;
	const run = useMutation(
		trpc.agents.runNow.mutationOptions({
			onSuccess: async () => {
				await queryClient.invalidateQueries({
					queryKey: trpc.agents.history.pathKey(),
				});
				toast.success("Agent run queued.");
			},
			onError: (error) => toast.error(error.message),
		}),
	);
	const runAction = useAsyncAction({
		action: () =>
			run.mutateAsync({
				id: agent?.id ?? "",
				clientRequestId: crypto.randomUUID(),
			}),
	});

	if (!agent) return null;
	const nextRun = agent.triggers.find((trigger) => trigger.enabled)?.nextRunAt;

	return (
		<div className="flex flex-col gap-[18px]">
			<div className="space-y-1">
				<p className="text-sm leading-5">{agent.name} is live.</p>
				<p className="text-muted-foreground text-sm leading-5">
					I created the Eve agent, applied its bounded CRM and integration
					access, and scheduled its first run.
				</p>
			</div>
			<div className="overflow-hidden rounded-lg border bg-card">
				<div className="flex flex-col items-start gap-3 border-b px-4 py-3 sm:flex-row sm:items-center sm:gap-4 sm:px-5 sm:py-4">
					<div className="flex min-w-0 flex-1 flex-col gap-0.5">
						<div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
							<Icon icon={CheckmarkFilled} className="size-3.5 text-ring" />
							<h2 className="min-w-0 wrap-break-word font-medium text-sm">
								{agent.name}
							</h2>
							<span className="text-muted-foreground text-xs">Live</span>
						</div>
						<p className="wrap-break-word text-muted-foreground text-xs">
							Team agent · created by {agent.createdBy.name}
						</p>
					</div>
					<Button asChild variant="outline" size="sm">
						<Link href={workspaceUrl(`/agents/${agent.id}`)}>Open agent</Link>
					</Button>
				</div>
				<div className="grid border-b sm:grid-cols-3">
					<DeployedStat
						label="Next run"
						value={nextRun ? formatNextRun(nextRun) : "Manual only"}
					/>
					<DeployedStat label="Execution" value="Vercel · Eve · Sandbox" />
					<DeployedStat label="Available to" value="Everyone in Comp AI" last />
				</div>
				<div className="flex min-h-12 flex-col items-start gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-5 sm:py-2">
					<p className="text-pretty text-muted-foreground text-xs">
						The chat remains private. The agent is now team-owned.
					</p>
					<Button
						variant="outline"
						size="sm"
						disabled={runAction.pending}
						aria-busy={runAction.pending}
						onClick={() => runAction.run()}
					>
						<AsyncButtonContent
							status={runAction.status}
							pendingLabel="Queueing"
							successLabel="Queued"
							errorLabel="Try again"
						>
							<Icon icon={Play} data-icon="inline-start" />
							Run now
						</AsyncButtonContent>
					</Button>
				</div>
			</div>

			<div>
				<p className="flex h-7 items-center text-muted-foreground text-sm">
					Suggested follow-ups
				</p>
				{["Run it once now", "Add another teammate to the notification"].map(
					(suggestion) => (
						<button
							key={suggestion}
							type="button"
							onClick={() => onFollowUp(suggestion)}
							className="flex w-full items-center gap-3 border-t py-2.5 text-left outline-none hover:bg-muted/50 focus-visible:bg-muted/50"
						>
							<span className="min-w-0 flex-1 wrap-break-word text-sm">
								{suggestion}
							</span>
							<Icon
								icon={ArrowRight}
								className="size-4 text-muted-foreground"
							/>
						</button>
					),
				)}
			</div>
		</div>
	);
}

function DeployedStat({
	label,
	value,
	last = false,
}: {
	label: string;
	value: string;
	last?: boolean;
}) {
	return (
		<div
			className={cn(
				"flex min-w-0 flex-col justify-center gap-1 px-4 py-3 sm:px-5",
				!last && "border-b sm:border-r sm:border-b-0",
			)}
		>
			<span className="text-muted-foreground text-xs">{label}</span>
			<span className="min-w-0 wrap-break-word font-medium text-sm sm:truncate">
				{value}
			</span>
		</div>
	);
}

function ChatLoading() {
	return (
		<main className="flex min-h-0 flex-1 flex-col" aria-busy="true">
			<header className="flex h-12 shrink-0 items-center border-b px-5">
				<Skeleton className="h-4 w-40" />
			</header>
			<div className="min-h-0 flex-1 overflow-hidden">
				<div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-6 sm:px-5 sm:py-9">
					<Skeleton className="ml-auto h-16 w-2/3 max-w-[520px]" />
					<div className="flex max-w-[640px] flex-col gap-2">
						<Skeleton className="h-4 w-full" />
						<Skeleton className="h-4 w-11/12" />
						<Skeleton className="h-4 w-8/12" />
					</div>
				</div>
			</div>
			<span role="status" className="sr-only">
				Loading chat
			</span>
		</main>
	);
}

function submissionText(message: unknown): string {
	if (!message || typeof message !== "object" || !("text" in message)) {
		return "Message unavailable";
	}
	return typeof message.text === "string"
		? message.text
		: "Message unavailable";
}

function retryPromptOf(
	submission: BuilderSubmission | undefined,
): BuilderPrompt | null {
	if (!submission) return null;
	const row = recordOf(submission.message);
	if (typeof row.text !== "string" || !row.text.trim()) return null;

	return {
		commandType: submission.commandType,
		message: row.text,
		resources: Array.isArray(row.resources)
			? (row.resources as BuilderPrompt["resources"])
			: [],
		attachments: Array.isArray(row.attachments)
			? (row.attachments as BuilderPrompt["attachments"])
			: [],
	};
}

function isWorking(
	conversation: Conversation,
	creatingAgent: boolean,
): boolean {
	if (
		(creatingAgent && conversation.agent?.status === "LIVE") ||
		(creatingAgent && conversation.createdVersions[0]?.status === "READY")
	) {
		return false;
	}

	return (
		conversation.submissions.some((submission) =>
			["PENDING", "SENDING"].includes(submission.status),
		) || Boolean(conversation.sessionId && !conversation.continuationToken)
	);
}

function reviewable(conversation: Conversation): boolean {
	return (
		conversation.agent?.status !== "LIVE" &&
		conversation.createdVersions[0]?.status === "READY"
	);
}

function manifestOf(value: unknown) {
	const manifest = recordOf(value);
	const trigger = recordOf(manifest.trigger);
	const dataScope = recordOf(manifest.dataScope);
	const actions = Array.isArray(manifest.actions)
		? manifest.actions.map(recordOf)
		: [];
	const access = Array.isArray(manifest.access)
		? manifest.access.filter((item): item is string => typeof item === "string")
		: [];

	return {
		trigger: textOf(trigger.summary, "Manual or configured schedule"),
		looksAt: textOf(dataScope.summary, "CRM records in the approved scope"),
		action: textOf(actions[0]?.summary, "Perform the requested team action"),
		access: access.length > 0 ? access.join(" · ") : "Bounded CRM read access",
	};
}

function recordOf(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function textOf(value: unknown, fallback: string): string {
	return typeof value === "string" && value.trim() ? value : fallback;
}

function formatNextRun(value: string): string {
	return new Intl.DateTimeFormat(undefined, {
		weekday: "short",
		hour: "numeric",
		minute: "2-digit",
		timeZoneName: "short",
	}).format(new Date(value));
}
