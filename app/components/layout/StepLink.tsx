import { ArrowLeft, ArrowRight } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

/**
 * The only way between the three steps.
 *
 * A step is a page with its own address, not local state, so the back button,
 * a reload and a shared link all land where the user left off. It is a real
 * anchor — next-intl's `Link` adds the current locale — so it opens in a new
 * tab, previews on hover, and is announced as navigation rather than as a
 * button that happens to navigate.
 *
 * Press feedback is a 97% scale over 150ms with a strong ease-out: it reads as
 * the control answering the thumb, and it is the only motion on the page.
 */
const StepLink = ({
    href,
    label,
    direction,
}: {
    href: string;
    label: string;
    direction: "next" | "previous";
}) => {
    const isNext = direction === "next";
    const Arrow = isNext ? ArrowRight : ArrowLeft;

    return (
        <Link
            href={href}
            className={cn(
                "inline-flex items-center justify-center gap-3 rounded-xl font-semibold",
                "transition-[transform,background-color,border-color] duration-150 ease-out",
                "active:scale-[0.97]",
                isNext
                    ? "min-h-[6rem] w-full bg-primary px-6 text-lg text-primary-foreground hover:bg-primary/90 sm:min-h-[7rem] sm:w-auto sm:min-w-80 sm:text-xl"
                    : "min-h-14 border border-border bg-card px-5 text-base text-foreground hover:border-foreground/30"
            )}
        >
            {!isNext && <Arrow aria-hidden="true" className="h-5 w-5" />}
            {label}
            {isNext && <Arrow aria-hidden="true" className="h-6 w-6" />}
        </Link>
    );
};

export default StepLink;