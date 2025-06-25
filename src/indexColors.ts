import { clientOpenai } from "./clientOpenai";

const getEmbedding = async (inputText: string) => {
  const embedding = await clientOpenai.embeddings.create({
    model: "text-embedding-3-small",
    input: inputText,
    encoding_format: "float",
  });
  return embedding.data[0].embedding;
};

const testRun = async () => {
  const embedding = await getEmbedding("red");
  console.log(embedding);
  console.log(embedding.length);
};

// testRun();
