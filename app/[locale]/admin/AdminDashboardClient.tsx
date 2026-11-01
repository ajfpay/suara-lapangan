"use client";

import { useState } from "react";
import Link from "next/link";
import { Users, FileText, BarChart3, DollarSign, Settings2, ExternalLink, Check, Ban, CheckCircle2 } from "lucide-react";
import { useTranslations } from "next-intl";
import type { AdminDocument } from "@/lib/server/db/documentStore";
import { cn } from "@/lib/utils";

export type AdminUserRow = {
    id: string;
    email: string;
    name: string;
    role: string;
    banned: boolean;
    ban_reason?: string | null;
    created_at: string;
};

export type AdminUsageRow = {
    userId: string;
    email: string;
    name: string;
    audioSeconds: number;
    tokens: number;
    estCost: number;
};

interface AdminDashboardClientProps {
    locale: string;
    initialUsers: AdminUserRow[];
    documents: AdminDocument[];
    initialUsage: AdminUsageRow[];
    initialLimits: Record<string, number>;
    defaultEnvLimit: number;
}

export function AdminDashboardClient({
    locale,
    initialUsers,
    documents,
    initialUsage,
    initialLimits,
    defaultEnvLimit,
}: AdminDashboardClientProps) {
    const t = useTranslations("admin");
    const [tab, setTab] = useState<"users" | "documents" | "usage" | "limits">("users");

    // Users state
    const [users, setUsers] = useState<AdminUserRow[]>(initialUsers);
    const [togglingUser, setTogglingUser] = useState<string | null>(null);

    // Usage filter state
    const [usage, setUsage] = useState<AdminUsageRow[]>(initialUsage);
    const [startDate, setStartDate] = useState("");
    const [endDate, setEndDate] = useState("");
    const [loadingUsage, setLoadingUsage] = useState(false);

    // Limits state
    const [limits, setLimits] = useState<Record<string, number>>(initialLimits);
    const [limitInputs, setLimitInputs] = useState<Record<string, string>>({});
    const [savingLimit, setSavingLimit] = useState<string | null>(null);
    const [savedNotice, setSavedNotice] = useState<string | null>(null);

    async function handleToggleBan(user: AdminUserRow) {
        setTogglingUser(user.id);
        const nextBanned = !user.banned;
        try {
            const res = await fetch("/api/admin/users", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    userId: user.id,
                    banned: nextBanned,
                    banReason: nextBanned ? "Admin disabled account" : null,
                }),
            });
            if (res.ok) {
                setUsers((prev) =>
                    prev.map((u) =>
                        u.id === user.id ? { ...u, banned: nextBanned } : u
                    )
                );
            }
        } finally {
            setTogglingUser(null);
        }
    }

    async function handleFilterUsage(e: React.FormEvent) {
        e.preventDefault();
        setLoadingUsage(true);
        try {
            const params = new URLSearchParams();
            if (startDate) params.set("start", startDate);
            if (endDate) params.set("end", endDate);

            const res = await fetch(`/api/admin/usage?${params.toString()}`);
            if (res.ok) {
                const data = await res.json();
                setUsage(data.usage || []);
            }
        } finally {
            setLoadingUsage(false);
        }
    }

    async function handleSaveLimit(userId: string) {
        const val = limitInputs[userId];
        const num = parseFloat(val);
        if (isNaN(num) || num < 0) return;

        setSavingLimit(userId);
        try {
            const res = await fetch("/api/admin/limits", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ userId, limit: num }),
            });
            if (res.ok) {
                setLimits((prev) => ({ ...prev, [userId]: num }));
                setSavedNotice(userId);
                setTimeout(() => setSavedNotice(null), 2000);
            }
        } finally {
            setSavingLimit(null);
        }
    }

    function formatCurrency(amount: number) {
        return new Intl.NumberFormat(locale === "en" ? "en-US" : "id-ID", {
            style: "currency",
            currency: "IDR",
            maximumFractionDigits: 0,
        }).format(amount);
    }

    return (
        <div className="container py-8 sm:py-12">
            <div className="mb-8">
                <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                    {t("title")}
                </h1>
                <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
            </div>

            {/* Navigation Tabs */}
            <div className="mb-6 flex flex-wrap items-center gap-2 border-b border-border pb-3">
                <button
                    type="button"
                    data-testid="tab-users"
                    onClick={() => setTab("users")}
                    className={cn(
                        "inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium transition",
                        tab === "users"
                            ? "bg-primary text-primary-foreground shadow-sm"
                            : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                >
                    <Users className="h-4 w-4" />
                    <span>{t("tabUsers")}</span>
                    <span className="rounded-full bg-background/20 px-1.5 py-0.5 text-xs">
                        {users.length}
                    </span>
                </button>

                <button
                    type="button"
                    data-testid="tab-documents"
                    onClick={() => setTab("documents")}
                    className={cn(
                        "inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium transition",
                        tab === "documents"
                            ? "bg-primary text-primary-foreground shadow-sm"
                            : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                >
                    <FileText className="h-4 w-4" />
                    <span>{t("tabDocuments")}</span>
                    <span className="rounded-full bg-background/20 px-1.5 py-0.5 text-xs">
                        {documents.length}
                    </span>
                </button>

                <button
                    type="button"
                    data-testid="tab-usage"
                    onClick={() => setTab("usage")}
                    className={cn(
                        "inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium transition",
                        tab === "usage"
                            ? "bg-primary text-primary-foreground shadow-sm"
                            : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                >
                    <BarChart3 className="h-4 w-4" />
                    <span>{t("tabUsage")}</span>
                </button>

                <button
                    type="button"
                    data-testid="tab-limits"
                    onClick={() => setTab("limits")}
                    className={cn(
                        "inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium transition",
                        tab === "limits"
                            ? "bg-primary text-primary-foreground shadow-sm"
                            : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                >
                    <DollarSign className="h-4 w-4" />
                    <span>{t("tabLimits")}</span>
                </button>

                <Link
                    href={`/${locale}/admin/providers`}
                    data-testid="tab-providers"
                    className="inline-flex items-center gap-2 rounded-xl border border-dashed border-border bg-background px-3.5 py-2 text-sm font-medium text-muted-foreground hover:border-primary hover:text-foreground transition"
                >
                    <Settings2 className="h-4 w-4" />
                    <span>{t("tabProviders")}</span>
                    <span className="rounded bg-muted px-1.5 py-0.2 text-[10px] uppercase font-semibold text-muted-foreground">
                        Placeholder
                    </span>
                </Link>
            </div>

            {/* TAB 1: USERS */}
            {tab === "users" && (
                <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm" data-testid="table-admin-users">
                            <thead className="border-b border-border bg-muted/40 text-xs font-semibold uppercase text-muted-foreground">
                                <tr>
                                    <th className="px-4 py-3.5 sm:px-6">{t("userEmail")}</th>
                                    <th className="px-4 py-3.5 sm:px-6">{t("userName")}</th>
                                    <th className="px-4 py-3.5 sm:px-6">{t("userRole")}</th>
                                    <th className="px-4 py-3.5 sm:px-6">{t("userStatus")}</th>
                                    <th className="px-4 py-3.5 sm:px-6">{t("userCreated")}</th>
                                    <th className="px-4 py-3.5 text-right sm:px-6">{t("userActions")}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {users.map((u) => (
                                    <tr key={u.id} className="transition hover:bg-muted/30">
                                        <td className="px-4 py-3.5 font-medium sm:px-6">{u.email}</td>
                                        <td className="px-4 py-3.5 text-muted-foreground sm:px-6">{u.name}</td>
                                        <td className="px-4 py-3.5 sm:px-6">
                                            <span
                                                className={cn(
                                                    "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium uppercase",
                                                    u.role === "admin"
                                                        ? "bg-primary/10 text-primary font-bold"
                                                        : "bg-muted text-muted-foreground"
                                                )}
                                            >
                                                {u.role}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3.5 sm:px-6">
                                            <span
                                                className={cn(
                                                    "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
                                                    u.banned
                                                        ? "bg-destructive/10 text-destructive"
                                                        : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                                )}
                                            >
                                                {u.banned ? t("banned") : t("active")}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3.5 text-xs text-muted-foreground sm:px-6">
                                            {new Date(u.created_at).toLocaleDateString(
                                                locale === "en" ? "en-US" : "id-ID"
                                            )}
                                        </td>
                                        <td className="px-4 py-3.5 text-right sm:px-6">
                                            {u.role !== "admin" && (
                                                <button
                                                    type="button"
                                                    data-testid={`btn-toggle-ban-${u.id}`}
                                                    disabled={togglingUser === u.id}
                                                    onClick={() => handleToggleBan(u)}
                                                    className={cn(
                                                        "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition",
                                                        u.banned
                                                            ? "border border-border bg-background text-foreground hover:bg-accent"
                                                            : "bg-destructive/10 text-destructive hover:bg-destructive/20"
                                                    )}
                                                >
                                                    {u.banned ? (
                                                        <>
                                                            <Check className="h-3 w-3" />
                                                            <span>{t("unban")}</span>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <Ban className="h-3 w-3" />
                                                            <span>{t("ban")}</span>
                                                        </>
                                                    )}
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* TAB 2: DOCUMENTS */}
            {tab === "documents" && (
                <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm" data-testid="table-admin-documents">
                            <thead className="border-b border-border bg-muted/40 text-xs font-semibold uppercase text-muted-foreground">
                                <tr>
                                    <th className="px-4 py-3.5 sm:px-6">{t("docNomor")}</th>
                                    <th className="px-4 py-3.5 sm:px-6">{t("docUser")}</th>
                                    <th className="px-4 py-3.5 sm:px-6">{t("docDate")}</th>
                                    <th className="px-4 py-3.5 sm:px-6">{t("docTotal")}</th>
                                    <th className="px-4 py-3.5 sm:px-6">{t("docStatus")}</th>
                                    <th className="px-4 py-3.5 text-right sm:px-6">{t("userActions")}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {documents.map((doc) => {
                                    const total = doc.document.total_nominal ?? 0;
                                    const tanggal =
                                        doc.document.tanggal ||
                                        new Date(doc.createdAt).toLocaleDateString(
                                            locale === "en" ? "en-US" : "id-ID"
                                        );

                                    return (
                                        <tr key={doc.id} className="transition hover:bg-muted/30">
                                            <td className="px-4 py-3.5 font-mono font-medium sm:px-6">
                                                <Link
                                                    href={`/${locale}/dokumen?doc=${doc.id}`}
                                                    className="text-primary hover:underline"
                                                >
                                                    {doc.nomor}
                                                </Link>
                                            </td>
                                            <td className="px-4 py-3.5 sm:px-6">
                                                {doc.userEmail ? (
                                                    <div>
                                                        <div className="font-medium">{doc.userName || "—"}</div>
                                                        <div className="text-xs text-muted-foreground">{doc.userEmail}</div>
                                                    </div>
                                                ) : (
                                                    <span className="italic text-muted-foreground">(Tanpa Pemilik / Legacy)</span>
                                                )}
                                            </td>
                                            <td className="px-4 py-3.5 text-muted-foreground sm:px-6">
                                                {tanggal}
                                            </td>
                                            <td className="px-4 py-3.5 font-medium sm:px-6">
                                                {formatCurrency(total)}
                                            </td>
                                            <td className="px-4 py-3.5 sm:px-6">
                                                <span
                                                    className={cn(
                                                        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
                                                        doc.status === "perlu_konfirmasi" &&
                                                            "bg-amber-500/10 text-amber-600 dark:text-amber-400",
                                                        doc.status === "siap" &&
                                                            "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
                                                        doc.status === "terkirim" &&
                                                            "bg-blue-500/10 text-blue-600 dark:text-blue-400"
                                                    )}
                                                >
                                                    {doc.status}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3.5 text-right sm:px-6">
                                                <a
                                                    href={`/api/documents/${doc.id}/pdf`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    data-testid={`btn-admin-pdf-${doc.id}`}
                                                    className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground hover:bg-accent"
                                                >
                                                    <span>{t("viewPdf")}</span>
                                                    <ExternalLink className="h-3 w-3" />
                                                </a>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* TAB 3: USAGE */}
            {tab === "usage" && (
                <div className="space-y-6">
                    {/* Date filter form */}
                    <form
                        onSubmit={handleFilterUsage}
                        className="flex flex-wrap items-end gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm"
                    >
                        <div>
                            <label className="mb-1 block text-xs font-semibold uppercase text-muted-foreground">
                                {t("startDate")}
                            </label>
                            <input
                                type="date"
                                data-testid="input-start-date"
                                value={startDate}
                                onChange={(e) => setStartDate(e.target.value)}
                                className="rounded-xl border border-border bg-background px-3 py-1.5 text-sm"
                            />
                        </div>
                        <div>
                            <label className="mb-1 block text-xs font-semibold uppercase text-muted-foreground">
                                {t("endDate")}
                            </label>
                            <input
                                type="date"
                                data-testid="input-end-date"
                                value={endDate}
                                onChange={(e) => setEndDate(e.target.value)}
                                className="rounded-xl border border-border bg-background px-3 py-1.5 text-sm"
                            />
                        </div>
                        <button
                            type="submit"
                            disabled={loadingUsage}
                            data-testid="btn-filter-usage"
                            className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                        >
                            {loadingUsage ? "..." : t("filterDate")}
                        </button>
                    </form>

                    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-sm" data-testid="table-admin-usage">
                                <thead className="border-b border-border bg-muted/40 text-xs font-semibold uppercase text-muted-foreground">
                                    <tr>
                                        <th className="px-4 py-3.5 sm:px-6">{t("usageUser")}</th>
                                        <th className="px-4 py-3.5 sm:px-6">{t("usageSeconds")}</th>
                                        <th className="px-4 py-3.5 sm:px-6">{t("usageTokens")}</th>
                                        <th className="px-4 py-3.5 text-right sm:px-6">{t("usageEstCost")}</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border">
                                    {usage.map((row) => (
                                        <tr key={row.userId} className="transition hover:bg-muted/30">
                                            <td className="px-4 py-3.5 font-medium sm:px-6">
                                                <div>{row.name}</div>
                                                <div className="text-xs text-muted-foreground">{row.email}</div>
                                            </td>
                                            <td className="px-4 py-3.5 sm:px-6">
                                                {row.audioSeconds.toFixed(1)}s
                                            </td>
                                            <td className="px-4 py-3.5 sm:px-6">
                                                {row.tokens.toLocaleString()}
                                            </td>
                                            <td className="px-4 py-3.5 text-right font-mono font-medium sm:px-6">
                                                ${row.estCost.toFixed(4)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            {/* TAB 4: COST LIMITS */}
            {tab === "limits" && (
                <div className="space-y-4">
                    <div className="rounded-2xl border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
                        {t("limitDefaultEnv", { amount: defaultEnvLimit.toFixed(2) })}
                    </div>

                    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-sm" data-testid="table-admin-limits">
                                <thead className="border-b border-border bg-muted/40 text-xs font-semibold uppercase text-muted-foreground">
                                    <tr>
                                        <th className="px-4 py-3.5 sm:px-6">{t("limitUser")}</th>
                                        <th className="px-4 py-3.5 sm:px-6">{t("limitCurrent")}</th>
                                        <th className="px-4 py-3.5 text-right sm:px-6">{t("userActions")}</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border">
                                    {users.map((u) => {
                                        const currentLimit = limits[u.id];
                                        const inputVal =
                                            limitInputs[u.id] !== undefined
                                                ? limitInputs[u.id]
                                                : currentLimit !== undefined
                                                ? String(currentLimit)
                                                : "";

                                        return (
                                            <tr key={u.id} className="transition hover:bg-muted/30">
                                                <td className="px-4 py-3.5 font-medium sm:px-6">
                                                    <div>{u.name}</div>
                                                    <div className="text-xs text-muted-foreground">{u.email}</div>
                                                </td>
                                                <td className="px-4 py-3.5 sm:px-6">
                                                    <span className="font-mono text-sm">
                                                        {currentLimit !== undefined
                                                            ? `$${currentLimit.toFixed(2)}`
                                                            : `Default ($${defaultEnvLimit.toFixed(2)})`}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3.5 text-right sm:px-6">
                                                    <div className="flex items-center justify-end gap-2">
                                                        <input
                                                            type="number"
                                                            step="0.01"
                                                            min="0"
                                                            placeholder={defaultEnvLimit.toFixed(2)}
                                                            data-testid={`input-limit-${u.id}`}
                                                            value={inputVal}
                                                            onChange={(e) =>
                                                                setLimitInputs((prev) => ({
                                                                    ...prev,
                                                                    [u.id]: e.target.value,
                                                                }))
                                                            }
                                                            className="w-24 rounded-lg border border-border bg-background px-2.5 py-1 text-sm font-mono"
                                                        />
                                                        <button
                                                            type="button"
                                                            disabled={savingLimit === u.id || !inputVal}
                                                            data-testid={`btn-save-limit-${u.id}`}
                                                            onClick={() => handleSaveLimit(u.id)}
                                                            className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                                                        >
                                                            {savedNotice === u.id ? (
                                                                <>
                                                                    <CheckCircle2 className="h-3 w-3" />
                                                                    <span>{t("saved")}</span>
                                                                </>
                                                            ) : (
                                                                <span>{t("save")}</span>
                                                            )}
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
