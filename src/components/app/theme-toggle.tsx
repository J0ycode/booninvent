"use client";

import { useTheme } from "next-themes";
import { Moon, Sun, Monitor } from "lucide-react";
import { Button } from "@/components/ui/button";

const NEXT = { system: "light", light: "dark", dark: "system" } as const;
const LABEL = { system: "Theme: follows system", light: "Theme: light", dark: "Theme: dark" } as const;

export function ThemeToggle() {
  const { theme = "system", setTheme } = useTheme();
  const t = (theme in NEXT ? theme : "system") as keyof typeof NEXT;
  const Icon = t === "light" ? Sun : t === "dark" ? Moon : Monitor;
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(NEXT[t])}
      aria-label={`${LABEL[t]}. Change theme`}
      title={LABEL[t]}
      suppressHydrationWarning
    >
      <Icon />
    </Button>
  );
}
