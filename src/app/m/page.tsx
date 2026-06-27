import { notFound } from "next/navigation";
import { getReport, DEFAULT_DOC_NO } from "@/lib/data";
import { requireSession } from "@/lib/auth";
import { MobileView } from "@/components/screens/MobileView";
import { ScreenFrame } from "@/components/ScreenFrame";

export const dynamic = "force-dynamic";

export default async function MobilePage() {
  const session = await requireSession();
  const report = await getReport(DEFAULT_DOC_NO);
  if (!report) notFound();
  return (
    <ScreenFrame code="M" title="모바일 빠른 결재" session={session} width={390}>
      <MobileView report={report} />
    </ScreenFrame>
  );
}
