# How to create a semantic search engine for colors (or anything else) using Supabase

When I saw this [post on Hacker News](https://news.ycombinator.com/item?id=44317291) I was intrigued by the reference to a dataset of 30,000 named colors.

I use colors a lot, and love the ecosystem of color tools out there (examples one, two, three, four). One thing conspicuous by its absence is semantic search for color.

So you're creating some content and you need a color that captures something abstract like "rural bliss" or something ephemeral like "a rainy night in futuristic Tokyo". I don't believe there are any semantic search services for color, so I of course I built one:

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

3c - Save our first color to the database

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

## Step 3 - Add a Vector Index to the Database

The command you will want to run looks something like this:

```sql
CREATE INDEX CONCURRENTLY colors_embedding_small_idx
on public.colors
using ivfflat (embedding_small vector_cosine_ops)
with (lists = 100);
```

Let's explain these terms:

**ivfflat** = An index method optimized for high-dimensional vector data. It divides vectors into clusters for faster searching. Alternatives would be hnsw (Hierarchical Navigable Small World) which can be faster but uses more memory.

**vector_cosine_ops** = Operator class that uses cosine similarity for comparing vectors. Alternatives are vector_l2_ops (Euclidean distance) and vector_ip_ops (inner product), but cosine similarity is generally best for semantic search.

**lists** = Number of clusters to divide the vectors into. Rule of thumb is sqrt(n)/2 where n is number of rows - so for 30k rows, sqrt(30000)/2 ≈ 87, rounded up to 100 for simplicity. More lists = faster search but less accurate.

HOWEVER - you may hit the problem I hit, which was that the working memory needed is higher than the default Supabase limits, and can't be increased via the interface!

This meant I needed to connect to the database via Terminal.

If you haven't done this before you'll need to install Postrgres on your machine. For macOS using brew the command is:

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

(yes you might expect to be able to run this directly via Supabase CLI, but the index creation cannot run inside a transaction block, so...you can't)

UH OH... Supabase won't let us crank up working memory within their interface

Which means we need to do it via CLI

# STEP FIVE - CREATE AN RPC FUNCTION TO CALL THAT VECTOR INDEX FROM CODE

Usually when you want to call this DB from code you'll use the supabase SDK, and that will have predefined functions to let you add, delete, update etc.

Calling the vector index seems to be beyond the scope of the current SDK, so we'll need to create our own custom function that we can call in a controlled way.

This is called an RPC (Remote Procedure Call) Function.

For our needs, we're going to want to query the embedding column, and get ten results back with name, hex, and is_good_name fields. Interestingly we don't need to name the index we're calling, as there's only one for that column.

Here's the code:

```sql
create or replace function query_embedding_small(
  query_embedding vector(1536),
  match_count int default 10
)
returns table (
  name text,
  hex text,
  is_good_name boolean,
  distance float
)
language sql volatile
as $$
  set statement_timeout = 15000;

  set ivfflat.probes = 5;

  select
    name,
    hex,
    is_good_name,
    embedding_small <#> query_embedding as distance
  from colors
  order by distance
  limit match_count;
$$;
```

Some explanations:

statement_timeout - How long (in ms) before a timeout on calling this function. Default is around 8-10 seconds, I've bumped to 15 seconds here.

ivfflat probes - This sets how many IVF lists the index will scan during search. Higher values = more accurate results but slower queries. Default is 1, we're setting to 10 for better accuracy at cost of some speed.

language sql volatile - This tells Postgres that this is a SQL function that can modify data and its output may change even with the same inputs. 'volatile' means the function's result can vary even if called with identical parameters. This is required if we want to use a non-default number of ivfflat probes.

# STEP SIX - RUN A TEST QUERY

```ts
const testQuery = async () => {
  const testEmbedding = await getEmbedding(
    "milky coffee in the middle of the night"
  );

  const { data, error } = await clientSupabase.rpc("query_embedding_small", {
    query_embedding: JSON.stringify(testEmbedding),
    match_count: 10,
  });

  if (error) {
    console.error("RPC error:", error);
  } else {
    console.log("Matches:", data);
  }
};
```

# STEP SEVEN - ADD IN ALL THE DATA

At this point I added in all 30,000 entries at this point.

It took about 8 hours.

Good news: It cost me $0.02 of API costs for the embedding values.
Bad news: It pushed me over the database size limits on Supabase...

# STEP EIGHT - UPGRADE SUPABASE

30,000 entries with vectors plus an index plus RPC function results in a database size of 0.53 GB, and the free tier limit is 0.5 GB.

If i had known this I might have only used 90% of the data, but I didn't so I've moved up to Pro plan size.

# STEP NINE - SOLVE TIMEOUTS

At this point I started getting this message:

```json
RPC error: {
code: "57014",
details: null,
hint: null,
message: "canceling statement due to statement timeout",
}
```

Here's what I did to solve this:

## 1 - Run ANALYZE (just once)

```
ANALYZE public.colors;
```

PostgreSQL scans a sample of rows in the public.colors table and updates its internal statistics about the data. These stats help the query planner decide how to execute queries efficiently — for example, whether to use an index or not.

## 2 - Decrease the number of IVFFLAT probes

In IVFFlat indexing, a higher probes value makes queries slower but more accurate.

## 3 - Increase the timeout time in the RPC function

Aka cheating. When I bumped the timeout to 30000ms all my problems went away.

## Other options that I did NOT need, but you might

- Recreate the index with a higher `lists` value (this only works if your querying with a `probes` that is much lower than the index's number of `lists`)
- Add a catch-and-retry in my server code. The second request always seems to be faster so there must be some warm-up logic or internal caching happening on Supabase
- Create my own cache of recent results in something like Redis

trivial cost (total cost for 30,000 entries came to $0.002)

https://platform.openai.com/docs/models/text-embedding-3-small
https://platform.openai.com/docs/models/text-embedding-3-large
