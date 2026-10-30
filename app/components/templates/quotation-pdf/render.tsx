import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import QuotationTemplate from "./QuotationTemplate";
import type { QuotationDocument } from "@/lib/server/guard/types";

export function renderQuotationHtml(doc: QuotationDocument): string {
    return renderToStaticMarkup(<QuotationTemplate doc={doc} />);
}
