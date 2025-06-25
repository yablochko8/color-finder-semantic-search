import OpenAI, { ClientOptions } from "openai";

const apiKey = process.env.OPENAI_API_KEY;

if (!apiKey) {
  throw new Error("OPENAI_API_KEY is not set");
}

const opts: ClientOptions = {
  apiKey,
};

export const clientOpenai = new OpenAI(opts);
