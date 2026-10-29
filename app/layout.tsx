import { ReactNode } from "react";
import "@/app/globals.css";

type Props = {
    children: ReactNode;
};

// A root layout is required even when it only passes children through: the
// <html> element is rendered by the locale layout, which knows the language.
export default function RootLayout({ children }: Props) {
    return children;
}
