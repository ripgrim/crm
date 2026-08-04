"use client";

import Bot from "@carbon/icons-react/es/Bot";
import Building from "@carbon/icons-react/es/Building";
import type { CarbonIconType } from "@carbon/icons-react/es/CarbonIcon";
import Close from "@carbon/icons-react/es/Close";
import Dashboard from "@carbon/icons-react/es/Dashboard";
import Partnership from "@carbon/icons-react/es/Partnership";
import Settings from "@carbon/icons-react/es/Settings";
import UserMultiple from "@carbon/icons-react/es/UserMultiple";
import { Button } from "@crm/ui/components/button";
import { Icon } from "@crm/ui/components/icon";
import {
	Sheet,
	SheetContent,
	SheetHeader,
	SheetTitle,
} from "@crm/ui/components/sheet";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@crm/ui/components/tooltip";
import { cn } from "@crm/ui/lib/utils";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";
import { AgentBuilderSidebar } from "@/components/agent-builder/agent-builder-sidebar";
import { useMobileNav } from "@/components/mobile-nav";
import { useWorkspaceUrl } from "@/lib/use-workspace-url";

type RailItem = {
	title: string;
	href: string;
	icon: CarbonIconType;
	match: "exact" | "prefix";
	related?: string[];
};

const ITEMS: RailItem[] = [
	{ title: "Overview", href: "/", icon: Dashboard, match: "exact" },
	{ title: "Companies", href: "/companies", icon: Building, match: "prefix" },
	{
		title: "Contacts",
		href: "/contacts",
		icon: UserMultiple,
		match: "prefix",
	},
	{ title: "Deals", href: "/deals", icon: Partnership, match: "prefix" },
	{
		title: "Agents",
		href: "/agents",
		icon: Bot,
		match: "prefix",
		related: ["/agent", "/chat"],
	},
	{ title: "Settings", href: "/settings", icon: Settings, match: "prefix" },
];

function isActive(item: RailItem, pathname: string): boolean {
	return (
		pathname === item.href ||
		(item.match === "prefix" && pathname.startsWith(item.href)) ||
		Boolean(item.related?.some((prefix) => pathname.startsWith(prefix)))
	);
}

function RailLink({ item, active }: { item: RailItem; active: boolean }) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					asChild
					variant="ghost"
					size="icon"
					className={cn(
						"text-muted-foreground",
						active &&
							"bg-muted text-foreground hover:bg-muted hover:text-foreground",
					)}
				>
					<Link
						href={item.href}
						aria-current={active ? "page" : undefined}
						transitionTypes={["nav-lateral"]}
					>
						<Icon icon={item.icon} />
						<span className="sr-only">{item.title}</span>
					</Link>
				</Button>
			</TooltipTrigger>
			<TooltipContent side="right">{item.title}</TooltipContent>
		</Tooltip>
	);
}

function MobileRailLink({
	item,
	active,
	onNavigate,
}: {
	item: RailItem;
	active: boolean;
	onNavigate: () => void;
}) {
	return (
		<Button
			asChild
			variant="ghost"
			className={cn(
				"justify-start gap-3 text-muted-foreground",
				active &&
					"bg-muted text-foreground hover:bg-muted hover:text-foreground",
			)}
		>
			<Link
				href={item.href}
				aria-current={active ? "page" : undefined}
				onClick={onNavigate}
				transitionTypes={[
					item.title === "Agents" ? "nav-forward" : "nav-lateral",
				]}
			>
				<Icon icon={item.icon} />
				<span>{item.title}</span>
			</Link>
		</Button>
	);
}

function MobileRailIconLink({
	item,
	active,
	onNavigate,
}: {
	item: RailItem;
	active: boolean;
	onNavigate: () => void;
}) {
	return (
		<Button
			asChild
			variant="ghost"
			size="icon"
			className={cn(
				"text-muted-foreground",
				active &&
					"bg-muted text-foreground hover:bg-muted hover:text-foreground",
			)}
		>
			<Link
				href={item.href}
				aria-current={active ? "page" : undefined}
				onClick={onNavigate}
			>
				<Icon icon={item.icon} />
				<span className="sr-only">{item.title}</span>
			</Link>
		</Button>
	);
}

export function AppIconRail() {
	const pathname = usePathname();
	const workspaceUrl = useWorkspaceUrl();
	const { open, setOpen } = useMobileNav();

	const items = useMemo(
		() =>
			ITEMS.map((item) => ({
				...item,
				href: workspaceUrl(item.href),
				related: item.related?.map((path) => workspaceUrl(path)),
			})),
		[workspaceUrl],
	);
	const inAgents = items.some(
		(item) => item.title === "Agents" && isActive(item, pathname),
	);

	return (
		<>
			<nav
				aria-label="Primary"
				className="hidden w-14 shrink-0 flex-col items-center gap-1 border-r py-3 md:flex [view-transition-name:app-rail]"
			>
				{items.map((item) => (
					<RailLink
						key={item.href}
						item={item}
						active={isActive(item, pathname)}
					/>
				))}
			</nav>

			<Sheet open={open} onOpenChange={setOpen}>
				{inAgents ? (
					<SheetContent
						side="left"
						showCloseButton={false}
						className="w-5/6 max-w-sm flex-row gap-0 p-0"
					>
						<SheetHeader className="sr-only">
							<SheetTitle>Navigation and agent chats</SheetTitle>
						</SheetHeader>
						<nav
							aria-label="Primary"
							className="flex w-14 shrink-0 flex-col items-center gap-1 border-r py-3"
						>
							<Button
								variant="ghost"
								size="icon"
								aria-label="Close navigation"
								onClick={() => setOpen(false)}
							>
								<Icon icon={Close} />
							</Button>
							<div className="my-1 h-px w-5 bg-border" />
							{items.map((item) => (
								<MobileRailIconLink
									key={item.href}
									item={item}
									active={isActive(item, pathname)}
									onNavigate={() => setOpen(false)}
								/>
							))}
						</nav>
						<AgentBuilderSidebar
							className="flex flex-1"
							onNavigate={() => setOpen(false)}
						/>
					</SheetContent>
				) : (
					<SheetContent side="left" className="w-64 gap-0 p-0">
						<SheetHeader>
							<SheetTitle>Navigation</SheetTitle>
						</SheetHeader>
						<nav
							aria-label="Primary"
							className="flex flex-1 flex-col gap-1 p-2"
						>
							{items.map((item) => (
								<MobileRailLink
									key={item.href}
									item={item}
									active={isActive(item, pathname)}
									onNavigate={() => setOpen(false)}
								/>
							))}
						</nav>
					</SheetContent>
				)}
			</Sheet>
		</>
	);
}
