"use client";

import { usePathname } from "@/i18n/navigation";

export default function HideOnLanding({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    return pathname === "/" ? null : children;
}
