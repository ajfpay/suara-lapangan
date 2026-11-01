import { z } from "zod";

export const sendEmailBodySchema = z.object({
    to: z.string().trim().email(),
});

export type SendEmailBody = z.infer<typeof sendEmailBodySchema>;

export * from "./config";
export * from "./send";
