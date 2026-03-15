import { SettingsNav } from "@/components/settings/settings-nav";
import { WorkspaceIdentityHeader } from "@/components/settings/workspace-identity-header";

interface SettingsLayoutProps {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}

export default async function SettingsLayout({
  children,
  params,
}: SettingsLayoutProps) {
  const { slug } = await params;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <WorkspaceIdentityHeader />
      <SettingsNav slug={slug} />
      <div className="flex-1 overflow-auto">
        <div className="mx-auto w-full max-w-5xl px-6 py-6">
          {children}
        </div>
      </div>
    </div>
  );
}
