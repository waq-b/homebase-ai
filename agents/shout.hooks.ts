export default {
  beforeInvoke: (input: string) => `${input} (respond enthusiastically)`,
  afterInvoke: (output: string) => output.toUpperCase(),
};
