import { getTranslations } from "next-intl/server";
import Link from "next/link";

/**
 * The licence trail: this app stands on MIT-licensed work, and that notice has
 * to be reachable from the product, not only from the repository.
 */
const SiteFooter = async () => {
    const t = await getTranslations("footer");

    return (
        <footer className="mt-16 border-t border-border">
            <div className="container flex flex-col gap-2 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                <p>{t("builtOn")}</p>
                <nav className="flex gap-5">
                    <Link
                        href="/LICENSE"
                        className="underline underline-offset-4 transition-colors duration-150 hover:text-foreground"
                    >
                        {t("license")}
                    </Link>
                    <Link
                        href="/THIRD-PARTY.md"
                        className="underline underline-offset-4 transition-colors duration-150 hover:text-foreground"
                    >
                        {t("thirdParty")}
                    </Link>
                </nav>
            </div>
        </footer>
    );
};

export default SiteFooter;
