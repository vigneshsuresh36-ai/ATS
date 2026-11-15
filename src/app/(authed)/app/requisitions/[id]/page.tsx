import AppShell from "@/components/AppShell";

export default async function RoleDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  return <AppShell initialRoleId={(await params).id} />;
}
