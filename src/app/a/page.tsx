import { notFound } from "next/navigation";
import { getReport, DEFAULT_DOC_NO } from "@/lib/data";
import { requireSession } from "@/lib/auth";
import { ClassicView } from "@/components/screens/ClassicView";
import { ScreenFrame } from "@/components/ScreenFrame";

export const dynamic = "force-dynamic";

export default async function ClassicPage() {
  const session = await requireSession();
  const report = await getReport(DEFAULT_DOC_NO);
  if (!report) notFound();
  return (
    <ScreenFrame code="A" title="정통 결재함" session={session} width={1180}>
      <ClassicView report={report} />
    </ScreenFrame>
  );
}
