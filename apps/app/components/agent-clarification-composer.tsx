"use client";

import { AsyncButtonContent } from "@crm/ui/components/async-action";
import { Button } from "@crm/ui/components/button";
import { Markdown } from "@crm/ui/components/markdown";
import { Textarea } from "@crm/ui/components/textarea";
import { ToggleGroup, ToggleGroupItem } from "@crm/ui/components/toggle-group";
import type { EveMessageInputRequest } from "eve/react";
import { useId, useState } from "react";
import { AGENT_COMPOSER_CLASS_NAME } from "./agent-composer-frame";

export type ClarificationResponse = {
	requestId: string;
	optionId?: string;
	text?: string;
};

export function AgentClarificationComposer({
	question,
	pending,
	onSubmit,
}: {
	question: EveMessageInputRequest;
	pending: boolean;
	onSubmit: (response: ClarificationResponse) => Promise<void>;
}) {
	const answerId = useId();
	const errorId = `${answerId}-error`;
	const [selectedOptionId, setSelectedOptionId] = useState("");
	const [answer, setAnswer] = useState("");
	const [error, setError] = useState<string | null>(null);
	const options = question.options ?? [];
	const showFreeform =
		question.display === "text" ||
		question.allowFreeform === true ||
		options.length === 0;
	const selectedOption = options.find(
		(option) => option.id === selectedOptionId,
	);

	const submit = async () => {
		if (pending) return;
		const text = answer.trim();
		if (!selectedOptionId && !text) {
			setError(
				options.length > 0
					? "Choose an answer before submitting."
					: "Write an answer before submitting.",
			);
			return;
		}

		setError(null);
		try {
			await onSubmit(
				selectedOptionId
					? { requestId: question.requestId, optionId: selectedOptionId }
					: { requestId: question.requestId, text },
			);
		} catch {
			setError("Unable to submit. Check your connection and try again.");
		}
	};

	return (
		<form
			className={AGENT_COMPOSER_CLASS_NAME}
			onSubmit={(event) => {
				event.preventDefault();
				void submit();
			}}
		>
			<div className="px-1 pt-0.5">
				<p className="font-medium text-xs">Quick follow-up</p>
				<Markdown className="mt-1 max-h-32 overflow-y-auto text-pretty text-sm leading-5">
					{question.prompt}
				</Markdown>
			</div>

			{options.length > 0 ? (
				<div className="mt-2">
					<ToggleGroup
						type="single"
						orientation="vertical"
						variant="outline"
						size="choice"
						spacing={1}
						value={selectedOptionId}
						disabled={pending}
						onValueChange={(value) => {
							setSelectedOptionId(value);
							if (value) setAnswer("");
							setError(null);
						}}
					>
						{options.map((option) => (
							<ToggleGroupItem key={option.id} value={option.id}>
								<span className="w-full wrap-break-word font-medium leading-4">
									{option.label}
								</span>
								{option.description ? (
									<span className="w-full wrap-break-word font-normal text-[11px] text-muted-foreground leading-4">
										{option.description}
									</span>
								) : null}
							</ToggleGroupItem>
						))}
					</ToggleGroup>
				</div>
			) : null}

			{showFreeform ? (
				<div className="mt-2 px-1">
					<label
						htmlFor={answerId}
						className="font-medium text-muted-foreground text-xs"
					>
						{options.length > 0 ? "Or write an answer" : "Your answer"}
						<Textarea
							id={answerId}
							value={answer}
							onChange={(event) => {
								setAnswer(event.target.value);
								if (event.target.value) setSelectedOptionId("");
								setError(null);
							}}
							placeholder="Add the detail the agent needs"
							variant="composer"
							size="composer"
							rows={1}
							disabled={pending}
							aria-invalid={Boolean(error)}
							aria-describedby={error ? errorId : undefined}
						/>
					</label>
				</div>
			) : null}

			<div className="mt-2 flex min-h-7 items-center justify-between gap-3 px-1">
				{error ? (
					<p id={errorId} role="alert" className="text-destructive text-xs">
						{error}
					</p>
				) : (
					<p className="min-w-0 truncate text-muted-foreground text-xs">
						{selectedOption
							? `Selected: ${selectedOption.label}`
							: "Choose an answer, then submit."}
					</p>
				)}
				<Button type="submit" size="sm" disabled={pending} aria-busy={pending}>
					<AsyncButtonContent
						status={pending ? "pending" : "idle"}
						pendingLabel="Submitting"
					>
						Submit answer
					</AsyncButtonContent>
				</Button>
			</div>
		</form>
	);
}
