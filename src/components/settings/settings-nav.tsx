"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

interface SettingsNavProps {
  slug: string;
}

export function SettingsNav({ slug }: SettingsNavProps) {
  const pathname = usePathname();

  const navItems = [
    { label: "General", href: `/${slug}/settings` },
    { label: "Projects", href: `/${slug}/settings/projects` },
    { label: "Members", href: `/${slug}/settings/members` },
    { label: "API Keys", href: `/${slug}/settings/api-keys` },
  ];

  return (
    <nav className="flex flex-col gap-1 w-48 shrink-0">
      {navItems.map((item) => {
        // For "General" use exact match, for others use startsWith
        const isActive =
          item.href === `/${slug}/settings`
            ? pathname === item.href
            : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "rounded-md px-3 py-2 text-sm font-medium transition-colors",
              isActive
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
