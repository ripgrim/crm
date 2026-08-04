import { redirect } from "next/navigation";
import { recordHref } from "@/lib/record-href";

export default async function RecordRedirect({
	params,
}: {
	params: Promise<{ slug: string; companyId: string }>;
}) {
	const { slug, companyId } = await params;
	redirect(recordHref(slug, "/companies", "company", companyId));
}
