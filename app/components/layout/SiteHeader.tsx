import { getTranslations } from "next-intl/server";

import { LocaleSwitcher } from "@/app/components";
import { UserMenu } from "./UserMenu";
import { Link } from "@/i18n/navigation";

/**
 * Brand and language. Deliberately empty of product navigation: the only
 * places to go are the three steps, in order, and those live in the stepper.
 * The mark is drawn in CSS so it needs no image request on the first paint.
 */
const SiteHeader = async () => {
    const t = await getTranslations("brand");

    return (
        <header className="bg-background">
            <div className="container flex h-16 items-center justify-between gap-4">
                <Link
                    href="/"
                    aria-label={t("home")}
                    className="flex items-center gap-2.5 rounded-md"
                >
                    <span
                        aria-hidden="true"
                        className="grid h-9 w-9 place-items-center rounded-[10px] bg-accent text-accent-foreground"
                    >
                        <svg
                            viewBox="0 0 40 40"
                            className="h-[22px] w-[22px]"
                            fill="none"
                        >
                            <path
                                d="M20 11v10"
                                stroke="currentColor"
                                strokeWidth="2.6"
                                strokeLinecap="round"
                            />
                            <path
                                d="M13.5 19a6.5 6.5 0 0 0 13 0"
                                stroke="currentColor"
                                strokeWidth="2.6"
                                strokeLinecap="round"
                            />
                            <path
                                d="M20 30h6.5"
                                stroke="currentColor"
                                strokeWidth="2.6"
                                strokeLinecap="round"
                            />
                        </svg>
                    </span>
                    <span className="text-base font-semibold tracking-tight sm:text-lg">
                        {t("name")}
                    </span>
                </Link>

                <div className="flex items-center gap-2 sm:gap-3">
                    <LocaleSwitcher />
                    <UserMenu />
                </div>
            </div>
        </header>
    );
};

export default SiteHeader;
