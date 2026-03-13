import { SettingsNav } from "@/components/settings/settings-nav";

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
      <div className="flex items-center border-b px-6 py-4">
        <h1 className="text-sm font-semibold">Settings</h1>
      </div>
      <div className="flex flex-1 overflow-auto">
        <div className="flex w-full max-w-4xl gap-8 px-6 py-6 mx-auto">
          <SettingsNav slug={slug} />
          <div className="flex-1 min-w-0">{children}</div>
        </div>
      </div>
    </div>
  );
}
