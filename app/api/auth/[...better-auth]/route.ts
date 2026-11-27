import { handleAuthRequest } from "@/lib/server/auth";
import { toNextJsHandler } from "better-auth/next-js";

export const { GET, POST } = toNextJsHandler(handleAuthRequest);
