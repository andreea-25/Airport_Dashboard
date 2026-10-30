import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { ro } from "@/lib/i18n/ro";
import Chat from "@/components/Chat";

export default async function AssistantPage() {
  const s = await requireSession();
  if (!s.employeeId) redirect("/admin/simulation");
  return (
    <div className="mx-auto max-w-4xl space-y-3">
      <div>
        <h1 className="h1">{ro.assistant.title}</h1>
        <p className="muted">{ro.assistant.subtitle}</p>
      </div>
      <Chat />
    </div>
  );
}
