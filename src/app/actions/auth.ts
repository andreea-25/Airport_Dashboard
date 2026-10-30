"use server";
import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { createSession, destroySession } from "@/lib/auth";
import { ro } from "@/lib/i18n/ro";

export async function loginAction(_prev: { error?: string } | undefined, formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const user = await prisma.user.findUnique({ where: { email }, include: { employee: true } });
  if (!user || !(await bcrypt.compare(password, user.passwordHash)) || (user.employee && !user.employee.active)) {
    return { error: ro.auth.invalid };
  }
  await createSession({ userId: user.id, role: user.role, employeeId: user.employeeId, email: user.email });
  redirect(user.role === "ADMIN" ? "/admin/today" : "/shifts");
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}
