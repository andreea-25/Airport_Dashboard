import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";

export default async function Home() {
  const s = await requireSession();
  redirect(s.role === "ADMIN" ? "/admin/today" : "/shifts");
}
