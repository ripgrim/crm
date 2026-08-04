"use client";

import ChevronDown from "@carbon/icons-react/es/ChevronDown";
import ChevronUp from "@carbon/icons-react/es/ChevronUp";
import Download from "@carbon/icons-react/es/Download";
import Pause from "@carbon/icons-react/es/Pause";
import Play from "@carbon/icons-react/es/Play";
import Renew from "@carbon/icons-react/es/Renew";
import { Button } from "@crm/ui/components/button";
import { Icon } from "@crm/ui/components/icon";
import { cn } from "@crm/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { useTRPC } from "@/lib/trpc/client";
import type { RouterOutputs } from "@/lib/trpc/types";

type AgentTab = "overview" | "runs" | "activity";
type AgentDetail = RouterOutputs["agents"]["byId"];
type Runs = RouterOutputs["agents"]["history"];
type Activity = RouterOutputs["agents"]["activity"];
type RunRow = Omit<Runs[number], "events"> & {
	events: Array<{
		id: string;
		type: string;
		data: unknown;
		emittedAt: string;
	}>;
};
type ActivityRow = Omit<Activity[number], "before" | "after"> & {
	before: unknown;
	after: unknown;
};

export function TeamAgentDetail({ agentId }: { agentId: string }) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const [tab, setTab] = useState<AgentTab>("runs");
	const agent = useQuery(trpc.agents.byId.queryOptions({ id: agentId }));
	const runs = useQuery(
		trpc.agents.history.queryOptions({ id: agentId, limit: 50 }),
	);
	const activity = useQuery(
		trpc.agents.activity.queryOptions({ id: agentId, limit: 100 }),
	);
	const invalidate = () =>
		Promise.all([
			queryClient.invalidateQueries({ queryKey: trpc.agents.byId.pathKey() }),
			queryClient.invalidateQueries({ queryKey: trpc.agents.list.pathKey() }),
		]);
	const runNow = useMutation(
		trpc.agents.runNow.mutationOptions({
			onSuccess: async () => {
				await queryClient.invalidateQueries({
					queryKey: trpc.agents.history.pathKey(),
				});
				setTab("runs");
				toast.success("Agent run queued.");
			},
			onError: (error) => toast.error(error.message),
		}),
	);
	const pause = useMutation(
		trpc.agents.pause.mutationOptions({
			onSuccess: invalidate,
			onError: (error) => toast.error(error.message),
		}),
	);
	const resume = useMutation(
		trpc.agents.resume.mutationOptions({
			onSuccess: invalidate,
			onError: (error) => toast.error(error.message),
		}),
	);

	if (agent.isPending) {
		return (
			<main className="flex flex-1 items-center justify-center">
				<Icon
					icon={Renew}
					className="size-4 animate-spin text-muted-foreground"
					motion="none"
				/>
			</main>
		);
	}

	if (agent.isError) {
		return (
			<main className="flex flex-1 items-center justify-center p-8 text-center">
				<p className="text-muted-foreground text-sm">{agent.error.message}</p>
			</main>
		);
	}

	const data = agent.data;
	const nextRun = data.triggers.find((trigger) => trigger.enabled)?.nextRunAt;

	return (
		<main className="min-h-0 min-w-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6 sm:py-10">
			<div className="mx-auto flex w-full min-w-0 max-w-[1040px] flex-col gap-6">
				<div className="flex min-w-0 flex-col items-stretch gap-6 sm:flex-row sm:items-start sm:justify-between sm:gap-8">
					<div className="min-w-0 max-w-[650px]">
						<h1 className="wrap-break-word text-balance font-semibold text-2xl tracking-tight sm:text-3xl">
							{data.name}
						</h1>
						<p className="mt-3 wrap-break-word text-pretty text-muted-foreground text-sm leading-6">
							{data.description ?? "A durable team automation."}
						</p>
						<p className="mt-3 wrap-break-word text-muted-foreground text-xs">
							Created by {data.createdBy.name} · Team agent · Version{" "}
							{data.currentVersion?.number ?? "—"}
						</p>
					</div>
					<div className="flex min-w-0 flex-col items-start gap-2 sm:shrink-0 sm:items-end">
						<span className="text-muted-foreground text-xs">Next run</span>
						<span className="font-mono text-sm">
							{nextRun ? formatDate(nextRun) : "Manual only"}
						</span>
						<div className="mt-1 flex flex-wrap gap-2">
							<Button
								variant="outline"
								disabled={data.status !== "LIVE" || runNow.isPending}
								onClick={() =>
									runNow.mutate({
										id: data.id,
										clientRequestId: crypto.randomUUID(),
									})
								}
							>
								<Icon icon={Play} data-icon="inline-start" />
								Run now
							</Button>
							{data.canManage && data.status === "LIVE" ? (
								<Button
									variant="outline"
									disabled={pause.isPending}
									onClick={() => pause.mutate({ id: data.id })}
								>
									<Icon icon={Pause} data-icon="inline-start" />
									Pause
								</Button>
							) : null}
							{data.canManage && data.status === "PAUSED" ? (
								<Button
									variant="outline"
									disabled={resume.isPending}
									onClick={() => resume.mutate({ id: data.id })}
								>
									<Icon icon={Play} data-icon="inline-start" />
									Resume
								</Button>
							) : null}
						</div>
					</div>
				</div>

				<div className="flex h-9 min-w-0 items-end gap-5 overflow-x-auto border-b sm:gap-6">
					<TabButton
						active={tab === "overview"}
						onClick={() => setTab("overview")}
					>
						Overview
					</TabButton>
					<TabButton active={tab === "runs"} onClick={() => setTab("runs")}>
						Runs{" "}
						<span className="font-mono text-muted-foreground">
							{data.runCount}
						</span>
					</TabButton>
					<TabButton
						active={tab === "activity"}
						onClick={() => setTab("activity")}
					>
						Activity{" "}
						<span className="font-mono text-muted-foreground">
							{activity.data?.length ?? 0}
						</span>
					</TabButton>
				</div>

				{tab === "overview" ? <AgentOverview agent={data} /> : null}
				{tab === "runs" ? <AgentRuns runs={runs.data ?? []} /> : null}
				{tab === "activity" ? (
					<AgentActivity activity={activity.data ?? []} />
				) : null}
			</div>
		</main>
	);
}

function TabButton({
	active,
	onClick,
	children,
}: {
	active: boolean;
	onClick: () => void;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				"flex h-8 items-center gap-2 border-b-2 border-transparent text-muted-foreground text-sm outline-none hover:text-foreground focus-visible:text-foreground",
				active && "border-ring font-medium text-foreground",
			)}
		>
			{children}
		</button>
	);
}

function AgentOverview({ agent }: { agent: AgentDetail }) {
	const version = agent.currentVersion as {
		manifest: unknown;
		sandboxPolicy: unknown;
		modelId: string;
	} | null;
	const manifest = recordOf(version?.manifest);
	const sandbox = recordOf(version?.sandboxPolicy);

	return (
		<div className="overflow-hidden rounded-lg border bg-card">
			<DetailRow label="Status" value={agent.status} />
			<DetailRow label="Model" value={version?.modelId ?? "—"} />
			<DetailRow
				label="Execution"
				value={textOf(sandbox.summary, "Vercel Sandbox · deny-all network")}
			/>
			<DetailRow
				label="Scope"
				value={textOf(
					recordOf(manifest.dataScope).summary,
					"Bounded CRM access",
				)}
			/>
			<DetailRow
				label="Triggers"
				value={
					agent.triggers.map((trigger) => trigger.name).join(" · ") ||
					"Manual only"
				}
			/>
		</div>
	);
}

function DetailRow({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex min-h-11 flex-col items-start gap-1 border-t px-4 py-3 first:border-t-0 sm:flex-row sm:items-center sm:gap-5 sm:px-5 sm:py-2">
			<span className="text-muted-foreground text-xs sm:w-36 sm:shrink-0">
				{label}
			</span>
			<span className="min-w-0 max-w-full flex-1 wrap-break-word text-sm">
				{value}
			</span>
		</div>
	);
}

function AgentRuns({ runs }: { runs: Runs }) {
	const [outcome, setOutcome] = useState("ALL");
	const [expanded, setExpanded] = useState<string | null>(null);
	const visible = runs.filter(
		(run) => outcome === "ALL" || run.status === outcome,
	);

	return (
		<div className="flex min-w-0 flex-col gap-4 sm:gap-6">
			<div className="flex min-h-7 items-center justify-start sm:justify-end">
				<select
					value={outcome}
					onChange={(event) => setOutcome(event.target.value)}
					aria-label="Filter run outcomes"
					className="h-7 rounded-md border bg-muted px-2.5 font-medium text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
				>
					<option value="ALL">All outcomes</option>
					<option value="SUCCEEDED">Succeeded</option>
					<option value="FAILED">Failed</option>
					<option value="RUNNING">Running</option>
					<option value="QUEUED">Queued</option>
				</select>
			</div>

			{visible.map((run, index) => (
				<div
					key={run.id}
					className="min-w-0 overflow-hidden rounded-lg border bg-card"
				>
					<button
						type="button"
						onClick={() =>
							setExpanded((current) => (current === run.id ? null : run.id))
						}
						className="flex min-h-14 w-full min-w-0 flex-col items-stretch gap-3 px-4 py-3 text-left outline-none hover:bg-muted/40 focus-visible:bg-muted/40 sm:flex-row sm:items-center sm:justify-between sm:gap-5 sm:px-5 sm:py-2"
					>
						<span className="min-w-0 flex-1">
							<span className="flex flex-wrap items-center gap-x-3 gap-y-1">
								<span className="font-semibold text-sm">
									Run #{String(runs.length - index).padStart(3, "0")}
								</span>
								<span
									className={cn(
										"text-muted-foreground text-xs",
										run.status === "FAILED" && "text-destructive",
									)}
								>
									{humanStatus(run.status)}
								</span>
							</span>
							<span className="mt-1 block wrap-break-word font-mono text-muted-foreground text-xs leading-5 sm:mt-0">
								{humanStatus(run.triggerType)} · {formatDate(run.createdAt)} ·
								Version {run.version.number}
							</span>
						</span>
						<span className="flex min-w-0 items-center justify-between gap-3 font-mono text-muted-foreground text-xs sm:shrink-0 sm:justify-start sm:gap-4">
							<span>{duration(run.startedAt, run.finishedAt)}</span>
							<span>
								{run.actions.length} external{" "}
								{run.actions.length === 1 ? "action" : "actions"}
							</span>
							<Icon
								icon={expanded === run.id ? ChevronUp : ChevronDown}
								className="size-3.5"
							/>
						</span>
					</button>

					{expanded === run.id ? (
						<ExpandedRun run={run as unknown as RunRow} />
					) : null}
				</div>
			))}

			{visible.length === 0 ? (
				<p className="py-12 text-center text-muted-foreground text-sm">
					No runs match this outcome.
				</p>
			) : null}
		</div>
	);
}

function ExpandedRun({ run }: { run: RunRow }) {
	const events = run.events.filter(
		(event) => event.type !== "message.appended",
	);
	const condensedEvents = run.events.length - events.length;

	return (
		<div className="min-w-0 border-t">
			<div className="grid grid-cols-2 gap-x-4 gap-y-3 border-b bg-background px-4 py-3 sm:min-h-[58px] sm:grid-cols-4 sm:items-center sm:gap-0 sm:px-5 sm:py-2">
				<RunMeta label="Trigger" value={humanStatus(run.triggerType)} />
				<RunMeta
					label="Initiated by"
					value={run.initiatedBy?.name ?? "Eve scheduler"}
				/>
				<RunMeta label="Model" value={run.modelId ?? "Gateway default"} />
				<RunMeta label="Version" value={String(run.version.number)} last />
			</div>

			<div>
				{events.map((event) => (
					<div
						key={event.id}
						className="grid min-h-8 min-w-0 grid-cols-[68px_minmax(0,1fr)] items-start gap-x-3 border-t px-4 py-2 first:border-t-0 sm:flex sm:items-center sm:gap-5 sm:px-5 sm:py-1.5"
					>
						<span className="shrink-0 font-mono text-muted-foreground text-xs sm:w-[78px]">
							{formatTime(event.emittedAt)}
						</span>
						<span className="min-w-0 flex-1 wrap-break-word text-sm">
							{eventLabel(event.type, event.data)}
						</span>
						<span className="hidden shrink-0 font-mono text-muted-foreground text-xs sm:inline">
							event
						</span>
					</div>
				))}
				{run.actions.map((action) => (
					<div
						key={action.id}
						className="grid min-h-12 min-w-0 grid-cols-[68px_minmax(0,1fr)] items-start gap-x-3 gap-y-1 border-t px-4 py-3 sm:flex sm:gap-5 sm:px-5"
					>
						<span className="shrink-0 font-mono text-muted-foreground text-xs sm:w-[78px]">
							{formatTime(
								action.completedAt ?? action.startedAt ?? action.plannedAt,
							)}
						</span>
						<span className="min-w-0 flex-1">
							<span className="block wrap-break-word text-sm">
								{action.summary}
							</span>
							<span className="block wrap-break-word text-muted-foreground text-xs">
								{action.provider} · {humanStatus(action.status)}
								{action.targetLabel ? ` · ${action.targetLabel}` : ""}
							</span>
						</span>
						<span className="col-start-2 min-w-0 wrap-break-word font-mono text-muted-foreground text-xs sm:col-auto sm:shrink-0">
							{action.externalId ?? action.id.slice(0, 12)}
						</span>
					</div>
				))}
				{condensedEvents > 0 ? (
					<div className="flex min-h-9 items-center border-t px-4 py-2 text-muted-foreground text-xs sm:px-5">
						{condensedEvents} streaming{" "}
						{condensedEvents === 1 ? "update" : "updates"} condensed
					</div>
				) : null}
			</div>
		</div>
	);
}

function RunMeta({
	label,
	value,
	last = false,
}: {
	label: string;
	value: string;
	last?: boolean;
}) {
	return (
		<span
			className={cn(
				"flex min-w-0 flex-col gap-0.5 sm:flex-1",
				last && "sm:max-w-44",
			)}
		>
			<span className="text-muted-foreground text-xs">{label}</span>
			<span className="wrap-break-word text-sm sm:truncate">{value}</span>
		</span>
	);
}

function AgentActivity({ activity }: { activity: Activity }) {
	const [kind, setKind] = useState("ALL");
	const rows = activity as unknown as ActivityRow[];
	const visible = rows.filter(
		(event) => kind === "ALL" || event.type.startsWith(kind),
	);

	return (
		<div className="flex min-w-0 flex-col gap-4 sm:gap-6">
			<div className="flex min-h-7 flex-wrap items-center justify-start gap-2 sm:justify-end sm:gap-3">
				<select
					value={kind}
					onChange={(event) => setKind(event.target.value)}
					aria-label="Filter activity"
					className="h-7 rounded-md border bg-muted px-2.5 font-medium text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
				>
					<option value="ALL">All changes</option>
					<option value="agent.">Agent changes</option>
					<option value="run.">Run requests</option>
				</select>
				<Button
					variant="outline"
					size="sm"
					onClick={() => exportJson("agent-activity.json", visible)}
				>
					<Icon icon={Download} data-icon="inline-start" />
					Export
				</Button>
			</div>

			<div className="min-w-0 overflow-hidden rounded-lg border bg-card">
				<div className="hidden h-9 items-center border-b bg-background px-5 text-muted-foreground text-xs sm:flex">
					<span className="w-[166px] shrink-0">Time</span>
					<span className="min-w-0 flex-1">Change</span>
					<span className="w-[140px] shrink-0">Actor</span>
					<span className="w-[118px] shrink-0 text-right">Request</span>
				</div>
				{visible.map((event) => (
					<div
						key={event.id}
						className="flex min-h-11 min-w-0 flex-col items-start gap-2 border-t px-4 py-3 first:border-t-0 sm:flex-row sm:items-center sm:gap-0 sm:px-5"
					>
						<span className="shrink-0 font-mono text-muted-foreground text-xs sm:w-[166px]">
							{formatDate(event.emittedAt)}
						</span>
						<span className="min-w-0 flex-1">
							<span className="block wrap-break-word text-sm">
								{event.summary}
							</span>
							{changeDetail(event.before, event.after) ? (
								<span className="block max-w-full whitespace-pre-wrap wrap-break-word font-mono text-muted-foreground text-xs">
									{changeDetail(event.before, event.after)}
								</span>
							) : null}
						</span>
						<span className="min-w-0 wrap-break-word text-xs sm:w-[140px] sm:shrink-0 sm:text-sm">
							<span className="text-muted-foreground sm:hidden">Actor · </span>
							{event.actorUser?.name ?? event.actorId ?? event.actorType}
						</span>
						<span className="min-w-0 wrap-break-word font-mono text-muted-foreground text-xs sm:w-[118px] sm:shrink-0 sm:text-right">
							<span className="font-sans sm:hidden">Request · </span>
							{event.requestId?.slice(0, 12) ?? "—"}
						</span>
					</div>
				))}
			</div>
		</div>
	);
}

function recordOf(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function textOf(value: unknown, fallback: string): string {
	return typeof value === "string" && value.trim() ? value : fallback;
}

function humanStatus(value: string): string {
	return value
		.toLowerCase()
		.replace(/_/g, " ")
		.replace(/^./, (character) => character.toUpperCase());
}

function formatDate(value: string): string {
	return new Intl.DateTimeFormat(undefined, {
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
		second: "2-digit",
	}).format(new Date(value));
}

function formatTime(value: string): string {
	return new Intl.DateTimeFormat(undefined, {
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hour12: false,
	}).format(new Date(value));
}

function duration(startedAt: string | null, finishedAt: string | null): string {
	if (!startedAt) return "—";
	const milliseconds =
		(finishedAt ? new Date(finishedAt) : new Date()).getTime() -
		new Date(startedAt).getTime();
	return `${Math.max(0, milliseconds / 1000).toFixed(1)}s`;
}

function eventLabel(type: string, data: unknown): string {
	const payload = recordOf(data);
	return textOf(payload.summary, humanStatus(type.replace(/\./g, " ")));
}

function changeDetail(before: unknown, after: unknown): string | null {
	if (!before && !after) return null;
	const previous = JSON.stringify(before);
	const next = JSON.stringify(after);
	return previous && next ? `${previous} → ${next}` : next || previous;
}

function exportJson(name: string, value: unknown) {
	const url = URL.createObjectURL(
		new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
	);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = name;
	anchor.click();
	URL.revokeObjectURL(url);
}
