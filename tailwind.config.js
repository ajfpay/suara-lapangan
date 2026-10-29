/** @type {import('tailwindcss').Config} */
module.exports = {
    darkMode: ["class"],
    content: [
        "./app/**/*.{ts,tsx}",
        "./components/**/*.{ts,tsx}",
        "./lib/**/*.{ts,tsx}",
    ],
    theme: {
        container: {
            center: true,
            padding: {
                DEFAULT: "1rem",
                sm: "1.5rem",
                lg: "2rem",
            },
            screens: {
                "2xl": "1200px",
            },
        },
        extend: {
            colors: {
                border: "hsl(var(--border))",
                ring: "hsl(var(--ring))",
                background: "hsl(var(--background))",
                foreground: "hsl(var(--foreground))",
                primary: {
                    DEFAULT: "hsl(var(--primary))",
                    foreground: "hsl(var(--primary-foreground))",
                },
                muted: {
                    DEFAULT: "hsl(var(--muted))",
                    foreground: "hsl(var(--muted-foreground))",
                },
                card: {
                    DEFAULT: "hsl(var(--card))",
                    foreground: "hsl(var(--card-foreground))",
                },
                accent: {
                    DEFAULT: "hsl(var(--accent))",
                    foreground: "hsl(var(--accent-foreground))",
                },
            },
            fontFamily: {
                sans: ["IBM Plex Sans", "ui-sans-serif", "system-ui", "sans-serif"],
                display: ["Source Serif 4", "ui-serif", "Georgia", "serif"],
            },
            borderRadius: {
                lg: "var(--radius)",
                md: "calc(var(--radius) - 2px)",
                sm: "calc(var(--radius) - 4px)",
            },
            /*
             * Motion values for the whole app. The curves are stronger than the
             * CSS keywords so movement reads as deliberate; `--ease-out` is the
             * default for anything entering or responding to a press.
             */
            transitionTimingFunction: {
                out: "cubic-bezier(0.23, 1, 0.32, 1)",
                "in-out": "cubic-bezier(0.77, 0, 0.175, 1)",
                drawer: "cubic-bezier(0.32, 0.72, 0, 1)",
            },
        },
    },
    plugins: [require("tailwindcss-animate")],
};
