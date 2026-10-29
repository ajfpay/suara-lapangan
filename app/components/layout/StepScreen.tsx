import { cn } from "@/lib/utils";

/**
 * One placeholder page of the flow.
 *
 * The heading is the step's name — Rekam, Susun, Dokumen — because that is what
 * a worker scans for when returning to the app mid-job; the sentence under it
 * says what happens here, and the line under that explains it. Later tickets
 * fill the body rather than replace the shape.
 *
 * Type is large and the contrast high on purpose: this is read at arm's length,
 * outdoors, often with the sun behind the screen.
 */
const StepScreen = ({
    stepOf,
    heading,
    title,
    body,
    children,
    actions,
}: {
    stepOf: string;
    heading: string;
    title: string;
    body: string;
    children?: React.ReactNode;
    actions?: React.ReactNode;
}) => {
    return (
        <main id="main" className="container py-10 sm:py-14">
            <section className="max-w-2xl">
                <p className="text-sm font-semibold uppercase tracking-[0.14em] text-primary">
                    {stepOf}
                </p>
                <h1
                    className={cn(
                        "font-display mt-3 text-5xl font-bold leading-[1.05] tracking-tight",
                        "sm:text-6xl"
                    )}
                >
                    {heading}
                </h1>
                <p className="mt-5 text-2xl font-semibold leading-snug sm:text-3xl">
                    {title}
                </p>
                <p className="mt-3 text-lg leading-relaxed text-muted-foreground sm:text-xl">
                    {body}
                </p>

                {actions && (
                    <div className="mt-8 flex flex-col-reverse items-stretch gap-3 sm:flex-row-reverse sm:items-center sm:justify-end">
                        {actions}
                    </div>
                )}
            </section>

            {children}
        </main>
    );
};

export default StepScreen;