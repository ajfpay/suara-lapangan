import { getTranslations } from "next-intl/server";

import { buildFaqJsonLd } from "@/lib/seo";

/** The four questions every step answers, with matching FAQPage data. */
const Faq = async () => {
    const t = await getTranslations();
    const faqs = [1, 2, 3, 4].map((n) => ({
        q: t(`faq.q${n}`),
        a: t(`faq.a${n}`),
    }));

    return (
        <section aria-labelledby="faq-title" className="container mt-20">
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{
                    __html: JSON.stringify(buildFaqJsonLd(faqs)),
                }}
            />
            <h2
                id="faq-title"
                className="font-display text-2xl font-semibold tracking-tight"
            >
                {t("app.faqTitle")}
            </h2>
            <dl className="mt-6 grid gap-x-10 gap-y-6 sm:grid-cols-2">
                {faqs.map(({ q, a }) => (
                    <div key={q}>
                        <dt className="font-semibold">{q}</dt>
                        <dd className="mt-1.5 leading-relaxed text-muted-foreground">
                            {a}
                        </dd>
                    </div>
                ))}
            </dl>
        </section>
    );
};

export default Faq;
