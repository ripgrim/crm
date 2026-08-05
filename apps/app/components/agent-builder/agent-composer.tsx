"use client";

import Add from "@carbon/icons-react/es/Add";
import Application from "@carbon/icons-react/es/Application";
import ArrowUp from "@carbon/icons-react/es/ArrowUp";
import AttachmentIcon from "@carbon/icons-react/es/Attachment";
import Building from "@carbon/icons-react/es/Building";
import Calendar from "@carbon/icons-react/es/Calendar";
import Email from "@carbon/icons-react/es/Email";
import Partnership from "@carbon/icons-react/es/Partnership";
import Search from "@carbon/icons-react/es/Search";
import User from "@carbon/icons-react/es/User";
import { AsyncButtonContent } from "@crm/ui/components/async-action";
import { Button } from "@crm/ui/components/button";
import { type CarbonIcon, Icon } from "@crm/ui/components/icon";
import { Input } from "@crm/ui/components/input";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@crm/ui/components/popover";
import { Skeleton } from "@crm/ui/components/skeleton";
import { SkeletonSwap } from "@crm/ui/components/skeleton-swap";
import { cn } from "@crm/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "sonner";
import {
	type BuilderCommandType,
	builderCommandType,
	consumeBuilderCommand,
} from "@/lib/agent-builder";
import { useTRPC } from "@/lib/trpc/client";
import {
	ChatAttachmentChip,
	type ChatChipAttachment,
	type ChatChipResource,
	ChatCommandChip,
	ChatReferenceChip,
	ChatReferenceIdentity,
} from "./chat-chips";

export type BuilderResource = ChatChipResource;

export type BuilderAttachment = ChatChipAttachment & {
	contentBase64: string;
};

export type BuilderPrompt = {
	commandType: BuilderCommandType;
	message: string;
	resources: BuilderResource[];
	attachments: BuilderAttachment[];
};

const CREATE_AGENT_COMMAND = {
	commandType: "CREATE_AGENT" as const,
	invocation: "/Create agent",
	label: "Create agent",
	description: "Build a durable team automation",
};

export function AgentComposer({
	mode,
	disabled = false,
	pending = false,
	initialPrompt = "",
	onSubmit,
}: {
	mode: "home" | "chat";
	disabled?: boolean;
	pending?: boolean;
	initialPrompt?: string;
	onSubmit: (prompt: BuilderPrompt) => void;
}) {
	const trpc = useTRPC();
	const fileInput = useRef<HTMLInputElement>(null);
	const initialCommand = consumeBuilderCommand(initialPrompt);
	const [draft, setDraft] = useState(initialCommand?.body ?? initialPrompt);
	const [command, setCommand] = useState<typeof CREATE_AGENT_COMMAND | null>(
		initialCommand ? CREATE_AGENT_COMMAND : null,
	);
	const [commandOpen, setCommandOpen] = useState(false);
	const [resourceQuery, setResourceQuery] = useState("");
	const [resources, setResources] = useState<BuilderResource[]>([]);
	const [attachments, setAttachments] = useState<BuilderAttachment[]>([]);
	const resourceResults = useQuery(
		trpc.conversations.builderResources.queryOptions({ q: resourceQuery }),
	);
	const google = useQuery(trpc.google.status.queryOptions());
	const canSend = draft.trim().length > 0 && !disabled && !pending;

	const submit = () => {
		if (!canSend) return;
		const body = draft.trim();
		const message = command ? `${command.invocation} ${body}` : body;
		onSubmit({
			commandType: command?.commandType ?? builderCommandType(message),
			message,
			resources,
			attachments,
		});
		setDraft("");
		setCommand(null);
		setCommandOpen(false);
		setResources([]);
		setAttachments([]);
	};

	const addResource = (resource: BuilderResource) => {
		setResources((current) =>
			current.some(
				(item) => item.kind === resource.kind && item.id === resource.id,
			)
				? current
				: [...current, resource],
		);
	};

	const connectedGoogle = (google.data?.sources ?? []).filter(
		(source) => source.connected,
	);
	const updateDraft = (value: string) => {
		const parsed = consumeBuilderCommand(value);
		if (parsed) {
			setCommand(CREATE_AGENT_COMMAND);
			setDraft(parsed.body);
			setCommandOpen(false);
			return;
		}

		setDraft(value);
		setCommandOpen(!command && value.trimStart().startsWith("/"));
	};

	return (
		<div
			className={cn(
				"flex w-full flex-col justify-between rounded-lg border bg-muted p-[11px] shadow-[inset_0_1px_1px_rgb(0_0_0/0.12)] transition-colors focus-within:border-muted-foreground/60 focus-within:ring-1 focus-within:ring-ring/40",
				mode === "home" ? "min-h-24" : "min-h-[78px]",
			)}
		>
			{command || resources.length > 0 || attachments.length > 0 ? (
				<div className="flex flex-wrap gap-1 px-1 pb-1">
					{command ? (
						<ChatCommandChip
							label={command.label}
							icon={Application}
							onRemove={() => setCommand(null)}
						/>
					) : null}
					{resources.map((resource) => (
						<ChatReferenceChip
							key={`${resource.kind}:${resource.id}`}
							resource={resource}
							icon={RESOURCE_ICONS[resource.kind]}
							onRemove={() =>
								setResources((current) =>
									current.filter(
										(item) =>
											item.kind !== resource.kind || item.id !== resource.id,
									),
								)
							}
						/>
					))}
					{attachments.map((attachment) => (
						<ChatAttachmentChip
							key={`${attachment.name}:${attachment.size}`}
							attachment={attachment}
							onRemove={() =>
								setAttachments((current) =>
									current.filter((item) => item !== attachment),
								)
							}
						/>
					))}
				</div>
			) : null}

			<textarea
				value={draft}
				onChange={(event) => updateDraft(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Enter" && !event.shiftKey) {
						event.preventDefault();
						submit();
					}
				}}
				disabled={disabled}
				rows={mode === "home" ? 2 : 1}
				placeholder={
					mode === "home"
						? "Ask about your CRM or automate a task…"
						: "Send a message"
				}
				aria-label="Message the agent builder"
				className="max-h-40 min-h-6 w-full resize-none bg-transparent px-1 text-base leading-6 outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60 sm:text-[15px]"
			/>

			<div className="flex h-7 items-center justify-between">
				<div className="flex items-center gap-0.5">
					<Popover>
						<PopoverTrigger asChild>
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label="Tag CRM records and integrations"
							>
								<Icon icon={Add} />
							</Button>
						</PopoverTrigger>
						<PopoverContent
							size="fit"
							align="start"
							side="top"
							className="w-80"
						>
							<div className="border-b p-2">
								<div className="relative">
									<Icon
										icon={Search}
										className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
									/>
									<Input
										value={resourceQuery}
										onChange={(event) => setResourceQuery(event.target.value)}
										placeholder="Search CRM records"
										className="pl-8"
									/>
								</div>
							</div>
							<div className="max-h-72 overflow-y-auto p-1">
								{connectedGoogle.map((source) => (
									<ResourceButton
										key={source.source}
										icon={source.source === "calendar" ? Calendar : Email}
										label={
											source.source === "calendar" ? "Google Calendar" : "Gmail"
										}
										detail="Connected integration"
										onSelect={() =>
											addResource({
												kind: "integration",
												id: `google:${source.source}`,
												label:
													source.source === "calendar"
														? "Google Calendar"
														: "Gmail",
												detail: "Connected integration",
												imageUrl: null,
											})
										}
									/>
								))}
								<SkeletonSwap
									loading={resourceResults.isFetching}
									label="CRM records"
									skeleton={<ResourceResultsSkeleton />}
								>
									{(resourceResults.data ?? []).map((resource) => (
										<ResourceButton
											key={`${resource.kind}:${resource.id}`}
											icon={RESOURCE_ICONS[resource.kind]}
											label={resource.label}
											detail={resource.detail ?? RESOURCE_LABELS[resource.kind]}
											imageUrl={resource.imageUrl}
											onSelect={() => addResource(resource)}
										/>
									))}
									{resourceResults.isSuccess &&
									connectedGoogle.length === 0 &&
									resourceResults.data.length === 0 ? (
										<p className="px-3 py-5 text-center text-muted-foreground text-xs">
											No matching records.
										</p>
									) : null}
								</SkeletonSwap>
							</div>
						</PopoverContent>
					</Popover>

					<input
						ref={fileInput}
						type="file"
						multiple
						className="hidden"
						onChange={(event) => {
							void addFiles(event.currentTarget.files, setAttachments);
							event.currentTarget.value = "";
						}}
					/>
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label="Attach files"
						onClick={() => fileInput.current?.click()}
					>
						<Icon icon={AttachmentIcon} />
					</Button>

					<Popover open={commandOpen} onOpenChange={setCommandOpen}>
						<PopoverTrigger asChild>
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label="Open slash commands"
								className="font-mono text-sm"
							>
								/
							</Button>
						</PopoverTrigger>
						<PopoverContent
							size="fit"
							align="start"
							side="top"
							className="w-64 p-1"
						>
							<button
								type="button"
								onClick={() => {
									setCommand(CREATE_AGENT_COMMAND);
									setDraft((current) =>
										current.trimStart().startsWith("/") ? "" : current,
									);
									setCommandOpen(false);
								}}
								className="flex w-full items-center gap-3 rounded-sm px-3 py-2 text-left outline-none hover:bg-muted focus-visible:bg-muted"
							>
								<Icon
									icon={Application}
									className="size-4 text-muted-foreground"
								/>
								<span>
									<span className="block font-medium text-xs">
										/{CREATE_AGENT_COMMAND.label}
									</span>
									<span className="block text-muted-foreground text-xs">
										{CREATE_AGENT_COMMAND.description}
									</span>
								</span>
							</button>
						</PopoverContent>
					</Popover>
				</div>

				<Button
					variant="default"
					size="icon-sm"
					disabled={!canSend}
					aria-busy={pending}
					aria-label="Send message"
					onClick={submit}
					className="rounded-full"
				>
					<AsyncButtonContent
						status={pending ? "pending" : "idle"}
						pendingLabel={<span className="sr-only">Sending</span>}
						successLabel={<span className="sr-only">Sent</span>}
						errorLabel={<span className="sr-only">Send failed</span>}
					>
						<Icon icon={ArrowUp} />
					</AsyncButtonContent>
				</Button>
			</div>
		</div>
	);
}

function ResourceResultsSkeleton() {
	return (
		<div className="flex flex-col gap-1 px-3 py-2">
			{["first", "second", "third"].map((item) => (
				<div key={item} className="flex h-10 items-center gap-3">
					<Skeleton className="size-6 shrink-0" />
					<div className="flex min-w-0 flex-1 flex-col gap-1.5">
						<Skeleton className="h-3 w-2/3" />
						<Skeleton className="h-2.5 w-1/3" />
					</div>
				</div>
			))}
		</div>
	);
}

const RESOURCE_ICONS: Record<BuilderResource["kind"], CarbonIcon> = {
	integration: Application,
	company: Building,
	contact: User,
	deal: Partnership,
};

const RESOURCE_LABELS: Record<BuilderResource["kind"], string> = {
	integration: "Integration",
	company: "Company",
	contact: "Contact",
	deal: "Deal",
};

function ResourceButton({
	icon,
	label,
	detail,
	imageUrl,
	onSelect,
}: {
	icon: CarbonIcon;
	label: string;
	detail: string | null;
	imageUrl?: string | null;
	onSelect: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onSelect}
			className="flex w-full items-center gap-3 rounded-sm px-3 py-2 text-left outline-none hover:bg-muted focus-visible:bg-muted"
		>
			<ChatReferenceIdentity
				resource={{
					kind: "integration",
					id: label,
					label,
					detail,
					imageUrl,
				}}
				icon={icon}
			/>
		</button>
	);
}

async function addFiles(
	files: FileList | null,
	setAttachments: React.Dispatch<React.SetStateAction<BuilderAttachment[]>>,
) {
	if (!files) return;
	const accepted: BuilderAttachment[] = [];

	for (const file of Array.from(files).slice(0, 5)) {
		if (file.size > 2_000_000) {
			toast.error(`${file.name} is larger than 2 MB.`);
			continue;
		}

		accepted.push({
			name: file.name,
			type: file.type || "application/octet-stream",
			size: file.size,
			contentBase64: bytesToBase64(new Uint8Array(await file.arrayBuffer())),
		});
	}

	setAttachments((current) => [...current, ...accepted].slice(0, 5));
}

function bytesToBase64(bytes: Uint8Array): string {
	let binary = "";
	for (let index = 0; index < bytes.length; index += 8192) {
		binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
	}
	return btoa(binary);
}
