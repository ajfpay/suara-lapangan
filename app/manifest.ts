import type { MetadataRoute } from "next";

import { APP_NAME } from "@/lib/variables";

export default function manifest(): MetadataRoute.Manifest {
    return {
        name: `${APP_NAME} — Rekam, Susun, Dokumen`,
        short_name: APP_NAME,
        description:
            "Record a job in English or Indonesian and issue a formal Quotation / Surat Penawaran.",
        start_url: "/en",
        display: "standalone",
        background_color: "#f8f6f2",
        theme_color: "#0f1722",
        icons: [
            {
                src: "/assets/img/suara-lapangan-mark-192.png",
                sizes: "192x192",
                type: "image/png",
            },
            {
                src: "/assets/img/suara-lapangan-mark-512.png",
                sizes: "512x512",
                type: "image/png",
            },
            {
                src: "/assets/img/suara-lapangan-apple-touch.png",
                sizes: "180x180",
                type: "image/png",
                purpose: "maskable",
            },
        ],
    };
}
