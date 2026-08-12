import { z } from "zod";

const scalarTypeSchema = z.enum(["string", "number", "boolean"]);

/**
 * A shape field is either the flat shorthand (`query: string`) or a full spec
 * for scalars that need `nullable`, or for `array`/`object` nesting. Recursive
 * via z.lazy since object/array fields can nest arbitrarily deep.
 */
type FieldSpec =
  | z.infer<typeof scalarTypeSchema>
  | { type: z.infer<typeof scalarTypeSchema>; nullable?: boolean }
  | { type: "array"; items: FieldSpec; nullable?: boolean }
  | { type: "object"; shape: Record<string, FieldSpec>; nullable?: boolean };

const fieldSpecSchema: z.ZodType<FieldSpec> = z.lazy(() =>
  z.union([
    scalarTypeSchema,
    z.object({ type: scalarTypeSchema, nullable: z.boolean().optional() }),
    z.object({ type: z.literal("array"), items: fieldSpecSchema, nullable: z.boolean().optional() }),
    z.object({
      type: z.literal("object"),
      shape: z.record(fieldSpecSchema),
      nullable: z.boolean().optional(),
    }),
  ]),
);

const scalarToZod = (scalar: z.infer<typeof scalarTypeSchema>) =>
  scalar === "string" ? z.string() : scalar === "number" ? z.number() : z.boolean();

const fieldSpecToZod = (spec: FieldSpec): z.ZodTypeAny => {
  if (typeof spec === "string") return scalarToZod(spec);

  const zodType: z.ZodTypeAny =
    spec.type === "array"
      ? z.array(fieldSpecToZod(spec.items))
      : spec.type === "object"
        ? objectShapeToZod(spec.shape)
        : scalarToZod(spec.type);

  return spec.nullable ? zodType.nullable() : zodType;
};

const objectShapeToZod = (shape: Record<string, FieldSpec>) => {
  const fields: Record<string, z.ZodTypeAny> = {};
  for (const [key, spec] of Object.entries(shape)) {
    fields[key] = fieldSpecToZod(spec);
  }
  return z.object(fields);
};

const inputConfigSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("string") }),
  z.object({ type: z.literal("messages") }),
  z.object({ type: z.literal("object"), shape: z.record(fieldSpecSchema) }),
]);

export const agentConfigSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  provider: z.enum(["ollama", "openrouter"]),
  model: z.string().min(1),
  // Only used when provider is "ollama" and the primary call fails —
  // overrides the global OPENROUTER_FALLBACK_MODEL for this agent.
  fallbackModel: z.string().min(1).optional(),
  system: z.string().optional(),
  input: inputConfigSchema,
  params: z
    .object({
      temperature: z.number().optional(),
      maxTokens: z.number().optional(),
    })
    .optional(),
  hooks: z.string().optional(),
  mcpServers: z.array(z.object({ name: z.string().min(1), url: z.string().min(1) })).optional(),
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
