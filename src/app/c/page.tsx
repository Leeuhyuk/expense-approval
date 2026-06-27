import { notFound } from "next/navigation";
import { getReport, DEFAULT_DOC_NO } from "@/lib/data";
import { requireSession } from "@/lib/auth";
import { LedgerView } from "@/components/screens/LedgerView";
import { ScreenFrame } from "@/components/ScreenFrame";

export const dynamic = "force-dynamic";

export default async function LedgerPage() {
  const session = await requireSession();
  const report = await getReport(DEFAULT_DOC_NO);
  if (!report) notFound();
  return (
    <ScreenFrame code="C" title="원장형 / 커맨드" session={session} width={1240}>
      <LedgerView report={report} />
    </ScreenFrame>
  );
}
