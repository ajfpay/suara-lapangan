"use client";

import { Link, usePathname } from "@/i18n/navigation";
import { STEPS } from "@/lib/seo";
import { cn } from "@/lib/utils";

/**
 * Where you are in the three steps.
 *
 * The current step is marked by weight and a rule underneath as well as by
 * colour, so it survives glare and colour-blind vision. Each step is a real
 * link — the steps are pages, and jumping back to one is expected.
 *
 * The active index is read from the URL rather than passed down: layouts do
 * not re-render with the page on the server, so a prop would be right only
 * on first load and wrong after the user moved.
 */
const StepProgress = ({
    locale,
    steps,
    label,
}: {
    locale: string;
    steps: string[];
    label: string;
}) => {
    const pathname = usePathname();
    const activeIndex = STEPS.findIndex((step) => step.path === pathname);

    return (
        <nav aria-label={label} className="border-b border-border">
            <ol className="container flex items-stretch gap-1">
                {STEPS.map((step, index) => {
                    const isCurrent = index === activeIndex;
                    return (
                        <li key={step.messageKey} className="min-w-0 flex-1">
                            <Link
                                href={step.path}
                                locale={locale}
                                aria-current={isCurrent ? "step" : undefined}
                                className={cn(
                                    "flex h-16 flex-col justify-center gap-1 border-b-2 px-1 sm:h-[4.5rem]",
                                    "transition-colors duration-150 ease",
                                    isCurrent
                                        ? "border-primary text-foreground"
                                        : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
                                )}
                            >
                                <span className="text-xs font-medium tabular-nums">
                                    {String(index + 1).padStart(2, "0")}
                                </span>
                                <span
                                    className={cn(
                                        "truncate text-sm sm:text-base",
                                        isCurrent
                                            ? "font-semibold"
                                            : "font-medium"
                                    )}
                                >
                                    {steps[index]}
                                </span>
                            </Link>
                        </li>
                    );
                })}
            </ol>
        </nav>
    );
};

export default StepProgress;
