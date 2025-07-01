import { clientMistral } from "../connections/clientMistral";
import { clientSupabase } from "../connections/clientSupabase";

const getEmbeddingMistral1024 = async (
  inputText: string
): Promise<number[]> => {
  const embedding = await clientMistral.embeddings.create({
    model: "mistral-embed",
    inputs: [inputText],
  });
  if (!embedding.data[0].embedding) {
    console.error(
      "No embedding in response from mistral-embed, for query starting with: ",
      inputText.slice(0, 20)
    );
    return [];
  }
  return embedding.data[0].embedding;
};

const addMistralEmbedding = async (inputText: string) => {
  const embedding = await getEmbeddingMistral1024(inputText);
  if (embedding.length === 0) {
    return;
  }
  console.log("Embedding for", inputText, "is", embedding.length, "dimensions");
  const { error, data } = await clientSupabase
    .from("colors")
    .update({
      embedding_mistral_1024: JSON.stringify(embedding),
    })
    .eq("name", inputText);
  console.log("Data:", data);
  console.log("Error:", error);
};

addMistralEmbedding("18th Century Green");
