import { notFound } from "next/navigation";
import { getReport, DEFAULT_DOC_NO } from "@/lib/data";
import { requireSession } from "@/lib/auth";
import { PipelineView } from "@/components/screens/PipelineView";
import { ScreenFrame } from "@/components/ScreenFrame";

export const dynamic = "force-dynamic";

export default async function PipelinePage() {
  const session = await requireSession();
  const report = await getReport(DEFAULT_DOC_NO);
  if (!report) notFound();
  return (
    <ScreenFrame code="B" title="워크플로우 중심" session={session} width={1240}>
      <PipelineView report={report} />
    </ScreenFrame>
  );
}
