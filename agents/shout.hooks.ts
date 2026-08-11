import { webSearch } from "../tools/webSearch.js";

export default {
  beforeInvoke: (input: string) => `${input} (respond enthusiastically)`,
  afterInvoke: (output: string) => output.toUpperCase(),
  tools: { webSearch },
};
