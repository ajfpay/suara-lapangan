import { redirect } from "next/navigation";

// Only reached when the middleware is bypassed (for example output: "export").
// The middleware otherwise rewrites "/" to the detected locale.
export default function RootPage() {
    redirect("/en");
}
