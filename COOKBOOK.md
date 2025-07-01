# How to create a semantic search engine for colors (or anything else) using Supabase

When I saw this [post on Hacker News](https://news.ycombinator.com/item?id=44317291) I was intrigued by the reference to a dataset of 30,000 named colors.

I use colors a lot, and love the ecosystem of color tools out there (examples [one](https://paletton.com/), [two](https://chromavibes.net/), [three](https://tailwindcss.com/docs/colors)). One thing conspicuous by its absence is semantic search for color.

The use case: you're creating some content and you need a color that captures something abstract like "rural bliss" or something ephemeral like "a rainy night in futuristic Tokyo". You can click around on a color wheel or random palette generator, but you want to jump to a starting point that someone else has already put some thought into. You want a _named color_.

I don't believe there exists semantic search engine for named colors, so I built one:

https://brandmint.ai/color-genie

You can build one too! Or a semantic search engine for anything else you have data on.

## Step 1 - Create a Vector Database to hold the data

1a - Supabase > new project

1b - Add vector extension

You'll need to add the vector extension. In the SQL Editor: choose New SQL Snippet (Execute SQL Queries)

```sql
CREATE SCHEMA IF NOT EXISTS extensions;

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;
```

1c - Create a new table

Even though you've just added the 'extensions' schema, the table itself will live in the 'public' schema.

I usually prefer to use the interface for something like this, but the Supabase interface doesn't let you specify vector size. This means you will need to do this with another SQL command.

We're going to need the following columns:

- id (bigserial)
- created_at (timestamp, default to now() - may be useful later if expanding the list)
- name (string - in this case we want to make sure we don't allow duplicate names)
- hex (string)
- is_good_name (boolean, default false)
- embedding_small vector(1536)

So here's the SQL:

```sql
create table public.colors (
id bigserial primary key,
created_at timestamp with time zone default now(),
name text not null unique,
hex text,
is_good_name boolean default false,
embedding_small vector(1536)
);
```

You may get a security warning about Row Level Security, so enable that on the table manually after creating it. Then click "Add RLS Policy". I just use the Templates to enable read access for all users.

## Step 2 - Pull in the data source

The source data is in [this excellent project](https://github.com/meodai/color-names/blob/main/src/colornames.csv). Thank you David Aerne (meodai)!

Easy route: just copy paste.

Sidequest: I want to pull in the color list in a way that will make easier to pull in future updates, so I pull it in via git.

To sync first time:

```sh
git remote add canonical-color-list https://github.com/meodai/color-names.git
git fetch canonical-color-list
git checkout canonical-color-list/main -- src/colornames.csv
git add src/colornames.csv
git commit -m "Adding canonical color list from meodai/color-names"
git push origin main
```

To update later:

```sh
git fetch canonical-color-list
git checkout canonical-color-list/main -- src/colornames.csv
git commit -m "Update colornames.csv from meodai color-names"
git push
```

## Step 3 - Write a script to turn the source data into DB-ready data

I'm going to use TypeScript.

3a - Connect with an AI provider embedding endpoint

First I write a simple integration with OpenAI:

```ts
import OpenAI from "openai";

const apiKey = process.env.OPENAI_API_KEY;

if (!apiKey) {
  throw new Error("OPENAI_API_KEY is not set");
}

export const clientOpenai = new OpenAI({ apiKey });
```

Then a function to call it:

```ts
import { clientOpenai } from "./clientOpenai";

const getEmbedding = async (inputText: string) => {
  const embedding = await clientOpenai.embeddings.create({
    model: "text-embedding-3-small",
    input: inputText,
    encoding_format: "float",
  });
  return embedding.data[0].embedding;
};
```

Then a super simple script that calls the function:

```ts
const testRun = async () => {
  const embedding = await getEmbedding("red");
  console.log(embedding);
  console.log(embedding.length);
};

testRun();
```

To run this, I use bun. So the Terminal command is:

```sh
bun src/script.ts
```

3b - Connect scripting code with Supabase

To do this you'll need your Project ID (find this on Settings > General > Project Settings).

It will look something like this: "abcdefghijklmnopqrst"

Your .env file will need a SUPABASE_URL, which will be built around the Project ID using this format:

"https://abcdefghijklmnopqrst.supabase.co"

Your SUPABASE_SERVICE_ROLE_KEY is a longer string that you'll find in Settings > API Keys > Reveal.

Here's the code:

```ts
import { createClient } from "@supabase/supabase-js";
import { Database } from "../types/supabase";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set");
}

export const clientSupabase = createClient<Database>(supabaseUrl, supabaseKey);
```

To create that types/supabase file, you'll need to...

1. Install Supabase: `npm i supabase`
2. Login to Supabase CLI: `npx supabase login`
3. Follow the login flow in your browser
4. Create a types folder or similar path, so that you can then...
5. Generate TypeScript types: `npx supabase gen types typescript --project-id abcdefghijklmnopqrst > types/supabase.ts`

3c - Save our first few colors to the database

The `types/supabase.ts` makes it nice and clear what shape our data needs to be in, so let's get the data ready.

Bear in mind:

- the vector must be passed in as a string
- we want to respect the uniqueness of the name, so we should do an upsert rather than insert

So our target state is:

```ts
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
```

In my code I'm making sure to strip the hash character out of the color values, that's a personal preference.

I've also added in time delays just in case.

The full flow for data retrieval and indexing in my case was as follows:

getColorRows -> readColorRow -> prepColorEntry -> saveColorEntry

These functions are very project specific but if you want dig into the code you can find it [here](https://github.com/yablochko8/color-finder-semantic-search/blob/main/src/script.ts).

## Step 4 - Add a Vector Index to the Database

The command you will want to run looks something like this:

```sql
CREATE INDEX CONCURRENTLY colors_embedding_ip_small_idx
on public.colors
using ivfflat (embedding_small vector_ip_ops)
with (lists = 30);
```

Let's explain these terms:

**ivfflat** = An index method optimized for high-dimensional vector data. It divides vectors into clusters for faster searching. Alternatives would be hnsw (Hierarchical Navigable Small World) which can be faster but uses more memory.

**vector_ip_ops** (internal product) = Operator class that uses inner product for comparing vectors. Alternatives are vector_l2_ops (Euclidean distance) and vector_cosine_ops (cosine similarity), but cosine similarity is generally best for semantic search. Thank you to Chris Loy for helping me out here, he wrote a good [explainer post](https://chrisloy.dev/post/2025/06/30/distance-metrics) that goes through the different options.

**lists** = Number of clusters to divide the vectors into. Generally: More lists = faster search but less accurate.

Microsoft gives the following [advice for tuning ivfflat](https://learn.microsoft.com/en-us/azure/cosmos-db/postgresql/howto-optimize-performance-pgvector):

1. Use lists equal to rows / 1000 for tables with up to 1 million rows and sqrt(rows) for larger datasets.
2. For probes start with lists / 10 for tables up to 1 million rows and sqrt(lists) for larger datasets.

⚠️ **Potential Gotcha: Working Memory Limits**

You may hit the same problem I hit, which was that the working memory needed is higher than the default Supabase limits, and can't be increased via the interface!

This meant I needed to connect to the database via Terminal.

If you haven't done this before you'll need to install Postgres on your machine. For macOS using brew the command is:

```sh
brew install postgresql
```

Then connect in to the database with this command:

psql "host=aws-0-us-east-2.pooler.supabase.com dbname=postgres user=postgres.abcdefghijklmnopqrst"

Where...

- us-east-2 is the datacentre you chose when setting up your project
- abcdefghijklmnopqrst is your Project Id
- you'll be prompted for a password, it's the password you gave when you first set up the database

Once connected to the database by command line, you can run this code.

```sql
SET maintenance_work_mem = '128MB';

CREATE INDEX CONCURRENTLY colors_embedding_small_idx
on public.colors
using ivfflat (embedding_small vector_cosine_ops)
with (lists = 100);
```

Yes you might expect to be able to run this directly via Supabase CLI, but the index creation cannot run inside a transaction block, so...you can't.

## Step 5 - Create an RPC Function to call that Vector Index from code

Usually when you want to call this DB from code you'll use the supabase SDK, and that will have predefined functions to let you add, delete, update etc.

Calling the vector index is beyond the scope of the current SDK, so we'll need to create our own custom function that we can call in a controlled way.

This is called an RPC (Remote Procedure Call) Function.

For our needs, we're going to want to query the embedding column, and get ten results back with name, hex, and is_good_name fields. We don't need to specify the index we're calling, as there's only one for that column.

Here's the code for creating the index:

```sql
CREATE OR REPLACE FUNCTION query_embedding_small(
  query_embedding vector(1536),
  match_count int default 10
)
RETURNS TABLE (
  name text,
  hex text,
  is_good_name boolean,
  distance float
)
LANGUAGE sql VOLATILE
AS $$

  SET  ivfflat.probes = 15;

  SELECT
    c.name,
    c.hex,
    c.is_good_name,
    c.embedding_small <#> query_embedding AS distance
  FROM (
    SELECT * FROM colors
    ORDER BY embedding_small <#> query_embedding
    LIMIT match_count
  ) c;
$$;
```

Some explanations:

`ivfflat probes` - This sets how many IVF lists the index will scan during search. Higher values = more accurate results but slower queries. Default is 1, we're setting to 10 for better accuracy at cost of some speed.

`language sql volatile` - This tells Postgres that this is a SQL function that can modify data and its output may change even with the same inputs. 'volatile' means the function's result can vary even if called with identical parameters. This is required if we want to use a non-default number of ivfflat probes.

`SELECT *` as c then `SELECT c.name, c.hex`... - More on this choice further down under "Side Quest - Solving Timeouts"

## Step 6 - Run a Test Query

At this stage I only have about 50 entries in the database, perfect for testing the end-to-end flow.

```ts
const testQuery = async () => {
  const testEmbedding = await getEmbedding(
    "milky coffee in the middle of the night"
  );
  const { data, error } = await clientSupabase.rpc("query_embedding_small", {
    query_embedding: JSON.stringify(testEmbedding),
    match_count: 10,
  });
};
```

## Step 7 - Add in all the data

At this point I added in all 30,000 entries at this point.

It took about 8 hours.

Good news: It cost me $0.02 of API costs for the embedding values.
Bad news: It pushed me over the database size limits on Supabase...

## Step 8 - Upgrade Supabase

30,000 entries with vectors plus an index plus RPC function results in a database size of 0.53 GB, and the free tier limit is 0.5 GB.

If i had known this I might have only used 90% of the data, but I didn't so I've moved up to Pro plan size.

## Step 9 - Connect Frontend

In my case that's https://brandmint.ai/color-genie

The server code matches the pattern of a testQuery above.

Remember to add the hashtag back in to the color hex value before passing it to as a style parameter, and you're good to go!

## Side Quest - Solving Timeouts

At one point I started getting timeout errors:

```json
RPC error: {
code: "57014",
details: null,
hint: null,
message: "canceling statement due to statement timeout",
}
```

It turned out these were caused by the structure of the RPC function.

SLOW version (15,000ms):

```sql
SELECT
  name,
  hex,
  is_good_name,
  embedding_small <#> query_embedding as distance
FROM colors
ORDER BY distance
LIMIT match_count;
```

FAST version (150ms):

```sql
SELECT
  c.name,
  c.hex,
  c.is_good_name,
  c.embedding_small <#> query_embedding AS distance
FROM (
  SELECT * FROM colors
  ORDER BY embedding_small <#> query_embedding
  LIMIT match_count
) c;
```

Intuitively it looks like we're avoiding the columns being unpacked in the ordering calculation, but I don't know enough about PostgreSQL to understand what's at play here. I'm just happy I found my way past it.

Before narrowing down on the actual cause of the latency, here are other things I tried that might be useful to others:

- Run ANALYZE (command is just `ANALYZE public.colors): PostgreSQL scans a sample of rows in the public.colors table and updates its internal statistics about the data. These stats help the query planner decide how to execute queries efficiently — for example, whether to use an index or not. This is a once-off function.
- Decreased the number of IVFFLAT probes. In IVFFlat indexing, a higher probes value makes queries slower but more accurate.
- Increased the timeout time in the RPC function (`set statement_timeout = 15000;`). Aka cheating. When I bumped the timeout to 30000ms all my queries got a response, but this was too long for my use case.
- Recreated the index with a higher `lists` value (this only works if your querying with a `probes` that is much lower than the index's number of `lists`)
- Added a catch-and-retry in my server code. The second request always seems to be faster so there must be some warm-up logic or internal caching happening on Supabase

## Other notes

- I've shown the happy path here, perhaps 2 hours of human time. I would estimate there was another 5 hours of active time spent on deadends and debugging.
- Writing this cookbook as I was working through this task made it much easier to jump back in after a one day gap when my focus was elsewhere.
- Embedding costs for this project were trivial. 30,000 entries came to $0.002 (OpenAI's text-embedding-3-small).

## References

- https://platform.openai.com/docs/models/text-embedding-3-small
- https://platform.openai.com/docs/models/text-embedding-3-large
- https://supabase.com/docs/guides/ai/semantic-search

Full code for creating the above search service is here: https://github.com/yablochko8/color-finder-semantic-search

That repo includes an .md version of this guide. Corrections and improvements always welcome!
