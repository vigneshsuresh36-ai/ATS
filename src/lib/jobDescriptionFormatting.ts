import { z } from "zod";

export const jobDescriptionMark = z.object({
  start: z.number().int().min(0),
  end: z.number().int().positive(),
  bold: z.boolean(),
  italic: z.boolean(),
  underline: z.boolean(),
});

export type JobDescriptionMark = z.infer<typeof jobDescriptionMark>;
