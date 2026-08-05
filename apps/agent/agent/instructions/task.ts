import { defineDynamic, defineInstructions } from "eve/instructions";
import { focusOn, setBudget } from "../lib/focus";
import { sessionPreamble } from "../lib/preamble";
import { RESEARCH_INSTRUCTIONS } from "../lib/research-instructions";
import { attribute, purposeOf } from "../lib/session-purpose";

export default defineDynamic({
	events: {
		"session.started": async (_event, ctx) => {
			const purpose = purposeOf(ctx);
			if (purpose === "builder") {
				return builderInstructions(ctx);
			}

			if (purpose === "team-agent") {
				return defineInstructions({
					markdown: `This is one background run of a deployed team agent. Call agent_runner exactly once and pass the run id from your user message. Do not call research tools or perform work yourself. Relay the specialist's factual completion summary. Never claim an external action that the specialist did not log.`,
				});
			}

			const attributes = ctx.session.auth.current?.attributes ?? {};
			const budget = asNumber(attributes.budget);
			const kind = asString(attributes.taskKind);

			if (budget) setBudget(budget);

			const { markdown, focus } = await sessionPreamble(
				{
					contactId: asString(attributes.contactId),
					companyId: asString(attributes.companyId),
					dealId: asString(attributes.dealId),
				},
				{
					dispatched: Boolean(kind),
					kind,
					reason: asString(attributes.reason),
					budget,
				},
			);

			focusOn({ ...focus, sessionId: ctx.session.id });

			return defineInstructions({
				markdown: `${RESEARCH_INSTRUCTIONS}\n\n${markdown}`,
			});
		},
		"turn.started": (_event, ctx) =>
			purposeOf(ctx) === "builder" ? builderInstructions(ctx) : null,
	},
});

function builderInstructions(ctx: Parameters<typeof purposeOf>[0]) {
	return defineInstructions({
		markdown: builderTaskMarkdown(attribute(ctx, "commandType")),
	});
}

export function builderTaskMarkdown(commandType: string | null): string {
	return commandType === "CREATE_AGENT"
		? `This private CRM chat turn used the Create agent command. Call agent_builder exactly once. Pass the complete request, the conversation's relevant decisions, every tagged resource, and your understanding of any attachment. Do not call research tools or mutate CRM records yourself. Relay the specialist's result in concise product language. If the specialist says an essential decision is unclear, call ask_question instead of replying with a plain-text question. Ask exactly one decision at a time and never bundle several missing details into one prompt. Offer two to four mutually exclusive options when they clarify a real choice, and allow a freeform answer when a custom response is valid. After the answer, ask another question only if the build remains materially blocked. Ask only when the answer materially changes the trigger, records, integrations, schedule, outcome, or side effect. Do not interrupt a sufficiently specific request or ask about optional polish. If it saved a draft, explain that it is ready for human review and is not deployed yet.`
		: `This is a private CRM assistant chat. Answer the user's question directly. Use tagged records as scope and use available read-only CRM and research tools when evidence is needed. If one materially necessary decision is missing, call ask_question with one focused follow-up instead of guessing; do not interrupt for optional detail. Do not call agent_builder, create an agent draft, or mutate CRM records on this turn. The user must explicitly run the Create agent slash command before agent creation begins. Be concise, distinguish CRM evidence from inference, and say when the CRM does not contain the answer.`;
}

function asString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
	const parsed = typeof value === "string" ? Number(value) : value;
	return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : null;
}
