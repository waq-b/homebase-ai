import { z } from "zod";

const notesSchema = z.object({
  summary: z.string(),
  decisions: z.array(z.string()),
  actionItems: z.array(
    z.object({
      owner: z.string(),
      task: z.string(),
      due: z.string().nullable(),
    }),
  ),
});

/**
 * Homebase does no schema validation on an agent's raw text output, so an
 * agent whose contract is "valid JSON of this shape" checks it here. Models
 * sometimes wrap JSON in a code fence; strip that, then parse and validate.
 * A failure throws, which surfaces as a clean 500 (HookError) instead of
 * handing the caller output that doesn't match the contract.
 */
export const validateNotes = (output: string): string => {
  const text = output.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.stringify(notesSchema.parse(JSON.parse(text)));
};

export default {
  afterInvoke: validateNotes,
};
