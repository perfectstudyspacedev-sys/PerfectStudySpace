// Stand-in for npm:@anthropic-ai/sdk in the server tests (mapped in deno.json). No network: each
// messages.create() call is answered by globalThis.__FAKE_AI__(params, callIndex), which a test
// installs to script Claude's replies. Every request is recorded in fakeAi.requests.
// deno-lint-ignore-file no-explicit-any
const g = globalThis as any;

export const fakeAi = {
  requests: [] as any[],
  options: [] as any[],
  reset() { this.requests.length = 0; this.options.length = 0; g.__FAKE_AI__ = undefined; },
};

export class APIError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** A reply in the API's shape: text and tool_use blocks, with a stop reason and usage. */
export function reply(content: any[], stop_reason = "end_turn", usage: any = {}) {
  return {
    id: `msg_${fakeAi.requests.length}`, type: "message", role: "assistant", model: "fake", content, stop_reason,
    usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, ...usage },
  };
}
export const text = (t: string) => ({ type: "text", text: t });
export const toolUse = (id: string, name: string, input: any) => ({ type: "tool_use", id, name, input });

export default class Anthropic {
  messages: { create: (params: any) => Promise<any> };
  constructor(opts: any) {
    fakeAi.options.push(opts);
    this.messages = {
      create: async (params: any) => {
        // Copy, so later pushes to the caller's messages array don't change what was recorded.
        const index = fakeAi.requests.push(structuredClone(params)) - 1;
        if (!g.__FAKE_AI__) throw new Error("No __FAKE_AI__ script installed");
        return await g.__FAKE_AI__(params, index);
      },
    };
  }
}
