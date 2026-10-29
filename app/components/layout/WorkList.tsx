import { cn } from "@/lib/utils";

/** The list a step will fill. Empty until the recording exists, and says so. */
const WorkList = ({
    title,
    emptyTitle,
    emptyBody,
}: {
    title: string;
    emptyTitle: string;
    emptyBody: string;
}) => {
    return (
        <section aria-labelledby="work-list-title" className="mt-12">
            <h2
                id="work-list-title"
                className="text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground"
            >
                {title}
            </h2>

            <div
                className={cn(
                    "mt-4 rounded-2xl border-2 border-dashed border-border px-6 py-10 text-center"
                )}
            >
                <p className="text-lg font-semibold">{emptyTitle}</p>
                <p className="mx-auto mt-2 max-w-md text-muted-foreground">
                    {emptyBody}
                </p>
            </div>
        </section>
    );
};

export default WorkList;
