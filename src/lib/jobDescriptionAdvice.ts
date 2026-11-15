import { z } from "zod";

export const jobDescriptionAdvice = z.object({
  actions: z.array(z.string().trim().min(1).max(350)).max(3),
  questions: z.array(z.string().trim().min(1).max(350)).max(4),
});

export type JobDescriptionAdvice = z.infer<typeof jobDescriptionAdvice>;
