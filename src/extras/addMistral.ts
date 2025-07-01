import { clientMistral } from "../connections/clientMistral";
import { clientSupabase } from "../connections/clientSupabase";
import * as fs from "fs/promises";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const getColorNames = async (
  filePath: string,
  omitHeader: boolean = true,
  startRow: number,
  stopRow: number
): Promise<string[]> => {
  const file = await fs.readFile(filePath, "utf8");
  const rows = file.split("\n");
  const contentRows = omitHeader ? rows.slice(1) : rows;
  if (startRow >= contentRows.length) {
    return [];
  }
  const adjustedStopRow = Math.min(stopRow, contentRows.length);
  const selectedRows = contentRows.slice(startRow, adjustedStopRow);
  return selectedRows.map((row) => row.split(",")[0]);
};

// Avoid skipping rows! The "stopRow" of one round should be the "startRow" of the next round.
// Example:
// const colorNames = await getColorNames("src/colornames.csv", true, 0, 10);
// const colorNames2 = await getColorNames("src/colornames.csv", true, 10, 20);

type MistralUpdate = {
  name: string;
  embedding_mistral_1024: string;
};

const getEmbeddingMistral = async (
  inputs: string[]
): Promise<MistralUpdate[]> => {
  const response = await clientMistral.embeddings.create({
    model: "mistral-embed",
    inputs: inputs,
  });

  const outputs = response.data;

  if (!outputs || outputs.length === 0) {
    console.error(
      "No embedding in response from mistral-embed, for query starting with: ",
      inputs.slice(0, 20)
    );
    return [];
  }
  //   for (const output of outputs) {
  //     console.log(
  //       `Output ${output.index} is ${output.object} with length ${output.embedding?.length}`
  //     );
  //   }
  const validOutputs = outputs.filter(
    (output) => output.object === "embedding" && output.index !== undefined
  );
  return validOutputs.map((output) => ({
    name: inputs[output.index!],
    embedding_mistral_1024: JSON.stringify(output.embedding),
  }));
};

const saveEmbeddingsToDB = async (updates: MistralUpdate[]) => {
  const { error } = await clientSupabase
    .from("colors")
    .upsert(updates, { onConflict: "name" });

  if (error) {
    console.error("Error:", error);
  } else {
    // console.log(updates.length, "embeddings saved to DB");
  }
};

const updateCycle = async (startRow: number, stopRow: number) => {
  const colorNames = await getColorNames(
    "src/colornames.csv",
    true,
    startRow,
    stopRow
  );
  if (colorNames.length === 0) {
    return 0;
  }
  const updates = await getEmbeddingMistral(colorNames);
  await saveEmbeddingsToDB(updates);
  console.log(`Updated rows ${startRow} to ${stopRow}`);
  return colorNames.length;
};

const runFullScript = async (stepSize: number, startRow: number = 0) => {
  for (let i = startRow; i < 35000; i += stepSize) {
    await updateCycle(i, i + stepSize);
    await delay(500);
  }
};

// runFullScript(50);

////////////////////
// TEST FUNCTIONS
////////////////////

// const updates = await getEmbeddingMistral([
//   "18th Century Green",
//   "24 Carrot",
//   "24 Karat",
// ]);
// console.log(updates);
// saveEmbeddingsToDB(updates);

// addMistralEmbedding("18th Century Green");

const testQuery = async (logging: boolean = false) => {
  const startTime = performance.now();
  const mistralUpdate = await getEmbeddingMistral([
    "the one holy religious order of catholic france and poland",
  ]);

  const testEmbeddingString = mistralUpdate[0].embedding_mistral_1024;
  const checkpoint1 = performance.now();

  const { data, error } = await clientSupabase.rpc(
    "search_embedding_mistral_1024",
    {
      query_embedding: testEmbeddingString,
      match_count: 10,
    }
  );

  const checkpoint2 = performance.now();

  const endTime = performance.now();
  const duration = Math.round(endTime - startTime);
  const duration1 = Math.round(checkpoint1 - startTime);
  const duration2 = Math.round(checkpoint2 - checkpoint1);

  if (error) {
    console.error("RPC error:", error.details);
  } else {
    if (logging) {
      console.log("Matches:", data);
      console.log(`Query took ${duration}ms`);
      console.log(`Mistral call to get embedding: ${duration1}ms`);
      console.log(`Supabase call to get results: ${duration2}ms`);
    }
  }
};

// testQuery(true);
