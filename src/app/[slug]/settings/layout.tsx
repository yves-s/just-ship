import Link from "next/link";
import { cn } from "@/lib/utils";

interface SettingsLayoutProps {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}

async function SettingsNav({ slug }: { slug: string }) {
  const navItems = [
    { label: "General", href: `/${slug}/settings` },
    { label: "Members", href: `/${slug}/settings/members` },
    { label: "API Keys", href: `/${slug}/settings/api-keys` },
  ];

  return (
    <nav className="flex flex-col gap-1 w-48 shrink-0">
      {navItems.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={cn(
            "rounded-md px-3 py-2 text-sm font-medium transition-colors",
            "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
          )}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
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
          <div className="flex-1">{children}</div>
        </div>
      </div>
    </div>
  );
}
