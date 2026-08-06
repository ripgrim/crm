import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { db } from "@crm/db";
import { captureNow, resetTelemetryClient } from "../src/client";
import { milestone } from "../src/events";
import { forgetInstall, readInstall, stableUuid } from "../src/install";
import { POSTHOG_HOST } from "../src/project";

const real = {
	fetch: globalThis.fetch,
	nodeEnv: process.env.NODE_ENV,
	disabled: process.env.CRM_TELEMETRY_DISABLED,
	doNotTrack: process.env.DO_NOT_TRACK,
};

let calls: { url: string; body: unknown }[] = [];

function stubFetch(): void {
	calls = [];

	globalThis.fetch = (async (input: unknown, init?: { body?: unknown }) => {
		calls.push({ url: String(input), body: await decode(init?.body) });

		return new Response(JSON.stringify({ status: 1 }), {
			status: 200,
			headers: { "content-type": "application/json" },
		});
	}) as typeof fetch;
}

async function decode(body: unknown): Promise<unknown> {
	if (body === undefined || body === null) return null;
	if (typeof body === "string") return JSON.parse(body);

	const bytes =
		body instanceof Blob
			? new Uint8Array(await body.arrayBuffer())
			: new Uint8Array(body as ArrayBufferLike);

	const text = new TextDecoder().decode(Bun.gunzipSync(bytes));
	return JSON.parse(text);
}

beforeEach(() => {
	stubFetch();
	resetTelemetryClient();
	forgetInstall();

	process.env.NODE_ENV = "development";
	delete process.env.CRM_TELEMETRY_DISABLED;
	delete process.env.DO_NOT_TRACK;
});

afterEach(() => {
	globalThis.fetch = real.fetch;
	resetTelemetryClient();
	forgetInstall();

	restore("NODE_ENV", real.nodeEnv);
	restore("CRM_TELEMETRY_DISABLED", real.disabled);
	restore("DO_NOT_TRACK", real.doNotTrack);
});

function restore(name: string, value: string | undefined): void {
	if (value === undefined) {
		delete process.env[name];
		return;
	}

	process.env[name] = value;
}

describe("capture", () => {
	it("sends one event with the install UUID as the only identity", async () => {
		const install = await readInstall();
		expect(install).not.toBeNull();

		await captureNow("install_daily", { crm_version: "1.0.0" });

		expect(calls.length).toBe(1);
		expect(calls[0]?.url.startsWith(POSTHOG_HOST)).toBe(true);

		const event = eventOf(calls[0]?.body);

		expect(event.distinct_id).toBe(install?.uuid);
		expect(event.event).toBe("install_daily");
		expect(JSON.stringify(event)).not.toContain("identify");
	});

	it("drops a property that is not on the allowlist", async () => {
		await captureNow("install_daily", {
			crm_version: "1.0.0",
			contact_email: "ada@example.test",
			company_name: "Acme",
		} as never);

		const { properties } = eventOf(calls[0]?.body);

		expect(properties.crm_version).toBe("1.0.0");
		expect(properties).not.toHaveProperty("contact_email");
		expect(properties).not.toHaveProperty("company_name");
		expect(JSON.stringify(calls)).not.toContain("ada@example.test");
	});

	it("sends a null IP and no geoip on every event", async () => {
		await captureNow("install_daily", { crm_version: "1.0.0" });

		const { properties } = eventOf(calls[0]?.body);

		expect(properties.$ip).toBeNull();
		expect(properties.$geoip_disable).toBe(true);
	});

	it("reports a delivered event", async () => {
		expect(await captureNow("install_daily", { crm_version: "1.0.0" })).toBe(
			true,
		);
	});

	it("makes no network call at all when CRM_TELEMETRY_DISABLED is set", async () => {
		process.env.CRM_TELEMETRY_DISABLED = "1";
		resetTelemetryClient();

		expect(await captureNow("install_daily", { crm_version: "1.0.0" })).toBe(
			false,
		);
		expect(calls.length).toBe(0);
	});

	it("makes no network call at all when DO_NOT_TRACK is set", async () => {
		process.env.DO_NOT_TRACK = "1";
		resetTelemetryClient();

		expect(await captureNow("install_daily", { crm_version: "1.0.0" })).toBe(
			false,
		);
		expect(calls.length).toBe(0);
	});

	it("makes no network call at all from a test run", async () => {
		process.env.NODE_ENV = "test";
		resetTelemetryClient();

		expect(await captureNow("install_daily", { crm_version: "1.0.0" })).toBe(
			false,
		);
		expect(calls.length).toBe(0);
	});

	it("stays silent but reports the failure when the host refuses the send", async () => {
		globalThis.fetch = (async () => {
			throw new Error("network is down");
		}) as typeof fetch;

		expect(await captureNow("install_daily", { crm_version: "1.0.0" })).toBe(
			false,
		);
	});
});

describe("milestone", () => {
	const step = "first_sign_in" as const;

	let existing: { step: string; reachedAt: Date } | null = null;

	beforeEach(async () => {
		existing = await db.telemetryMilestone.findUnique({ where: { step } });
		await db.telemetryMilestone.deleteMany({ where: { step } });
	});

	afterEach(async () => {
		await db.telemetryMilestone.deleteMany({ where: { step } });
		if (existing) await db.telemetryMilestone.create({ data: existing });
	});

	it("records the step once the event has left", async () => {
		expect(await milestone(step)).toBe(true);
		expect(await db.telemetryMilestone.count({ where: { step } })).toBe(1);
	});

	it("leaves the step unreached when the send fails", async () => {
		globalThis.fetch = (async () => {
			throw new Error("network is down");
		}) as typeof fetch;

		expect(await milestone(step)).toBe(false);
		expect(await db.telemetryMilestone.count({ where: { step } })).toBe(0);
	});

	it("sends the step again on the attempt after a failed send", async () => {
		globalThis.fetch = (async () => {
			throw new Error("network is down");
		}) as typeof fetch;

		expect(await milestone(step)).toBe(false);

		stubFetch();
		resetTelemetryClient();

		expect(await milestone(step)).toBe(true);
		expect(eventOf(calls[0]?.body).event).toBe(step);
		expect(await db.telemetryMilestone.count({ where: { step } })).toBe(1);
	});

	it("sends once when two processes sweep at the same instant", async () => {
		const [first, second] = await Promise.all([
			milestone(step),
			milestone(step),
		]);

		expect([first, second].filter(Boolean).length).toBe(1);
		expect(sentSteps()).toEqual([step]);
		expect(await db.telemetryMilestone.count({ where: { step } })).toBe(1);
	});

	it("carries an id that stays the same across a resent step", async () => {
		globalThis.fetch = (async () => {
			throw new Error("network is down");
		}) as typeof fetch;

		await milestone(step);

		stubFetch();
		resetTelemetryClient();
		await milestone(step);

		const resent = eventOf(calls[0]?.body);
		expect(resent.event).toBe(step);
		expect(resent.uuid).toBe(stableUuid(await installUuid(), step));
	});

	it("leaves the step unreached when telemetry is off", async () => {
		process.env.CRM_TELEMETRY_DISABLED = "1";
		resetTelemetryClient();

		expect(await milestone(step)).toBe(false);
		expect(await db.telemetryMilestone.count({ where: { step } })).toBe(0);
		expect(calls.length).toBe(0);
	});
});

type Captured = {
	event: string;
	distinct_id: string;
	uuid?: string;
	properties: Record<string, unknown>;
};

function eventOf(body: unknown): Captured {
	const batch = (body as { batch?: Captured[] })?.batch;
	const event = batch?.[0] ?? (body as Captured);

	return {
		event: event?.event,
		distinct_id: event?.distinct_id,
		uuid: event?.uuid,
		properties: event?.properties ?? {},
	};
}

function sentSteps(): string[] {
	return calls.map((call) => eventOf(call.body).event).filter(Boolean);
}

async function installUuid(): Promise<string> {
	const install = await readInstall();
	if (!install) throw new Error("no install row");

	return install.uuid;
}
