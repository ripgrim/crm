import { redirect } from "next/navigation";
import { recordHref } from "@/lib/record-href";

export default async function RecordRedirect({
	params,
}: {
	params: Promise<{ slug: string; dealId: string }>;
}) {
	const { slug, dealId } = await params;
	redirect(recordHref(slug, "/deals", "deal", dealId));
}
