import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { DashboardHeader } from "@/components/shared/DashboardHeader";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <div className="min-h-screen">
      <DashboardHeader userName={user.name} />
      <div className="mx-auto max-w-5xl px-4 py-8">{children}</div>
    </div>
  );
}
