import type { Metadata } from "next";

import { StepLink, StepScreen, WorkList } from "@/app/components";
import { getMessages } from "@/i18n/messages";
import { languageAlternates, STEPS, stepPath } from "@/lib/seo";

export type LocaleParams = { params: Promise<{ locale: string }> };

type Messages = Record<string, unknown>;
type Copy = Record<string, string>;

/**
 * The shape every step page is assembled from.
 *
 * The three steps differ in copy and in what fills their lists; the chrome —
 * metadata, heading block, the Next / Previous pair, the work list — is the
 * same on all three. It lives here once so a later ticket changes a page's
 * body without re-deriving its frame. The stepper and the FAQ are rendered by
 * the locale layout, so they cannot drift between steps.
 */
export const stepPage = {
    /**
     * Server pages pass their copy to the client step link as plain strings:
     * a translator function cannot cross into a client component.
     */
    async copy(locale: string) {
        const messages = (await getMessages(locale)) as Messages;
        return {
            messages,
            app: messages.app as Copy,
            nav: messages.nav as Copy,
            steps: messages.steps as Copy,
        };
    },

    async metadata(
        params: LocaleParams["params"],
        stepIndex: number
    ): Promise<Metadata> {
        const { locale } = await params;
        const { messages, steps } = await this.copy(locale);
        const meta = (messages.meta ?? {}) as Copy;
        const stepName = steps[STEPS[stepIndex].messageKey];

        const title = (meta.titleTemplate ?? "{step}").replace(
            "{step}",
            stepName
        );

        return {
            title,
            alternates: {
                canonical: stepPath(locale, STEPS[stepIndex].path),
                // Repeated per page: Next replaces `alternates` wholesale when
                // a page sets it, so inheriting the layout's hreflang set would
                // silently drop it.
                languages: languageAlternates(STEPS[stepIndex].path),
            },
            openGraph: {
                title: meta.ogTitle ?? title,
                images: [`/${locale}/opengraph-image`],
            },
            twitter: {
                card: "summary_large_image",
                title: meta.ogTitle ?? title,
                images: [`/${locale}/opengraph-image`],
            },
        };
    },
    next(stepIndex: number, nav: Copy, steps: Copy) {
        const next = STEPS[stepIndex + 1];
        if (!next) return null;

        return (
            <StepLink
                href={next.path}
                direction="next"
                label={(nav.next ?? "").replace(
                    "{step}",
                    steps[next.messageKey]
                )}
            />
        );
    },

    previous(stepIndex: number, nav: Copy, steps: Copy) {
        const previous = STEPS[stepIndex - 1];
        if (!previous) return null;

        return (
            <StepLink
                href={previous.path}
                direction="previous"
                label={(nav.previous ?? "").replace(
                    "{step}",
                    steps[previous.messageKey]
                )}
            />
        );
    },

    workList(copy: Copy) {
        return (
            <WorkList
                title={copy.workItemsTitle}
                emptyTitle={copy.workItemsEmpty}
                emptyBody={copy.workItemsEmptyBody}
            />
        );
    },
};

export { StepScreen };
