# Color Finder

A semantic color search engine powered by vector embeddings. Search for colors using natural language descriptions and get matching color suggestions.

## Features

- Natural language color search using OpenAI embeddings
- 30,000+ named colors in the database
- Fast vector similarity search using PostgreSQL/Supabase
- Returns color names, hex codes, and similarity scores

## Technical Decisions (All Lightly Taken)

- Uses OpenAI's text-embedding-3-small model for semantic embeddings
- PostgreSQL vector extension with IVFFlat indexing
- Supabase for database hosting and RPC functions
- TypeScript/Node.js backend

## Getting Started

1. Clone the repo
2. Clone the .env.example to .env and swap in your OpenAI / Supabase credentials
3. Install dependencies: `npm install`
4. Run the development server: `npm run dev`

## Credits

Written by [lui](https://github.com/yablochko8) for [brandmint.ai](https://brandmint.ai)
Color data sourced from [meodai/color-names](https://github.com/meodai/color-names)
