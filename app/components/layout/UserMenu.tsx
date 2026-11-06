"use client";

import { useState, useRef, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { LogOut, FileText, Shield, ChevronDown } from "lucide-react";
import { useSession, signOut } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

export function UserMenu() {
    const t = useTranslations("auth");
    const params = useParams();
    const router = useRouter();
    const locale = String(params.locale ?? "id");

    const { data: session, isPending } = useSession();
    const [open, setOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        function handleClickOutside(e: MouseEvent) {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    if (isPending) {
        return (
            <div className="h-9 w-20 animate-pulse rounded-full bg-muted" />
        );
    }

    if (!session?.user) {
        return (
            <Link
                href={`/${locale}/login`}
                data-testid="link-login"
                className={cn(
                    "inline-flex h-10 items-center justify-center rounded-full border border-border bg-card px-4 text-sm font-medium text-foreground",
                    "transition-[background-color,color,transform] duration-150 ease-out",
                    "hover:bg-accent hover:text-accent-foreground active:scale-[0.97]"
                )}
            >
                {t("login")}
            </Link>
        );
    }

    const user = session.user;
    const isAdmin = (user as { role?: string }).role === "admin";
    const initials = (user.name || user.email || "U")
        .slice(0, 2)
        .toUpperCase();

    async function handleLogout() {
        setOpen(false);
        await signOut({
            fetchOptions: {
                onSuccess: () => {
                    router.push(`/${locale}/login`);
                },
            },
        });
    }

    return (
        <div className="relative" ref={menuRef}>
            <button
                type="button"
                data-testid="user-menu-button"
                aria-expanded={open}
                aria-haspopup="menu"
                onClick={() => setOpen((prev) => !prev)}
                className={cn(
                    "flex items-center gap-2 rounded-full border border-border bg-card p-1 pr-3 text-sm font-medium text-foreground",
                    "transition-[background-color,color,transform] duration-150 ease-out",
                    "hover:bg-accent hover:text-accent-foreground active:scale-[0.97]"
                )}
            >
                <span className="grid h-8 w-8 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                    {initials}
                </span>
                {/* The name stays desktop-only: brand + switcher + chip only
                    fit a 375px header when the chip collapses to the avatar. */}
                <span className="hidden max-w-[100px] truncate text-xs sm:block sm:max-w-[140px] sm:text-sm">
                    {user.name || user.email}
                </span>
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            </button>

            {open && (
                <div
                    data-testid="user-menu-dropdown"
                    className="absolute right-0 mt-2 w-56 rounded-xl border border-border bg-card p-2 shadow-lg z-50 animate-in fade-in zoom-in-95 duration-100"
                >
                    <div className="border-b border-border px-3 py-2">
                        <p className="truncate text-sm font-semibold">{user.name}</p>
                        <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                    </div>

                    <div className="py-1">
                        <Link
                            href={`/${locale}/dokumen/saya`}
                            data-testid="link-dokumen-saya"
                            onClick={() => setOpen(false)}
                            className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-foreground hover:bg-accent hover:text-accent-foreground"
                        >
                            <FileText className="h-4 w-4 text-muted-foreground" />
                            <span>{t("myDocuments")}</span>
                        </Link>

                        {isAdmin && (
                            <Link
                                href={`/${locale}/admin`}
                                data-testid="link-admin"
                                onClick={() => setOpen(false)}
                                className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-foreground hover:bg-accent hover:text-accent-foreground"
                            >
                                <Shield className="h-4 w-4 text-primary" />
                                <span>{t("admin")}</span>
                            </Link>
                        )}
                    </div>

                    <div className="border-t border-border pt-1">
                        <button
                            type="button"
                            data-testid="btn-logout"
                            onClick={handleLogout}
                            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-destructive hover:bg-destructive/10"
                        >
                            <LogOut className="h-4 w-4" />
                            <span>{t("logout")}</span>
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
