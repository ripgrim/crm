"use client";

import { cn } from "@crm/ui/lib/utils";
import { motion, useReducedMotion } from "motion/react";
import { useId } from "react";

const FILL = {
	type: "spring",
	stiffness: 210,
	damping: 34,
	mass: 0.9,
} as const;

const INSTANT = { duration: 0 } as const;

export type ProgressProps = {
	value: number | null;
	max?: number;
	label?: string;
	pendingLabel?: string;
	completeLabel?: string;
	className?: string;
};

export function Progress({
	value,
	max = 100,
	label = "Progress",
	pendingLabel = "Working",
	completeLabel = "Complete",
	className,
}: ProgressProps) {
	const reduced = useReducedMotion() === true;
	const labelId = useId();
	const indeterminate = value === null;
	const fraction =
		value === null || max <= 0 ? 0 : Math.min(1, Math.max(0, value / max));
	const percent = Math.round(fraction * 100);
	const complete = !indeterminate && fraction >= 1;

	return (
		<div className={cn("w-full", className)}>
			<div className="flex items-baseline justify-between gap-3">
				<span id={labelId} className="truncate font-medium text-xs">
					{label}
				</span>
				<span
					aria-hidden
					className="grid shrink-0 justify-items-end font-mono text-muted-foreground text-xs tabular-nums"
				>
					<span className="col-start-1 row-start-1">
						{indeterminate ? pendingLabel : `${percent}%`}
					</span>
				</span>
			</div>
			<div
				role="progressbar"
				aria-labelledby={labelId}
				aria-valuemin={0}
				aria-valuemax={max}
				aria-valuenow={indeterminate ? undefined : fraction * max}
				aria-valuetext={indeterminate ? pendingLabel : `${percent}%`}
				className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
			>
				<div className="relative h-full overflow-hidden rounded-full">
					<motion.span
						aria-hidden
						className="absolute inset-0 block origin-left rounded-full bg-primary"
						initial={false}
						animate={{ scaleX: indeterminate ? 0 : fraction }}
						transition={reduced ? INSTANT : FILL}
					/>
					{indeterminate ? (
						<motion.span
							aria-hidden
							className="absolute inset-y-0 left-0 block w-2/5 rounded-full bg-primary"
							initial={reduced ? { x: "75%" } : { x: "-100%" }}
							animate={reduced ? { x: "75%" } : { x: "250%" }}
							transition={
								reduced
									? INSTANT
									: {
											duration: 1.25,
											ease: "easeInOut",
											repeat: Number.POSITIVE_INFINITY,
										}
							}
						/>
					) : null}
				</div>
			</div>
			<span role="status" aria-live="polite" className="sr-only">
				{complete ? completeLabel : indeterminate ? pendingLabel : ""}
			</span>
		</div>
	);
}
