export class HomebaseUnreachableError extends Error {
  constructor(cause: unknown) {
    super("Could not reach Homebase");
    this.name = "HomebaseUnreachableError";
    this.cause = cause;
  }
}

export class HomebaseAgentError extends Error {
  constructor(
    public readonly agentName: string,
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(`Homebase agent "${agentName}" returned ${status}`);
    this.name = "HomebaseAgentError";
  }
}

export class HomebaseKbError extends Error {
  constructor(
    public readonly kbName: string,
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(`Homebase KB "${kbName}" request failed with ${status}`);
    this.name = "HomebaseKbError";
  }
}

export class HomebaseMemoryError extends Error {
  constructor(
    public readonly conversationId: string,
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(`Homebase memory request for "${conversationId}" failed with ${status}`);
    this.name = "HomebaseMemoryError";
  }
}

/** Thrown by `parseAgentOutput` when an agent's raw text isn't valid JSON, or doesn't match the caller's schema. */
export class AgentOutputError extends Error {
  constructor(
    public readonly agentName: string,
    public readonly rawOutput: string,
    public readonly issues?: unknown,
  ) {
    super(`Agent "${agentName}" returned output that didn't match the expected contract`);
    this.name = "AgentOutputError";
  }
}
