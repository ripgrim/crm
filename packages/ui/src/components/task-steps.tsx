"use client";

import { CheckIcon, XIcon } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { Spinner } from "@crm/ui/components/spinner";
import { cn } from "@crm/ui/lib/utils";

const TRANSITION = {
	type: "spring",
	stiffness: 520,
	damping: 34,
	mass: 0.45,
} as const;

const INSTANT = { duration: 0 } as const;

export type TaskStep = {
	id: string;
	label: string;
	meta?: string;
};

export type TaskStepStatus = "pending" | "active" | "done" | "error";

export type UseTaskStepsOptions = {
	steps: TaskStep[];
	current: number;
	failed?: boolean;
};

export function useTaskSteps({
	steps,
	current,
	failed = false,
}: UseTaskStepsOptions) {
	const complete = !failed && current >= steps.length;
	const rows = steps.map((step, index) => ({
		...step,
		status: (index < current
			? "done"
			: index === current && failed
				? "error"
				: index === current && !complete
					? "active"
					: "pending") as TaskStepStatus,
	}));
	const active = rows.find((row) => row.status === "active");
	const sentence = failed
		? `Failed at ${steps[Math.min(current, steps.length - 1)]?.label ?? "step"}`
		: complete
			? `All ${steps.length} steps complete`
			: active
				? `${active.label}, step ${current + 1} of ${steps.length}`
				: "";

	return { rows, complete, sentence };
}

export type TaskStepsProps = UseTaskStepsOptions & {
	label?: string;
	className?: string;
};

export function TaskSteps({
	steps,
	current,
	failed = false,
	label = "Task progress",
	className,
}: TaskStepsProps) {
	const { rows, complete, sentence } = useTaskSteps({
		steps,
		current,
		failed,
	});
	const reduced = useReducedMotion() === true;

	return (
		<div className={cn("w-full", className)}>
			<ol aria-label={label}>
				{rows.map((row) => (
					<li
						key={row.id}
						aria-current={row.status === "active" ? "step" : undefined}
						className="flex min-h-10 items-start gap-3 border-t px-4 py-2.5 first:border-t-0 sm:h-8 sm:min-h-0 sm:items-center sm:gap-4 sm:px-5 sm:py-0"
					>
						<span className="relative grid size-5 shrink-0 place-items-center">
							{(["pending", "active", "done", "error"] as const).map(
								(status) => {
									const active = row.status === status;
									return (
										<motion.span
											key={status}
											aria-hidden
											className={cn(
												"col-start-1 row-start-1 grid size-5 place-items-center",
												status === "done" && "text-ring",
												status === "error" && "text-destructive",
												status === "active" && "text-muted-foreground",
											)}
											initial={false}
											animate={{
												opacity: active ? 1 : 0,
												scale: reduced || active ? 1 : 0.6,
											}}
											transition={reduced ? INSTANT : TRANSITION}
										>
											{status === "done" ? <CheckIcon /> : null}
											{status === "error" ? <XIcon /> : null}
											{status === "active" ? (
												<Spinner aria-hidden />
											) : null}
										</motion.span>
									);
								},
							)}
						</span>
						<span
							className={cn(
								"min-w-0 flex-1 wrap-break-word text-sm transition-colors",
								row.status === "active" && "font-medium",
								row.status === "pending" && "text-muted-foreground",
								row.status === "error" && "font-medium text-destructive",
							)}
						>
							{row.label}
						</span>
						{row.meta ? (
							<span className="min-w-0 max-w-[45%] text-right text-muted-foreground text-xs sm:w-60 sm:max-w-none sm:shrink-0">
								{row.meta}
							</span>
						) : null}
					</li>
				))}
			</ol>
			<span role="status" aria-live="polite" aria-atomic="true" className="sr-only">
				{sentence}
			</span>
			<span className="sr-only" aria-live={complete || failed ? "polite" : "off"}>
				{complete ? "Task complete" : failed ? "Task failed" : ""}
			</span>
		</div>
	);
}
