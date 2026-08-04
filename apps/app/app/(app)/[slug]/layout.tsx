import { notFound } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { AppIconRail } from "@/components/app-icon-rail";
import { QuickSwitcher } from "@/components/crm/quick-switcher";
import { RecordSheetHost } from "@/components/crm/record-sheet/record-sheet-host";
import { MobileNavProvider } from "@/components/mobile-nav";
import { requireGoogleAccess } from "@/lib/session";
import { HydrateClient } from "@/lib/trpc/hydrate";
import { getServerQueryClient, getServerTrpc } from "@/lib/trpc/server";

export default async function AppLayout({
	children,
	params,
}: Readonly<{
	children: React.ReactNode;
	params: Promise<{ slug: string }>;
}>) {
	const [{ user }, { slug }] = await Promise.all([
		requireGoogleAccess(),
		params,
	]);

	const workspace = await getServerQueryClient()
		.fetchQuery(getServerTrpc().workspace.get.queryOptions())
		.catch(() => null);

	if (workspace && workspace.slug !== slug) notFound();

	return (
		<MobileNavProvider>
			<div className="isolate flex h-svh flex-col">
				<HydrateClient>
					<AppHeader
						user={{
							name: user.name,
							email: user.email,
							image: user.image ?? null,
						}}
					/>
				</HydrateClient>
				<div className="flex min-h-0 flex-1">
					<AppIconRail />
					{children}
				</div>

				<RecordSheetHost />

				<QuickSwitcher />
			</div>
		</MobileNavProvider>
	);
}
