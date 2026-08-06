"use client";

import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from "@crm/ui/components/accordion";
import { Shimmer } from "@crm/ui/components/shimmer";
import { cn } from "@crm/ui/lib/utils";
import { type ReactNode, useState } from "react";

export function Reasoning({
	children,
	className,
	isStreaming = false,
	label = "Reasoning",
}: {
	children: ReactNode;
	className?: string;
	isStreaming?: boolean;
	label?: string;
}) {
	const [value, setValue] = useState("");

	return (
		<Accordion
			type="single"
			collapsible
			value={isStreaming ? "reasoning" : value}
			onValueChange={setValue}
			className={cn(className)}
		>
			<AccordionItem value="reasoning">
				<AccordionTrigger variant="subtle">
					{isStreaming ? <Shimmer>Thinking…</Shimmer> : label}
				</AccordionTrigger>
				<AccordionContent className="text-muted-foreground">
					{children}
				</AccordionContent>
			</AccordionItem>
		</Accordion>
	);
}
