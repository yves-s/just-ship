"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

interface SettingsNavProps {
  slug: string;
}

const TABS = [
  { label: "Overview", href: (slug: string) => `/${slug}/settings` },
  { label: "Projects", href: (slug: string) => `/${slug}/settings/projects` },
  { label: "Members", href: (slug: string) => `/${slug}/settings/members` },
  { label: "API Keys", href: (slug: string) => `/${slug}/settings/api-keys` },
  { label: "General", href: (slug: string) => `/${slug}/settings/general` },
];

export function SettingsNav({ slug }: SettingsNavProps) {
  const pathname = usePathname();

  return (
    <nav className="flex overflow-x-auto border-b px-6">
      {TABS.map((tab) => {
        const href = tab.href(slug);
        // Overview: exact match only (must not match /settings/general etc.)
        // Other tabs: startsWith match
        const isActive =
          href === `/${slug}/settings`
            ? pathname === href
            : pathname.startsWith(href);

        return (
          <Link
            key={tab.label}
            href={href}
            className={cn(
              "shrink-0 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors",
              isActive
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
