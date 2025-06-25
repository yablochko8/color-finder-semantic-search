import { clientOpenai } from "./clientOpenai";
import { clientSupabase } from "./clientSupabase";

const getEmbedding = async (inputText: string): Promise<number[]> => {
  const embedding = await clientOpenai.embeddings.create({
    model: "text-embedding-3-small",
    input: inputText,
    encoding_format: "float", // We would potentially prefer a string here to match Supabase expectation, but OpenAI only supports "float" | "base64" | undefined
  });
  return embedding.data[0].embedding;
};

type RawColor = {
  name: string;
  hex: string;
  is_good_name: boolean;
};

const prepColorData = async (colorEntry: RawColor): Promise<PreppedColor> => {
  const embeddingSmall = await getEmbedding(colorEntry.name);
  const noHashHex = colorEntry.hex.replace("#", "");
  return {
    ...colorEntry,
    hex: noHashHex,
    embedding_small: JSON.stringify(embeddingSmall),
  };
};

type PreppedColor = {
  name: string;
  hex: string;
  is_good_name: boolean;
  embedding_small: string;
};

const saveColorEntry = async (preppedColor: PreppedColor) => {
  const { data, error } = await clientSupabase
    .from("colors")
    .insert(preppedColor);
  console.log(data);
  console.log(error);
};

////////////////////
// TEST FUNCTIONS
////////////////////

const testEmbedding = async () => {
  const embedding = await getEmbedding("red");
  console.log(embedding);
  console.log(embedding.length);
};
// testEmbedding();

const testSaveColorEntry = async () => {
  const rawColor = {
    name: "100 Mph",
    hex: "#c93f38",
    is_good_name: true,
  };
  const preppedColor = await prepColorData(rawColor);
  await saveColorEntry(preppedColor);
  console.log("Saved color entry");
};

testSaveColorEntry();
