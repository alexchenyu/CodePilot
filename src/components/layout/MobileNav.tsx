"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useCallback, useSyncExternalStore } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Message02Icon,
  GridIcon,
  Settings02Icon,
  Moon02Icon,
  Sun02Icon,
} from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";

interface MobileNavProps {
  chatListOpen: boolean;
  onToggleChatList: () => void;
  skipPermissionsActive?: boolean;
}

const navItems = [
  { href: "/chat", label: "Chats", icon: Message02Icon },
  { href: "/extensions", label: "Extensions", icon: GridIcon },
  { href: "/settings", label: "Settings", icon: Settings02Icon },
] as const;

export function MobileNav({ chatListOpen, onToggleChatList, skipPermissionsActive }: MobileNavProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const emptySubscribe = useCallback(() => () => {}, []);
  const mounted = useSyncExternalStore(emptySubscribe, () => true, () => false);
  const isChatRoute = pathname === "/chat" || pathname.startsWith("/chat/");

  return (
    <nav className="flex shrink-0 items-center justify-around border-t border-border/50 bg-sidebar px-2 pb-[env(safe-area-inset-bottom)] z-50">
      {navItems.map((item) => {
        const isActive =
          item.href === "/chat"
            ? isChatRoute || chatListOpen
            : item.href === "/extensions"
              ? pathname.startsWith("/extensions")
              : pathname === item.href || pathname.startsWith(item.href + "?");

        return item.href === "/chat" ? (
          <button
            key={item.href}
            className={cn(
              "relative flex flex-col items-center gap-0.5 px-3 py-2.5 text-muted-foreground transition-colors",
              isActive && "text-sidebar-accent-foreground"
            )}
            onClick={() => {
              if (!isChatRoute) {
                router.push("/chat");
                // Open chat list after navigation
                setTimeout(() => onToggleChatList(), 50);
              } else {
                onToggleChatList();
              }
            }}
          >
            <HugeiconsIcon icon={item.icon} className="h-5 w-5" />
            <span className="text-[10px] font-medium">{item.label}</span>
            {skipPermissionsActive && (
              <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-orange-500" />
            )}
          </button>
        ) : (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex flex-col items-center gap-0.5 px-3 py-2.5 text-muted-foreground transition-colors",
              isActive && "text-sidebar-accent-foreground"
            )}
          >
            <HugeiconsIcon icon={item.icon} className="h-5 w-5" />
            <span className="text-[10px] font-medium">{item.label}</span>
          </Link>
        );
      })}

      {/* Theme toggle */}
      {mounted && (
        <button
          className="flex flex-col items-center gap-0.5 px-3 py-2.5 text-muted-foreground transition-colors"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        >
          <HugeiconsIcon
            icon={theme === "dark" ? Sun02Icon : Moon02Icon}
            className="h-5 w-5"
          />
          <span className="text-[10px] font-medium">Theme</span>
        </button>
      )}
    </nav>
  );
}
