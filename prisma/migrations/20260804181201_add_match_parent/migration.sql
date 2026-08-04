-- CreateTable
CREATE TABLE "MatchParent" (
    "matchId" TEXT NOT NULL,
    "parentMatchId" TEXT NOT NULL,

    CONSTRAINT "MatchParent_pkey" PRIMARY KEY ("matchId","parentMatchId")
);

-- CreateIndex
CREATE INDEX "MatchParent_parentMatchId_idx" ON "MatchParent"("parentMatchId");

-- AddForeignKey
ALTER TABLE "MatchParent" ADD CONSTRAINT "MatchParent_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchParent" ADD CONSTRAINT "MatchParent_parentMatchId_fkey" FOREIGN KEY ("parentMatchId") REFERENCES "Match"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
