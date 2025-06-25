import * as fs from "fs/promises";
import { clientOpenai } from "./connections/clientOpenai";
import { clientSupabase } from "./connections/clientSupabase";

const COLORS_CSV_PATH = "src/colornames.csv";

////////////////////
// PIPELINE FUNCTIONS
////////////////////

const readColorRow = (rowText: string): RawColor => {
  const [name, hex, isGoodName] = rowText.split(",");
  return {
    name,
    hex,
    is_good_name: isGoodName === "x",
  };
};

type RawColor = {
  name: string;
  hex: string;
  is_good_name: boolean;
};

const validRawColor = (rawColor: RawColor): boolean => {
  const validName = rawColor.name.length > 0 && rawColor.name.length < 100;
  const validHex = rawColor.hex.length === 7 && rawColor.hex.startsWith("#");
  const validIsGoodName = typeof rawColor.is_good_name === "boolean";
  return validName && validHex && validIsGoodName;
};

const getEmbedding = async (inputText: string): Promise<number[]> => {
  const embedding = await clientOpenai.embeddings.create({
    model: "text-embedding-3-small",
    input: inputText,
    encoding_format: "float", // We would potentially prefer a string here to match Supabase expectation, but OpenAI only supports "float" | "base64" | undefined
  });
  return embedding.data[0].embedding;
};

const prepColorEntry = async (rawColor: RawColor): Promise<PreppedColor> => {
  if (!validRawColor(rawColor)) {
    throw new Error(`Invalid raw color: ${JSON.stringify(rawColor)}`);
  }
  const embeddingSmall = await getEmbedding(rawColor.name);
  const noHashHex = rawColor.hex.replace("#", "");
  return {
    ...rawColor,
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
  const { error } = await clientSupabase
    .from("colors")
    .upsert(preppedColor, { onConflict: "name" });
  if (error) {
    console.error(error);
  } else {
    console.log("Saved color entry", preppedColor.name);
  }
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
    hex: "#aaabbb",
    // hex: "#c93f38",
    is_good_name: true,
  };
  const preppedColor = await prepColorEntry(rawColor);
  await saveColorEntry(preppedColor);
  console.log("Test sequence complete.");
};

// testSaveColorEntry();

////////////////////
// UTILITY FUNCTIONS + FULL SCRIPT
////////////////////

const getColorRows = async (
  filePath: string,
  omitHeader: boolean = true,
  maxRows?: number
): Promise<string[]> => {
  const file = await fs.readFile(filePath, "utf8");
  const rows = file.split("\n");
  const contentRows = omitHeader ? rows.slice(1) : rows;
  const returnRows = maxRows ? contentRows.slice(0, maxRows) : contentRows;
  return returnRows;
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const runFullScript = async (maxRows?: number) => {
  const colorRows = await getColorRows(COLORS_CSV_PATH, true, maxRows);
  console.log(`Processing ${colorRows.length} color entries...`);

  for (let i = 0; i < colorRows.length; i++) {
    const row = colorRows[i];
    try {
      const rawColor = readColorRow(row);
      const preppedColor = await prepColorEntry(rawColor);
      await saveColorEntry(preppedColor);

      // Add delay every 10 entries to avoid overwhelming the APIs
      if ((i + 1) % 10 === 0) {
        console.log(
          `Processed ${i + 1}/${colorRows.length} entries. Adding delay...`
        );
        await delay(500); // this (in ms) is a delay between every 10 entries
      }

      // Add a small delay between each entry to be respectful to APIs
      await delay(100); // this (in ms) is a delay between each entry
    } catch (error) {
      console.error(`Error processing row ${i + 1}:`, error);
      // Continue with next entry instead of stopping the entire script
    }
  }

  console.log("Script completed!");
};

// runFullScript(50);
