export type SessionPurpose = "builder" | "team-agent" | "research";

type PurposeContext = {
	readonly session: {
		readonly auth: {
			readonly current: {
				readonly attributes: Readonly<Record<string, unknown>>;
			} | null;
			readonly initiator: {
				readonly attributes: Readonly<Record<string, unknown>>;
			} | null;
		};
	};
};

export function purposeOf(ctx: PurposeContext): SessionPurpose {
	const purpose = attribute(ctx, "purpose");
	if (purpose === "builder" || purpose === "team-agent") return purpose;
	return "research";
}

export function attribute(ctx: PurposeContext, key: string): string | null {
	const current = ctx.session.auth.current?.attributes[key];
	if (typeof current === "string" && current.trim()) return current.trim();

	const initiator = ctx.session.auth.initiator?.attributes[key];
	return typeof initiator === "string" && initiator.trim()
		? initiator.trim()
		: null;
}

export function requireAttribute(ctx: PurposeContext, key: string): string {
	const value = attribute(ctx, key);
	if (!value) throw new Error(`This session is missing ${key}.`);
	return value;
}

export function assertResearchPurpose(ctx: PurposeContext): void {
	if (purposeOf(ctx) !== "research") {
		throw new Error("This CRM research tool is unavailable for this session.");
	}
}
