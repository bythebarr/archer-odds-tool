-- Pre-built leg pools (lib/pools): the props screener and the parlay builder
-- read these rows instead of rebuilding their pools on the request path, which
-- stampeded the database whenever a cache expired. Additive only: one new
-- table, nothing else touched. Reversible by dropping it.

-- CreateTable
CREATE TABLE "PoolSnapshot" (
    "key" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '[]',
    "rows" INTEGER NOT NULL DEFAULT 0,
    "builtAt" TIMESTAMP(3),
    "buildingSince" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "PoolSnapshot_pkey" PRIMARY KEY ("key")
);
