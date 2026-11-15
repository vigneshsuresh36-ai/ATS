import AppShell from "@/components/AppShell";

export default async function FullJobDescriptionPage({ params }: { params: Promise<{ id: string }> }) { return <AppShell jobDescriptionId={(await params).id} />; }
