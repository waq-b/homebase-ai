import { z } from "zod";

const fieldTypeSchema = z.enum(["string", "number", "boolean"]);

const objectShapeToZod = (shape: Record<string, z.infer<typeof fieldTypeSchema>>) => {
  const fields: Record<string, z.ZodTypeAny> = {};
  for (const [key, fieldType] of Object.entries(shape)) {
    fields[key] =
      fieldType === "string" ? z.string() : fieldType === "number" ? z.number() : z.boolean();
  }
  return z.object(fields);
};

const inputConfigSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("string") }),
  z.object({ type: z.literal("messages") }),
  z.object({ type: z.literal("object"), shape: z.record(fieldTypeSchema) }),
]);

export const agentConfigSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  provider: z.literal("ollama"),
  model: z.string().min(1),
  system: z.string().optional(),
  input: inputConfigSchema,
  params: z
    .object({
      temperature: z.number().optional(),
      maxTokens: z.number().optional(),
    })
    .optional(),
  hooks: z.string().optional(),
});

export type AgentConfig = z.infer<typeof agentConfigSchema>;

/** Builds the Zod schema for an agent's `{ input }` request body from its declared input config. */
export const inputPayloadSchema = (input: AgentConfig["input"]) => {
  if (input.type === "string") {
    return z.object({ input: z.string() });
  }
  if (input.type === "messages") {
    return z.object({
      input: z.array(
        z.object({
          role: z.enum(["system", "user", "assistant"]),
          content: z.string(),
        }),
      ),
    });
  }
  return z.object({ input: objectShapeToZod(input.shape) });
};
